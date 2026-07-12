# Sunucu Dağıtımı — Ubuntu + GitHub Actions CI/CD

**Tarih:** 2026-06-11 · **Sebep:** Vercel Hobby 12 serverless function limiti.
**Adres:** https://agentarmy.techmorainvest.com (Let's Encrypt) · **API portu:** 3006 (yalnız localhost, nginx arkasında)
**Mimari:** Nginx (statik SPA + `/api` reverse proxy) → Express API (tsx, port 3006, systemd) → Worker loop (systemd, sürekli) → Tick'ler (systemd timer). Worker'lar sunucuya taşındı: 15 dk GitHub Actions gecikmesi ve her koşuda dotnet build tekrarı ortadan kalktı.

**DNS + SSL:** Önce `agentarmy.techmorainvest.com` A kaydını sunucu IP'sine yönlendir. Kurulumdan sonra:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d agentarmy.techmorainvest.com   # 443 bloğu + http→https otomatik
```

```
GitHub push (main)
  └─ deploy.yml: test job (dotnet test + vitest + tsc) → SSH → /opt/agentarmy/deploy.sh
       └─ git pull → npm ci + vite build → dotnet build → systemctl restart → health check

Sunucu (Ubuntu):
  nginx :80/:443
        ├─ /api/           → 127.0.0.1:3006 (agentarmy-api)
        ├─ /.well-known/   → 127.0.0.1:3006 (D4b Agent Card; snippet her deploy’da sync)
        └─ /               → portal/dist (SPA fallback)
            └─ /api/        → 127.0.0.1:3001 (agentarmy-api.service)
  agentarmy-worker.service   → runRequestWorkerLoop (10 sn aralık, DOTNET_NO_BUILD)
  agentarmy-tick@*.timer     → schedulerTick + operationLoopTick (5dk),
                               stockMonitorTick (15dk), selfReflectionTick (02:00 UTC)
```

## 1. İlk kurulum (sunucuda, bir kez)

```bash
# Deploy key veya HTTPS token'lı repo URL'i ile:
sudo REPO_URL=git@github.com:KULLANICI/ai_agent.git bash <(curl -fsSL ...) # veya repoyu indirip:
sudo REPO_URL=... bash deploy/server-setup.sh
```

Script: nginx + Node 20 + .NET 8 SDK kurar, `agentarmy` kullanıcısı + `/opt/agentarmy/app` clone'u, systemd üniteleri, nginx site'ı ve `/opt/agentarmy/deploy.sh`'i yerleştirir.

Sonra iki env dosyasını doldur:

1. `/etc/agentarmy.env` — şablon: `deploy/agentarmy.env.example` (service role key, OpenAI vb.)
2. `/opt/agentarmy/app/portal/.env.local` — `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (Vite build'e gömülür; **anon** key, service role DEĞİL)

İlk deploy: `sudo /opt/agentarmy/deploy.sh`

## 2. CI kullanıcısı ve GitHub Secrets

Sunucuda deploy için ayrı kullanıcı önerilir (veya mevcut kullanıcın):

```bash
# CI'nin SSH key'i ile girip yalnız deploy.sh'i sudo'layabilmesi:
sudo visudo  # şu satırı ekle:
#   deployuser ALL=(ALL) NOPASSWD: /opt/agentarmy/deploy.sh
```

GitHub repo → Settings → Secrets and variables → Actions:

| Secret | Değer |
|---|---|
| `DEPLOY_SSH_HOST` | Sunucu IP'si |
| `DEPLOY_SSH_USER` | SSH kullanıcısı (ör. deployuser) |
| `DEPLOY_SSH_KEY` | O kullanıcının **private** SSH anahtarı |
| `DEPLOY_SSH_PORT` | (opsiyonel) 22 dışıysa |

Push → main: `deploy.yml` önce testleri koşar, geçerse SSH ile `deploy.sh`'i çalıştırır, `/api/health` + `/.well-known/agent-card.json` smoke doğrular.

## 3. Eski cron workflow'ları

Worker + tick'ler artık sunucuda. Çakışmayı (çift tetik) önlemek için şu workflow'ların `schedule:` bloklarını kaldır (dosyalar `workflow_dispatch` ile manuel yedek olarak kalabilir):

- `agent-worker.yml` · `scheduler-tick.yml` · `stock-monitor.yml` · `self-reflection.yml` · `operation-loop.yml`

`ci.yml` (test) ve `deploy.yml` aynen kalır.

## 4. İşletme komutları

```bash
systemctl status agentarmy-api agentarmy-worker     # durum
journalctl -u agentarmy-api -f                      # API log (canlı)
journalctl -u agentarmy-worker -f                   # worker log — dotnet çıktıları burada
systemctl list-timers 'agentarmy-*'                 # tick zamanlamaları
systemctl start agentarmy-tick@operationLoopTick    # bir tick'i elle tetikle
sudo /opt/agentarmy/deploy.sh                       # elle deploy
```

## 5. Notlar / bilinçli kararlar

- **API anahtarları DB'de TUTULMAZ (bilinçli karar):** PR10 tasarımı `llm_providers.api_key_env` ile anahtarın *adını* DB'de, *kendisini* `/etc/agentarmy.env`'de (chmod 600) tutar. Gerekçe: DB yedekleri/dump'ları sır sızdırır; RLS hatası tüm anahtarları açar; anahtarlar üçüncü taraf SaaS'ta (Supabase) durmuş olur; ve DB'yi okumak için zaten env'de bir sır (service role key) gerekir — sırrı sırla korumak zinciri env'de bitirmeyi gerektirir. Yeni provider eklemek: anahtarı env dosyasına yaz, DB kaydına yalnız env adını gir.
- **tsx ile koşum:** API/worker TypeScript'i derlenmeden tsx ile çalışır (Vercel öncesi yerel desenle aynı). İleride istenirse `tsc` build + node'a geçilebilir; systemd ünitelerinde tek satır değişir.
- **`DOTNET_NO_BUILD=true`:** deploy.sh her deploy'da Release build alır; worker her job'da derlemez (GH Actions'taki `--no-incremental` derdi sunucuda yok — tek build noktası deploy).
- **Vercel kalıntıları:** `vercel.json`, `.vercel/`, `portal/api/index.ts` (Vercel handler) artık kullanılmıyor; temizlenebilir (zorunlu değil, zararsız).
- Worker `dotnet run --project` ile repo checkout'undan koşar — bu yüzden sunucuda SDK var ve dağıtım rsync değil git-pull (worker'ın `repoRoot` çözümlemesi aynen çalışır).
