#!/usr/bin/env bash
# Compute the next patch version from existing vMAJOR.MINOR.PATCH tags.
# Output: version without "v" prefix (e.g. 1.0.1)
# UNCLASSIFIED // DEMO ONLY
set -euo pipefail

# Collect tags matching vMAJOR.MINOR.PATCH (all numeric components).
tags=$(git tag -l 'v*.*.*' 2>/dev/null | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true)

if [[ -z "${tags}" ]]; then
  echo "1.0.0"
  exit 0
fi

highest=$(printf '%s\n' "${tags}" | sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -n1)
IFS=. read -r major minor patch <<<"${highest}"
next_patch=$((patch + 1))
echo "${major}.${minor}.${next_patch}"
