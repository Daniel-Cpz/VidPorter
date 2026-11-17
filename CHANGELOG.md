# Changelog

## [1.0.1] - 2026-11-18

### Fixed

- Remove resume JSON sidecars from the download folder after successful completion; store completed records in application data to retain duplicate detection.
- Preserve resume data for paused or failed tasks and handle cleanup failures without downloading completed videos again.
- Start with a blank browser tab instead of reopening the last visited page.
- Open an entered URL in the current tab when that tab is blank.

## [1.0.0] - 2026-09-30

### Added

- First official release of VidPorter.
- Electron desktop interface with an integrated browser and download queue.
- Chromium session based media capture and downloading for supported video files and on-demand HLS.
- Download progress, pause, resume, retry, and configurable destination.
- Windows installer and portable build targets.

### Changed

- Standardized user-visible branding as VidPorter.
- Standardized application version as 1.0.0.
