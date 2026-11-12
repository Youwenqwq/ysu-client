# 插件模板

复制本目录，修改 `manifest.json` 的 ID、名称和版本，再实现 `src/index.tsx` 与页面。

```bash
pnpm install
pnpm plugin pack <你的插件目录>
```

随后在应用「我的 → 插件 → 安装 ZIP」中选择生成的包。插件完整运行于应用主上下文，请只安装信任的包。

SDK 和完整 API 说明见 `packages/plugin-sdk/README.md`。
