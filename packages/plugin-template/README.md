# 插件模板

复制本目录，修改 `manifest.json` 的 ID、名称和版本，再实现 `src/index.tsx` 与页面。模板使用 API v1 的 `definePlugin` 注册派生 Props 页面，并通过 `slots.inject` 等待默认 Shell 的 `shell.header.actions` Slot。

```bash
# 在独立插件仓库中使用（无需克隆宿主仓库）
pnpm add -D @orahako/sdk @orahako/ui-primitives @orahako/cli
pnpm exec orahako pack <你的插件目录>

# 或在宿主仓库根目录中直接打包
pnpm install
pnpm plugin pack <你的插件目录>
```

随后在应用「我的 → 插件 → 安装 ZIP」中选择生成的包。插件完整运行于应用主上下文，请只安装信任的包。

模板组件直接使用 Tailwind 类（如 `text-muted-foreground`）。打包器会把源码中用到的工具类编译成 `dist/tailwind.css` 并加入 ZIP 清单，映射到宿主颜色、圆角和明暗主题；自带 CSS 通过 `import "./style.css"` 保留为 `dist/index.css`。不要为插件单独引入 Tailwind 构建或 preflight。

公共契约见 [SDK 源码](../core/sdk/src/index.ts)。
