/**
 * portal/.env.local dosyasını process.env'e yükler (repo kökünden çalışan script'ler için).
 * Mevcut ortam değişkenlerinin üzerine yazmaz.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function loadPortalEnv(): string {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const envPath = path.join(repoRoot, 'portal', '.env.local')

  if (!existsSync(envPath)) return envPath

  const text = readFileSync(envPath, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }

  // Vite prefix fallback
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL
  }

  return envPath
}
