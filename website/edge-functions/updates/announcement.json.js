const KV_KEY = 'announcement:current';
const STATUS_KEY = 'site:status';

function getKV(env) {
  return env?.STATS_KV ?? globalThis?.STATS_KV;
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

const DISABLED_RESPONSE = JSON.stringify({ message: 'Announcement system disabled' });
const DISABLED_HEADERS = {
  'content-type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export async function onRequestGet({ env }) {
  if (!(await isSiteActive(env))) {
    return new Response(DISABLED_RESPONSE, {
      status: 404,
      headers: DISABLED_HEADERS,
    });
  }

  try {
    const kv = getKV(env);
    if (!kv) {
      return new Response(JSON.stringify({ error: 'KV not configured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }

    const data = await kv.get(KV_KEY, 'json');
    if (!data) {
      return new Response(JSON.stringify({ message: 'No active announcement' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Filter future announcements on the edge
    if (data.publishedAt && new Date(data.publishedAt).getTime() > Date.now()) {
      return new Response(JSON.stringify({ message: 'Announcement not yet published' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Filter expired on the edge so clients never see stale data
    if (data.expireAt && new Date(data.expireAt).getTime() <= Date.now()) {
      return new Response(JSON.stringify({ message: 'Announcement expired' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: {
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
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
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
