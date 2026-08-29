#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <up|down>"
  exit 1
fi

direction="$1"
case "$direction" in
  up|down)
    ;;
  *)
    echo "Invalid argument: $direction"
    echo "Usage: $0 <up|down>"
    exit 1
    ;;
esac

if [[ ! -f .env ]]; then
  echo ".env file not found in project root"
  exit 1
fi

if ! command -v goose >/dev/null 2>&1; then
  echo "goose command not found. Install goose first."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

goose "$direction"