# 插件组合架构

酸橙盒（Orahako）是一个由插件组合的应用，而不是一组由固定页面控制的功能开关。本文定义运行时边界与公共扩展契约。

## 目标与非目标

目标：

- 官方功能与社区功能使用同一套公开模块和生命周期。
- 插件可以新增页面、命令和 UI 内容，也可以替换整个应用 Shell。
- 插件代码与应用同权；安装者判断来源并承担风险。
- 任一外部 UI 插件失效时，内核仍能恢复默认 Shell 或停用插件。

非目标：

- 不在同一 JavaScript 主上下文中构造权限沙箱。
- 不让 Next.js 文件系统路由成为运行时插件协议。
- 不复制 DeepSeek Harness 的 Node Loader、pnpm profile 或完整 Slot 类型系统。

## 分层

### 内核

内核只拥有启动与恢复所需能力：

1. Next.js HTML/静态导出入口、PWA 和 OTA。
2. Cordis 根上下文、插件生命周期和共享模块表。
3. ZIP 包解析、IndexedDB 包存储、市场兼容性与 SHA-256 完整性校验。
4. 公共 UI/Slot/Provider 注册表及平台服务。
5. 不依赖插件的最小启动与 Shell 崩溃恢复界面。

内核不认识具体学校、课表、总览或费用插件，也不决定其页面是否存在。

### 公共 SDK

`@orahako/plugin-sdk` 提供稳定契约：清单、领域模型、Provider、Shell、Slot、i18n、存储、HTTP、原生与资源服务。

`@orahako/plugin-ui` 是可选的官方 React UI Kit 和应用 hooks。默认功能插件与社区插件均可使用；替代 Shell 可以不使用它。包按 `components/hooks/stores/academic/platform/plugin/shell/assets` 子路径隔离副作用，根入口不聚合实现，避免宿主与官方插件之间的模块求值环。

React、实际使用的 Next 入口、`@orahako/academic` 和 UI Kit 子路径均由宿主共享同一模块实例。外部插件不能通过私下打包 Next 模块获得另一套 Router Context。

`@orahako/plugin-sdk/host` 暴露完整信任的高级宿主能力。它是公共 API，不是权限边界。稳定 API 与内部实现的边界由模块导出决定，而不是由“官方/外部”身份决定。

### 官方插件

- `orahako.shell`：默认登录、Dashboard、设置、导航和全局弹窗组合。
- `orahako.onboarding`：通过 `shell.overlay` 提供首次学校选择、权限配置和市场 Provider 安装；既有设置经迁移后不再显示。
- `ysu.provider`：YSU CAS/JWXT Provider，也是唯一内置的学校 Provider；其他学校由市场包注册。
- Provider 可用 `supportedPlugins` 声明学校支持的功能插件；该列表与 capabilities 共同约束功能启停、页面、导航、深链和总览挂件。
- 功能插件：课表、成绩、考试、总览、费用等；森空鸟等玩具箱功能由官方市场提供，不进入内置运行时。
- 市场可通过 `bundles` 为学校声明推荐插件组合；插件管理页负责分类展示，宿主统一预检并安装或启用组合内容。
- 主题插件：向主题注册表贡献 CSS。

官方插件可以随应用内置，但不因此获得私有 UI 或数据接口。

## Shell

Shell 是完整应用根组件，通过 `ctx.ui.registerShell()` 注册。内核只向它传递当前 Next.js 路由内容；Shell 可以组合、包装或完全忽略这些内容并自行渲染页面。

用户选择以 `pluginId:shellId` 持久化。未选择时使用 `orahako.shell:default`。选中的 Shell 停用、卸载或渲染失败时，回到默认 Shell；默认 Shell 也失败时，由内核显示重新加载界面。

`kind: "shell"` 是市场和插件管理使用的元数据，不构成权限差异。

## Slot

Slot 用于增量 UI 组合，支持三种形态：

| 类型     | 用途                                         |
| -------- | -------------------------------------------- |
| `single` | 一个可替换 occupant；最低 priority 生效      |
| `list`   | 按 order 排列的增量内容                      |
| `keyed`  | 按 key 选择一个 occupant；最低 priority 生效 |

Slot 所有者通过 `ctx.slots.declare()` 声明名称与形态。贡献者通过 `ctx.slots.register()` 注册组件。未声明的 Slot、keyed 贡献缺少 key、single/keyed 同优先级占位都会在加载时失败，而不是产生不确定 UI。

声明和贡献都随 Cordis 作用域释放。移除 Slot 声明会级联移除其他插件向该 Slot 注册的内容。每个贡献组件有独立错误边界，单个装饰失败不应拖垮整个 Shell。

默认 Shell 当前声明：

- `shell.overlay`：应用根级浮层列表。
- `dashboard.header.actions`：桌面 Dashboard 头部动作列表。
- `settings.startupOptions`：启动页选项，由总览、日程等目标插件分别贡献。
- `settings.widgets`：可添加的原生小组件卡片。

功能插件通过 `ctx.settings.registerCategory()` 注册带图标、标题、描述和面板的设置分类。主设置页只显示统一“插件设置”分类列表，`/dashboard/me/settings/plugins/?category=<id>` 承载详情；分类随插件作用域释放，宿主不认识具体功能分类。

`orahako.notifications` 拥有通知分类的单卡片面板和原生通知运行时，并声明 `settings.notifications.content`（轮询内容选项）、`settings.notifications.reminders`（原生提醒分节）与 `settings.notifications.appReminders`（应用内提醒分节）。功能插件保留各自设置 UI，同时通过 `ctx.notifications.register()` 注册 `grades`、`exams` 或 `schedule` 运行时渠道。界面贡献和渠道都随 Cordis 作用域释放；运行时消费渠道快照，不按插件 ID 推断能力。

Overview 挂件由实际功能插件注册，而不是由 `orahako.overview` 代注册。公共组件与数据 Provider 位于 `@orahako/academic`；`order` 决定默认布局顺序，Cordis 在功能停用时移除其挂件。已有用户布局继续按稳定挂件 ID 归一化。

Slot 是默认 Shell 的公开视觉契约。替代 Shell 可以声明自己的 Slot；面向特定 Shell 的插件应记录该依赖。

## 页面与导航

功能插件注册语义页面和导航元数据。页面 ID 属于插件，可选 `route` 表达跨插件唯一的稳定语义路由，导航 ID 表达稳定语义（例如 `schedule`），核心不通过插件 ID 定位功能。冲突的语义路由在加载时失败。

导航分组是开放字符串。默认 Shell 为常见分组提供翻译和顺序，未知分组按 ID 稳定排序显示；替代 Shell 可以完全采用其他组织方式。

`ctx.ui.getSnapshot()` 与 `subscribe()` 允许 Shell 组合当前页面和导航。`fullscreen` 等页面元数据表达展示意图，由 Shell 决定是否采用。

静态导出下，外部插件不能新增 Next.js 文件路由。默认 Shell 使用 `/dashboard/plugin/?plugin=&page=`；替代 Shell 可以使用自己的客户端路由，但刷新恢复必须由静态部署和 Web 重写规则支持。

## 生命周期与错误

清单 `requires` 声明必须先运行的插件 ID。启动时依赖未运行会失败；停用插件会级联停用依赖项；同 ID 更新替换不级联，避免 Provider 更新无意义地关闭功能插件。

`ctx.hostLifecycle.onProviderReady()` 是登录/Provider 初始化后的公共扩展点。每次初始化都会通知，晚注册也会调度；停用插件后不再执行。费用提醒等后台任务不得再使用私有启动注册表。

注册函数返回 disposer，并由 Cordis 在停用、更新和卸载时自动调用。插件状态快照只描述运行状态，不作为安全证明。

错误分三层处理：

1. 插件启动失败：记录插件错误并保留管理入口。
2. 页面或 Slot 渲染失败：局部错误边界隔离。
3. Shell 渲染失败或重复启动崩溃：恢复默认 Shell，必要时跳过全部外部插件。

这些机制提高可恢复性，不限制恶意代码。

## 信任与供应链

插件与 App 同权，可访问保存的凭据、教务会话、个人数据、网络和原生 API。安装与更新必须展示同等风险提醒。

SHA-256 只验证包与市场索引一致，不证明作者或来源可信。API/应用版本检查用于兼容性，不是安全控制。市场分类、命名空间存储和模块白名单也都不是安全边界。

PWA 与原生宿主提供相同的组合 API，但浏览器 CORS、系统权限和后台能力存在真实平台差异。公共 EdgeOne 白名单用于避免开放代理滥用，不是插件权限系统；支持 CORS 的服务可以直连，其他服务可使用自定义代理或原生传输。ZIP 不能向既有 APK 注入原生模块，通用宿主显式携带定位/相机等桥，特殊能力需要新宿主或定制构建。

`packages/perlica-toybox` 是完整社区插件基准：第三方 HTTP、独立凭据、地图、扫码、移动子导航和 i18n 均不使用宿主私有实现。

## Release 验收

- 默认 Shell 下现有页面、导航、主题和持久化偏好保持可用。
- 一个纯外部功能 ZIP 无需私有导入即可注册页面和默认 Shell Slot。
- 一个纯外部 Shell ZIP 可以替换应用根，停用后恢复默认 Shell。
- Slot 停用、所有者卸载、同优先级冲突和组件异常均有确定性行为。
- `pnpm run typecheck`、完整 Vitest、生产构建与浏览器关键路径通过。
- Android WebView 与真实 YSU 账号由发布前真机验收单独确认。
