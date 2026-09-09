#!/usr/bin/env bash
# Ralph Engine: execute a validated multi-Story Plan with fresh Codex Iterations.
set -euo pipefail

CODEX_MODEL="gpt-5.6-luna"
CODEX_REASONING_CONFIG='model_reasoning_effort="high"'
ITERATION_TIMEOUT=3600
CHECK_TIMEOUT=900

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_TEMPLATE="$SCRIPT_DIR/prompt.md"
VALIDATE_PLAN="$SCRIPT_DIR/schema/validate-plan.py"
UPDATE_PLAN="$SCRIPT_DIR/schema/update-plan.py"

die() {
  echo "Failed: $*" >&2
  exit 1
}

usage() {
  echo "Usage: ralph.sh run --repo PATH --plan PATH --iterations N" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required executable not found: $1"
}

canonicalize() {
  realpath -e "$1"
}

parse_args() {
  [[ $# -ge 1 ]] || usage
  [[ "$1" == "run" ]] || die "unknown operation: $1"
  shift

  REPO_ARG=""
  PLAN_ARG=""
  ITERATIONS_ARG=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo)
        [[ $# -ge 2 ]] || die "missing value for --repo"
        [[ -z "$REPO_ARG" ]] || die "duplicate --repo"
        REPO_ARG=$2
        shift 2
        ;;
      --plan)
        [[ $# -ge 2 ]] || die "missing value for --plan"
        [[ -z "$PLAN_ARG" ]] || die "duplicate --plan"
        PLAN_ARG=$2
        shift 2
        ;;
      --iterations)
        [[ $# -ge 2 ]] || die "missing value for --iterations"
        [[ -z "$ITERATIONS_ARG" ]] || die "duplicate --iterations"
        ITERATIONS_ARG=$2
        shift 2
        ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  [[ -n "$REPO_ARG" ]] || die "missing --repo"
  [[ -n "$PLAN_ARG" ]] || die "missing --plan"
  [[ -n "$ITERATIONS_ARG" ]] || die "missing --iterations"
  [[ "$ITERATIONS_ARG" =~ ^[1-9][0-9]*$ ]] || die "invalid --iterations: $ITERATIONS_ARG"
  MAX_ITERATIONS=$ITERATIONS_ARG
}

git_c() {
  git -C "$REPO" "$@"
}

plan_hash() {
  sha256sum "$PLAN" | awk '{print $1}'
}

worktree_dirty() {
  [[ -n "$(git_c status --porcelain --untracked-files=all)" ]]
}

index_dirty() {
  ! git_c diff --cached --quiet
}

plan_ignored() {
  git_c check-ignore -q -- .ralph/prd.json
}

all_stories_passed() {
  jq -e '.userStories | all(.passes == true)' "$PLAN" >/dev/null
}

select_story() {
  jq -c '
    . as $plan
    | [
        .userStories[]
        | select(.passes == false)
        | select(
            .dependencies
            | all(. as $dep | $plan.userStories | any(.id == $dep and .passes == true))
          )
      ]
    | sort_by(.priority)
    | first // empty
  ' "$PLAN"
}

check_agent_invariants() {
  local expected_head=$1 expected_plan_hash=$2 branch head hash
  branch=$(git_c symbolic-ref --short HEAD)
  head=$(git_c rev-parse HEAD)
  hash=$(plan_hash)
  plan_ignored || die "invariant violation: Plan is no longer ignored"
  [[ "$branch" == "$PLAN_BRANCH" ]] || die "invariant violation: branch changed (${PLAN_BRANCH} -> ${branch})"
  [[ "$head" == "$expected_head" ]] || die "invariant violation: HEAD changed (${expected_head} -> ${head})"
  ! index_dirty || die "invariant violation: index is not empty"
  [[ "$hash" == "$expected_plan_hash" ]] || die "invariant violation: Plan changed"
}

write_iteration_prompt() {
  local dest=$1 iteration=$2 story_id=$3 story_json=$4
  local previous="" path
  while IFS= read -r path; do
    previous+="- ${path}"$'\n'
  done < <(find "$LOG_DIR" -maxdepth 1 -type f -name "iteration-*-${story_id}*" | sort)
  [[ -n "$previous" ]] || previous="(none; this is the first attempt for this Story)"

  cat >"$dest" <<EOF
# Ralph Iteration ${iteration}

## Story

\`\`\`json
${story_json}
\`\`\`

## Paths
Target Repository: ${REPO}
Plan: ${PLAN}
Log directory: ${LOG_DIR}

## Previous attempt logs for ${story_id}
${previous}

## Instructions
$(cat "$PROMPT_TEMPLATE")
EOF
}

run_checks() {
  local log=$1 check
  : >"$log"
  for check in "${CHECKS[@]}"; do
    {
      echo "+ timeout ${CHECK_TIMEOUT} bash -lc $(printf '%q' "$check")"
      if ! timeout "$CHECK_TIMEOUT" bash -lc "$check"; then
        echo "Check failed: $check"
        return 1
      fi
    } >>"$log" 2>&1
  done
}

commit_story() {
  local story_id=$1 story_title=$2
  plan_ignored || die "invariant violation: Plan is no longer ignored"
  git_c add -A
  git_c commit -m "ralph(${story_id}): ${story_title}" -m "Ralph-Story: ${story_id}" || die "commit failed"
}

complete_story() {
  local story_id=$1 notes=$2 expected_hash=$3
  python3 "$UPDATE_PLAN" \
    --plan "$PLAN" \
    --story "$story_id" \
    --notes "$notes" \
    --expected-sha256 "$expected_hash" || die "could not update Plan after completing ${story_id}"
}

reconcile_head_commit() {
  local story_id story_json title expected_subject actual_subject ready_json ready_id expected_hash head
  story_id=$(git_c log -1 --format='%(trailers:key=Ralph-Story,valueonly)' | tr -d '\r\n')
  [[ -n "$story_id" ]] || return 0
  story_json=$(jq -c --arg id "$story_id" '.userStories[] | select(.id == $id)' "$PLAN")
  [[ -n "$story_json" ]] || return 0
  [[ "$(jq -r '.passes' <<<"$story_json")" == "false" ]] || return 0

  ready_json=$(select_story)
  ready_id=$(jq -r '.id' <<<"$ready_json")
  [[ "$ready_id" == "$story_id" ]] || die "cannot reconcile ${story_id}: it is not the next ready Story"
  title=$(jq -r '.title' <<<"$story_json")
  expected_subject="ralph(${story_id}): ${title}"
  actual_subject=$(git_c log -1 --format=%s)
  [[ "$actual_subject" == "$expected_subject" ]] || die "cannot reconcile ${story_id}: commit subject does not match Story"

  head=$(git_c rev-parse HEAD)
  expected_hash=$(plan_hash)
  complete_story "$story_id" "Recovered commit ${head}" "$expected_hash"
  echo "Reconciled ${story_id} from commit ${head}"
}

parse_args "$@"

[[ -e "$REPO_ARG" ]] || die "repository path does not exist: $REPO_ARG"
[[ -f "$PLAN_ARG" ]] || die "Plan path does not exist: $PLAN_ARG"
REPO=$(canonicalize "$REPO_ARG")
PLAN=$(canonicalize "$PLAN_ARG")
[[ -d "$REPO" ]] || die "repository path is not a directory: $REPO"
[[ "$PLAN" == "$REPO/.ralph/prd.json" ]] || die "Plan must be <Target Repository>/.ralph/prd.json"

for command in bash jq git flock timeout sha256sum realpath python3; do
  need_cmd "$command"
done
[[ -f "$PROMPT_TEMPLATE" ]] || die "missing prompt template: $PROMPT_TEMPLATE"
[[ -f "$VALIDATE_PLAN" ]] || die "missing Plan validator: $VALIDATE_PLAN"
[[ -f "$UPDATE_PLAN" ]] || die "missing Plan updater: $UPDATE_PLAN"

python3 "$VALIDATE_PLAN" --mode runtime "$PLAN" || die "invalid Plan: $PLAN"
PLAN_BRANCH=$(jq -r '.branchName' "$PLAN")

git_c rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a Git repository: $REPO"
toplevel=$(canonicalize "$(git_c rev-parse --show-toplevel)")
[[ "$toplevel" == "$REPO" ]] || die "repository path must be the worktree root: $REPO"
[[ ! -L "$REPO/.ralph" ]] || die "symlinked .ralph directory is not allowed"
git_c symbolic-ref -q HEAD >/dev/null || die "detached HEAD is not allowed"
CURRENT_BRANCH=$(git_c symbolic-ref --short HEAD)
[[ "$CURRENT_BRANCH" == "$PLAN_BRANCH" ]] || die "current branch ${CURRENT_BRANCH} does not match Plan branch ${PLAN_BRANCH}"
git_c var GIT_AUTHOR_IDENT >/dev/null || die "Git identity is not configured"
git_c var GIT_COMMITTER_IDENT >/dev/null || die "Git identity is not configured"

if ! plan_ignored; then
  die ".ralph/ is not ignored in $REPO"
fi
if worktree_dirty || index_dirty; then
  die "worktree and index must be clean"
fi
mkdir -p "$REPO/.ralph"
exec 9>"$REPO/.ralph/run.lock"
flock -n 9 || die "another Run already holds the lock for $REPO"

reconcile_head_commit

if all_stories_passed; then
  echo "All Stories machine-complete"
  exit 0
fi

need_cmd setpriv
need_cmd codex
if ! codex login status >/dev/null 2>&1; then
  die "Codex is not logged in"
fi

LOG_DIR="$REPO/.ralph/runs/$(date +%Y%m%dT%H%M%S)-$$"
mkdir -p "$LOG_DIR"

echo "Ralph Run"
echo "  repository: $REPO"
echo "  plan: $PLAN"
echo "  branch: $PLAN_BRANCH"
echo "  Iteration budget: $MAX_ITERATIONS"
echo "  logs: $LOG_DIR"

iteration=0
while ((iteration < MAX_ITERATIONS)); do
  if all_stories_passed; then
    echo "All Stories machine-complete"
    echo "Logs: $LOG_DIR"
    exit 0
  fi

  STORY_JSON=$(select_story)
  [[ -n "$STORY_JSON" ]] || die "invariant violation: incomplete Stories exist but none has satisfied dependencies"
  STORY_ID=$(jq -r '.id' <<<"$STORY_JSON")
  STORY_TITLE=$(jq -r '.title' <<<"$STORY_JSON")
  mapfile -t CHECKS < <(jq -r '.checks[]' <<<"$STORY_JSON")

  iteration=$((iteration + 1))
  tag=$(printf '%03d' "$iteration")
  echo
  echo "Iteration $iteration of $MAX_ITERATIONS: $STORY_ID"

  prompt_file="$LOG_DIR/iteration-${tag}-${STORY_ID}.prompt"
  jsonl_file="$LOG_DIR/iteration-${tag}-${STORY_ID}.jsonl"
  checks_file="$LOG_DIR/iteration-${tag}-${STORY_ID}-checks.log"
  write_iteration_prompt "$prompt_file" "$iteration" "$STORY_ID" "$STORY_JSON"

  expected_head=$(git_c rev-parse HEAD)
  expected_plan_hash=$(plan_hash)
  set +e
  timeout "$ITERATION_TIMEOUT" \
    setpriv --inh-caps=-all --ambient-caps=-all \
    codex exec \
    --cd "$REPO" \
    --ephemeral \
    --model "$CODEX_MODEL" \
    --config "$CODEX_REASONING_CONFIG" \
    --approve-for-me \
    --json \
    - <"$prompt_file" >"$jsonl_file" 2>&1
  codex_rc=$?
  set -e

  check_agent_invariants "$expected_head" "$expected_plan_hash"
  if [[ "$codex_rc" -ne 0 ]]; then
    echo "Codex failed (exit $codex_rc); retaining $jsonl_file"
    continue
  fi
  checks_passed=true
  if ! (
    cd "$REPO"
    run_checks "$checks_file"
  ); then
    checks_passed=false
  fi
  check_agent_invariants "$expected_head" "$expected_plan_hash"
  if [[ "$checks_passed" != "true" ]]; then
    echo "Checks failed for $STORY_ID; retaining $checks_file"
    continue
  fi

  if worktree_dirty; then
    commit_story "$STORY_ID" "$STORY_TITLE"
    commit=$(git_c rev-parse HEAD)
    notes="Committed ${commit}; logs ${LOG_DIR}"
  else
    commit=""
    notes="Already satisfied; logs ${LOG_DIR}"
  fi
  complete_story "$STORY_ID" "$notes" "$expected_plan_hash"
  if [[ -n "$commit" ]]; then
    echo "Story machine-complete: $STORY_ID ($commit)"
  else
    echo "Story machine-complete without changes: $STORY_ID"
  fi
done

if all_stories_passed; then
  echo "All Stories machine-complete"
  echo "Logs: $LOG_DIR"
  exit 0
fi

echo
echo "Failed: Iteration budget exhausted with incomplete Stories"
echo "Logs: $LOG_DIR"
exit 1
