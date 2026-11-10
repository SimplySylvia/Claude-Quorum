#!/usr/bin/env bats
load ../helpers

# A task per git worktree: quorum-branch start --worktree, and how the helpers find the task, the root, and the code
# from inside one.
setup() {
  make_repo
  mkdir -p .claude/hooks
  printf '# Project\n' > CLAUDE.md
  printf '# Review\n' > REVIEW.md
  printf '#!/usr/bin/env bash\nexit 0\n' > .claude/hooks/verify-completion.sh
  echo ".tasks/" > .gitignore
  git add -A && git -c user.name=t -c user.email=t@example.com commit -qm bootstrap
  "$BIN/quorum-state" --task demo init MEDIUM BUILDING
  "$BIN/quorum-active-task" --set demo
  ROOT_REAL=$(pwd -P)
}
teardown() { cleanup_repo; }
commit_in() { (cd "$1" && echo "$2" >> a.txt && git add a.txt && git -c user.name=t -c user.email=t@example.com commit -qm "$2"); }

@test "start --worktree checks the branch out in .claude/worktrees/<slug> and leaves this working tree alone" {
  run "$BIN/quorum-branch" start demo --worktree
  [ "$status" -eq 0 ]
  wt="$ROOT_REAL/.claude/worktrees/demo"
  [ "$output" = "$(printf 'feat/demo\n%s' "$wt")" ]
  [ "$(git branch --show-current)" = main ]
  [ "$(git -C "$wt" branch --show-current)" = feat/demo ]
  [ "$("$BIN/quorum-state" --task demo get worktree)" = "$wt" ]
  # recorded as `--code` prints it inside, even when the root was reached through a symlink
  [ "$(cd "$wt" && "$BIN/quorum-active-task" --code)" = "$wt" ]
  [ "$("$BIN/quorum-state" --task demo get base_sha)" = "$(git rev-parse main)" ]
  # The task's folder moved into the worktree, and the main tree links to it; git sees neither, nor the worktree.
  [ -d "$wt/.tasks/demo" ] && [ ! -L "$wt/.tasks/demo" ] && [ -f "$wt/.tasks/demo/state.md" ]
  [ -L .tasks/demo ] && [ -f .tasks/demo/state.md ]
  [ -z "$(git status --porcelain)" ]
  [ -z "$(git -C "$wt" status --porcelain)" ]
  # a second start reuses it
  run "$BIN/quorum-branch" start demo --worktree
  [ "$status" -eq 0 ]
  [ "$(git worktree list | wc -l | tr -d ' ')" = 2 ]
}

@test "start --worktree refuses with exit 3 when the bootstrap files aren't committed" {
  git rm -q --cached .claude/hooks/verify-completion.sh
  git -c user.name=t -c user.email=t@example.com commit -qm untrack
  run "$BIN/quorum-branch" start demo --worktree
  [ "$status" -eq 3 ]
  [[ "$output" == *"not committed on main: .claude/hooks/verify-completion.sh"* ]]
  [ "$(git worktree list | wc -l | tr -d ' ')" = 1 ]
}

@test "inside a worktree, the task comes from its branch, and the worktree is its root and its code" {
  "$BIN/quorum-branch" start demo --worktree >/dev/null
  "$BIN/quorum-state" --task other init LOW PLANNING
  "$BIN/quorum-active-task" --set other
  wt="$ROOT_REAL/.claude/worktrees/demo"
  # The session stays rooted at the main tree (CLAUDE_PROJECT_DIR) while its directory moves into the worktree.
  cd "$wt"
  export CLAUDE_PROJECT_DIR=$ROOT_REAL
  [ "$("$BIN/quorum-active-task")" = demo ]
  [ "$("$BIN/quorum-active-task" --root)" = "$wt" ]
  [ "$("$BIN/quorum-active-task" --code)" = "$wt" ]
  [ "$("$BIN/quorum-active-task" --main)" = "$ROOT_REAL" ]
  # Writes from there stay inside the worktree, and show in the main tree through its link.
  "$BIN/quorum-state" set round 2
  [ "$(cd "$ROOT_REAL" && "$BIN/quorum-state" --task demo get round)" = 2 ]
  # A session started inside the worktree finds the same.
  export CLAUDE_PROJECT_DIR=$wt
  [ "$("$BIN/quorum-active-task" --root)" = "$wt" ]
  [ "$("$BIN/quorum-active-task" --main)" = "$ROOT_REAL" ]
  [ "$("$BIN/quorum-active-task")" = demo ]
  # The main working tree keeps its own active task.
  cd "$ROOT_REAL"; unset CLAUDE_PROJECT_DIR
  [ "$("$BIN/quorum-active-task")" = other ]
  [ "$("$BIN/quorum-active-task" --code)" = "$ROOT_REAL" ]
  [ "$("$BIN/quorum-active-task" --list | sort)" = "$(printf 'demo\tBUILDING\t%s\nother\tPLANNING\t' "$wt")" ]
}

@test "a worktree on a branch with no task never falls back to .tasks/.active" {
  git worktree add -q "$ROOT_REAL/../side-$$" -b feat/unrelated
  cd "$ROOT_REAL/../side-$$"
  run "$BIN/quorum-active-task"
  [ "$status" -eq 1 ]
  cd "$ROOT_REAL"; git worktree remove "$ROOT_REAL/../side-$$"
}

@test "range, record, and the proof check use the worktree's HEAD" {
  "$BIN/quorum-branch" start demo --worktree >/dev/null
  wt="$ROOT_REAL/.claude/worktrees/demo"
  commit_in "$wt" one
  cd "$wt"
  [ "$("$BIN/quorum-branch" range)" = "$(git rev-parse main)..HEAD" ]
  [ "$("$BIN/quorum-branch" record)" = "$(git rev-parse HEAD)" ]
  printf 'Proof: demo at %s\nResult: ALL PASS\n' "$(git rev-parse --short HEAD)" > .tasks/demo/proof-final.md
  # from the main tree too: the proof is checked against the task's worktree, not main's HEAD
  cd "$ROOT_REAL"
  run "$BIN/quorum-state" --task demo set status READY
  [ "$status" -eq 0 ]
}

@test "remove deletes a clean worktree and keeps the branch; refuses a dirty one, or from inside it" {
  "$BIN/quorum-branch" start demo --worktree >/dev/null
  wt="$ROOT_REAL/.claude/worktrees/demo"
  echo wip > "$wt/wip.txt"
  run "$BIN/quorum-branch" remove demo
  [ "$status" -eq 3 ]
  [[ "$output" == *"wip.txt"* ]]
  rm "$wt/wip.txt"
  (cd "$wt" && run "$BIN/quorum-branch" remove demo && [ "$status" -eq 1 ])
  "$BIN/quorum-state" --task demo log <<< "## Round 1"
  run "$BIN/quorum-branch" remove demo
  [ "$status" -eq 0 ]
  [ ! -d "$wt" ]
  # the task's folder came back first, with its history
  [ -d .tasks/demo ] && [ ! -L .tasks/demo ]
  grep -q '^## Round 1$' .tasks/demo/state.md
  git show-ref --verify --quiet refs/heads/feat/demo
  [ -z "$("$BIN/quorum-state" --task demo get worktree)" ]
}

@test "merged lists a worktree whose commits are all on the default branch" {
  "$BIN/quorum-branch" start demo --worktree >/dev/null
  wt="$ROOT_REAL/.claude/worktrees/demo"
  [ -z "$("$BIN/quorum-branch" merged)" ]
  commit_in "$wt" one
  [ -z "$("$BIN/quorum-branch" merged)" ]
  git merge -q --ff-only feat/demo
  [ "$("$BIN/quorum-branch" merged)" = "$(printf 'demo\t%s' "$wt")" ]
}

@test "the worktree is recorded with symlinks resolved, as --code prints it" {
  ln -s "$ROOT_REAL" "$WORK-link"
  cd "$WORK-link"
  export CLAUDE_PROJECT_DIR="$WORK-link"
  path=$("$BIN/quorum-branch" start demo --worktree | sed -n 2p)
  [ "$path" = "$ROOT_REAL/.claude/worktrees/demo" ]
  [ "$("$BIN/quorum-state" --task demo get worktree)" = "$(cd "$path" && "$BIN/quorum-active-task" --code)" ]
  rm "$WORK-link"
}

@test "falling back: remove the new worktree, then start checks the same branch out in place" {
  "$BIN/quorum-branch" start demo --worktree >/dev/null
  base=$("$BIN/quorum-state" --task demo get base_sha)
  "$BIN/quorum-branch" remove demo >/dev/null
  run "$BIN/quorum-branch" start demo
  [ "$status" -eq 0 ]; [ "$output" = feat/demo ]
  [ "$(git branch --show-current)" = feat/demo ]
  [ "$("$BIN/quorum-state" --task demo get base_sha)" = "$base" ]
  [ -z "$("$BIN/quorum-state" --task demo get worktree)" ]
  [ -z "$(git status --porcelain)" ]
}
