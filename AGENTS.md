# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

燕山大学教务系统第三方客户端（"燕大终端"）。基于 Next.js 16 静态导出 + Capacitor 8 Android WebView 壳应用，支持 OTA 热更新。

- **Target**: Android APK only (via Capacitor), no web deployment
- **Next.js config**: `output: 'export'`, `distDir: 'dist'`, `trailingSlash: true`, images unoptimized
- **State**: Zustand + `persist` middleware backed by `@aparajita/capacitor-secure-storage`
- **Styling**: Tailwind CSS v4 + shadcn/ui + `next-themes` (dark/light)
- **i18n**: Custom lightweight hook at `lib/i18n/`, locales in `lib/i18n/locales/`
- **Website**: Independent Astro 6 project in `website/`, deployed to EdgeOne Pages

## Development Commands

```bash
pnpm run dev              # Next.js dev server (Turbopack)
pnpm run build            # Static export to dist/
pnpm run typecheck        # tsc --noEmit
pnpm run lint             # ESLint
pnpm run format           # Prettier write
pnpm run test             # Vitest regression tests
pnpm run test -- providers/hooks/use-provider-query.test.ts providers/ysu/emap-fetcher.test.ts providers/ysu/relogin.test.ts


npx cap sync             # Sync dist/ to Capacitor android/
npx cap open android     # Open Android Studio

pnpm run release          # Full release: build + zip + APK + GitHub release + website deploy
```

`pnpm run start` serves the static production build from `dist/`; run `pnpm run build` first because `next.config.mjs` sets `distDir: 'dist'`.

Release script (`scripts/release.sh`) builds the static export, creates `dist.zip`, builds the Android release APK, computes `version.json` for OTA updates, publishes a GitHub release with all artifacts, and deploys the website to EdgeOne Pages.

```bash
cd website && pnpm dev       # Astro dev server
cd website && pnpm build     # Static export to website/dist/
```

`edgeone pages deploy dist` deploys `website/dist/` directly without rebuilding.

## High-Level Architecture

### Auth & Cookie Flow

The app talks to two separate domains that share SSO via CAS:

1. **CAS** (`cer.ysu.edu.cn`) — unified identity gateway
2. **JWXT** (`jwxt.ysu.edu.cn`) — academic affairs system (EMAP platform)
Both use module-level `SimpleCookieJar` instances (`casJar`, `jwxtJar`). Cookie state must survive app restarts.

**On native (Capacitor)**:
- `CapacitorHttp` uses `HttpURLConnection` underneath, which has its own `java.net.CookieManager` (the "native cookie store")
- `capacitorHttpSend()` in `lib/cookie.ts` pushes jar cookies into the native store via `CapacitorCookies.setCookie()` before each request
- The native store is a **transport layer only**; the JS jar remains the source of truth
- Response `Set-Cookie` headers are captured back into the jar
- **Do not call `clearAllCookies()`** — it only clears the WebView `CookieManager`, not the `HttpURLConnection` cookie manager, and causes stale cookies → 400 errors
- Response headers are normalized to lowercase because CapacitorHttp preserves original casing (`Set-Cookie` vs `set-cookie`)

**Session persistence chain**:
1. Login success → `saveCASTGC()` stores CASTGC value → `secureStorage`
2. `initializeActiveProvider()` (called after Zustand hydration) restores CASTGC into native store + restores CAS/JWXT/mobile sessions into their jars
3. After successful provider calls, `persistJWXTSession()` / `persistMobileSession()` serialize jars back to auth-store
4. Logout → active provider `reset()` / `logout()` clears jars, auth-store state, caches, and native notification state


**Expired-login model**:
- `lib/stores/auth.ts` intentionally distinguishes `isAuthenticated` from `sessionExpired`.
- Expired CAS/JWXT sessions should keep `isAuthenticated=true` so cached dashboard data remains readable, while `sessionExpired=true` drives the visible warning UI.
- `providers/hooks/use-provider-query.ts` is the central cached data path. On `AUTH_SESSION_EXPIRED`, it may return cached data and set `authExpired=true` / auth-store `sessionExpired=true`; do not convert this into a hard redirect.
- `components/sdk-provider.tsx` performs startup CAS status checks and writes `sessionExpired`; it must not logout or redirect for confirmed expiry.
- `app/dashboard/layout.tsx` owns the global expired-login banner and the dashboard auth gate.

**YSU relogin paths**:
- `providers/ysu/relogin.ts` handles remembered-credential relogin and must verify CAS before returning success.
- `providers/ysu/protocol/cas.ts` contains CAS login/MFA/authorization primitives; avoid treating a non-login URL as successful auth without checking `isAuthenticated()` because CAS may land on reAuth/MFA pages.
- `providers/ysu/emap-fetcher.ts` maps JWXT/CAS protocol errors into `ProviderError`; CAS `NotAuthenticatedError` from JWXT reauthorization should remain `AUTH_SESSION_EXPIRED`.
### Layer Overview

| Layer | File | Responsibility |
|-------|------|----------------|
| Provider contracts | `providers/types.ts` | `AcademicProvider` interface and app-facing domain models |
| Provider runtime | `providers/provider-context.tsx`, `providers/provider-service.ts` | Active provider context, initialization, relogin, logout |
| Provider hooks | `providers/hooks/` | Cached UI data hooks; UI should consume these instead of legacy facades |
| YSU provider | `providers/ysu/` | YSU-specific CAS/JWXT protocol, session lifecycle, EMAP fetchers, diagnostics |
| Cookie / HTTP | `lib/cookie.ts` | `SimpleCookieJar`, `fetchWithJar`, `capacitorHttpSend` with native store sync |
| Native helpers | `lib/native/` | Capacitor platform, notification, WebView compatibility, widget bridge helpers |
| Storage helpers | `lib/storage/` | Secure storage, cache, avatar/background storage, persisted key naming |
| State stores | `lib/stores/` | Zustand stores: auth, settings, refresh, update, MFA modal, mobile header |

UI code consumes `providers/` (`AcademicProvider`, hooks, provider context/service); do not reintroduce `lib/api.ts`, `lib/types.ts`, or `lib/use-cached-data.ts`. Keep school-specific parsing/session logic under provider implementations such as `providers/ysu/`.

When debugging provider data loading, start from `providers/hooks/use-provider-query.ts` for cache/error semantics, then `providers/ysu/emap-fetcher.ts` for JWXT error mapping, then `providers/ysu/protocol/jwxt.ts` / `providers/ysu/protocol/cas.ts` for wire protocol behavior. Avoid repeated broad searches for these paths.

### Testing Notes

- Vitest is configured in `vitest.config.ts` with `environment: "node"` and includes `providers/**/*.test.ts`.
- Existing provider regression tests cover cached auth-expiry fallback, YSU academic error mapping, and CAS-verified relogin:
  - `providers/hooks/use-provider-query.test.ts`
  - `providers/ysu/emap-fetcher.test.ts`
  - `providers/ysu/relogin.test.ts`
- Tests use explicit imports from `vitest`, not globals.

### Storage / WebView Gotchas

- Auth Zustand persistence uses `secureStorage` from `lib/storage/secure.ts`; the web fallback stores data under Capacitor-style keys such as `capacitor-storage_academic-client-auth`, not plain `academic-client-auth`.
- Provider persistent cache keys are built by `providerCacheKey()` in `providers/hooks/use-provider-query.ts` and stored under `academic-client-cache:` / legacy `ysu-cache:` prefixes.
- `CapacitorHttp.enabled` is required for real university requests; browser dev may show CORS failures that do not reproduce in Android WebView.

### Website

- **Framework**: Astro 6 + React islands (`client:load`) + Tailwind CSS v4
- **i18n**: Astro native `i18n` config with `prefixDefaultLocale: false` — default locale at `/`, English at `/en/`
- **Pattern**: Page content lives in shared components (`HomePage.astro`, `ChangelogPage.astro`, etc.), language pages are thin wrappers
- **Styling**: Tailwind v4 `@theme` custom properties + `@custom-variant dark (&:is(.dark *))`
- **Deployment**: `edgeone pages deploy dist` — directly uploads `website/dist/` (no rebuild)
- **OTA files**: `release.sh` copies `dist.zip`, `app-release.apk`, `version.json` to `website/dist/updates/`
- **Generated files** (do not commit): `website/src/data/changelog.json`, `website/.edgeone/`

### App Shell Layout

- `app/dashboard/layout.tsx` — responsive shell: collapsible sidebar (desktop) + mobile top bar + bottom nav
- Auth gate in layout: if `!isAuthenticated` after hydration, redirects to `/login`
- `components/sdk-provider.tsx` — waits for auth-store hydration, initializes the active provider, then marks provider context ready

### Capacitor Config

- `CapacitorHttp.enabled: true` (required for CORS to university servers)
- `CapacitorUpdater.autoUpdate: false` (manual update checks via `lib/updater.ts`)
- Update mirrors: official (`ysu.welain.com/updates/`) + GitHub direct + user-defined custom
- `appReadyTimeout: 15000`

## Release Notes Format

Release body follows this structure (top to bottom):

```markdown
## 更新说明

### 新功能
- **标题加粗**：描述功能是什么、用户如何使用

### Bug 修复
- **标题加粗**：详细描述问题原因和修复方案

### 改进
- **标题加粗**：描述改动了什么、带来了什么好处

**Full Changelog**: https://github.com/Youwenqwq/ysu-client/compare/v{PREV}...v{CURR}
```

Rules:
- Categories in order: 新功能 → Bug 修复 → 改进
- Each bullet starts with `- **加粗标题**：`
- Description follows the colon, explaining the "what" and "why"
- Include technical root cause for bug fixes
- Include user-facing behavior for features and improvements
- Omit category if there are no items in it
- End with `**Full Changelog**: {compare URL}`

The release script (`scripts/release.sh`) auto-extracts `^\s*[-*]\s+` lines into `website/src/data/changelog.json`.

## Version Numbering

- **Web version** (`package.json`): SemVer, including prerelease tags for preview channel releases (e.g. `1.0.0`, `1.0.0-rc.1`)
- **APK versionName** (`android/app/build.gradle`): SemVer for native shell releases, independently versioned from Web resources (e.g. `1.5.0`, `1.5.0-rc.1`)
- **APK versionCode**: `major*1000000 + minor*10000 + patch*100 + stageCode`
  - stable: `stageCode = 99`
  - alpha.N: `stageCode = N` (`1..19`)
  - beta.N: `stageCode = 20 + N` (`21..49`)
  - rc.N: `stageCode = 50 + N` (`51..98`)
- Stable releases should update stable channel metadata; prerelease releases should update only `channels.prerelease` and use versioned OTA/APK asset paths.

## Release Checklist

1. Bump version in `package.json` and `android/app/build.gradle`
2. Run `npm run typecheck` — must pass
3. Run `./scripts/release.sh` — builds, publishes GitHub release, deploys website to EdgeOne Pages
4. Verify `version.json` is uploaded to GitHub release assets
5. Verify website is live at `https://ysu.welain.com`

## Project Notes

- Provider refactor validation: `pnpm run build` passed; Android cover-install from pre-refactor while preserving YSU login state kept core features working; provider switching remains untested.
- `docs/` directory is used to store local reference docs, **needn't be included in git**
