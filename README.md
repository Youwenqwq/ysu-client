# 酸橙盒（Orahako）

面向大学通用线上服务的第三方客户端，构建于**一切皆插件**的 [Cordis](https://github.com/cordiverse/cordis) 架构之上。内核只负责 composition、ZIP / Cordis 生命周期、恢复与通用 Native bridge；通用应用服务、可选教务运行时、燕大 Provider 与官方界面都由插件提供。默认提供燕大 Provider 与官方界面；其他学校、功能页面、主题和整个应用 Shell 都可以通过插件替换。

文档：[插件组合架构](PLUGIN_ARCHITECTURE.md) · [插件 SDK](packages/plugin-sdk/README.md)

## 开发者预览

本项目正在积极开发中，处于 0.x 阶段。**插件 API、清单格式、Slot / Provider 契约与运行时行为都可能发生不兼容变更，暂不保证插件接口的稳定性。** 插件作者应约束 `apiVersion` 与 `minAppVersion`。

本项目与燕山大学官方无任何关联。

## 功能

目前官方 composition 内置插件提供如下功能：

- **学业**：成绩与 GPA、日程与调课、考试与补考、学生信息、培养方案、评教
- **校园**：劳动教育、双创学分、综合测评、全校课表与空教室、一卡通 / 空调 / 缴费
- **通知**：上课提醒与 Android Live Update、成绩 / 考试监听、桌面小组件
- **扩展**：多学校 Provider、外部 Shell 与主题

功能是否出现由当前学校 Provider 的能力声明与 `supportedPlugins` 决定。教务运行时是可选组合：只装配通用注册表与社区 Shell 的非教务应用也能启动，不包含 `provider` / `session` / `query` 服务。

## 安装

从 [GitHub Releases](https://github.com/Youwenqwq/ysu-client/releases) 下载最新 APK。网络异常时可在应用内配置 GitHub 代理镜像。

Web 端为同一代码库的静态导出 PWA；原生端通过 Capacitor 打包，支持 OTA 热更新与外壳版本检测。

## 插件

在「我的 → 插件」安装市场插件或本地 ZIP，切换 Shell 与主题，并按当前学校安装推荐组合包。插件与应用同权，可访问凭据、会话、网络和原生能力，因此请注意安全，只安装可信来源。

- 应用入口：[`app/composition.ts`](app/composition.ts)；它导出官方 `AppComposition`、`appIdentity` 与首页行为，`app/layout.tsx` 只负责挂载。
- 内核：[`lib/plugins/`](lib/plugins/) 负责 composition、Cordis 运行时、ZIP 安装与恢复，不包含官方 Shell、YSU Provider 或学术 getter。
- 官方组合：[`plugins/official/`](plugins/official/) 提供官方运行时服务、Shell、YSU Provider 与功能插件。通用应用服务（`ui` / `slots` / `settings` / `notifications` / `i18n` / `storage` / `http` / `native` / `assets` / `plugins` / `analytics` / `announcement` / `updater` / `mfa`）与可选教务服务（`providers` / `session` / `provider` / `query` / `navigation` / `provider-support`）都是可替换/可省略的运行时插件；YSU Provider（`ysu.provider`）与官方 Shell（`orahako.shell`）只由官方 composition 装配，不是内核默认值。
- 外部 ZIP 只能使用公共 SDK、`@orahako/plugin-ui` 子路径和宿主共享模块；不能使用 `@/` 私有导入，也不存在 `@orahako/plugin-sdk/host`（仓库内官方插件可以使用 `@/`）。Provider 通过 `ctx.providers.registerProvider(schoolId, factory)` 注册，没有根目录 `providers/`、`SchoolConfig` 或 `server-config`。
- 架构边界：[PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md)
- 包格式与 API 2：[packages/plugin-sdk](packages/plugin-sdk/README.md)
- 起步模板：[功能插件](packages/plugin-template) · [完整 Shell](packages/plugin-shell-template)
- 完整示例：[Perlica 社区插件](https://github.com/Youwenqwq/orahako-official-plugins/tree/main/plugins/perlica-toybox)

## 数据与安全

业务逻辑在本地运行。原生端直接访问学校系统；Web 端经同源 EdgeOne 边缘函数按域名白名单转发，官方插件不提供集中存储教务数据的业务后端。凭据保存在系统安全存储中。

插件市场只分发插件包与索引，插件自身的网络行为由插件与用户授权决定。

## 兼容性

对于 Capacitor 端，要求：

- Android 7.0（API 24）及以上
- 系统 WebView 最低要求 Chromium v111

对于 Web 端：

- Chromium 内核大于 v119

## 开发

```sh
pnpm install
pnpm run dev              # Next.js dev server
pnpm run typecheck        # next typegen + tsc --noEmit
pnpm run test             # Vitest
pnpm run build            # 静态导出到 dist/
pnpm plugin pack <plugin-dir> [output.zip]
```

Android 构建由 `android/nativeComposition.gradle` 选择 provider 模块/类、companion 模块与 deep-link 配置；`app` 只依赖 `:native-core` 与所选 provider。通用 widget host（`:native-widgets`）可以不带 schedule/exam companion 单独构建，权限和组件由各模块自己的 manifest 声明。

```sh
pnpm run build
npx cap sync
cd android && ./gradlew verifyNativeComposition assembleDebug
```

发布入口：

```sh
pnpm run release          # 预检、创建草稿、编辑 notes、发布
```

发布由 GitHub Actions 构建 `dist.zip`、签名 APK 与 `version.json`。本仓库文档不表示已完成线上部署或真机验收；Android WebView、通知、闹钟、后台轮询、widget 和真实学校账号仍需单独真机验收。

## 相关项目

- [ysu-sdk](https://github.com/Youwenqwq/ysu-sdk) — 教务系统 SDK

## 协议

本项目源代码按 [GPL-3.0 协议](LICENSE) 开放。
