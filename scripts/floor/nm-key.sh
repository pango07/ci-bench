#!/usr/bin/env bash
# nm-key.sh <fx dir>: PR #276's node_modules key inputs (the lockfile, every
# package.json, .npmrc) hashed, plus node's exact version, the OS and arch.
set -euo pipefail
cd "$1"
{
  cat package-lock.json
  find . -name package.json -not -path '*/node_modules/*' | sort | xargs cat
  cat .npmrc 2>/dev/null || true
  node --version; uname -sm
} | sha256sum | cut -c1-40
