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

`kind` 为 `provider`、`feature` 或 `theme`。ID 使用小写点分格式；版本使用 SemVer。`entry` 和 `styles` 必须引用包内文件。

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

- `ctx.ui`：页面、导航、设置入口、总览挂件和全局主题。
- `ctx.providers`：学校配置与 `AcademicProvider` 工厂注册。
- `ctx.storage.local` / `ctx.storage.secure`：按插件 ID 命名空间的字符串存储。
- `ctx.http.fetch`：应用网络栈。
- `ctx.native`：原生平台检测与图片保存。
- `ctx.assets.url(path)`：外部插件包内资源的 Blob URL。
- `ctx.i18n`：插件字典注册与文本查询。
- `@ysu/plugin-sdk/host`：Provider 所需的完整宿主协议、认证和会话门面。

完整信任插件仍可使用标准浏览器与 Capacitor API；SDK 服务用于减少重复实现，不构成权限边界。

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
- `@ysu/plugin-sdk`

其他依赖会正常打包。命令输出 ZIP 路径、大小和 SHA-256；市场索引必须记录同一个哈希。

## 市场索引

客户端读取 `https://ysu.welain.com/updates/plugins.json`，协议类型见 `market.ts`。每个 release 必须声明 `apiVersion`、平台、ZIP URL、字节大小与 SHA-256，可选 `minAppVersion`。客户端只展示兼容当前 API、应用版本和平台的最高版本；网络失败时使用本地缓存并标记为过期。
