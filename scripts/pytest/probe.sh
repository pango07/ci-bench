#!/usr/bin/env bash
# Times candidate projects' pytest suites (plain, warm venv): picks the tiers.
#   probe.sh owner/name[=extra,packages] ...
set -uo pipefail
for spec in "$@"; do
  repo=${spec%%=*}; extra=${spec#*=}; [ "$extra" = "$spec" ] && extra=
  d=/work/probe/${repo//\//_}; rm -rf "$d"
  git clone -q --depth 50 "https://github.com/$repo" "$d" || continue
  cd "$d"
  uv venv -q -p 3.12 .venv >/dev/null 2>&1
  uv pip install -q -p .venv/bin/python -e . pytest ${extra//,/ } >/dev/null 2>&1 || echo "$repo: install failed"
  grep -rhoE "pytest[^\"']*(-n |xdist)[^\"']*" .github/workflows tox.ini noxfile.py pyproject.toml setup.cfg 2>/dev/null | head -2 | sed "s|^|$repo ci: |"
  nf=$(find . -path ./.venv -prune -o -name 'test_*.py' -print | wc -l)
  .venv/bin/python -m pytest -q -p no:cacheprovider >/dev/null 2>&1   # warm (pyc)
  s=$(date +%s%N); .venv/bin/python -m pytest -q -p no:cacheprovider > out.txt 2>&1; rc=$?; e=$(date +%s%N)
  echo "$repo: $(( (e - s) / 1000000 )) ms, exit $rc, $nf test files, $(tail -1 out.txt)"
  cd /
done
