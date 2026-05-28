// Background Service Worker
importScripts('../shared/logger_manager.js');
importScripts('../shared/video_utils.js');
importScripts('../assets/lib/mux.min.js');

let detectedVideos = {};
// We store Referer for each detected video URL
let urlReferers = {};
// DNR 규칙이 적용된 도메인 추적
let ruledDomains = new Set();
let nextRuleId = 1001;
let dynamicRuleIds = [];

// 다운로드 진행 상태 추적 (팝업 재오픈 시 동기화용)
let downloadStates = {}; // { [url]: { percent, status, errorDetails } }

const LOG_CLASS = 'ServiceWorker';
const SESSION_KEYS = ['detectedVideos', 'urlReferers', 'downloadStates', 'dynamicRuleIds', 'nextRuleId'];

const stateReady = loadSessionState();

async function loadSessionState() {
  try {
    const state = await chrome.storage.session.get(SESSION_KEYS);
    detectedVideos = state.detectedVideos || {};
    urlReferers = state.urlReferers || {};
    downloadStates = state.downloadStates || {};
    dynamicRuleIds = state.dynamicRuleIds || [];
    nextRuleId = state.nextRuleId || 1001;
  } catch (e) {
    LoggerManager.error(LOG_CLASS, 'loadSessionState', 'Failed to load session state', e);
  }
}

function persistSessionState(keys = SESSION_KEYS) {
  const state = {};
  for (const key of keys) {
    if (key === 'detectedVideos') state.detectedVideos = detectedVideos;
    if (key === 'urlReferers') state.urlReferers = urlReferers;
    if (key === 'downloadStates') state.downloadStates = downloadStates;
    if (key === 'dynamicRuleIds') state.dynamicRuleIds = dynamicRuleIds;
    if (key === 'nextRuleId') state.nextRuleId = nextRuleId;
  }

  chrome.storage.session.set(state).catch((e) => {
    LoggerManager.error(LOG_CLASS, 'persistSessionState', 'Failed to persist session state', e);
  });
}

function updateBadge(tabId) {
  const count = detectedVideos[tabId] ? detectedVideos[tabId].length : 0;
  const text = count > 0 ? count.toString() : '';
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#3b82f6', tabId });
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

  // Clean existing dynamic rules, including rules from previous downloads.
  const removeRuleIds = Array.from(new Set([999, 1000, ...dynamicRuleIds]));
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds
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

  LoggerManager.debug(LOG_CLASS, 'setDynamicRules', `Rules updated for ${targetDomain}`, {
    referer,
    ruleCount: rules.length
  });

  // 초기 도메인 추적
  ruledDomains = new Set([targetDomain]);
  nextRuleId = 1001;
  dynamicRuleIds = rules.map(rule => rule.id);
  persistSessionState(['dynamicRuleIds', 'nextRuleId']);
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

    dynamicRuleIds.push(ruleId);
    persistSessionState(['dynamicRuleIds', 'nextRuleId']);
    LoggerManager.debug(LOG_CLASS, 'addDomainRule', `Added rule ${ruleId} for new domain`, { domain });
  } catch (e) {
    LoggerManager.error(LOG_CLASS, 'addDomainRule', `Failed to add rule for ${domain}`, e);
  }
}


// 2. Capture Referer on Initial Request
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    stateReady.then(() => captureReferer(details));
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

function captureReferer(details) {
  if (details.tabId === -1 || !details.requestHeaders) return;
  const referer = details.requestHeaders.find(h => h.name.toLowerCase() === 'referer');
  if (referer) {
    urlReferers[details.url] = referer.value;
    // Also cache by domain/path loosely to match video fragments
    const pathKey = new URL(details.url).pathname;
    urlReferers[pathKey] = referer.value;
    persistSessionState(['urlReferers']);
  }
}

// 3. Detect Video
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    stateReady.then(() => detectVideo(details));
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

function detectVideo(details) {
  if (details.tabId === -1 || details.method !== 'GET') return;
  if (VideoUtils.isBlockedUrl(details.url) || VideoUtils.isBlockedUrl(details.initiator)) return;

  const contentTypeHeader = details.responseHeaders.find(h => h.name.toLowerCase() === 'content-type');
  if (!contentTypeHeader) return;

  const contentType = VideoUtils.normalizeContentType(contentTypeHeader.value);

  if (!VideoUtils.isTargetVideoContentType(contentType)) return;

  const contentLengthHeader = details.responseHeaders.find(h => h.name.toLowerCase() === 'content-length');
  const size = contentLengthHeader ? parseInt(contentLengthHeader.value) : 0;

  if (VideoUtils.shouldIgnoreBySize(contentType, size)) return;

  const videoData = {
    url: details.url,
    contentType: contentType,
    size: size,
    timestamp: Date.now(),
    tabId: details.tabId,
    thumbnail: null,
    referer: urlReferers[details.url] || details.initiator || null
  };

  if (!detectedVideos[details.tabId]) {
    detectedVideos[details.tabId] = [];
  }

  const isDuplicate = detectedVideos[details.tabId].some(v => v.url === videoData.url);
  if (isDuplicate) return;

  if (!urlReferers[videoData.url] && details.initiator) {
    urlReferers[videoData.url] = details.initiator;
  }

  LoggerManager.debug(LOG_CLASS, 'detectVideo', 'Video detected', videoData);
  detectedVideos[details.tabId].push(videoData);
  persistSessionState(['detectedVideos', 'urlReferers']);
  updateBadge(details.tabId);

  // 썸네일 추출 요청
  fetchThumbnailFromTab(details.tabId, videoData.url);
}

// 4. Handle Messages & Download
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getVideos") {
    stateReady.then(() => {
      sendResponse({ videos: detectedVideos[request.tabId] || [] });
    });
    return true;
  }

  // 팝업에서 활성 다운로드 상태 요청
  if (request.action === "getDownloadStates") {
    stateReady.then(() => {
      // Lazy cleanup: 60초 이상 지난 완료/에러 상태 정리
      const now = Date.now();
      let changed = false;
      for (const [url, state] of Object.entries(downloadStates)) {
        if (state._completedAt && (now - state._completedAt > 60000)) {
          delete downloadStates[url];
          changed = true;
        }
      }
      if (changed) persistSessionState(['downloadStates']);
      sendResponse({ states: downloadStates });
    });
    return true;
  }

  // Offscreen에서 새 도메인 규칙 요청
  if (request.action === "addDomainRule") {
    const { domain, referer } = request;
    stateReady.then(() => {
      if (domain && referer && !ruledDomains.has(domain)) {
        addDomainRule(domain, referer);
        ruledDomains.add(domain);
      }
    });
    return false;
  }

  // Offscreen → Popup 메시지 중계 (진행률 표시)
  if (request.action === "downloadProgress" && sender.url?.includes('offscreen')) {
    stateReady.then(() => {
      recordDownloadProgress(request);
    });
    return false;
  }

  else if (request.action === "downloadVideo") {
    stateReady.then(() => downloadVideo(request));
    return false;
  }
});

function recordDownloadProgress(message) {
  const url = message.url;
  if (url) {
    downloadStates[url] = {
      percent: message.percent,
      status: message.status,
      errorDetails: message.errorDetails || null
    };

    // 완료/에러 상태: 타임스탬프 기록 후 lazy cleanup
    if (message.percent >= 100 || message.status?.startsWith("Error")) {
      downloadStates[url]._completedAt = Date.now();
    }
    persistSessionState(['downloadStates']);
  }

  // popup에 중계
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function downloadVideo(request) {
  const { url, filename, contentType } = request;
  const cleanFilename = VideoUtils.sanitizeFilename(filename);

  // 다운로드 상태 초기화
  downloadStates[url] = { percent: 0, status: "Starting..." };
  persistSessionState(['downloadStates']);

  // Get the best referer we have
  let referer = urlReferers[url];
  if (!referer) {
    const pathKey = new URL(url).pathname;
    referer = urlReferers[pathKey];
  }

  if (referer) {
    await setDynamicRules(url, referer);
  }

  if (VideoUtils.isDashContentType(contentType)) {
    const errorDetails = {
      timestamp: new Date().toISOString(),
      method: 'downloadVideo',
      message: 'DASH streams are detected but not supported yet',
      errorName: 'UnsupportedDashError',
      errorMessage: 'DASH download is not implemented',
      errorStack: `URL: ${url}`
    };
    recordDownloadProgress({
      action: 'downloadProgress',
      url,
      percent: 0,
      status: 'Error: DASH streams are not supported yet',
      errorDetails
    });
    return;
  }

  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({
    action: VideoUtils.isHlsLikeContentType(contentType) ? "processHLS" : "downloadDirect",
    url: url,
    filename: cleanFilename,
    referer: referer
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  stateReady.then(() => {
    if (detectedVideos[tabId]) {
      delete detectedVideos[tabId];
      persistSessionState(['detectedVideos']);
    }
  });
});

// 썸네일 추출 함수
async function fetchThumbnailFromTab(tabId, videoUrl) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: "getThumbnails",
      videoUrl: videoUrl
    });

    if (response && response.thumbnails && response.thumbnails.length > 0) {
      const bestThumbnail = VideoUtils.getBestThumbnailUrl(response.thumbnails);

      // 해당 비디오에 썸네일 할당
      if (detectedVideos[tabId]) {
        const video = detectedVideos[tabId].find(v => v.url === videoUrl);
        if (video) {
          video.thumbnail = bestThumbnail;
          persistSessionState(['detectedVideos']);
          LoggerManager.debug(LOG_CLASS, 'fetchThumbnailFromTab', 'Thumbnail assigned', { bestThumbnail });
        }
      }
    }
  } catch (e) {
    // Content script가 로드되지 않은 페이지일 수 있음
    LoggerManager.debug(LOG_CLASS, 'fetchThumbnailFromTab', 'Thumbnail fetch failed', { message: e.message });
  }
}
