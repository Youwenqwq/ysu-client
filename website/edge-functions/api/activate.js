/**
 * Web 端激活校验（简易人数控制）。
 *
 *   POST /api/activate   body: {"token": "..."}
 *   200 {"activated": true}   通过（或未配置 ACTIVATION_TOKEN，功能关闭）
 *   401 {"activated": false}  token 错误
 *
 * Token 存于环境变量 ACTIVATION_TOKEN（逗号分隔可配多个），不落代码库。
 * 与 /api/proxy 共用同一批 token：proxy 逐请求校验 X-Activation 头，
 * 本端点仅用于客户端在持久化 token 之前验证输入并给出即时反馈。
 * 真正的强制点在 proxy.js，本端点可被绕过但不产生任何收益。
 *
 * CORS 策略与 proxy.js 一致：浏览器跨域调用限制到站点 Origin
 * （同源请求无 Origin 头，不受限；localhost:3000 供本地开发）。
 */

// 允许发起浏览器跨域调用的 Origin（同源请求无 Origin 头，不受限）。
const ALLOWED_ORIGINS = new Set([
  'https://ysu.welain.com',
  'http://localhost:3000',
]);

function resolveOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (!ALLOWED_ORIGINS.has(origin)) return 'DENY';
  return origin;
}

function corsHeaders(origin) {
  return origin ? { 'Access-Control-Allow-Origin': origin } : {};
}

function parseTokens(env) {
  const raw = env?.ACTIVATION_TOKEN ?? globalThis?.ACTIVATION_TOKEN;
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// 常量时间比较，避免逐字节短路泄露前缀信息
function timingSafeEqual(a, b) {
  const bytes = new TextEncoder();
  const ba = bytes.encode(a);
  const bb = bytes.encode(b);
  let diff = ba.length ^ bb.length;
  const len = Math.max(ba.length, bb.length, 1);
  for (let i = 0; i < len; i++) {
    diff |= (ba.length ? ba[i % ba.length] : 0) ^ (bb.length ? bb[i % bb.length] : 0);
  }
  return diff === 0;
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  });
}

export async function onRequestPost({ request, env }) {
  const origin = resolveOrigin(request);
  if (origin === 'DENY') {
    return json(403, { error: 'origin not allowed' }, null);
  }

  const tokens = parseTokens(env);
  if (tokens.length === 0) {
    // 未配置即功能关闭：任何输入都放行，避免漏配 env 把用户锁在激活页
    return json(200, { activated: true }, origin);
  }

  let token = '';
  try {
    const body = await request.json();
    if (body && typeof body.token === 'string') token = body.token;
  } catch {
    return json(400, { error: 'invalid JSON body' }, origin);
  }

  const ok = tokens.some((t) => timingSafeEqual(t, token));
  return ok
    ? json(200, { activated: true }, origin)
    : json(401, { activated: false, error: 'invalid token' }, origin);
}

export function onRequestOptions({ request }) {
  const origin = resolveOrigin(request);
  if (origin === 'DENY') {
    return json(403, { error: 'origin not allowed' }, null);
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
