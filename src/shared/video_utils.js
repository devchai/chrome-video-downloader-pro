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
    let clean = String(name).replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_');
    clean = clean.replace(/^_+|_+$/g, '');
    if (clean.length > 50) clean = clean.substring(0, 50);
    if (clean === '') return 'video_download';
    return clean;
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
