#!/usr/bin/env bash
# AgentArmy — sunucu tarafı deploy script'i.
# CI (deploy.yml) SSH ile bunu çağırır: sudo /opt/agentarmy/deploy.sh
# İlk kurulum: server-setup.sh (bir kez).
set -euo pipefail

APP_DIR=/opt/agentarmy/app
ENV_FILE=/etc/agentarmy.env
BRANCH="${DEPLOY_BRANCH:-main}"
NGINX_SITE=/etc/nginx/sites-available/agentarmy
NGINX_SNIPPET=/etc/nginx/snippets/agentarmy-well-known.conf
NGINX_INCLUDE='include /etc/nginx/snippets/agentarmy-well-known.conf;'

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

[ -f "$ENV_FILE" ] || { echo "HATA: $ENV_FILE yok. server-setup.sh'i çalıştırın."; exit 1; }
[ -f "$APP_DIR/portal/.env.local" ] || { echo "HATA: portal/.env.local yok (VITE_SUPABASE_URL/ANON_KEY). Vite build bunsuz çalışmaz."; exit 1; }

cd "$APP_DIR"

log "git pull ($BRANCH)..."
sudo -u agentarmy git fetch origin "$BRANCH"
sudo -u agentarmy git reset --hard "origin/$BRANCH"

# CI hâlâ eski /opt/agentarmy/deploy.sh çağırıyor olabilir — repo sürümüne yenile + bir kez re-exec
if ! cmp -s "$APP_DIR/deploy/deploy.sh" /opt/agentarmy/deploy.sh 2>/dev/null; then
  log "deploy.sh güncellendi — yeniden başlatılıyor..."
  cp "$APP_DIR/deploy/deploy.sh" /opt/agentarmy/deploy.sh
  chmod +x /opt/agentarmy/deploy.sh
  if [[ "${DEPLOY_REEXEC:-}" != "1" ]]; then
    export DEPLOY_REEXEC=1
    exec /opt/agentarmy/deploy.sh
  fi
fi

log "portal deps + build..."
sudo -u agentarmy npm ci --prefix portal
sudo -u agentarmy npm run build --prefix portal

log "dotnet build (Release)..."
sudo -u agentarmy dotnet build src/AgentArmy.Cli -c Release

# D4b: nginx well-known → API (certbot SSL bloğunu ezmeden snippet + include)
log "nginx well-known snippet sync..."
mkdir -p /etc/nginx/snippets
cp "$APP_DIR/deploy/nginx-snippets/agentarmy-well-known.conf" "$NGINX_SNIPPET"
if [[ -f "$NGINX_SITE" ]] && ! grep -qF 'snippets/agentarmy-well-known.conf' "$NGINX_SITE"; then
  # Her "location / {" öncesine include ekle (http + https server blokları)
  # macOS/BSD sed değil — sunucu GNU sed
  sed -i 's|^\([[:space:]]*\)location / {|\1'"$NGINX_INCLUDE"'\n\1location / {|' "$NGINX_SITE"
  log "nginx site include eklendi"
fi
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  log "nginx reload OK"
else
  log "UYARI: nginx -t başarısız — well-known sync atlandı (manuel kontrol)"
fi

log "servisleri yeniden başlat..."
systemctl restart agentarmy-api agentarmy-worker
# Tick'ler (timer) tsx ile kaynaktan koşar; restart gerekmez.

sleep 3
curl -fsS http://127.0.0.1:3006/api/health >/dev/null && log "health OK" || { log "HEALTH FAIL"; exit 1; }

# D4b: lokal well-known (nginx yoksa bile API dinliyor)
if curl -fsS http://127.0.0.1:3006/.well-known/agent-card.json | head -c 20 | grep -q '{'; then
  log "agent-card.json API OK"
else
  log "UYARI: agent-card.json API yanıtı beklenenden farklı (pack kapalı olabilir)"
fi

log "deploy tamam."
