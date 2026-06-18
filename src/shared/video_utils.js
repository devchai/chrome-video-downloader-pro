(function attachVideoUtils(root, factory) {
  const utils = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = utils;
  }
  root.VideoUtils = utils;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createVideoUtils() {
  const TARGET_MIME_TYPES = new Set([
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'video/x-flv',
    'video/x-msvideo',
    'video/3gpp',
    'application/x-mpegurl',
    'application/vnd.apple.mpegurl',
    'video/mp2t',
    'application/dash+xml',
    'binary/octet-stream'
  ]);

  const BLOCKED_DOMAINS = ['youtube.com', 'googlevideo.com', 'youtu.be'];
  const THUMBNAIL_PRIORITY = ['capture', 'poster', 'og:image', 'twitter:image', 'schema.org', 'related-img'];

  // 파일 시스템에서 금지된 문자(Windows/macOS/Linux 공통).
  // 한글/일본어 등 유니코드 문자, 공백, 하이픈, 마침표는 보존하여 타이틀을 파일명으로 그대로 사용한다.
  const ILLEGAL_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  const MAX_FILENAME_LENGTH = 100; // 확장자 여유 포함, macOS 255 UTF-16 한도 내 안전

  function normalizeContentType(value) {
    return String(value || '').split(';')[0].toLowerCase().trim();
  }

  function isBlockedUrl(url) {
    if (!url) return false;
    try {
      const hostname = new URL(url).hostname;
      return BLOCKED_DOMAINS.some((domain) => hostname.includes(domain));
    } catch (e) {
      return false;
    }
  }

  function sanitizeFilename(name) {
    if (!name) return 'video_download';

    // 금지 문자와 제어문자(U+0000~U+001F)만 공백으로 치환, 그 외 문자는 그대로 보존
    let clean = '';
    for (const ch of String(name)) {
      clean += (ILLEGAL_FILENAME_CHARS.has(ch) || ch.charCodeAt(0) < 0x20) ? ' ' : ch;
    }

    clean = clean
      .replace(/\s+/g, ' ')               // 연속 공백류를 하나로 축약
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, '');    // 앞뒤 마침표/공백 제거 (Windows trailing dot 방지)

    if (clean.length > MAX_FILENAME_LENGTH) {
      clean = clean.slice(0, MAX_FILENAME_LENGTH).trim();
    }

    return clean || 'video_download';
  }

  function isTargetVideoContentType(contentType) {
    return TARGET_MIME_TYPES.has(normalizeContentType(contentType));
  }

  function isHlsLikeContentType(contentType) {
    const normalized = normalizeContentType(contentType);
    return normalized.includes('mpegurl');
  }

  function isDashContentType(contentType) {
    return normalizeContentType(contentType).includes('dash+xml');
  }

  function shouldIgnoreBySize(contentType, size) {
    const normalized = normalizeContentType(contentType);
    const numericSize = Number(size) || 0;
    return !normalized.includes('mpegurl') && !normalized.includes('xml') && numericSize > 0 && numericSize < 5120;
  }

  function getBestThumbnailUrl(thumbnails) {
    if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
    for (const source of THUMBNAIL_PRIORITY) {
      const found = thumbnails.find((thumbnail) => thumbnail && thumbnail.source === source && thumbnail.url);
      if (found) return found.url;
    }
    return thumbnails[0]?.url || null;
  }

  function buildYtDlpCommand(url, referer) {
    const escapedUrl = String(url || '').replace(/"/g, '\\"');
    const escapedReferer = referer ? String(referer).replace(/"/g, '\\"') : '';
    return escapedReferer
      ? `yt-dlp "${escapedUrl}" --referer "${escapedReferer}"`
      : `yt-dlp "${escapedUrl}"`;
  }

  return {
    TARGET_MIME_TYPES,
    BLOCKED_DOMAINS,
    THUMBNAIL_PRIORITY,
    normalizeContentType,
    isBlockedUrl,
    sanitizeFilename,
    isTargetVideoContentType,
    isHlsLikeContentType,
    isDashContentType,
    shouldIgnoreBySize,
    getBestThumbnailUrl,
    buildYtDlpCommand
  };
});
