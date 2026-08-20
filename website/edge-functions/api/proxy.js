/**
 * 教务系统反向代理（Web 端传输层）。
 *
 * 浏览器无法直连教务系统：CORS 拦截 + Cookie/User-Agent/Referer/Origin
 * 均为 forbidden header。本函数接收客户端请求，做头部映射后转发到上游，
 * 再将上游响应重组返回。
 *
 * 协议：
 *   请求  GET/POST /api/proxy?url=<encodeURIComponent(上游完整 URL)>
 *   头部映射（客户端 → 上游）：
 *     x-proxy-cookie  → Cookie      （客户端 JS cookie jar 序列化）
 *     x-proxy-ua      → User-Agent
 *     x-proxy-referer → Referer
 *     x-proxy-origin  → Origin
 *     其余头部原样透传（hop-by-hop / 链头 / accept-encoding 除外）
 *   响应（上游 → 客户端）：
 *     HTTP 状态恒为 200（浏览器 fetch redirect:'manual' 会把 3xx 变成
 *     opaqueredirect 并隐藏 Location，故真实状态码走头部）：
 *     x-proxy-status     → 上游真实状态码
 *     x-proxy-set-cookie → 上游全部 Set-Cookie 的 JSON 数组的 base64，
 *                          按 3500 字符分片重复出现（单个头部 value ≤4095B）
 *     其余上游头部原样透传（编码/长度/hop-by-hop 除外）
 *
 * 安全设计：
 * - 目标 host 硬编码白名单，仅默认端口，拒绝 URL userinfo，防止开放代理滥用；
 * - 浏览器跨域调用限制到站点 Origin（同源请求/curl 不受限）——
 *   完整的鉴权门槛（配额/身份校验）后续再加；
 * - 剥离代理链头（Proxy-Authorization / X-Forwarded-* 等），防止伪造上游视角；
 * - 不在此处记录任何请求体（含登录密码）。
 * - 注意：202.206.247.49（实践教学平台）上游为明文 HTTP，会话 cookie 在
 *   代理→上游段未加密，属上游服务限制。
 */

// 上游目标白名单：YSU 教务相关域名 + 实践教学平台 IP + 微信扫码登录 + NBU
const ALLOWED_HOSTS = new Set([
  'cer.ysu.edu.cn',
  'jwxt.ysu.edu.cn',
  'ldxt.ysu.edu.cn',
  'xgxt.ysu.edu.cn',
  '202.206.247.49',
  'open.weixin.qq.com',
  'lp.open.weixin.qq.com',
  'uis.nbu.edu.cn',
  'ehall.nbu.edu.cn',
]);

// 允许发起浏览器跨域调用的 Origin（同源请求无 Origin 头，不受限）。
// 生产站点 ysu.welain.com；localhost:3000 为本地开发调试。
const ALLOWED_ORIGINS = new Set([
  'https://ysu.welain.com',
  'http://localhost:3000',
]);

// 不从客户端透传的请求头（hop-by-hop、代理链头、由代理重新生成、或专用映射头）
const SKIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'accept-encoding', // 代理自行读取并解压上游 body
  // 代理链头：客户端不得伪造上游视角的 IP/协议/代理凭据
  'proxy-authorization',
  'proxy-authenticate',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'via',
  'trailer',
  'te',
  'cookie', // 仅接受 x-proxy-cookie
  'user-agent',
  'referer',
  'origin',
  'x-proxy-cookie',
  'x-proxy-ua',
  'x-proxy-referer',
  'x-proxy-origin',
]);

// 不透传给客户端的上游响应头（body 已由运行时解压，编码/长度头必须丢弃）
const SKIP_RESPONSE_HEADERS = new Set([
  'set-cookie', // 走 x-proxy-set-cookie
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-authenticate',
]);

const HEADER_VALUE_MAX = 3500; // 边缘函数头部 value 上限 4095B，留余量分片

/**
 * 校验浏览器 Origin：同源/非浏览器请求（无 Origin 头）放行返回 null；
 * 白名单内返回该 Origin；其余返回 'DENY'。
 */
function resolveOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (!ALLOWED_ORIGINS.has(origin)) return 'DENY';
  return origin;
}

function corsHeaders(origin) {
  return origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': '*' }
    : {};
}

function errorResponse(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  });
}

function encodeSetCookies(setCookies) {
  if (setCookies.length === 0) return [];
  const json = JSON.stringify(setCookies);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(bin);
  const chunks = [];
  for (let i = 0; i < b64.length; i += HEADER_VALUE_MAX) {
    chunks.push(b64.slice(i, i + HEADER_VALUE_MAX));
  }
  return chunks;
}

function preflightResponse(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, X-Requested-With, X-Proxy-Cookie, X-Proxy-Ua, X-Proxy-Referer, X-Proxy-Origin',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export function onRequestOptions({ request }) {
  const origin = resolveOrigin(request);
  if (origin === 'DENY') {
    return errorResponse(403, 'origin not allowed', null);
  }
  return preflightResponse(origin);
}

export async function onRequest({ request }) {
  // 平台上 onRequest 可能优先于 onRequestOptions，OPTIONS 在通用入口里兜底
  if (request.method === 'OPTIONS') {
    return onRequestOptions({ request });
  }

  const origin = resolveOrigin(request);
  if (origin === 'DENY') {
    return errorResponse(403, 'origin not allowed', null);
  }

  const reqUrl = new URL(request.url);
  const targetRaw = reqUrl.searchParams.get('url');
  if (!targetRaw) {
    return errorResponse(400, 'missing "url" query parameter', origin);
  }

  let target;
  try {
    target = new URL(targetRaw);
  } catch {
    return errorResponse(400, 'invalid "url" query parameter', origin);
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return errorResponse(400, 'only http/https targets are allowed', origin);
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return errorResponse(403, `target host not allowed: ${target.hostname}`, origin);
  }
  if (target.port !== '') {
    // URL.port 对默认端口返回空串；非空即非默认端口（防端口探测）
    return errorResponse(400, 'non-default port not allowed', origin);
  }
  if (target.username || target.password) {
    return errorResponse(400, 'url userinfo not allowed', origin);
  }

  // ── 构造上游请求 ──────────────────────────────────────────────────────
  const upstreamHeaders = new Headers();
  request.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (SKIP_REQUEST_HEADERS.has(lower)) return;
    if (lower.startsWith('x-proxy-')) return; // 未知的 x-proxy-* 一律不透传
    upstreamHeaders.set(name, value);
  });

  const cookie = request.headers.get('x-proxy-cookie');
  if (cookie) upstreamHeaders.set('Cookie', cookie);
  const ua = request.headers.get('x-proxy-ua');
  upstreamHeaders.set(
    'User-Agent',
    ua ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  );
  const referer = request.headers.get('x-proxy-referer');
  if (referer) upstreamHeaders.set('Referer', referer);
  const xOrigin = request.headers.get('x-proxy-origin');
  if (xOrigin) upstreamHeaders.set('Origin', xOrigin);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;

  // ── 转发（manual：登录链路依赖把 302 + Set-Cookie 透传给客户端）────────
  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      body,
      redirect: 'manual',
      eo: {
        timeoutSetting: {
          connectTimeout: 25000,
          readTimeout: 55000,
          writeTimeout: 25000,
        },
      },
    });
  } catch {
    // 不向外回显 err.message，避免泄露内部解析/DNS 信息
    return errorResponse(502, 'upstream fetch failed', origin);
  }

  // 运行时读取 body 即完成解压，因此编码/长度类头部不可透传
  const upstreamBody = await upstream.arrayBuffer();

  // ── 重组响应 ──────────────────────────────────────────────────────────
  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    if (SKIP_RESPONSE_HEADERS.has(name.toLowerCase())) return;
    headers.set(name, value);
  });

  const setCookies =
    typeof upstream.headers.getSetCookie === 'function'
      ? upstream.headers.getSetCookie()
      : [];
  for (const chunk of encodeSetCookies(setCookies)) {
    headers.append('x-proxy-set-cookie', chunk);
  }

  headers.set('x-proxy-status', String(upstream.status));
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', '*');
  }

  // 204/304/205 不允许携带 body
  const status = upstream.status;
  const nullBody = status === 204 || status === 304 || status === 205;
  return new Response(nullBody ? null : upstreamBody, { status: 200, headers });
}
