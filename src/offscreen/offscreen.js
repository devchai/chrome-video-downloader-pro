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

    // Check if this is a master playlist (has variants)
    if (text.includes('#EXT-X-STREAM-INF')) {
      const { videoPlaylistUrl, audioPlaylistUrl } = parseMasterPlaylist(text, masterUrl);

      if (videoPlaylistUrl) {
        console.log('[Offscreen] Video playlist:', videoPlaylistUrl);
        console.log('[Offscreen] Audio playlist:', audioPlaylistUrl || 'embedded or none');

        const videoResponse = await fetch(videoPlaylistUrl);
        if (!videoResponse.ok) throw new Error(`Video Playlist HTTP ${videoResponse.status}`);
        const videoText = await videoResponse.text();

        let audioText = null;
        let audioBaseUrl = null;
        if (audioPlaylistUrl) {
          const audioResponse = await fetch(audioPlaylistUrl);
          if (audioResponse.ok) {
            audioText = await audioResponse.text();
            audioBaseUrl = audioPlaylistUrl;
            console.log('[Offscreen] Audio playlist fetched successfully');
          }
        }

        await downloadSegmentsWithAudio(videoText, videoPlaylistUrl, audioText, audioBaseUrl, filename);
      } else {
        await downloadSegments(text, masterUrl, filename);
      }
    } else {
      // Single media playlist (video+audio combined or video-only)
      await downloadSegments(text, masterUrl, filename);
    }

  } catch (error) {
    console.error('[Offscreen] Error processing HLS:', error);
    sendProgress(0, "Error: " + error.message);
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
  sendProgress(5, "Parsing playlists...");

  // Parse video segments
  const videoData = parseMediaPlaylist(videoPlaylistText, videoBaseUrl);
  console.log(`[Offscreen] Video: ${videoData.segments.length} segments, init: ${!!videoData.initUrl}`);

  // Parse audio segments if available
  let audioData = null;
  if (audioPlaylistText) {
    audioData = parseMediaPlaylist(audioPlaylistText, audioBaseUrl);
    console.log(`[Offscreen] Audio: ${audioData.segments.length} segments, init: ${!!audioData.initUrl}`);
  }

  const totalSegments = videoData.segments.length + (audioData ? audioData.segments.length : 0);
  let downloaded = 0;

  // Download video init segment
  let videoInitData = null;
  if (videoData.initUrl) {
    try {
      const res = await fetch(videoData.initUrl);
      if (res.ok) videoInitData = new Uint8Array(await res.arrayBuffer());
    } catch (e) { console.error('Video init failed:', e); }
  }

  // Download audio init segment
  let audioInitData = null;
  if (audioData?.initUrl) {
    try {
      const res = await fetch(audioData.initUrl);
      if (res.ok) audioInitData = new Uint8Array(await res.arrayBuffer());
    } catch (e) { console.error('Audio init failed:', e); }
  }

  // Download video segments
  const videoSegments = [];
  for (const url of videoData.segments) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        videoSegments.push(new Uint8Array(await res.arrayBuffer()));
        downloaded++;
        sendProgress(5 + Math.round((downloaded / totalSegments) * 80), `Downloading ${downloaded}/${totalSegments}`);
      }
    } catch (e) { console.error('Video segment failed:', url); }
  }

  // Download audio segments
  const audioSegments = [];
  if (audioData) {
    for (const url of audioData.segments) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          audioSegments.push(new Uint8Array(await res.arrayBuffer()));
          downloaded++;
          sendProgress(5 + Math.round((downloaded / totalSegments) * 80), `Downloading ${downloaded}/${totalSegments}`);
        }
      } catch (e) { console.error('Audio segment failed:', url); }
    }
  }

  sendProgress(90, "Merging...");

  // Determine format and merge
  const firstVideoSeg = videoSegments[0];
  const isTsFormat = firstVideoSeg && firstVideoSeg[0] === 0x47;

  let finalBlob = null;
  let ext = 'mp4';

  if (isTsFormat) {
    // TS format: mux.js can handle video+audio in same segments
    finalBlob = await transmuxTsSegments([...videoSegments]);
    if (!finalBlob) {
      ext = 'ts';
      finalBlob = new Blob(videoSegments, { type: 'video/mp2t' });
    }
  } else {
    // fMP4 format: merge video and audio tracks
    finalBlob = mergeFmp4Tracks(videoInitData, videoSegments, audioInitData, audioSegments);
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
  try {
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
      return new Blob(combinedData, { type: 'video/mp4' });
    }
  } catch (e) {
    console.warn('[Offscreen] TS transmux failed:', e);
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
        console.log('[Offscreen] Found init segment:', initSegmentUrl);
      }
    }
    // Collect media segment URLs (non-comment, non-empty lines)
    else if (line && !line.startsWith('#') && line.length > 0) {
      segmentUrls.push(new URL(line, baseUrl).href);
    }
  }

  if (segmentUrls.length === 0) {
    sendProgress(0, "Error: No segments found");
    return;
  }

  sendProgress(5, `Found ${segmentUrls.length} segs`);

  const segments = [];
  let initSegmentData = null;

  // Download init segment first if present (critical for fMP4)
  if (initSegmentUrl) {
    try {
      console.log('[Offscreen] Downloading init segment...');
      const initRes = await fetch(initSegmentUrl);
      if (initRes.ok) {
        initSegmentData = new Uint8Array(await initRes.arrayBuffer());
        console.log('[Offscreen] Init segment size:', initSegmentData.byteLength);
      } else {
        console.warn('[Offscreen] Init segment failed:', initRes.status);
      }
    } catch (e) {
      console.error('[Offscreen] Init segment error:', e);
    }
  }

  let downloaded = 0;
  const total = segmentUrls.length;

  for (const url of segmentUrls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
         console.warn(`Failed segment ${res.status}: ${url}`);
         continue;
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

  // Detect format: check first segment header
  const firstSegment = segments[0];
  const isTsFormat = firstSegment[0] === 0x47; // TS sync byte
  const isFmp4Format = initSegmentData ||
    (firstSegment[4] === 0x73 && firstSegment[5] === 0x74 && firstSegment[6] === 0x79 && firstSegment[7] === 0x70) || // styp
    (firstSegment[4] === 0x6D && firstSegment[5] === 0x6F && firstSegment[6] === 0x6F && firstSegment[7] === 0x66);   // moof

  console.log('[Offscreen] Format detection - TS:', isTsFormat, 'fMP4:', isFmp4Format);

  if (isTsFormat) {
    // MPEG-TS format: use mux.js to transmux to MP4
    try {
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
      console.warn("[Offscreen] TS transmux failed, saving as .ts", e);
      ext = 'ts';
      finalBlob = new Blob(segments, { type: 'video/mp2t' });
    }
  } else if (isFmp4Format) {
    // fMP4 format: concatenate init segment + media segments
    const allParts = [];

    if (initSegmentData) {
      allParts.push(initSegmentData);
      console.log('[Offscreen] Prepending init segment');
    }

    for (const seg of segments) {
      allParts.push(seg);
    }

    finalBlob = new Blob(allParts, { type: 'video/mp4' });
  } else {
    // Unknown format: try raw concat
    console.warn('[Offscreen] Unknown format, attempting raw concat');
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
