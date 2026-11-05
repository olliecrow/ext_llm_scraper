#!/usr/bin/env bash
# Self-test for the sensitive-text checker, the gitleaks config, and the
# push-range scan. Every case must give the expected result, or this fails.
# Needs git and gitleaks on PATH.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
checker="${script_dir}/check-sensitive-text.sh"
range_check="${script_dir}/check-push-range.sh"
gitleaks_config="${repo_root}/.gitleaks.toml"
command -v gitleaks >/dev/null || { echo "error: gitleaks is not on PATH" >&2; exit 2; }

tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "${tmp_dir}"' EXIT
failures=0

# expect <pass|fail|error> <name> <command...>: pass is exit 0, fail is
# exit 1 (a finding), and error is exit 2.
expect() {
  local want="$1" name="$2" status=0 code
  shift 2
  "$@" </dev/null >"${tmp_dir}/out.log" 2>&1 || status=$?
  case "$want" in
    pass) code=0 ;;
    fail) code=1 ;;
    *) code=2 ;;
  esac
  if [[ "$status" -eq "$code" ]]; then
    echo "ok   ${name}"
  else
    echo "FAIL ${name}: expected ${want}, exit ${status}"
    sed 's/^/     /' "${tmp_dir}/out.log"
    failures=$((failures + 1))
  fi
}

# Build sample values at run time, so this file itself holds none of them.
home_path() { printf '/%s/%s' home "$1"; }
mac_path() { printf '/%s/%s' Users "$1"; }
win_path() { printf '%s:\\%s\\%s' C Users "$1"; }
token_line() { printf '%s=%s\n' token abc123456789XYZ; }

fixture() {
  local name="$1"
  shift
  printf '%s\n' "$@" >"${tmp_dir}/${name}.txt"
  printf '%s\n' "${tmp_dir}/${name}.txt"
}

# Each case is "<name> <pass|fail> <text>".
while IFS=' ' read -r name want text; do
  file="$(fixture "$name" "$text")"
  expect "$want" "text ${name}" bash "$checker" --context=selftest "$file"
  if [[ "$name" != token ]]; then
    expect "$want" "gitleaks ${name}" gitleaks dir --no-banner --redact --config "$gitleaks_config" "$file"
  fi
done <<CASES
home-real fail cd $(home_path private-example)/project
home-prefix fail cd $(home_path userbob)/project
mac-prefix fail see $(mac_path YOUNG)/code
mac-beside-placeholder fail $(mac_path YOU) and $(mac_path realname)
windows fail $(win_path realname)\\code
token fail $(token_line)
placeholders pass $(home_path user)/project and $(mac_path YOU)/code and $(win_path USERNAME)
CASES
expect fail "text token without ripgrep" env PATH=/usr/bin:/bin bash "$checker" "${tmp_dir}/token.txt"
if bash "$checker" "${tmp_dir}/missing.txt" >/dev/null 2>&1; then
  echo "FAIL text missing file passed"
  failures=$((failures + 1))
else
  echo "ok   text missing file"
fi

# Token values are synthetic and assembled only in temporary fixtures.
for family in ant-oat01 ant-api03 proj svcacct admin generic jwt github pat; do
  body="$(printf '%040d' 1)"
  case "$family" in
    generic) value="sk-${body}" ;;
    jwt) value="eyJ${body}.eyJ${body}.${body}" ;;
    github) value="ghp_${body}" ;;
    pat) value="github_pat_${body}" ;;
    *) value="sk-${family}-${body}" ;;
  esac
  file="$(fixture "token-${family}" "${value}")"
  expect fail "text bare ${family}" bash "$checker" "$file"
  if grep -Fq "$value" "${tmp_dir}/out.log"; then
    echo "FAIL scanner printed a token value"
    failures=$((failures + 1))
  fi
  if [[ "$family" == ant-* ]]; then
    expect fail "gitleaks bare ${family}" gitleaks dir --no-banner --verbose --redact --config "$gitleaks_config" "$file"
  fi
  file="$(fixture "safe-${family}" "task-${value}" "risk_${value}")"
  expect pass "text boundary ${family}" bash "$checker" "$file"
done
file="$(fixture safe-prose 'task-list-item risk-assessment task-ant-colony-development')"
expect pass "text safe prose" bash "$checker" "$file"

# Push ranges in a scratch repository.
work="${tmp_dir}/repo"
# Ignore user and system git config, such as signing or hooks.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git init -q "$work"
export GIT_AUTHOR_NAME=selftest GIT_COMMITTER_NAME=selftest
export GIT_AUTHOR_EMAIL=selftest@example.invalid GIT_COMMITTER_EMAIL=selftest@example.invalid
commit() {
  git -C "$work" add -A
  git -C "$work" commit -q --allow-empty -m "$1"
  git -C "$work" rev-parse HEAD
}
range() { (cd "$work" && env -u PRE_COMMIT_REMOTE_NAME bash "$range_check" "$@"); }
gitleaks_list() {
  range --list "$@" >"${tmp_dir}/commits.txt"
  bash "${script_dir}/gitleaks-commits.sh" "${tmp_dir}/commits.txt" "$work"
}

printf 'clean\n' >"${work}/a.txt"
root="$(commit 'docs: root')"
{ token_line; home_path private-example; } >"${work}/old.txt"
dirty="$(commit 'docs: old secret')"
git -C "$work" rm -q old.txt
clean_tip="$(commit 'docs: remove it')"
zero="0000000000000000000000000000000000000000"
gone="1111111111111111111111111111111111111111"

expect pass "range clean base" range --from "$dirty" --to "$clean_tip"
expect fail "range normal base" range --from "$root" --to "$clean_tip"
expect fail "range zero base scans all history" range --from "$zero" --to "$clean_tip"
expect fail "range missing base scans all history" range --from "$gone" --to "$clean_tip"
if [[ "$(range --list --from "$gone" --to "$clean_tip" | wc -l)" -eq 3 ]]; then
  echo "ok   range missing base lists every commit"
else
  echo "FAIL range missing base lists every commit"
  failures=$((failures + 1))
fi
expect fail "range bad target" range --from "$root" --to "$gone"

printf '++ %s\n' "$(home_path private-example)" >"${work}/plus.txt"
plus="$(commit 'docs: plus line')"
expect fail "range ++ line" range --from "$clean_tip" --to "$plus"
git -C "$work" rm -q plus.txt
unplus="$(commit 'docs: remove plus line')"

{ printf 'note %s\n' "$(home_path private-example)"; printf '\0'; } >"${work}/nul.txt"
nul="$(commit 'docs: text with a NUL byte')"
expect fail "range NUL file" range --from "$unplus" --to "$nul"
printf '* -diff\n' >"${work}/.gitattributes"
token_line >"${work}/hidden.txt"
hidden="$(commit 'docs: -diff attribute')"
expect fail "range -diff attribute" range --from "$nul" --to "$hidden"
expect fail "gitleaks NUL file" gitleaks_list --from "$unplus" --to "$nul"
expect fail "gitleaks missing base scans all history" gitleaks_list --from "$gone" --to "$clean_tip"
expect pass "gitleaks clean base" gitleaks_list --from "$dirty" --to "$clean_tip"
printf '%s\n' "$gone" >"${tmp_dir}/unknown.txt"
expect error "gitleaks unknown commit is an error" \
  bash "${script_dir}/gitleaks-commits.sh" "${tmp_dir}/unknown.txt" "$work"
printf '%s \n' "$root" >"${tmp_dir}/bad-line.txt"
expect error "gitleaks malformed list is an error" \
  bash "${script_dir}/gitleaks-commits.sh" "${tmp_dir}/bad-line.txt" "$work"

# Stub success must not hide skipped commits or missing scan summaries.
mkdir "${tmp_dir}/bin"
cat >"${tmp_dir}/bin/gitleaks" <<'STUB'
#!/usr/bin/env bash
case "$SCAN_MODE" in
  zero) echo 'INF 0 commits scanned.' ;;
  clean) echo 'INF 1 commits scanned.' ;;
  error) echo 'ERR git failed'; echo 'INF 1 commits scanned.' ;;
  missing) echo 'INF no leaks found' ;;
esac
STUB
chmod +x "${tmp_dir}/bin/gitleaks"
printf '%s\n' "$root" >"${tmp_dir}/stub-list.txt"
for mode in zero missing error; do
  expect error "gitleaks ${mode} fails closed" env PATH="${tmp_dir}/bin:$PATH" SCAN_MODE="$mode" \
    bash "${script_dir}/gitleaks-commits.sh" "${tmp_dir}/stub-list.txt" "$work"
done
expect pass "gitleaks clean summary" env PATH="${tmp_dir}/bin:$PATH" SCAN_MODE=clean \
  bash "${script_dir}/gitleaks-commits.sh" "${tmp_dir}/stub-list.txt" "$work"
printf '%s\n' "$clean_tip" >"${tmp_dir}/stub-list.txt"
expect pass "gitleaks zero for delete-only commit" env PATH="${tmp_dir}/bin:$PATH" SCAN_MODE=zero \
  bash "${script_dir}/gitleaks-commits.sh" "${tmp_dir}/stub-list.txt" "$work"

if [[ "$failures" -ne 0 ]]; then
  echo "${failures} self-test case(s) failed" >&2
  exit 1
fi
echo "all self-test cases passed"
