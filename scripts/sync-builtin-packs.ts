#!/usr/bin/env tsx
/**
 * scripts/sync-builtin-packs.ts
 *
 * domain-packs/ klasöründeki built-in (system) pack'leri Supabase DB'ye yükler.
 * tenant_id = NULL → tüm tenant'lara görünür (built-in).
 *
 * Kullanım:
 *   cd <repo-root>
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   npx tsx scripts/sync-builtin-packs.ts
 *
 * Veya portal/.env okumak için:
 *   npx tsx scripts/sync-builtin-packs.ts --env portal/.env
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── env yükleme ──────────────────────────────────────────────
const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
if (envFlag !== -1 && args[envFlag + 1]) {
  const envPath = path.resolve(process.cwd(), args[envFlag + 1]);
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    console.log(`✅ .env yüklendi: ${envPath}`);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
  console.error('   Kullanım: npx tsx scripts/sync-builtin-packs.ts --env portal/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false }
});

// ── yardımcılar ──────────────────────────────────────────────
// Script'in kendi konumundan repo kökünü bul
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO_ROOT  = path.resolve(SCRIPT_DIR, '..');
const PACKS_DIR  = process.env.PACKS_DIR ?? path.join(REPO_ROOT, 'domain-packs');

function readFileSafe(filePath: string): string | null {
  try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null; }
  catch { return null; }
}

function readJsonSafe<T>(filePath: string): T | null {
  const txt = readFileSafe(filePath);
  if (!txt) return null;
  try { return JSON.parse(txt) as T; }
  catch (e) {
    console.warn(`  ⚠️  JSON parse hatası: ${filePath} — ${e}`);
    return null;
  }
}

interface PackJson {
  version: number;
  id: string;
  name: string;
  description?: string;
  allowedDomainsFile?: string;
  glossaryFile?: string | null;
  regulatoryNotesFile?: string | null;
  verifierRubricFile?: string | null;
  playbooksDirectory?: string;
  bundlesDirectory?: string;
}

interface PlaybookJson {
  version: number;
  id: string;
  title?: string;
  name?: string;
  defaultPersona?: string;
  defaultRisk?: string;
  steps?: unknown[];
  requiredTools?: string[];
  tags?: string[];
  [key: string]: unknown;
}

interface BundleJson {
  version: number;
  id: string;
  title?: string;
  name?: string;
  playbooks?: string[];
  defaultRisk?: string;
  [key: string]: unknown;
}

// ── ana iş ───────────────────────────────────────────────────
async function syncPack(packDir: string): Promise<void> {
  const packJsonPath = path.join(packDir, 'pack.json');
  if (!fs.existsSync(packJsonPath)) return;

  const pack = readJsonSafe<PackJson>(packJsonPath);
  if (!pack) { console.warn(`  ⚠️  pack.json okunamadı: ${packDir}`); return; }

  const packId = pack.id;
  console.log(`\n📦 Pack: ${packId} (${pack.name})`);

  // Yan dosyalar
  const allowedDomains: string[] = pack.allowedDomainsFile
    ? (readFileSafe(path.join(packDir, pack.allowedDomainsFile)) ?? '')
        .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    : [];

  const glossaryMd         = pack.glossaryFile
    ? readFileSafe(path.join(packDir, pack.glossaryFile)) : null;
  const regulatoryNotesMd  = pack.regulatoryNotesFile
    ? readFileSafe(path.join(packDir, pack.regulatoryNotesFile)) : null;
  const verifierRubricMd   = pack.verifierRubricFile
    ? readFileSafe(path.join(packDir, pack.verifierRubricFile)) : null;

  // domain_packs upsert
  const { error: packErr } = await supabase.from('domain_packs').upsert({
    id:                   packId,
    name:                 pack.name,
    description:          pack.description ?? null,
    tenant_id:            null,          // built-in = NULL
    status:               'active',
    version:              pack.version ?? 1,
    allowed_domains:      allowedDomains,
    glossary_md:          glossaryMd,
    regulatory_notes_md:  regulatoryNotesMd,
    verifier_rubric_md:   verifierRubricMd,
    meta:                 {},
  }, { onConflict: 'id' });

  if (packErr) { console.error(`  ❌ domain_packs upsert: ${packErr.message}`); return; }
  console.log(`  ✅ domain_pack upsert OK`);

  // ── Playbooks ──────────────────────────────────────────────
  const playbooksDir = path.join(packDir, pack.playbooksDirectory ?? 'playbooks');
  if (fs.existsSync(playbooksDir)) {
    const pbFiles = fs.readdirSync(playbooksDir).filter(f => f.endsWith('.json'));
    console.log(`  📄 ${pbFiles.length} playbook dosyası`);

    for (const pbFile of pbFiles) {
      const pb = readJsonSafe<PlaybookJson>(path.join(playbooksDir, pbFile));
      if (!pb) continue;

      const slug = pb.id ?? path.basename(pbFile, '.json');
      const { error } = await supabase.from('playbooks').upsert({
        slug,
        pack_id:        packId,
        tenant_id:      null,
        name:           pb.title ?? pb.name ?? slug,
        description:    pb.description as string ?? null,
        goal:           pb.goal as string ?? null,
        steps:          pb.steps ?? [],
        default_risk:   pb.defaultRisk ?? 'R1',
        required_tools: pb.requiredTools ?? [],
        tags:           pb.tags ?? [],
        content_json:   pb as unknown as Record<string, unknown>,
        version:        pb.version ?? 1,
        meta:           {},
      }, { onConflict: 'slug,pack_id,tenant_id' });

      if (error) console.error(`    ❌ playbook upsert (${slug}): ${error.message}`);
      else       console.log(`    ✅ playbook: ${slug}`);
    }
  }

  // ── Bundles ────────────────────────────────────────────────
  const bundlesDir = path.join(packDir, pack.bundlesDirectory ?? 'bundles');
  if (fs.existsSync(bundlesDir)) {
    const bFiles = fs.readdirSync(bundlesDir).filter(f => f.endsWith('.json'));
    console.log(`  📦 ${bFiles.length} bundle dosyası`);

    for (const bFile of bFiles) {
      const b = readJsonSafe<BundleJson>(path.join(bundlesDir, bFile));
      if (!b) continue;

      const slug = b.id ?? path.basename(bFile, '.json');

      // Yüksek risk sınıfını playbook_slugs'tan hesapla (playbook tablosu zaten dolu)
      const riskRank = (r: string) => ({ R0: 0, R1: 1, R2: 2, R3: 3 }[r] ?? 1);
      let bundleRisk = b.defaultRisk ?? 'R1';

      if (b.playbooks?.length) {
        // Sadece rank hesaplama — DB okumak yerine dosya bazlı not alıyoruz
        // (Bu senkron bloğu basit tutuyoruz; DB zaten güncel)
        bundleRisk = b.defaultRisk ?? 'R1';
      }

      const { error } = await supabase.from('playbook_bundles').upsert({
        slug,
        pack_id:        packId,
        tenant_id:      null,
        name:           b.title ?? b.name ?? slug,
        description:    b.description as string ?? null,
        playbook_slugs: b.playbooks ?? [],
        default_risk:   bundleRisk,
        content_json:   b as unknown as Record<string, unknown>,
        version:        b.version ?? 1,
        meta:           {},
      }, { onConflict: 'slug,pack_id,tenant_id' });

      if (error) console.error(`    ❌ bundle upsert (${slug}): ${error.message}`);
      else       console.log(`    ✅ bundle: ${slug}`);
    }
  }
}

async function main() {
  console.log('🚀 Built-in domain pack sync başlıyor...');
  console.log(`   Klasör: ${PACKS_DIR}`);
  console.log(`   Supabase: ${SUPABASE_URL}`);

  if (!fs.existsSync(PACKS_DIR)) {
    console.error(`❌ domain-packs klasörü bulunamadı: ${PACKS_DIR}`);
    process.exit(1);
  }

  const packDirs = fs.readdirSync(PACKS_DIR)
    .map(d => path.join(PACKS_DIR, d))
    .filter(d => fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'pack.json')));

  console.log(`   ${packDirs.length} pack klasörü bulundu.\n`);

  for (const packDir of packDirs) {
    await syncPack(packDir);
  }

  console.log('\n✅ Sync tamamlandı.');
}

main().catch(e => {
  console.error('❌ Beklenmeyen hata:', e);
  process.exit(1);
});
