<div align="center">
  <img src="public/icon.svg" alt="Orahako" width="88" height="88" />
  <h1>酸橙盒 Orahako</h1>
  <p>面向大学通用线上服务的第三方客户端，构建于 <strong>Cordis</strong> 插件架构之上</p>
  <p>
    <a href="PLUGIN_ARCHITECTURE.md">插件组合架构</a> ·
    <a href="packages/core/sdk/README.md">API v1 SDK</a> ·
    <a href="packages/core/cli/README.md">插件 CLI</a> ·
    <a href="https://github.com/Youwenqwq/orahako/releases">下载 APK</a>
  </p>
</div>

> [!NOTE]
> 本项目处于 **0.x 开发者预览阶段**。API v1、清单格式、Slot、Provider 与运行时行为可能发生不兼容变更；插件作者应约束 `apiVersion` 与 `minAppVersion`。

内核只负责组合、ZIP / Cordis 生命周期、恢复和通用 Native bridge；通用应用服务、可选教务运行时、燕大 Provider 与官方界面都由可替换插件提供。

## 架构速览

API v1 将通用契约与内核、运行时服务、教务能力、客户端 UI、业务插件和应用组合分别放在 `packages/{core,runtime,edu,client,plugins,bundle}`。`app/layout.tsx`、`app/page.tsx` 与 `app/manifest.ts` 提供静态根入口；运行时页面由 `ctx.router` 通过根路径查询参数定位，例如 `/?route=schedule`。

默认应用按 `platform → academic → ysu` 叠加三个 Bundle。非教务应用只需平台 Bundle，不依赖 Provider、会话或教务查询；燕大组合在教务 Bundle 之上加入燕大 Provider 与应用配置。

## 功能与安装

官方 composition 可提供成绩与 GPA、日程、考试与补考、学生信息、培养方案、评教、校园服务、通知、桌面小组件和扩展 Shell。功能是否出现由当前 Provider 的能力切片与 `supportedPlugins` 决定；教务运行时是可选组合。

从 [GitHub Releases](https://github.com/Youwenqwq/orahako/releases) 下载最新 APK。Web 端是同一代码库的静态导出 PWA；原生端通过 Capacitor 打包，支持 OTA 热更新与外壳版本检测。应用内插件管理器可以安装市场包或可信来源的本地 ZIP。插件与应用同权，可访问凭据、会话、网络与 Native 能力，请只安装可信来源。

官方外部插件源码维护于 [`Youwenqwq/orahako-official-plugins`](https://github.com/Youwenqwq/orahako-official-plugins)，官方市场索引与 ZIP 由 [`Youwenqwq/orahako-plugin-registry`](https://github.com/Youwenqwq/orahako-plugin-registry) 通过 GitHub Raw 分发。

### 数据与兼容性

原生端直接访问学校系统；Web 端经同源 EdgeOne 边缘函数按域名白名单转发。官方插件不提供集中存储教务数据的业务后端。Android 的教务凭据使用系统安全存储；Web 没有同等安全存储保证。

Android 要求 7.0（API 24）及以上，系统 WebView 至少为 Chromium 111；Web 端要求 Chromium 内核高于 119。

## 开发与验证

```sh
pnpm install
pnpm run dev
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run verify-architecture
pnpm run build
pnpm run build:packages
pnpm plugin pack <plugin-directory> [output.zip]
```

外部包的 API v1 清单、共享模块 `PLATFORM_MODULES`、独立仓库使用 `@orahako/sdk` 与 `@orahako/cli` 打包及发布流程见 [SDK 指南](packages/core/sdk/README.md) 与 [CLI 文档](packages/core/cli/README.md)。公共 npm 包（`@orahako/sdk`、`@orahako/ui-primitives`、`@orahako/academic-sdk`、`@orahako/cli`）由 `pnpm run build:packages` 构建，并通过 `pnpm run publish:packages` 发布。

Android 组合验证：

```sh
pnpm run build
npx cap sync
cd android && ./gradlew verifyNativeComposition testDebugUnitTest
```

发布入口：

```sh
pnpm run release
```

发布由 GitHub Actions 构建 `dist.zip`、签名 APK 与 `version.json`。文档不表示已完成线上部署或真机验收；Android WebView、通知、闹钟、后台轮询、widget 和真实学校账号仍需单独验收。

## 相关项目与协议

- [orahako-official-plugins](https://github.com/Youwenqwq/orahako-official-plugins) — 官方外部插件源码仓库
- [orahako-plugin-registry](https://github.com/Youwenqwq/orahako-plugin-registry) — 官方插件市场索引与 ZIP 分发仓库
- [ysu-sdk](https://github.com/Youwenqwq/ysu-sdk) — 教务系统 SDK

本项目源代码按 [GPL-3.0 协议](LICENSE) 开放。
