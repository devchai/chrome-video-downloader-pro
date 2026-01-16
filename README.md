# Chrome Video Downloader Pro

A powerful Chrome Extension that detects and downloads videos from web pages, including support for standard formats (MP4, WEBM) and streaming protocols (HLS/M3U8).

## 🚀 Features

- **Advanced Detection**: Uses network traffic sniffing to find videos that other downloaders miss.
- **HLS Support**: Downloads `.m3u8` streams, merges `.ts` segments, and converts them to `.mp4` directly in the browser (using `mux.js`).
- **Smart Naming**: Automatically infers filenames from page titles or H1 tags.
- **YouTube Safety**: Built-in blocking logic for YouTube to comply with Chrome Web Store policies.
- **Modern UI**: Clean, Dark Mode aesthetics with Glassmorphism design.

## 🛠 Installation

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the root directory of this project (`chrome_video_downloader`).
5. The extension icon should appear in your toolbar.

## 📖 How to Use

1. **Browse**: Go to any website with video content (e.g., Vimeo, DailyMotion, or generic news sites).
2. **Play**: Start playing the video. The extension detects media network requests.
3. **Check Badge**: The extension icon will show a number indicating detected videos.
4. **Download**:
   - Click the extension icon to open the popup.
   - You will see a list of detected videos with their format and size.
   - Click the **Download** button.
   - **For MP4**: The file will download immediately.
   - **For HLS (M3U8)**: You will see a progress indicator (%) as it downloads segments and merges them. Once complete, the browser will save the final MP4 file.

## 🏗 Technical Architecture

- **Manifest V3**: Compliant with the latest Chrome Extension standards.
- **Service Worker (`background.js`)**: Handles network request sniffing (`chrome.webRequest`).
- **Offscreen Document**: Processes HLS streams in a hidden window to prevent main thread freezing.
- **Content Script**: Extracts page metadata for better filenames.
- **Libraries**: Uses `mux.js` for TS-to-MP4 transmuxing.

## ⚠️ Notes

- **YouTube**: Downloads from YouTube are intentionally disabled to comply with policies.
- **Large Files**: HLS merging happens in-memory. Very large streams (1GB+) might cause browser memory pressure.

## License

MIT License
