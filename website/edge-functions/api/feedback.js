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

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        {
          status: 400,
          headers: {
            'content-type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const id = String(body.id || '').slice(0, 32);
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Missing feedback id' }),
        {
          status: 400,
          headers: {
            'content-type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const date = new Date().toISOString().split('T')[0];
    const ua = String(body.ua || '').slice(0, 512) || request.headers.get('user-agent') || 'unknown';
    const key = `feedback:${date}`;
    const data = await STATS_KV.get(key, 'json') || { entries: [] };

    const rating = Number(body.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return new Response(
        JSON.stringify({ error: 'Rating must be 1-5' }),
        {
          status: 400,
          headers: {
            'content-type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    data.entries.push({
      id,
      rating,
      text: String(body.text || '').slice(0, 500),
      version: String(body.version || '').slice(0, 32),
      viewport: String(body.viewport || '').slice(0, 32),
      screen: String(body.screen || '').slice(0, 32),
      platform: String(body.platform || '').slice(0, 16),
      ua,
      ts: Date.now(),
    });

    // Limit entries per day to avoid KV size limits
    if (data.entries.length > 200) {
      data.entries = data.entries.slice(-200);
    }

    await STATS_KV.put(key, JSON.stringify(data));

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

export async function onRequestGet({ request, env }) {
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

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Missing id parameter' }),
        {
          status: 400,
          headers: {
            'content-type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // If id has date prefix (YYYYMMDD-xxx), query directly
    const dateMatch = id.match(/^(\d{4})(\d{2})(\d{2})-/);
    if (dateMatch) {
      const dateStr = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      const key = `feedback:${dateStr}`;
      const data = await STATS_KV.get(key, 'json');
      if (data) {
        const entry = data.entries?.find((e) => e.id === id);
        if (entry) {
          return new Response(
            JSON.stringify({
              adminReply: entry.adminReply || null,
              repliedAt: entry.repliedAt || null,
            }),
            {
              headers: {
                'content-type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          );
        }
      }
    }

    // Fallback: scan recent 7 days for legacy ids
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const key = `feedback:${dateStr}`;
      const data = await STATS_KV.get(key, 'json');
      if (!data) continue;
      const entry = data.entries?.find((e) => e.id === id);
      if (entry) {
        return new Response(
          JSON.stringify({
            adminReply: entry.adminReply || null,
            repliedAt: entry.repliedAt || null,
          }),
          {
            headers: {
              'content-type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      {
        status: 404,
        headers: {
          'content-type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
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
