const test = require('node:test');
const assert = require('node:assert/strict');

const VideoUtils = require('../src/shared/video_utils.js');

test('sanitizeFilename keeps safe names compact', () => {
  assert.equal(VideoUtils.sanitizeFilename('Hello World: clip.mp4'), 'Hello_World_clip_mp4');
  assert.equal(VideoUtils.sanitizeFilename(''), 'video_download');
  assert.equal(VideoUtils.sanitizeFilename('한글 제목'), 'video_download');
  assert.equal(VideoUtils.sanitizeFilename('a'.repeat(80)), 'a'.repeat(50));
});

test('isBlockedUrl blocks YouTube and Google video domains only', () => {
  assert.equal(VideoUtils.isBlockedUrl('https://www.youtube.com/watch?v=1'), true);
  assert.equal(VideoUtils.isBlockedUrl('https://rr1---sn.googlevideo.com/videoplayback'), true);
  assert.equal(VideoUtils.isBlockedUrl('https://example.com/video.mp4'), false);
  assert.equal(VideoUtils.isBlockedUrl(undefined), false);
});

test('content type helpers normalize and classify media', () => {
  assert.equal(VideoUtils.normalizeContentType('Video/MP4; charset=binary'), 'video/mp4');
  assert.equal(VideoUtils.isTargetVideoContentType('application/vnd.apple.mpegurl'), true);
  assert.equal(VideoUtils.isTargetVideoContentType('text/html'), false);
  assert.equal(VideoUtils.isHlsLikeContentType('application/x-mpegurl'), true);
  assert.equal(VideoUtils.isHlsLikeContentType('application/dash+xml'), false);
});

test('small non-playlist files are ignored', () => {
  assert.equal(VideoUtils.shouldIgnoreBySize('video/mp4', 1024), true);
  assert.equal(VideoUtils.shouldIgnoreBySize('video/mp4', 1024 * 1024), false);
  assert.equal(VideoUtils.shouldIgnoreBySize('application/vnd.apple.mpegurl', 20), false);
});

test('thumbnail priority selects best available source', () => {
  const thumbnails = [
    { url: 'https://example.com/og.jpg', source: 'og:image' },
    { url: 'data:image/jpeg;base64,abc', source: 'capture' }
  ];
  assert.equal(VideoUtils.getBestThumbnailUrl(thumbnails), 'data:image/jpeg;base64,abc');
  assert.equal(VideoUtils.getBestThumbnailUrl([]), null);
});

test('yt-dlp command uses captured referer when available', () => {
  assert.equal(
    VideoUtils.buildYtDlpCommand('https://cdn.example.com/video.mp4', 'https://site.example/page'),
    'yt-dlp "https://cdn.example.com/video.mp4" --referer "https://site.example/page"'
  );
  assert.equal(
    VideoUtils.buildYtDlpCommand('https://cdn.example.com/video.mp4'),
    'yt-dlp "https://cdn.example.com/video.mp4"'
  );
});
