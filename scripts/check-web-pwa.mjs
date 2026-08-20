const baseUrl = process.argv[2] || 'https://ysu.welain.com';

const results = [];

function check(name, condition, details = '') {
  const passed = Boolean(condition);
  const suffix = details ? ` — ${details}` : '';
  results.push({ name, passed, details });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${suffix}`);
  return passed;
}

function value(response, name) {
  return response.headers.get(name) || '';
}

function hasDirective(header, directive) {
  const expected = directive.toLowerCase();
  return header
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .includes(expected);
}

function contentTypeIs(response, type) {
  return value(response, 'content-type').toLowerCase().split(';', 1)[0].trim() === type;
}

function describeResponse(response) {
  return `${response.status} ${response.url}`;
}

async function attempt(name, operation) {
  try {
    await operation();
  } catch (error) {
    check(name, false, error instanceof Error ? error.message : String(error));
  }
}

let origin;
try {
  origin = new URL(baseUrl);
  if (!['http:', 'https:'].includes(origin.protocol)) {
    throw new Error('base URL must use http or https');
  }
} catch (error) {
  check('base URL', false, error instanceof Error ? error.message : String(error));
  printSummaryAndExit();
}

function url(pathname) {
  return new URL(pathname, origin).href;
}

async function checkDeepLink(pathname) {
  const target = url(pathname);
  const initial = await fetch(target, { method: 'GET', redirect: 'manual' });
  check(
    `${pathname} initial response`,
    [200, 301, 308].includes(initial.status),
    `${initial.status}${initial.headers.get('location') ? ` → ${initial.headers.get('location')}` : ''}`,
  );

  if ([301, 308].includes(initial.status)) {
    const location = initial.headers.get('location');
    check(`${pathname} redirects to trailing slash`, Boolean(location) && new URL(location, target).pathname.endsWith('/'), location || 'missing Location header');
  }

  const final = await fetch(target, { method: 'GET', redirect: 'follow' });
  check(`${pathname} final response`, final.status === 200, describeResponse(final));
}

for (const pathname of ['/app', '/app/dashboard', '/app/dashboard/me']) {
  await attempt(`${pathname} deep link`, () => checkDeepLink(pathname));
}

let appHtml = '';
for (const pathname of ['/app/', '/app/login/', '/app/dashboard/me/']) {
  await attempt(`${pathname} HTML`, async () => {
    const response = await fetch(url(pathname), { method: 'GET', redirect: 'follow' });
    const body = await response.text();
    const cacheControl = value(response, 'cache-control');
    const contentType = value(response, 'content-type');

    check(`${pathname} status`, response.status === 200, describeResponse(response));
    check(`${pathname} Content-Type`, contentTypeIs(response, 'text/html'), contentType || 'missing');
    check(`${pathname} Cache-Control`, hasDirective(cacheControl, 'no-cache'), cacheControl || 'missing');

    if (pathname === '/app/' && response.status === 200) {
      appHtml = body;
    }
  });
}

await attempt('manifest', async () => {
  const manifestUrl = url('/app/manifest.webmanifest');
  const response = await fetch(manifestUrl, { method: 'GET', redirect: 'follow' });
  const text = await response.text();
  const contentType = value(response, 'content-type');
  const cacheControl = value(response, 'cache-control');

  check('manifest status', response.status === 200, describeResponse(response));
  check('manifest Content-Type', contentTypeIs(response, 'application/manifest+json'), contentType || 'missing');
  check('manifest Cache-Control', hasDirective(cacheControl, 'no-cache'), cacheControl || 'missing');

  let manifest;
  try {
    manifest = JSON.parse(text);
    check('manifest JSON', true, 'valid JSON');
  } catch (error) {
    check('manifest JSON', false, error instanceof Error ? error.message : String(error));
    return;
  }

  check('manifest id', typeof manifest.id === 'string' && manifest.id.length > 0, JSON.stringify(manifest.id));
  check('manifest start_url', typeof manifest.start_url === 'string' && manifest.start_url.length > 0, JSON.stringify(manifest.start_url));
  check('manifest scope', typeof manifest.scope === 'string' && manifest.scope.length > 0, JSON.stringify(manifest.scope));
  check('manifest icons', Array.isArray(manifest.icons) && manifest.icons.length > 0, `${Array.isArray(manifest.icons) ? manifest.icons.length : 0} icon(s)`);

  if (Array.isArray(manifest.icons)) {
    for (const [index, icon] of manifest.icons.entries()) {
      if (!icon || typeof icon.src !== 'string' || icon.src.length === 0) {
        check(`manifest icon ${index + 1}`, false, 'missing src');
        continue;
      }

      const iconUrl = new URL(icon.src, manifestUrl).href;
      let iconResponse = await fetch(iconUrl, { method: 'HEAD', redirect: 'follow' });
      if ([405, 501].includes(iconResponse.status)) {
        iconResponse = await fetch(iconUrl, { method: 'GET', redirect: 'follow' });
      }
      check(`manifest icon ${index + 1}`, iconResponse.ok, describeResponse(iconResponse));
    }
  }
});

await attempt('service worker', async () => {
  const response = await fetch(url('/app/sw.js'), { method: 'GET', redirect: 'follow' });
  const source = await response.text();
  const contentType = value(response, 'content-type');
  const cacheControl = value(response, 'cache-control');

  check('service worker status', response.status === 200, describeResponse(response));
  check('service worker Content-Type', contentTypeIs(response, 'text/javascript'), contentType || 'missing');
  check('service worker Cache-Control', hasDirective(cacheControl, 'no-cache'), cacheControl || 'missing');
  check('service worker fetch handler', /addEventListener\s*\(\s*['"]fetch['"]/.test(source), 'addEventListener("fetch", …)');
});

await attempt('static asset', async () => {
  const match = appHtml.match(/(?:https?:\/\/[^"'<>\s]+)?(\/app\/_next\/static\/[^"'<>\s]+?\.(?:js|css)(?:\?[^"'<>\s]*)?)/i);
  check('static asset discovered', Boolean(match), match?.[1] || 'no /app/_next/static/*.js or *.css reference in /app/ HTML');
  if (!match) return;

  const assetUrl = new URL(match[1].replaceAll('&amp;', '&'), url('/app/')).href;
  const response = await fetch(assetUrl, { method: 'HEAD', redirect: 'follow' });
  const cacheControl = value(response, 'cache-control');
  check('static asset status', response.ok, describeResponse(response));
  check('static asset immutable Cache-Control', hasDirective(cacheControl, 'immutable'), cacheControl || 'missing');
});

await attempt('version.json', async () => {
  const response = await fetch(url('/updates/version.json'), { method: 'GET', redirect: 'follow' });
  const text = await response.text();
  const cacheControl = value(response, 'cache-control');

  check('version.json status', response.status === 200, describeResponse(response));
  check('version.json Cache-Control', hasDirective(cacheControl, 'no-cache'), cacheControl || 'missing');
  try {
    JSON.parse(text);
    check('version.json JSON', true, 'valid JSON');
  } catch (error) {
    check('version.json JSON', false, error instanceof Error ? error.message : String(error));
  }
});

printSummaryAndExit();

function printSummaryAndExit() {
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  console.log(`\nResult: ${passed} passed, ${failed} failed (${results.length} checks)`);
  process.exitCode = failed === 0 ? 0 : 1;
}
