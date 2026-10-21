import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_HOSTS } from '../website/edge-functions/api/proxy.js';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('This build produces an Apple Silicon macOS app and must run on an arm64 Mac.');
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildRoot = join(root, 'macos', 'build');
const appName = '燕大终端';
const executableName = 'YSUClient';
const bundleID = 'com.youwenqwq.ysuclient.macos';
const appPath = join(buildRoot, `${appName}.app`);
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = pkg.version.split('-')[0];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// Prefer a stable signing identity when available; otherwise use ad-hoc signing.
function resolveSigningIdentity() {
  const preferred = process.env.MACOS_CODESIGN_IDENTITY || 'YSU Client Local Signing';
  const listing = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  if (listing.status === 0 && listing.stdout.includes(`"${preferred}"`)) return preferred;
  return '-';
}

// Webpack's next/font loader honors the terminal's HTTP(S)_PROXY during font downloads.
// Build a dedicated native target, without a developer's remote proxy URL or /app base path.
run('pnpm', ['run', 'build', '--webpack'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_PUBLIC_MACOS_APP: '1',
    NEXT_PUBLIC_PROXY_BASE_URL: '',
    APP_BASE_PATH: '',
    NEXT_TELEMETRY_DISABLED: '1',
  },
});
await stat(join(root, 'dist', 'index.html'));
await stat(join(root, 'dist', 'login', 'index.html'));

await mkdir(buildRoot, { recursive: true });
const staging = await mkdtemp(join(buildRoot, '.stage-'));
try {
  const stagedApp = join(staging, `${appName}.app`);
  const contents = join(stagedApp, 'Contents');
  const resources = join(contents, 'Resources');
  const macOS = join(contents, 'MacOS');
  await mkdir(resources, { recursive: true });
  await mkdir(macOS, { recursive: true });
  await cp(join(root, 'dist'), join(resources, 'Web'), { recursive: true });
  await cp(join(root, 'LICENSE'), join(resources, 'LICENSE'));
  await cp(join(root, 'macos', 'glass.css'), join(resources, 'glass.css'));
  await writeFile(join(resources, 'native-allowed-hosts.json'), JSON.stringify([...ALLOWED_HOSTS].sort()));

  // macOS 14+ no longer exempts IP literals; NSExceptionDomains accepts them explicitly.
  const httpExceptions = [...ALLOWED_HOSTS]
    .sort()
    .map((host) => `      <key>${xml(host)}</key><dict><key>NSExceptionAllowsInsecureHTTPLoads</key><true/></dict>`)
    .join('\n');
  await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleDisplayName</key><string>${xml(appName)}</string>
  <key>CFBundleName</key><string>${xml(appName)}</string>
  <key>CFBundleExecutable</key><string>${executableName}</string>
  <key>CFBundleIdentifier</key><string>${bundleID}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>${xml(version)}</string>
  <key>CFBundleVersion</key><string>${xml(version)}</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Third-party client; GPL-3.0. Not affiliated with Yanshan University.</string>
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSExceptionDomains</key><dict>
${httpExceptions}
    </dict>
  </dict>
</dict></plist>
`);

  const iconset = join(staging, 'AppIcon.iconset');
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale;
      const suffix = scale === 2 ? '@2x' : '';
      run('sips', ['-z', String(pixels), String(pixels), join(root, 'assets', 'icon-only.png'), '--out', join(iconset, `icon_${size}x${size}${suffix}.png`)]);
    }
  }
  run('iconutil', ['--convert', 'icns', '--output', join(resources, 'AppIcon.icns'), iconset]);

  const sourceRoot = join(root, 'macos', 'Sources');
  const sources = (await readdir(sourceRoot)).filter((name) => name.endsWith('.swift')).sort().map((name) => join(sourceRoot, name));
  if (!sources.includes(join(sourceRoot, 'main.swift'))) throw new Error('Missing native application entrypoint.');
  run('xcrun', [
    'swiftc', '-swift-version', '5', '-O', '-target', 'arm64-apple-macos14.0',
    '-module-cache-path', join(buildRoot, 'ModuleCache'),
    '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'Network', '-framework', 'Security', '-framework', 'Carbon',
    '-module-name', 'YSUMacClient', ...sources, '-o', join(macOS, executableName),
  ]);
  run('plutil', ['-lint', join(contents, 'Info.plist')]);
  const signingIdentity = resolveSigningIdentity();
  run('codesign', ['--force', '--sign', signingIdentity, '--identifier', bundleID, stagedApp]);
  run('codesign', ['--verify', '--strict', stagedApp]);
  console.log(`Signed with ${signingIdentity === '-' ? 'ad-hoc identity' : `"${signingIdentity}"`}.`);

  // Only replace a prior build belonging to this app, never an unrelated directory.
  try {
    await stat(appPath);
    const identity = spawnSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist')], { encoding: 'utf8' });
    if (identity.status !== 0 || identity.stdout.trim() !== bundleID) {
      throw new Error(`Refusing to replace an unrelated item at ${appPath}`);
    }
    await rm(appPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await rename(stagedApp, appPath);
  console.log(`\nBuilt: ${appPath}\nOpen this .app directly; no Node or terminal is needed at runtime.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
