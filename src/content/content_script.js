// Content Script to parse page metadata

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageInfo") {
    // 1. Get Title
    const title = document.title || "Untitled Video";
    
    // 2. Find nearby H1 (optional heuristic)
    let h1 = "";
    const h1Tag = document.querySelector('h1');
    if (h1Tag) h1 = h1Tag.innerText;

    sendResponse({ 
      title: title.trim(),
      h1: h1.trim()
    });
  }
});
