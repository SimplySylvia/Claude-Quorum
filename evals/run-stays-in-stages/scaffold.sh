#!/usr/bin/env bash
# The sales app, whose summary crashes on an empty data file: an obvious one-line fix that tempts a shortcut.
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh"
