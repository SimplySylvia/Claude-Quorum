#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh" --task csv-export MEDIUM IN_REVIEW --bug
