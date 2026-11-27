const KV_KEY = 'announcement:current';
const STATUS_KEY = 'site:status';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'content-type': 'application/json; charset=utf-8',
  };
}

function getKV(env) {
  return env?.STATS_KV ?? globalThis?.STATS_KV;
}

function isAdminAuthorized(request, env) {
  const adminPassword = env?.ADMIN_PASSWORD ?? globalThis?.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  const providedPassword = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  return providedPassword === adminPassword;
}

async function isSiteActive(env) {
  const flag = env?.ANNOUNCEMENT_ENABLED ?? globalThis?.ANNOUNCEMENT_ENABLED;
  // Env var override: explicitly disabled at deployment level
  if (flag === false || flag === '0' || flag === 'false') return false;

  const kv = getKV(env);
  if (!kv) return false;

  try {
    const status = await kv.get(STATUS_KEY, 'json');
    return status?.enabled !== false;
  } catch {
    return true;
  }
}

const HISTORY_KEY = 'announcement:history';
const MAX_HISTORY = 20;

export async function onRequestGet({ request, env }) {
  try {
    const kv = getKV(env);
    if (!kv) {
      return new Response(
        JSON.stringify({ error: 'KV not configured' }),
        { status: 503, headers: corsHeaders() }
      );
    }

    const isAdmin = isAdminAuthorized(request, env);
    if (!isAdmin && !(await isSiteActive(env))) {
      return new Response(
        JSON.stringify({ message: 'Announcement system disabled' }),
        { status: 404, headers: corsHeaders() }
      );
    }

    const url = new URL(request.url);
    if (url.searchParams.get('history') === 'true') {
      const history = (await kv.get(HISTORY_KEY, 'json')) || { entries: [] };
      return new Response(JSON.stringify(history), {
        headers: corsHeaders(),
      });
    }

    const data = await kv.get(KV_KEY, 'json');
    if (!data) {
      return new Response(
        JSON.stringify({ message: 'No active announcement' }),
        { status: 404, headers: corsHeaders() }
      );
    }

    // Filter future announcements on the edge
    if (data.publishedAt && new Date(data.publishedAt).getTime() > Date.now()) {
      return new Response(
        JSON.stringify({ message: 'Announcement not yet published' }),
        { status: 404, headers: corsHeaders() }
      );
    }

    // Filter expired on the edge so clients never see stale data
    if (data.expireAt && new Date(data.expireAt).getTime() <= Date.now()) {
      return new Response(
        JSON.stringify({ message: 'Announcement expired' }),
        { status: 404, headers: corsHeaders() }
      );
    }

    return new Response(JSON.stringify(data), {
      headers: corsHeaders(),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const kv = getKV(env);
    const ADMIN_PASSWORD = env?.ADMIN_PASSWORD ?? globalThis?.ADMIN_PASSWORD;

    if (!kv) {
      return new Response(
        JSON.stringify({ error: 'KV not configured' }),
        { status: 503, headers: corsHeaders() }
      );
    }

    if (!ADMIN_PASSWORD) {
      return new Response(
        JSON.stringify({ error: 'Admin not configured' }),
        { status: 403, headers: corsHeaders() }
      );
    }

    const providedPassword = request.headers
      .get('Authorization')
      ?.replace('Bearer ', '');

    if (providedPassword !== ADMIN_PASSWORD) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: corsHeaders() }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: corsHeaders() }
      );
    }

    const id = String(body.id || '').trim();
    const title = String(body.title || '').trim();
    const content = String(body.content || '').trim();
    const level = String(body.level || 'info').trim();
    const publishedAt = String(body.publishedAt || new Date().toISOString()).trim();
    const expireAt = body.expireAt ? String(body.expireAt).trim() : '';

    if (!id || !title || !content) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: id, title, content' }),
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!['info', 'warning', 'critical'].includes(level)) {
      return new Response(
        JSON.stringify({ error: 'Invalid level. Must be info, warning, or critical' }),
        { status: 400, headers: corsHeaders() }
      );
    }

    // Archive current announcement to history before overwriting
    const current = await kv.get(KV_KEY, 'json');
    if (current) {
      const history = (await kv.get(HISTORY_KEY, 'json')) || { entries: [] };
      history.entries.unshift(current);
      if (history.entries.length > MAX_HISTORY) {
        history.entries = history.entries.slice(0, MAX_HISTORY);
      }
      await kv.put(HISTORY_KEY, JSON.stringify(history));
    }

    const announcement = {
      id,
      title,
      content,
      level,
      publishedAt,
      submittedAt: new Date().toISOString(),
      ...(expireAt ? { expireAt } : {}),
    };

    await kv.put(KV_KEY, JSON.stringify(announcement));

    return new Response(JSON.stringify({ success: true, announcement }), {
      headers: corsHeaders(),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
