# VidPorter

**Move videos anywhere.**

VidPorter is a desktop video downloading application powered by Electron and Chromium. It captures media responses from pages opened in its built-in browser and downloads supported video files and on-demand HLS streams. It uses bundled FFmpeg for local HLS merging.

Current version: **v1.0.0**.

## Overview

Open a page in VidPorter's built-in browser and play a video. Successfully detected media responses appear in the resource list, where you can filter and add them to the download queue. Browser and downloads share a Chromium session.

## Features

- Multi-tab browser and per-tab resource lists.
- Direct downloads of ordinary video files and supported on-demand HLS streams.
- Download progress, pause, resume, cancel, retry, and batch controls.
- Configurable download folder, source and URL filters, speed units, retry count, and interface language.
- Saved unfinished task list and verified partial-file reuse for matching URLs.
- FFmpeg-based local HLS merging.

DASH resources may be identified but cannot be downloaded. Live streams, DRM, and some advanced HLS variants are unsupported. Site authentication, URL expiry, and server restrictions may prevent downloads.

## Screenshots

Screenshots have not yet been added.

## Installation

On Windows, download the installer from [Releases](https://github.com/Daniel-Cpz/VidPorter/releases) and run `VidPorter-v1.0.0-Windows-x64-Setup.exe`. The portable executable can be run without installation. Windows may show a publisher warning because the binaries are not code signed.

## Windows Release

Release: **VidPorter v1.0.0**. The installer creates a VidPorter Start menu entry and desktop shortcut. Build outputs are release assets, not files tracked in this repository.

## Development

Install Node.js 22 or newer, then run:

```powershell
npm ci
npm start
```

Run the existing automated tests with `npm test`.

## Requirements

- Windows x64 for the published build.
- Node.js 22 or newer and npm when running from source or building.
- Network access for installing dependencies and for visiting video pages.

`ffmpeg-static` supplies FFmpeg with the application; a separate system FFmpeg installation is not required for the normal packaged build.

## Build

Run `build_exe.bat`, or use `npm ci`, `npm test`, and `npm run build`. The existing `electron-builder` configuration creates an NSIS installer and portable executable in `dist/`. The build needs its Electron and electron-builder dependencies available locally or downloadable.

## Version

The canonical application version is `package.json` → `version`, currently `1.0.0`. Electron reads it through `app.getVersion()` for the UI and window title, and electron-builder uses it for Windows metadata and artifact names. The Git tag is `v1.0.0`.

## Disclaimer

Download only media you have permission to save. VidPorter does not bypass DRM, site restrictions, or access controls. Saved task metadata can contain resource URLs and Referer values; treat your local application data as private.

## License

MIT. See [LICENSE](LICENSE).
