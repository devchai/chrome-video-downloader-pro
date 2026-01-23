# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Video Downloader Pro - Manifest V3 Chrome Extension that detects and downloads videos from web pages, including MP4, WEBM, and HLS/M3U8 streaming formats.

## Development Commands

```bash
# Load extension in Chrome
1. Navigate to chrome://extensions
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory

# No build step required - vanilla JS extension
# No test framework configured
```

## Architecture

### Message Flow
```
[Web Page] → chrome.webRequest → [Service Worker] → storage/badge
                                        ↓
[Popup UI] ← message → [Service Worker] → [Offscreen Document]
                                                   ↓
                                          HLS processing/download
```

### Core Components

**Service Worker** (`src/background/service_worker.js`)
- Network traffic interception via `chrome.webRequest.onHeadersReceived`
- Video detection by MIME type filtering (video/mp4, application/vnd.apple.mpegurl, etc.)
- Referer header capture and dynamic rule management via `declarativeNetRequest`
- Badge count updates per tab
- YouTube/Google video domain blocking

**Offscreen Document** (`src/offscreen/offscreen.js`)
- Heavy processing isolated from main thread
- HLS/M3U8 playlist parsing and segment downloading
- TS to MP4 transmuxing using mux.js
- Direct file download via Blob URL

**Popup** (`src/popup/popup.js`)
- Displays detected videos per active tab
- Progress UI for HLS downloads
- Fallback: copies yt-dlp command on download failure

**Content Script** (`src/content/content_script.js`)
- Page metadata extraction (title, h1) for filename inference
- Thumbnail extraction from video poster, og:image, twitter:image, schema.org, canvas capture

### Key Data Structures

```javascript
// Service Worker state
detectedVideos = { [tabId]: [{ url, contentType, size, timestamp, tabId, thumbnail }] }
urlReferers = { [url]: refererValue }

// Video detection filter
TARGET_MIME_TYPES = Set(['video/mp4', 'application/vnd.apple.mpegurl', ...])
BLOCKED_DOMAINS = ['youtube.com', 'googlevideo.com', 'youtu.be']
```

### Message Actions
- `getVideos` - Popup requests detected video list
- `downloadVideo` - Trigger download (direct or HLS)
- `processHLS` - Offscreen: parse and download HLS stream
- `downloadDirect` - Offscreen: simple blob download
- `downloadProgress` - Progress updates to popup

## Constraints

- YouTube downloads are blocked (Chrome Web Store policy compliance)
- HLS processing happens in-memory; large streams (1GB+) may cause memory pressure
- Referer headers are dynamically set for CDN compatibility (especially Twitter/X videos)
