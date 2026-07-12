#!/usr/bin/env bash
# AgentArmy — Ubuntu sunucu İLK kurulum script'i (bir kez, root/sudo ile).
# Kullanım: sudo REPO_URL=git@github.com:KULLANICI/ai_agent.git bash server-setup.sh
set -euo pipefail

REPO_URL="${REPO_URL:?REPO_URL ver: sudo REPO_URL=... bash server-setup.sh}"
APP_DIR=/opt/agentarmy/app

echo "== Paketler (nginx, git, curl) =="
apt-get update -y
apt-get install -y nginx git curl ca-certificates

echo "== Node 20 =="
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "== .NET 8 SDK =="
if ! command -v dotnet >/dev/null; then
  add-apt-repository -y ppa:dotnet/backports 2>/dev/null || true
  apt-get update -y
  apt-get install -y dotnet-sdk-8.0
fi

echo "== agentarmy kullanıcısı + dizinler =="
id -u agentarmy >/dev/null 2>&1 || useradd -r -m -d /opt/agentarmy -s /bin/bash agentarmy
mkdir -p /opt/agentarmy
chown agentarmy:agentarmy /opt/agentarmy

echo "== Repo clone =="
if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u agentarmy git clone "$REPO_URL" "$APP_DIR"
fi

echo "== Env dosyaları =="
if [ ! -f /etc/agentarmy.env ]; then
  cp "$APP_DIR/deploy/agentarmy.env.example" /etc/agentarmy.env
  chmod 600 /etc/agentarmy.env
  echo "!! /etc/agentarmy.env oluşturuldu — DOLDURUN."
fi
if [ ! -f "$APP_DIR/portal/.env.local" ]; then
  sudo -u agentarmy cp "$APP_DIR/portal/.env.example" "$APP_DIR/portal/.env.local" 2>/dev/null || \
    sudo -u agentarmy bash -c "printf 'VITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n' > $APP_DIR/portal/.env.local"
  echo "!! portal/.env.local oluşturuldu — VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY doldurun."
fi

echo "== systemd üniteleri =="
cp "$APP_DIR"/deploy/systemd/*.service "$APP_DIR"/deploy/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable agentarmy-api agentarmy-worker
systemctl enable --now \
  agentarmy-tick@schedulerTick.timer \
  agentarmy-tick@operationLoopTick.timer \
  agentarmy-tick@stockMonitorTick.timer \
  agentarmy-tick@selfReflectionTick.timer

echo "== nginx =="
mkdir -p /etc/nginx/snippets
cp "$APP_DIR/deploy/nginx-snippets/agentarmy-well-known.conf" /etc/nginx/snippets/agentarmy-well-known.conf
cp "$APP_DIR/deploy/nginx-agentarmy.conf" /etc/nginx/sites-available/agentarmy
ln -sf /etc/nginx/sites-available/agentarmy /etc/nginx/sites-enabled/agentarmy
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "== deploy.sh yerleştir =="
cp "$APP_DIR/deploy/deploy.sh" /opt/agentarmy/deploy.sh
chmod +x /opt/agentarmy/deploy.sh

echo ""
echo "Kurulum bitti. Sıradaki adımlar:"
echo "  1. /etc/agentarmy.env ve $APP_DIR/portal/.env.local dosyalarını doldur"
echo "  2. sudo /opt/agentarmy/deploy.sh   (ilk build + servis start)"
echo "  3. CI kullanıcısına sudo izni: visudo ->"
echo "     deployuser ALL=(ALL) NOPASSWD: /opt/agentarmy/deploy.sh"
