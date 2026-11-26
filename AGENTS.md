# AGENTS.md

本文件面向在本仓库工作的 AI agent。产品说明见 [README.md](README.md)，插件边界见 [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md)，清单、SDK 示例和包格式见 [API v1 SDK](packages/core/sdk/README.md)。

当前项目处于开发阶段，请以项目代码，架构实现之 “干净，优雅” 为首要目标，而不是尝试兜底与向前兼容。为了达到这个首要目标，你有足够高的自由度，可将其作为自己的项目看待。

## 项目概览

酸橙盒（Orahako）使用 Next.js 16 静态导出与 Capacitor 8 Android WebView，支持 OTA；Web PWA 部署在 EdgeOne Pages。官方应用按 `platform → academic → ysu` 组合纯数据 Bundle；不含教务运行时的非教务组合也能启动。

- **状态**：0.x 开发阶段。插件 API、清单、Slot / Provider 契约和共享模块导出均为 pre-stable；修改公共接口时必须同步所有消费者。
- **技术栈**：Next.js 16、React 19、Tailwind CSS v4、shadcn/ui、Zustand、Cordis 3。
- **Next.js 配置**：`output: "export"`、`distDir: "dist"`、`trailingSlash: true`、图片不优化；`basePath` 由 `APP_BASE_PATH` 控制（Web 部署为 `/app`，Capacitor 为空）。
- **包管理**：pnpm workspace，API v1 包位于 `packages/<group>/<pkg>`，各自声明封闭 `exports` 和 `tsconfig.json`。
- **格式**：Prettier 无分号、双引号、100 列、Tailwind 类排序；格式化改动与功能改动分开提交。

## 命令

```bash
pnpm install
pnpm run dev              # Next.js dev server
pnpm run build            # 静态导出到 dist/，postbuild 生成 PWA shell
pnpm run typecheck        # next typegen + tsc --noEmit
pnpm run lint
pnpm run test             # Vitest
pnpm run verify-architecture
pnpm run format

pnpm plugin pack <plugin-directory> [output.zip]   # API v1 esbuild + Tailwind CSS + ZIP，输出 SHA-256
pnpm run build:packages                            # 编译发布到 npm 的 @orahako/{sdk,ui-primitives,academic-sdk,cli}
pnpm run publish:packages                          # 构建并发布上述 4 个公共 npm 包（需 npm 2FA）
npx cap sync              # 构建后同步 dist/ 到 android/
npx cap open android
cd android && ./gradlew verifyNativeComposition testDebugUnitTest   # provider/widget 选择与占位符检查

cd website && pnpm dev
cd website && pnpm build
scripts/deploy-website.sh # 构建 APP_BASE_PATH=/app 并部署 EdgeOne Pages

pnpm run release          # 预检、创建草稿、编辑 notes、发布
```

`pnpm run build` 含 `postbuild`，产出完整静态应用。`packages/core/cli`（`@orahako/cli`）实现 esbuild、Tailwind 隔离编译与 ZIP 校验（发布时预生成宿主设计 token 与 utility selector 快照）；仓库内 `scripts/plugin.ts` / `scripts/plugin-build.ts` 委托给它并实时读取 `app/globals.css`，通过 `pnpm plugin pack` 调用。

## 架构

### 包与组合

- `packages/core/` 提供 `@orahako/sdk`、Cordis 内核 `@orahako/kernel` 与 `@orahako/ui-primitives`。内核管理插件生命周期、ZIP、IndexedDB 与恢复，不导入官方 Shell、Provider 或教务服务。
- `packages/runtime/` 提供 slots（含唯一 `ui-renderer`）、router/navigation、ui、i18n、settings、storage、http、native/widgets 和 packages 服务；`packages/client/` 提供通用客户端 Shell、设置与其他界面插件。
- `packages/edu/{sdk,runtime,kit}` 提供可选教务切片契约、`providers` / `session` / `provider` / `query` 等运行时和共享教务工具。`packages/plugins/` 提供学校接入、教务界面与自治功能插件。
- `packages/bundle/{platform,academic,ysu}` 用 `defineBundle` 声明纯数据，应用通过 `composeBundles` 组合；`CompositionSource` 另传可执行插件。层只能增补、替换配置或停用条目。非教务组合不装教务服务，通用 Shell 和平台插件不得依赖它们。
- 包内不得使用 `@/`、`next/*` 或跨包私有路径；插件之间不得导入运行时值，类型用 `import type`。服务消费者通过 `inject`，不是实现导入。

### Cordis、状态与 HTTP

- `definePlugin({ manifest, inject, apply })` 只向 `apply` 暴露所声明的服务和生命周期 API。服务和事件用 Cordis 声明合并；清单 `inject` 是必需服务，`provides` 是 `apply` 后必须存在的服务，`requires` 才是插件 ID 与 SemVer 依赖。
- 使用 Cordis `ctx.effect` 等作用域机制持有注册与 disposer；`apply` 必须可重复运行。服务替换后消费者会重新挂载，不要用轮询等待服务或用双重强转访问未声明的服务。后台轮询、闹钟与小组件数据等原生副作用需要显式清理。
- 在 `apply` 内用 `defineStore` 定义的工厂创建插件 Store，持久化绑定 `ctx.storage` 的 local/secure 后端。命名空间自动加 `orahako-plugin:<id>:`；不建立全局键表或全局设置单例。词条由各插件用 `defineDictionary({ zh, en })` 定义。
- HTTP 中间件通过 `ctx.on("http/request", handler)` 和 `ctx.on("http/response", handler)` 注册；由 `ctx.http.send` 在传输前后执行 waterfall。会话使用 JS CookieJar，不用 WebView CookieManager 代替，保留原生响应头规范化和 CAPTCHA 的二进制响应。
- 新 Provider 用 `SchoolProvider` 与 `AcademicSliceMap` 按切片实现，工厂通过 `ctx.providers.registerProvider(schoolId, factory)` 注册。登录状态与会话过期分开；启动任务先检查当前状态再订阅 `provider/ready`。查询源由 `ctx.query` 提供，不在组件中请求或维护独立缓存。

### UI 与路由

- `app/layout.tsx`、`app/page.tsx`、`app/manifest.ts` 提供静态根入口。`ctx.router` 管理 `/?route=…` 或 `/?plugin=…&page=…`，处理历史、返回守卫和构建 base path；语义目标由 `ctx.navigation` 解析。不新增 Next.js 业务文件路由。
- `root` 是唯一预置 Slot。通过 `SlotMap` 扩展类型，在注册 `slots.register` / `ui.registerPage` / `settings.registerCategory` 等贡献时声明 `children`、`store`、`inject`，按需附加 `dictionary`。贡献依赖可选 Slot 时用 `slots.inject` 等待其声明。
- 唯一 `ui-renderer` 管理四份 Props：owner/`t`/`locale`、受 `children` 限制的渲染函数、`useStore`/`actions`、业务值/回调与由 `inject` 返回的 `hooks` 源派生的 `use<Name>`。组件不接触 `ctx`、业务 React Context、`useSyncExternalStore` 或 `useSWR`。
- 功能插件自己注册其设置、挂件与通知渠道；不在 Shell、通知协调器或设置页硬编码功能插件 ID。停用后贡献随作用域移除。

### ZIP、市场与构建产物

- 外部 ZIP 清单必须是 API v1，包内 ESM 只能引用包内相对路径与 SDK `PLATFORM_MODULES` 列出的裸说明符。打包器处理其他依赖与插件 Tailwind utilities；不让宿主扫描外部插件源码。外部 ZIP 与宿主同权，API 版本和模块约束不是安全沙箱。
- 外部 ZIP 清单必须声明 `apiVersion: 1`，非 API v1 的包会被内核拒绝。官方外部插件源码维护在 `Youwenqwq/orahako-official-plugins`；公开索引为 `https://raw.githubusercontent.com/Youwenqwq/orahako-plugin-registry/main/dist/plugins.json`，ZIP 也保存在该仓库 `dist/plugins/<id>/<version>.zip`；索引版本、平台、能力、最低应用版本（如声明）、`sha256` 和 `size` 必须与资产一致。不要在主仓库恢复市场边缘函数或 ZIP 副本。
- Web 代理位于 `website/edge-functions/api/proxy.js`，新增学校域名需同步部署端白名单。`scripts/deploy-website.sh` 以 `APP_BASE_PATH=/app` 构建静态应用并部署；不要提交 `dist/`、插件打包中间产物或 `website/public/app/`。

### Android 与验证

- JS 使用 scoped `ctx.native` / `ctx.widgets`；Android bridge 提供 `describe` / `acquire` / `release` / `invoke` 和能力事件。ZIP 不能新增原生模块或权限。`android/nativeComposition.gradle` 选 provider、companion 和 deep-link 配置。app 只依赖 `:native-core` 与所选 provider，不直接导入官方 provider 或 widget；`:native-widgets` 可不带 schedule/exam companion。
- 新原生能力要同步 Kotlin 工厂、`android/app/src/main/assets/native-companion.json`、所属模块 manifest、composition 允许列表与插件清单。通用模块使用 `${applicationId}.MainActivity` 和 deep-link 占位符；换应用身份时同步静态入口、Capacitor 配置和 Android 资源、应用 ID 与 deep-link 配置。
- 修改实现先跑受影响的 `pnpm run test` 用例；合入前运行 `typecheck`、`lint`、全量 `test`、`verify-architecture`、`build` 及外部 API v1 ZIP 打包。涉及 Android 时再验 `verifyNativeComposition testDebugUnitTest`；构建检查不代替 WebView、原生通知、闹钟、后台轮询、widget 与真实账号验收。

## 发布

### 版本号

- **Web 版本**（`package.json`）：SemVer，可带 prerelease，如 `0.16.0`、`0.16.0-rc.1`。
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

**Full Changelog**: https://github.com/Youwenqwq/orahako/compare/v{PREV}...v{CURR}
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
