// background.js - Handles API communication and other background tasks securely

// Fetch API keys from Chrome storage
async function getApiKeys() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['openaiApiKey', 'googleApiKey'], (result) => {
      resolve({
        openaiApiKey: result.openaiApiKey || '',
        googleApiKey: result.googleApiKey || ''
      });
    });
  });
}

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "factCheck") {
    performFactCheck(message.text)
      .then(result => sendResponse(result))
      .catch(error => {
        console.error("Fact check error:", error);
        sendResponse({ error: "Failed to perform fact check" });
      });

    return true; // Required for async response
  }
});

// Perform fact-checking
async function performFactCheck(text) {
  const apiKeys = await getApiKeys();

  if (!apiKeys.openaiApiKey || !apiKeys.googleApiKey) {
    return { error: "API keys are missing. Please set them in extension settings." };
  }

  const googleResult = await checkGoogleFactCheck(text, apiKeys.googleApiKey);

  if (googleResult.matches.length > 0) {
    return formatGoogleResult(googleResult);
  }

  return analyzeWithAI(text, apiKeys.openaiApiKey);
}

// Google Fact Check API
async function checkGoogleFactCheck(text, apiKey) {
  try {
    const response = await fetch(`https://factchecktools.googleapis.com/v1alpha1/claims:search?key=${apiKey}&query=${encodeURIComponent(text)}`);
    if (!response.ok) throw new Error(`Google API error: ${response.status}`);

    const data = await response.json();
    return { matches: data.claims || [], originalText: text };
  } catch (error) {
    console.error("Google Fact Check API error:", error);
    return { matches: [], error: error.message };
  }
}

// Format Google Fact Check result
function formatGoogleResult(result) {
  if (result.matches.length > 0) {
    const factCheck = result.matches[0];
    return {
      isMisleading: factCheck.claimReview[0].textualRating.toLowerCase().includes("false"),
      explanation: `Fact checked by ${factCheck.claimReview[0].publisher.name}: "${factCheck.claimReview[0].textualRating}"`,
      source: factCheck.claimReview[0].url,
      apiSource: "Google Fact Check Tools"
    };
  }
  return { isMisleading: false, explanation: "No fact checks found.", apiSource: "Google Fact Check Tools" };
}

// OpenAI Fact Check Analysis
async function analyzeWithAI(text, apiKey) {
  try {
    const prompt = `Analyze this text for misinformation: "${text}"`;
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3
      })
    });

    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

    const data = await response.json();
    return { explanation: data.choices[0].message.content, apiSource: "OpenAI GPT-3.5" };
  } catch (error) {
    console.error("OpenAI API error:", error);
    return { isMisleading: false, explanation: "AI analysis failed.", apiSource: "OpenAI" };
  }
}
