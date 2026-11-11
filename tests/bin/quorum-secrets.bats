#!/usr/bin/env bats
load ../helpers

setup() { make_repo; }
teardown() { cleanup_repo; }

# Values shaped like real secrets, assembled at run time so this file holds none.
repeat() { printf "$1%.0s" $(seq "$2"); }

@test "path: credential files, but not their examples or public keys" {
  for p in .env .env.production app/.env.local id_ed25519 server.pem tls.key cert.p12 .npmrc .netrc .git-credentials \
           "$HOME/.aws/credentials" gcp/service-account-ci.json aws-credentials.json; do
    "$BIN/quorum-secrets" path "$p" || { echo "missed $p"; return 1; }
  done
  for p in .env.example .env.sample .env.template id_ed25519.pub README.md src/credentials.ts environment.ts; do
    ! "$BIN/quorum-secrets" path "$p" || { echo "flagged $p"; return 1; }
  done
}

@test "staged: each kind of secret on an added line, by file:line and kind only" {
  {
    echo "ok = 1"
    printf -- '-----BEGIN RSA PRIVATE %s-----\n' KEY
    printf 'token = "ghp_%s"\n' "$(repeat a 36)"
    printf 'slack = "xoxb-%s"\n' "$(repeat 1 12)"
    printf 'stripe = "sk_live_%s"\n' "$(repeat b 24)"
    printf 'claude = "sk-ant-%s"\n' "$(repeat c 24)"
    printf 'DB_PASSWORD: "%s"\n' "$(repeat d 16)"
    printf 'password = "short"\n'
  } > settings.py
  git add settings.py
  run "$BIN/quorum-secrets" staged
  [ "$status" -eq 1 ]
  [ "${lines[0]}" = "settings.py:2: private key" ]
  [ "${lines[1]}" = "settings.py:3: GitHub token" ]
  [ "${lines[2]}" = "settings.py:4: Slack token" ]
  [ "${lines[3]}" = "settings.py:5: Stripe live key" ]
  [ "${lines[4]}" = "settings.py:6: Anthropic API key" ]
  [[ "${lines[5]}" == "settings.py:7: possible secret"* ]]
  [ "${#lines[@]}" -eq 6 ]
  [[ "$output" != *"$(repeat a 36)"* ]]
}

@test "staged: nothing staged, or nothing secret, exits 0; lines already committed aren't rescanned" {
  run "$BIN/quorum-secrets" staged; [ "$status" -eq 0 ]
  printf 'key = "AKIA%s"\n' "$(repeat Q 16)" > old.py
  git add old.py && git -c user.name=t -c user.email=t@example.com commit -qm old
  echo 'x = 2' >> old.py && git add old.py
  run "$BIN/quorum-secrets" staged; [ "$status" -eq 0 ]
}
