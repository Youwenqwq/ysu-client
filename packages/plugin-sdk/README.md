# 酸橙盒插件 SDK

插件是运行在应用主上下文中的完整 JavaScript / React 模块。插件与应用拥有相同能力；使用者负责判断侧载来源是否可信。

插件运行在 `CompositionSource` 组合出的应用里。composition 选择每个插件行、应用身份、默认 Shell / 学校 / 首页、市场与原生能力；插件通过 manifest 声明依赖的服务、其他插件、配置 schema 和原生能力。外部 ZIP 不能修改 composition，只能作为附加插件安装。

## 包结构与清单

```text
my-plugin/
├── manifest.json
├── src/
│   ├── index.tsx
│   ├── page.tsx
│   └── style.css
└── assets/                 # 可选
```

```json
{
  "id": "org.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "apiVersion": 2,
  "minAppVersion": "0.16.0",
  "kind": "feature",
  "entry": "dist/index.js",
  "styles": ["dist/index.css"],
  "categories": ["toybox"],
  "inject": ["ui", "slots", "i18n", "storage"]
}
```

`kind` 为 `runtime`、`provider`、`feature`、`theme` 或 `shell`。`runtime` 通常表示以提供根服务为主的插件（例如 composition 中的会话、查询与注册表服务）；其他 kind 也可以声明 `provides`。`provider` 注册学校；`feature` 注册页面/设置/业务功能；`theme` 贡献 CSS；`shell` 替换应用根。ID 使用小写点分格式；版本使用 SemVer。`entry`、`styles`、`icon` 必须引用包内安全相对路径。

| 字段 | 说明 |
| --- | --- |
| `id` / `name` / `version` | 小写点分 ID、显示名与 SemVer |
| `kind` | `runtime` / `provider` / `feature` / `theme` / `shell` |
| `entry` | 包内 ESM 入口 |
| `styles` / `icon` | 可选包内样式与图标路径 |
| `apiVersion` | 必须为 `2`；旧值被拒绝 |
| `minAppVersion` | 可选最低应用版本；市场选择时检查 |
| `description` / `author` / `homepage` | 可选展示元数据 |
| `requires` | 插件 ID → SemVer 范围，表示必须先 `active` 的插件 |
| `inject` | 启动前必须存在的 Cordis 根服务名；全部按 required 处理 |
| `provides` | 本插件声明的根服务名；`apply` 后必须已 `ctx.set` |
| `configSchema` | JSON Schema draft-07 对象；宿主在启动前校验并应用 `default` |
| `nativeCapabilities` | 版本化 Android 能力引用，如 `"native.geolocation@1"` |
| `required` | 核心插件标记，不能从插件管理页停用 |
| `providerIndependent` | 全局 UI/工具功能，不因学校 `supportedPlugins` 被停止 |
| `categories` | 市场与插件管理的开放分类字符串 |

`apiVersion` 必须为 `2`，`minAppVersion` 建议与当前应用版本（`0.16.0`）同步；不兼容的清单会被宿主拒绝。API 1 的 ZIP 是有意不兼容的，不存在迁移或兼容路径。

`inject` 是服务依赖，不是插件依赖。需要“必须先存在某个插件”时使用 `requires`，例如 `{ "orahako.shell": "^1.0.0" }`。依赖未激活或版本不满足时启动失败；停用插件会级联停用依赖项；同 ID 更新替换不级联。

`configSchema` 的配置来自 composition 条目的 `config`。外部安装包没有 composition 条目，因此以空对象校验；外部插件必须自带默认行为，不能假设用户会编辑配置。

## 开发入口

```tsx
import { definePlugin } from "@orahako/plugin-sdk"
import { ExamplePage } from "./page"
import { ExampleIcon } from "./icon"
import "./style.css"

export default definePlugin((ctx) => {
  ctx.i18n.register({
    zh: { example: { title: "示例" } },
    en: { example: { title: "Example" } },
  })

  ctx.ui.registerPage({
    id: "index",
    title: "Example",
    titleKey: "example.title",
    component: ExamplePage,
  })

  ctx.ui.registerNavigation({
    id: "example",
    title: "Example",
    titleKey: "example.title",
    page: "index",
    icon: ExampleIcon,
    group: "plugins",
  })
})
```

仓库内插件导出 `manifest`，与实现一同参与类型检查与测试；外部插件最终以 ZIP 内的 `manifest.json` 为准，两者字段必须一致（打包器只会在插件使用 Tailwind 工具类时把 `dist/tailwind.css` 追加到 `styles`）：

```tsx
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/plugin-sdk"

export const manifest: PluginManifest = {
  id: "org.example.my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  minAppVersion: "0.16.0",
  kind: "feature",
  entry: "dist/index.js",
  inject: ["ui", "i18n"],
  configSchema: {
    type: "object",
    properties: { greeting: { type: "string", minLength: 1 } },
    additionalProperties: false,
  },
}

export default definePlugin((ctx, config) => {
  const greeting = typeof config.greeting === "string" ? config.greeting : "Hello"
  ctx.i18n.register({ en: { example: { greeting } } })
})
```

注册函数返回清理函数；插件停用或卸载时 Cordis 也会自动清理页面、导航、主题、设置、挂件、翻译、通知渠道、活动标签和 Provider 注册。不要把可清理的注册保存在模块级单例里，也不要在 `apply` 之外执行一次性的全局注册。

## 服务与依赖

根服务由运行时插件提供。插件通过 `inject` 获取服务，通过 `provides` 提供新服务：

```ts
// 提供方：manifest.provides = ["example.feed"]
export default definePlugin((ctx) => {
  ctx.set("example.feed", {
    read: () => [...],
  })
})
```

- 宿主在 `apply` 完成后检查每个 `provides` 名称是否已注册；缺失则插件进入 `failed`。
- 消费者若在 `inject` 中声明该名称，会在服务缺失时保持 `registered` 并且不执行，不会拿到 `undefined`。
- 服务实例属于提供方插件作用域。提供方停用/更新时实例释放；注入该服务的消费者会被停用，并在新服务就绪后重启。消费者必须让 `apply` 可重复执行。
- 服务可以实现按消费者绑定的 facade：

```ts
import { PLUGIN_SERVICE_SCOPE, type ScopedPluginService } from "@orahako/plugin-sdk"

class FeedRegistry implements ScopedPluginService<FeedService> {
  private readonly items = new Map<string, Set<unknown>>()

  add(pluginId: string, item: unknown): () => void {
    const bucket = this.items.get(pluginId) ?? new Set()
    this.items.set(pluginId, bucket)
    bucket.add(item)
    return () => {
      if (!bucket.delete(item)) return
      if (bucket.size === 0) this.items.delete(pluginId)
    }
  }

  [PLUGIN_SERVICE_SCOPE](ctx, manifest): FeedService {
    return {
      register: (item) => {
        const dispose = this.add(manifest.id, item)
        ctx.on("dispose", dispose)
        return dispose
      },
    }
  }
}
```

宿主会在每个消费者的隔离作用域里注入 facade，因此注册项可以按插件归属并自动撤销。所有 facade 工厂收到的都是该消费者的最终上下文，与插件 `apply` 收到的上下文一致；facade 可以保存它用于页面、Shell 等注册项，并读取消费者注入的其他 facade。公开的 `trackPluginRegistration(ctx, register)`（来自 `@orahako/plugin-sdk`）封装了同一模式：先挂接上下文 dispose，再发布注册，避免已销毁的插件上下文泄漏全局状态。

清单 `inject` 中的服务名必须由 composition 中的某个插件（或宿主 `packageRuntime`）提供。只写 `inject` 而不在选择该服务的 composition 里运行，插件不会启动。外部 ZIP 可以提供新服务给其他外部插件，但不能在市场安装时并行替换一个已由 composition 提供的核心服务；替换核心服务需要改 composition。

消费者在清单中声明服务后即可读取：

```ts
export const manifest: PluginManifest = {
  // ...
  inject: ["example.feed"],
}

export default definePlugin((ctx) => {
  const feed = ctx.get("example.feed") as FeedService
  void feed.read()
})
```

## 完整应用 Shell

完整应用界面通过 `ctx.ui.registerShell()` 注册：

```ts
interface PluginShellProps {
  context: PluginContext
  children: ReactNode
  selectShell(id?: string): void
}
```

Shell 接收当前 Next.js 路由内容 `children` 和自身插件作用域的 `context`，可以组合、包装或完全忽略 `children` 并自行渲染页面。`selectShell(id)` 切换 Shell；`selectShell(undefined)` 恢复 composition 默认 Shell。应提供恢复默认界面的入口。纯外部示例见 `packages/plugin-shell-template`。

Shell 选择以 `pluginId:shellId` 持久化。选中的 Shell 停用、卸载或渲染失败时回到 composition 默认 Shell；默认 Shell 也失败时由内核显示重新加载界面。

## 页面与导航

插件页面由固定宿主渲染：

```text
/dashboard/plugin/?plugin=org.example.my-plugin&page=index&route=<semantic>
```

页面组件接收 scoped `PluginContext`：

```ts
interface PluginPageProps {
  context: PluginContext
  pluginId: string
  pageId: string
  params: URLSearchParams       // 保留重复参数
  navigate(page, params?): void // 插件内导航
}
```

`context` 是注册该页面的插件作用域，可以直接使用 `context.ui` / `context.slots` / `context.navigation` 等服务。

`route` 是跨插件唯一的稳定语义路由（例如 `schedule`），导航 ID 也是稳定语义；核心不通过插件 ID 定位功能。冲突的语义路由在加载时失败。页面可选 `capability` 要求当前 Provider 具备某能力，`requiresProvider: false` 允许全局工具页面不依赖当前学校；`fullscreen` 只是展示意图，由 Shell 决定是否采用。

导航默认使用 `scope: "app"`，参与应用侧边栏、全局首页和语义路由解析。插件内部主功能使用 `scope: "plugin"`；默认 Shell 会在该插件处于活动状态时，用这些项目替换移动端底部应用导航，无可用项目时自动回退。内部导航不使用 `group` 或 `primary`，可通过 `params` 指向同页功能区，通过可选 `badge` 组件提供未读等状态：

```tsx
ctx.ui.registerNavigation({
  id: "messages",
  title: "Messages",
  titleKey: "example.messages",
  page: "messages",
  icon: MessageIcon,
  badge: MessagesBadge,
  scope: "plugin",
  order: 10,
})
```

`ctx.navigation` 可用于自行组合导航：

- `sources()`：当前页面、导航、Provider 能力、学校允许列表与 fallback；
- `resolve(id)`：解析语义 route / 导航 ID 到 `{ pluginId, pageId }`；
- `primary()`、`landing(preference)`：默认首页；
- `forScope("app" | "plugin", pluginId?)`：已过滤、排序的导航。

页面与导航都会按 Provider `capabilities` 和 `supportedPlugins` 过滤。`providerIndependent` 只保证插件不被停止；页面若要在不支持当前学校时仍可打开，必须声明 `requiresProvider: false`。

不要在静态导出应用里为外部插件声明 Next.js 动态段。插件应使用 `page` 与 query 参数组织子页面。

## Slot、设置、通知与网络活动

Slot 用于增量 UI 组合。Shell 使用 `ctx.slots.declare()` 声明 `single`、`list` 或 `keyed` Slot，扩展插件使用 `ctx.slots.register()` 注册组件：

```tsx
ctx.slots.register({
  id: "my-header-action",
  slot: "dashboard.header.actions",
  component: MyHeaderAction,
})
```

- `single` / `keyed` 以最低 `priority` 生效，`list` 按 `order` 排列。
- 未声明的 Slot、keyed 缺少 key、single/keyed 同优先级冲突都会在加载时失败。
- 声明和贡献都随插件卸载自动清理；移除声明会级联移除贡献。
- `PluginSlot` 让 Shell 渲染 Slot，无需导入宿主私有模块；`usePluginSlotHasContributions()` 可在没有贡献时隐藏容器。

默认 Shell 声明 `shell.overlay`、`shell.activity`、`dashboard.header.actions`、`settings.startupOptions` 与 `settings.widgets`。

设置分类：

```tsx
ctx.settings.registerCategory({
  id: "my-settings",
  title: "My settings",
  description: "Configure this plugin",
  icon: SettingsIcon,
  component: MySettingsPanel,
})
```

主设置页统一展示“插件设置”入口，`/dashboard/me/settings/plugins/?category=<id>` 渲染对应面板；分类随插件作用域释放。不要自行新增设置路由。

通知渠道是开放字符串：

```ts
const dispose = ctx.notifications.register("my-channel")
const channels = ctx.notifications.getSnapshot()
```

渠道注册按插件归属，可重复注册并在每次 disposer 调用时平衡；渠道随插件作用域撤销。`orahako.notifications` 只消费渠道快照，不按插件 ID 推断能力。设置 UI 可通过 `settings.notifications.content` / `.reminders` / `.appReminders` Slot 组合。

网络活动是只读快照：

```ts
const unsubscribe = ctx.http.activity.subscribe(render)
ctx.http.activity.getSnapshot()
const removeLabeler = ctx.http.activity.registerLabeler((url) => "my.label.key")
const removeClassifier = ctx.http.activity.registerClassifier((url) => "my-category")
```

快照只暴露分类、方法、单调时间、耗时、失败计数与 labeler 返回的 i18n key，不暴露 URL、域名、请求头、body 或 cookie。labeler 在 URL 被丢弃前同步执行；它必须返回本插件注册的 i18n key，或 `undefined` 回退到通用分类。`shell.activity` Slot 用于默认 Shell 顶栏的活动提示。

每个 HTTP 服务实例持有独立的活动运行时，替换服务不会继承旧 labeler、classifier 或快照。`beginRequest()` 是宿主传输层（`ctx.http.send()` 与 `ctx.session.fetchWithJar()`）记录请求边界的钩子，插件只应读取快照或注册 labeler/classifier。

## 会话、Provider、查询与事件

### Session

```ts
ctx.session.getSnapshot()
ctx.session.subscribe(listener)
ctx.session.setCredential({ schoolId, credential, username })
ctx.session.activateSchool(schoolId)
ctx.session.clearCredential(schoolId?)
ctx.session.setSessionExpired(expired)
ctx.session.setArtifact(key, value, schoolId?)
ctx.session.getArtifact(key, schoolId?)
ctx.session.createCookieJar(serialized?)
ctx.session.fetchWithJar(jar, request)
```

`SessionSnapshot` 包含 `activeSchoolId`、`credential`、`username`、`isAuthenticated`、`sessionExpired`、`hasHydrated` 与 `artifacts`；字段是学校无关的。`isAuthenticated` 与 `sessionExpired` 必须分开：过期不等于退出登录。没有活动学校时，需要学校上下文的操作会抛错，不会回退到另一所学校。

### Provider 运行时

```ts
ctx.provider.getSnapshot()
ctx.provider.subscribe(listener)
ctx.provider.getActive()
ctx.provider.selectSchool(schoolId)
await ctx.provider.initialize()
await ctx.provider.reset()
await ctx.provider.logout()
await ctx.provider.relogin()
```

状态为 `unavailable` / `initializing` / `ready` / `error`。`selectSchool()` 不认识的学校会抛 `FEATURE_NOT_SUPPORTED`，不会替换为其他学校。初始化绑定 generation，旧初始化不能写回新实例。`getActive()` 在尚未选择时按 session 活动学校或 provider 运行时配置的默认学校解析。

### Query

```ts
const snapshot = ctx.provider.getSnapshot()
const identity = {
  providerId: "my-provider", // stable provider-owned id
  providerScope: `${snapshot.schoolId ?? "none"}:${snapshot.generation}`,
  username,
  feature: "grades",
  params,
}
ctx.query.key(identity)
ctx.query.cacheKey({ ...identity, username })
ctx.query.policy("grades")
const unregister = ctx.query.registerPolicy("my-feature", { ttl: 60_000, persist: false })
ctx.query.readPersistent(key)
ctx.query.writePersistent(key, { data, updatedAt })
ctx.query.invalidate({ providerId })
```

持久键包含 provider、`providerScope`（学校 ID + Provider generation）、用户名、feature 与参数。`persist` 为真时仍要求有用户名。`invalidate()` 只让 Provider 查询族失效，并发出 `query/invalidate`。

### 事件

```ts
ctx.on("provider/ready", (snapshot) => {
  if (snapshot.status !== "ready") return
  void refresh()
})
```

| 事件 | 载荷 |
| --- | --- |
| `session/changed` | `SessionSnapshot` |
| `session/expired` | `SessionSnapshot` |
| `provider/changed` | `ProviderRuntimeSnapshot` |
| `provider/ready` | `ProviderRuntimeSnapshot` |
| `query/invalidate` | `Partial<ProviderQueryIdentity> \| undefined` |

事件随插件作用域释放。需要幂等初始化时，先检查 `ctx.provider.getSnapshot().status`，再订阅后续事件。

## 学校 Provider

Provider 插件通过 `ctx.providers.registerProvider(schoolId, factory)` 注册实现工厂；学校协议字段完全由插件自己定义，不进入 SDK：

```ts
ctx.providers.registerProvider("zmu", (ctx) => new ZmuProvider(ctx))
```

`ProviderFactory` 接收贡献者的 `PluginContext`，因此实例可以使用该插件自己的 `session` / `http` / `query` 等作用域服务。Provider 只需实现 `ManagedProvider` 的最小生命周期（`initialize` / `reset` / `logout` / `relogin`），学术能力由 `AcademicProvider` 扩展。插件停用后注册随作用域自动撤销；同一学校 ID 的后续注册会替换旧工厂，旧作用域的清理只能撤销自己创建的注册。

实现应继承 `BaseProvider`，只覆盖已声明能力的对应方法。认证核心方法（`prepareLogin`、`resetLoginSession`、`login`、`loginStep1`、`checkAuthStatus`、`logout`、`relogin`、`isAuthenticated`）必须实现；声明了能力但未实现对应方法同样是错误。

- `supportedPlugins` 是学校支持的功能插件允许列表：`undefined` 允许全部，数组（包括空数组）只允许列出的清单 ID。它与 `capabilities` 一起约束功能启停、页面、导航、深链与总览挂件。
- 成绩字母换算由 `gradeScale` 提供。支持 GPA 评级的学校还应提供 `gpaScale`，其中 `max` 是满绩，`bands` 从 0 开始按 `min` 升序排列；每档 `min` 是闭下界。未声明时只显示 GPA 数值。
- 需要与 CookieJar 绑定的验证码图片，应通过 `fetchWithJar` 读取并返回 data URL，不能把远端图片 URL 当作可携带会话的普通 `<img>`。
- 公共 `@orahako/plugin-sdk/crypto` 子路径提供 AES-128-ECB/PKCS7 与 Base64 工具，供确有该协议要求的 Provider 使用。
- Web 端新增学校域名仍须加入部署侧代理白名单；插件注册本身不能绕过该网络安全边界。

[`orahako-official-plugins/plugins/zmu-provider`](https://github.com/Youwenqwq/orahako-official-plugins/tree/main/plugins/zmu-provider) 是非 EMAP 教务系统的最小参考：本地验证码密码登录、CookieJar 会话恢复、学籍、全学期课表、成绩/GPA 和考试均只使用公共 SDK。

## 宿主服务

- `ctx.ui`：Shell、页面、导航、主题与总览挂件的注册表（`registerShell` / `registerPage` / `registerNavigation` / `registerTheme` / `registerOverviewWidget`）及 `getSnapshot()` / `subscribe()`。
- `ctx.slots`：带类型、优先级和自动清理的 UI Slot。
- `ctx.settings`：插件设置分类与详情面板。
- `ctx.notifications`：通知运行时渠道注册与快照。
- `ctx.i18n`：插件词典注册、查询与语言切换。
- `ctx.providers`：按学校 ID 注册 `ManagedProvider` 工厂；学校协议配置由插件自己持有。
- `ctx.session`：会话状态、凭据、artifacts、CookieJar 与带 Jar 请求。
- `ctx.provider`：当前 Provider 实例与初始化/重登录/退出。
- `ctx.query`：Provider 查询键、缓存策略、持久缓存与失效。
- `ctx.navigation`：语义路由、首页与作用域导航。
- `ctx.analytics.track(payload, options)`：向 composition 配置的采集端上报匿名用量；`enabled` 由调用方给出，`oncePerDay` 启用服务端无关的每日去重。
- `ctx.announcement.check()` / `dismiss(id)`：读取 composition 配置的公告文档、过滤过期/未来项并持久化已读。
- `ctx.updater`：读取 composition 配置的发布清单、镜像预设与可镜像源，执行 OTA/APK 下载、安装与回滚。
- `ctx.plugins`：按插件 ID 安装当前应用和平台兼容的市场版本（`installFromMarket`）。
- `ctx.storage.local` / `ctx.storage.secure`：按插件 ID 命名空间的字符串存储。
- `ctx.http.send`：无状态请求，走原生传输或同源 Web 代理。
- `ctx.http.activity`：只读网络活动快照、订阅、labeler 与 classifier。
- `ctx.native`：原生平台检测、图片保存、通知/精确闹钟/电池优化权限申请，以及版本化能力服务。
- `ctx.native.capabilities`：`list()` / `has(id)` / `acquire(id)` / `invoke(id, method, payload)`。能力列表与 config 由 Android 构建固定；`acquire()` 返回幂等释放函数，Web 端不可用时会抛错。
- `@orahako/plugin-sdk/native`：公开 `isCapacitor()` / `isTablet()` 与通用能力桥（`loadNativeCapabilities`、`invokeNativeCapability`、`onNativeCapabilityEvent`、`nativeCapabilities`）。插件操作应优先使用 scoped `ctx.native`；桥主要供宿主/组合层接入能力，不是隐藏的全局默认。
- `ctx.assets.url(path)`：外部插件包内资源的 Blob URL。
- `ctx.mfa.show(request)`：MFA 交互入口。
- `packageRuntime`：宿主提供的包加载原语，供 composition 中的安装器/资源服务使用，普通插件通常不需要。

完整信任插件仍可使用标准浏览器与 Capacitor API；SDK 服务用于减少重复实现，不构成权限边界。不存在 `@orahako/plugin-sdk/host` 之类的完整信任特殊入口，官方插件与外部插件使用同一组公开子路径。

## 构建与打包

仓库提供可直接复制的 `packages/plugin-template`：

```bash
pnpm plugin pack packages/plugin-template
```

打包器使用 esbuild，输出 ESM（target `chrome111`）并生成 ZIP。以下模块由宿主共享，不会被打进插件：

- `react`
- `react-dom`
- `react-dom/client`
- `react/jsx-runtime`
- `next/link` / `next/image` / `next/navigation`
- `sonner`
- `@orahako/academic`
- `@orahako/plugin-ui/components` / `hooks` / `stores` / `academic` / `platform` / `plugin` / `shell` / `assets`
- `@orahako/plugin-sdk` 根入口及其在 `packages/plugin-sdk/host-modules.ts` 中列出的公开子路径（`runtime`、`native`、`composition`、`manifest`、`academic`、`ui`、`slots`、`events`、`services`、`market` 等）

其他依赖会正常打包。包内其余 import 必须是相对路径且不得离开包根；其他裸说明符会在加载时被拒绝。命令输出 ZIP 路径、大小和 SHA-256；市场索引必须记录同一个哈希。

## 样式契约

插件样式完全由插件包提供，宿主不会为外部插件补 Tailwind 工具类。打包器会扫描插件源码中的 Tailwind 类，编译成 `dist/tailwind.css`，写入 ZIP 并自动追加到包内 `manifest.styles`：

- 只包含主题变量、工具类及 Tailwind 为工具类生成的属性回退，不重复注入 preflight 或宿主全局规则。
- 工具类通过 `@theme inline` 映射到宿主 CSS 变量（`--background`、`--muted-foreground`、`--radius` 等），因此颜色、圆角和 `dark:` 变体跟随宿主明暗主题，插件不需要自带调色板或暗色覆盖。
- 插件自己 `import "./style.css"` 的 CSS（Leaflet、自定义 `@keyframes`、第三方面板样式等）仍由 esbuild 打包进 `dist/index.css`，与生成的工具类各自成文件、互不覆盖。
- 插件未声明 `styles` 且使用了 Tailwind 类时，打包器会新增 `dist/tailwind.css` 到 ZIP 内的清单；源码 `manifest.json` 不需要手动登记。未使用任何工具类时不会生成该文件，清单保持原样。
- 安装到未重新构建的旧宿主同样生效：宿主只按 `manifest.styles` 注入插件包自带的 CSS。`@orahako/plugin-ui` 等共享组件仍由宿主提供，插件只额外传入自己的类名。

不要为插件单独引入 Tailwind 构建或 preflight/`@import "tailwindcss"`：宿主已经加载这些全局规则，重复注入会污染其他插件的样式。需要宿主未提供的值时使用任意值语法，例如 `grid-cols-[repeat(auto-fit,minmax(0,1fr))]`。生成的样式随包内容变化，重新打包后 ZIP 的 SHA-256 和市场索引必须同步更新。

## 市场索引

客户端读取 composition 的 `market.indexUrl`；协议类型与 `loadPluginMarket` / `selectCompatibleRelease` / `findAvailableUpdates` / `validateMarketplaceIndex` 等通用加载、选择逻辑均位于 `@orahako/plugin-sdk` 的 `market.ts`。索引 `schemaVersion` 为 `1`，每个 release 必须声明 `version`、`apiVersion`（必须为 `2`）、平台、ZIP URL、字节大小与 SHA-256，可选 `minAppVersion`、`nativeCapabilities` 与 `changelog`。索引元数据由 `Youwenqwq/orahako-plugin-registry` 维护，公开边缘函数只保存同步生成的分发快照。

客户端只展示兼容当前 API、应用版本、平台与 composition 原生能力允许列表的最高版本；网络失败时使用本地缓存并标记为过期。索引可声明可选 `bundles`（`id`、`name`、`schoolId`、`pluginIds`）；组合包执行前会预检所有插件的来源、平台兼容性、Provider 支持范围与原生能力，再安装缺失插件或启用已有插件。SHA-256 只验证包与索引一致，不是来源证明。

## API 2 与旧版

- 清单 `apiVersion` 必须为 `2`，市场 release 的 `apiVersion` 也必须为 `2`。
- 旧 API 1 的 ZIP 与市场条目会被明确拒绝；不要添加兼容 shim 或降级路径，按 API 2 重新打包。
- `minAppVersion` 是应用版本约束，不是插件 API 版本。宿主 API 变化通过 `apiVersion` 表达。
