#!/usr/bin/env bash
# PR-S7: Token sızıntısı grep kanıtı — düz metin bearer/token loglama yasak.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATTERNS='(access_token|refresh_token|app_secret|Bearer [A-Za-z0-9._-]{20,})'
EXCLUDES='--glob !**/*.md --glob !**/.env* --glob !**/check-token-leakage.sh'

TARGETS=(
  "$ROOT/src/AgentArmy.Cli"
  "$ROOT/portal/api"
)

FAIL=0
for dir in "${TARGETS[@]}"; do
  if rg -n "$PATTERNS" $EXCLUDES "$dir" \
    | rg -v 'access_token_ciphertext|refresh_token_ciphertext|access_token\?|oauth/access_token|tokenJson|longJson|json\.access_token|accessToken|encodeURIComponent|META_ACCESS_TOKEN|auth_env|Authorization header|Bearer provider|Bearer <|getBearerToken|resolveBearer|encryptToken|decryptToken|compensation_token|api_key_env|EscapeDataString|app_secret_ciphertext|app_secret\?|appSecret|APP_SECRET|body\.app_secret|app_secret zorunlu|app_secret\x27|not\.toContain' \
    ; then
    echo "[token-leakage] Şüpheli eşleşme: $dir" >&2
    FAIL=1
  fi
done

if [[ $FAIL -eq 0 ]]; then
  echo "[token-leakage] OK — hedef dizinlerde düz metin token logu yok."
fi
exit $FAIL
