document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('video-list');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) return;

  // 1. Listen for progress/status (URL 기반 매칭)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "downloadProgress") {
      if (message.url) receivedRealTimeUrls.add(message.url);
      updateProgressUI(message);
    }
  });

  // 2. Request Video List
  chrome.runtime.sendMessage({ action: "getVideos", tabId: tab.id }, (response) => {
    if (response && response.videos && response.videos.length > 0) {
      renderVideos(response.videos, tab.title);
      restoreDownloadStates();
    } else {
      container.innerHTML = '<div class="empty-state"><p>No network videos detected.</p><p class="sub-text">Play a video to capture traffic.</p></div>';
    }
  });
});

const LOG_CLASS = 'Popup';

// URL → { btn, statusEl } 매핑 (팝업 재오픈 시에도 동기화 가능)
let downloadUIMap = {};
// 실시간 메시지를 받은 URL 추적 (restore 시 stale 데이터 방지)
let receivedRealTimeUrls = new Set();

function updateProgressUI(message) {
  const { url, percent, status, errorDetails } = message;
  const ui = url ? downloadUIMap[url] : null;
  if (!ui || !status) return;

  const { btn, statusEl } = ui;

  // Error Handling -> Fallback to Copy Command
  if (status.startsWith("Error")) {
    LoggerManager.error(LOG_CLASS, 'updateProgressUI', 'Download failed', { status });
    if (errorDetails) {
      LoggerManager.error(LOG_CLASS, 'updateProgressUI', 'Error details', {
        timestamp: errorDetails.timestamp,
        method: errorDetails.method,
        message: errorDetails.message,
        errorName: errorDetails.errorName,
        errorMessage: errorDetails.errorMessage
      });
      LoggerManager.error(LOG_CLASS, 'updateProgressUI', 'Stack trace', { stack: errorDetails.errorStack });
    }

    let displayMessage = "Failed";
    if (errorDetails) {
      if (errorDetails.errorName === 'HTTPError') {
        displayMessage = `HTTP ${errorDetails.errorMessage.split(' ')[1]} Error`;
      } else if (errorDetails.errorName === 'AllSegmentsFailedError') {
        displayMessage = "All segments failed";
      } else if (errorDetails.errorMessage.includes('Network')) {
        displayMessage = "Network error";
      } else if (errorDetails.errorMessage.includes('CORS')) {
        displayMessage = "CORS blocked";
      }
    }

    statusEl.textContent = `${displayMessage}. Copied cmd!`;
    statusEl.style.color = "#ef4444";

    const cmd = VideoUtils.buildYtDlpCommand(url, ui.referer);
    navigator.clipboard.writeText(cmd);

    btn.classList.remove('downloading');
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    `;
    btn.style.background = '#ef4444';

    if (errorDetails) {
      btn.title = `Error: ${errorDetails.errorMessage}\nMethod: ${errorDetails.method}\nCheck console (F12) for details`;
    }

  } else if (percent >= 100) {
    statusEl.textContent = "Done!";
    statusEl.style.color = "#10b981";
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
    btn.classList.remove('downloading');
    btn.style.background = '#10b981';
    btn.title = 'Download completed';
  } else {
    statusEl.textContent = status;
    statusEl.style.color = "#f59e0b";
    btn.classList.add('downloading');
    const progress = document.createElement('span');
    progress.style.fontSize = '10px';
    progress.style.fontWeight = 'bold';
    progress.textContent = `${percent}%`;
    btn.replaceChildren(progress);
    btn.style.background = '#f59e0b';
  }
}

// 팝업 재오픈 시 Service Worker에서 활성 다운로드 상태 복원
function restoreDownloadStates() {
  chrome.runtime.sendMessage({ action: "getDownloadStates" }, (response) => {
    if (!response || !response.states) return;
    for (const [url, state] of Object.entries(response.states)) {
      // 이미 실시간 메시지를 받은 URL은 스킵 (더 최신 데이터 유지)
      if (downloadUIMap[url] && !receivedRealTimeUrls.has(url)) {
        updateProgressUI({ url, ...state });
      }
    }
  });
}

function renderVideos(videos, pageTitle) {
  const container = document.getElementById('video-list');
  container.innerHTML = '';
  downloadUIMap = {};

  videos.forEach((video, index) => {
    const card = document.createElement('div');
    card.className = 'video-card';

    const isHLS = VideoUtils.isHlsLikeContentType(video.contentType);
    const isDash = VideoUtils.isDashContentType(video.contentType);
    const format = isHLS ? 'HLS/Stream' : isDash ? 'DASH/Stream' : video.contentType.split('/')[1].toUpperCase();
    const sizeStr = video.size > 0
      ? (video.size / 1024 / 1024).toFixed(1) + ' MB'
      : 'Stream';

    const urlParts = video.url.split('/');
    let filename = urlParts[urlParts.length - 1].split('?')[0];
    if (filename.length > 30) filename = filename.substring(0, 30) + '...';
    if (!filename || filename.trim() === '') filename = `Video ${index + 1}`;

    card.appendChild(createThumbnailElement(video.thumbnail));

    const info = document.createElement('div');
    info.className = 'video-info';

    const title = document.createElement('div');
    title.className = 'video-title';
    title.title = video.url;
    title.textContent = pageTitle || filename;
    info.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'video-meta';

    const badge = document.createElement('span');
    badge.className = `badge ${isHLS || isDash ? 'hls' : 'mp4'}`;
    badge.textContent = format;
    meta.appendChild(badge);

    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = sizeStr;
    meta.appendChild(size);
    info.appendChild(meta);

    const statusEl = document.createElement('div');
    statusEl.className = 'status-text';
    statusEl.style.fontSize = '10px';
    statusEl.style.color = '#64748b';
    statusEl.style.height = '14px';
    statusEl.textContent = 'Ready';
    info.appendChild(statusEl);
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const cmdBtn = document.createElement('button');
    cmdBtn.className = 'cmd-btn';
    cmdBtn.title = 'Copy yt-dlp Command';
    cmdBtn.style.background = 'none';
    cmdBtn.style.border = 'none';
    cmdBtn.style.color = '#64748b';
    cmdBtn.style.cursor = 'pointer';
    const cmdLabel = document.createElement('span');
    cmdLabel.style.fontSize = '10px';
    cmdLabel.style.fontFamily = 'monospace';
    cmdLabel.style.border = '1px solid #475569';
    cmdLabel.style.padding = '2px 4px';
    cmdLabel.style.borderRadius = '4px';
    cmdLabel.textContent = 'CMD';
    cmdBtn.appendChild(cmdLabel);
    actions.appendChild(cmdBtn);

    const btn = document.createElement('button');
    btn.className = 'download-btn';
    btn.dataset.url = video.url;
    btn.dataset.type = video.contentType;
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
    `;
    actions.appendChild(btn);
    card.appendChild(actions);

    container.appendChild(card);

    // URL → UI 요소 매핑 등록 (팝업 재오픈 시 상태 복원용)
    downloadUIMap[video.url] = { btn, statusEl, referer: video.referer };

    // CMD Copy Logic
    cmdBtn.addEventListener('click', () => {
      const cmd = VideoUtils.buildYtDlpCommand(video.url, video.referer);
      navigator.clipboard.writeText(cmd);
      statusEl.textContent = "Copied yt-dlp command!";
      statusEl.style.color = "#a78bfa";
      setTimeout(() => {
        statusEl.textContent = "Ready";
        statusEl.style.color = "#64748b";
      }, 2000);
    });

    // Download Logic
    btn.addEventListener('click', () => {
      btn.classList.add('downloading');
      btn.textContent = '...';
      statusEl.textContent = "Trying...";
      statusEl.style.color = "#f59e0b";

      handleDownload(video, pageTitle);
    });
  });
}

function createThumbnailElement(thumbnailUrl) {
  const wrapper = document.createElement('div');
  wrapper.className = 'video-thumbnail';

  if (thumbnailUrl) {
    const img = document.createElement('img');
    img.src = thumbnailUrl;
    img.alt = 'thumbnail';
    img.addEventListener('error', () => {
      wrapper.replaceChildren(createNoThumbnailElement());
    }, { once: true });
    wrapper.appendChild(img);
    return wrapper;
  }

  wrapper.appendChild(createNoThumbnailElement());
  return wrapper;
}

function createNoThumbnailElement() {
  const noThumb = document.createElement('div');
  noThumb.className = 'no-thumb';
  noThumb.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
  `;
  return noThumb;
}

function handleDownload(video, pageTitle) {
  chrome.runtime.sendMessage({
    action: "downloadVideo",
    url: video.url,
    filename: pageTitle || "video",
    contentType: video.contentType
  });
}
