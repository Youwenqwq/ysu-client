# 插件模板

复制本目录，修改 `manifest.json` 的 ID、名称和版本，再实现 `src/index.tsx` 与页面。模板同时注册一个页面和 `dashboard.header.actions` Slot，并通过 `requires` 声明默认 Shell 依赖。

```bash
pnpm install
pnpm plugin pack <你的插件目录>
```

随后在应用「我的 → 插件 → 安装 ZIP」中选择生成的包。插件完整运行于应用主上下文，请只安装信任的包。

模板组件直接使用 Tailwind 类（如 `text-muted-foreground`）。打包器会把源码中用到的工具类编译成 `dist/tailwind.css` 并加入 ZIP 清单，映射到宿主颜色、圆角和明暗主题；自带 CSS 通过 `import "./style.css"` 保留为 `dist/index.css`。不要为插件单独引入 Tailwind 构建或 preflight。

SDK 和完整 API 说明见 `packages/plugin-sdk/README.md`。
