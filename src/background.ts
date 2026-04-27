// src/background.ts
// Service worker — all business logic for the Tether extension.

declare function importScripts(...urls: string[]): void;
importScripts('consts.js');

const MAX_POPUPS = 5;

// ─── State Management (chrome.storage.session) ───────────────────────────────
// Shape: { popups: PopupsMap }

async function getAllPopups(): Promise<PopupsMap> {
  const result = await chrome.storage.session.get('popups');
  return (result['popups'] as PopupsMap) ?? {};
}

async function getPopupByWindowId(windowId: number): Promise<PopupEntry | null> {
  const popups = await getAllPopups();
  return popups[windowId] ?? null;
}

async function getPopupByPopupTabId(tabId: number): Promise<PopupEntry | null> {
  const popups = await getAllPopups();
  return Object.values(popups).find(p => p.popupTabId === tabId) ?? null;
}

async function getPopupByAnchorTabId(tabId: number): Promise<PopupEntry | null> {
  const popups = await getAllPopups();
  return Object.values(popups).find(p => p.anchorTabId === tabId) ?? null;
}

async function addPopup(entry: PopupEntry): Promise<void> {
  const popups = await getAllPopups();
  popups[entry.popupWindowId] = entry;
  await chrome.storage.session.set({ popups });
}

async function removePopup(popupWindowId: number): Promise<void> {
  const popups = await getAllPopups();
  delete popups[popupWindowId];
  await chrome.storage.session.set({ popups });
}

function pickColor(popups: PopupsMap): string {
  const used = new Set(Object.values(popups).map(p => p.color));
  const colors = Object.keys(COLOR_DOTS);
  return colors.find(c => !used.has(c)) ?? colors[0];
}

// ─── Position Management (chrome.storage.local) ──────────────────────────────

async function getPopupBounds(): Promise<PopupBounds> {
  const result = await chrome.storage.local.get('lastPopupPosition');
  const saved = result['lastPopupPosition'] as { left: number; top: number } | undefined;
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

async function popOut(tab: chrome.tabs.Tab): Promise<void> {
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

  const popupTabId = popupWindow.tabs![0].id!;
  const dot = COLOR_DOTS[color] ?? '⚫';

  const iconUrl = chrome.runtime.getURL('icons/icon48.png');
  const execDot = (tabId: number) => chrome.scripting.executeScript({
    target: { tabId },
    func: (d: string, icon: string) => {
      if ((window as any).__tetherDot) return;
      (window as any).__tetherDot = true;

      const applyFavicon = () => {
        const existing = document.querySelector('link[rel*="icon"]');
        if (existing?.getAttribute('href') === icon) return;
        document.querySelectorAll('link[rel*="icon"]').forEach(el => el.remove());
        const link = document.createElement('link');
        link.rel = 'icon';
        link.href = icon;
        document.head?.appendChild(link);
      };

      const prefix = d + ' ';
      const applyTitle = () => { if (!document.title.startsWith(prefix)) document.title = prefix + document.title; };

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
    if (id !== popupTabId || info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(onComplete);
    execDot(popupTabId).catch(console.error);
  });

  // Close the original tab and insert anchor at its position
  await chrome.tabs.remove(tab.id!);

  const anchorTab = await chrome.tabs.create({
    url: chrome.runtime.getURL(`anchor.html#${popupWindow.id}`),
    index: tab.index,
    windowId: tab.windowId,
    active: true,
  });

  await chrome.windows.update(popupWindow.id!, { focused: true });

  await addPopup({
    popupWindowId: popupWindow.id!,
    popupTabId: popupTabId,
    originalWindowId: tab.windowId!,
    anchorTabId: anchorTab.id!,
    originalIndex: tab.index,
    tabTitle: tab.title ?? '',
    tabFavicon: tab.favIconUrl ?? '',
    tabUrl: tab.url ?? '',
    color,
  });

  // Also try immediately in case tab already reached complete before our listener fired
  execDot(popupTabId).catch(() => {});
}

// ─── Return Flow ─────────────────────────────────────────────────────────────

async function returnTab(popupWindowId: number, anchorTabIndex: number): Promise<void> {
  const entry = await getPopupByWindowId(popupWindowId);
  if (!entry) return;

  // Save popup position before closing it
  try {
    const win = await chrome.windows.get(entry.popupWindowId);
    await chrome.storage.local.set({
      lastPopupPosition: { left: win.left, top: win.top },
    });
  } catch { /* window already gone */ }

  // Get current URL (may have navigated since pop-out)
  let currentUrl = entry.tabUrl;
  try {
    const tab = await chrome.tabs.get(entry.popupTabId);
    currentUrl = tab.url ?? currentUrl;
  } catch { /* tab gone */ }

  // Determine target window — create a new one if original was closed
  let targetWindowId = entry.originalWindowId;
  try {
    await chrome.windows.get(entry.originalWindowId);
  } catch {
    const newWindow = await chrome.windows.create({ type: 'normal' });
    targetWindowId = newWindow.id!;
  }

  // Recreate tab at anchor's current position (tabs.move disallows popup-type windows)
  await chrome.tabs.create({
    url: currentUrl,
    windowId: targetWindowId,
    index: anchorTabIndex,
    active: true,
  });

  // Close popup window (removes popup tab with it)
  try { await chrome.windows.remove(entry.popupWindowId); } catch { /* already gone */ }

  // Close anchor tab
  try { await chrome.tabs.remove(entry.anchorTabId); } catch { /* already gone */ }

  await removePopup(popupWindowId);
}

// ─── Focus Popup ─────────────────────────────────────────────────────────────

async function focusPopup(popupWindowId: number): Promise<void> {
  const entry = await getPopupByWindowId(popupWindowId);
  if (!entry) return;
  await chrome.windows.update(entry.popupWindowId, { focused: true });
}

// ─── Shared Pop/Return Logic ──────────────────────────────────────────────────

async function handlePopCommand(): Promise<void> {
  const [popups, focusedWindow] = await Promise.all([
    getAllPopups(),
    chrome.windows.getLastFocused(),
  ]);

  // If the focused window IS a tether popup → return its tab
  const popupEntry = await getPopupByWindowId(focusedWindow.id!);
  if (popupEntry) {
    let anchorIndex = popupEntry.originalIndex;
    try {
      const anchorTab = await chrome.tabs.get(popupEntry.anchorTabId);
      anchorIndex = anchorTab.index;
    } catch { /* anchor gone, fall back to originalIndex */ }
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
  if (tab) await popOut(tab);
}

// ─── Keyboard Shortcut ───────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command: string) => {
  if (command !== 'pop-tab') return;
  await handlePopCommand();
});

// ─── Toolbar Icon Click ──────────────────────────────────────────────────────

chrome.action.onClicked.addListener(async () => {
  await handlePopCommand();
});

chrome.runtime.onMessage.addListener(
  (message: Record<string, unknown>, _sender, sendResponse) => {
    (async () => {
      switch (message['action']) {
        case 'getState':
          sendResponse({ state: await getPopupByWindowId(message['popupWindowId'] as number) });
          break;
        case 'returnTab':
          await returnTab(message['popupWindowId'] as number, message['anchorTabIndex'] as number);
          sendResponse({ ok: true });
          break;
        case 'focusPopup':
          await focusPopup(message['popupWindowId'] as number);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ error: 'unknown action' });
      }
    })();
    return true;
  }
);
