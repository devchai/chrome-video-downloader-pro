// Offscreen Document for HLS & Direct Processing

// 전역 referer 저장 (세그먼트 다운로드에서 사용)
let currentReferer = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "processHLS") {
    currentReferer = request.referer || null;
    processHLS(request.url, request.filename);
  } else if (request.action === "downloadDirect") {
    currentReferer = request.referer || null;
    processDirectDownload(request.url, request.filename);
  }
});

const LOG_TAG = '[OffscreenDownloader]';

function log(method, msg, data = null) {
  const timestamp = new Date().toISOString();
  const logMsg = `${LOG_TAG} ${method}: ${msg}`;
  if (data) {
    console.log(logMsg, data);
  } else {
    console.log(logMsg);
  }
}

function logError(method, msg, error = null) {
  const timestamp = new Date().toISOString();
  const errorDetails = {
    timestamp,
    method,
    message: msg,
    errorName: error?.name || 'Unknown',
    errorMessage: error?.message || 'No message',
    errorStack: error?.stack || 'No stack trace'
  };
  console.error(`${LOG_TAG} ERROR in ${method}:`, errorDetails);
  return errorDetails;
}

function sendProgress(percent, status, errorDetails = null) {
  const message = {
    action: "downloadProgress",
    percent: percent,
    status: status
  };
  if (errorDetails) {
    message.errorDetails = errorDetails;
  }
  chrome.runtime.sendMessage(message);
}

async function processDirectDownload(url, filename) {
  const METHOD = 'processDirectDownload';
  log(METHOD, `Starting direct download`, { url, filename, referer: currentReferer });
  sendProgress(5, "Connecting...");

  try {
    // Referer 헤더를 포함한 fetch 옵션
    const fetchOptions = buildFetchOptions(url);
    log(METHOD, `Fetching URL...`, { headers: fetchOptions.headers });
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorDetails = logError(METHOD, `HTTP request failed`, {
        name: 'HTTPError',
        message: `HTTP ${response.status} ${response.statusText}`,
        stack: `URL: ${url}\nStatus: ${response.status}\nStatusText: ${response.statusText}\nHeaders: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`
      });
      sendProgress(0, `Error: HTTP ${response.status} - ${response.statusText}`, errorDetails);
      return;
    }

    const contentLength = response.headers.get('content-length');
    const totalSize = contentLength ? parseInt(contentLength, 10) : 0;

    log(METHOD, `Response received`, {
      status: response.status,
      contentType: response.headers.get('content-type'),
      contentLength: totalSize
    });

    // ReadableStream으로 진행률 추적
    let receivedSize = 0;
    const chunks = [];
    const reader = response.body.getReader();
    let lastProgressUpdate = 0;
    const PROGRESS_UPDATE_INTERVAL = 200; // 200ms마다 업데이트

    sendProgress(10, "Downloading...");

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      chunks.push(value);
      receivedSize += value.length;

      // 진행률 업데이트 빈도 제한 (200ms마다)
      const now = Date.now();
      if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
        lastProgressUpdate = now;

        // 진행률 계산 (10% ~ 90% 범위)
        if (totalSize > 0) {
          const percent = Math.round(10 + (receivedSize / totalSize) * 80);
          const downloaded = (receivedSize / 1024 / 1024).toFixed(1);
          const total = (totalSize / 1024 / 1024).toFixed(1);
          sendProgress(percent, `${downloaded}/${total} MB`);
        } else {
          // Content-Length가 없는 경우 다운로드된 크기만 표시
          const downloaded = (receivedSize / 1024 / 1024).toFixed(1);
          sendProgress(50, `${downloaded} MB...`);
        }
      }
    }

    // chunks를 Blob으로 합치기
    const blob = new Blob(chunks);
    log(METHOD, `Blob created`, { size: blob.size, type: blob.type });

    if (blob.size === 0) {
      const errorDetails = logError(METHOD, `Empty response received`, {
        name: 'EmptyResponseError',
        message: '0 Bytes Received - Server returned empty content',
        stack: `URL: ${url}\nContent-Type: ${response.headers.get('content-type')}\nContent-Length: ${response.headers.get('content-length')}`
      });
      sendProgress(0, "Error: 0 Bytes Received", errorDetails);
      return;
    }

    sendProgress(100, "Saving...");
    log(METHOD, `Triggering download`, { filename: `${filename}.mp4`, blobSize: blob.size });

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${filename}.mp4`;
    a.click();

    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    log(METHOD, `Download completed successfully`);

  } catch (error) {
    const errorDetails = logError(METHOD, `Direct download failed`, error);

    // 네트워크 오류 상세 분류
    let userMessage = "Error: ";
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      userMessage += "Network error - Could not reach server";
    } else if (error.name === 'AbortError') {
      userMessage += "Request was aborted";
    } else if (error.message.includes('CORS')) {
      userMessage += "CORS blocked - Server does not allow this request";
    } else {
      userMessage += error.message;
    }

    sendProgress(0, userMessage, errorDetails);
  }
}

// Referer 헤더를 포함한 fetch 옵션 생성
// 주의: fetch API에서 'Referer' 헤더는 forbidden header이므로 직접 설정 불가
// declarativeNetRequest를 통해 헤더가 자동으로 추가됨
function buildFetchOptions(url) {
  const options = {
    mode: 'cors',
    credentials: 'include',  // 쿠키 포함 (일부 CDN에서 필요)
    referrerPolicy: 'no-referrer-when-downgrade'
  };

  if (currentReferer) {
    options.referrer = currentReferer;
  }

  return options;
}

// 새 도메인 발견 시 Service Worker에 알림 (DNR 규칙 추가 요청)
async function notifyNewDomain(url) {
  try {
    const domain = new URL(url).hostname;
    await chrome.runtime.sendMessage({
      action: 'addDomainRule',
      domain: domain,
      referer: currentReferer
    });
    log('notifyNewDomain', `Requested DNR rule for domain`, { domain });
  } catch (e) {
    // 무시 - 규칙 추가 실패해도 계속 진행
  }
}

// 세그먼트 URL들의 도메인을 수집하여 DNR 규칙 등록
async function registerSegmentDomains(segmentUrls, initUrl) {
  const domains = new Set();

  // Init 세그먼트 도메인
  if (initUrl) {
    try {
      domains.add(new URL(initUrl).hostname);
    } catch (e) {}
  }

  // 모든 세그먼트 도메인 수집 (처음 10개만 샘플링)
  for (let i = 0; i < Math.min(segmentUrls.length, 10); i++) {
    try {
      domains.add(new URL(segmentUrls[i]).hostname);
    } catch (e) {}
  }

  log('registerSegmentDomains', `Registering domains for DNR`, { domains: Array.from(domains) });

  // 각 도메인에 대해 규칙 요청
  for (const domain of domains) {
    await notifyNewDomain(`https://${domain}/`);
  }

  // 규칙이 적용될 시간을 위해 약간의 딜레이
  await new Promise(resolve => setTimeout(resolve, 100));
}

async function processHLS(masterUrl, filename) {
  const METHOD = 'processHLS';
  log(METHOD, `Starting HLS processing`, { masterUrl, filename, referer: currentReferer });
  sendProgress(0, "Fetching Playlist...");

  try {
    const fetchOptions = buildFetchOptions(masterUrl);
    log(METHOD, `Fetching master playlist...`, { headers: fetchOptions.headers });
    const response = await fetch(masterUrl, fetchOptions);

    if (!response.ok) {
      const errorDetails = logError(METHOD, `Failed to fetch master playlist`, {
        name: 'PlaylistFetchError',
        message: `HTTP ${response.status} ${response.statusText}`,
        stack: `URL: ${masterUrl}\nStatus: ${response.status}\nStatusText: ${response.statusText}`
      });
      sendProgress(0, `Error: Playlist HTTP ${response.status}`, errorDetails);
      return;
    }

    const text = await response.text();
    log(METHOD, `Playlist fetched`, { contentLength: text.length, isMaster: text.includes('#EXT-X-STREAM-INF') });

    // Check if this is a master playlist (has variants)
    if (text.includes('#EXT-X-STREAM-INF')) {
      log(METHOD, `Parsing master playlist for variants...`);
      const { videoPlaylistUrl, audioPlaylistUrl } = parseMasterPlaylist(text, masterUrl);

      if (videoPlaylistUrl) {
        log(METHOD, `Variant playlists found`, { videoPlaylistUrl, audioPlaylistUrl: audioPlaylistUrl || 'embedded or none' });

        log(METHOD, `Fetching video playlist...`);
        const videoResponse = await fetch(videoPlaylistUrl, buildFetchOptions(videoPlaylistUrl));
        if (!videoResponse.ok) {
          const errorDetails = logError(METHOD, `Failed to fetch video playlist`, {
            name: 'VideoPlaylistFetchError',
            message: `HTTP ${videoResponse.status} ${videoResponse.statusText}`,
            stack: `URL: ${videoPlaylistUrl}\nStatus: ${videoResponse.status}`
          });
          sendProgress(0, `Error: Video Playlist HTTP ${videoResponse.status}`, errorDetails);
          return;
        }
        const videoText = await videoResponse.text();
        log(METHOD, `Video playlist fetched`, { contentLength: videoText.length });

        let audioText = null;
        let audioBaseUrl = null;
        if (audioPlaylistUrl) {
          log(METHOD, `Fetching audio playlist...`);
          const audioResponse = await fetch(audioPlaylistUrl, buildFetchOptions(audioPlaylistUrl));
          if (audioResponse.ok) {
            audioText = await audioResponse.text();
            audioBaseUrl = audioPlaylistUrl;
            log(METHOD, `Audio playlist fetched successfully`, { contentLength: audioText.length });
          } else {
            log(METHOD, `Audio playlist fetch failed (non-critical)`, { status: audioResponse.status });
          }
        }

        await downloadSegmentsWithAudio(videoText, videoPlaylistUrl, audioText, audioBaseUrl, filename);
      } else {
        log(METHOD, `No video playlist URL found in master, using single playlist mode`);
        await downloadSegments(text, masterUrl, filename);
      }
    } else {
      // Single media playlist (video+audio combined or video-only)
      log(METHOD, `Single media playlist detected`);
      await downloadSegments(text, masterUrl, filename);
    }

  } catch (error) {
    const errorDetails = logError(METHOD, `HLS processing failed`, error);

    let userMessage = "Error: ";
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      userMessage += "Network error - Could not fetch playlist";
    } else if (error.message.includes('Invalid')) {
      userMessage += "Invalid playlist format";
    } else {
      userMessage += error.message;
    }

    sendProgress(0, userMessage, errorDetails);
  }
}

function parseMasterPlaylist(text, baseUrl) {
  const lines = text.split('\n');
  let audioPlaylistUrl = null;
  let videoPlaylistUrl = null;
  let bestBandwidth = 0;
  let selectedAudioGroup = null;

  // First pass: find EXT-X-MEDIA audio tracks
  const audioTracks = {};
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
      const groupMatch = line.match(/GROUP-ID="([^"]+)"/);
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (groupMatch && uriMatch) {
        audioTracks[groupMatch[1]] = new URL(uriMatch[1], baseUrl).href;
      }
    }
  }

  // Second pass: find best video stream and its audio group
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
      const audioGroupMatch = line.match(/AUDIO="([^"]+)"/);
      const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;

      if (bandwidth > bestBandwidth && lines[i + 1] && !lines[i + 1].startsWith('#')) {
        bestBandwidth = bandwidth;
        videoPlaylistUrl = new URL(lines[i + 1].trim(), baseUrl).href;
        selectedAudioGroup = audioGroupMatch ? audioGroupMatch[1] : null;
      }
    }
  }

  // Get audio URL for selected video's audio group
  if (selectedAudioGroup && audioTracks[selectedAudioGroup]) {
    audioPlaylistUrl = audioTracks[selectedAudioGroup];
  }

  return { videoPlaylistUrl, audioPlaylistUrl };
}

async function downloadSegmentsWithAudio(videoPlaylistText, videoBaseUrl, audioPlaylistText, audioBaseUrl, filename) {
  const METHOD = 'downloadSegmentsWithAudio';
  log(METHOD, `Starting download with audio`, { videoBaseUrl, audioBaseUrl, filename });
  sendProgress(5, "Parsing playlists...");

  // Parse video segments
  const videoData = parseMediaPlaylist(videoPlaylistText, videoBaseUrl);
  log(METHOD, `Video playlist parsed`, { segmentCount: videoData.segments.length, hasInit: !!videoData.initUrl });

  // 세그먼트 도메인들에 대해 DNR 규칙 요청
  await registerSegmentDomains(videoData.segments, videoData.initUrl);

  // Parse audio segments if available
  let audioData = null;
  if (audioPlaylistText) {
    audioData = parseMediaPlaylist(audioPlaylistText, audioBaseUrl);
    log(METHOD, `Audio playlist parsed`, { segmentCount: audioData.segments.length, hasInit: !!audioData.initUrl });
  }

  const totalSegments = videoData.segments.length + (audioData ? audioData.segments.length : 0);
  let downloaded = 0;
  let failedSegments = [];

  // Download video init segment
  let videoInitData = null;
  if (videoData.initUrl) {
    try {
      log(METHOD, `Downloading video init segment...`, { url: videoData.initUrl });
      const res = await fetch(videoData.initUrl, buildFetchOptions(videoData.initUrl));
      if (res.ok) {
        videoInitData = new Uint8Array(await res.arrayBuffer());
        log(METHOD, `Video init segment downloaded`, { size: videoInitData.byteLength });
      } else {
        logError(METHOD, `Video init segment fetch failed`, {
          name: 'InitSegmentError',
          message: `HTTP ${res.status}`,
          stack: `URL: ${videoData.initUrl}`
        });
      }
    } catch (e) {
      logError(METHOD, `Video init segment error`, e);
    }
  }

  // Download audio init segment
  let audioInitData = null;
  if (audioData?.initUrl) {
    try {
      log(METHOD, `Downloading audio init segment...`, { url: audioData.initUrl });
      const res = await fetch(audioData.initUrl, buildFetchOptions(audioData.initUrl));
      if (res.ok) {
        audioInitData = new Uint8Array(await res.arrayBuffer());
        log(METHOD, `Audio init segment downloaded`, { size: audioInitData.byteLength });
      } else {
        logError(METHOD, `Audio init segment fetch failed`, {
          name: 'InitSegmentError',
          message: `HTTP ${res.status}`,
          stack: `URL: ${audioData.initUrl}`
        });
      }
    } catch (e) {
      logError(METHOD, `Audio init segment error`, e);
    }
  }

  // Download video segments
  const videoSegments = [];
  for (let i = 0; i < videoData.segments.length; i++) {
    const url = videoData.segments[i];
    try {
      const res = await fetch(url, buildFetchOptions(url));
      if (res.ok) {
        videoSegments.push(new Uint8Array(await res.arrayBuffer()));
        downloaded++;
        sendProgress(5 + Math.round((downloaded / totalSegments) * 80), `Downloading ${downloaded}/${totalSegments}`);
      } else {
        failedSegments.push({ type: 'video', index: i, url, status: res.status, statusText: res.statusText });
        logError(METHOD, `Video segment ${i} failed`, {
          name: 'SegmentFetchError',
          message: `HTTP ${res.status} ${res.statusText}`,
          stack: `URL: ${url}\nIndex: ${i}`
        });
      }
    } catch (e) {
      failedSegments.push({ type: 'video', index: i, url, error: e.message });
      logError(METHOD, `Video segment ${i} network error`, e);
    }
  }

  // Download audio segments
  const audioSegments = [];
  if (audioData) {
    for (let i = 0; i < audioData.segments.length; i++) {
      const url = audioData.segments[i];
      try {
        const res = await fetch(url, buildFetchOptions(url));
        if (res.ok) {
          audioSegments.push(new Uint8Array(await res.arrayBuffer()));
          downloaded++;
          sendProgress(5 + Math.round((downloaded / totalSegments) * 80), `Downloading ${downloaded}/${totalSegments}`);
        } else {
          failedSegments.push({ type: 'audio', index: i, url, status: res.status, statusText: res.statusText });
          logError(METHOD, `Audio segment ${i} failed`, {
            name: 'SegmentFetchError',
            message: `HTTP ${res.status} ${res.statusText}`,
            stack: `URL: ${url}\nIndex: ${i}`
          });
        }
      } catch (e) {
        failedSegments.push({ type: 'audio', index: i, url, error: e.message });
        logError(METHOD, `Audio segment ${i} network error`, e);
      }
    }
  }

  log(METHOD, `Segment download summary`, {
    videoDownloaded: videoSegments.length,
    videoTotal: videoData.segments.length,
    audioDownloaded: audioSegments.length,
    audioTotal: audioData?.segments.length || 0,
    failedCount: failedSegments.length
  });

  if (videoSegments.length === 0) {
    const errorDetails = logError(METHOD, `All video segments failed`, {
      name: 'AllSegmentsFailedError',
      message: 'No video segments were downloaded successfully',
      stack: `Failed segments: ${JSON.stringify(failedSegments.slice(0, 5))}`
    });
    sendProgress(0, "Error: All video segments failed", errorDetails);
    return;
  }

  sendProgress(90, "Merging...");

  // Determine format and merge
  const firstVideoSeg = videoSegments[0];
  const isTsFormat = firstVideoSeg && firstVideoSeg[0] === 0x47;
  log(METHOD, `Format detection`, { isTsFormat, firstByte: firstVideoSeg?.[0] });

  let finalBlob = null;
  let ext = 'mp4';

  if (isTsFormat) {
    log(METHOD, `Processing TS format with mux.js...`);
    finalBlob = await transmuxTsSegments([...videoSegments]);
    if (!finalBlob) {
      log(METHOD, `mux.js transmux failed, saving as raw TS`);
      ext = 'ts';
      finalBlob = new Blob(videoSegments, { type: 'video/mp2t' });
    }
  } else {
    log(METHOD, `Processing fMP4 format...`);
    finalBlob = mergeFmp4Tracks(videoInitData, videoSegments, audioInitData, audioSegments);
  }

  if (!finalBlob || finalBlob.size === 0) {
    const errorDetails = logError(METHOD, `Final blob is empty`, {
      name: 'EmptyBlobError',
      message: 'Merged video has 0 bytes',
      stack: `VideoSegments: ${videoSegments.length}, AudioSegments: ${audioSegments.length}, Format: ${isTsFormat ? 'TS' : 'fMP4'}`
    });
    sendProgress(0, "Error: 0 Bytes - Merge failed", errorDetails);
    return;
  }

  sendProgress(100, "Saving...");
  log(METHOD, `Download completed`, { filename: `${filename}.${ext}`, size: finalBlob.size, failedSegments: failedSegments.length });

  const blobUrl = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `${filename}.${ext}`;
  a.click();

  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

function parseMediaPlaylist(text, baseUrl) {
  const lines = text.split('\n');
  const segments = [];
  let initUrl = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXT-X-MAP:')) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) initUrl = new URL(uriMatch[1], baseUrl).href;
    } else if (trimmed && !trimmed.startsWith('#')) {
      segments.push(new URL(trimmed, baseUrl).href);
    }
  }

  return { initUrl, segments };
}

async function transmuxTsSegments(segments) {
  const METHOD = 'transmuxTsSegments';
  log(METHOD, `Starting TS transmux`, { segmentCount: segments.length });

  try {
    const transmuxer = new muxjs.mp4.Transmuxer();
    const combinedData = [];
    let transmuxErrors = [];

    transmuxer.on('data', (segment) => {
      const data = new Uint8Array(segment.initSegment.byteLength + segment.data.byteLength);
      data.set(segment.initSegment, 0);
      data.set(segment.data, segment.initSegment.byteLength);
      combinedData.push(data);
      log(METHOD, `Transmuxed segment`, { initSize: segment.initSegment.byteLength, dataSize: segment.data.byteLength });
    });

    transmuxer.on('error', (error) => {
      transmuxErrors.push(error);
      logError(METHOD, `Transmuxer error event`, { name: 'TransmuxError', message: error.message || error, stack: '' });
    });

    for (let i = 0; i < segments.length; i++) {
      try {
        transmuxer.push(segments[i]);
        transmuxer.flush();
      } catch (segError) {
        logError(METHOD, `Failed to transmux segment ${i}`, segError);
      }
    }

    if (combinedData.length > 0) {
      const totalSize = combinedData.reduce((sum, arr) => sum + arr.byteLength, 0);
      log(METHOD, `Transmux completed`, { outputChunks: combinedData.length, totalSize });
      return new Blob(combinedData, { type: 'video/mp4' });
    } else {
      logError(METHOD, `No data produced by transmuxer`, {
        name: 'TransmuxEmptyError',
        message: 'mux.js produced no output data',
        stack: `Input segments: ${segments.length}, Errors: ${transmuxErrors.length}`
      });
    }
  } catch (e) {
    logError(METHOD, `TS transmux failed`, e);
  }
  return null;
}

function mergeFmp4Tracks(videoInit, videoSegments, audioInit, audioSegments) {
  const parts = [];

  // Merge init segments: combine video moov + audio trak into single init
  if (videoInit && audioInit) {
    const mergedInit = mergeInitSegments(videoInit, audioInit);
    parts.push(mergedInit);
  } else if (videoInit) {
    parts.push(videoInit);
  } else if (audioInit) {
    parts.push(audioInit);
  }

  // Interleave video and audio segments for proper playback
  const maxLen = Math.max(videoSegments.length, audioSegments.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < videoSegments.length) parts.push(videoSegments[i]);
    if (i < audioSegments.length) parts.push(audioSegments[i]);
  }

  return new Blob(parts, { type: 'video/mp4' });
}

// Merge two fMP4 init segments into one with both tracks
function mergeInitSegments(videoInit, audioInit) {
  // Parse MP4 boxes from both init segments
  const videoBoxes = parseMP4Boxes(videoInit);
  const audioBoxes = parseMP4Boxes(audioInit);

  const videoMoov = videoBoxes.find(b => b.type === 'moov');
  const audioMoov = audioBoxes.find(b => b.type === 'moov');

  if (!videoMoov || !audioMoov) {
    console.warn('[Offscreen] Missing moov box, falling back to video-only');
    return videoInit;
  }

  // Parse moov children
  const videoMoovChildren = parseMP4Boxes(videoMoov.data.subarray(8));
  const audioMoovChildren = parseMP4Boxes(audioMoov.data.subarray(8));

  // Find audio trak and mvex/trex
  const audioTrak = audioMoovChildren.find(b => b.type === 'trak');
  const audioMvex = audioMoovChildren.find(b => b.type === 'mvex');

  if (!audioTrak) {
    console.warn('[Offscreen] No audio trak found');
    return videoInit;
  }

  // Update mvhd next_track_id
  const videoMvhd = videoMoovChildren.find(b => b.type === 'mvhd');
  if (videoMvhd) {
    // next_track_id is at offset 96 (version 0) or 108 (version 1) in mvhd
    const version = videoMvhd.data[8];
    const nextTrackOffset = version === 0 ? 8 + 96 : 8 + 108;
    if (nextTrackOffset + 4 <= videoMvhd.data.length) {
      // Set next_track_id to 3 (we have track 1 and 2)
      videoMvhd.data[nextTrackOffset] = 0;
      videoMvhd.data[nextTrackOffset + 1] = 0;
      videoMvhd.data[nextTrackOffset + 2] = 0;
      videoMvhd.data[nextTrackOffset + 3] = 3;
    }
  }

  // Build merged moov: ftyp + moov(mvhd + video_trak + audio_trak + merged_mvex + udta)
  const resultParts = [];

  // Copy ftyp from video
  const videoFtyp = videoBoxes.find(b => b.type === 'ftyp');
  if (videoFtyp) resultParts.push(videoFtyp.data);

  // Copy free box if present
  const videoFree = videoBoxes.find(b => b.type === 'free');
  if (videoFree) resultParts.push(videoFree.data);

  // Build new moov
  const moovChildren = [];

  // mvhd
  if (videoMvhd) moovChildren.push(videoMvhd.data);

  // video trak
  const videoTrak = videoMoovChildren.find(b => b.type === 'trak');
  if (videoTrak) moovChildren.push(videoTrak.data);

  // audio trak (need to ensure track_id = 2)
  moovChildren.push(audioTrak.data);

  // Merge mvex (contains trex for each track)
  const videoMvex = videoMoovChildren.find(b => b.type === 'mvex');
  if (videoMvex && audioMvex) {
    const mergedMvex = mergeMvexBoxes(videoMvex, audioMvex);
    moovChildren.push(mergedMvex);
  } else if (videoMvex) {
    moovChildren.push(videoMvex.data);
  }

  // udta if present
  const videoUdta = videoMoovChildren.find(b => b.type === 'udta');
  if (videoUdta) moovChildren.push(videoUdta.data);

  // Calculate moov size and build
  const moovContentSize = moovChildren.reduce((sum, arr) => sum + arr.length, 0);
  const moovSize = 8 + moovContentSize;
  const moovBox = new Uint8Array(moovSize);
  writeUint32(moovBox, 0, moovSize);
  moovBox[4] = 0x6D; moovBox[5] = 0x6F; moovBox[6] = 0x6F; moovBox[7] = 0x76; // 'moov'

  let offset = 8;
  for (const child of moovChildren) {
    moovBox.set(child, offset);
    offset += child.length;
  }

  resultParts.push(moovBox);

  // Combine all parts
  const totalSize = resultParts.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const part of resultParts) {
    result.set(part, pos);
    pos += part.length;
  }

  console.log(`[Offscreen] Merged init: ${videoInit.length} + ${audioInit.length} -> ${result.length}`);
  return result;
}

function mergeMvexBoxes(videoMvex, audioMvex) {
  const videoChildren = parseMP4Boxes(videoMvex.data.subarray(8));
  const audioChildren = parseMP4Boxes(audioMvex.data.subarray(8));

  const parts = [];
  // Add mehd if present
  const mehd = videoChildren.find(b => b.type === 'mehd');
  if (mehd) parts.push(mehd.data);

  // Add all trex boxes
  for (const box of videoChildren) {
    if (box.type === 'trex') parts.push(box.data);
  }
  for (const box of audioChildren) {
    if (box.type === 'trex') parts.push(box.data);
  }

  const contentSize = parts.reduce((sum, arr) => sum + arr.length, 0);
  const mvexSize = 8 + contentSize;
  const mvexBox = new Uint8Array(mvexSize);
  writeUint32(mvexBox, 0, mvexSize);
  mvexBox[4] = 0x6D; mvexBox[5] = 0x76; mvexBox[6] = 0x65; mvexBox[7] = 0x78; // 'mvex'

  let offset = 8;
  for (const part of parts) {
    mvexBox.set(part, offset);
    offset += part.length;
  }

  return mvexBox;
}

function parseMP4Boxes(data) {
  const boxes = [];
  let offset = 0;

  while (offset + 8 <= data.length) {
    const size = readUint32(data, offset);
    if (size < 8 || offset + size > data.length) break;

    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
    boxes.push({
      type,
      size,
      data: data.subarray(offset, offset + size)
    });
    offset += size;
  }

  return boxes;
}

function readUint32(data, offset) {
  return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

function writeUint32(data, offset, value) {
  data[offset] = (value >> 24) & 0xFF;
  data[offset + 1] = (value >> 16) & 0xFF;
  data[offset + 2] = (value >> 8) & 0xFF;
  data[offset + 3] = value & 0xFF;
}

async function downloadSegments(playlistText, baseUrl, filename) {
  const METHOD = 'downloadSegments';
  log(METHOD, `Starting segment download`, { baseUrl, filename });

  const lines = playlistText.split('\n');
  const segmentUrls = [];
  let initSegmentUrl = null;

  // Parse playlist - extract init segment (EXT-X-MAP) and media segments
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check for init segment (fMP4 format)
    if (line.startsWith('#EXT-X-MAP:')) {
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch) {
        initSegmentUrl = new URL(uriMatch[1], baseUrl).href;
        log(METHOD, `Found init segment`, { url: initSegmentUrl });
      }
    }
    // Collect media segment URLs (non-comment, non-empty lines)
    else if (line && !line.startsWith('#') && line.length > 0) {
      segmentUrls.push(new URL(line, baseUrl).href);
    }
  }

  if (segmentUrls.length === 0) {
    const errorDetails = logError(METHOD, `No segments found in playlist`, {
      name: 'NoSegmentsError',
      message: 'Playlist parsing produced 0 segment URLs',
      stack: `Playlist lines: ${lines.length}\nBase URL: ${baseUrl}`
    });
    sendProgress(0, "Error: No segments found in playlist", errorDetails);
    return;
  }

  log(METHOD, `Playlist parsed`, { segmentCount: segmentUrls.length, hasInit: !!initSegmentUrl });
  sendProgress(5, `Found ${segmentUrls.length} segs`);

  // 세그먼트 도메인들에 대해 DNR 규칙 등록
  await registerSegmentDomains(segmentUrls, initSegmentUrl);

  const segments = [];
  let initSegmentData = null;
  let failedSegments = [];

  // Download init segment first if present (critical for fMP4)
  if (initSegmentUrl) {
    try {
      log(METHOD, `Downloading init segment...`);
      const initRes = await fetch(initSegmentUrl, buildFetchOptions(initSegmentUrl));
      if (initRes.ok) {
        initSegmentData = new Uint8Array(await initRes.arrayBuffer());
        log(METHOD, `Init segment downloaded`, { size: initSegmentData.byteLength });
      } else {
        logError(METHOD, `Init segment fetch failed`, {
          name: 'InitSegmentError',
          message: `HTTP ${initRes.status} ${initRes.statusText}`,
          stack: `URL: ${initSegmentUrl}`
        });
      }
    } catch (e) {
      logError(METHOD, `Init segment network error`, e);
    }
  }

  let downloaded = 0;
  const total = segmentUrls.length;

  for (let i = 0; i < segmentUrls.length; i++) {
    const url = segmentUrls[i];
    try {
      const res = await fetch(url, buildFetchOptions(url));
      if (!res.ok) {
        failedSegments.push({ index: i, url, status: res.status, statusText: res.statusText });
        logError(METHOD, `Segment ${i} fetch failed`, {
          name: 'SegmentFetchError',
          message: `HTTP ${res.status} ${res.statusText}`,
          stack: `URL: ${url}\nIndex: ${i}/${total}`
        });
        continue;
      }
      const buffer = await res.arrayBuffer();
      segments.push(new Uint8Array(buffer));
      downloaded++;

      const percent = 5 + Math.round((downloaded / total) * 85);
      sendProgress(percent, `Downloading ${downloaded}/${total}`);
    } catch (e) {
      failedSegments.push({ index: i, url, error: e.message });
      logError(METHOD, `Segment ${i} network error`, e);
    }
  }

  log(METHOD, `Segment download summary`, {
    downloaded: segments.length,
    total: total,
    failed: failedSegments.length
  });

  if (segments.length === 0) {
    const errorDetails = logError(METHOD, `All segments failed to download`, {
      name: 'AllSegmentsFailedError',
      message: `0/${total} segments downloaded successfully`,
      stack: `First 5 failures: ${JSON.stringify(failedSegments.slice(0, 5))}`
    });
    sendProgress(0, "Error: All segments failed to download", errorDetails);
    return;
  }

  sendProgress(90, "Merging...");

  let finalBlob = null;
  let ext = 'mp4';

  // Detect format: check first segment header
  const firstSegment = segments[0];
  const isTsFormat = firstSegment[0] === 0x47; // TS sync byte
  const isFmp4Format = initSegmentData ||
    (firstSegment[4] === 0x73 && firstSegment[5] === 0x74 && firstSegment[6] === 0x79 && firstSegment[7] === 0x70) || // styp
    (firstSegment[4] === 0x6D && firstSegment[5] === 0x6F && firstSegment[6] === 0x6F && firstSegment[7] === 0x66);   // moof

  log(METHOD, `Format detection`, {
    isTsFormat,
    isFmp4Format,
    firstBytes: Array.from(firstSegment.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')
  });

  if (isTsFormat) {
    log(METHOD, `Processing as MPEG-TS format...`);
    finalBlob = await transmuxTsSegments(segments);
    if (!finalBlob) {
      log(METHOD, `Transmux failed, saving as raw .ts`);
      ext = 'ts';
      finalBlob = new Blob(segments, { type: 'video/mp2t' });
    }
  } else if (isFmp4Format) {
    log(METHOD, `Processing as fMP4 format...`);
    const allParts = [];

    if (initSegmentData) {
      allParts.push(initSegmentData);
      log(METHOD, `Prepending init segment`);
    }

    for (const seg of segments) {
      allParts.push(seg);
    }

    finalBlob = new Blob(allParts, { type: 'video/mp4' });
  } else {
    log(METHOD, `Unknown format, attempting raw concat`);
    finalBlob = new Blob(segments, { type: 'video/mp4' });
  }

  if (!finalBlob || finalBlob.size === 0) {
    const errorDetails = logError(METHOD, `Final output is empty`, {
      name: 'EmptyOutputError',
      message: 'Merged file has 0 bytes',
      stack: `Segments: ${segments.length}, Init: ${!!initSegmentData}, Format: ${isTsFormat ? 'TS' : isFmp4Format ? 'fMP4' : 'Unknown'}`
    });
    sendProgress(0, "Error: Output file is 0 bytes", errorDetails);
    return;
  }

  sendProgress(100, "Saving...");
  log(METHOD, `Download completed successfully`, {
    filename: `${filename}.${ext}`,
    size: finalBlob.size,
    format: ext,
    failedSegments: failedSegments.length
  });

  const blobUrl = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `${filename}.${ext}`;
  a.click();

  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
