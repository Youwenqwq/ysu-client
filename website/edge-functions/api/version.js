const CHANNEL_KEYS = {
  stable: 'version:channel:stable',
  beta: 'version:channel:beta',
  canary: 'version:channel:canary',
};

function jsonHeaders() {
  return {
    'content-type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: jsonHeaders(),
  });
}

function getKV(env) {
  return env?.STATS_KV ?? globalThis?.STATS_KV;
}

function getReleaseToken(env) {
  const token = env?.RELEASE_TOKEN ?? globalThis?.RELEASE_TOKEN;
  return typeof token === 'string' && token.length > 0 ? token : '';
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function extractBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function isHttpsUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

function isPositiveInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function parseChannelEntry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object' };
  }

  const channel = typeof body.channel === 'string' ? body.channel.trim() : '';
  if (!Object.prototype.hasOwnProperty.call(CHANNEL_KEYS, channel)) {
    return { error: 'Invalid channel. Must be stable, beta, or canary' };
  }

  const webVersion = typeof body.webVersion === 'string' ? body.webVersion.trim() : '';
  if (!webVersion) {
    return { error: 'Missing required field: webVersion' };
  }

  const webDownloadUrl =
    typeof body.webDownloadUrl === 'string' ? body.webDownloadUrl.trim() : '';
  if (!isHttpsUrl(webDownloadUrl)) {
    return { error: 'webDownloadUrl must be a valid https URL' };
  }

  const hasApkCode = body.apkVersionCode !== undefined && body.apkVersionCode !== null;
  const hasApkUrl =
    typeof body.apkDownloadUrl === 'string' && body.apkDownloadUrl.trim().length > 0;

  if (channel === 'stable' && (!hasApkCode || !hasApkUrl)) {
    return { error: 'Stable channel requires apkVersionCode and apkDownloadUrl' };
  }
  if (hasApkCode !== hasApkUrl) {
    return { error: 'apkVersionCode and apkDownloadUrl must be provided together' };
  }

  const entry = {
    webVersion,
    webDownloadUrl,
  };

  if (hasApkCode) {
    if (!isPositiveInt(body.apkVersionCode)) {
      return { error: 'apkVersionCode must be a positive integer' };
    }
    const apkDownloadUrl = body.apkDownloadUrl.trim();
    if (!isHttpsUrl(apkDownloadUrl)) {
      return { error: 'apkDownloadUrl must be a valid https URL' };
    }
    entry.apkVersionCode = body.apkVersionCode;
    entry.apkDownloadUrl = apkDownloadUrl;
  }

  if (body.minApkVersionCode !== undefined && body.minApkVersionCode !== null) {
    if (!isPositiveInt(body.minApkVersionCode)) {
      return { error: 'minApkVersionCode must be a positive integer' };
    }
    entry.minApkVersionCode = body.minApkVersionCode;
  } else if (hasApkCode) {
    entry.minApkVersionCode = entry.apkVersionCode;
  }

  if (body.body !== undefined && body.body !== null) {
    if (typeof body.body !== 'string') {
      return { error: 'body must be a string' };
    }
    entry.body = body.body;
  } else {
    entry.body = '';
  }

  return { channel, entry };
}

export async function onRequestGet({ env }) {
  try {
    const kv = getKV(env);
    if (!kv) {
      return jsonResponse({ error: 'KV not configured' }, 503);
    }

    const [stable, beta, canary] = await Promise.all([
      kv.get(CHANNEL_KEYS.stable, 'json'),
      kv.get(CHANNEL_KEYS.beta, 'json'),
      kv.get(CHANNEL_KEYS.canary, 'json'),
    ]);

    if (!stable && !beta && !canary) {
      return jsonResponse({ error: 'No release manifest published' }, 404);
    }

    const channels = {};
    if (stable) channels.stable = stable;
    if (beta) channels.beta = beta;
    if (canary) channels.canary = canary;

    const manifest = {
      ...(stable ?? {}),
      channels,
    };

    return jsonResponse(manifest, 200);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const kv = getKV(env);
    if (!kv) {
      return jsonResponse({ error: 'KV not configured' }, 503);
    }

    const expectedToken = getReleaseToken(env);
    if (!expectedToken) {
      return jsonResponse({ error: 'Release sync not configured' }, 403);
    }

    const providedToken = extractBearerToken(request);
    if (!constantTimeEqual(providedToken, expectedToken)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = parseChannelEntry(body);
    if (parsed.error) {
      return jsonResponse({ error: parsed.error }, 400);
    }

    await kv.put(CHANNEL_KEYS[parsed.channel], JSON.stringify(parsed.entry));

    return jsonResponse({
      ok: true,
      channel: parsed.channel,
      entry: parsed.entry,
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
