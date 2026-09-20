# pDisk

[中文版本](README.zh-CN.md)

A lightweight self-hosted cloud disk system built on WebPascal 5. Supports file upload/download, sharing, multi-language (47 locales), and admin user management. No database server required — uses SQLite out of the box.

## Features

- **User registration & login** — JWT token authentication
- **File upload** — drag-and-drop, multi-file queue, progress display, original filename preservation
- **File download** — by original filename
- **File sharing** — password-protected share links, view/download/play from share page
- **Directory management** — create, browse, delete; tree view for cross-directory copy
- **File preview** — images, audio, video, PDF, DOCX, XLSX, PPTX, common text files
- **Music player** — playlist, play modes (sequential / random / loop), 8-second skip
- **Disk quota** — per-user quota, configurable default quota
- **Admin panel** — user list / enable-disable / delete, file browsing, file deletion, share management
- **Disk sync** — bidirectional calibration between filesystem and database, with size validation
- **Multi-language** — 47 locale files, auto-detects browser language
- **Responsive UI** — mobile and desktop, floating buttons with drag memory

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
│   ├── upload2.api      # Upload (alt endpoint)
│   ├── file_list.api    # List user files
│   ├── file_copy.api    # Copy file to another directory
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
| `/ask/upload2.api` | POST | Upload alternate |
| `/ask/file_list.api` | GET | List files in directory |
| `/ask/file_copy.api` | POST | Copy file (fid, target dir) |
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

### 1.10
- `>` Fixed user admin "allow registration" checkbox not reflecting database config;
- `>` Fixed settings table write failure when key value was empty;
- `+` Added global upload floating button, visible after login, supports drag and position memory;
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
- `+` Backend load indicator on cloud/share pages;
- `+` Download start notification for file operations;
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
- `+` All UI messages support multi-language (47 locales);
- `+` 65 new translation keys covering all operation scenarios;
- `+` File sharing with password protection;
- `+` Share page: image preview, audio player, video player;
- `+` Share page: download by original filename;
- `+` Cross-directory multi-file sharing;
- `+` "My Shares" on home page;
- `+` Admin share management;
- `+` Upload speed indicator;
- `+` File sorting by name/time;
- `+` User file download by original filename;
- `^` Batch action buttons float below select-all, stay visible on scroll.

### 1.5
- `+` Admin file preview: image, audio, video;
- `+` Admin multi-select batch play (audio filtered);
- `^` Admin file action buttons changed to expand/collapse mode.

### 1.4
- `+` Auto-logout on token verification failure;
- `+` Single file delete dialog shows filename;
- `+` Admin user delete (DB record + directory);
- `+` Back-to-top floating button (shows after 300px scroll);
- `^` CSS/JS extracted to separate files;
- `^` Bottom nav hidden by default, shown after login;
- `^` Admin user list: expand/collapse action buttons, orange for disabled;
- `^` Admin user display format: Nickname (Username);
- `^` Copy dialog: prefer original filename;
- `^` File list action buttons auto-close on outside click;
- `^` File list action buttons use absolute positioning to avoid row height changes.

### 1.3
- `>` Fixed original filename truncation for files with spaces;
- `>` Fixed original filename loss on file copy;
- `>` Fixed preview/play/copy failures for file URLs with spaces;
- `>` Quota read from DB instead of hardcoded 1GB;
- `+` Generated Language.txt locale file list;
- `^` File action buttons changed to expand/collapse mode.

### 1.2
- `>` Fixed batch copy parameter mismatch;
- `>` Fixed admin directory switch not clearing selection;
- `+` Multi-language support (i18n), auto browser language detection;
- `+` Auto-load matching locale file, fallback to English;
- `+` Image preview with close button;
- `+` Video inline player;
- `+` Music floating player with playlist, modes, 8s skip;
- `+` Multi-file batch play;
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
- `+` Recent uploads on home page;
- `+` Admin user management (enable/disable/delete);
- `+` Admin file browsing and deletion;
- `+` Password reset flow (request → approve → reset);
- `-` Removed temporary test scripts.

## License

Free to use, modify, and distribute. No warranty.
