# AGENTS.md

本文件面向在本仓库工作的 AI agent。产品说明见 [README.md](README.md)，插件边界见 [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md)，包格式见 [插件 SDK](packages/plugin-sdk/README.md)。

当前项目处于开发阶段，请以项目代码，架构实现之 “干净，优雅” 为首要目标，而不是尝试兜底与向前兼容。为了达到这个首要目标，你有足够高的自由度，可将其作为自己的项目看待。

## 项目概览

酸橙盒（Orahako）是面向大学线上服务的第三方客户端。应用使用 Next.js 16 静态导出 + Capacitor 8 Android WebView 壳，支持 OTA；同一代码库也部署为 EdgeOne Pages 上的 Web PWA。默认提供燕山大学 Provider 与官方界面，其他学校、功能页面、主题和整个应用 Shell 都通过 Cordis 插件组合。

- **状态**：0.x 开发阶段。插件 API、清单、Slot / Provider 契约和共享模块导出均为 pre-stable；修改公共接口时必须同步所有消费者。
- **技术栈**：Next.js 16、React 19、Tailwind CSS v4、shadcn/ui、Zustand、Cordis 3。
- **Next.js 配置**：`output: "export"`、`distDir: "dist"`、`trailingSlash: true`、图片不优化；`basePath` 由 `APP_BASE_PATH` 控制（Web 部署为 `/app`，Capacitor 为空）。
- **包管理**：pnpm workspace，工作区包含 `packages/*`。
- **格式**：Prettier 无分号、双引号、100 列、Tailwind 类排序；格式化改动与功能改动分开提交。


## 命令

```bash
pnpm install
pnpm run dev              # Next.js dev server
pnpm run build            # 静态导出到 dist/，postbuild 生成 PWA shell
pnpm run typecheck        # next typegen + tsc --noEmit
pnpm run lint
pnpm run test             # Vitest
pnpm run format

pnpm plugin pack <plugin-dir> [output.zip]   # esbuild + ZIP，输出 SHA-256
npx cap sync              # 构建后同步 dist/ 到 android/
npx cap open android

cd website && pnpm dev
cd website && pnpm build
scripts/deploy-website.sh # 构建 APP_BASE_PATH=/app 并部署 EdgeOne Pages

pnpm run release          # 预检、创建草稿、编辑 notes、发布
```

`pnpm run build` 之后才能得到完整的静态产物；`scripts/plugin.ts` 依赖 `--experimental-transform-types`，通过 `pnpm plugin` 调用。

## 架构

### 分层

| 层 | 位置 | 职责 |
|---|---|---|
| 内核 | `lib/plugins/`、`app/` | Cordis 生命周期、ZIP 安装、页面宿主、崩溃恢复 |
| 公共 SDK | `packages/plugin-sdk/` | 清单、Provider 契约、Slot / UI / 服务类型、市场协议 |
| UI Kit | `packages/plugin-ui/`、`packages/academic/` | 官方 React 组件、hooks、stores 与共享教务 UI |
| 官方插件 | `plugins/official/` | Shell、初始化向导、YSU Provider、教务功能、默认主题 |
| 市场插件 | `plugins/market/` | 森空鸟、明日方舟主题、遵义医科大学 Provider 等 |
| Provider 运行时 | `providers/` | 当前 Provider 上下文、Provider 服务、缓存查询 hooks |
| 传输 / 原生 | `lib/cookie.ts`、`lib/native/`、`android/` | Cookie jar、边缘代理、通知、Live Update、小组件 |
| 站点 | `website/` | EdgeOne Pages、Web PWA 注入、边缘 API、插件市场 |

### 插件内核

- `components/plugin-provider.tsx` 启动 `lib/plugins/host.ts`；`components/plugin-shell.tsx` 负责 Shell 选择、默认 `orahako.shell:default` 回退和崩溃恢复。
- 内置插件注册表是 `plugins/official/registry.ts`。内置插件与外部插件使用同一套 `definePlugin`、清单和生命周期，不享有私有 UI 或数据接口。
- 外部 ZIP 经 `lib/plugins/package-store.ts` 存入 IndexedDB（`orahako-plugins`），由 `lib/plugins/external-loader.ts` 以 Blob 模块加载；React、Next 入口、`@orahako/plugin-sdk`、`@orahako/plugin-ui/*`、`@orahako/academic` 由宿主共享实例，清单见 `packages/plugin-sdk/host-modules.ts`。
- 安装、更新、回滚、重复崩溃安全模式和插件状态分别在 `host.ts`、`runtime.ts`、`recovery.ts` 中处理。外部包校验 SHA-256、`apiVersion`、平台和 `minAppVersion`；市场推荐组合包会先完整预检再执行。
- 页面与导航通过 `ctx.ui.registerPage()` / `registerNavigation()` 注册。静态导出不能为外部插件新增 Next.js 文件路由，统一页面宿主是 `app/dashboard/plugin/page.tsx`：
  `/dashboard/plugin/?plugin=<id>&page=<id>`。跨插件稳定语义使用 `route` / 导航 ID，由 `lib/plugins/navigation.ts` 解析，核心不按官方插件 ID 定位功能。
- Slot 通过 `ctx.slots.declare()` / `register()` 组合；支持 `single`、`list`、`keyed`，贡献随 Cordis 作用域释放。默认 Shell 的 Slot 集合定义在 `plugins/official/shell/index.tsx`。
- 登录后任务使用 `ctx.hostLifecycle.onProviderReady()`；不要恢复已删除的私有启动注册表。停用插件时必须同时停止其后台上传、轮询、闹钟和旧小组件数据。
- 插件与应用同权，可读取凭据、会话、网络和原生能力；不构成权限沙箱。侧载与更新只应面向可信来源。

### Provider 与认证

- Provider 契约位于 `packages/plugin-sdk/academic.ts`，学校配置位于 `provider-school.ts`；实现通常继承 `BaseProvider`。Provider 插件通过 `ctx.providers.registerSchool({ config, providerFactory })` 同时注册学校和工厂，作用域释放时自动撤销。
- `providers/provider-context.tsx`、`providers/provider-service.ts` 管理当前 Provider 的初始化、重登录和退出；UI 数据统一走 `providers/hooks/`，中心缓存路径是 `providers/hooks/use-provider-query.ts`。
- YSU 的 CAS / JWXT / 移动端 / 缴费协议与会话生命周期都在 `plugins/official/ysu/`。YSU CAS 可能落到 reAuth / MFA 页面，未确认 `isAuthenticated()` 不得视为登录成功；JWXT 重新授权暴露的 `NotAuthenticatedError` 应保持 `AUTH_SESSION_EXPIRED`。
- 外部 Provider 参考 `plugins/market/zmu-provider`，只使用公共 SDK。新增学校域名还必须加入 `website/edge-functions/api/proxy.js` 的 `ALLOWED_HOSTS`，插件注册本身不能绕过 Web 代理白名单。
- Provider 的 `capabilities` 与 `supportedPlugins` 共同决定功能是否可用：`supportedPlugins === undefined` 表示全部允许；否则只允许列出的功能插件。`lib/plugins/host.ts` 的 `reconcileProviderSupport()` 会停止不支持的功能插件，并在切回时仅恢复由 Provider 停用的项。
- `isAuthenticated` 与 `sessionExpired` 必须分开。会话过期时保留 `isAuthenticated=true`，由 `sessionExpired` 驱动提示；`components/sdk-provider.tsx` 不得因确认过期而退出登录或强制跳转。

### Cookie / 会话

- `lib/cookie.ts` 提供 `SimpleCookieJar`、`fetchWithJar` 与 Capacitor 传输。原生端 `HttpURLConnection` 自带 cookie store，但只作为传输层；JS jar 是会话事实来源，每次请求前同步，响应 `Set-Cookie` 再写回 jar。
- 不要用 WebView 的 `CookieManager` 代替或清理会话状态：它不会清理 `HttpURLConnection` 的 cookie store，容易留下脏 cookie 并触发 400。
- 响应头统一按小写处理，因为 CapacitorHttp 保留原始大小写（`Set-Cookie` / `set-cookie`）。
- YSU 的会话持久化链路是：登录成功保存 CASTGC 到安全存储；`initializeSession()` 恢复 CAS 凭据、JWXT 和 mobile 会话；Provider 调用后 `persistJWXTSession()` / `persistMobileSession()` 写回 auth-store；退出时由 Provider 的 `reset()` / `logout()` 清理 jar、auth-store、缓存和原生通知状态。

### UI / Shell / Slot

- 根布局 `app/layout.tsx` 只挂载 I18n、主题、`PluginProvider`、`PluginThemeManager`、`PluginShell` 和 PWA 组件；`app/dashboard/layout.tsx` 重导出默认 Shell 的 Dashboard 布局。
- 默认 Shell 的侧边栏、移动顶栏、底部导航、登录门禁和过期登录横幅都在 `plugins/official/shell/dashboard-layout.tsx`，不要在核心代码里重复实现。
- 功能插件通过 `settings.*` Slot 贡献设置区块、启动页选项、通知内容和小组件入口；总览挂件由实际功能插件注册，不得由一个聚合插件代注册。停用插件后对应 UI 必须自动消失。
- 外部插件只能导入公共模块：`@orahako/plugin-sdk*`、`@orahako/plugin-ui/*`、`@orahako/academic`、共享的 React / Next / Sonner。禁止 `@/` 私有导入。
- 已移除的旧聚合层（`lib/dashboard-nav.*`、`lib/dashboard-features.*`、`lib/extras/`、`lib/fees/` 注册表、`lib/api.ts`、`lib/types.ts`、`lib/use-cached-data.ts`）不要恢复；对应能力应落到插件注册中。

### 存储 / 原生 / PWA

- 凭据与 auth-store 使用 `lib/storage/secure.ts` 的 Capacitor Secure Storage；Web 回退仍是 Capacitor 风格前缀的 localStorage。键名统一来自 `lib/storage/keys.ts`，不要硬编码旧前缀。
- Provider 持久缓存由 `providerCacheKey()` 生成，前缀来自 `STORAGE_KEYS.cachePrefix`；缓存逻辑在 `lib/storage/cache.ts`。
- `CapacitorHttp.enabled: true` 是访问学校系统的前提；Web 浏览器流量统一走同源 `/api/proxy`（`proxyHttpSend`），不存在直连 CORS 问题。
- 原生桥接位于 `lib/native/`，Android 实现在 `android/app/src/main/java/me/uwen/orahako/`（通知、Live Update、桌面小组件、文件桥）。通知深链使用 `orahako://schedule` 等语义 ID，由 `lib/navigation/deep-link.ts` 在运行时解析到插件页面。
- Capacitor 配置：`appId: "me.uwen.orahako"`，`CapacitorUpdater.autoUpdate: false`，`appReadyTimeout: 15000`。更新检查在 `lib/updater.ts`。

### Website / 市场

- `website/` 是 Astro 6 服务承载站点：`/` 跳转 `www.welain.com`，`/faq` 内联 WebView 兼容性文档，`/admin` 提供统计与公告管理；Web PWA 位于 `/app`。
- 边缘函数：`api/proxy.js`（教务代理）、`api/activate.js`、`api/stats.js`、`api/announcement.js`、`api/admin.js`、`updates/announcement.json.js`、`updates/plugins.json.js`。
- 代理按 `ALLOWED_HOSTS` 和 `ALLOWED_ORIGINS` 白名单转发；带凭据的上游 URL 使用 `x-proxy-target`，避免进入代理请求日志。配置 `ACTIVATION_TOKEN` 后，代理强制校验激活凭证，客户端 `ActivationGate` 只是体验层。
- 插件市场索引由 `website/edge-functions/updates/plugins.json.js` 提供，客户端地址是 `https://ysu.welain.com/updates/plugins.json`；ZIP 位于 `website/public/plugins/<id>/<version>.zip`。索引中的 `sha256`、`size`、`apiVersion`、平台和 `minAppVersion` 必须与实际包一致。
- `scripts/deploy-website.sh` 以 `APP_BASE_PATH=/app` 构建并注入 `website/public/app/`，再在 `website/` 下执行 `edgeone makers deploy`。
- 不提交生成产物：`dist/`、`packages/*/dist/`、`plugins/**/dist/`、`plugins/**/*.zip`、`website/dist/`、`website/.edgeone/`、`website/public/app/`、`website/public/updates/`。`website/public/plugins/` 下的市场 ZIP 是发布资产，需要提交并让索引哈希与之匹配。

### 测试

- `vitest.config.ts` 使用 Node 环境，覆盖 `providers/`、`lib/`、`app/`、`packages/`、`plugins/`；路径别名直接指向源码。
- 测试显式从 `vitest` 导入，不使用全局变量。
- 修改插件运行时、Provider 查询语义或清单校验时，先跑对应测试；完成前至少运行 `pnpm run typecheck` 和受影响的 `pnpm run test`。

## 发布

### 版本号

- **Web 版本**（`package.json`）：SemVer，可带 prerelease，如 `0.15.0`、`0.15.0-rc.1`。
- **APK versionName**（`android/app/build.gradle`）：独立 SemVer，如 `1.6.0`。
- **APK versionCode**：`major*1000000 + minor*10000 + patch*100 + stageCode`
  - stable：`99`
  - alpha N：`1..19`
  - beta N：`20 + N`（`21..49`）
  - rc N：`50 + N`（`51..98`）

### 更新说明

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

- 分类顺序固定为：新功能 → Bug 修复 → 改进；没有内容时省略该分类。
- Bug 修复写清技术根因；功能与改进写清用户可见行为。
- 末尾保留 `**Full Changelog**` 链接。

### 发布流程

1. 更新 `package.json` 与 `android/app/build.gradle` 的版本号。
2. 运行 `pnpm run typecheck`。
3. 运行 `./scripts/release.sh`：预检（stable 必须来自 `main`、工作区干净、提交已推送、tag 不存在）→ 创建草稿 → 编辑 notes → 发布。
4. 用 `gh run watch` 等待 `.github/workflows/release.yml` 完成。
5. 用 `gh release view` 确认 `dist.zip`、`app-release-*.apk`、`version.json` 三个产物已上传。
6. 发布后修改 notes 时，重新运行 release.yml 以同步 `version.json`；草稿阶段的编辑不会触发构建。

prerelease 合并后的 manifest 会同步覆盖到最新 stable release，因为 OTA 检查固定使用 `releases/latest/download/version.json`。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
