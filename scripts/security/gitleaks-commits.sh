#!/usr/bin/env bash
# usage: gitleaks-commits.sh <commit-list-file> [repo-dir]
# Runs gitleaks on exactly the listed commits, one full commit ID per line.
# Exits 1 on a leak and 2 on any error. Gitleaks can log a git error, scan
# zero commits, and still exit 0, so an error in its log also fails.
# A commit that only deletes lines counts as zero scanned commits.
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 2
}

[[ "$#" -ge 1 && "$#" -le 2 ]] || die "usage: gitleaks-commits.sh <commit-list-file> [repo-dir]"
list_file="$1"
repo_dir="${2:-.}"
config="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.gitleaks.toml"

[[ -f "$list_file" ]] || die "commit list not found"
if [[ ! -s "$list_file" ]]; then
  echo "no commits to scan"
  exit 0
fi
if grep -qvxE '[0-9a-f]{40}|[0-9a-f]{64}' "$list_file"; then
  die "commit list has a line that is not a full commit ID"
fi
commits="$(paste -sd' ' "$list_file")"
commit_ids=()
while IFS= read -r commit_id; do
  git -C "$repo_dir" cat-file -e "${commit_id}^{commit}" || die "commit does not exist"
  commit_ids+=("$commit_id")
done <"$list_file"

tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "${tmp_dir}"' EXIT
raw_log="${tmp_dir}/raw.log"
log_file="${tmp_dir}/gitleaks.log"

status=0
gitleaks git --no-banner --no-color --redact --verbose --config "$config" \
  --log-opts="--text --no-textconv --no-ext-diff --diff-merges=first-parent --no-walk ${commits}" "$repo_dir" \
  >"$raw_log" 2>&1 || status=$?
# Drop color codes, which gitleaks writes even to a file.
esc="$(printf '\033')"
sed "s/${esc}\[[0-9;]*m//g" "$raw_log" >"$log_file"
cat "$log_file"

if [[ "$status" -eq 1 ]]; then
  exit 1
fi
[[ "$status" -eq 0 ]] || die "gitleaks exited with status ${status}"
if grep -qE '(^| )(ERR|FTL) ' "$log_file"; then
  die "gitleaks logged an error"
fi

count="$(sed -nE 's/.* ([0-9]+) commits? scanned\..*/\1/p' "$log_file" | tail -n 1)"
[[ -n "$count" ]] || die "gitleaks did not report a scanned-commit count"
if [[ "$count" -eq 0 ]]; then
  git -C "$repo_dir" log --text --no-textconv --no-ext-diff --diff-merges=first-parent \
    --no-walk --format= --patch "${commit_ids[@]}" >"${tmp_dir}/patch" \
    || die "unable to check added lines"
  if awk '/^diff --git / { hunk=0 } /^@@ / { hunk=1 } hunk && /^\+/ { added=1 } END { exit !added }' "${tmp_dir}/patch"; then
    die "gitleaks scanned zero commits despite added lines"
  fi
fi
