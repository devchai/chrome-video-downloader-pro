// Offscreen Document for HLS & Direct Processing

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "processHLS") {
    processHLS(request.url, request.filename);
  } else if (request.action === "downloadDirect") {
    processDirectDownload(request.url, request.filename);
  }
});

function sendProgress(percent, status) {
  chrome.runtime.sendMessage({
    action: "downloadProgress",
    percent: percent,
    status: status
  });
}

async function processDirectDownload(url, filename) {
  console.log(`[Offscreen] Direct download: ${url}`);
  sendProgress(10, "Starting...");
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const blob = await response.blob();
    
    if (blob.size === 0) throw new Error("0 Bytes Received");

    sendProgress(100, "Saving...");
    
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${filename}.mp4`;
    a.click();
    
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    
  } catch (error) {
    console.error("Direct download failed:", error);
    sendProgress(0, "Error: " + error.message);
  }
}

async function processHLS(masterUrl, filename) {
  console.log(`[Offscreen] Starting HLS: ${masterUrl}`);
  sendProgress(0, "Fetching Playlist...");
  
  try {
    const response = await fetch(masterUrl);
    if (!response.ok) throw new Error(`Playlist HTTP ${response.status}`);
    
    const text = await response.text();
    
    let mediaPlaylistUrl = masterUrl;
    
    if (text.includes('#EXT-X-STREAM-INF')) {
      const lines = text.split('\n');
      let bestBandwidth = 0;
      let bestUrl = '';
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('BANDWIDTH')) {
          const bandwidthMatch = lines[i].match(/BANDWIDTH=(\d+)/);
          const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;
          if (bandwidth > bestBandwidth && lines[i+1] && !lines[i+1].startsWith('#')) {
            bestBandwidth = bandwidth;
            bestUrl = lines[i+1];
          }
        }
      }
      
      if (bestUrl) {
        mediaPlaylistUrl = new URL(bestUrl, masterUrl).href;
        const mediaResponse = await fetch(mediaPlaylistUrl);
        if (!mediaResponse.ok) throw new Error(`Media Playlist HTTP ${mediaResponse.status}`);
        const mediaText = await mediaResponse.text();
        await downloadSegments(mediaText, mediaPlaylistUrl, filename);
      } else {
        await downloadSegments(text, masterUrl, filename);
      }
    } else {
      await downloadSegments(text, masterUrl, filename);
    }
    
  } catch (error) {
    console.error('[Offscreen] Error processing HLS:', error);
    sendProgress(0, "Error: " + error.message);
  }
}

async function downloadSegments(playlistText, baseUrl, filename) {
  const lines = playlistText.split('\n');
  const segmentUrls = [];
  
  for (const line of lines) {
    if (line && !line.trim().startsWith('#') && line.trim().length > 0) {
      segmentUrls.push(new URL(line.trim(), baseUrl).href);
    }
  }

  if (segmentUrls.length === 0) {
    sendProgress(0, "Error: No segments found");
    return;
  }

  sendProgress(5, `Found ${segmentUrls.length} segs`);
  
  const segments = [];
  let downloaded = 0;
  const total = segmentUrls.length;

  for (const url of segmentUrls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
         console.warn(`Failed segment ${res.status}: ${url}`);
         continue; // Try next segment
      }
      const buffer = await res.arrayBuffer();
      segments.push(new Uint8Array(buffer));
      downloaded++;
      
      const percent = 5 + Math.round((downloaded / total) * 85); 
      sendProgress(percent, `Downloading ${downloaded}/${total}`);
    } catch (e) {
      console.error('Failed segment', url);
    }
  }

  if (segments.length === 0) {
    sendProgress(0, "Error: All segments failed");
    return;
  }

  sendProgress(90, "Merging...");
  
  let finalBlob = null;
  let ext = 'mp4';
  
  try {
    // Twitter/X uses init segments (fMP4) which mux.js handles differently
    // We try mux.js first
    const transmuxer = new muxjs.mp4.Transmuxer();
    const combinedData = [];
    
    transmuxer.on('data', (segment) => {
      const data = new Uint8Array(segment.initSegment.byteLength + segment.data.byteLength);
      data.set(segment.initSegment, 0);
      data.set(segment.data, segment.initSegment.byteLength);
      combinedData.push(data);
    });

    for (const segment of segments) {
      transmuxer.push(segment);
      transmuxer.flush();
    }
    
    if (combinedData.length > 0) {
      finalBlob = new Blob(combinedData, { type: 'video/mp4' });
    } else {
      throw new Error("No data from mux.js");
    }
  } catch (e) {
    console.warn("Transmux failed, fallback to TS/Raw", e);
    
    // Check if it is fMP4 (starts with ftyp or moof)
    // If so, simple concat works
    ext = 'mp4'; 
    finalBlob = new Blob(segments, { type: 'video/mp4' });
  }

  if (!finalBlob || finalBlob.size === 0) {
    sendProgress(0, "Error: 0 Bytes");
    return;
  }

  sendProgress(100, "Saving...");
  
  const blobUrl = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `${filename}.${ext}`;
  a.click();
  
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
