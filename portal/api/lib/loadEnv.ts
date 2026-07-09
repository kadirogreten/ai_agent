/**
 * CLI worker/tick script'leri için portal/.env.local yüklemesi.
 * Express app (api/app.ts) kendi dotenv'ini kullanır; bu modül paylaşımlıdır.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const portalRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

dotenv.config({ path: path.join(portalRoot, '.env.local') })
dotenv.config({ path: path.join(portalRoot, '.env') })

if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL
}
