#!/usr/bin/env npx tsx
/**
 * Mock Meta Social MCP sunucusu (PR-S2).
 *
 * Kullanım:
 *   npx tsx scripts/mock-meta-mcp.ts
 *
 * Endpoint: http://127.0.0.1:3847/mcp (mcp_servers seed ile eşleşir).
 * Gerçek Meta API'ye geçişte (PR-S7) mcp_servers.endpoint UPDATE migration ile
 * değiştirilir — bu script yalnızca lokal test içindir.
 *
 * Env: META_MCP_PORT (varsayılan 3847)
 */

import http from 'node:http';

const PORT = Number.parseInt(process.env.META_MCP_PORT ?? '3847', 10);
const PATH = '/mcp';

const POST_PUBLISH_RESULT = {
  post_id: 'meta_demo_123',
  url: 'https://facebook.com/demo/posts/123',
  platform: 'facebook',
  status: 'published',
};

const TOOLS_LIST = {
  tools: [
    {
      name: 'post_publish',
      description: 'Publish an approved post draft to Meta (Facebook/Instagram).',
      inputSchema: {
        type: 'object',
        required: ['platform', 'text'],
        properties: {
          platform: { type: 'string', enum: ['facebook', 'instagram'] },
          text: { type: 'string' },
          media_url: { type: 'string' },
        },
      },
    },
  ],
};

function jsonRpc(id: number | null, result: unknown) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id: number | null, code: number, message: string) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

function handleRpc(body: {
  jsonrpc?: string;
  id?: number | null;
  method?: string;
  params?: Record<string, unknown>;
}): string {
  const { id = null, method, params } = body;

  if (method === 'initialize') {
    return jsonRpc(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-meta-social', version: '1.0.0' },
    });
  }

  if (method === 'notifications/initialized') {
    return '';
  }

  if (method === 'tools/list') {
    return jsonRpc(id, TOOLS_LIST);
  }

  if (method === 'tools/call') {
    const name = params?.name as string | undefined;
    if (name === 'post_publish') {
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      return jsonRpc(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ...POST_PUBLISH_RESULT,
              platform: args.platform ?? POST_PUBLISH_RESULT.platform,
            }),
          },
        ],
        result: {
          ...POST_PUBLISH_RESULT,
          platform: args.platform ?? POST_PUBLISH_RESULT.platform,
        },
      });
    }
    return jsonRpcError(id, -32601, `Unknown tool: ${name ?? '(missing)'}`);
  }

  return jsonRpcError(id, -32601, `Method not found: ${method ?? '(missing)'}`);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== PATH) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : {};
      const response = handleRpc(body);
      if (!response) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(response);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(jsonRpcError(null, -32700, `Parse error: ${(e as Error).message}`));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-meta-mcp] listening on http://127.0.0.1:${PORT}${PATH}`);
  console.log('[mock-meta-mcp] tools: post_publish →', POST_PUBLISH_RESULT);
});
