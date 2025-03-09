// contentScript.js - Runs in the context of web pages

// Global variables
let factCheckerEnabled = true;
let sensitivity = 'medium';
let autoScan = true;
let highlightedElements = [];
let tooltipElement = null;
let scanInProgress = false;

// Initialize when content script loads
initialize();

// This checks if the current page is Google (e.g., google.com) and applies styles conditionally
if (window.location.hostname.includes('google.com')) {
    const style = document.createElement('style');
    style.textContent = `
      /* Only target Google-specific elements */
      #gb > div.gb_Bc { position: relative !important; margin-left: 10px !important; }
      #gb > div.gb_fa { position: relative !important; margin-left: 10px !important; }
    `;
    document.head.appendChild(style);
} else {
    // Reset any changes made on non-Google pages
    const style = document.createElement('style');
    style.textContent = `
    body { overflow-x: auto !important; margin-left: 0 !important; }
    `;
    document.head.appendChild(style);
}
  
function restorePageInteraction() {
    console.log("Restoring page interaction...");
  
    // Only affect page content, not the entire Chrome browser UI
  
    // 1. Reset any overflow issues on the document body and html, which should be in the page, not browser
    const body = document.body;
    body.style.overflow = 'auto';  // Allow scrolling
    body.style.position = '';     // Remove fixed positioning
    
    const htmlElement = document.documentElement;
    htmlElement.style.overflow = 'auto'; // Allow scrolling on the HTML element
    htmlElement.style.position = '';     // Remove any position changes
  
    // 2. Reset any global styles on all elements
    const allElements = document.querySelectorAll('*');
    allElements.forEach(element => {
        element.style.position = '';    // Reset position
        element.style.overflow = '';    // Reset overflow
        element.style.zIndex = '';      // Reset z-index (to avoid modals or overlays)
        element.style.visibility = '';  // Reset visibility
    });
  
    // 3. Remove any overlays that might be blocking interactions
    const overlays = document.querySelectorAll('.overlay, .blocking-element');  // Update class names if needed
    overlays.forEach(overlay => {
        overlay.remove(); // Remove any blocking elements
    });
  
    // 4. Ensure no event listeners are blocking the scroll
    const elements = [body, htmlElement, ...allElements];
    elements.forEach(element => {
        const clonedElement = element.cloneNode(true); // Clone element to bypass event listeners
        element.parentNode.replaceChild(clonedElement, element); // Replace original with cloned
    });
  
    console.log("Page interaction fully restored");
}  
  

function initialize() {
  // Get settings from storage
  chrome.storage.local.get(['enabled', 'sensitivity', 'autoScan'], (result) => {
    factCheckerEnabled = result.enabled !== undefined ? result.enabled : true;
    sensitivity = result.sensitivity || 'medium';
    autoScan = result.autoScan !== undefined ? result.autoScan : true;
    
    // If auto-scan is enabled, scan the page after it loads
    if (factCheckerEnabled && autoScan) {
      // Wait for page to fully load
      if (document.readyState === 'complete') {
        scanPage();
      } else {
        window.addEventListener('load', scanPage);
      }
    }
    
    // Create tooltip element (hidden initially)
    createTooltip();
  });
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scanPage" && factCheckerEnabled) {
      scanPage();
      sendResponse({ status: "scanning" });
    }
    
    if (message.action === "clearHighlights") {
      clearHighlights();
      sendResponse({ status: "cleared" });
    }
    
    if (message.action === "updateSettings") {
      factCheckerEnabled = message.enabled;
      sensitivity = message.sensitivity;
      autoScan = message.autoScan;
      
      if (!factCheckerEnabled) {
        clearHighlights();
      } else if (factCheckerEnabled && message.rescan) {
        scanPage();
      }
      
      sendResponse({ status: "updated" });
    }
  });
}

function createTooltip() {
  // Create tooltip element for showing fact-check results
  tooltipElement = document.createElement('div');
  tooltipElement.className = 'ai-fact-checker-tooltip';
  tooltipElement.style.display = 'none';
  document.body.appendChild(tooltipElement);
}

function scanPage() {
    if (scanInProgress || !factCheckerEnabled) return;
    
    scanInProgress = true;
    console.log("AI Fact Checker: Scanning page...");
    
    // Clear any existing highlights
    clearHighlights();
    
    // Get all text-containing elements
    const textElements = getTextElements();
    
    console.log('Text Elements:', textElements); // Debugging text elements
    
    let processedCount = 0;
    let highlightedElements = []; // Define highlighted elements
    
    // Send status update to popup
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ 
          action: "scanStatus", 
          status: "started", 
          total: textElements.length
        });
      }
    } catch (error) {
      console.log('Extension context invalidated while sending scanStatus message');
      scanInProgress = false;
      return;
    }
    
    // Process elements in batches to avoid freezing the page
    processBatch(textElements, 0, 10);
    
    function processBatch(elements, startIndex, batchSize) {
      const endIndex = Math.min(startIndex + batchSize, elements.length);
      
      console.log('Processing batch from index', startIndex, 'to', endIndex); // Debugging batch processing
      
      for (let i = startIndex; i < endIndex; i++) {
        const element = elements[i];
        checkElement(element);
        processedCount++;
        
        // Update progress every 10 elements
        if (processedCount % 10 === 0) {
          try {
            if (chrome.runtime && chrome.runtime.id) {
              chrome.runtime.sendMessage({ 
                action: "scanProgress", 
                processed: processedCount, 
                total: elements.length
              });
            }
          } catch (error) {
            console.log('Extension context invalidated while sending progress update');
            scanInProgress = false;
            return;
          }
        }
      }
      
      // If there are more elements, process the next batch
      if (endIndex < elements.length) {
        setTimeout(() => {
          processBatch(elements, endIndex, batchSize);
        }, 0);
      } else {
        // Finished scanning
        scanInProgress = false;
        
        try {
          if (chrome.runtime && chrome.runtime.id) {
            chrome.runtime.sendMessage({ 
              action: "scanStatus", 
              status: "completed", 
              highlightCount: highlightedElements.length
            });
          }
        } catch (error) {
          console.log('Extension context invalidated while sending completion status');
          return;
        }
        
        // Save scan history
        const scanResult = {
          url: window.location.href,
          timestamp: new Date().toISOString(),
          highlightCount: highlightedElements.length
        };
        
        try {
          chrome.storage.local.get(['scanHistory'], (result) => {
            const history = result.scanHistory || [];
            history.unshift(scanResult);
            // Keep only last 100 scans
            if (history.length > 100) history.pop();
            
            chrome.storage.local.set({ scanHistory: history, lastScanTime: scanResult.timestamp });
          });
        } catch (error) {
          console.log('Error accessing chrome storage:', error);
        }
      }
    }
  }  

function getTextElements() {
  // Get paragraphs, headings, and list items
  const selectors = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'];
  let elements = [];
  
  selectors.forEach(selector => {
    elements = elements.concat(Array.from(document.querySelectorAll(selector)));
  });
  
  // Filter to only elements with enough text content to analyze
  return elements.filter(element => {
    const text = element.textContent.trim();
    return text.length > 20 && text.split(' ').length > 5;
  });
}

function checkElement(element) {
  // Skip if already processed
  if (element.dataset.factChecked === 'true') return;
  
  const text = element.textContent.trim();
  
  // Send text to background script for fact checking with error handling
  try {
    // Check if runtime is available before sending message
    if (chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage({ action: "factCheck", text: text }, (result) => {
        if (!result) return; // Handle potential messaging errors
        
        // Mark as processed
        element.dataset.factChecked = 'true';
        
        // Determine if we should highlight based on sensitivity setting
        let shouldHighlight = false;
        
        if (sensitivity === 'high') {
          shouldHighlight = result.confidenceScore < 0.7;
        } else if (sensitivity === 'medium') {
          shouldHighlight = result.confidenceScore < 0.5;
        } else { // low
          shouldHighlight = result.confidenceScore < 0.3;
        }
        
        if (result.isMisleading && shouldHighlight) {
          // Add to highlighted elements list
          highlightedElements.push({
            element: element,
            result: result
          });
          
          // Add highlight class
          element.classList.add('ai-fact-checker-highlight');
          
          // Store fact check data
          element.dataset.factCheckResult = JSON.stringify(result);
          
          // Add event listeners
          element.addEventListener('mouseenter', showTooltip);
          element.addEventListener('mouseleave', hideTooltip);
        }
      });
    } else {
      console.log('Extension context is no longer valid');
    }
  } catch (error) {
    if (error.message.includes('Extension context invalidated')) {
      console.log('Extension context was invalidated. The extension may have been updated, reloaded, or disabled.');
    } else {
      console.error('Error sending message:', error);
    }
  }
}

function showTooltip(event) {
  const element = event.target;
  const resultData = JSON.parse(element.dataset.factCheckResult);
  
  // Format confidence as percentage
  const confidencePercent = Math.round((1 - resultData.confidenceScore) * 100);
  
  // Set tooltip content
  tooltipElement.innerHTML = `
    <div class="ai-fact-checker-tooltip-header">
      <span class="ai-fact-checker-tooltip-title">AI Fact Checker</span>
      <span class="ai-fact-checker-tooltip-confidence ${getConfidenceClass(resultData.confidenceScore)}">
        ${confidencePercent}% confidence this may be misleading
      </span>
    </div>
    <div class="ai-fact-checker-tooltip-content">
      ${resultData.explanation.replace(/\n/g, '<br>')}
      
      ${resultData.corrections ? 
        `<p><strong>Factual Corrections:</strong><br>${resultData.corrections.replace(/\n/g, '<br>')}</p>` 
        : ''}
      
      ${resultData.source ? 
        `<p class="ai-fact-checker-source"><a href="${resultData.source}" target="_blank">View Source</a></p>` 
        : ''}
    </div>
    <div class="ai-fact-checker-tooltip-footer">
      <small>Analysis by: ${resultData.apiSource || 'AI Fact Checker'} | Results may not be 100% accurate.</small>
    </div>
  `;
  
  // Position tooltip near the element
  const rect = element.getBoundingClientRect();
  tooltipElement.style.top = `${window.scrollY + rect.bottom + 5}px`;
  tooltipElement.style.left = `${window.scrollX + rect.left}px`;
  tooltipElement.style.maxWidth = `${Math.min(500, window.innerWidth - 40)}px`;
  
  // Show tooltip
  tooltipElement.style.display = 'block';
}

function hideTooltip() {
  tooltipElement.style.display = 'none';
}

function getConfidenceClass(score) {
  if (score < 0.3) return 'high-confidence';
  if (score < 0.7) return 'medium-confidence';
  return 'low-confidence';
}

function clearHighlights() {
  // Remove highlight classes and event listeners
  highlightedElements.forEach(item => {
    item.element.classList.remove('ai-fact-checker-highlight');
    item.element.removeEventListener('mouseenter', showTooltip);
    item.element.removeEventListener('mouseleave', hideTooltip);
  });
  
  // Clear the array
  highlightedElements = [];
  
  // Hide tooltip if visible
  tooltipElement.style.display = 'none';
}
