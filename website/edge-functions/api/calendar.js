/**
 * iOS / 跨平台日历订阅托管接口（webcal:// / https:// .ics Feed）。
 *
 * 协议：
 * - GET    /api/calendar?token=<readToken>
 *          返回 text/calendar; charset=utf-8，供 iOS 日历 / macOS / Google Calendar 定时拉取。
 * - PUT    /api/calendar
 *          Body: { readToken, writeToken, ics }
 *          校验 writeToken 的 SHA-256 哈希后写入 EdgeOne KV（TTL 180 天）。
 * - DELETE /api/calendar
 *          Body: { readToken, writeToken }
 *          校验 writeToken 后立即从 KV 删除。
 *
 * 隐私设计：
 * - 服务端不接触任何教务凭据，仅托管客户端生成的 .ics 文本；
 * - readToken 为高熵随机串（>= 24 chars base64url），不可枚举；
 * - writeToken 以 SHA-256 哈希保存，防止第三方覆写或删除他人订阅。
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;
const MAX_ICS_BYTES = 256 * 1024; // 256 KB
const CALENDAR_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days

const ALLOWED_ORIGINS = new Set([
  'https://ysu.welain.com',
  'http://localhost:3000',
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

function jsonResponse(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
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
  const kv = resolveKv(env);
  if (!kv) {
    return new Response('KV not configured', { status: 503 });
  }

  const url = new URL(request.url);
  const token = (url.searchParams.get('token') || '').trim();
  if (!TOKEN_RE.test(token)) {
    return new Response('Invalid calendar token', { status: 400 });
  }

  const record = await kv.get(`cal:${token}`, 'json');
  if (!record || typeof record.ics !== 'string') {
    return new Response('Calendar feed not found', { status: 404 });
  }

  return new Response(record.ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="orahako-schedule.ics"',
      'Cache-Control': 'no-cache, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
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

  const readToken = typeof body?.readToken === 'string' ? body.readToken.trim() : '';
  const writeToken = typeof body?.writeToken === 'string' ? body.writeToken.trim() : '';
  const ics = typeof body?.ics === 'string' ? body.ics : '';

  if (!TOKEN_RE.test(readToken) || !TOKEN_RE.test(writeToken)) {
    return jsonResponse(400, { error: 'invalid readToken or writeToken' }, origin);
  }

  const trimmed = ics.trim();
  if (!trimmed.startsWith('BEGIN:VCALENDAR') || !trimmed.endsWith('END:VCALENDAR')) {
    return jsonResponse(400, { error: 'invalid iCalendar payload' }, origin);
  }

  const byteLength = new TextEncoder().encode(ics).byteLength;
  if (byteLength > MAX_ICS_BYTES) {
    return jsonResponse(413, { error: 'calendar payload exceeds 256KB limit' }, origin);
  }

  const key = `cal:${readToken}`;
  const writeHash = await sha256Hex(writeToken);
  const existing = await kv.get(key, 'json');
  if (existing && typeof existing.writeHash === 'string') {
    if (!timingSafeEqual(existing.writeHash, writeHash)) {
      return jsonResponse(403, { error: 'write token mismatch' }, origin);
    }
  }

  const updatedAt = Date.now();
  await kv.put(key, JSON.stringify({ ics, writeHash, updatedAt }), {
    expirationTtl: CALENDAR_TTL_SECONDS,
  });

  return jsonResponse(200, { ok: true, updatedAt, bytes: byteLength }, origin);
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

  const readToken = typeof body?.readToken === 'string' ? body.readToken.trim() : '';
  const writeToken = typeof body?.writeToken === 'string' ? body.writeToken.trim() : '';
  if (!TOKEN_RE.test(readToken) || !TOKEN_RE.test(writeToken)) {
    return jsonResponse(400, { error: 'invalid readToken or writeToken' }, origin);
  }

  const key = `cal:${readToken}`;
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
