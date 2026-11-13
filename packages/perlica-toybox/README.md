# Perlica 社区插件

从 `feat/perlica-toybox` 适配的首个完整外部功能插件。提供地图找车、车辆号/扫码识别、解锁与骑行控制、历史记录和账户设置。

## 构建

```bash
pnpm plugin pack packages/perlica-toybox
```

将生成的 `perlica-toybox-1.0.0.zip` 通过「我的 → 插件 → 安装 ZIP」安装。本包不加入官方插件注册表，也不需要宿主提供 Perlica 专用页面或 Store。

## 宿主能力

- HTTP：`@orahako/plugin-sdk/host` 的 `fetchStateless`；Web 通过 EdgeOne 代理访问 `client3.uqbike.cn`，目标 URL 使用 `x-proxy-target`，避免 Token 进入代理请求 URL。
- 凭据：包自己的 Zustand persist 命名空间和宿主 `secureStorage`。
- 定位：公共 Capacitor Geolocation 桥。Android 宿主声明定位权限；首次定位由系统询问授权。
- 扫码：`html5-qrcode` 使用相机/相册；Android 宿主声明相机权限，实际访问仍由用户操作触发。
- 地图：包内打包 Leaflet 和样式，使用高德栅格瓦片。

## 适配边界

- 页面、设置、移动子导航和中英文案均由包内注册，不使用宿主 Next 文件路由或全局词典。
- 仅依赖公开 SDK、UI Kit 与共享 Next/Sonner 模块；无 `@/` 私有导入。
- 插件与应用同权。Token 只应在用户验证并保存后写入凭据存储；调试快照会继续脱敏。
- 真实骑行、支付相关操作和系统授权需要在 Android 真机上由用户验收。
