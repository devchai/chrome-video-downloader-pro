const test = require('node:test');
const assert = require('node:assert/strict');

const VideoUtils = require('../src/shared/video_utils.js');

test('sanitizeFilename preserves the title and strips only illegal characters', () => {
  // 파일 시스템 금지 문자(<>:"/\|?*)만 공백으로 치환하고 공백은 하나로 축약
  assert.equal(VideoUtils.sanitizeFilename('Hello World: clip.mp4'), 'Hello World clip.mp4');
  assert.equal(VideoUtils.sanitizeFilename('a/b\\c:d*e?f'), 'a b c d e f');
  // 빈 값/공백만 있는 값은 안전한 기본 파일명으로 폴백
  assert.equal(VideoUtils.sanitizeFilename(''), 'video_download');
  assert.equal(VideoUtils.sanitizeFilename('   '), 'video_download');
  // 한글/유니코드 타이틀을 그대로 보존 (핵심 동작)
  assert.equal(VideoUtils.sanitizeFilename('한글 제목'), '한글 제목');
  assert.equal(VideoUtils.sanitizeFilename('日本語のタイトル'), '日本語のタイトル');
  // 앞뒤 공백/마침표 제거 (Windows trailing dot 방지)
  assert.equal(VideoUtils.sanitizeFilename('  제목.  '), '제목');
  // 길이 제한: 100자 이하는 유지, 초과분만 절단
  assert.equal(VideoUtils.sanitizeFilename('a'.repeat(80)), 'a'.repeat(80));
  assert.equal(VideoUtils.sanitizeFilename('a'.repeat(150)), 'a'.repeat(100));
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
