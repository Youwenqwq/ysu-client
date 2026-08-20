import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

let gitHash = 'unknown';
try {
  gitHash = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
} catch {
  // git unavailable — keep fallback
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'dist',
  trailingSlash: true,
  // Web 部署到站点 /app 子路径时用 APP_BASE_PATH=/app 构建；
  // Capacitor 打包保持默认空值。
  basePath: process.env.APP_BASE_PATH || '',
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_APP_BUILD: gitHash,
  },
};

export default nextConfig;
