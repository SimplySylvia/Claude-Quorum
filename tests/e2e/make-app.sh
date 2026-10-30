#!/usr/bin/env bash
# Copy the sales-app fixture into DEST as a fresh git repo, for live end-to-end runs and evals.
#   tests/e2e/make-app.sh DEST
set -euo pipefail
dest=${1:?usage: make-app.sh DEST}
src="$(cd "$(dirname "$0")" && pwd)/sales-app"
[ ! -e "$dest" ] || { echo "make-app.sh: $dest already exists" >&2; exit 1; }
cp -R "$src" "$dest"
cd "$dest"
git init -q -b main
git add -A
git -c user.name=fixture -c user.email=fixture@example.com commit -qm "Initial sales app"
echo "$dest"
