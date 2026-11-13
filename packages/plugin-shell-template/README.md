# 社区 Shell 模板

这是一个不导入宿主私有模块的完整 UI 替换示例。它忽略默认 Next.js 页面树，直接通过公共 UI 快照组合插件页面和导航。

```bash
pnpm plugin pack packages/plugin-shell-template
```

安装 ZIP 后，在「我的 → 插件 → 应用界面」选择 **Community Shell**。替代界面右上角提供「恢复默认界面」；停用、卸载或渲染崩溃也会恢复默认 Shell。

模板通过 `@orahako/plugin-ui` 复用激活、Provider 初始化、MFA、通知与页面错误隔离，通过 `@orahako/plugin-sdk` 组合页面和恢复默认 Shell。它不依赖任何 `@/` 私有导入。
