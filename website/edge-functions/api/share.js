/**
 * 在线日程分享托管接口（只读快照 JSON）。
 *
 * 协议：
 * - GET    /api/share?id=<shareId>
 *          返回 { payload, updatedAt, expiresAt }，带 X-Robots-Tag: noindex, nofollow。
 * - PUT    /api/share
 *          Body: { shareId, writeToken, ttlSeconds?, payload }
 *          校验 writeToken 的 SHA-256 哈希与体积限制（<= 64KB）后写入 EdgeOne KV。
 * - DELETE /api/share
 *          Body: { shareId, writeToken }
 *          校验 writeToken 后立即从 KV 删除。
 *
 * 隐私设计：
 * - 与 webcal:// 订阅 Token 完全隔离，使用独立的 shareId + writeToken；
 * - 服务端不接触任何教务凭据，仅托管客户端生成的只读日程快照；
 * - writeToken 以 SHA-256 哈希保存，防止第三方覆写或撤销他人分享。
 */

const SHARE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const WRITE_TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;
const MAX_SHARE_BYTES = 64 * 1024; // 64 KB
const MIN_TTL_SECONDS = 3600; // 1 hour
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days max
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const ALLOWED_ORIGINS = new Set([
  'https://ysu.welain.com',
  'http://localhost:3000',
  'http://localhost:4321',
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
]);

function resolveKv(env) {
  return (
    env?.CALENDAR_KV ??
    globalThis?.CALENDAR_KV ??
    env?.STATS_KV ??
    globalThis?.STATS_KV ??
    null
  );
}

function resolveOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (!ALLOWED_ORIGINS.has(origin)) return 'DENY';
  return origin;
}

function corsHeaders(origin) {
  return origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    : {};
}

function jsonResponse(status, body, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const ba = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ba.length ^ bb.length;
  const len = Math.max(ba.length, bb.length, 1);
  for (let i = 0; i < len; i += 1) {
    diff |= (ba.length ? ba[i % ba.length] : 0) ^ (bb.length ? bb[i % bb.length] : 0);
  }
  return diff === 0;
}

function clampTtlSeconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TTL_SECONDS;
  }
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.round(value)));
}

export function onRequestOptions({ request }) {
  const origin = resolveOrigin(request);
  if (origin === 'DENY') {
    return jsonResponse(403, { error: 'origin not allowed' }, null);
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function onRequestGet({ request, env }) {
  const origin = resolveOrigin(request);
  const effectiveOrigin = origin === 'DENY' ? null : origin;

  const kv = resolveKv(env);
  if (!kv) {
    return jsonResponse(503, { error: 'KV not configured' }, effectiveOrigin);
  }

  const url = new URL(request.url);
  const shareId = (url.searchParams.get('id') || '').trim();
  if (!SHARE_ID_RE.test(shareId)) {
    return jsonResponse(400, { error: 'invalid share id' }, effectiveOrigin);
  }

  const record = await kv.get(`share:${shareId}`, 'json');
  if (!record || !record.payload || typeof record.payload !== 'object') {
    return jsonResponse(404, { error: 'share not found' }, effectiveOrigin);
  }
  if (typeof record.expiresAt === 'number' && Date.now() > record.expiresAt) {
    return jsonResponse(404, { error: 'share expired' }, effectiveOrigin);
  }

  return jsonResponse(
    200,
    {
      payload: record.payload,
      updatedAt: record.updatedAt ?? null,
      expiresAt: record.expiresAt ?? null,
    },
    effectiveOrigin,
    { 'Cache-Control': 'public, max-age=60' }
  );
}

export async function onRequestPut({ request, env }) {
  const origin = resolveOrigin(request);
  if (origin === 'DENY') {
    return jsonResponse(403, { error: 'origin not allowed' }, null);
  }

  const kv = resolveKv(env);
  if (!kv) {
    return jsonResponse(503, { error: 'KV not configured' }, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' }, origin);
  }

  const shareId = typeof body?.shareId === 'string' ? body.shareId.trim() : '';
  const writeToken = typeof body?.writeToken === 'string' ? body.writeToken.trim() : '';
  const payload = body?.payload;

  if (!SHARE_ID_RE.test(shareId) || !WRITE_TOKEN_RE.test(writeToken)) {
    return jsonResponse(400, { error: 'invalid shareId or writeToken' }, origin);
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    payload.version !== 1 ||
    !Array.isArray(payload.items)
  ) {
    return jsonResponse(400, { error: 'invalid schedule share payload' }, origin);
  }

  const serializedPayload = JSON.stringify(payload);
  const byteLength = new TextEncoder().encode(serializedPayload).byteLength;
  if (byteLength > MAX_SHARE_BYTES) {
    return jsonResponse(413, { error: 'share payload exceeds 64KB limit' }, origin);
  }

  const key = `share:${shareId}`;
  const writeHash = await sha256Hex(writeToken);
  const existing = await kv.get(key, 'json');
  if (existing && typeof existing.writeHash === 'string') {
    if (!timingSafeEqual(existing.writeHash, writeHash)) {
      return jsonResponse(403, { error: 'write token mismatch' }, origin);
    }
  }

  const ttlSeconds = clampTtlSeconds(body?.ttlSeconds);
  const updatedAt = Date.now();
  const expiresAt = updatedAt + ttlSeconds * 1000;

  await kv.put(key, JSON.stringify({ payload, writeHash, updatedAt, expiresAt }), {
    expirationTtl: ttlSeconds,
  });

  return jsonResponse(
    200,
    { ok: true, shareId, updatedAt, expiresAt, bytes: byteLength },
    origin
  );
}

export async function onRequestDelete({ request, env }) {
  const origin = resolveOrigin(request);
  if (origin === 'DENY') {
    return jsonResponse(403, { error: 'origin not allowed' }, null);
  }

  const kv = resolveKv(env);
  if (!kv) {
    return jsonResponse(503, { error: 'KV not configured' }, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' }, origin);
  }

  const shareId = typeof body?.shareId === 'string' ? body.shareId.trim() : '';
  const writeToken = typeof body?.writeToken === 'string' ? body.writeToken.trim() : '';
  if (!SHARE_ID_RE.test(shareId) || !WRITE_TOKEN_RE.test(writeToken)) {
    return jsonResponse(400, { error: 'invalid shareId or writeToken' }, origin);
  }

  const key = `share:${shareId}`;
  const existing = await kv.get(key, 'json');
  if (!existing) {
    return jsonResponse(200, { ok: true, deleted: false }, origin);
  }

  const writeHash = await sha256Hex(writeToken);
  if (typeof existing.writeHash === 'string' && !timingSafeEqual(existing.writeHash, writeHash)) {
    return jsonResponse(403, { error: 'write token mismatch' }, origin);
  }

  await kv.delete(key);
  return jsonResponse(200, { ok: true, deleted: true }, origin);
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return onRequestOptions({ request });
  if (request.method === 'GET') return onRequestGet({ request, env });
  if (request.method === 'PUT') return onRequestPut({ request, env });
  if (request.method === 'DELETE') return onRequestDelete({ request, env });
  return jsonResponse(405, { error: 'method not allowed' }, resolveOrigin(request));
}
