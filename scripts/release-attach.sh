#!/usr/bin/env bash
# Attach build outputs to the draft release for a tag.
#
#   bash scripts/release-attach.sh v1.10.0 out/*
#
# Releases are immutable once published (a repository setting), so every
# asset goes onto a draft first and the draft is published last, by
# `npm run release:publish`. A draft holds no tag, so two jobs that each
# created one would leave two drafts for the same version: this script
# never creates a release. It finds the draft the maintainer created
# (npm run release:start, docs/releasing.md "Each release") and adds to it. It never replaces an
# asset either: an upload under a name already there fails.
#
# The one published release it will add to is an old one that predates
# immutability, for backfilling by hand with `gh workflow run`.

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <tag> <file>..." >&2
  exit 2
fi
tag="$1"
shift

repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

# The tag endpoint doesn't see drafts, so look through the list.
releases="$(gh api --paginate "repos/${repo}/releases" \
  -q ".[] | select(.tag_name == \"${tag}\") | \"\(.draft) \(.immutable)\"")"
count="$(printf '%s' "$releases" | grep -c . || true)"

if [ "$count" -eq 0 ]; then
  echo "::error::No release for ${tag}. Create the draft before pushing the tag (npm run release:start), then re-run this job."
  exit 1
fi
if [ "$count" -gt 1 ]; then
  echo "::error::${count} releases share the tag ${tag}. Delete the extra drafts, then re-run this job."
  exit 1
fi

read -r draft immutable <<<"$releases"
if [ "$draft" != "true" ]; then
  if [ "$immutable" = "true" ]; then
    echo "::error::${tag} is published and immutable, so nothing can be added to it. Cut a new version."
    exit 1
  fi
  echo "::warning::${tag} is already published but not immutable; adding to it as a backfill."
fi

gh release upload "$tag" "$@"
