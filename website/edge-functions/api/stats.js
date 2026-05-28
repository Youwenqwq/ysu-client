export async function onRequestPost({ request, env }) {
  try {
    const STATS_KV = env?.STATS_KV ?? globalThis?.STATS_KV;
    if (!STATS_KV) {
      return new Response(
        JSON.stringify({ error: 'KV not configured' }),
        {
          status: 503,
          headers: {
            'content-type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const date = new Date().toISOString().split('T')[0];

    let extra = {};
    try {
      const body = await request.json();
      extra = {
        version: String(body.version || '').slice(0, 32),
        viewport: String(body.viewport || '').slice(0, 32),
        screen: String(body.screen || '').slice(0, 32),
        platform: String(body.platform || '').slice(0, 16),
        ua: String(body.ua || '').slice(0, 512),
      };
    } catch {
      // ignore parse errors
    }

    const ua = extra.ua || request.headers.get('user-agent') || 'unknown';

    const key = `stats:${date}`;
    const data = await STATS_KV.get(key, 'json') || { count: 0, entries: [] };

    // Migrate old format if needed
    if (data.userAgents && !data.entries) {
      data.entries = data.userAgents.map((u) => ({ ua: u }));
      delete data.userAgents;
    }

    data.count += 1;
    if (data.entries.length < 100) {
      data.entries.push({ ua, ...extra, ts: Date.now() });
    }

    await STATS_KV.put(key, JSON.stringify(data), {
      expirationTtl: 60 * 60 * 24 * 90,
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: {
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

export async function onRequestGet({ env }) {
  try {
    const STATS_KV = env?.STATS_KV ?? globalThis?.STATS_KV;
    if (!STATS_KV) {
      return new Response(
        JSON.stringify({ error: 'KV not configured' }),
        {
          status: 503,
          headers: {
            'content-type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const date = new Date().toISOString().split('T')[0];
    const key = `stats:${date}`;
    const data = await STATS_KV.get(key, 'json') || { count: 0 };

    return new Response(JSON.stringify({ count: data.count || 0 }), {
      headers: {
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
