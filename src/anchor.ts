async function init(): Promise<void> {
  const popupWindowId = parseInt(location.hash.slice(1), 10);
  if (!popupWindowId) {
    document.getElementById('title')!.textContent = '(invalid anchor)';
    return;
  }

  let state: PopupEntry | null = null;
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getState', popupWindowId });
    state = (response as { state: PopupEntry | null }).state ?? null;
  } catch {
    // Service worker not yet ready — rare on first load
  }

  if (!state) {
    document.getElementById('title')!.textContent = '(state unavailable)';
    return;
  }

  if (state.tabFavicon) {
    const img = document.getElementById('favicon') as HTMLImageElement;
    img.src = state.tabFavicon;
    img.style.display = 'block';
  }

  const title = state.tabTitle || '(Untitled)';
  document.getElementById('title')!.textContent = title;
  document.title = `${COLOR_DOTS[state.color] ?? '⚫'} ${title}`;

  document.getElementById('focus-btn')!.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'focusPopup', popupWindowId });
  });

  document.getElementById('return-btn')!.addEventListener('click', async () => {
    const tab = await chrome.tabs.getCurrent();
    if (!tab) return;
    chrome.runtime.sendMessage({
      action: 'returnTab',
      popupWindowId,
      anchorTabIndex: tab.index,
    });
  });
}

init();
