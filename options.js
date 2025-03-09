document.addEventListener("DOMContentLoaded", function () {
    chrome.storage.local.get(["openaiApiKey", "googleApiKey"], function (result) {
      document.getElementById("openaiApiKey").value = result.openaiApiKey || "";
      document.getElementById("googleApiKey").value = result.googleApiKey || "";
    });
  
    document.getElementById("save").addEventListener("click", function () {
      const openaiKey = document.getElementById("openaiApiKey").value;
      const googleKey = document.getElementById("googleApiKey").value;
  
      chrome.storage.local.set({ openaiApiKey: openaiKey, googleApiKey: googleKey }, function () {
        document.getElementById("status").textContent = "API keys saved!";
        setTimeout(() => document.getElementById("status").textContent = "", 2000);
      });
    });
  });
  