# VidPorter

**Move videos anywhere.**

当前版本 / Current version: **v1.0.0**

## 中文

### 概览

VidPorter 是基于 Electron 和 Chromium 的桌面视频下载软件。在内置浏览器中打开网页并播放视频后，程序会列出成功响应的媒体资源，供你筛选并加入下载队列。下载与网页共用同一个 Chromium 会话。HLS 合并使用随程序打包的 FFmpeg。

### 功能

- 多标签浏览器，每个标签独立显示捕获到的资源。
- 下载普通视频文件和受支持的点播 HLS 流。
- 显示下载进度，并支持暂停、继续、取消、重试和批量操作。
- 可设置下载目录、来源与网址筛选条件、速度单位、重试次数和界面语言。
- 保存未完成任务；同一网址可复用已验证的部分下载内容。

可以识别部分 DASH 资源，但目前不能下载 DASH。不支持直播、DRM 和部分高级 HLS 格式。网站认证、资源网址过期或服务器限制可能导致下载失败。

### 截图

暂无截图。

### 安装与 Windows 发布版

Windows x64 安装程序为 `VidPorter-v1.0.0-Windows-x64-Setup.exe`，是可直接运行的 `.exe` 安装包，会创建 VidPorter 开始菜单入口和桌面快捷方式。另有无需安装的 `VidPorter-v1.0.0-Windows-x64-Portable.exe`。请从 [GitHub Releases](https://github.com/Daniel-Cpz/VidPorter/releases/tag/v1.0.0) 下载。构建产物位于本地 `dist/`，不提交到 Git。安装包尚未进行代码签名，Windows 可能显示发布者提示。

### 开发与要求

从源码运行需要 Node.js 22 或更新版本、npm，以及安装依赖所需的网络连接。发布版面向 Windows x64。正常打包后无需另装系统 FFmpeg。

```powershell
npm ci
npm start
```

运行自动测试：`npm test`。

### 构建

无需 `.bat` 文件。运行以下命令即可生成 NSIS 安装包和便携版 `.exe`：

```powershell
npm ci
npm test
npm run build
```

构建产物位于 `dist/`。首次构建可能需要下载 Electron 和构建工具。

### 版本

`package.json` 中的 `version` 是程序版本的唯一来源，目前为 `1.0.0`。界面、窗口标题和 Windows 元数据从该版本读取；Git tag 为 `v1.0.0`。

### 免责声明

请只下载你有权保存的媒体，并遵守相关网站条款及适用法律。VidPorter 不会绕过 DRM、网站限制或访问控制，也不保证适用于任何特定网站。VidPorter 与被访问的网站无关联。本地任务记录可能包含资源网址和 Referer，请妥善保护应用数据。

### 许可证

MIT，详见 [LICENSE](LICENSE)。

## English

### Overview

VidPorter is a desktop video downloading application powered by Electron and Chromium. Open and play a video in its built-in browser to see successfully detected media responses, filter them, and add them to the download queue. Browsing and downloading share a Chromium session. Bundled FFmpeg handles local HLS merging.

### Features

- Multi-tab browser with a separate resource list for each tab.
- Direct downloads of ordinary video files and supported on-demand HLS streams.
- Progress monitoring, pause, resume, cancel, retry, and batch controls.
- Configurable download folder, source and URL filters, speed units, retry count, and interface language.
- Saved unfinished tasks and verified partial-file reuse for matching URLs.

Some DASH resources may be identified but cannot be downloaded. Live streams, DRM, and some advanced HLS variants are unsupported. Site authentication, expired URLs, or server restrictions may prevent downloads.

### Screenshots

Screenshots have not yet been added.

### Installation and Windows Release

The Windows x64 installer is `VidPorter-v1.0.0-Windows-x64-Setup.exe`, a runnable `.exe` setup program that creates VidPorter Start menu and desktop shortcuts. `VidPorter-v1.0.0-Windows-x64-Portable.exe` runs without installation. Download them from [GitHub Releases](https://github.com/Daniel-Cpz/VidPorter/releases/tag/v1.0.0). Build outputs are kept locally in `dist/`, outside Git history. The binaries are not code signed, so Windows may display a publisher warning.

### Development and Requirements

Running from source requires Node.js 22 or newer, npm, and network access to install dependencies. The published build targets Windows x64. A separate system FFmpeg installation is not required for the normal packaged build.

```powershell
npm ci
npm start
```

Run the automated tests with `npm test`.

### Build

No `.bat` file is needed. Build the NSIS installer and portable `.exe` with:

```powershell
npm ci
npm test
npm run build
```

The files are written to `dist/`. A first build may need to download Electron and build tools.

### Version

The `version` field in `package.json` is the single application version source, currently `1.0.0`. The UI, window title, and Windows metadata read from it; the Git tag is `v1.0.0`.

### Disclaimer

Download only media you have permission to save, and follow applicable law and site terms. VidPorter does not bypass DRM, site restrictions, or access controls, and compatibility with any particular site is not guaranteed. VidPorter is not affiliated with the sites you visit. Local task data may contain resource URLs and Referer values; keep your application data private.

### License

MIT. See [LICENSE](LICENSE).
