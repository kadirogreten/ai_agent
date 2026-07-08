#!/usr/bin/env npx tsx
/**
 * PR-S7b: Meta Social MCP — gerçek Graph API + demo fallback.
 *
 * Kullanım:
 *   npx tsx scripts/meta-social-mcp.ts
 *
 * Env:
 *   META_MCP_PORT (3847)
 *   SOCIAL_API_MODE=demo → Graph çağrısı yok (mock yanıt)
 *   Authorization: Bearer <token> (CredentialResolver / META_ACCESS_TOKEN)
 *   META_PAGE_ID — Facebook sayfa yayını için (opsiyonel, demo fallback)
 */

import http from 'node:http';

const PORT = Number.parseInt(process.env.META_MCP_PORT ?? '3847', 10);
const PATH = '/mcp';
const GRAPH = 'https://graph.facebook.com/v21.0';

const DEMO_MODE = (process.env.SOCIAL_API_MODE ?? '').toLowerCase() === 'demo';

const TOOLS_LIST = {
  tools: [
    {
      name: 'post_publish',
      description: 'Publish post to Meta (Facebook Page / Instagram).',
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
    {
      name: 'post_delete',
      description: 'Delete a published post (compensation).',
      inputSchema: {
        type: 'object',
        required: ['post_id'],
        properties: { post_id: { type: 'string' } },
      },
    },
    {
      name: 'reply_delete',
      description: 'Delete a comment/reply (compensation).',
      inputSchema: {
        type: 'object',
        required: ['reply_id'],
        properties: { reply_id: { type: 'string' } },
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

function getBearer(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

async function graphDelete(path: string, token: string) {
  const url = `${GRAPH}${path}?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: 'DELETE' });
  const json = await res.json() as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Graph HTTP ${res.status}`);
  return json;
}

async function graphPost(path: string, token: string, body?: Record<string, string>) {
  const url = `${GRAPH}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
    body: body ? new URLSearchParams(body) : undefined,
  });
  const json = await res.json() as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Graph HTTP ${res.status}`);
  return json;
}

async function handlePostPublish(args: Record<string, unknown>, token: string | null) {
  const platform = String(args.platform ?? 'facebook');
  const text     = String(args.text ?? '');

  if (DEMO_MODE || !token) {
    return {
      post_id: `meta_demo_${Date.now()}`,
      url: `https://facebook.com/demo/posts/${Date.now()}`,
      platform,
      status: 'published',
      mode: 'demo',
    };
  }

  const pageId = process.env.META_PAGE_ID;
  if (!pageId) {
    return {
      post_id: `meta_stub_${Date.now()}`,
      url: null,
      platform,
      status: 'published',
      mode: 'stub',
      note: 'META_PAGE_ID eksik — gerçek yayın için sayfa kimliği gerekli',
    };
  }

  if (platform === 'facebook') {
    const result = await graphPost(`/${pageId}/feed`, token, { message: text });
    const postId = String(result.id ?? '');
    return {
      post_id: postId,
      url: `https://facebook.com/${postId}`,
      platform,
      status: 'published',
      mode: 'live',
    };
  }

  // Instagram: basit stub (IG container flow App Review sonrası genişletilir)
  return {
    post_id: `ig_stub_${Date.now()}`,
    platform,
    status: 'published',
    mode: 'stub',
    note: 'Instagram publish container flow PR sonrası',
  };
}

async function handlePostDelete(args: Record<string, unknown>, token: string | null) {
  const postId = String(args.post_id ?? '');
  if (!postId) throw new Error('post_id zorunlu');

  if (DEMO_MODE || !token || postId.startsWith('meta_demo_') || postId.startsWith('meta_stub_')) {
    return { post_id: postId, deleted: true, mode: 'demo' };
  }

  await graphDelete(`/${postId}`, token);
  return { post_id: postId, deleted: true, mode: 'live' };
}

async function handleReplyDelete(args: Record<string, unknown>, token: string | null) {
  const replyId = String(args.reply_id ?? '');
  if (!replyId) throw new Error('reply_id zorunlu');

  if (DEMO_MODE || !token || replyId.startsWith('reply_')) {
    return { reply_id: replyId, deleted: true, mode: 'demo' };
  }

  await graphDelete(`/${replyId}`, token);
  return { reply_id: replyId, deleted: true, mode: 'live' };
}

async function handleToolCall(name: string, args: Record<string, unknown>, token: string | null) {
  switch (name) {
    case 'post_publish': return handlePostPublish(args, token);
    case 'post_delete':  return handlePostDelete(args, token);
    case 'reply_delete': return handleReplyDelete(args, token);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function handleRpc(
  body: { jsonrpc?: string; id?: number | null; method?: string; params?: Record<string, unknown> },
  token: string | null,
): Promise<string> {
  const { id = null, method, params } = body;

  if (method === 'initialize') {
    return Promise.resolve(jsonRpc(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'meta-social-mcp', version: '1.0.0' },
    }));
  }

  if (method === 'notifications/initialized') {
    return Promise.resolve('');
  }

  if (method === 'tools/list') {
    return Promise.resolve(jsonRpc(id, TOOLS_LIST));
  }

  if (method === 'tools/call') {
    const name = params?.name as string | undefined;
    const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
    return handleToolCall(name ?? '', toolArgs, token)
      .then((result) => jsonRpc(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        result,
      }))
      .catch((e: Error) => jsonRpcError(id, -32000, e.message));
  }

  return Promise.resolve(jsonRpcError(id, -32601, `Method not found: ${method ?? '(missing)'}`));
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== PATH) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const token = getBearer(req);
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    void (async () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? JSON.parse(raw) as { id?: number | null; method?: string; params?: Record<string, unknown> } : {};
        const response = await handleRpc(body, token);
        if (!response) {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(response);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    })();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`[meta-social-mcp] http://127.0.0.1:${PORT}${PATH} demo=${DEMO_MODE}`);
});
