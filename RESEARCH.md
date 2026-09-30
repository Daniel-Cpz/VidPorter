# EFetch 流程分析与本版实现

分析对象：用户提供的 EFetch.rar 中可读取的 src/index.js 与 src/objects/hls.js。

## 原程序怎样提取

1. Electron 的 webRequest.onBeforeSendHeaders 记录媒体、XHR 等请求头。
2. onResponseStarted 在请求成功返回后，结合 Content-Type、扩展名和响应长度识别媒体；不是仅从网页 HTML 搜索视频链接。
3. 记录媒体 URL、页面信息、类型与请求头。HLS 不以播放列表文件大小作为视频大小过滤。
4. HLS 下载读取主播放列表，选择变体，读取子列表，再下载分片；普通 AES-128 的密钥由播放列表声明的 URI 获取，用于解密分片。这与软件会员密钥不是同一种机制。
5. 原程序浏览器使用 persist:webview，下载界面使用 persist:home，是两个分区。它通过保存请求头及 LM-* 头转换向下载请求重放原来的请求信息。

## 新实现

本版独立编写 Electron 程序，使用 webRequest 捕获成功响应，再用同一浏览器 session.fetch 下载播放列表、密钥与分片。直接使用同一 Cookie 会话，因此没有复刻原程序的 LM-* 转换。敏感请求头只在相应来源范围使用。FFmpeg 仅合并本地文件，不负责远程下载。

旧 Python 版把媒体地址交给独立 yt-dlp 进程，浏览器会话与网络实现发生变化。这是可能导致 403 的因素，不能凭错误截图确定是唯一原因。新架构减少这类差异，但不承诺通过网站验证。

代码位置：main.cjs 负责浏览器和捕获；lib/media.cjs 负责类型、大小和头信息；lib/hls.cjs 解析播放列表；lib/engine.cjs 负责请求、下载状态与合并。

官方 API 参考：
- https://www.electronjs.org/docs/latest/api/web-request
- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/api/web-contents-view

Electron 文档说明 session.fetch 使用 Chromium 网络栈，同时 Response.url 存在限制；本版手动处理重定向并记录最终地址，使相对分片地址基于实际播放列表位置解析。
