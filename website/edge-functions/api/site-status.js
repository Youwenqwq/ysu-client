const STATUS_KEY = 'site:status';

function corsHeaders() {
  return {
    'content-type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
}

function getKV(env) {
  return env?.STATS_KV ?? globalThis?.STATS_KV;
}

export async function onRequestGet({ env }) {
  try {
    const kv = getKV(env);
    if (!kv) {
      // Default to enabled if KV unavailable
      return new Response(JSON.stringify({ enabled: true }), {
        headers: corsHeaders(),
      });
    }

    const status = await kv.get(STATUS_KEY, 'json');
    const enabled = status?.enabled !== false; // default true
    return new Response(JSON.stringify({ enabled }), {
      headers: corsHeaders(),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders(),
    });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const kv = getKV(env);
    const ADMIN_PASSWORD = env?.ADMIN_PASSWORD ?? globalThis?.ADMIN_PASSWORD;

    if (!kv) {
      return new Response(JSON.stringify({ error: 'KV not configured' }), {
        status: 503,
        headers: corsHeaders(),
      });
    }

    if (!ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Admin not configured' }), {
        status: 403,
        headers: corsHeaders(),
      });
    }

    const providedPassword = request.headers
      .get('Authorization')
      ?.replace('Bearer ', '');

    if (providedPassword !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: corsHeaders(),
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    const enabled = body.enabled === true;

    await kv.put(STATUS_KEY, JSON.stringify({ enabled }));

    return new Response(JSON.stringify({ enabled, success: true }), {
      headers: corsHeaders(),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders(),
    });
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
