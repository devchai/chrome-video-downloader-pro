document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('video-list');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab) return;

  // 1. Listen for progress/status
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "downloadProgress") {
      updateProgressUI(message);
    }
  });

  // 2. Request Video List
  chrome.runtime.sendMessage({ action: "getVideos", tabId: tab.id }, (response) => {
    if (response && response.videos && response.videos.length > 0) {
      renderVideos(response.videos, tab.title);
    } else {
      container.innerHTML = '<div class="empty-state"><p>No network videos detected.</p><p class="sub-text">Play a video to capture traffic.</p></div>';
    }
  });
});

let activeDownloadBtn = null;
let activeStatusEl = null;

function updateProgressUI(message) {
  if (!activeDownloadBtn || !activeStatusEl) return;
  
  const { percent, status } = message;
  
  // Error Handling -> Fallback to Copy Command
  if (status.startsWith("Error")) {
    activeStatusEl.textContent = "Failed. Copied yt-dlp cmd!";
    activeStatusEl.style.color = "#ef4444"; 
    
    // Copy yt-dlp command to clipboard
    const url = activeDownloadBtn.dataset.url;
    // We assume standard headers for Twitter/General
    const cmd = `yt-dlp "${url}" --referer "https://twitter.com/"`;
    navigator.clipboard.writeText(cmd);

    activeDownloadBtn.classList.remove('downloading');
    activeDownloadBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    `;
    activeDownloadBtn.style.background = '#ef4444';
    
  } else if (percent >= 100) {
    activeStatusEl.textContent = "Done!";
    activeStatusEl.style.color = "#10b981";
    activeDownloadBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
    activeDownloadBtn.classList.remove('downloading');
    activeDownloadBtn.style.background = '#10b981';
  } else {
    activeStatusEl.textContent = status;
    activeStatusEl.style.color = "#f59e0b";
    activeDownloadBtn.innerHTML = `<span style="font-size:10px; font-weight:bold">${percent}%</span>`;
    activeDownloadBtn.style.background = '#f59e0b';
  }
}

function renderVideos(videos, pageTitle) {
  const container = document.getElementById('video-list');
  container.innerHTML = '';

  videos.forEach((video, index) => {
    const card = document.createElement('div');
    card.className = 'video-card';
    
    const isHLS = video.contentType.includes('mpegurl') || video.contentType.includes('dash') || video.contentType.includes('octet-stream');
    const format = isHLS ? 'HLS/Stream' : video.contentType.split('/')[1].toUpperCase();
    const sizeStr = video.size > 0 
      ? (video.size / 1024 / 1024).toFixed(1) + ' MB' 
      : 'Stream';

    const urlParts = video.url.split('/');
    let filename = urlParts[urlParts.length - 1].split('?')[0];
    if (filename.length > 30) filename = filename.substring(0, 30) + '...';
    if (!filename || filename.trim() === '') filename = `Video ${index + 1}`;

    card.innerHTML = `
      <div class="video-info">
        <div class="video-title" title="${video.url}">${pageTitle || filename}</div>
        <div class="video-meta">
          <span class="badge ${isHLS ? 'hls' : 'mp4'}">${format}</span>
          <span class="size">${sizeStr}</span>
        </div>
        <div class="status-text" style="font-size:10px; color:#64748b; height:14px;">Ready</div>
      </div>
      <div class="actions" style="display:flex; gap:8px;">
        <button class="cmd-btn" title="Copy yt-dlp Command" style="background:none; border:none; color:#64748b; cursor:pointer;">
           <span style="font-size:10px; font-family:monospace; border:1px solid #475569; padding:2px 4px; border-radius:4px;">CMD</span>
        </button>
        <button class="download-btn" data-url="${video.url}" data-type="${video.contentType}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </button>
      </div>
    `;

    container.appendChild(card);
    
    // CMD Copy Logic (Manual)
    const cmdBtn = card.querySelector('.cmd-btn');
    cmdBtn.addEventListener('click', () => {
      const cmd = `yt-dlp "${video.url}" --referer "https://twitter.com/"`;
      navigator.clipboard.writeText(cmd);
      const status = card.querySelector('.status-text');
      status.textContent = "Copied yt-dlp command!";
      status.style.color = "#a78bfa";
      setTimeout(() => {
        status.textContent = "Ready";
        status.style.color = "#64748b";
      }, 2000);
    });

    // Download Logic (Auto fallback)
    const btn = card.querySelector('.download-btn');
    btn.addEventListener('click', (e) => {
      if (activeDownloadBtn && activeDownloadBtn !== btn) {
        // Reset previous
        activeDownloadBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>`;
        activeDownloadBtn.style.background = '#3b82f6';
      }

      activeDownloadBtn = btn;
      activeStatusEl = card.querySelector('.status-text');
      
      btn.classList.add('downloading');
      btn.innerHTML = '...'; 
      activeStatusEl.textContent = "Trying...";
      activeStatusEl.style.color = "#f59e0b";
      
      handleDownload(video, pageTitle);
    });
  });
}

function handleDownload(video, pageTitle) {
  chrome.runtime.sendMessage({
    action: "downloadVideo",
    url: video.url,
    filename: pageTitle || "video",
    contentType: video.contentType
  });
}
