<p align="center">
  <img src="public/icon.svg" width="128" height="128" alt="燕大终端图标" />
</p>

<h1 align="center">燕大终端</h1>

<p align="center">
  <a href="README.zh-CN.md">详细文档（中文）</a> · <a href="README.en.md">English</a>
</p>

<p align="center">
  燕山大学教务系统第三方 Android 客户端
</p>

---

> 本项目为 **第三方客户端，与燕山大学官方无任何关联。** 仅供个人学习交流，代码**完全由 AI 进行编写**，
> 人工仅进行了基本设计调试与粗略审计，使用即默认了解并接受相关风险，请勿用于侵犯他人权益或违反学校规定的场景。

## 这是什么

燕大终端是一个 Android 应用，可以让你更方便地使用燕山大学教务系统。设计初衷是解决第三方课表需手动更新，
而今日校园 App 加载又过于缓慢，导致信息查询低效率的问题。
另提供基于 AppKit / WKWebView 的 macOS 本地构建版本。

本项目实现了以下功能：

- **登录**：CAS 统一认证，支持验证码和 MFA 多因素验证，记住登录状态；
  内置登录速率限制保护，防止频繁登录触发风控
- **查成绩**：按学期筛选，查看统计、分布和排名；支持学期 GPA 计算与学位课程标识
- **看课表**：合并理论课与实验课，按周切换，桌面和移动端双布局；
  实时高亮当前课程，支持课程活动签到 / 签退，支持手动调课。
- **查考试**：按学期查看考试安排
- **看绩点**：学分和绩点一目了然
- **培养方案**：查看课程完成情况和学业预警
- **评教**：支持学生评教功能，评教支持批量一键自动填写最高分
- **劳动平台**: 劳动记录和劳动时长
- **双创平台**: 双创学分，认定记录，竞赛库等
- **综合测评**: 综测成绩和指标明细查询
- **全校课表**: 查询全校课表和空教室
- **费用查询**: 空调用量，一卡通余额和缴费查询
- **上课通知**：可按完整课表和未来周次生成提醒
- **成绩/考试监听**：支持以最低 15 分钟的间隔监听教务系统，提醒新增成绩和考试安排变化
- **桌面小组件**：提供课表与考试小组件

应用通过 Capacitor 打包为 Android WebView 壳应用，支持 OTA 热更新与 APK 外壳版本检测。

## 数据来源与安全性

燕大终端 App 的所有业务逻辑**均在本地实现**，从官方教务系统获取数据并保存在本地，中间不经过任何其他服务器。
Android/iOS 原生凭据通过系统安全存储（Android Keystore / iOS Keychain）加密保存。
macOS 本地构建目前使用明文文件，限制见下文。

为保证教务系统数据不受意外修改，本项目除学生评教外，均仅实现了数据查询功能。

## 安装

从 [GitHub Releases](https://github.com/Youwenqwq/ysu-client/releases) 下载最新的 APK 安装包。

> 如遇网络故障，可在应用内配置 GitHub 代理镜像。设置入口会在出现网络故障时弹出。

### macOS 原生 App（本地构建）

Apple Silicon Mac，macOS 14 或更新版本。原生界面使用系统 `WKWebView`；
页面资源随 `.app` 打包，运行时不需要 Node、pnpm、终端、浏览器或作者的在线代理/激活码。
本地构建需要 Node.js 22+、pnpm 和 Xcode Command Line Tools 中的 Swift 编译器：

```bash
pnpm install --frozen-lockfile
pnpm run build:macos
open "macos/build/燕大终端.app"
```

构建执行静态导出、Swift 编译、图标生成和本机签名。若存在
`YSU Client Local Signing` 代码签名身份，或通过 `MACOS_CODESIGN_IDENTITY` 指定身份，
则使用该身份签名；否则使用 ad-hoc 签名。未做 Developer ID 签名及公证，
不作为面向其他 Mac 的正式分发包。首次构建需联网下载依赖和字体，
可使用终端的 `HTTP_PROXY` / `HTTPS_PROXY`，不会修改系统代理。

- `Cmd+Q` 退出 App；运行时没有 Node 子进程或外部开发服务。
- 上课提醒由系统 `UNUserNotificationCenter` 排程；
  设置页在 macOS 只显示“上课提醒”，成绩/考试后台轮询仅 Android 提供（需要常驻后台进程）。
  首次开启会请求系统通知权限，可在“系统设置 → 通知”中调整。
- 菜单栏常驻“下节 HH:mm 课程”或“上课中 课程”：左键/右键/`⌥⌘Y` 打开今明课程面板；
  点击面板外或切换到其他 App 会自动关闭。
  完整功能仍在 App 主窗口侧边栏。数据由课表页/总览页同步未来 7 天课程，原生按时间自行切换；
  关闭窗口不退出 App，可从 Dock 重新打开窗口。退出登录会清空菜单栏课程。
- 本地 Mac 构建把凭据写入 `~/Library/Application Support/com.youwenqwq.ysuclient.macos/secure-store.json`
  （目录 `0700`、文件 `0600`），不访问钥匙串；明文落盘，勿用于分发版本。
- App 自带的 Swift 资源服务只监听 `127.0.0.1:17346`，只提供随包静态文件，
  **不暴露 HTTP 代理或凭据接口**。端口被其他程序占用时显示错误并退出，不接管已有服务。
- 学校 HTTP 请求通过限主框架/精确本地来源的 WK 消息桥交给 `URLSession`；
  白名单从现有 Web 代理的 `ALLOWED_HOSTS` 自动生成。使用系统代理和 TLS 信任策略，
  不关闭证书验证。跳转由现有客户端处理，Cookie 以 JS jar 为准，避免系统 Cookie 串会话。
  Mac 与 Android 使用相同的默认 `Accept` / `Accept-Language`，保留调用方指定的头部；
  `User-Agent` 沿用上游 WebView 默认值与自定义开关，不强行伪装成其他浏览器。
- 普通界面设置由 WKWebView 本地存储保存。验证码及微信 MFA 二维码经平台传输层加载。
- Android 的后台成绩/考试监听、桌面小组件及 APK/OTA 更新没有移植到 Mac；
  Mac 包不启用浏览器 PWA Service Worker 或 Android 更新插件，升级需重新构建。
- 原生打包不绕过学校认证、MFA、访问策略或网络故障。窗口可打开不代表真实登录、
  成绩或课表已经验证；学校业务需要用户自行登录。

#### 教务入口与登录保护

- Mac 密码登录从 `https://jwxt.ysu.edu.cn/jwmobile/auth/index` 进入学校 CAS，
  登录表单、密码提交和 MFA 的 `service` 使用同一教务回调，不再先登录个人中心。
  官方“本科教务系统”的页面入口是 `/jwmobile/index`；该页面匿名也可返回 200，不能据此判断已登录。
- jwmobile 业务请求同时携带教务 Token 的 `Authorization` 请求头和同名 Cookie；
  会话校验使用 `/jwmobile/biz/user/info`。JSON 业务码 401 表示未登录，
  不再把 404 或非 JSON 页面当作有效会话，也不在会话失效后自动重新授权并重试业务请求。
  跨来源重定向会移除显式 `Authorization` / `Cookie` 头，目标 Cookie 仍按 jar 的域名和路径匹配。
- 与上游一致：两次密码提交默认间隔 60 秒，滚动 15 分钟内最多 3 次；登录页和“重新登录”共用
  本地持久化记录。被限制时登录页提供“仍然登录”手动继续，该入口不额外计数。
  密码错误、提交后的验证码错误以及认证页/预检连接失败都会记录为一次提交；显示或刷新验证码、
  发送和提交 MFA 验证码不计入密码次数。需要验证码时先显示验证码，不发送空验证码密码请求。
- **本地倒计时无法统计今日校园、浏览器或其他设备的尝试。若连续失败，先等待一段时间，
  不要在多入口之间来回重试。**
- 本地验证使用虚构凭据和隔离的离线服务，不代表真实学校登录已通过；真实账号只由用户手动尝试，
  失败后不要立即换入口、客户端或连续重试。

请求头兼容性参考上游 [PR #12](https://github.com/Youwenqwq/ysu-client/pull/12)
及随后移除固定 UA 预设的
[提交 ccb06ec](https://github.com/Youwenqwq/ysu-client/commit/ccb06ec9fd19cffaf4aabf2b91c8f50c1a50ec39)。
`NSURLErrorDomain -1005` 是传输层连接丢失，不是学校返回的 HTTP 状态码，
不能直接判作 UA 拦截或密码错误。若在认证页 GET 阶段就失败，尚未发生密码校验。


## 兼容性

应用运行在系统 WebView 中。如遇渲染异常，请检查 WebView 版本是否过低——
**最低要求 Chromium v111**。可通过 Play Store 等方式更新 Android System WebView。

## 相关项目

业务逻辑参考以下项目实现：

- [ysu-sdk](https://github.com/Youwenqwq/ysu-sdk) — 教务系统 SDK
- [ysu-api](https://github.com/Youwenqwq/ysu-api) — 教务系统 API 服务

## 协议

本项目源代码按 [GPL-3.0 协议](LICENSE) 开放。
