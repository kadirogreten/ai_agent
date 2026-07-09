#!/usr/bin/env npx tsx
/**
 * D2 Ops runbook — otomatik doğrulama (A1 + A4).
 * A3 9 adımlı UI demosu canlı ortamda manuel koşulur; bu script şema + regresyon kapısıdır.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd: string, args: string[], cwd = repoRoot) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

console.log('=== Ops Runbook Check (A1 + A4) ===\n')

console.log('[A1] supabase db push...')
run('supabase', ['db', 'push'], repoRoot)

console.log('\n[A4] dotnet test...')
run('dotnet', ['test', 'tests/AgentArmy.Cli.Tests', '-c', 'Release', '--no-restore'], repoRoot)

console.log('\n[A4] portal vitest...')
run('npm', ['test'], path.join(repoRoot, 'portal'))

console.log('\n[A4] evals structural...')
run('npm', ['run', 'evals'], path.join(repoRoot, 'portal'))

console.log('\n=== Ops runbook otomatik kapılar YEŞİL ===')
console.log('A3 (9 adımlı sektör pack demo) için portal worker + canlı UI checklist manuel doğrulanmalı.')
