# pDisk

[中文版本](README.zh-CN.md)

A lightweight self-hosted cloud disk system built on WebPascal 5. Supports file upload/download, sharing, multi-language (47 locales), and admin user management. No database server required — uses SQLite out of the box.

## Features

- **User registration & login** — JWT token authentication
- **File upload** — drag-and-drop, multi-file queue, progress display, original filename preservation
- **File download** — by original filename, with download progress list, multi-file concurrent download, and auto-save on completion
- **File rename** — rename files from the file list (only the display name changes; the extension is locked and the actual stored file on the server is untouched); file names shown in existing shares are unaffected
- **File sharing** — password-protected share links, view/download/play from share page
- **Directory management** — create, browse, delete; tree view for cross-directory copy
- **File preview** — images, audio, video, PDF, DOCX, XLSX, PPTX, common text files
- **Music player** — playlist, play modes (sequential / random / single loop), 8-second skip
- **Disk quota** — per-user quota, configurable default quota
- **Admin panel** — user list / enable-disable / delete, file browsing, file deletion, share management
- **Disk sync** — bidirectional calibration between filesystem and database, with size validation
- **Multi-language** — 47 locale files, auto-detects browser language
- **Responsive UI** — mobile and desktop, floating buttons are draggable and remember their position

## Requirements

| Component | Purpose |
|-----------|---------|
| `WebPascal.exe` | Web server engine (port 8833) |
| `SrvConfig.ini` | Server configuration |
| `script/` | WebPascal 5 backend scripts |
| `www/` | Static frontend assets |
| `sqlite.db` | SQLite database (auto-created on init) |

## Quick Start

### 1. Initialize Database

Place `WebPascal.exe` and all project files in the same directory, then run:

```
WebPascal.exe
```

Then call the init endpoint once via browser:

```
http://localhost:8833/ask/init_db.api
```

> After successful initialization, delete `init_db.api` to prevent re-initialization.
> `init_db_share.api` is for resetting share data; remove it from the script directory after use.

### 2. Register

- **The first registered user automatically becomes the admin.**
- Subsequent users are regular users.
- Default disk quota is **10 GB**. To change it, modify the `FQuota` default value in `sqlite.db` or in `init_db.api`.

### 3. Access

| URL | Description |
|-----|-------------|
| `http://localhost:8833` | Local instance |
| `https://zjkpi.com` | Online demo |

Register your own account to try. First user = admin.

## Project Structure

```
pDisk/
├── WebPascal.exe          # Web server
├── SrvConfig.ini          # Server config (port, paths)
├── sqlite.db              # SQLite database (created by init_db.api)
├── script/                # Backend scripts
│   ├── conn.cfg          # Database connection config
│   ├── verify_token.api # JWT verification (shared include)
│   ├── login.api        # User login
│   ├── register.api     # User registration
│   ├── change_pwd.api   # Change password
│   ├── upload.api       # File upload
│   ├── file_list.api    # List user files
│   ├── file_copy.api    # Copy file to another directory
│   ├── file_rename.api  # Rename file (display name)
│   ├── file_delete.api  # Delete file
│   ├── dir_create.api   # Create directory
│   ├── dir_delete.api   # Delete directory
│   ├── dir_tree.api     # Get user directory tree
│   ├── disk_info.api    # Disk usage info
│   ├── settings_get.api # Read global settings
│   ├── settings_list.api# List settings
│   ├── settings_update.api# Update settings
│   ├── share_create.api # Create share link
│   ├── share_delete.api # Delete share
│   ├── share_view.api   # View share page
│   ├── share_my_list.api# List my shares
│   ├── share_admin_list.api# Admin: list all shares
│   ├── qrcode.api       # Generate QR code from URL
│   ├── admin_user_list.api# Admin: user list
│   ├── admin_user_toggle.api# Admin: enable/disable user
│   ├── admin_user_delete.api# Admin: delete user
│   ├── admin_user_quota.api# Admin: set user quota
│   ├── admin_file_browse.api# Admin: browse user files
│   ├── admin_file_delete.api# Admin: delete user file
│   ├── admin_dir_delete.api# Admin: delete user directory
│   ├── reset_pwd_request.api# Request password reset
│   ├── reset_pwd_list.api# List pending reset requests
│   ├── reset_pwd_process.api# Process reset request
│   ├── sync_disk_usage.api# Bidirectional disk sync
│   ├── init_db.api      # Initialize database (delete after use)
│   ├── init_db_share.api# Reset share data (delete after use)
│   └── init_settings.api# Initialize settings
├── www/
│   ├── index.html        # Single-page application
│   ├── css/style.css     # Styles
│   ├── js/app.js         # Frontend logic
│   ├── lang/             # 47 locale JSON files
│   └── favicon.ico
└── language.txt          # Locale file list
```

## API Endpoints

All endpoints return JSON: `{"code": 200, "msg": "...", "data": {...}}`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ask/login.api` | POST | Login (username, password) |
| `/ask/register.api` | POST | Register (username, email, password) |
| `/ask/change_pwd.api` | POST | Change password (token + old/new) |
| `/ask/upload.api` | POST | Upload file (FormData) |
| `/ask/file_list.api` | GET | List files in directory |
| `/ask/file_copy.api` | POST | Copy file (fid, target dir) |
| `/ask/file_rename.api` | POST | Rename file (path, newName; display name only) |
| `/ask/file_delete.api` | POST | Delete file (fid) |
| `/ask/dir_create.api` | POST | Create directory (name, parent path) |
| `/ask/dir_delete.api` | POST | Delete directory (path) |
| `/ask/dir_tree.api` | GET | Full directory tree |
| `/ask/disk_info.api` | GET | Disk usage (used/quota) |
| `/ask/settings_get.api` | GET | Get global settings |
| `/ask/settings_list.api` | GET | List all settings |
| `/ask/settings_update.api` | POST | Update settings |
| `/ask/share_create.api` | POST | Create share link |
| `/ask/share_delete.api` | POST | Delete share |
| `/ask/share_view.api` | GET | View share page |
| `/ask/share_my_list.api` | GET | List my shares |
| `/ask/share_admin_list.api` | GET | Admin: list all shares |
| `/ask/qrcode.api` | POST | Generate QR code from `url` parameter, returns base64 PNG (JWT-protected) |
| `/ask/admin_user_list.api` | GET | Admin: user list |
| `/ask/admin_user_toggle.api` | POST | Admin: enable/disable user |
| `/ask/admin_user_delete.api` | POST | Admin: delete user |
| `/ask/admin_user_quota.api` | POST | Admin: set user quota |
| `/ask/admin_file_browse.api` | GET | Admin: browse user files |
| `/ask/admin_file_delete.api` | POST | Admin: delete user file |
| `/ask/admin_dir_delete.api` | POST | Admin: delete user directory |
| `/ask/reset_pwd_request.api` | POST | Request password reset |
| `/ask/reset_pwd_list.api` | GET | List pending resets |
| `/ask/reset_pwd_process.api` | POST | Approve/deny reset |
| `/ask/sync_disk_usage.api` | GET | Bidirectional disk sync |
| `/ask/verify_token.api` | GET | Verify JWT token |

## Release History

> `+` add · `>` fix · `-` remove · `^` adjust

### 1.15
- `+` Estimated time remaining for uploads and downloads: the upload list shows `percent ~ETA` per line (e.g. `42% ~ 13s`), and the download task line shows `received / total · speed ~ETA` (e.g. `12.5 KB / 50 MB · 2.3 MB/s ~ 22s`; received and total are each shown in their own best-fit unit);
- `^` Tuned the speed sampling rate: uploads now sample once per second instead of on every progress event, and the download speed timer was changed from 300ms to 1000ms; both use exponential moving average smoothing (factor 0.9) so the numbers no longer jitter;
- `^` The upload summary line no longer repeats the ETA shown on each line; it keeps only "done/remaining count + current speed";
- `^` The `~` prefix for estimated time is hardcoded in JS (a language-neutral symbol), so no updates to the 47 language files were needed.

### 1.14
- `+` Replaced the home page "Upload Area" card with a "Storage" card: a horizontal progress bar shows the used percentage, with Used / Total / Free figures side by side below;
- `+` The storage card includes a quick-actions row (Upload / Download / Files) so common actions are reachable without switching pages;
- `+` The upload and share dialogs can now be closed by clicking the dimmed overlay, matching the download dialog;
- `+` Bottom navigation bar now automatically adapts its height to the iOS full-screen safe area, so content is no longer covered by the home indicator;
- `-` Removed the old home "Upload Area" card; uploading is now handled by the floating upload button and the upload dialog;
- `^` The quick-action upload icon now matches the floating upload button's appearance;
- `^` The progress bar and percentage use tiered colors: base blue `#3ba6f9` (<70%) / orange (70–90%) / red (>90%);
- `^` Added the `disk.capacity` key (Storage) to the language packs, synced across 47 language files.

### 1.13
- `+` Added a "Rename" button to the file list; click it to change the file's displayed name;
- `+` The file extension cannot be modified when renaming, and file names in already-created shared links are not changed;
- `+` Added orange "QR Code" button to share items (My Shares and Admin > Share Management); click to show the share URL as a scannable QR code in a dialog;
- `+` "Share Created" result dialog now displays the QR code above the copy-link button;
- `+` New backend API `/ask/qrcode.api` — accepts a `url` parameter (JWT-protected) and returns a base64 PNG QR code.

### 1.12
- `+` Added a download floating button at the bottom-right (above the upload button); tap to open the download task list;
- `+` The download task list shows real-time progress for each file (percentage, downloaded size, download speed);
- `+` Multiple files can download simultaneously; extras are queued automatically and files are saved on completion;
- `+` Tasks can be cancelled, failed items retried, removed individually, or cleared all at once;
- `^` File downloads across the drive, share, and admin pages now go through the unified download list with live progress.

### 1.11
- `>` Fixed the issue with the upload floating button handling the title attribute;
- `>` Fixed issues in the upload feature where the file list was overwritten, counts were inaccurate, files were uploaded repeatedly, and the completion notification showed incorrect counts.

### 1.10
- `>` Fixed user admin "allow registration" checkbox not reflecting database config;
- `>` Fixed settings table write failure when key value was empty;
- `+` Added global upload floating button, visible after login, draggable and remembers its position;
- `+` Added upload dialog showing target directory (root or subdirectory);
- `+` Added toast notification after upload FAB operations;
- `+` Language pack: added `btn.close` key across 47 locale files;
- `^` Added toast feedback for default quota and registration switch toggles.

### 1.9
- `+` Global settings: allow registration toggle and default quota;
- `+` Per-user disk quota management by admin;
- `+` Text file preview: txt/sha/ini/conf/cfg;
- `>` Fixed DOCX/TXT preview full-screen issue on mobile, added margins.

### 1.8
- `+` Backend load indicator in the top-right corner of cloud/share pages, showing current service busyness at a glance;
- `+` Download start notification for file operations, same as in multi-select;
- `+` File preview: pdf/docx/xlsx/pptx;
- `+` Common text file preview: txt/log/sha/ini/conf/cfg/md/json/xml/html/css/js;
- `+` Auto-detect UTF-8/GBK encoding for text files;
- `^` Unified filename hint color (blue) for previewable docs, images, audio, video.

### 1.7
- `>` Fixed toast being blocked by share dialog;
- `+` Batch download button in multi-select;
- `+` Download button in share page multi-select;
- `+` Batch download start notification;
- `+` Batch play: music if present, video only if no music;
- `^` Hide play button when no audio/video files;
- `^` Preserve selection after sharing in multi-select.

### 1.6
- `+` All UI messages support multi-language (47 locales), including success/failure notifications and error messages;
- `+` 65 new translation keys covering all operation scenarios;
- `+` File sharing with password protection;
- `+` Share page: image preview, audio player, video player;
- `+` Share page: download by original filename;
- `+` Cross-directory multi-file sharing;
- `+` "My Shares" on home page;
- `+` Admin share management;
- `+` Upload speed indicator;
- `+` File sorting by name/time (cloud disk and share pages);
- `+` User file download by original filename;
- `^` Batch action buttons float below select-all, stay visible on scroll, without taking up page space.

### 1.5
- `+` Admin file preview: image, audio, video;
- `+` Admin multi-select batch play (non-audio files auto-filtered out, audio added to playlist);
- `^` Admin file action buttons changed to expand/collapse mode (circular ‹ button), consistent with file list.

### 1.4
- `+` Auto-logout on token verification failure: clears login info, redirects to login page, and hides the bottom navigation;
- `+` Single file delete dialog shows filename;
- `+` Admin user delete (DB record + directory);
- `+` Back-to-top floating button (shows after 300px scroll, doesn't block bottom navigation);
- `^` CSS/JS extracted to separate files;
- `^` Bottom nav hidden by default, shown after login;
- `^` Admin user list: expand/collapse action buttons (circular ‹ button), orange for disabled;
- `^` Admin user display format: Nickname (Username);
- `^` Copy dialog: prefer original filename;
- `^` File list action buttons auto-close on outside click;
- `^` File list action buttons use absolute positioning to avoid row height changes.

### 1.3
- `>` Fixed original filename truncation for files with spaces (now passed via FormData);
- `>` Fixed original filename loss on file copy (frontend now passes the original filename, backend prefers it);
- `>` Fixed preview/play/copy failures for file URLs with spaces (file paths now URI-encoded);
- `>` Quota read from DB instead of hardcoded 1GB;
- `+` Generated Language.txt locale file list;
- `^` File action buttons changed to expand/collapse mode.

### 1.2
- `>` Fixed batch copy parameter mismatch;
- `>` Fixed admin directory switch not clearing selection;
- `+` Multi-language support (i18n), auto browser language detection;
- `+` Auto-load matching locale file, fallback to English;
- `+` Image preview with close button;
- `+` Video inline player with close button and autoplay;
- `+` Tapping a music file opens a draggable floating player bar with loop, play/pause, stop, progress seek, and close controls;
- `+` Music player: playlist, previous/next, play mode switching (sequential / random / single loop);
- `+` 8-second forward/backward skip checkbox in the music player;
- `+` Multi-file batch play (non-audio files auto-filtered into playlist);
- `+` Password visibility toggle on login/register;
- `+` Multi-file upload with drag-and-drop and per-file progress;
- `+` File list multi-select with batch delete/copy;
- `+` Admin file multi-select with batch delete;
- `^` Token moved to HTTP header `Authorization: Bearer`;
- `^` Auto-create user directory on registration, show "No files" instead of "Failed".

### 1.1
- `>` Fixed escAttr returning empty for numeric FID;
- `>` Fixed subdirectory create using wrong parent path;
- `>` Fixed UTF-8 BOM in login.api causing parse errors;
- `>` Password reset now validates username+email match;
- `>` File copy dialog changed from dropdown to tree view;
- `>` Fixed relative path not converted to absolute in dir_create.api;
- `>` Fixed Dir.DirList returning recursive subdirectories;
- `>` Fixed admin_file_browse.api same recursive issue;
- `+` User self password change (My → Change Password);
- `+` Auto-generate 6-char random password on reset approval;
- `+` dir_tree.api for file copy target directory selection.

### 1.0
- `^` Unified delete operations with dialog confirmation;
- `^` All icons drawn with inline SVG;
- `^` Fixed duplicate file display from subdirectory listing;
- `^` Fixed admin directory browse API syntax error;
- `^` Removed redundant Content-Type output from all APIs;
- `^` Fixed UTF-8 BOM parse errors in scripts;
- `^` Fixed Chinese encoding issues, unified UTF-8;
- `+` User registration, login with JWT;
- `+` File upload/download with drag-and-drop and progress;
- `+` Directory create/browse/delete;
- `+` File list with breadcrumb navigation;
- `+` File copy across directories;
- `+` File delete;
- `+` Disk quota management;
- `+` Recent uploads on home page (shows the last 5 files);
- `+` Admin user management (enable/disable);
- `+` Admin file browsing and deletion;
- `+` Admin deletion of user files and directories;
- `+` Password reset flow (request → approve → reset);
- `-` Removed temporary test scripts (test_basic / test_dir / test_funcs).

## License

Free to use, modify, and distribute. No warranty.
