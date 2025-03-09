// popup.js - Handles the extension popup UI

// Get DOM elements
const enableToggle = document.getElementById('enableToggle');
const statusText = document.getElementById('statusText');
const scanButton = document.getElementById('scanButton');
const clearHighlightsButton = document.getElementById('clearHighlightsButton');
const scanStatus = document.getElementById('scanStatus');
const sensitivitySelect = document.getElementById('sensitivitySelect');
const autoScanToggle = document.getElementById('autoScanToggle');
const lastScanTime = document.getElementById('lastScanTime');
const flaggedCount = document.getElementById('flaggedCount');
const showMainButton = document.getElementById('showMainButton');
const showHistoryButton = document.getElementById('showHistoryButton');
const mainContent = document.getElementById('mainContent');
const historyContent = document.getElementById('historyContent');
const historyList = document.getElementById('historyList');

// Initialize popup
document.addEventListener('DOMContentLoaded', initialize);

function initialize() {
  // Load settings
  loadSettings();
  
  // Load statistics
  loadStatistics();
  
  // Set up event listeners
  enableToggle.addEventListener('change', toggleEnabled);
  scanButton.addEventListener('click', startScan);
  clearHighlightsButton.addEventListener('click', clearHighlights);
  sensitivitySelect.addEventListener('change', updateSettings);
  autoScanToggle.addEventListener('change', updateSettings);
  showMainButton.addEventListener('click', showMainView);
  showHistoryButton.addEventListener('click', showHistoryView);
  
  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scanStatus") {
      updateScanStatus(message);
    }
    
    if (message.action === "scanProgress") {
      updateScanProgress(message);
    }
  });
}

function loadSettings() {
  chrome.storage.local.get(['enabled', 'sensitivity', 'autoScan'], (result) => {
    // Extension enabled/disabled
    enableToggle.checked = result.enabled !== undefined ? result.enabled : true;
    statusText.textContent = enableToggle.checked ? 'Enabled' : 'Disabled';
    scanButton.disabled = !enableToggle.checked;
    
    // Sensitivity
    sensitivitySelect.value = result.sensitivity || 'medium';
    
    // Auto-scan
    autoScanToggle.checked = result.autoScan !== undefined ? result.autoScan : true;
  });
}

function loadStatistics() {
  chrome.storage.local.get(['lastScanTime', 'scanHistory'], (result) => {
    // Last scan time
    if (result.lastScanTime) {
      const scanDate = new Date(result.lastScanTime);
      lastScanTime.textContent = formatTimeAgo(scanDate);
    } else {
      lastScanTime.textContent = 'Never';
    }
    
    // Load history
    if (result.scanHistory && result.scanHistory.length > 0) {
      populateHistoryList(result.scanHistory);
      
      // Get flagged count from latest scan
      const latestScan = result.scanHistory[0];
      flaggedCount.textContent = latestScan.highlightCount || '0';
    } else {
      flaggedCount.textContent = '0';
    }
  });
}

function populateHistoryList(history) {
  historyList.innerHTML = '';
  
  if (history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No scan history yet</div>';
    return;
  }
  
  // Create history items
  history.forEach(scan => {
    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    
    const scanDate = new Date(scan.timestamp);
    const dateFormatted = scanDate.toLocaleDateString();
    const timeFormatted = scanDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    historyItem.innerHTML = `
      <div class="history-item-header">
        <span class="history-date">${dateFormatted} ${timeFormatted}</span>
        <span class="history-count">${scan.highlightCount || 0} flagged</span>
      </div>
      <div class="history-url" title="${scan.url}">${formatUrl(scan.url)}</div>
    `;
    
    historyList.appendChild(historyItem);
  });
}

function formatUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname + urlObj.pathname.substring(0, 20) + (urlObj.pathname.length > 20 ? '...' : '');
  } catch (e) {
    return url.substring(0, 30) + (url.length > 30 ? '...' : '');
  }
}

function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffDay > 0) {
    return diffDay === 1 ? '1 day ago' : `${diffDay} days ago`;
  }
  
  if (diffHour > 0) {
    return diffHour === 1 ? '1 hour ago' : `${diffHour} hours ago`;
  }
  
  if (diffMin > 0) {
    return diffMin === 1 ? '1 minute ago' : `${diffMin} minutes ago`;
  }
  
  return 'Just now';
}

function toggleEnabled() {
  const enabled = enableToggle.checked;
  statusText.textContent = enabled ? 'Enabled' : 'Disabled';
  scanButton.disabled = !enabled;
  
  // Save setting
  chrome.storage.local.set({ enabled: enabled });
  
  // Update content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { 
        action: "updateSettings", 
        enabled: enabled
      });
    }
  });
}

function updateSettings() {
  const sensitivity = sensitivitySelect.value;
  const autoScan = autoScanToggle.checked;
  
  // Save settings
  chrome.storage.local.set({ 
    sensitivity: sensitivity,
    autoScan: autoScan
  });
  
  // Update content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { 
        action: "updateSettings", 
        sensitivity: sensitivity,
        autoScan: autoScan,
        enabled: enableToggle.checked,
        rescan: true
      });
    }
  });
}

function startScan() {
  // Disable button during scan
  scanButton.disabled = true;
  scanStatus.textContent = 'Scanning...';
  
  // Send message to start scan
  chrome.runtime.sendMessage({ action: "startScan" }, (response) => {
    if (response && response.status === "scanning") {
      console.log("Scan started");
    }
  });
}

function clearHighlights() {
  // Send message to clear highlights
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "clearHighlights" });
    }
  });
}

function updateScanStatus(message) {
  if (message.status === "started") {
    scanStatus.textContent = `Scanning ${message.total} elements...`;
  } else if (message.status === "completed") {
    scanStatus.textContent = `Scan complete: ${message.highlightCount} potentially misleading claims found`;
    scanButton.disabled = false;
    
    // Update flagged count
    flaggedCount.textContent = message.highlightCount;
    
    // Reload statistics
    loadStatistics();
  }
}

function updateScanProgress(message) {
  const percent = Math.round((message.processed / message.total) * 100);
  scanStatus.textContent = `Scanning: ${percent}% complete`;
}

function showMainView() {
  mainContent.classList.remove('hidden');
  historyContent.classList.add('hidden');
  showMainButton.classList.add('active');
  showHistoryButton.classList.remove('active');
}

function showHistoryView() {
  mainContent.classList.add('hidden');
  historyContent.classList.remove('hidden');
  showMainButton.classList.remove('active');
  showHistoryButton.classList.add('active');
  
  // Reload history data
  chrome.storage.local.get(['scanHistory'], (result) => {
    populateHistoryList(result.scanHistory || []);
  });
}