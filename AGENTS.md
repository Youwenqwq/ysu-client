# AGENTS.md

本文件面向在本仓库工作的 AI agent。产品说明见 [README.md](README.md)，插件边界见 [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md)，包格式见 [插件 SDK](packages/plugin-sdk/README.md)。

当前项目处于开发阶段，请以项目代码，架构实现之 “干净，优雅” 为首要目标，而不是尝试兜底与向前兼容。为了达到这个首要目标，你有足够高的自由度，可将其作为自己的项目看待。

## 项目概览

酸橙盒（Orahako）是面向大学线上服务的第三方客户端。应用使用 Next.js 16 静态导出 + Capacitor 8 Android WebView 壳，支持 OTA；同一代码库也可部署为 EdgeOne Pages 上的 Web PWA。应用由 `CompositionSource` 组合：官方入口是 `app/composition.ts`，composition 只描述身份、默认项、市场与插件行，运行时服务与官方功能都作为普通插件挂载。默认提供燕山大学 Provider 与官方界面，其他学校、功能页面、主题、整个应用 Shell 乃至另一套应用都通过 composition 与插件组合。

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

pnpm plugin pack <plugin-dir> [output.zip]   # esbuild + Tailwind CSS + ZIP，输出 SHA-256
npx cap sync              # 构建后同步 dist/ 到 android/
npx cap open android
cd android && ./gradlew verifyNativeComposition testDebugUnitTest   # provider/widget 选择与占位符检查

cd website && pnpm dev
cd website && pnpm build
scripts/deploy-website.sh # 构建 APP_BASE_PATH=/app 并部署 EdgeOne Pages

pnpm run release          # 预检、创建草稿、编辑 notes、发布
```

`pnpm run build` 之后才能得到完整的静态产物；`scripts/plugin.ts` 是 CLI，打包实现与插件 Tailwind CSS 编译在 `scripts/plugin-build.ts`，两者依赖 `--experimental-transform-types`，通过 `pnpm plugin` 调用。

## 架构

### 分层

| 层              | 位置                                        | 职责                                                |
| --------------- | ------------------------------------------- | --------------------------------------------------- |
| 内核            | `lib/plugins/`、`app/` 路由宿主             | CompositionSource、Cordis 运行时、ZIP 安装、恢复、通用 Native bridge |
| 应用组合        | `app/composition.ts`、`app/composition/`    | 选择官方 `CompositionSource`、应用身份与首页行为    |
| 通用运行时服务  | `plugins/official/runtime/`                 | 以普通插件提供 `ui` / `slots` / `settings` / `notifications` / `i18n` / `storage` / `http` / `native` / `assets` / `plugins` / `analytics` / `announcement` / `updater` / `mfa` |
| 可选教务运行时  | `plugins/official/runtime/{providers,provider,query,session,navigation,provider-support}` | 仅在教务 composition 中装配的 `providers` / `provider` / `query` / `session` / `navigation` 与支持策略 |
| 公共 SDK        | `packages/plugin-sdk/`                      | 清单、组合、Provider 契约、Slot / UI / 服务类型、事件、市场协议 |
| UI Kit          | `packages/plugin-ui/`、`packages/academic/` | 官方 React 组件、hooks、stores 与共享教务 UI        |
| 官方插件        | `plugins/official/`                         | `plugins/official/composition.ts`、Shell、初始化向导、YSU Provider、教务功能、默认主题 |
| 可选官方插件    | `Youwenqwq/orahako-official-plugins`        | 森空鸟、主题、学校 Provider 与完整外部功能插件      |
| 传输 / 原生     | `plugins/official/runtime/http/`、`plugins/official/runtime/native/`、`@orahako/plugin-sdk/native`、`android/` | Cookie jar、边缘代理、原生能力、通知、Live Update、小组件 |
| 站点            | `website/`                                  | EdgeOne Pages、Web PWA 注入、边缘 API、插件市场     |

### 插件内核与组合

- 官方应用入口是 `app/composition.ts`：`app/layout.tsx` 只挂载它导出的 `AppComposition`，`app/page.tsx` 只渲染 `AppHome`。`AppComposition`（`app/composition/providers.tsx`）把 `officialCompositionSource` 传给内核 `PluginProvider`，由 `lib/plugins/host.ts` 的单例 `PluginHost` 启动；`components/plugin-shell.tsx` 负责 Shell 选择、`composition.defaults.shell` 回退和崩溃恢复。内核 `PluginProvider` 不再导入官方实现。
- `CompositionSource` 由 `appVersion`、纯数据的 `AppComposition`、可执行 `plugins` 和可选 `layers` 组成。composition 行只有 `{ id, config, protected, disabled }`；`layers` 按顺序浅合并 `defaults`、对插件行做 `config` / `protected` / `disabled` 整体替换并可 `insert`，不能删除条目。未知 ID、重复插入和重复模块必须抛错。
- 应用身份由 `CompositionIdentity` 描述，`app/composition/identity.ts` 导出同一份值（来源为 `plugins/official/app-config.ts`）：`capacitor.config.ts`、`app/layout.tsx` 和 `app/manifest.ts` 读取静态元数据，运行时深链从 `host.composition.identity` 读取。更换 identity 时两处必须同步。Android 应用标签/图标/`applicationId` 仍来自 Android 资源、`app/build.gradle` 与 manifest 占位符。
- 内置插件注册表是 `plugins/official/registry.ts`，`plugins/official/composition.ts` 是官方 `CompositionSource` 的实现模块（由 `app/composition/providers.tsx` 选择），不是应用入口。内置插件与外部插件使用同一套 `definePlugin`、清单和生命周期，不享有私有 UI 或数据接口。
- 外部 ZIP 经 `lib/plugins/package-store.ts` 存入 IndexedDB（`orahako-plugins`），由 `lib/plugins/external-loader.ts` 以 Blob 模块图加载；React、实际使用的 Next 入口、`packages/plugin-sdk/host-modules.ts` 中列出的 `@orahako/plugin-sdk` 子路径、`@orahako/plugin-ui/*`、`@orahako/academic`、`sonner` 由宿主共享实例。外部包只能使用包内相对 import 和该清单中的裸说明符；其他裸导入或循环依赖加载失败。
- 安装、更新、回滚、重复崩溃安全模式和插件状态分别在 `host.ts`、`runtime.ts`、`recovery.ts` 中处理。外部包校验 `apiVersion === 2`、entry/styles/icon、ZIP 路径与大小限制、`nativeCapabilities` 是否在 composition 允许列表内；市场安装还校验 SHA-256、平台和 `minAppVersion`。推荐组合包会先完整预检再执行，更新失败恢复旧包。
- 运行时服务本身也是普通插件：`plugins/official/runtime/registries.ts` 提供 `ui` / `slots` / `settings` / `notifications` / `i18n`，`storage` / `http` / `native` / `assets` / `plugins` / `analytics` / `announcement` / `updater` 分别在 `runtime/` 下实现，`shell/mfa-service.ts` 提供 `mfa`。这些是通用应用服务，实例属于各自 Cordis 插件作用域；官方 composition 通过 `provides` / `inject` 消费，不要恢复模块级单例。
- 教务运行时是可选的：`runtime/providers.ts`（`providers`）、`runtime/session.ts`、`runtime/provider.ts`、`runtime/query.ts`、`runtime/navigation.ts` 与 `runtime/provider-support.ts` 只在教务 composition 中装配；这些后端服务实例属于各自插件作用域，不是 `PluginHost` getter。`lib/plugins/community-composition.test.ts` 验证只选通用注册表 + 社区 Shell 时 `provider` / `session` / `query` 不存在也能启动。`AcademicPluginContext` 仅用于这些服务已存在的官方学术 UI。
- 内核 `PluginHost` 只保留路由宿主与默认 Shell 需要的 `ui` / `slots` / `notifications` / `settings` / `i18n` / `navigation` getter，不提供 `provider` / `session` / `query` 等学术或后端 getter；插件必须通过 scoped `PluginContext` 使用服务，不要 import 宿主实现。
- 服务消费者在清单 `inject` 中声明必需根服务。运行时把清单 `inject` 全部视为 required；缺失时插件不会执行，`startAndWait` 抛 `PluginDependencyError`。提供方必须在 `apply` 完成后满足 `provides`，否则进入 `failed`。
- 根服务被释放、随后注册同名新服务时，注入该服务的消费者会被停用并在新服务就绪后重启；未注入者不受影响。`PLUGIN_SERVICE_SCOPE`（`Symbol.for("orahako.plugin-service.scope")`）让注册表返回按消费者绑定、可自动撤销的 facade，注册归属用公开的 `trackPluginRegistration()`（`@orahako/plugin-sdk`）维护。
- `configSchema` 是 JSON Schema draft-07，由 Ajv 启用了 `default` 填充后在启动前校验。composition 条目的 `config` 是唯一配置来源；外部安装包以空对象校验，因此外部插件必须自带默认行为，不能假设用户编辑配置。
- 插件依赖使用 `requires: Record<pluginId, SemVerRange>`，不是 `inject`。停用插件会级联停用依赖项；同 ID 更新替换不级联。
- 页面与导航通过 `ctx.ui.registerPage()` / `registerNavigation()` 注册。静态导出不能为外部插件新增 Next.js 文件路由，统一页面宿主是 `app/dashboard/plugin/page.tsx`：`/dashboard/plugin/?plugin=<id>&page=<id>&route=<semantic>`。跨插件稳定语义使用 `route` / 导航 ID，由 `ctx.navigation`（实现位于 `plugins/official/runtime/navigation/`）解析，核心不按官方插件 ID 定位功能。导航默认为 `scope: "app"`；`scope: "plugin"` 声明插件内部主功能，默认 Shell 在对应插件活动时以其替换移动端底部导航，可用 `params` 指向同页功能区。
- Slot 通过 `ctx.slots.declare()` / `register()` 组合；支持 `single`、`list`、`keyed`，贡献随 Cordis 作用域释放。默认 Shell 的 Slot 集合定义在 `plugins/official/shell/index.tsx`，当前包括 `shell.overlay`、`shell.activity`、`dashboard.header.actions`、`settings.startupOptions`、`settings.widgets`。
- 登录后任务使用 `ctx.on("provider/ready", handler)`；先检查 `ctx.provider.getSnapshot().status` 再订阅，保证幂等。事件还有 `provider/changed`、`session/changed`、`session/expired`、`query/invalidate`，声明见 `packages/plugin-sdk/events.ts`。不要恢复已删除的私有启动注册表或旧生命周期服务。
- 停用插件时必须同时停止其后台上传、轮询、闹钟和旧小组件数据；只释放 Cordis 服务不会自动撤销未通过 disposer 注册的原生副作用。
- 插件与应用同权，可读取凭据、会话、网络和原生能力；不构成权限沙箱。侧载与更新只应面向可信来源。

### Provider / 教务运行时

- Provider 契约位于 `packages/plugin-sdk/academic.ts`，运行时最小生命周期 `ManagedProvider` 位于 `provider-runtime.ts`；`ProviderFactory` 返回 `ManagedProvider`，实现通常继承 `BaseProvider`。Provider 插件通过 `ctx.providers.registerProvider(schoolId, factory)` 注册工厂，作用域释放时自动撤销。Provider 工厂接收贡献者的 scoped `PluginContext`，因此实例可以使用贡献插件自己的服务作用域；学校协议字段由各 Provider 插件自行定义，不进入 SDK。
- `ctx.provider` 是当前 Provider 的唯一运行时（实现 `plugins/official/runtime/provider/runtime.ts`）：`selectSchool()` 显式选择，`initialize()` / `reset()` / `logout()` / `relogin()` 处理生命周期，每次异步操作绑定 generation，旧初始化不能覆盖新实例。未注册学校不回退到其他学校；运行时只依赖 `ManagedProvider` 最小生命周期，不要求学校配置或学术能力字段。
- `packages/plugin-ui/provider.tsx` 是 React 适配层，镜像 `ctx.provider` 快照并按用户设置选择学校；通用 Provider 查询在 `packages/plugin-ui/use-provider-query.ts`（键与策略来自 `ctx.query`），学术数据 hooks 位于 `packages/academic/hooks/`。
- `ProviderPluginRegistry` 的条目只有学校 ID（键）、`ProviderFactory` 与贡献插件的上下文；没有学校目录、`SchoolConfig`、`server-config` 或根目录 `providers/`。学校只来自插件注册；同一 ID 的新注册替换旧工厂，旧 disposer 不能撤销新条目。
- YSU 的 CAS / JWXT / 移动端 / 缴费协议与会话生命周期都在 `plugins/official/ysu/`，通过 `session` / `query` / `native` / `mfa` 等服务工作。YSU CAS 可能落到 reAuth / MFA 页面，未确认 `isAuthenticated()` 不得视为登录成功；JWXT 重新授权暴露的 `NotAuthenticatedError` 应保持 `AUTH_SESSION_EXPIRED`。
- 外部 Provider 参考 `Youwenqwq/orahako-official-plugins` 的 `plugins/zmu-provider`，只使用公共 SDK。新增学校域名还必须加入 `website/edge-functions/api/proxy.js` 的 `ALLOWED_HOSTS`，插件注册本身不能绕过 Web 代理白名单。
- Provider 的 `capabilities` 与 `supportedPlugins` 共同决定功能是否可用：`supportedPlugins === undefined` 表示全部允许；否则只允许列出的功能插件。`orahako.runtime.provider-support` 是普通运行时插件（`inject: ["provider", "pluginManager"]`），监听 `provider/changed` 并停止/恢复由 Provider 限制的功能插件；不要恢复 `PluginHost` 上的 `reconcileProviderSupport()` 或同类宿主方法。`providerIndependent` 只豁免运行时停止；页面需 `requiresProvider: false`，导航仍受允许列表过滤。
- `isAuthenticated` 与 `sessionExpired` 必须分开。会话过期时保留 `isAuthenticated=true`，由 `sessionExpired` 驱动提示；`plugins/official/shell/components/sdk-provider.tsx` 不得因确认过期而退出登录或强制跳转。

### 会话、查询与事件

- `ctx.session` 暴露 `SessionSnapshot`（活动学校、凭据、用户名、登录/过期状态、artifacts）与 `setCredential()` / `activateSchool()` / `clearCredential()` / `setSessionExpired()` / artifact 读写；不包含学校专属字段名。
- `createCookieJar()` 与 `fetchWithJar()` 是会话传输入口。`plugins/official/runtime/http/cookie.ts` 仍是 CookieJar 实现，JS jar 是会话事实来源。
- `ctx.query` 提供 `key()` / `cacheKey()` / `policy()` / `registerPolicy()` / 持久缓存读写 / `invalidate()`。持久键包含 provider、`providerScope`（学校 ID + Provider generation）、用户名、feature 和参数；失效只作用于 Provider 查询族。
- 公共事件通过 `packages/plugin-sdk/events.ts` 的 Cordis 声明合并提供：`session/changed`、`session/expired`、`provider/changed`、`provider/ready`、`query/invalidate`。插件使用 `ctx.on(...)`，事件随作用域释放。
- `ctx.navigation` 提供 `sources()` / `resolve()` / `primary()` / `landing()` / `forScope()`；语义解析统一考虑页面 `route`、导航 ID、Provider `capabilities` 和 `supportedPlugins`。不要在 Shell 或核心代码里硬编码插件 ID 到功能。

### Cookie / 会话

- `plugins/official/runtime/http/cookie.ts` 提供 `SimpleCookieJar`、`fetchWithJar` 与 Capacitor 传输。原生端 `HttpURLConnection` 自带 cookie store，但只作为传输层；JS jar 是会话事实来源，每次请求前同步，响应 `Set-Cookie` 再写回 jar。
- 不要用 WebView 的 `CookieManager` 代替或清理会话状态：它不会清理 `HttpURLConnection` 的 cookie store，容易留下脏 cookie 并触发 400。
- 响应头统一按小写处理，因为 CapacitorHttp 保留原始大小写（`Set-Cookie` / `set-cookie`）。
- YSU 的会话持久化链路是：登录成功保存 CASTGC 到安全存储；`initializeSession()` 恢复 CAS 凭据、JWXT 和 mobile 会话；Provider 调用后 `persistJWXTSession()` / `persistMobileSession()` 写回 auth-store；退出时由 Provider 的 `reset()` / `logout()` 清理 jar、auth-store、缓存和原生通知状态。

### UI / Shell / Slot

- 根布局 `app/layout.tsx` 只挂载 `app/composition.ts` 导出的 `AppComposition`；官方组合在 `app/composition/providers.tsx` 中挂载 I18n、主题、`PluginProvider`、`PluginThemeManager`、`PluginShell` 和 PWA 组件。`app/dashboard/layout.tsx` 从活动 Shell 取 `layout`，不导入官方 Shell 实现。
- Shell 通过 `ctx.ui.registerShell()` 注册，组件接收 `{ context, children, selectShell }`。`context` 是该 Shell 所属插件的作用域 `PluginContext`；Shell 可以包装、替换或忽略 `children`，`selectShell(undefined)` 恢复 composition 默认 Shell。
- 页面组件接收 `{ context, pluginId, pageId, params, navigate }`；`context` 同样是注册页面插件的作用域。不要在页面里通过 `usePluginHost()` 之类的宿主入口获取 registry，优先使用 `context.ui` / `context.slots` / `context.navigation` 等公共契约。
- 默认 Shell 的侧边栏、移动顶栏、底部导航、登录门禁和过期登录横幅都在 `plugins/official/shell/dashboard-layout.tsx`，不要在核心代码里重复实现。
- 功能插件通过 `ctx.settings.registerCategory()` 注册分类面板，通过 `settings.*` Slot 贡献启动页选项、通知子节和小组件入口；不要把分类面板重新散落到主设置页。总览挂件由实际功能插件注册，不得由一个聚合插件代注册。停用插件后对应 UI 必须自动消失。
- `orahako.notifications` 拥有唯一通知设置分组与原生运行时；功能插件通过 `settings.notifications.*` 贡献自己的 UI，并用 `ctx.notifications.register()` 注册运行时渠道。渠道是开放字符串，注册按插件归属并随作用域撤销，不要在 Shell、YSU 或设置页恢复按插件 ID 硬编码的通知协调。
- 网络活动通过 `ctx.http.activity.getSnapshot()` / `subscribe()` 读取；`registerLabeler()` 返回本插件注册的 i18n key，`registerClassifier()` 提供粗分类，回调内可见 URL，快照只暴露分类、方法、单调时间、耗时与失败计数。`shell.activity` Slot 负责默认 Shell 的顶栏组合。
- 外部插件只能导入公共模块：`@orahako/plugin-sdk` 根入口与 `packages/plugin-sdk/host-modules.ts` 列出的子路径、`@orahako/plugin-ui/*`、`@orahako/academic`、共享的 React / Next / Sonner。禁止 `@/` 私有导入，也不存在 `@orahako/plugin-sdk/host`。仓库内官方插件可以使用 `@/` 仓库导入，但不得把宿主内部实现当作外部插件契约。
- 外部插件的 Tailwind 工具类由 `pnpm plugin pack` 编译进插件 ZIP 的 `dist/tailwind.css`；宿主只提供 `app/globals.css` 的 `@theme inline` token 映射、preflight 和共享组件样式。`app/globals.css` 用 `source(none)` 只扫描宿主目录，不要恢复对外部插件源码的扫描；否则插件漏带样式会被宿主掩盖。
- 已移除的旧聚合层（`lib/dashboard-nav.*`、`lib/dashboard-features.*`、`lib/extras/`、`lib/fees/` 注册表、`lib/api.ts`、`lib/types.ts`、`lib/use-cached-data.ts`）不要恢复；对应能力应落到插件注册中。

### 存储 / 原生 / PWA

- 凭据与 auth-store 使用 `plugins/official/runtime/storage/secure.ts` 的 Capacitor Secure Storage；Web 回退仍是 Capacitor 风格前缀的 localStorage。键名统一来自 `plugins/official/runtime/storage/keys.ts`，不要硬编码旧前缀。
- 插件存储统一通过 `ctx.storage.local` / `ctx.storage.secure`，宿主自动加 `orahako-plugin:<plugin-id>:` 命名空间；不要在插件代码里自行拼全局键。
- Provider 持久缓存键由 `ctx.query.cacheKey()` 生成，前缀来自 `STORAGE_KEYS.cachePrefix`；TTL 与是否持久化由 `ctx.query.policy()` / `registerPolicy()` 决定，底层缓存在 `plugins/official/runtime/query/cache.ts`。
- `CapacitorHttp.enabled: true` 是访问学校系统的前提；Web 浏览器流量统一走同源 `/api/proxy`（`proxyHttpSend`），不存在直连 CORS 问题。
- 原生桥接与平台检测位于 `packages/plugin-sdk/native.ts`，只暴露版本化能力；Android 实现在 `android/` 的 companion 模块中。`NativeCompanion` 只调用 `describe` / `acquire` / `release` / `invoke`，不包含业务能力名。插件应优先使用 scoped `ctx.native`；官方通知/课堂提醒与小组件 wrapper 属于 `plugins/official/runtime/native/`，provider 身份和 polling adapter id 由调用方传入。没有 `lib/native/` 通用实现目录。
- Android 原生侧按 `android/nativeComposition.gradle` 组合：`:native-core` 是通用桥、`NativeCompositionProvider` 契约与注册表；`:native-official` 是官方 provider；`:native-platform` / `:native-academic` / `:native-ysu` / `:native-widgets` / `:native-widgets-schedule` / `:native-widgets-exam` 是 companion。app 只依赖 `:native-core` 与所选 provider 模块，provider 类名经 `BuildConfig.NATIVE_COMPOSITION_PROVIDER` 传给 `NativeComposition.installFromProvider()`；app 源码不得导入 `OfficialNativeComposition` 或 widget 模块。通用 widget host 可独立于 schedule/exam companion 选择。
- Android 模块 manifest 各自声明权限、receiver/service/FileProvider 与 deep link，`app/src/main/AndroidManifest.xml` 只保留内核 launcher 与 `INTERNET`。通用模块必须使用 `${applicationId}.MainActivity`、`${orahakoDeepLinkScheme}`、`${orahakoDeepLinkHost…}` 占位符，不得硬编码宿主 activity 或 `orahako://`；scheme/hosts 由 `nativeComposition.gradle` 注入。
- `android/app/src/main/assets/native-companion.json` 是构建时的能力清单（version 1、版本化 ID、静态 config）。新增能力必须同时有 Kotlin 工厂、JS 侧调用约定、`nativeCapabilities` 清单声明、该 JSON 条目和所属模块 manifest；未知 ID/工厂不匹配会让原生组合失败。ZIP 不能注入原生模块。
- 通知深链使用 `orahako://schedule` 等语义 ID，由 `lib/navigation/deep-link.ts` 在运行时解析到插件页面；scheme 来自 composition identity 的 `deepLinkScheme`，未知 scheme 不处理。
- Capacitor 配置：`appId` 来自 `CompositionIdentity.applicationId`（官方为 `me.uwen.orahako`），`CapacitorUpdater.autoUpdate: false`，`appReadyTimeout: 15000`。更新检查在 `plugins/official/runtime/update/service.ts`。

### Website / 市场

- `website/` 是 Astro 6 服务承载站点：`/` 跳转 `www.welain.com`，`/faq` 内联 WebView 兼容性文档，`/admin` 提供统计与公告管理；Web PWA 位于 `/app`。
- 边缘函数：`api/proxy.js`（教务代理）、`api/activate.js`、`api/stats.js`、`api/announcement.js`、`api/admin.js`、`updates/announcement.json.js`、`updates/plugins.json.js`。
- 代理按 `ALLOWED_HOSTS` 和 `ALLOWED_ORIGINS` 白名单转发；带凭据的上游 URL 使用 `x-proxy-target`，避免进入代理请求日志。配置 `ACTIVATION_TOKEN` 后，代理强制校验激活凭证，客户端 `ActivationGate` 只是体验层。
- 插件市场的唯一元数据来源是 Private 仓库 `Youwenqwq/orahako-plugin-registry`。`website/edge-functions/updates/plugins.json.js` 是由该仓库 `pnpm run sync:website` 生成的公开分发快照，不要手工编辑；客户端地址是 `https://ysu.welain.com/updates/plugins.json`。ZIP 位于 `website/public/plugins/<id>/<version>.zip`，索引中的 `sha256`、`size`、`apiVersion`、平台和 `minAppVersion` 必须与实际包一致。
- `scripts/deploy-website.sh` 以 `APP_BASE_PATH=/app` 构建并注入 `website/public/app/`，再在 `website/` 下执行 `edgeone makers deploy`。
- 不提交生成产物：`dist/`、`packages/*/dist/`、`plugins/**/dist/`、`plugins/**/*.zip`、`website/dist/`、`website/.edgeone/`、`website/public/app/`、`website/public/updates/`。`website/public/plugins/` 下的市场 ZIP 是发布资产，需要提交并让索引哈希与之匹配。

### 测试

- `vitest.config.ts` 使用 Node 环境，覆盖 `lib/`、`app/`、`packages/`、`plugins/`、`scripts/`；路径别名直接指向源码。
- 测试显式从 `vitest` 导入，不使用全局变量。
- 修改插件运行时、Provider 查询语义或清单校验时，先跑对应测试；完成前至少运行 `pnpm run typecheck` 和受影响的 `pnpm run test`。
- 改动 composition 分层时至少覆盖：`lib/plugins/community-composition.test.ts` 的非教务应用（无 `provider` / `session` / `query` 启动）、`plugins/official/runtime/provider-support.test.ts` 的学校允许列表策略、`lib/plugins/composition.test.ts` 的 layer 校验。
- Android 改动先运行 `cd android && ./gradlew verifyNativeComposition testDebugUnitTest`；它只验证 provider 类、模块清单与占位符，不代表真机验证。

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
