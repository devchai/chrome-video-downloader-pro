# Chrome Web Store 등록 자료 (Store Listing Assets)

## 1. 텍스트 정보 (Text Assets)

### 제품 이름 (Name)
* **English:** Video Downloader Pro - HLS & MP4 Saver
* **Korean:** 동영상 다운로더 프로 - HLS, MP4, M3U8 저장

### 요약 (Summary)
* **English:** Detect and download videos from any website. Supports MP4, WEBM, and converts HLS (m3u8) streams directly to MP4.
* **Korean:** 웹사이트의 모든 동영상을 감지하고 다운로드하세요. MP4, WEBM은 물론 HLS(m3u8) 스트리밍도 MP4로 변환하여 저장합니다.

### 상세 설명 (Description)

**[English]**
The ultimate Video Downloader for Chrome. Detect, process, and save videos from your favorite websites with a single click.

Unlike standard downloaders, "Video Downloader Pro" includes a powerful engine to handle streaming videos (HLS/m3u8) and convert them instantly to MP4 files without leaving your browser.

🚀 **Key Features:**
*   **Universal Support:** Works with MP4, WEBM, MOV, and more.
*   **HLS Streaming Support:** Detects m3u8 playlists, downloads segments, and merges them into a single MP4 file automatically.
*   **Smart Detection:** Sniffs media traffic to find videos that other extensions miss.
*   **Instant Preview:** Check video size and format before downloading.
*   **Fast & Private:** All processing happens locally in your browser. No data is sent to external servers.

💡 **How to use:**
1.  Play the video on the webpage.
2.  The extension icon badge will update when a video is detected.
3.  Click the icon and hit the "Download" button.
4.  For streams, watch the progress bar as it saves directly to your disk.

⚠️ **Important Note:**
Due to Chrome Web Store policies, downloading from YouTube is NOT supported. Please respect copyright laws and content policies of the websites you visit.

---

**[Korean]**
크롬을 위한 최고의 동영상 다운로더입니다. 클릭 한 번으로 웹사이트의 동영상을 감지하고 저장하세요.

일반적인 다운로더와 달리, "동영상 다운로더 프로"는 스트리밍 영상(HLS/m3u8)을 자동으로 감지하고, 별도 변환 과정 없이 즉시 MP4 파일로 병합하여 저장하는 강력한 엔진을 탑재하고 있습니다.

🚀 **주요 기능:**
*   **범용 지원:** MP4, WEBM, MOV 등 일반적인 비디오 형식을 지원합니다.
*   **HLS 스트리밍 지원:** 복잡한 m3u8 재생 목록을 감지하고, 자동으로 하나의 MP4 파일로 변환하여 저장합니다.
*   **스마트 감지:** 네트워크 트래픽을 분석하여 숨겨진 비디오 소스까지 찾아냅니다.
*   **즉시 미리보기:** 다운로드 전 파일 크기와 형식을 확인할 수 있습니다.
*   **빠르고 안전함:** 모든 처리는 브라우저 내부에서 이루어지며, 외부 서버로 데이터를 전송하지 않습니다.

💡 **사용 방법:**
1.  웹페이지에서 동영상을 재생하세요.
2.  영상이 감지되면 확장 프로그램 아이콘에 숫자가 표시됩니다.
3.  아이콘을 클릭하고 원하는 영상의 "다운로드" 버튼을 누르세요.
4.  스트리밍 영상의 경우, 진행률 표시줄과 함께 자동으로 변환 및 저장이 완료됩니다.

⚠️ **중요 알림:**
Chrome 웹 스토어 정책에 따라 YouTube 다운로드는 지원하지 않습니다. 방문하는 웹사이트의 저작권 및 콘텐츠 정책을 준수해 주세요.

---

## 2. 개인정보 처리방침 설정 (Privacy)

### 권한 정당화 (Permission Justification)
*   **Host Permissions (`<all_urls>`):**
    The extension needs access to all URLs to sniff network traffic and detect media files (MP4, M3U8) initiating from any website the user visits.
*   **Web Request (`webRequest`):**
    Used to intercept HTTP headers and identify video content types.
*   **Storage (`storage`):**
    Used to save user preferences.
*   **Declarative Net Request (`declarativeNetRequest`):**
    Used to modify Referer headers to allow downloads from sites that block direct hotlinking.

### 데이터 사용 (Data Usage)
*   **Does this extension collect user data?** No
*   **Certification:** The developer declares that your data is not sold to third parties, not used for unrelated purposes, and not used for credit checks.

---

## 3. 카테고리 (Category)
*   **Primary Category:** Productivity
*   **Rating:** Mature (No special restrictions)
