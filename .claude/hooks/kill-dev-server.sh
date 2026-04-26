#!/usr/bin/env bash
# Stop hook: terminate any pnpm dev / next dev process Claude left running.
# The user wants the dev server torn down at session-stop so it doesn't
# consume memory between turns. Failures (no matching process) are silent.
set +e
pkill -f "next dev" >/dev/null 2>&1
pkill -f "pnpm.*dev$" >/dev/null 2>&1
exit 0
