#!/usr/bin/env bash
# flags.sh <strategy>: gen.mjs's flags for it.
case $1 in
  quod) echo --incremental ;;
  quod-par) echo --incremental --parallel ;;
  *) echo ;;
esac
