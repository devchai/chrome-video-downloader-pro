// Background Service Worker
importScripts('../assets/lib/mux.min.js');

let detectedVideos = {};
// We store Referer for each detected video URL
let urlReferers = {};
// DNR 규칙이 적용된 도메인 추적
let ruledDomains = new Set();
let nextRuleId = 1001;

const TARGET_MIME_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'video/x-flv', 'video/x-msvideo', 'video/3gpp',
  'application/x-mpegurl', 'application/vnd.apple.mpegurl',
  'video/mp2t', 'application/dash+xml', 'binary/octet-stream'
]);

const BLOCKED_DOMAINS = ['youtube.com', 'googlevideo.com', 'youtu.be'];

function isBlocked(url) {
  try {
    const hostname = new URL(url).hostname;
    return BLOCKED_DOMAINS.some(domain => hostname.includes(domain));
  } catch (e) {
    return false;
  }
}

function updateBadge(tabId) {
  const count = detectedVideos[tabId] ? detectedVideos[tabId].length : 0;
  const text = count > 0 ? count.toString() : '';
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#3b82f6', tabId });
}

function sanitizeFilename(name) {
  if (!name) return 'video_download';
  let clean = name.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_');
  if (clean.length > 50) clean = clean.substring(0, 50);
  if (clean === '' || clean === '_') return 'video_' + Date.now();
  return clean;
}

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'src/offscreen/offscreen.html',
    reasons: ['BLOBS'],
    justification: 'HLS Processing'
  });
}

// 1. Dynamic Header Modification Logic
// 다운로드할 도메인에 대해 Referer/Origin 헤더를 자동 설정
async function setDynamicRules(targetUrl, referer) {
  const targetDomain = new URL(targetUrl).hostname;

  // Clean existing dynamic rules
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [999, 1000]
  });

  const rules = [];

  // Rule 999: 비디오 URL 도메인에 대한 규칙
  rules.push({
    "id": 999,
    "priority": 1,
    "action": {
      "type": "modifyHeaders",
      "requestHeaders": [
        { "header": "Referer", "operation": "set", "value": referer },
        { "header": "Origin", "operation": "set", "value": new URL(referer).origin }
      ]
    },
    "condition": {
      // 도메인 전체에 적용 (HLS 세그먼트 포함)
      "requestDomains": [targetDomain],
      "resourceTypes": ["xmlhttprequest", "media", "other"]
    }
  });

  // Rule 1000: CDN 서브도메인 지원 (예: cdn1.example.com, cdn2.example.com)
  // targetDomain이 서브도메인인 경우 상위 도메인도 포함
  const domainParts = targetDomain.split('.');
  if (domainParts.length > 2) {
    const parentDomain = domainParts.slice(-2).join('.');
    rules.push({
      "id": 1000,
      "priority": 1,
      "action": {
        "type": "modifyHeaders",
        "requestHeaders": [
          { "header": "Referer", "operation": "set", "value": referer },
          { "header": "Origin", "operation": "set", "value": new URL(referer).origin }
        ]
      },
      "condition": {
        "urlFilter": `||${parentDomain}`,
        "resourceTypes": ["xmlhttprequest", "media", "other"]
      }
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: rules
  });

  console.log(`[DNR] Rules updated for ${targetDomain} with Referer: ${referer}`);
  console.log(`[DNR] Active rules:`, rules.length);

  // 초기 도메인 추적
  ruledDomains = new Set([targetDomain]);
  nextRuleId = 1001;
}

// 추가 도메인에 대한 규칙 동적 추가 (HLS 세그먼트가 다른 CDN에 있을 때)
async function addDomainRule(domain, referer) {
  try {
    const ruleId = nextRuleId++;

    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        "id": ruleId,
        "priority": 1,
        "action": {
          "type": "modifyHeaders",
          "requestHeaders": [
            { "header": "Referer", "operation": "set", "value": referer },
            { "header": "Origin", "operation": "set", "value": new URL(referer).origin }
          ]
        },
        "condition": {
          "requestDomains": [domain],
          "resourceTypes": ["xmlhttprequest", "media", "other"]
        }
      }]
    });

    console.log(`[DNR] Added rule ${ruleId} for new domain: ${domain}`);
  } catch (e) {
    console.error(`[DNR] Failed to add rule for ${domain}:`, e);
  }
}


// 2. Capture Referer on Initial Request
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    if (details.tabId === -1) return;
    const referer = details.requestHeaders.find(h => h.name.toLowerCase() === 'referer');
    if (referer) {
      urlReferers[details.url] = referer.value;
      // Also cache by domain/path loosely to match video fragments
      const pathKey = new URL(details.url).pathname;
      urlReferers[pathKey] = referer.value;
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

// 3. Detect Video
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId === -1 || details.method !== 'GET') return;
    if (isBlocked(details.url) || isBlocked(details.initiator)) return;

    const contentTypeHeader = details.responseHeaders.find(h => h.name.toLowerCase() === 'content-type');
    if (!contentTypeHeader) return;
    
    const contentType = contentTypeHeader.value.split(';')[0].toLowerCase().trim();

    if (TARGET_MIME_TYPES.has(contentType)) {
      const contentLengthHeader = details.responseHeaders.find(h => h.name.toLowerCase() === 'content-length');
      const size = contentLengthHeader ? parseInt(contentLengthHeader.value) : 0;

      // Filter: Ignore small files unless it looks like a playlist
      // M3U8, XML (DASH), or octet-stream (often fragments)
      if (!contentType.includes('mpegurl') && !contentType.includes('xml') && size > 0 && size < 5120) return;

      // Heuristic: If it's a small octet-stream, it might be just a fragment, not the full video.
      // But we can't be sure. Let's list it anyway for now.

      const videoData = {
        url: details.url,
        contentType: contentType,
        size: size,
        timestamp: Date.now(),
        tabId: details.tabId,
        thumbnail: null
      };

      if (!detectedVideos[details.tabId]) {
        detectedVideos[details.tabId] = [];
      }

      const isDuplicate = detectedVideos[details.tabId].some(v => v.url === videoData.url);
      if (!isDuplicate) {
        // Try to find referer
        if (!urlReferers[videoData.url] && details.initiator) {
           urlReferers[videoData.url] = details.initiator;
        }

        console.log('Video Detected:', videoData);
        detectedVideos[details.tabId].push(videoData);
        updateBadge(details.tabId);

        // 썸네일 추출 요청
        fetchThumbnailFromTab(details.tabId, videoData.url);
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// 4. Handle Messages & Download
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getVideos") {
    sendResponse({ videos: detectedVideos[request.tabId] || [] });
    return true;
  }

  // Offscreen에서 새 도메인 규칙 요청
  if (request.action === "addDomainRule") {
    const { domain, referer } = request;
    if (domain && referer && !ruledDomains.has(domain)) {
      addDomainRule(domain, referer);
      ruledDomains.add(domain);
    }
    return false;
  }

  // Offscreen → Popup 메시지 중계 (진행률 표시)
  // sender.url로 offscreen document에서 온 메시지인지 확인
  if (request.action === "downloadProgress" && sender.url?.includes('offscreen')) {
    // Service Worker가 받은 메시지를 다시 broadcast하여 popup이 받을 수 있게 함
    chrome.runtime.sendMessage(request).catch(() => {
      // popup이 닫혀있으면 에러 무시
    });
    return false;
  } 
  
  else if (request.action === "downloadVideo") {
    const { url, filename, contentType } = request;
    const cleanFilename = sanitizeFilename(filename);

    // Get the best referer we have
    let referer = urlReferers[url];
    if (!referer) {
       // Try matching pathname
       const pathKey = new URL(url).pathname;
       referer = urlReferers[pathKey];
    }
    // Fallback to initiator of the tab if possible (hard to get here)
    // Or just use origin of the video url as fallback (often wrong for CDN)
    
    // Pass referer to offscreen via message, or set global rule
    if (referer) {
       setDynamicRules(url, referer);
    }

    if (contentType.includes('mpegurl') || contentType.includes('application/dash+xml')) {
      ensureOffscreenDocument().then(() => {
        chrome.runtime.sendMessage({
          action: "processHLS",
          url: url,
          filename: cleanFilename,
          referer: referer // Explicitly pass referer
        });
      });
    } else {
      console.log("Downloading Direct via Offscreen...");
      ensureOffscreenDocument().then(() => {
        chrome.runtime.sendMessage({
          action: "downloadDirect",
          url: url,
          filename: cleanFilename,
          referer: referer
        });
      });
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (detectedVideos[tabId]) delete detectedVideos[tabId];
});

// 썸네일 추출 함수
async function fetchThumbnailFromTab(tabId, videoUrl) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: "getThumbnails",
      videoUrl: videoUrl
    });

    if (response && response.thumbnails && response.thumbnails.length > 0) {
      // 우선순위: capture > poster > og:image > twitter:image > schema.org > related-img
      const priority = ['capture', 'poster', 'og:image', 'twitter:image', 'schema.org', 'related-img'];
      let bestThumbnail = null;

      for (const source of priority) {
        const found = response.thumbnails.find(t => t.source === source);
        if (found) {
          bestThumbnail = found.url;
          break;
        }
      }

      if (!bestThumbnail && response.thumbnails.length > 0) {
        bestThumbnail = response.thumbnails[0].url;
      }

      // 해당 비디오에 썸네일 할당
      if (detectedVideos[tabId]) {
        const video = detectedVideos[tabId].find(v => v.url === videoUrl);
        if (video) {
          video.thumbnail = bestThumbnail;
          console.log('Thumbnail assigned:', bestThumbnail);
        }
      }
    }
  } catch (e) {
    // Content script가 로드되지 않은 페이지일 수 있음
    console.log('Thumbnail fetch failed:', e.message);
  }
}
