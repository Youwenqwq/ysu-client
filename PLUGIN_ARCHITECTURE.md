# 插件组合架构

酸橙盒（Orahako）是一个由插件组合的应用，而不是一组由固定页面控制的功能开关。内核只负责启动与恢复，应用选择由可审计的 composition 描述，所有界面、学校接入与业务能力都来自插件。本文定义运行时边界与公共扩展契约。

## 目标与非目标

目标：

- 官方功能与社区功能使用同一套公开模块和生命周期。
- 换一个 composition 就能组合出另一套应用：不同学校、不同 shell、不同功能集合与应用身份。
- 插件可以新增页面和 UI 内容，也可以替换整个应用 Shell。
- 插件代码与应用同权；安装者判断来源并承担风险。
- 任一外部 UI 插件失效时，内核仍能恢复默认 Shell 或停用插件。

非目标：

- 不在同一 JavaScript 主上下文中构造权限沙箱。
- 不让 Next.js 文件系统路由成为运行时插件协议。
- 不通过 tuple/Slot 类型系统约束应用结构；Slot 只是 UI 组合原语。
- 不为 API 1 提供兼容层。旧清单和旧市场条目会被明确拒绝。

## 组合模型

### CompositionSource

应用由 `CompositionSource` 启动，`PluginHost` 接收它并在构造时完成组合与校验：

```ts
interface CompositionSource {
  /** Installed application version used for market/update compatibility. */
  appVersion: string
  composition: AppComposition
  plugins: readonly CompositionPlugin[] // manifest + executable definition
  layers?: readonly CompositionLayer[]
}
```

`AppComposition` 是纯数据、可检查的选择，不包含可执行 import：

```ts
interface AppComposition {
  id: string
  version: 1
  identity?: CompositionIdentity
  defaults: { shell?: string; schoolId?: string; landing?: string }
  nativeCapabilities?: string[]
  market?: { indexUrl: string }
  plugins: readonly {
    id: string
    config?: Record<string, unknown>
    protected?: boolean
    disabled?: boolean
  }[]
}
```

- `defaults.shell` 使用 `<plugin-id>:<shell-id>`；`landing` 是语义首页偏好；`schoolId` 表达应用声明的默认学校，需要由消费它的运行时服务配置落实——官方 composition 会为 `session` / `provider` 同时设置 `defaultSchoolId`。
- `market.indexUrl` 是该 composition 的市场索引。没有市场时，运行时拒绝市场安装与推荐组合包。
- `nativeCapabilities` 是该构建允许的原生能力引用集合；插件清单与本字段共同决定安装与市场兼容性。
- `identity` 见「应用身份」。
- `protected: true` 的条目不能由插件管理页停用；官方 composition 将 `kind: "runtime"` 与清单 `required` 的插件设为 protected。
- `disabled: true` 表示该条目属于应用组成但默认不启动，仍可在插件管理中启用。

`plugins` 中的可执行模块与 composition 分离：同一份 composition 可以配不同实现，实现也不会藏在配置对象里。`PluginHost` 要求每个 composition 条目都有对应模块，重复 ID、未知条目、重复模块都会在启动前失败。

### 分层

`CompositionLayer` 用于同一代码库产出不同应用，例如学校定制构建：

```ts
interface CompositionLayer {
  id: string
  defaults?: Partial<CompositionDefaults>
  plugins?: readonly CompositionEntryPatch[]
}
```

`composeApplication()` 按顺序应用层：

- `defaults` 浅合并，后层覆盖前层。
- 普通 patch 必须声明 `id`，对已有条目做行级替换：`config` 整体替换（不深合并）、`protected` / `disabled` 覆盖。
- `insert` 是例外：用于新增条目，插入时不能同时声明 `id`，且不能插入已存在的 ID。
- 条目不能删除，只能 `disabled`。未知 ID 与重复插入都会抛错，避免一个构建静默改变另一个应用。
- 层只修改选择，不携带可执行模块；模块仍由 `CompositionSource.plugins` 提供。

### 内核与应用的边界

`lib/plugins/host.ts` 的 `PluginHost` 是内核运行时，不是应用入口。它只接收 `CompositionSource` 并负责：

1. 应用 composition 与 layers，校验每个条目的模块、配置和 schema。
2. 创建 Cordis 根运行时，按需注册并启动 composition 插件，处理 `requires` / `inject` 依赖顺序。
3. 读取 IndexedDB 中已安装的外部 ZIP，在安全模式下跳过外部插件，处理启动失败与回滚。
4. 提供宿主共享模块表、外部模块加载、样式注入和恢复状态。
5. 提供 `packageRuntime`：市场安装、包内资源 URL 与原生能力列表。

内核不注册页面、导航、主题、设置、Provider 或任何学术/后端服务，也不认识具体学校、课表或费用插件。它也不提供 `provider` / `session` / `query` 之类的学术或后端 getter；这些能力只存在于 composition 选择的运行时插件中，消费者通过作用域 `PluginContext` 获取。`PluginHost` 仅保留路由宿主与默认 Shell 所需的基础注册表 getter（`ui` / `slots` / `notifications` / `settings` / `i18n` / `navigation`），它们不是插件可依赖的私有数据接口。

官方仓库的应用入口是 `app/composition.ts`：

- `app/layout.tsx` 只挂载它导出的 `AppComposition`，`app/page.tsx` 只渲染 `AppHome`；
- `AppComposition`（`app/composition/providers.tsx`）选择官方 `CompositionSource`，并把子节点交给内核 `PluginProvider` / `getPluginHost(source)`；
- `app/composition/identity.ts` 与 `app/composition/home.tsx` 分别承载静态身份与首页行为。替换应用时替换这些模块，而不是修改内核布局、路由宿主或 `components/plugin-provider.tsx`。

组合成另一套应用的方式：

1. 编写自己的 `CompositionSource`，选择需要的通用运行时插件与功能插件；
2. 提供自己的 `identity`、`defaults` 与 `appVersion`；
3. 在自己的 `app/composition.ts` 组合根中导出 `AppComposition`，由 `app/layout.tsx` 挂载；内核通过 `getPluginHost(source)` 创建宿主；
4. 若需要不同的原生能力集合，同时修改 Android 构建的 `assets/native-companion.json`、`nativeComposition.gradle` 与 provider 模块。

外部 ZIP 不能改变 composition：它只能被安装为 composition 之外的附加插件，也不能用同 ID 覆盖 composition 模块。官方 `plugins/official/composition.ts` 只是官方组合的实现模块，不是应用入口；不要把它当作可被外部插件覆盖的注册表。

## 分层职责

### 内核

- Next.js HTML/静态导出入口、通用路由宿主、PWA 与 OTA。
- Cordis 根上下文、插件运行时、依赖与作用域生命周期。
- ZIP 解析、IndexedDB 包存储、SHA-256 校验、市场兼容性筛选。
- 宿主共享模块实例与 Blob 模块图加载。
- 通用 Native bridge、启动恢复、Shell 崩溃回退与重复崩溃安全模式。

内核只导入通用契约与原生桥，不导入官方 Shell、YSU Provider、教务功能或任何具体学校模块。`app/layout.tsx`、`app/dashboard/layout.tsx`、`app/dashboard/plugin/page.tsx` 等宿主页面也不直接实现官方界面。

### 通用应用服务

通用服务也是 composition 中的普通运行时插件（`kind: "runtime"`），通过 `provides` 暴露。官方 composition 选择以下实现，但其他应用可以替换或省略：

| 服务 | 职责 |
| --- | --- |
| `ui` | 页面、导航、主题、总览挂件与 Shell 注册表 |
| `slots` | Slot 声明与贡献注册表 |
| `settings` | 插件设置分类注册表 |
| `notifications` | 通知运行时渠道注册表 |
| `i18n` | 插件词典与翻译 |
| `storage` | 按插件 ID 命名空间的本地/安全存储 |
| `http` | 无状态请求与只读网络活动 |
| `native` | 原生平台检测与版本化能力调用 |
| `assets` | 外部插件包内资源 URL |
| `plugins` | 按当前应用/平台安装市场版本 |
| `analytics` | 匿名用量上报；采集端地址由 composition 配置 |
| `announcement` | 公告获取、过期过滤与已读持久化；文档地址由 composition 配置 |
| `updater` | 发布清单、OTA/APK 下载与回滚机制；发布基址、镜像与可镜像源全部来自配置 |
| `mfa` | MFA 交互入口；具体登录流程仍归 Provider |

这些服务的实例属于提供它的运行时插件作用域。`packageRuntime` 与 `pluginManager` 由内核直接提供，不属于可替换应用服务，也不暴露学校或学术数据。

### 可选教务运行时

教务是可选的应用组合，不是内核能力。官方 composition 额外选择：

| 服务 | 运行时插件 | 职责 |
| --- | --- | --- |
| `providers` | `orahako.runtime.provider-registry` | 按学校 ID 注册 Provider 工厂 |
| `session` | `orahako.runtime.session` | 凭据、通用会话产物、CookieJar 与带 Jar 请求 |
| `provider` | `orahako.runtime.provider` | 当前学校 Provider 实例与初始化生命周期 |
| `query` | `orahako.runtime.query` | Provider 查询键、缓存策略与失效 |
| `navigation` | `orahako.runtime.navigation` | 语义路由、首页与作用域导航解析 |
| 无（策略插件） | `orahako.runtime.provider-support` | 监听 `provider/changed`，按 `supportedPlugins` 停用/恢复功能插件 |

- 这些官方后端能力（`providers` / `session` / `provider` / `query` / `navigation` 服务与 `provider-support` 策略插件）全部是 scoped runtime plugins：实例属于提供方 Cordis 作用域，通过 `provides` / `inject` 消费，不是内核单例或 `PluginHost` getter。
- `AcademicPluginContext` 只是 SDK 中“教务服务已存在”的类型视图，不是内核上下文。它只在包含上述服务的教务组合和官方学术 UI 中使用；通用插件应面向 `PluginContext` 与自己的 `inject` 编写。
- 不包含这些服务的 composition（例如只选择 `ui` / `slots` / `settings` / `notifications` / `i18n` 加一个社区 Shell）必须能正常启动；`provider`、`session`、`query` 保持不存在，这是 `lib/plugins/community-composition.test.ts` 的验收场景。
- 替换某个服务时，在 composition 中换掉提供方，并让消费者只通过 `inject` 使用它。不要在 Shell、宿主页面或功能插件里重新实现学术/后端单例。

### 官方插件

官方 `plugins/official/composition.ts` 选择默认功能集合，只有官方 composition 会装配它：

- `orahako.shell`：默认登录、Dashboard、设置、导航和全局弹窗组合。
- `orahako.onboarding`：通过 `shell.overlay` 提供首次学校选择、权限配置和市场 Provider 安装；既有设置经迁移后不再显示。
- `orahako.network-activity`：提供只读网络活动快照、`shell.activity` 活动指示和显示密度设置。
- `orahako.notifications`：拥有通知设置分类、原生通知运行时和功能插件通知渠道协调。
- `ysu.provider`：YSU CAS/JWXT Provider，也是唯一内置的学校 Provider；其他学校由市场包注册。
- 功能插件：课表、成绩、考试、总览、费用等；森空鸟等玩具箱功能由官方市场提供，不进入内置运行时。可选官方插件源码统一位于 `Youwenqwq/orahako-official-plugins`，市场元数据由 `Youwenqwq/orahako-plugin-registry` 维护。
- 主题插件：向主题注册表贡献 CSS。
- 市场可通过 `bundles` 为学校声明推荐插件组合；插件管理页负责分类展示，宿主统一预检并安装或启用组合内容。

官方插件可以随应用内置，但不因此获得私有 UI 或数据接口；它们与外部插件一样通过 manifest 里的 `inject` 获取服务。区别只在打包与源码位置：仓库内官方插件可以使用 `@/` 等仓库导入，外部 ZIP 不能。

### 公共 SDK

`@orahako/plugin-sdk` 提供稳定契约：composition、清单、领域模型、Provider、Shell、Slot、页面、设置、会话、Provider 运行时、查询、导航、事件、存储、HTTP、原生、资源、分析、公告与更新服务。

- 模块导出就是稳定边界，不存在 `@orahako/plugin-sdk/host` 之类的完整信任私有入口，也不存在官方插件专用的私有 API 或学术/后端 getter 模块。
- `ctx` 上的服务由 composition 注入；插件不得通过 `@/` 或相对路径导入宿主内部实现。仓库内官方插件可以使用仓库导入，但外部 ZIP 只能使用公共 SDK、`@orahako/plugin-ui` 子路径与宿主共享模块表。
- 外部包只能导入宿主共享模块表中的裸说明符，详见「包格式与市场」。`@orahako/plugin-sdk` 的子路径共享同一命名空间，不存在绕过 `inject` 直接取得 `provider` / `session` / `query` 的入口。

`@orahako/plugin-ui` 是可选的官方 React UI Kit 和应用 hooks。默认功能插件与社区插件均可使用；替代 Shell 可以不使用它。包按 `components/hooks/stores/academic/platform/plugin/shell/assets` 子路径隔离副作用，根入口不聚合实现，避免宿主与官方插件之间的模块求值环。

样式同样属于插件包：`pnpm plugin pack` 在打包时为每个插件编译其源码使用的 Tailwind 工具类，生成 `dist/tailwind.css` 并写入 ZIP 清单，与插件自己 `import` 的 CSS 一并注入。宿主只提供设计 token、preflight、共享组件样式和注入/卸载生命周期；宿主构建不再扫描外部插件源码，因此插件漏带样式不会被宿主样式表掩盖。生成的工具类只映射宿主 CSS 变量，不含 preflight 或宿主全局规则，颜色、圆角与 `dark:` 变体跟随宿主主题。

React、实际使用的 Next 入口、`@orahako/academic` 和 UI Kit 子路径均由宿主共享同一模块实例。外部插件不能通过私下打包 Next 模块获得另一套 Router Context。

## 服务、依赖与配置

### `inject`、`provides` 与 `requires`

三者语义不同，不能混用：

- `inject: string[]`：启动前必须存在的 Cordis 根服务名。宿主把每个名称声明为 required inject；服务缺失时插件保持 `registered` 状态，`startAndWait` 抛错，不会执行 `apply`。插件自己的 `definition.inject` 仍可用于可选依赖，但清单中的名称一律按必需处理。
- `provides: string[]`：本插件会提供的根服务名。`apply` 同步或异步完成后，运行时检查每个名称是否已由 `ctx.set(name, …)` 注册；缺失则插件进入 `failed`，错误可见于插件管理页。
- `requires: Record<pluginId, SemVerRange>`：必须先处于 `active` 的插件及其版本范围，例如 `{ "orahako.shell": "^1.0.0" }`。依赖未激活、版本不满足或依赖自身失败时，启动失败；停用插件会级联停用依赖它的插件；同 ID 更新替换不级联，避免 Provider 更新无意义地关闭功能插件。

服务名是开放字符串。使用新的服务名时，确认提供方与消费方都已启用；外部 ZIP 可以声明并提供服务，但只有提供方先启动且消费者也启用时才可用，跨包顺序用 `requires` 表达。

### 服务所有权与替换

- 每个根服务实例属于提供它的插件作用域。插件停用、更新或卸载时，Cordis 释放作用域，服务实例与它持有的监听器、缓存、注册表一起失效。
- 消费者通过 `inject` 拿到服务名，而不是导入实现模块；替换实现只需要换掉提供方插件，不需要改消费者。替换发生在 composition 选择层面：核心服务名已经由某个 runtime 插件提供，外部市场安装不能在同一次启动中并行替换它；应换掉 composition 中的提供方，或让新服务使用新名称。
- 根服务被释放、随后注册同名新服务时，Cordis 停用所有注入该服务的消费者，并在新服务就绪后重新启动它们。未注入该服务的插件不受影响。消费者必须把 `apply` 视为可重复执行，不能依赖模块级单例存活。
- 服务可以实现 `PLUGIN_SERVICE_SCOPE`（`Symbol.for("orahako.plugin-service.scope")`）返回按消费者身份绑定的 facade。运行时在消费者作用域内隔离该名称并注入 facade，因此注册项能归属到发起者插件，并在消费者释放时自动撤销；提供方本身不需要知道消费者 ID。
- 注册函数应使用可撤销的 disposer，并通过 `ctx.on("dispose")` 与消费者作用域绑定。公开的 `trackPluginRegistration()`（`@orahako/plugin-sdk`）保证“注册先挂 disposer、失败不泄漏”，宿主注册表与官方运行时共用该实现。
- 服务实例是可变状态：替换运行时不会迁移旧实例中的注册项。需要持久化偏好的插件应写入 `ctx.storage`，而不是只保存在提供方内存。

### `configSchema` 与外部插件配置

- `configSchema` 是 JSON Schema draft-07 对象，宿主用 Ajv 在启动前校验，并启用 schema 的 `default` 填充；实现通过 `definePlugin((ctx, config) => …)` 接收校验后的深拷贝。
- composition 条目的 `config` 是该插件配置的唯一来源；`config` 必须是对象，校验失败会阻止该插件启动（composition 构造阶段即失败）。
- 外部安装包没有 composition 条目，因此启动时以空对象校验。外部插件应把 `configSchema` 的默认值或默认行为做进实现，不能假设用户会编辑配置。
- 运行时服务插件也使用同一机制，例如 `session` / `provider` 的 `defaultSchoolId`、`query` 的 `policies`、`navigation` 的 `fallbackHref`、`plugins` 的 `marketUrl`、`analytics` / `announcement` 的 `endpoint`、`updater` 的 `releaseBaseUrl` / `mirrors` / `mirrorableOrigins`，全部由官方 composition 显式配置。

### 原生能力声明

- 清单 `nativeCapabilities` 声明所需的版本化能力引用，例如 `native.geolocation@1`。
- 安装与市场选择要求每个引用都出现在 composition 的 `nativeCapabilities` 中；缺失时安装直接失败。该字段是构建允许列表，不是权限沙箱。
- Web 与 Android 的实际可用能力由运行平台和 Android 构建决定；声明通过宿主校验不等于设备一定具备该能力，调用时仍需处理不可用错误。

## 应用身份

`CompositionIdentity` 是应用层身份，不是插件元数据：

```ts
interface CompositionIdentity {
  name: string
  shortName: string
  nameEn: string
  description: string
  descriptionEn: string
  applicationId: string
  deepLinkScheme: string
  shortcuts?: readonly { id: string; name: string; nameEn: string }[]
}
```

- 官方应用把同一份 identity 同时用于 `officialCompositionSource` 与静态入口：`app/composition/identity.ts` 导出该值，`capacitor.config.ts`、`app/layout.tsx` 和 `app/manifest.ts` 从它或其来源模块读取；运行时深链从 `host.composition.identity` 读取。更换 identity 时同步修改 `app/composition/identity.ts`、官方 composition 与静态构建入口，避免 PWA/APK 元数据与运行时行为不一致。
- `plugins/official/shell/components/deep-link-handler.tsx` 使用 `deepLinkScheme` 解析 `scheme://<semantic-route>`；semantic route 再经 `ctx.navigation.resolve()` 落到插件页面。
- 快捷方式只记录语义 route（如 `schedule`），不包含插件 ID。

Android 的应用标签、launcher 图标、`applicationId` 和 activity intent-filter 仍来自 Android 资源、`app/build.gradle` 与 manifest 占位符；通用 native 模块只能使用 `${applicationId}.MainActivity`、`${orahakoDeepLinkScheme}`、`${orahakoDeepLinkHost…}` 等占位符，不得硬编码宿主 activity 或 `orahako://` 路由。更换 identity 时同步修改这些构建资产、`nativeComposition.gradle` 的 deep-link scheme/hosts 与 composition，而不是只改 composition。

## Shell

Shell 是完整应用根组件，通过 `ctx.ui.registerShell()` 注册。内核只向它传递当前 Next.js 路由内容和 scoped `PluginContext`：

```ts
interface PluginShellProps {
  context: PluginContext
  children: ReactNode
  selectShell(id?: string): void
}
```

Shell 可以组合、包装或完全忽略 `children` 并自行渲染页面。`context` 是该 Shell 所属插件的作用域上下文，因此 Shell 可以调用 `ctx.ui` / `ctx.slots` / `ctx.navigation` 等服务，而不需要导入宿主模块。

用户选择以 `pluginId:shellId` 持久化。未选择时使用 `composition.defaults.shell`；该键不存在时回退到第一个注册 Shell。选中的 Shell 停用、卸载或渲染失败时回到默认 Shell；默认 Shell 也失败时，由内核显示重新加载界面。

`kind: "shell"` 是市场和插件管理使用的元数据，不构成权限差异。`PluginShellDefinition.layout` 仅为 Next.js 内容路由提供可选布局，根组件仍由 Shell 拥有。

## Slot

Slot 用于增量 UI 组合，支持三种形态：

| 类型     | 用途                                         |
| -------- | -------------------------------------------- |
| `single` | 一个可替换 occupant；最低 priority 生效      |
| `list`   | 按 order 排列的增量内容                      |
| `keyed`  | 按 key 选择一个 occupant；最低 priority 生效 |

Slot 所有者通过 `ctx.slots.declare()` 声明名称与形态。贡献者通过 `ctx.slots.register()` 注册组件。未声明的 Slot、keyed 贡献缺少 key、single/keyed 同优先级占位都会在加载时失败，而不是产生不确定 UI。

声明和贡献都随 Cordis 作用域释放。移除 Slot 声明会级联移除其他插件向该 Slot 注册的内容。每个贡献组件有独立错误边界，单个装饰失败不应拖垮整个 Shell。

默认 Shell 当前声明：

- `shell.overlay`：应用根级浮层列表。
- `shell.activity`：顶栏网络活动指示。
- `dashboard.header.actions`：桌面 Dashboard 头部动作列表。
- `settings.startupOptions`：启动页选项，由总览、日程等目标插件分别贡献。
- `settings.widgets`：可添加的原生小组件卡片。

功能插件通过 `ctx.settings.registerCategory()` 注册带图标、标题、描述和面板的设置分类。主设置页只显示统一“插件设置”分类列表，`/dashboard/me/settings/plugins/?category=<id>` 承载详情；分类随插件作用域释放，宿主不认识具体功能分类。

`orahako.notifications` 拥有通知分类的单卡片面板和原生通知运行时，并声明 `settings.notifications.content`（轮询内容选项）、`settings.notifications.reminders`（原生提醒分节）与 `settings.notifications.appReminders`（应用内提醒分节）。功能插件保留各自设置 UI，同时通过 `ctx.notifications.register()` 注册 `grades`、`exams` 或 `schedule` 运行时渠道。界面贡献和渠道都随 Cordis 作用域释放；运行时消费渠道快照，不按插件 ID 推断能力。

Overview 挂件由实际功能插件注册，而不是由 `orahako.overview` 代注册。公共挂件、组合器、编辑器、数据 Provider 与布局算法位于 `@orahako/academic`（`packages/academic/overview-layout.ts`）。`orahako.overview` 通过 `ctx.settings.registerCategory()` 直接注册编辑器，不拥有专用 Next.js 设置路由。`order` 决定默认布局顺序，Cordis 在功能停用时移除其挂件；布局按稳定的插件挂件 ID 归一化，未安装插件的槽位保留。

Slot 是默认 Shell 的公开视觉契约。替代 Shell 可以声明自己的 Slot；面向特定 Shell 的插件应记录该依赖。

## 页面与导航

功能插件注册语义页面和导航元数据。页面 ID 属于插件，可选 `route` 表达跨插件唯一的稳定语义路由，导航 ID 表达稳定语义（例如 `schedule`），核心不通过插件 ID 定位功能。冲突的语义路由在加载时失败。

页面组件接收 scoped `PluginContext`：

```ts
interface PluginPageProps {
  context: PluginContext
  pluginId: string
  pageId: string
  params: URLSearchParams
  navigate(pageId: string, params?: Record<string, string | number | undefined>): void
}
```

`context` 是注册该页面的插件作用域，不是 Shell 或宿主的实例；页面可以在其中使用与 `apply` 相同的服务。

导航分组是开放字符串。默认 Shell 为常见分组提供翻译和顺序，未知分组按 ID 稳定排序显示；替代 Shell 可以完全采用其他组织方式。

`ctx.navigation` 提供 `sources()`、`resolve(id)`、`primary()`、`landing(preference)` 与 `forScope(scope, pluginId?)`。语义解析同时考虑当前 Provider 的 `capabilities` 与 `supportedPlugins`：页面 `capability` 不满足或插件不在学校允许列表时，导航、深链与语义首页都不会落到该页面。`providerIndependent` 只让插件不因学校允许列表被停止；全局页面需显式设置 `requiresProvider: false`，导航本身仍受允许列表约束。

`fullscreen` 等页面元数据表达展示意图，由 Shell 决定是否采用。静态导出下，外部插件不能新增 Next.js 文件路由。默认 Shell 使用 `/dashboard/plugin/?plugin=&page=&route=`；替代 Shell 可以使用自己的客户端路由，但刷新恢复必须由静态部署和 Web 重写规则支持。

## 会话、Provider、查询与事件

### Session

`ctx.session` 是学校无关的会话状态与传输契约：

```ts
interface SessionSnapshot {
  activeSchoolId: string | null
  credential: string | null
  username: string | null
  isAuthenticated: boolean
  sessionExpired: boolean
  hasHydrated: boolean
  artifacts: Readonly<Record<string, string>>
}
```

- `setCredential()`、`activateSchool()`、`clearCredential()`、`setSessionExpired()` 维护状态；`setArtifact()` / `getArtifact()` 保存学校相关的非结构化会话产物。
- `createCookieJar()` 与 `fetchWithJar()` 提供会话传输。CookieJar 是 JS 侧会话事实来源；原生 transport 不替代它。
- `isAuthenticated` 与 `sessionExpired` 分离：过期不等于退出登录，由 UI 决定提示和重登录。
- 没有活动学校时，需要学校上下文的操作会抛错，不会静默使用另一所学校。

### Provider 运行时

`ctx.provider` 拥有当前学校 Provider 实例：

```ts
type ProviderRuntimeStatus = "unavailable" | "initializing" | "ready" | "error"
```

- `selectSchool(schoolId)` 显式选择学校；未注册的学校会抛 `FEATURE_NOT_SUPPORTED`，不会回退到其他学校。
- `initialize()` 只初始化一次并复用进行中的初始化；`reset()` / `logout()` / `relogin()` 处理认证转换。每次异步操作都绑定 generation，旧初始化不能把状态写回新 Provider。
- `getActive()` 在尚未选择时按 session 的活动学校或 provider 运行时配置的默认学校解析；两者都不可用则抛错。
- `provider` 服务由 `providers`（贡献注册表）与 `session` 组合而成。运行时只依赖 `ManagedProvider` 的最小生命周期（`initialize` / `reset` / `logout` / `relogin`），不依赖学校配置、学术能力或具体协议字段；`AcademicProvider` 在此基础上增加 `id` / `name` / `capabilities` 与可选的认证、学术、评教模块。`plugin` 更新 Provider 时不应手动重启功能插件，runtime 会维护当前实例。

### Provider 贡献

Provider 插件通过 `ctx.providers.registerProvider(schoolId, factory)` 注册实现工厂：

- 注册表条目只有三样东西：学校 ID（键）、`ProviderFactory`、贡献该工厂的插件上下文。运行时用贡献者的上下文调用 `factory(ctx)` 创建实例，因此 Provider 实例可以使用该插件自己的作用域与服务。
- 注册随贡献插件作用域撤销；同一学校 ID 的再次注册会替换旧工厂，但旧条目的 disposer 只能撤销它自己创建的注册。学校目录完全来自插件注册，不存在内置学校 JSON、`SchoolConfig`、`server-config` 或根目录 `providers/`。
- `ManagedProvider` 是运行时需要的最小契约；`ProviderFactory` 返回 `ManagedProvider`。只有实现学术能力时才使用 `AcademicProvider` 与 `BaseProvider`。
- `AcademicProvider` 的认证、学术、评教模块都是可选的；实现通常继承 `BaseProvider`。若继承 `BaseProvider`，认证核心（`prepareLogin`、`resetLoginSession`、`login`、`loginStep1`、`checkAuthStatus`、`logout`、`relogin`、`isAuthenticated`）仍是抽象方法，必须实现。
- 能力方法按 `capabilities` 声明覆盖；未声明能力时默认抛 `FEATURE_NOT_SUPPORTED`，声明了但未实现同样是错误。
- `supportedPlugins` 是学校支持的功能插件允许列表：`undefined` 允许全部，数组（包括空数组）只允许列出的清单 ID。它与 `capabilities` 一起约束功能插件启停、页面、导航、深链与总览挂件。
- 共享成绩 UI 只使用当前 Provider 的 `gradeScale` / `gpaScale`，不内置其他学校刻度。
- Web 端使用新学校域名时，必须同步部署侧代理 `ALLOWED_HOSTS`；插件注册不能绕过该网络边界。
- `AcademicPluginContext` 只描述“教务运行时已存在”的组合；需要 `providers` / `session` / `provider` / `query` 的官方学术 UI 才使用该类型。`ProviderPluginRegistry` 自身不提供宿主 getter，也不认识学校配置。

### ProviderSupport

`orahako.runtime.provider-support` 是一个普通运行时插件，不是内核方法或 `PluginHost` getter：

- 它 `inject: ["provider", "pluginManager"]`，订阅 `provider/changed` 与插件状态，按当前 Provider 的 `supportedPlugins` 停用不支持的功能插件。
- 它只恢复由自己因 Provider 限制而停用的插件；用户手动停用的插件不会被恢复。`kind` 不是 `feature`、`providerIndependent` 或 composition `protected` 的插件不受影响。
- 不包含教务运行时的 composition 不安装该插件；通用应用不依赖它。

### Query

`ctx.query` 是 Provider 查询的统一键与缓存契约：

- `ProviderQueryIdentity` 由 `providerId`、`providerScope`（学校 ID + Provider generation）、`username`、`feature`、`params` 组成；`key()` 生成 SWR key，`cacheKey()` 生成持久缓存键。
- `policy(feature)` 返回 `{ ttl, persist }`；`registerPolicy()` 可覆盖某项 feature 的策略，并按后注册优先，随插件作用域撤销。
- `readPersistent()` / `writePersistent()` / `clearPersistent()` 管理持久值；持久键只在 `persist` 且有用户名时使用。
- `invalidate(identity?)` 只让 Provider 查询族失效，并发出 `query/invalidate` 事件；不会误刷新无关 SWR key。

### Navigation

`ctx.navigation` 不拥有插件身份：

- `sources()` 返回当前页面、导航、Provider 能力与允许列表；`fallbackHref` 来自 composition 配置。
- `resolve(id)` 先匹配页面 `route`，再匹配导航 ID；未解析返回 `undefined`。
- `primary()` 返回主页面目标；`landing(preference)` 先尝试偏好，再退回主页面或 `fallbackHref`。
- `forScope("app" | "plugin", pluginId?)` 返回已按能力与学校允许列表过滤、排序的导航。默认 Shell 用 `plugin` 作用域替换活动插件的移动端底部导航。

### 事件

`@orahako/plugin-sdk/events` 通过 Cordis 模块声明合并注册以下公共事件：

| 事件 | 载荷 | 时机 |
| --- | --- | --- |
| `session/changed` | `SessionSnapshot` | 会话快照实际变化 |
| `session/expired` | `SessionSnapshot` | `sessionExpired` 从 false 变为 true |
| `provider/changed` | `ProviderRuntimeSnapshot` | 状态、学校、Provider 或错误变化 |
| `provider/ready` | `ProviderRuntimeSnapshot` | 每次 Provider 初始化成功 |
| `query/invalidate` | `Partial<ProviderQueryIdentity> \| undefined` | Provider 查询失效 |

插件使用 `ctx.on("provider/ready", handler)` 即可，无需私有启动注册表；事件随插件作用域失效。需要幂等初始化时，先检查 `ctx.provider.getSnapshot().status`，再订阅后续事件。

## 生命周期与错误

注册函数返回 disposer，并由 Cordis 在停用、更新和卸载时自动调用。插件状态快照只描述运行状态，不作为安全证明。

启动顺序：

1. 内核应用 layers、校验 composition 与配置、注册模块。
2. 按 composition 顺序标记启动；`requires` 与 required `inject` 未就绪的插件保持等待，其他插件继续启动。
3. 首轮完成后，已在 IndexedDB 中的外部包被加载并参与同一轮启动；安全模式下跳过全部外部包。
4. 启动失败的插件记录错误并保留管理入口；未满足依赖的插件标记为“依赖无法满足”。

错误分三层处理：

1. 插件启动失败：记录插件错误并保留管理入口。
2. 页面或 Slot 渲染失败：局部错误边界隔离。
3. Shell 渲染失败或重复启动崩溃：恢复默认 Shell；必要时跳过全部外部插件进入安全模式。

安装/更新失败会恢复旧包并重新加载；无法恢复时安装错误继续抛出。停用插件会移除其注入的样式、页面、导航、Slot 贡献与通知渠道等通过服务注册的内容；原生轮询、闹钟、上传和小组件数据必须由插件通过 disposer 自行停止。

## 包格式与市场

### ZIP 包格式

外部插件是一个 UTF-8 ZIP，根目录包含 `manifest.json`：

```text
manifest.json
dist/index.js
dist/index.css
dist/tailwind.css   # 打包器按需生成
assets/...          # 可选
```

- `entry`、`styles`、`icon` 必须是包内安全相对路径，且对应文件必须存在。
- 路径必须由普通文件名段组成，不能是绝对路径或包含 `..`；重复文件、非法 UTF-8、缺失 `manifest.json` 都会拒绝。
- 默认限制：压缩包 20 MiB、单文件 8 MiB、解压总计 32 MiB、最多 512 个文件、`manifest.json` 最多 64 KiB。
- 包内代码是 ESM。加载器只接受包内相对 import 和宿主共享模块表中的裸说明符；其他裸导入、循环依赖、缺失模块都会导致加载失败。宿主共享模块表中列出的 `@orahako/plugin-sdk` 子路径都指向同一命名空间，因此子路径 import 共享实例。
- 打包器用 esbuild 打包其余依赖。市场索引记录的 `sha256` 与 `size` 必须与 ZIP 完全一致。

### API 2 清单

`apiVersion` 必须为 `2`。当前清单字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 小写点分 ID |
| `name` / `version` | 显示名与 SemVer |
| `apiVersion` | 固定 `2` |
| `kind` | `runtime` / `provider` / `feature` / `theme` / `shell` |
| `entry` | 包内 ESM 入口 |
| `minAppVersion` | 可选的最低应用版本 |
| `styles` / `icon` | 可选包内样式与图标路径 |
| `description` / `author` / `homepage` | 可选展示元数据 |
| `categories` | 可选市场分类字符串 |
| `requires` | 插件 ID → SemVer 范围 |
| `inject` / `provides` | 必需根服务 / 提供的根服务 |
| `configSchema` | JSON Schema draft-07 对象 |
| `nativeCapabilities` | 版本化原生能力引用 |
| `required` | 核心插件标记，不能从插件管理停用 |
| `providerIndependent` | 不因学校 `supportedPlugins` 被停用 |

API 1 的 ZIP 是**有意不兼容**的：清单校验要求 `apiVersion === 2`，市场索引只接受 `apiVersion === 2` 的 release。旧包不会得到迁移、降级或兼容路径，必须按 API 2 重新打包。`apiVersion` 变化意味着契约变化，不保证旧插件源码可直接编译。

### 市场兼容性

客户端读取 composition 的 `market.indexUrl`（官方为 `https://ysu.welain.com/updates/plugins.json`），索引 `schemaVersion` 为 `1`。每个 release 必须声明：

- `version`、`apiVersion`（必须为 2）；
- `platforms`（`web` / `android`）；
- `zipUrl`、`sha256`（64 位小写十六进制）与 `size`；
- 可选 `minAppVersion`、`nativeCapabilities`、`publishedAt`、`changelog`。

选择规则：过滤 API 版本、当前平台、composition 原生能力允许列表与最低应用版本，再按 SemVer 取最高版本。当前应用版本来自 `CompositionSource.appVersion`；没有兼容 release 时安装失败，不会回退到不满足约束的旧版本。

- 索引可声明 `bundles`：`{ id, name, schoolId, pluginIds }`。组合包先完整预检（来源、平台、应用版本、原生能力、Provider 支持范围），再安装缺失插件或启用已有插件，避免半完成状态。
- 市场网络失败时使用本地缓存并标记为过期；缓存也按索引 URL 隔离。
- SHA-256 只验证包与索引一致，不证明作者或来源可信。API/应用版本检查用于兼容性，不是安全控制。

## 原生能力与 Android companion

### 平台差异

PWA 与原生宿主提供相同的组合 API，但浏览器 CORS、系统权限和后台能力存在真实平台差异。公共 EdgeOne 白名单用于避免开放代理滥用，不是插件权限系统；支持 CORS 的服务可以直连，其他服务可使用自定义代理或原生传输。

ZIP 不能向既有 APK 注入原生模块。通用宿主显式携带的原生能力由构建时的 Android companion 组合提供；特殊能力需要新的宿主或定制构建。

### 构建时组合

Android 侧按可审计模块组合，而不是把官方能力硬编码进通用桥：

```text
android/
├── nativeComposition.gradle   # provider 模块/类、官方 companion、widget 组合模块、deep-link 配置
├── native-core/               # 通用能力契约、注册表、NativeCompositionProvider、Capacitor 桥、恢复接收器
├── native-official/           # 官方 NativeCompositionProvider 与后台适配器绑定
├── native-platform/           # files / webview / geolocation
├── native-academic/           # notifications / polling / class reminders
├── native-widgets/            # 通用 widget host（widgets.generic）
├── native-widgets-schedule/   # 可选 schedule/tomorrow widget companion
├── native-widgets-exam/       # 可选 exam widget companion
├── native-ysu/                # YSU 后台轮询适配器
└── app/src/main/assets/native-companion.json
```

- `:native-core` 是通用层，不出现任何官方能力 ID，也不导入具体 composition。它定义 `NativeCompositionProvider`（返回 `NativeCapabilityFactories`）、`NativeCapability`、`NativeCapabilityRegistry`、lease、Capacitor 的 `OrahakoNative` 插件与 `CompanionReconcileReceiver`。
- `NativeComposition.installFromProvider(className)` 通过类名反射安装构建选择的 provider；空类名、缺失类、未实现 `NativeCompositionProvider` 或无法实例化都会直接失败。app 的 `OrahakoApplication` 只调用该方法，provider 类名来自 `BuildConfig.NATIVE_COMPOSITION_PROVIDER`，app 源码不导入 `OfficialNativeComposition` 或任何 widget 模块。
- `:native-official` 是官方 provider，实现 `OfficialNativeComposition`：绑定基础能力工厂、可选 widget 组合模块工厂，并注册进程级后台适配器。替换应用时，提供自己的 provider 模块与类，并在 `nativeComposition.gradle` 中设置 `orahakoNativeCompositionProviderModule` / `orahakoNativeCompositionProviderClass`；app 仍只依赖 `:native-core` 与所选 provider 模块。
- `orahakoOfficialNativeCompanions` 列出本次构建的 companion 模块。通用 widget host 与 widget companion 可独立选择：只包含 `:native-widgets` 时提供 `widgets.generic`，不包含 schedule/exam 实现；`orahakoNativeWidgetCompositionModules` 把可选 widget 模块路径映射到其组合类，并通过生成的 `BuildConfig.NATIVE_CAPABILITY_COMPOSITION_MODULES` 注入 provider。清单声明的 widget 能力与所选模块不一致时，Gradle 预检失败。
- 能力清单 `assets/native-companion.json` 是构建时选择的可审计副本：`version` 必须为 `1`，每项声明版本化 `id`（如 `native.geolocation@1`）与静态 `config`。未知版本、重复 ID、缺少工厂、工厂产出 ID/版本不匹配都会使组合失败。
- 能力之间可以声明依赖；注册表校验依赖图并以拓扑顺序构建。`acquire()` 返回 lease，最后一个 lease 释放后 binding 才释放；`invoke()` 只路由到已启用能力的方法。
- `CompanionReconcileReceiver` 在开机、应用更新、时间/时区变化后重建能力，并调用实现 `NativeCapabilityReconciler` 的能力重新应用持久化调度。`OrahakoApplication` 在进程启动时安装 composition，因为 WorkManager 可能在全新进程中运行。
- JS 侧只看到 `describe` / `acquire` / `release` / `invoke` 与能力事件。`ctx.native.capabilities.list()/has()/acquire()/invoke()` 是 SDK 封装；能力 config 由构建固定，运行时传入非空 config 会被拒绝。

### 权限与身份占位符

- `app/src/main/AndroidManifest.xml` 只保留内核条目：launcher `MainActivity` 与 `INTERNET`。权限、receiver、service、FileProvider、widget 声明和 deep link 都由实际拥有它们的 companion 模块 manifest 提供，并通过 manifest merge 进入最终 APK。
- 通用模块不得硬编码宿主 activity 或 deep-link 身份：使用 `${applicationId}.MainActivity`、`${orahakoDeepLinkScheme}`、`${orahakoDeepLinkHostSchedule}` 等占位符；`nativeComposition.gradle` 的 `orahakoDeepLinkScheme` / `orahakoDeepLinkHosts` 通过各模块的 `manifestPlaceholders` 注入。
- 应用标签、launcher 图标与 `applicationId` 仍属于 Android 资源和 `app/build.gradle`，不属于 composition identity；更换应用身份时必须同步这些资产、deep-link 配置与 `app/composition.ts`。
- 权限是 Android 构建与运行时的真实边界：模块只在自身 manifest 声明所需权限，能力调用仍要处理用户拒绝、Web 不可用和 API 版本差异。`nativeCapabilities` 允许列表不是权限系统。

新增一项原生能力的完整路径：

1. 在 companion 模块中实现 `NativeCapability`：稳定的 `id`、`version`、`methods`、可选 `dependencies` / `config` 和 `bind()`；需要系统调度时实现 `NativeCapabilityReconciler`。
2. 在自己的 `NativeCompositionProvider` 中把 `id` 映射到工厂，并校验工厂产出的 `id` / `version` 与清单条目一致；官方构建修改 `:native-official`。
3. 在 `nativeComposition.gradle` 中 include 该 companion 模块，并把它加入 `orahakoOfficialNativeCompanions`；若它提供 widget companion，再加入 `orahakoNativeWidgetCompositionModules`。app 仍只依赖 `:native-core` 与所选 provider 模块。
4. 在该模块自己的 `AndroidManifest.xml` 声明权限与组件，使用 `${applicationId}` / deep-link 占位符。
5. 在 `assets/native-companion.json` 添加版本化条目与静态 config；`version` 仍为 `1`。
6. 在插件 `manifest.nativeCapabilities` 与市场 release 的 `nativeCapabilities` 中声明同一引用。
7. JS 通过 `ctx.native.capabilities.invoke("<id>", "<method>", payload)` 调用，并处理 Web 不可用、权限拒绝与能力缺失。

Gradle 的 `verifyNativeComposition` 与 Kotlin 测试会检查 provider 类可解析、widget 模块存在、能力清单非空以及通用模块不含宿主身份；这些是构建期检查。Android WebView、原生通知、闹钟、后台轮询、widget 与真实学校账号仍必须由发布前真机验收单独确认，本文不声称已完成该验收或线上部署。

## 信任与供应链

插件与 App 同权，可访问保存的凭据、教务会话、个人数据、网络和原生 API。安装与更新必须展示同等风险提醒。

SHA-256 只验证包与市场索引一致，不证明作者或来源可信。市场分类、命名空间存储、模块白名单和 `nativeCapabilities` 允许列表也都不是安全边界。

[`orahako-official-plugins/plugins/perlica-toybox`](https://github.com/Youwenqwq/orahako-official-plugins/tree/main/plugins/perlica-toybox) 是完整社区插件基准：第三方 HTTP、独立凭据、地图、扫码、移动子导航、原生定位和 i18n 均不使用宿主私有实现。

## Release 验收

- 默认 composition 下现有页面、导航、主题和持久化偏好保持可用。
- 一个非教务 composition（只选通用注册表 + 社区 Shell）可以启动，`provider` / `session` / `query` 不存在且不报错。
- 一个纯外部功能 ZIP 无需私有导入即可注册页面和默认 Shell Slot。
- 一个纯外部 Shell ZIP 可以替换应用根，停用后恢复默认 Shell。
- 一个替换 composition 的应用能用自己的 `app/composition.ts`、identity 与默认项启动，且不需要修改插件实现。
- Provider 只通过 `ctx.providers.registerProvider(schoolId, factory)` 注册；不存在根目录 `providers/`、`SchoolConfig`、`server-config` 或宿主学术 getter。
- `provider-support` 作为运行时插件会按 `supportedPlugins` 停止/恢复功能，且不恢复用户手动停用的插件。
- 服务替换会重启注入该服务的消费者，且不误停无关插件。
- Slot 停用、所有者卸载、同优先级冲突和组件异常均有确定性行为。
- 旧 API 1 ZIP 与市场条目被拒绝，错误信息足以让作者重新打包。
- `pnpm run typecheck`、完整 Vitest、生产构建与浏览器关键路径通过。
- Android 的 `verifyNativeComposition` 与 provider/widget 选择测试通过；真机行为仍由发布前真机验收单独确认，不由文档或单元测试代替。
