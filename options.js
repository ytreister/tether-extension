"use strict";
const toggle = document.getElementById('auto-tether-toggle');
chrome.storage.local.get('autoTetherDrags').then(result => {
    toggle.checked = result['autoTetherDrags'] ?? false;
});
toggle.addEventListener('change', () => {
    chrome.storage.local.set({ autoTetherDrags: toggle.checked });
});
