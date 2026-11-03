#!/usr/bin/env bash
# stamp.sh <name>: the monotonic clock (CLOCK_BOOTTIME via /proc/uptime, 10 ms) in ms, appended to $RUNNER_TEMP/stamps.
read -r up _ </proc/uptime
echo "$1 $(( 10#${up/./} * 10 ))" >> "${RUNNER_TEMP:?}/stamps"
