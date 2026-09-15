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

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(
        JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    if (type === 'stats') {
      // Fetch target date + previous day to cover timezone boundaries.
      // A single local day may span two UTC days, so we merge adjacent keys
      // and let the UI filter by local time.
      const dates = [date];
      const prev = new Date(date + 'T00:00:00Z');
      prev.setUTCDate(prev.getUTCDate() - 1);
      dates.push(prev.toISOString().split('T')[0]);

      let count = 0;
      let entries = [];
      for (const d of dates) {
        const data = await STATS_KV.get(`stats:${d}`, 'json');
        if (data) {
          count += data.count || 0;
          entries.push(...(data.entries || []));
        }
      }

      return new Response(JSON.stringify({ count, entries }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ error: 'Unknown type. Use stats or list' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
