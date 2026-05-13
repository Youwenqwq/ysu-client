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

本项目实现了以下功能：

- **登录**：CAS 统一认证，支持验证码和 MFA 多因素验证，记住登录状态
- **查成绩**：按学期筛选，查看统计、分布和排名
- **看课表**：合并理论课与实验课，按周切换，桌面和移动端双布局
- **查考试**：按学期查看考试安排
- **看绩点**：学分和绩点一目了然
- **培养方案**：查看课程完成情况和学业预警
- **评教**：支持学生评教功能，评教支持批量一键自动填写最高分

应用通过 Capacitor 打包为 Android WebView 壳应用，支持 OTA 热更新。

## 数据来源与安全性

燕大终端 App 的所有业务逻辑**均在本地实现**，从官方教务系统获取数据并保存在本地，中间不经过任何其他服务器。
登录之后的凭据数据存储在本地，属于敏感数据，可用于执行统一身份认证，请勿让不受信任的应用读取本 App 数据目录。
登录页勾选记住密码后，账户密码将**明文存储**在 App 数据中，如有安全性要求请勿使用该功能。

为保证教务系统数据不受意外修改，本项目除学生评教外，均仅实现了数据查询功能。

## 安装

从 [GitHub Releases](https://github.com/Youwenqwq/ysu-client/releases) 下载最新的 APK 安装包。

> 如遇网络故障，可在应用内配置 GitHub 代理镜像。设置入口会在出现网络故障时弹出。

## 兼容性

应用运行在系统 WebView 中。如遇渲染异常，请检查 WebView 版本是否过低——
**最低要求 Chromium v111**。可通过 Play Store 等方式更新 Android System WebView。

## 技术文档

如果你对项目的技术实现感兴趣，可以查看：

- [中文详细文档](README.zh-CN.md)
- [English](README.en.md)

## 相关项目

业务逻辑参考以下项目实现：

- [ysu-sdk](https://github.com/Youwenqwq/ysu-sdk) — 教务系统 SDK
- [ysu-api](https://github.com/Youwenqwq/ysu-api) — 教务系统 API 服务

## 协议

本项目源代码按 [GPL-3.0 协议](LICENSE) 开放。
