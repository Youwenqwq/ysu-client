# 社区 Shell 模板

这是一个不导入宿主私有模块的 API v3 Shell 示例。它通过派生 Props 读取 UI 快照、组合插件页面和导航，并提供恢复默认 Shell 的入口。

```bash
pnpm plugin pack packages/plugin-shell-template
```

安装 ZIP 后，在「我的 → 插件 → 应用界面」选择 **Community Shell**。替代界面右上角提供「恢复默认界面」；停用、卸载或渲染崩溃也会恢复默认 Shell。

模板从 `@orahako/sdk` 导入公共契约。`registerShell` 的 `children` Props 由宿主提供，包含已按当前路由渲染的插件页面；导航按钮通过注入的回调调用路由服务。

Shell 必须用 `BackLayerProvider` 桥接 `ctx.router.registerBackGuard`，对话框、抽屉和下拉菜单才能优先消费 Android 返回。自定义页面守卫在不处理当前页面时必须返回 `true`；只有已经关闭弹层或页面内状态时才返回 `false`，否则会吞掉其他页面的返回。
