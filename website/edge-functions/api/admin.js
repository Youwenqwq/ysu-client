export async function onRequestGet({ request, env }) {
  try {
    const STATS_KV = env?.STATS_KV ?? globalThis?.STATS_KV;
    const ADMIN_PASSWORD = env?.ADMIN_PASSWORD ?? globalThis?.ADMIN_PASSWORD;

    if (!ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Admin not configured' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }

    const providedPassword = request.headers
      .get('Authorization')
      ?.replace('Bearer ', '');

    if (providedPassword !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const date = url.searchParams.get('date');

    if (type === 'list') {
      const prefix = url.searchParams.get('prefix') || '';
      try {
        const result = await STATS_KV.list({ prefix });
        return new Response(
          JSON.stringify({ keys: result.keys.map((k) => k.key) }),
          { headers: { 'content-type': 'application/json' } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message }),
          { status: 500, headers: { 'content-type': 'application/json' } }
        );
      }
    }

    if (type === 'all-feedback') {
      try {
        const all = [];
        let cursor;
        do {
          const opts = { prefix: 'feedback:' };
          if (cursor) opts.cursor = cursor;
          const result = await STATS_KV.list(opts);
          for (const k of result.keys) {
            const data = await STATS_KV.get(k.key, 'json');
            if (data && Array.isArray(data.entries)) {
              all.push(...data.entries);
            }
          }
          cursor = result.cursor;
        } while (cursor);
        // sort by newest first
        all.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        return new Response(JSON.stringify({ entries: all }), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message }),
          { status: 500, headers: { 'content-type': 'application/json' } }
        );
      }
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(
        JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    if (type === 'stats') {
      const data = (await STATS_KV.get(`stats:${date}`, 'json')) || {
        count: 0,
        entries: [],
      };
      return new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (type === 'feedback') {
      const data = (await STATS_KV.get(`feedback:${date}`, 'json')) || {
        entries: [],
      };
      return new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ error: 'Unknown type. Use stats, feedback, or list' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const STATS_KV = env?.STATS_KV ?? globalThis?.STATS_KV;
    const ADMIN_PASSWORD = env?.ADMIN_PASSWORD ?? globalThis?.ADMIN_PASSWORD;

    if (!ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Admin not configured' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }

    const providedPassword = request.headers
      .get('Authorization')
      ?.replace('Bearer ', '');

    if (providedPassword !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    const id = String(body.id || '');
    const reply = String(body.reply || '').slice(0, 1000);

    if (!id || !reply) {
      return new Response(
        JSON.stringify({ error: 'Missing id or reply' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
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
          entry.adminReply = reply;
          entry.repliedAt = Date.now();
          await STATS_KV.put(key, JSON.stringify(data));
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'content-type': 'application/json' },
          });
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
        entry.adminReply = reply;
        entry.repliedAt = Date.now();
        await STATS_KV.put(key, JSON.stringify(data));
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    return new Response(
      JSON.stringify({ error: 'Feedback not found' }),
      { status: 404, headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
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
