"use strict";
function applyState(state) {
    if (state.tabFavicon) {
        const img = document.getElementById('favicon');
        img.src = state.tabFavicon;
        img.style.display = 'block';
    }
    const title = state.tabTitle || '(Untitled)';
    document.getElementById('title').textContent = title;
    document.title = `${COLOR_DOTS[state.color] ?? '⚫'} ${title}`;
}
async function init() {
    const popupWindowId = parseInt(location.hash.slice(1), 10);
    if (!popupWindowId) {
        document.getElementById('title').textContent = '(invalid anchor)';
        return;
    }
    let state = null;
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getState', popupWindowId });
        state = response.state ?? null;
    }
    catch {
        // Service worker not yet ready — rare on first load
    }
    if (!state) {
        document.getElementById('title').textContent = '(state unavailable)';
        return;
    }
    applyState(state);
    document.getElementById('focus-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'focusPopup', popupWindowId });
    });
    document.getElementById('return-btn').addEventListener('click', async () => {
        const tab = await chrome.tabs.getCurrent();
        if (!tab)
            return;
        chrome.runtime.sendMessage({
            action: 'returnTab',
            popupWindowId,
            anchorTabIndex: tab.index,
        });
    });
    chrome.runtime.onMessage.addListener((message) => {
        if (message['action'] !== 'refreshState')
            return;
        chrome.runtime.sendMessage({ action: 'getState', popupWindowId }).then(response => {
            const fresh = response.state;
            if (fresh)
                applyState(fresh);
        }).catch(() => { });
    });
}
init();
