import { describe, it, expect, vi } from 'vitest'
import {
  estimateRiskHint,
  normalizeRegistryServer,
  slugifyRegistryName,
  mapTransportForDb,
  fetchRegistryPage,
  proposeMcpServer,
} from '../mcpRegistry.js'

describe('mcpRegistry D4a', () => {
  it('slugifyRegistryName sanitizes registry names', () => {
    expect(slugifyRegistryName('ai.smithery/github')).toBe('ai-smithery-github')
    expect(slugifyRegistryName('io.github.User/My Server')).toBe('io-github-user-my-server')
  })

  it('estimateRiskHint escalates write-like descriptions', () => {
    expect(estimateRiskHint('read only inbox', [])).toBe('R1')
    expect(estimateRiskHint('create issues', [])).toBe('R2')
    expect(estimateRiskHint('send email and delete', [])).toBe('R3')
  })

  it('normalizeRegistryServer prefers HTTPS remotes', () => {
    const n = normalizeRegistryServer({
      server: {
        name: 'ai.example/demo',
        title: 'Demo',
        description: 'fetch files',
        remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
        packages: [{ transport: { type: 'stdio' } }],
      },
    })
    expect(n?.endpoint).toBe('https://example.com/mcp')
    expect(n?.transport).toBe('streamable-http')
    expect(mapTransportForDb(n!.transport)).toBe('http')
  })

  it('normalizeRegistryServer falls back to stdio package', () => {
    const n = normalizeRegistryServer({
      server: {
        name: 'com.example/fs',
        description: 'local fs',
        packages: [{ transport: { type: 'stdio' }, environmentVariables: [{ name: 'ROOT' }] }],
      },
    })
    expect(n?.transport).toBe('stdio')
    expect(n?.endpoint).toBeNull()
    expect(n?.auth_env_hint).toBe('ROOT')
  })

  it('fetchRegistryPage parses official list shape', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        servers: [
          {
            server: {
              name: 'ai.test/http-tool',
              description: 'http mcp',
              remotes: [{ type: 'http', url: 'https://mcp.test/v1' }],
            },
          },
        ],
      }),
    })) as unknown as typeof fetch

    const rows = await fetchRegistryPage('https://registry.example', 'http', { fetchFn })
    expect(rows).toHaveLength(1)
    expect(rows[0].slug).toBe('ai.test/http-tool')
    expect(rows[0].endpoint).toBe('https://mcp.test/v1')
  })

  it('proposeMcpServer rejects non-HTTPS endpoints', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }
    await expect(
      proposeMcpServer(supabase as never, 'user-1', {
        slug: 'x/y',
        name: 'Y',
        description: null,
        transport: 'stdio',
        endpoint: null,
        homepage: null,
        auth_env_hint: null,
        risk_hint: 'R1',
      }),
    ).rejects.toThrow(/HTTPS remote/)
  })
})
