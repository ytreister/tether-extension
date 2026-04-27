const toggle = document.getElementById('auto-tether-toggle') as HTMLInputElement;

chrome.storage.local.get('autoTetherDrags').then(result => {
  toggle.checked = (result['autoTetherDrags'] as boolean) ?? false;
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ autoTetherDrags: toggle.checked });
});
