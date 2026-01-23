// Content Script to parse page metadata

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageInfo") {
    const title = document.title || "Untitled Video";

    let h1 = "";
    const h1Tag = document.querySelector('h1');
    if (h1Tag) h1 = h1Tag.innerText;

    sendResponse({
      title: title.trim(),
      h1: h1.trim()
    });
  }

  if (request.action === "getThumbnails") {
    const thumbnails = extractThumbnails(request.videoUrl);
    sendResponse({ thumbnails });
  }

  return true;
});

function extractThumbnails(videoUrl) {
  const thumbnails = [];

  // 1. video poster 속성
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    if (video.poster) {
      thumbnails.push({ url: video.poster, source: 'poster' });
    }
    // video 요소에서 캔버스로 프레임 캡처 시도
    if (video.readyState >= 2 && video.videoWidth > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        if (dataUrl && dataUrl !== 'data:,') {
          thumbnails.push({ url: dataUrl, source: 'capture' });
        }
      } catch (e) {
        // CORS 제한으로 캡처 실패할 수 있음
      }
    }
  });

  // 2. Open Graph 이미지
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage && ogImage.content) {
    thumbnails.push({ url: ogImage.content, source: 'og:image' });
  }

  // 3. Twitter Card 이미지
  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  if (twitterImage && twitterImage.content) {
    thumbnails.push({ url: twitterImage.content, source: 'twitter:image' });
  }

  // 4. schema.org VideoObject thumbnailUrl
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  scripts.forEach(script => {
    try {
      const data = JSON.parse(script.textContent);
      const videoData = data['@type'] === 'VideoObject' ? data : data.video;
      if (videoData && videoData.thumbnailUrl) {
        const urls = Array.isArray(videoData.thumbnailUrl) ? videoData.thumbnailUrl : [videoData.thumbnailUrl];
        urls.forEach(url => thumbnails.push({ url, source: 'schema.org' }));
      }
    } catch (e) {}
  });

  // 5. 페이지 내 img 태그에서 video 관련 클래스/ID 가진 이미지
  const videoImgs = document.querySelectorAll('img[class*="video"], img[class*="thumb"], img[class*="poster"], img[id*="video"], img[id*="thumb"]');
  videoImgs.forEach(img => {
    if (img.src && img.naturalWidth > 100) {
      thumbnails.push({ url: img.src, source: 'related-img' });
    }
  });

  return thumbnails;
}
