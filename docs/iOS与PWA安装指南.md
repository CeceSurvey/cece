# 测策 · iOS / PWA 安装指南

## 说明

「测策 · 工程测量」是一个纯前端 PWA（渐进式 Web 应用），无需 App Store 审核即可安装到 iPhone / iPad 主屏幕，使用体验接近原生 App（全屏、独立图标、离线可用）。

> 由于当前打包环境为 Windows，无法直接编译 iOS 原生 IPA（需 macOS + Xcode + Apple 开发者证书 $99/年）。本方案通过 PWA 封装实现 iOS 端安装，是无需上架的推荐做法。

## 一、部署前提

PWA 需要 **HTTPS 或 localhost** 才能注册 Service Worker（离线缓存）。任选其一：

- **本地局域网测试**：在电脑上启动静态服务器，iPhone 与电脑同一 WiFi，用 `http://电脑IP:8765` 访问（此时 SW 不生效，但可先体验）。
- **正式部署**：把项目文件（`index.html`、`app.js`、`core.js`、`styles.css`、`manifest.json`、`sw.js`、`icons/`、`icon.svg`、`icon-maskable.svg`）上传到任意支持 HTTPS 的静态托管（GitHub Pages / Vercel / 腾讯云 COS 等）。

## 二、iPhone / iPad 安装步骤（添加到主屏幕）

1. 用 **Safari** 打开部署好的网址（iOS 上 Chrome 不支持 PWA 添加到主屏幕，务必用 Safari）。
2. 点击底部中间的 **「分享」按钮**（方框加向上箭头图标）。
3. 在弹出菜单中滑动，点击 **「添加到主屏幕」**。
4. 可自定义名称（默认「测策」），点击右上角 **「添加」**。
5. 主屏幕出现「测策」图标，点开即全屏运行，独立于 Safari。

## 三、PWA 特性

| 特性 | 状态 |
| --- | --- |
| 全屏独立运行（standalone） | ✅ |
| 主屏幕图标（180×180 PNG） | ✅ |
| 离线缓存核心资源 | ✅（需 HTTPS） |
| 数据本机持久化 | ✅（localStorage，导出 `.cece.json` 备份） |
| 横竖屏自适应 + 刘海安全区 | ✅ |

## 四、图标说明

| 文件 | 用途 |
| --- | --- |
| `icons/apple-touch-icon.png` | iOS 主屏幕图标（180×180） |
| `icons/icon-192.png` | PWA 192px 图标 |
| `icons/icon-512.png` | PWA 512px 图标 |
| `icons/icon-maskable-512.png` | 可遮罩图标（Android 自适应图标） |

## 五、如需真正的 iOS 原生 App（IPA）

若后续需要上架 App Store 或签名分发，需在 macOS 上完成：

1. 安装 Xcode + 申请 Apple Developer 账号（$99/年）。
2. 用 Capacitor 把本项目封装为 iOS 工程（`npx cap add ios`）。
3. 在 Xcode 中配置签名证书后 Archive 导出 IPA。

此路径需 macOS 环境，Windows 无法完成。PWA 方案已覆盖日常使用需求。
