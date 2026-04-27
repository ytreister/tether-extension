"use strict";
// src/background.ts
// Service worker — all business logic for the Tether extension.
importScripts('consts.js');
const MAX_POPUPS = 5;
// ─── Startup Validation ───────────────────────────────────────────────────────
// On every service worker activation, prune popup entries whose windows or tabs
// no longer exist (caused by crashes or mid-op SW restarts).
async function validateStoredPopups() {
    const popups = await getAllPopups();
    const entries = Object.entries(popups);
    if (entries.length === 0)
        return;
    const validated = { ...popups };
    for (const [winId, entry] of entries) {
        try {
            await chrome.windows.get(entry.popupWindowId);
            await chrome.tabs.get(entry.popupTabId);
            await chrome.tabs.get(entry.anchorTabId);
        }
        catch {
            delete validated[Number(winId)];
        }
    }
    await chrome.storage.session.set({ popups: validated });
}
validateStoredPopups();
// ─── State Management (chrome.storage.session) ───────────────────────────────
// Shape: { popups: PopupsMap }
async function getAllPopups() {
    const result = await chrome.storage.session.get('popups');
    return result['popups'] ?? {};
}
async function getPopupByWindowId(windowId) {
    const popups = await getAllPopups();
    return popups[windowId] ?? null;
}
async function getPopupByPopupTabId(tabId) {
    const popups = await getAllPopups();
    return Object.values(popups).find(p => p.popupTabId === tabId) ?? null;
}
async function getPopupByAnchorTabId(tabId) {
    const popups = await getAllPopups();
    return Object.values(popups).find(p => p.anchorTabId === tabId) ?? null;
}
async function addPopup(entry) {
    const popups = await getAllPopups();
    popups[entry.popupWindowId] = entry;
    await chrome.storage.session.set({ popups });
}
async function removePopup(popupWindowId) {
    const popups = await getAllPopups();
    delete popups[popupWindowId];
    await chrome.storage.session.set({ popups });
}
function pickColor(popups) {
    const used = new Set(Object.values(popups).map(p => p.color));
    const colors = Object.keys(COLOR_DOTS);
    return colors.find(c => !used.has(c)) ?? colors[0];
}
// ─── Position Management (chrome.storage.local) ──────────────────────────────
async function getPopupBounds() {
    const result = await chrome.storage.local.get('lastPopupPosition');
    const saved = result['lastPopupPosition'];
    const width = 900;
    const height = 700;
    return {
        width,
        height,
        left: saved?.left ?? 100,
        top: saved?.top ?? 100,
    };
}
// ─── Pop Out Flow ─────────────────────────────────────────────────────────────
async function popOut(tab) {
    const [bounds, popups] = await Promise.all([getPopupBounds(), getAllPopups()]);
    const color = pickColor(popups);
    // Chrome doesn't allow tabs.move to/from popup-type windows, so we open the
    // URL directly in the new popup (the page reloads — JS state is not preserved).
    const popupWindow = await chrome.windows.create({
        type: 'popup',
        url: tab.url,
        width: bounds.width,
        height: bounds.height,
        left: bounds.left,
        top: bounds.top,
    });
    const popupTabId = popupWindow.tabs[0].id;
    const dot = COLOR_DOTS[color] ?? '⚫';
    const iconUrl = chrome.runtime.getURL('icons/icon48.png');
    const execDot = (tabId) => chrome.scripting.executeScript({
        target: { tabId },
        func: (d, icon) => {
            if (window.__tetherDot)
                return;
            window.__tetherDot = true;
            const applyFavicon = () => {
                const existing = document.querySelector('link[rel*="icon"]');
                if (existing?.getAttribute('href') === icon)
                    return;
                document.querySelectorAll('link[rel*="icon"]').forEach(el => el.remove());
                const link = document.createElement('link');
                link.rel = 'icon';
                link.href = icon;
                document.head?.appendChild(link);
            };
            const prefix = d + ' ';
            const applyTitle = () => { if (!document.title.startsWith(prefix))
                document.title = prefix + document.title; };
            applyTitle();
            applyFavicon();
            setInterval(() => { applyTitle(); applyFavicon(); }, 1000);
            new MutationObserver(() => { applyTitle(); applyFavicon(); })
                .observe(document.head ?? document.documentElement, { subtree: true, childList: true, characterData: true });
        },
        args: [dot, iconUrl],
    });
    // Register listener BEFORE other awaits so we don't miss the complete event
    chrome.tabs.onUpdated.addListener(function onComplete(id, info) {
        if (id !== popupTabId || info.status !== 'complete')
            return;
        chrome.tabs.onUpdated.removeListener(onComplete);
        execDot(popupTabId).catch(console.error);
    });
    // Close the original tab and insert anchor at its position
    await chrome.tabs.remove(tab.id);
    const anchorTab = await chrome.tabs.create({
        url: chrome.runtime.getURL(`anchor.html#${popupWindow.id}`),
        index: tab.index,
        windowId: tab.windowId,
        active: true,
    });
    await chrome.windows.update(popupWindow.id, { focused: true });
    await addPopup({
        popupWindowId: popupWindow.id,
        popupTabId: popupTabId,
        originalWindowId: tab.windowId,
        anchorTabId: anchorTab.id,
        originalIndex: tab.index,
        tabTitle: tab.title ?? '',
        tabFavicon: tab.favIconUrl ?? '',
        tabUrl: tab.url ?? '',
        color,
    });
    // Also try immediately in case tab already reached complete before our listener fired
    execDot(popupTabId).catch(() => { });
}
// ─── Return Flow ─────────────────────────────────────────────────────────────
async function returnTab(popupWindowId, anchorTabIndex) {
    const entry = await getPopupByWindowId(popupWindowId);
    if (!entry)
        return;
    // Save popup position before closing it
    try {
        const win = await chrome.windows.get(entry.popupWindowId);
        await chrome.storage.local.set({
            lastPopupPosition: { left: win.left, top: win.top },
        });
    }
    catch { /* window already gone */ }
    // Get current URL (may have navigated since pop-out)
    let currentUrl = entry.tabUrl;
    try {
        const tab = await chrome.tabs.get(entry.popupTabId);
        currentUrl = tab.url ?? currentUrl;
    }
    catch { /* tab gone */ }
    // Determine target window — create a new one if original was closed
    let targetWindowId = entry.originalWindowId;
    try {
        await chrome.windows.get(entry.originalWindowId);
    }
    catch {
        const newWindow = await chrome.windows.create({ type: 'normal' });
        targetWindowId = newWindow.id;
    }
    // Recreate tab at anchor's current position (tabs.move disallows popup-type windows)
    await chrome.tabs.create({
        url: currentUrl,
        windowId: targetWindowId,
        index: anchorTabIndex,
        active: true,
    });
    // Close popup window (removes popup tab with it)
    try {
        await chrome.windows.remove(entry.popupWindowId);
    }
    catch { /* already gone */ }
    // Close anchor tab
    try {
        await chrome.tabs.remove(entry.anchorTabId);
    }
    catch { /* already gone */ }
    await removePopup(popupWindowId);
}
// ─── Focus Popup ─────────────────────────────────────────────────────────────
async function focusPopup(popupWindowId) {
    const entry = await getPopupByWindowId(popupWindowId);
    if (!entry)
        return;
    await chrome.windows.update(entry.popupWindowId, { focused: true });
}
// ─── Shared Pop/Return Logic ──────────────────────────────────────────────────
async function handlePopCommand() {
    const [popups, focusedWindow] = await Promise.all([
        getAllPopups(),
        chrome.windows.getLastFocused(),
    ]);
    // If the focused window IS a tether popup → return its tab
    const popupEntry = await getPopupByWindowId(focusedWindow.id);
    if (popupEntry) {
        let anchorIndex = popupEntry.originalIndex;
        try {
            const anchorTab = await chrome.tabs.get(popupEntry.anchorTabId);
            anchorIndex = anchorTab.index;
        }
        catch { /* anchor gone, fall back to originalIndex */ }
        await returnTab(popupEntry.popupWindowId, anchorIndex);
        return;
    }
    // Otherwise → pop the current tab (if under max)
    if (Object.keys(popups).length >= MAX_POPUPS) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon48.png'),
            title: 'Tether',
            message: `You've reached the limit of ${MAX_POPUPS} popup tabs. Return one before popping another.`,
        });
        return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab)
        await popOut(tab);
}
// ─── Keyboard Shortcut ───────────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'pop-tab')
        return;
    await handlePopCommand();
});
// ─── Toolbar Icon Click ──────────────────────────────────────────────────────
chrome.action.onClicked.addListener(async () => {
    await handlePopCommand();
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
        switch (message['action']) {
            case 'getState':
                sendResponse({ state: await getPopupByWindowId(message['popupWindowId']) });
                break;
            case 'returnTab':
                await returnTab(message['popupWindowId'], message['anchorTabIndex']);
                sendResponse({ ok: true });
                break;
            case 'focusPopup':
                await focusPopup(message['popupWindowId']);
                sendResponse({ ok: true });
                break;
            default:
                sendResponse({ error: 'unknown action' });
        }
    })();
    return true;
});
// ─── Tab Removed ─────────────────────────────────────────────────────────────
// Case 1: Popup window X-closed → close the anchor tab (symmetric dismiss)
// Case 2: Anchor tab manually closed → close the orphaned popup window
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    // Case 1: popup tab removed because its window was X-closed → close the anchor too
    const popupEntry = await getPopupByPopupTabId(tabId);
    if (popupEntry && removeInfo.isWindowClosing) {
        // Remove from storage BEFORE closing anchor tab to prevent Case 2 race
        await removePopup(popupEntry.popupWindowId);
        try {
            await chrome.tabs.remove(popupEntry.anchorTabId);
        }
        catch { /* already gone */ }
        return;
    }
    // Case 2: anchor tab manually closed → close the orphaned popup window
    const anchorEntry = await getPopupByAnchorTabId(tabId);
    if (anchorEntry) {
        // Remove from storage BEFORE closing popup window to prevent Case 1 re-trigger
        await removePopup(anchorEntry.popupWindowId);
        try {
            await chrome.windows.remove(anchorEntry.popupWindowId);
        }
        catch { }
    }
});
// ─── Tab Updated — track URL/title/favicon changes inside popup ───────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (!changeInfo.url && !changeInfo.title && !changeInfo.favIconUrl)
        return;
    const entry = await getPopupByPopupTabId(tabId);
    if (!entry)
        return;
    // Strip dot prefix that execDot injected, so anchor.ts doesn't double-render it
    let title = changeInfo.title;
    if (title) {
        const dot = COLOR_DOTS[entry.color];
        if (dot && title.startsWith(dot + ' '))
            title = title.slice(dot.length + 1);
    }
    await addPopup({
        ...entry,
        ...(changeInfo.url && { tabUrl: changeInfo.url }),
        ...(title && { tabTitle: title }),
        ...(changeInfo.favIconUrl && { tabFavicon: changeInfo.favIconUrl }),
    });
    if (changeInfo.title || changeInfo.favIconUrl) {
        chrome.tabs.sendMessage(entry.anchorTabId, { action: 'refreshState' }).catch(() => { });
    }
});
// ─── Window Bounds Changed — persist popup position ──────────────────────────
chrome.windows.onBoundsChanged.addListener(async (win) => {
    const entry = await getPopupByWindowId(win.id);
    if (!entry)
        return;
    await chrome.storage.local.set({
        lastPopupPosition: { left: win.left, top: win.top },
    });
});
