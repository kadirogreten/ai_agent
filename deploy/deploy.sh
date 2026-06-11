#!/usr/bin/env bash
# AgentArmy — sunucu tarafı deploy script'i.
# CI (deploy.yml) SSH ile bunu çağırır: sudo /opt/agentarmy/deploy.sh
# İlk kurulum: server-setup.sh (bir kez).
set -euo pipefail

APP_DIR=/opt/agentarmy/app
ENV_FILE=/etc/agentarmy.env
BRANCH="${DEPLOY_BRANCH:-main}"

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

[ -f "$ENV_FILE" ] || { echo "HATA: $ENV_FILE yok. server-setup.sh'i çalıştırın."; exit 1; }
[ -f "$APP_DIR/portal/.env.local" ] || { echo "HATA: portal/.env.local yok (VITE_SUPABASE_URL/ANON_KEY). Vite build bunsuz çalışmaz."; exit 1; }

cd "$APP_DIR"

log "git pull ($BRANCH)..."
sudo -u agentarmy git fetch origin "$BRANCH"
sudo -u agentarmy git reset --hard "origin/$BRANCH"

log "portal deps + build..."
sudo -u agentarmy npm ci --prefix portal
sudo -u agentarmy npm run build --prefix portal

log "dotnet build (Release)..."
sudo -u agentarmy dotnet build src/AgentArmy.Cli -c Release

log "servisleri yeniden başlat..."
systemctl restart agentarmy-api agentarmy-worker
# Tick'ler (timer) tsx ile kaynaktan koşar; restart gerekmez.

sleep 3
curl -fsS http://127.0.0.1:3006/api/health >/dev/null && log "health OK" || { log "HEALTH FAIL"; exit 1; }
log "deploy tamam."
