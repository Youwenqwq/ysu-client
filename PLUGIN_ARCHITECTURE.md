# Orahako API v1 插件组合架构

Orahako 是由 Cordis 插件组合成的应用，而不是由固定 Next.js 页面控制的功能集合。内核负责 composition、插件生命周期、外部 ZIP、恢复和通用 Native bridge；服务、界面、Provider 与业务功能都由可替换包提供。插件与应用同权，不构成安全沙箱。

本文描述 API v1 当前契约。API v2 市场 ZIP 不兼容且会被拒绝，必须重新发布；没有迁移、降级或兼容加载路径。

## 包拓扑与依赖边界

API v1 Workspace 包位于 `packages/<group>/<package>`，各自拥有 `tsconfig.json` 和封闭的 `exports`。插件包之间不导入运行时值，可以用 `import type` 共享类型。包内不使用 `@/` 宿主别名、跨包私有路径或 `next/*`。

```text
app/                              静态根入口：layout.tsx、page.tsx、manifest.ts
packages/core/sdk                 @orahako/sdk：API、清单、SlotMap、Bundle、市场协议
packages/core/kernel              @orahako/kernel：PluginHost、ZIP、IndexedDB、恢复
packages/core/ui-primitives       无状态 UI 原语
packages/runtime/{slots,router,ui,i18n,settings,storage,http,native,packages}
packages/edu/{sdk,runtime,kit}    可选教务契约、运行时和无 React 算法
packages/client/*                 Shell、设置、资料、管理器、激活、更新、主题等
packages/plugins/*                Provider、横切插件和自治业务插件
packages/bundle/{platform,academic,ysu}
```

`@orahako/sdk` 是通用契约；`@orahako/academic-sdk` 定义可选教务契约。`@orahako/kernel` 不导入官方 Shell、学校 Provider、教务服务或业务插件。唯一的 `ui-renderer` 位于 [`packages/runtime/slots/src/renderer.tsx`](packages/runtime/slots/src/renderer.tsx)，负责把 ObservableSource 接入 React。

## 三层 Bundle 与可选教务

[`app/composition/source.ts`](app/composition/source.ts) 用 `composeBundles` 按 `platform → academic → ysu` 组装 `AppComposition`，再应用部署配置层。Bundle 只声明插件行、默认值、原生能力、应用身份与市场等数据；`CompositionSource` 单独传入可执行插件、`appVersion` 和 `appBuild`，由 `PluginHost` 启动。

- `platform` 选择通用运行时与客户端插件，包括默认 Shell、设置和插件管理器。
- `academic` 增加 `providers`、`session`、`provider`、`query` 等教务服务，以及认证、总览和教务功能插件。
- `ysu` 增加燕山大学 Provider，设置默认学校、应用身份和市场，并补充部署配置。

非教务应用只需选择 `platform`（可选配自己的 Shell 和功能插件），不应叠加 `academic` 或依赖它的 `ysu`。通用插件必须能在没有 `provider`、`session`、`query` 的情况下启动。层可插入条目、替换整份插件配置或停用条目，不会删除条目；重复条目和未知 patch ID 会报错。

Activation 只由 `scripts/deploy-website.sh` 的 `APP_DEPLOYMENT=edgeone-pwa` 构建插入，用于 EdgeOne 同源代理鉴权；Android 和普通 platform 组合不安装该插件，Native 直连也不会发送 `x-activation`。YSU 专属的 Meter 位于 `ysu` 层，不属于通用平台层。

## 静态入口与根查询路由

`app/layout.tsx` 与 `app/manifest.ts` 提供静态外壳和 PWA 元数据，`app/page.tsx` 挂载客户端 composition，由 `OrahakoApp` 渲染。插件不新增 Next.js 文件路由；所有页面都以应用根路径的查询参数定位：

```text
/?route=<semantic-route>
/?plugin=<plugin-id>&page=<page-id>
```

用 `ctx.ui.registerPage()` 注册页面和稳定语义 `route`。`ctx.router` 提供 `push`、`replace`、`back`、`href` 与返回守卫，并处理部署 base path（例如 Web 的 `/app/`）。语义目标（含 PWA 快捷方式和原生深链）由通用 `ctx.navigation` 解析；启用教务时，导航也考虑当前 Provider 的能力与 `supportedPlugins`。登录是插件页面，不是独立文件路由。

## PluginContext、生命周期与服务

`definePlugin` 的泛型根据 `inject` 和 `optionalInject` 静态裁剪 `ctx`。`inject` 是必须存在的 Cordis 根服务；`optionalInject` 允许服务缺失，并在服务出现、替换或撤销时重挂消费者，不通过完整 `Context.get` 绕过契约。`provides` 要求 `apply` 完成后已通过 `ctx.set` 注册服务；`requires` 是插件 ID 到 SemVer 范围的依赖，不能用 `inject` 替代。服务实例归属提供方 Cordis 作用域，停用、更新或卸载会释放实例与注册项；消费者因服务替换停止后可在新服务就绪时重启。

注册必须在 `apply` 中完成，并通过 disposer/`ctx.effect` 绑定作用域。不要依赖模块级单例、手搓 `while (pending)` 启动轮询或 `as unknown as` 逃避契约。Cordis 的 `effect`、`on`、`once`、`serial`、`parallel` 构成生命周期与事件边界。启动对异步 `apply` 使用有界等待；超时或停用后，迟到的 continuation 不得重新发布服务或贡献。内核记录异步 disposer，并在同一插件的下一次启动前等待旧清理完成，避免原生新旧实例交错。

通用服务属于 composition 中的普通运行时插件：

| 服务 | 包 | 责任 |
| --- | --- | --- |
| `slots` / `ui` | `runtime/slots`, `runtime/ui` | Slot、页面、导航、Shell、主题注册 |
| `router` / `i18n` / `settings` | `runtime/*` | 根查询历史、翻译、设置分类 |
| `storage` | `runtime/storage` | 本地/安全存储与插件命名空间 |
| `http` | `runtime/http` | 传输、Cookie 协作、网络活动、waterfall |
| `native` | `runtime/native` | 版本化宿主能力 |
| `assets` / `plugins` | `runtime/packages` | 包内资源和市场安装 |

教务运行时是可选服务：Provider 通过 `ctx.providers.registerProvider(schoolId, factory)` 注册；`SchoolProvider` 以正交 `AcademicSliceMap` 组合认证和业务切片，不恢复单体 Provider。Provider 的能力声明与 `supportedPlugins` 同时决定查询、页面、导航和功能插件是否可用。查询数据 record 可按身份共享，但每个插件的 descriptor、enabled 和订阅生命周期相互隔离；TTL/persist 策略由功能插件通过 `query.registerPolicy` 在自己的作用域注册，不在运行时枚举业务功能。官方组合只内置 YSU 学校元数据；初始化向导会从当前市场的 `provider` 类别发现其他学校，约定插件 ID 为 `<schoolId>.provider`，选择时安装该插件并验证对应 Provider 已注册，不在部署配置中枚举社区学校。

## Slot、UI 与四份派生 Props

`root`（`single`）是唯一预置 Slot。其他 Slot 由插件扩展 `SlotMap` 并在运行时声明；`children` 只授权当前组件渲染所声明的子 Slot。用 `slots.inject` 等待可选 Slot，并在声明撤销时清理贡献。`single` 与 `keyed` 选最低优先级，同一目标同优先级会报错；`list` 与 `chain` 按 `order` 排列。普通贡献仍遵守单声明者原则；替代 Shell 可对已预声明的公共 `shell.*` Slot 使用 `declareChildren: false`，取得渲染授权而不重复声明。

宿主偏好中的 Shell、主题与启动页选择共享同一份 Observable 状态，插件管理器、设置页和 `OrahakoApp` 通过它同步切换。主题 CSS 只由宿主按 `activeTheme` 注入；空值表示默认主题。启动页只保存宿主的 `startupPage`，未设置时回退 `composition.defaults.landing`；Shell 和设置 Store 不再维护第二份状态。

页面、Shell、设置和 Slot 组件都用注册点声明 `children`、`store`、`inject`，不得读取 `ctx`、业务 React Context、`useSyncExternalStore` 或直接 `useSWR`。唯一 `ui-renderer` 自动派生：

1. **Runtime Share**：owner、作用域类型化 `t`、`locale`。
2. **Child Render Share**：仅当前 `children` 声明授权的 `renderSlot` / `renderSlotChain`。
3. **Store Share**：选择器 `useStore` 与受控 `actions`，不暴露 StoreInstance 或底层 `setState`。
4. **Business Inject Share**：`NoInfer` 锁定的数据/回调；`inject.hooks` 中的 ObservableSource 生成 `use<Name>` 选择器 Hook。

页面和 Slot 有独立错误边界。应用先尝试 `root` 贡献，否则渲染选定或默认 Shell；替代 Shell 失败时由渲染器回退，无法渲染可用界面时显示恢复页。内核可在重复启动崩溃后进入安全模式。

## 作用域 Store 与词典

`defineStore` 是工厂，不创建模块级单例；插件在 `apply` 内以 `store.create(ctx.storage)` 创建实例。持久化键由宿主变为 `orahako-plugin:<plugin-id>:<key>`，插件不得拼全局 `STORAGE_KEYS` 或恢复上帝单例 settings store。只把 selector 和绑定 action 暴露给组件。

每个插件通过 `defineDictionary({ zh, en })` 持有自己的类型化词典，点路径 Key 在中英文形状间静态检查。词典随插件作用域注册和释放；不要恢复集中式巨型 `dict.ts`。

## HTTP 管道与 Native 边界

`ctx.http.send` 通过 Capacitor 或同源 Web 代理传输，`ctx.http.activity` 提供粗粒度活动快照。插件在 `apply` 中用 `ctx.on("http/request", handler)` 和 `ctx.on("http/response", handler)` 注册中间件。HTTP 运行时在传输前后通过 `runHttpRequestPipeline` / `runHttpResponsePipeline` 执行局部值转换链，不修改 Cordis 原型；处理器返回替换值，或返回 `undefined` 保留当前值。响应处理器还收到实际发送的请求。会话使用教务运行时的 JS CookieJar，不使用 WebView CookieManager 作为会话来源。

`ctx.native.capabilities` 提供 `list`、`has`、`acquire`、`invoke`，其中 `acquire` 返回释放函数；Capacitor bridge 只处理 `describe`、`acquire`、`release` 和 `invoke`。`android/nativeComposition.gradle` 选择 provider、companion 与 deep-link 配置：app 只依赖 `:native-core` 和所选 provider，通用 `:native-widgets` 可独立于 schedule/exam companion 构建。

ZIP 不能新增原生模块或权限。新增能力需同步 Kotlin 工厂、模块 manifest、`android/app/src/main/assets/native-companion.json`、应用 composition 与插件清单。通用模块通过 `${applicationId}.MainActivity` 和 deep-link 占位符引用宿主身份；允许列表不等于设备支持该能力或用户已授权。

## 外部 ZIP 与 API v1 市场

外部 ZIP 使用 API v1 清单，仅能导入包内相对模块与 [`PLATFORM_MODULES`](packages/core/sdk/src/manifest.ts) 共享的模块实例。动态导入也必须是静态字符串或无插值模板字符串；计算表达式和 glob 会被拒绝。包格式、SDK 示例、`pnpm plugin pack <plugin-directory> [output.zip]` 及发布字段见 [SDK 指南](packages/core/sdk/README.md)。其他 API 版本的 ZIP 必须重新发布。市场索引和 ZIP 均由 `Youwenqwq/orahako-plugin-registry` 的 `main` 分支通过 `raw.githubusercontent.com` 分发，主仓库和 EdgeOne 不保存市场副本。

## 安装、恢复与信任

内核校验 ZIP 与清单，从 IndexedDB 加载已安装插件，再解析 Blob ESM 模块图。侧载与每次加载都会复核 API 和 `minAppVersion`；市场选择另检查平台、应用版本、原生能力，下载包校验 SHA-256。更新失败时尝试恢复旧包；启动失败仍保留管理入口；安全模式跳过外部插件，并允许原生能力组合 mismatch 降级为可诊断状态。外部包不能以同 ID 覆盖内置插件，同 ID 拒绝发生在写库前，失败回滚不会注销内置运行时。

插件可访问凭据、教务会话、个人数据、网络和 Native API。SHA-256 只证明包与索引字节一致，不证明发布者可信；安装与更新必须按同等风险评估。

## 验证门禁

```sh
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run verify-architecture
pnpm run build
pnpm plugin pack <plugin-directory> [output.zip]
npx cap sync
cd android && ./gradlew verifyNativeComposition testDebugUnitTest
```

架构门禁检查包导出、tsconfig、导入与组件边界。验证还应覆盖非教务组合启动、根路由与深链、外部功能/替代 Shell ZIP 的安装与停用，以及 API v2 ZIP 的拒绝行为。Gradle 检查不代替真机 WebView、通知、闹钟、后台轮询、widget 与真实账号验收。
