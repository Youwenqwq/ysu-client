# 社区 Shell 模板

这是一个不导入宿主私有模块的 API v1 Shell 示例。它通过派生 Props 读取 UI 快照、组合插件页面和导航，并提供恢复默认 Shell 的入口。

```bash
pnpm plugin pack packages/plugin-shell-template
```

安装 ZIP 后，在「我的 → 插件 → 应用界面」选择 **Community Shell**。替代界面右上角提供「恢复默认界面」；停用、卸载或渲染崩溃也会恢复默认 Shell。

模板从 `@orahako/sdk` 导入公共契约。它与默认 Shell 声明同一组公共 Slot
（`shell.gate`、`shell.banner`、`shell.activity`、`shell.header.actions`、
`shell.sidebar.footer`、`shell.overlay`），在自己的作用域通过
`ctx.slots.declare` 认领后，以 `declareChildren: false` 注册 Shell。声明是引用计数的，
因此默认 Shell 与社区 Shell 可以同时安装，禁用其中一个不会移除另一个仍在使用的 Slot。

`children` Props 由宿主提供，包含已按当前路由渲染的插件页面；导航按钮通过注入的回调调用路由服务。
模板实际渲染全部公共 Slot，并挂载 `sonner` 的 `Toaster`，从而完整替代默认 Shell 的
overlay、banner、activity、header actions、sidebar footer 与 gate 链。

Shell 必须用 `BackLayerProvider` 桥接 `ctx.router.registerBackGuard`，对话框、抽屉和下拉菜单才能优先消费 Android 返回。自定义页面守卫在不处理当前页面时必须返回 `true`；只有已经关闭弹层或页面内状态时才返回 `false`，否则会吞掉其他页面的返回。
