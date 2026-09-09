#!/usr/bin/env bash
# Offline validator fixtures for schemaVersion 1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATE=(python3 "$ROOT/schema/validate-plan.py")
PASS=0
FAIL=0

bash -n "$0"

assert_ok() {
  PASS=$((PASS + 1))
  echo "  ok: $1"
}

assert() {
  local msg=$1
  shift
  if "$@"; then
    assert_ok "$msg"
  else
    echo "FAIL: $msg" >&2
    FAIL=$((FAIL + 1))
    return 1
  fi
}

story() {
  local id=$1 title=$2 pri=$3 deps=$4
  jq -n \
    --arg id "$id" \
    --arg title "$title" \
    --argjson pri "$pri" \
    --argjson deps "$deps" \
    '{
      id: $id,
      title: $title,
      description: "Complete behavioral contract",
      acceptanceCriteria: ["Observable criterion"],
      nonGoals: ["Explicit exclusion"],
      checks: ["npx nx run server:test"],
      references: ["server/internal/infrastructure/sqlite/memory.go"],
      dependencies: $deps,
      priority: $pri,
      passes: false,
      notes: ""
    }'
}

valid_plan() {
  jq -n --argjson s1 "$(story US-001 "First" 1 '[]')" --argjson s2 "$(story US-002 "Second" 2 '["US-001"]')" \
    '{
      schemaVersion: 1,
      project: "FleetShift",
      branchName: "ralph/feature-name",
      description: "Bounded feature outcome",
      userStories: [$s1, $s2]
    }'
}

expect_fail() {
  local msg=$1 mode=$2 file=$3 needle=$4
  local out rc=0
  out=$("${VALIDATE[@]}" --mode "$mode" "$file" 2>&1) || rc=$?
  assert "$msg exits nonzero" test "$rc" -ne 0
  assert "$msg mentions $needle" grep -Fq "$needle" <<<"$out"
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "== conversion success"
valid_plan >"$tmp/ok.json"
assert "conversion accepts a valid Plan" "${VALIDATE[@]}" --mode conversion "$tmp/ok.json"

echo "== runtime allows passed Stories and notes"
jq '.userStories[0].passes = true | .userStories[0].notes = "done"' "$tmp/ok.json" >"$tmp/runtime.json"
assert "runtime accepts passed Story notes" "${VALIDATE[@]}" --mode runtime "$tmp/runtime.json"
expect_fail "conversion rejects passed Story" conversion "$tmp/runtime.json" "userStories[0].passes"

echo "== structural"
jq '.project = ""' "$tmp/ok.json" >"$tmp/empty-project.json"
expect_fail "empty project" conversion "$tmp/empty-project.json" "project"

jq 'del(.userStories[0].checks)' "$tmp/ok.json" >"$tmp/missing-checks.json"
expect_fail "missing checks" conversion "$tmp/missing-checks.json" "checks"

jq '.userStories[0].checks = []' "$tmp/ok.json" >"$tmp/empty-checks.json"
expect_fail "empty checks" conversion "$tmp/empty-checks.json" "checks"

jq '.schemaVersion = 2' "$tmp/ok.json" >"$tmp/bad-version.json"
expect_fail "wrong schemaVersion" conversion "$tmp/bad-version.json" "schemaVersion"

jq '.extra = true' "$tmp/ok.json" >"$tmp/extra.json"
expect_fail "unknown top-level field" conversion "$tmp/extra.json" "extra"

echo "== uniqueness"
jq '.userStories[1].id = "US-001"' "$tmp/ok.json" >"$tmp/dup-id.json"
expect_fail "duplicate id" conversion "$tmp/dup-id.json" "userStories[1].id"

jq '.userStories[1].priority = 1' "$tmp/ok.json" >"$tmp/dup-pri.json"
expect_fail "duplicate priority" conversion "$tmp/dup-pri.json" "userStories[1].priority"

jq '.userStories[1].id = "US-009"' "$tmp/ok.json" >"$tmp/noncontinuous-id.json"
expect_fail "noncontinuous id" conversion "$tmp/noncontinuous-id.json" "userStories[1].id"

jq '.userStories[0].priority = 4 | .userStories[1].priority = 5' "$tmp/ok.json" >"$tmp/noncontinuous-priority.json"
expect_fail "priority not matching order" conversion "$tmp/noncontinuous-priority.json" "userStories[0].priority"

jq '.userStories[0].nonGoals = []' "$tmp/ok.json" >"$tmp/empty-non-goals.json"
assert "empty non-goals are accepted" "${VALIDATE[@]}" --mode conversion "$tmp/empty-non-goals.json"

echo "== dependencies"
jq '.userStories[0].dependencies = ["US-002"]' "$tmp/ok.json" >"$tmp/forward.json"
expect_fail "forward dependency" conversion "$tmp/forward.json" "userStories[0].dependencies[0]"

jq '.userStories[1].dependencies = ["US-009"]' "$tmp/ok.json" >"$tmp/missing-dep.json"
expect_fail "missing dependency" conversion "$tmp/missing-dep.json" "US-009"

jq '.userStories[1].dependencies = ["US-002"]' "$tmp/ok.json" >"$tmp/self-dep.json"
expect_fail "self dependency" conversion "$tmp/self-dep.json" "userStories[1].dependencies[0]"

jq '.userStories[1].dependencies = ["US-001", "US-001"]' "$tmp/ok.json" >"$tmp/dup-dep.json"
expect_fail "duplicate dependency entry" conversion "$tmp/dup-dep.json" "userStories[1].dependencies[1]"

echo "== conversion notes"
jq '.userStories[1].notes = "scratch"' "$tmp/ok.json" >"$tmp/notes.json"
expect_fail "conversion rejects notes" conversion "$tmp/notes.json" "userStories[1].notes"
assert "runtime accepts notes" "${VALIDATE[@]}" --mode runtime "$tmp/notes.json"

jq '.userStories[1].passes = true | .userStories[1].notes = "done"' "$tmp/ok.json" >"$tmp/passed-before-dependency.json"
expect_fail "passed Story with incomplete dependency" runtime "$tmp/passed-before-dependency.json" "userStories[1].dependencies[0]"

echo "== atomic write"
WRITE=(python3 "$ROOT/schema/write-plan.py")
repo="$tmp/target"
mkdir -p "$repo"
git init -q -b main "$repo"
git -C "$repo" config user.name "Ralph Fixture"
git -C "$repo" config user.email "ralph-fixture@example.com"
git -C "$repo" config commit.gpgsign false
printf '%s\n' 'base' >"$repo/README"
git -C "$repo" add README
git -C "$repo" commit -q -m init

rc=0
out=$("${WRITE[@]}" --repo "$repo" --from "$tmp/ok.json" 2>&1) || rc=$?
assert "write refuses unignored .ralph" test "$rc" -ne 0
assert "write ignore error names .ralph" grep -Fq "/.ralph/" <<<"$out"
assert "failed write leaves no Plan" test ! -e "$repo/.ralph/prd.json"

printf '%s\n' '/.ralph/' >>"$repo/.git/info/exclude"
assert "write installs a valid Plan" "${WRITE[@]}" --repo "$repo" --from "$tmp/ok.json"
assert "installed Plan exists" test -f "$repo/.ralph/prd.json"

before=$(cksum "$repo/.ralph/prd.json")
rc=0
out=$("${WRITE[@]}" --repo "$repo" --from "$tmp/ok.json" 2>&1) || rc=$?
assert "valid candidate cannot overwrite Plan" test "$rc" -ne 0
assert "overwrite refusal names existing Plan" grep -Fq "already exists" <<<"$out"
after=$(cksum "$repo/.ralph/prd.json")
assert "existing Plan unchanged after valid overwrite attempt" test "$before" = "$after"

jq '.userStories[0].passes = true' "$tmp/ok.json" >"$tmp/bad-write.json"
before=$(cksum "$repo/.ralph/prd.json")
rc=0
"${WRITE[@]}" --repo "$repo" --from "$tmp/bad-write.json" >/dev/null 2>&1 || rc=$?
assert "invalid candidate does not replace Plan" test "$rc" -ne 0
after=$(cksum "$repo/.ralph/prd.json")
assert "existing Plan unchanged after failed write" test "$before" = "$after"

symlink_repo="$tmp/symlink-target"
escape_dir="$tmp/escaped"
mkdir -p "$symlink_repo" "$escape_dir"
git init -q -b main "$symlink_repo"
git -C "$symlink_repo" config user.name "Ralph Fixture"
git -C "$symlink_repo" config user.email "ralph-fixture@example.com"
git -C "$symlink_repo" config commit.gpgsign false
printf '%s\n' 'base' >"$symlink_repo/README"
git -C "$symlink_repo" add README
git -C "$symlink_repo" commit -q -m init
printf '%s\n' '/.ralph/' >>"$symlink_repo/.git/info/exclude"
ln -s "$escape_dir" "$symlink_repo/.ralph"
rc=0
out=$("${WRITE[@]}" --repo "$symlink_repo" --from "$tmp/ok.json" 2>&1) || rc=$?
assert "symlinked .ralph is refused" test "$rc" -ne 0
assert "symlink refusal names .ralph" grep -Fq ".ralph" <<<"$out"
assert "symlink refusal writes nothing outside Target" test ! -e "$escape_dir/prd.json"

echo "== usage"
rc=0
out=$("${VALIDATE[@]}" 2>&1) || rc=$?
assert "missing path exits nonzero" test "$rc" -ne 0

if [[ "$FAIL" -ne 0 ]]; then
  echo "FAILED: $FAIL  passed: $PASS" >&2
  exit 1
fi
echo "PASSED: $PASS"
