# 社区 Shell 模板

这是一个不导入宿主私有模块的 API v3 Shell 示例。它通过派生 Props 读取 UI 快照、组合插件页面和导航，并提供恢复默认 Shell 的入口。

```bash
pnpm plugin pack packages/plugin-shell-template
```

安装 ZIP 后，在「我的 → 插件 → 应用界面」选择 **Community Shell**。替代界面右上角提供「恢复默认界面」；停用、卸载或渲染崩溃也会恢复默认 Shell。

模板从 `@orahako/sdk` 导入公共契约。`registerShell` 的 `children` Props 由宿主提供，包含已按当前路由渲染的插件页面；导航按钮通过注入的回调调用路由服务。
