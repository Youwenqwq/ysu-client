# 燕大终端插件 SDK

插件是运行在应用主上下文中的完整 JavaScript / React 模块。插件与应用拥有相同能力；使用者负责判断侧载来源是否可信。

## 包结构

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
  "apiVersion": 1,
  "kind": "feature",
  "entry": "dist/index.js",
  "styles": ["dist/index.css"],
  "minAppVersion": "0.15.0"
}
```

`kind` 为 `provider`、`feature`、`theme` 或 `shell`。ID 使用小写点分格式；版本使用 SemVer。`entry` 和 `styles` 必须引用包内文件。`requires` 可声明必须先处于运行状态的插件 ID。

## 开发入口

```tsx
import { definePlugin } from "@ysu/plugin-sdk"
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

注册函数返回清理函数；插件停用或卸载时 Cordis 也会自动清理页面、导航、主题、设置、挂件、翻译和 Provider 注册。

## Shell 与 UI Slot

完整应用界面通过 `ctx.ui.registerShell()` 注册，组件接收 `children` 和 `selectShell()`。Shell 可以包装或完全忽略默认 Next.js 内容；应提供恢复默认界面的入口。纯外部示例见 `packages/plugin-shell-template`。

Shell 使用 `ctx.slots.declare()` 声明 `single`、`list` 或 `keyed` Slot，扩展插件使用 `ctx.slots.register()` 注册组件。`single`/`keyed` 以最低 `priority` 生效，`list` 按 `order` 排列。声明和贡献都随插件卸载自动清理；移除声明会级联移除贡献。

```tsx
ctx.slots.register({
  id: "my-header-action",
  slot: "dashboard.header.actions",
  component: MyHeaderAction,
})
```

`PluginSlot` 让 Shell 渲染 Slot，无需导入宿主私有模块。`ctx.ui.getSnapshot()` 与 `ctx.ui.subscribe()` 提供页面和导航快照，供替代 Shell 自行组合。

## 页面与 URL

插件页面由固定宿主渲染：

```text
/dashboard/plugin/?plugin=org.example.my-plugin&page=index
```

页面组件接收 `PluginPageProps`：

- `pluginId`、`pageId`
- `params`：保留重复参数的 `URLSearchParams`
- `navigate(page, params)`：插件内导航

不要在静态导出应用里为外部插件声明 Next.js 动态段。插件应使用 `page` 与 query 参数组织子页面。

## 宿主服务

- `ctx.ui`：Shell、页面、导航、设置入口、总览挂件、全局主题和可订阅快照。
- `ctx.slots`：带类型、优先级和自动清理的 UI Slot。
- `ctx.hostLifecycle`：Provider 初始化完成订阅；晚注册也会执行。
- `ctx.providers`：学校配置与 `AcademicProvider` 工厂注册。
- `ctx.plugins`：按插件 ID 安装与当前应用和平台兼容的市场版本。
- `ctx.storage.local` / `ctx.storage.secure`：按插件 ID 命名空间的字符串存储。
- `ctx.http.fetch`：应用网络栈。
- `ctx.native`：原生平台检测、图片保存及通知、精确闹钟、电池优化权限申请。
- `ctx.assets.url(path)`：外部插件包内资源的 Blob URL。
- `ctx.i18n`：插件字典注册与文本查询。
- `@ysu/plugin-sdk/host`：Provider 所需的完整宿主协议、认证和会话门面。

完整信任插件仍可使用标准浏览器与 Capacitor API；SDK 服务用于减少重复实现，不构成权限边界。

## 学校 Provider

Provider 插件通过 `ctx.providers.registerSchool({ config, providerFactory })` 同时注册学校配置与实现工厂。实现应继承 `BaseProvider`，只覆盖已声明能力的对应方法；认证核心方法必须实现。学校停用后，注册会随插件作用域自动撤销。`supportedPlugins` 可进一步按插件 ID 限定该学校支持的页面、导航和总览挂件；缺省保持兼容，不限制插件。

`plugins/market/zmu-provider` 是非 EMAP 教务系统的最小参考：本地验证码密码登录、CookieJar 会话恢复、学籍、全学期课表、成绩/GPA 和考试均只使用公共 SDK。需要与 CookieJar 绑定的验证码图片时，Provider 应通过 `fetchWithJar` 读取图片并返回 data URL，不能把远端图片 URL 当作可携带会话的普通 `<img>` 地址。

公共 `@orahako/plugin-sdk/crypto` 子路径提供 AES-128-ECB/PKCS7 与 Base64 工具，供确有该协议要求的 Provider 使用。Web 端新增学校域名仍须加入部署侧代理白名单；插件注册本身不能绕过该网络安全边界。

## 构建与打包

仓库提供可直接复制的 `packages/plugin-template`：

```bash
pnpm plugin pack packages/plugin-template
```

打包器使用 esbuild，输出 ESM 并生成 ZIP。以下模块由宿主共享，不会被打进插件：

- `react`
- `react-dom`
- `react-dom/client`
- `react/jsx-runtime`
- `next/link` / `next/image` / `next/navigation`
- `@ysu/academic`
- `@ysu/plugin-ui/components` / `hooks` / `stores` / `academic` / `platform` / `plugin` / `shell` / `assets`
- `@ysu/plugin-sdk`

其他依赖会正常打包。命令输出 ZIP 路径、大小和 SHA-256；市场索引必须记录同一个哈希。

## 市场索引

客户端读取 `https://ysu.welain.com/updates/plugins.json`，协议类型见 `market.ts`。每个 release 必须声明 `apiVersion`、平台、ZIP URL、字节大小与 SHA-256，可选 `minAppVersion`。客户端只展示兼容当前 API、应用版本和平台的最高版本；网络失败时使用本地缓存并标记为过期。
