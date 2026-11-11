#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../_fixture/make.sh"
mkdir -p .claude
printf '{"reviewer_model": "inherit", "helper_model": "inherit"}\n' > .claude/quorum.json
git add .claude/quorum.json && git commit -qm "Remember Quorum's model choices"
