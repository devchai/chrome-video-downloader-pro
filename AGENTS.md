# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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
- `downloadProgress` - Progress updates to popup (includes errorDetails on failure)

### Error Logging System

**Offscreen Document Logger** (`src/offscreen/offscreen.js`)
- `LOG_TAG`: `[OffscreenDownloader]` prefix for all logs
- `log(method, msg, data)`: General logging with method context
- `logError(method, msg, error)`: Detailed error logging with structured output
  - Returns `errorDetails` object: `{ timestamp, method, message, errorName, errorMessage, errorStack }`

**Error Types Tracked**:
- `HTTPError`: HTTP status code failures (4xx, 5xx)
- `EmptyResponseError`: 0 bytes received from server
- `PlaylistFetchError`: Failed to fetch HLS playlist
- `VideoPlaylistFetchError`: Failed to fetch video variant playlist
- `InitSegmentError`: Failed to download fMP4 init segment
- `SegmentFetchError`: Individual segment download failure
- `AllSegmentsFailedError`: All segments failed to download
- `TransmuxError`: mux.js TS-to-MP4 conversion failure
- `EmptyBlobError` / `EmptyOutputError`: Final merged file is 0 bytes

**Console Viewing**:
- Offscreen document logs: Chrome DevTools → Sources → offscreen.html context
- Popup error logs: Right-click popup → Inspect → Console tab

## Constraints

- YouTube downloads are blocked (Chrome Web Store policy compliance)
- HLS processing happens in-memory; large streams (1GB+) may cause memory pressure
- Referer headers are dynamically set for CDN compatibility (especially Twitter/X videos)

## MV3 안정성 고도화
- `VideoUtils`: 파일명 정리, 차단 도메인, MIME/HLS/DASH 판별, 썸네일 우선순위, yt-dlp 명령 생성 로직 분리
- `LoggerManager`: `logger_tag_chai` 태그 기반 debug/release 스위치형 로그 관리자 추가
- `ServiceWorker`: `chrome.storage.session` 상태 동기화, `extraHeaders` 기반 Referer 캡처, DNR 동적 규칙 cleanup 및 적용 순서 보장
- `Popup`: 감지 URL/제목/썸네일을 DOM API로 렌더링하고 실제 referer 기반 명령 복사 지원
- 플랜 문서: @.codex/plans/mv3_stability_hardening_plan.md
