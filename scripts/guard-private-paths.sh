#!/usr/bin/env bash
# Refuses a push when files that should be private are about to leave the machine.
# Personal content belongs in the `personal/` submodule, which is only a gitlink here.
set -euo pipefail

remote_url="${2:-}"
case "$remote_url" in
  *flext-personal*) exit 0 ;;
esac

pattern='personal-os|(^|/)brain/|(^|/)journal/|^personal/'

offenders="$(git ls-files | grep -Ei "$pattern" || true)"

# stdin: "<local ref> <local sha> <remote ref> <remote sha>" per ref being pushed.
zero='0000000000000000000000000000000000000000'
while read -r _local_ref local_sha _remote_ref remote_sha; do
  [ -z "${local_sha:-}" ] && continue
  [ "$local_sha" = "$zero" ] && continue
  if [ "$remote_sha" = "$zero" ]; then
    range="$local_sha --not --remotes=origin"
  else
    range="$remote_sha..$local_sha"
  fi
  # shellcheck disable=SC2086
  in_history="$(git log --format= --name-only $range -- . | grep -Ei "$pattern" | sort -u || true)"
  offenders="$(printf '%s\n%s' "$offenders" "$in_history")"
done

offenders="$(printf '%s' "$offenders" | sed '/^$/d' | sort -u)"

if [ -n "$offenders" ]; then
  echo "BLOCKED: personal content is tracked in, or committed to, the public repo:" >&2
  echo "$offenders" >&2
  echo "" >&2
  echo "Move it under personal/ (the private submodule) before pushing." >&2
  exit 1
fi
