#!/usr/bin/env bash
# End-to-end Ralph Engine fixtures. No network or real Codex.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RALPH="$ROOT/ralph.sh"
FAKE="$ROOT/tests/fake-codex"
FAKEBIN=$(mktemp -d)
FIXTURE_ROOT=$(mktemp -d)
trap 'rm -rf "$FAKEBIN" "$FIXTURE_ROOT"' EXIT
ln -s "$FAKE" "$FAKEBIN/codex"
export PATH="$FAKEBIN:$PATH"
PASS=0
FAIL=0

bash -n "$RALPH"
bash -n "$FAKE"
bash -n "$0"

assert() {
  local msg=$1
  shift
  if "$@"; then
    PASS=$((PASS + 1))
    echo "  ok: $msg"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $msg" >&2
  fi
}

make_repo() {
  local repo=$1
  git init -q -b ralph/test "$repo"
  git -C "$repo" config user.name "Ralph Fixture"
  git -C "$repo" config user.email "ralph-fixture@example.com"
  git -C "$repo" config commit.gpgsign false
  mkdir -p "$repo/.ralph/prds"
  printf '%s\n' '*' '!.gitignore' '!prds/' '!prds/**' >"$repo/.ralph/.gitignore"
  printf '%s\n' '# Fixture PRD' >"$repo/.ralph/prds/prd-fixture.md"
  printf '%s\n' 'base' >"$repo/README"
  git -C "$repo" add .ralph/.gitignore .ralph/prds/prd-fixture.md README
  git -C "$repo" commit -q -m init
}

story() {
  local id=$1 title=$2 priority=$3 dependencies=$4 check=$5
  jq -n \
    --arg id "$id" \
    --arg title "$title" \
    --argjson priority "$priority" \
    --argjson dependencies "$dependencies" \
    --arg check "$check" \
    '{
      id: $id,
      title: $title,
      description: ("Implement " + $title),
      acceptanceCriteria: [("The " + $title + " outcome is observable")],
      nonGoals: [],
      checks: [$check],
      references: [".ralph/prds/prd-fixture.md § Stories"],
      dependencies: $dependencies,
      priority: $priority,
      passes: false,
      notes: ""
    }'
}

write_two_story_plan() {
  local plan=$1
  mkdir -p "$(dirname "$plan")"
  jq -n \
    --argjson one "$(story US-001 "first outcome" 1 '[]' 'grep -qx one story-1.txt')" \
    --argjson two "$(story US-002 "second outcome" 2 '["US-001"]' 'grep -qx two story-2.txt')" \
    '{
      schemaVersion: 1,
      project: "Fixture",
      branchName: "ralph/test",
      description: "Complete two ordered outcomes",
      userStories: [$one, $two]
    }' >"$plan"
}

run_ralph() {
  local repo=$1 plan=$2 state=$3 iterations=$4
  export RALPH_FAKE_STATE=$state
  mkdir -p "$state"
  (cd /tmp && "$RALPH" run --repo "$repo" --plan "$plan" --iterations "$iterations")
}

echo "Group 1: two Stories complete in one Run"
repo="$FIXTURE_ROOT/multi"
make_repo "$repo"
plan="$repo/.ralph/prd.json"
write_two_story_plan "$plan"
state="$repo/.ralph/fake"
mkdir -p "$state"
cat >"$state/hook" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  1) printf '%s\n' one >story-1.txt ;;
  2) printf '%s\n' two >story-2.txt ;;
esac
EOF
chmod +x "$state/hook"
start=$(git -C "$repo" rev-parse HEAD)
set +e
out=$(run_ralph "$repo" "$plan" "$state" 2 2>&1)
rc=$?
set -e

assert "Run succeeds" test "$rc" -eq 0
assert "Codex runs once per Story" test "$(cat "$state/count")" = 2
assert "Codex inherits no ambient capabilities" sh -c "grep -q '^CapInh:[[:space:]]*0000000000000000$' '$state/caps.1' && grep -q '^CapAmb:[[:space:]]*0000000000000000$' '$state/caps.1'"
assert "Codex uses automatic workspace review" grep -qx -- '--approve-for-me' "$state/argv.1"
assert "Codex does not pass conflicting sandbox flag" sh -c "! grep -qx -- '--sandbox' '$state/argv.1'"
assert "Run creates two Story commits" test "$(git -C "$repo" rev-list --count "$start"..HEAD)" = 2
assert "first commit names US-001" test "$(git -C "$repo" log --format=%s "$start"..HEAD --reverse | sed -n '1p')" = "ralph(US-001): first outcome"
assert "second commit names US-002" test "$(git -C "$repo" log --format=%s "$start"..HEAD --reverse | sed -n '2p')" = "ralph(US-002): second outcome"
assert "both Stories pass" test "$(jq '[.userStories[].passes] | all' "$plan")" = true
assert "first prompt contains only US-001" sh -c "grep -q 'US-001' '$state/prompt.1' && ! grep -q 'US-002' '$state/prompt.1'"
assert "second prompt contains US-002" grep -q US-002 "$state/prompt.2"
assert "first Story Check ran" grep -q 'story-1.txt' "$(find "$repo/.ralph/runs" -name 'iteration-001-US-001-checks.log')"
assert "second Story Check ran" grep -q 'story-2.txt' "$(find "$repo/.ralph/runs" -name 'iteration-002-US-002-checks.log')"
assert "worktree is clean" test -z "$(git -C "$repo" status --porcelain)"
assert "outcome reports completion" grep -q 'All Stories machine-complete' <<<"$out"

echo "Group 2: failed Check retries the same Story"
repo="$FIXTURE_ROOT/retry"
make_repo "$repo"
plan="$repo/.ralph/prd.json"
write_two_story_plan "$plan"
state="$repo/.ralph/fake"
mkdir -p "$state"
cat >"$state/hook" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  1) printf '%s\n' wrong >story-1.txt ;;
  2) printf '%s\n' one >story-1.txt ;;
  3) printf '%s\n' two >story-2.txt ;;
esac
EOF
chmod +x "$state/hook"
start=$(git -C "$repo" rev-parse HEAD)
set +e
out=$(run_ralph "$repo" "$plan" "$state" 3 2>&1)
rc=$?
set -e
assert "retry Run succeeds" test "$rc" -eq 0
assert "retry consumes three Iterations" test "$(cat "$state/count")" = 3
assert "failed attempt creates no extra commit" test "$(git -C "$repo" rev-list --count "$start"..HEAD)" = 2
assert "first two prompts select US-001" sh -c "grep -q US-001 '$state/prompt.1' && grep -q US-001 '$state/prompt.2'"
assert "third prompt selects US-002" grep -q US-002 "$state/prompt.3"
assert "retry prompt references previous JSONL" grep -q 'iteration-001-US-001.jsonl' "$state/prompt.2"
assert "retry prompt references previous Check log" grep -q 'iteration-001-US-001-checks.log' "$state/prompt.2"
assert "retry completes both Stories" test "$(jq '[.userStories[].passes] | all' "$plan")" = true

echo "Group 3: a later Run continues the next incomplete Story"
repo="$FIXTURE_ROOT/continue"
make_repo "$repo"
plan="$repo/.ralph/prd.json"
write_two_story_plan "$plan"
state1="$repo/.ralph/fake-one"
mkdir -p "$state1"
cat >"$state1/hook" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' one >story-1.txt
EOF
chmod +x "$state1/hook"
start=$(git -C "$repo" rev-parse HEAD)
set +e
run_ralph "$repo" "$plan" "$state1" 1 >/dev/null 2>&1
rc1=$?
set -e
assert "partial Run reports exhausted budget" test "$rc1" -ne 0
assert "partial Run passes only US-001" test "$(jq -r '[.userStories[].passes] | @json' "$plan")" = '[true,false]'
assert "partial Run leaves one clean commit" sh -c "test \"\$(git -C '$repo' rev-list --count '$start'..HEAD)\" = 1 && test -z \"\$(git -C '$repo' status --porcelain)\""
state2="$repo/.ralph/fake-two"
mkdir -p "$state2"
cat >"$state2/hook" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' two >story-2.txt
EOF
chmod +x "$state2/hook"
set +e
run_ralph "$repo" "$plan" "$state2" 1 >/dev/null 2>&1
rc2=$?
set -e
assert "continuation Run succeeds" test "$rc2" -eq 0
assert "continuation selects US-002" grep -q US-002 "$state2/prompt.1"
assert "continuation completes Plan" test "$(jq '[.userStories[].passes] | all' "$plan")" = true
assert "two Runs produce two Story commits" test "$(git -C "$repo" rev-list --count "$start"..HEAD)" = 2

echo "Group 4: already-satisfied Story needs no empty commit"
repo="$FIXTURE_ROOT/no-diff"
make_repo "$repo"
plan="$repo/.ralph/prd.json"
write_two_story_plan "$plan"
jq '.userStories = [.userStories[0]] | .userStories[0].checks = ["true"]' "$plan" >"$plan.tmp"
mv "$plan.tmp" "$plan"
state="$repo/.ralph/fake"
mkdir -p "$state"
printf '%s\n' '#!/usr/bin/env bash' 'true' >"$state/hook"
chmod +x "$state/hook"
start=$(git -C "$repo" rev-parse HEAD)
out=$(run_ralph "$repo" "$plan" "$state" 1 2>&1)
assert "no-diff Run succeeds" test "$?" -eq 0
assert "no-diff Story passes" test "$(jq -r '.userStories[0].passes' "$plan")" = true
assert "no empty commit is created" test "$(git -C "$repo" rev-parse HEAD)" = "$start"
assert "no-diff completion is reported" grep -q 'without changes' <<<"$out"

echo "Group 5: branch and Plan ownership are enforced"
repo="$FIXTURE_ROOT/branch-mismatch"
make_repo "$repo"
plan="$repo/.ralph/prd.json"
write_two_story_plan "$plan"
jq '.branchName = "ralph/other"' "$plan" >"$plan.tmp"
mv "$plan.tmp" "$plan"
state="$repo/.ralph/fake"
set +e
out=$(run_ralph "$repo" "$plan" "$state" 1 2>&1)
rc=$?
set -e
assert "branch mismatch fails" test "$rc" -ne 0
assert "branch mismatch names current branch" grep -q 'ralph/test' <<<"$out"
assert "branch mismatch names Plan branch" grep -q 'ralph/other' <<<"$out"
assert "branch mismatch invokes no agent" test ! -f "$state/count"

repo="$FIXTURE_ROOT/plan-mutation"
make_repo "$repo"
plan="$repo/.ralph/prd.json"
write_two_story_plan "$plan"
jq '.userStories = [.userStories[0]] | .userStories[0].checks = ["true"]' "$plan" >"$plan.tmp"
mv "$plan.tmp" "$plan"
state="$repo/.ralph/fake"
mkdir -p "$state"
cat >"$state/hook" <<'EOF'
#!/usr/bin/env bash
jq '.description += " changed"' .ralph/prd.json >.ralph/prd.json.tmp
mv .ralph/prd.json.tmp .ralph/prd.json
EOF
chmod +x "$state/hook"
start=$(git -C "$repo" rev-parse HEAD)
set +e
out=$(run_ralph "$repo" "$plan" "$state" 1 2>&1)
rc=$?
set -e
assert "agent Plan mutation fails" test "$rc" -ne 0
assert "Plan mutation is identified" grep -q 'Plan changed' <<<"$out"
assert "Plan mutation creates no commit" test "$(git -C "$repo" rev-parse HEAD)" = "$start"

echo "Group 6: an all-passed Plan invokes no agent"
repo="$FIXTURE_ROOT/all-passed"
make_repo "$repo"
plan="$repo/.ralph/prd.json"
write_two_story_plan "$plan"
jq '.userStories[].passes = true | .userStories[].notes = "done"' "$plan" >"$plan.tmp"
mv "$plan.tmp" "$plan"
state="$repo/.ralph/fake"
export RALPH_FAKE_LOGIN_FAIL=1
set +e
out=$(run_ralph "$repo" "$plan" "$state" 2 2>&1)
rc=$?
set -e
unset RALPH_FAKE_LOGIN_FAIL
assert "all-passed Run succeeds without Codex login" test "$rc" -eq 0
assert "all-passed Plan invokes no agent" test ! -f "$state/count"
assert "all-passed completion is reported" grep -q 'All Stories machine-complete' <<<"$out"

echo "Group 7: restart reconciles a committed Story"
repo="$FIXTURE_ROOT/reconcile"
make_repo "$repo"
plan="$repo/.ralph/prd.json"
write_two_story_plan "$plan"
printf '%s\n' one >"$repo/story-1.txt"
git -C "$repo" add story-1.txt
git -C "$repo" commit -q -m 'ralph(US-001): first outcome' -m 'Ralph-Story: US-001'
crash_head=$(git -C "$repo" rev-parse HEAD)
state="$repo/.ralph/fake"
mkdir -p "$state"
cat >"$state/hook" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' two >story-2.txt
EOF
chmod +x "$state/hook"
set +e
out=$(run_ralph "$repo" "$plan" "$state" 1 2>&1)
rc=$?
set -e
assert "recovery Run succeeds" test "$rc" -eq 0
assert "recovery spends its Iteration on US-002" grep -q US-002 "$state/prompt.1"
assert "recovery completes both Stories" test "$(jq '[.userStories[].passes] | all' "$plan")" = true
assert "recovery creates only the US-002 commit" test "$(git -C "$repo" rev-list --count "$crash_head"..HEAD)" = 1
assert "recovery is reported" grep -q 'Reconciled US-001' <<<"$out"

echo "Group 8: agent Git lifecycle violations stop immediately"
for violation in branch commit stage; do
  repo="$FIXTURE_ROOT/agent-$violation"
  make_repo "$repo"
  plan="$repo/.ralph/prd.json"
  write_two_story_plan "$plan"
  jq '.userStories = [.userStories[0]] | .userStories[0].checks = ["true"]' "$plan" >"$plan.tmp"
  mv "$plan.tmp" "$plan"
  state="$repo/.ralph/fake"
  mkdir -p "$state"
  case "$violation" in
    branch)
      printf '%s\n' '#!/usr/bin/env bash' 'git switch -q -c agent-branch' >"$state/hook"
      ;;
    commit)
      printf '%s\n' '#!/usr/bin/env bash' 'printf agent >agent.txt' 'git add agent.txt' 'git commit -q -m agent-commit' >"$state/hook"
      ;;
    stage)
      printf '%s\n' '#!/usr/bin/env bash' 'printf staged >staged.txt' 'git add staged.txt' >"$state/hook"
      ;;
  esac
  chmod +x "$state/hook"
  set +e
  out=$(run_ralph "$repo" "$plan" "$state" 2 2>&1)
  rc=$?
  set -e
  assert "agent $violation fails" test "$rc" -ne 0
  assert "agent $violation gets no retry" test "$(cat "$state/count")" = 1
  assert "agent $violation is reported as invariant violation" grep -q 'invariant violation' <<<"$out"
done

echo "Group 9: invalid starts invoke no agent"
repo="$FIXTURE_ROOT/dirty-start"
make_repo "$repo"
plan="$repo/.ralph/prd.json"
write_two_story_plan "$plan"
printf '%s\n' dirty >"$repo/dirty.txt"
state="$repo/.ralph/fake"
set +e
out=$(run_ralph "$repo" "$plan" "$state" 1 2>&1)
rc=$?
set -e
assert "dirty start fails" test "$rc" -ne 0
assert "dirty start invokes no agent" test ! -f "$state/count"

repo="$FIXTURE_ROOT/invalid-plan"
make_repo "$repo"
plan="$repo/.ralph/prd.json"
mkdir -p "$(dirname "$plan")"
printf '%s\n' '{"schemaVersion": 1}' >"$plan"
state="$repo/.ralph/fake"
set +e
out=$(run_ralph "$repo" "$plan" "$state" 1 2>&1)
rc=$?
set -e
assert "invalid Plan fails" test "$rc" -ne 0
assert "invalid Plan invokes no agent" test ! -f "$state/count"
assert "invalid Plan reports schema error" grep -q 'missing required field' <<<"$out"

echo "Group 10: Plan location and runtime ignore state are invariant"
repo="$FIXTURE_ROOT/root-plan"
make_repo "$repo"
plan="$repo/prd.json"
write_two_story_plan "$plan"
git -C "$repo" add prd.json
git -C "$repo" commit -q -m 'track misplaced Plan'
state="$repo/.ralph/fake"
set +e
out=$(run_ralph "$repo" "$plan" "$state" 1 2>&1)
rc=$?
set -e
assert "Plan outside .ralph/prd.json is refused" test "$rc" -ne 0
assert "misplaced Plan invokes no agent" test ! -f "$state/count"
assert "misplaced Plan reports required location" grep -q '.ralph/prd.json' <<<"$out"

repo="$FIXTURE_ROOT/ignore-mutation"
make_repo "$repo"
plan="$repo/.ralph/prd.json"
write_two_story_plan "$plan"
jq '.userStories = [.userStories[0]]' "$plan" >"$plan.tmp"
mv "$plan.tmp" "$plan"
state="$repo/.ralph/fake"
mkdir -p "$state"
cat >"$state/hook" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' one >story-1.txt
: >.ralph/.gitignore
EOF
chmod +x "$state/hook"
start=$(git -C "$repo" rev-parse HEAD)
set +e
out=$(run_ralph "$repo" "$plan" "$state" 1 2>&1)
rc=$?
set -e
assert "removing Plan ignore rule fails" test "$rc" -ne 0
assert "ignore mutation is an invariant violation" grep -q 'Plan is no longer ignored' <<<"$out"
assert "ignore mutation creates no commit" test "$(git -C "$repo" rev-parse HEAD)" = "$start"
assert "historical PRD remains tracked" test "$(git -C "$repo" ls-files -- .ralph/prds/prd-fixture.md)" = ".ralph/prds/prd-fixture.md"
assert "runtime files remain untracked" test -z "$(git -C "$repo" ls-files .ralph/prd.json .ralph/run.lock .ralph/runs)"

if [[ "$FAIL" -ne 0 ]]; then
  echo "FAILED: $FAIL  passed: $PASS" >&2
  exit 1
fi
echo "PASSED: $PASS"
