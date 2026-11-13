# `@ysu/plugin-ui`

官方与社区插件共享的 React UI Kit 和应用运行时门面。所有导出都指向现有实现，宿主与外部包共享同一模块实例。

## 按副作用边界导入

根入口不汇聚实现。请使用明确子路径：

| 子路径 | 内容 |
|---|---|
| `@ysu/plugin-ui/components` | shadcn/ui、通用学术组件、响应式弹窗与 `cn` |
| `@ysu/plugin-ui/hooks` | i18n、Provider 数据、媒体与设备 hooks |
| `@ysu/plugin-ui/stores` | 应用 Store、Provider 操作与存储工具 |
| `@ysu/plugin-ui/academic` | 学期、课表和考试工具 |
| `@ysu/plugin-ui/platform` | 原生桥、通知、导航、限流和版本信息 |
| `@ysu/plugin-ui/plugin` | 插件 UI 快照、路由 Store 与语义导航解析器 |
| `@ysu/plugin-ui/shell` | 激活、Provider 初始化、MFA、通知和 Shell 宿主 hooks |
| `@ysu/plugin-ui/assets` | 宿主公开的静态资源 |

```tsx
import { Button, Card } from "@ysu/plugin-ui/components"
import { useGrades } from "@ysu/plugin-ui/hooks"
```

不要恢复根 barrel：宿主同时加载公共模块和官方插件，根汇聚会把无关 Store/Shell 引入模块求值环。子路径同时让测试和社区包只加载实际依赖。

完整信任模型不变：这些模块是公共便利 API，不构成权限边界。替代 Shell 可以完全不用官方 UI Kit。
