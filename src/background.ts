// src/background.ts
// Service worker — all business logic for the Tether extension.

declare function importScripts(...urls: string[]): void;
importScripts('consts.js');

const MAX_POPUPS = 5;

// ─── Startup Validation ───────────────────────────────────────────────────────
// On every service worker activation, prune popup entries whose windows or tabs
// no longer exist (caused by crashes or mid-op SW restarts).

async function validateStoredPopups(): Promise<void> {
  const popups = await getAllPopups();
  const entries = Object.entries(popups) as [string, PopupEntry][];
  if (entries.length === 0) return;

  const validated: PopupsMap = { ...popups };
  for (const [winId, entry] of entries) {
    try {
      await chrome.windows.get(entry.popupWindowId);
      await chrome.tabs.get(entry.popupTabId);
      await chrome.tabs.get(entry.anchorTabId);
    } catch {
      delete validated[Number(winId)];
    }
  }
  await chrome.storage.session.set({ popups: validated });
}

validateStoredPopups();

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

function injectDotWhenReady(tabId: number, dot: string, iconUrl: string): void {
  const execDot = () => chrome.scripting.executeScript({
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
      const intervalId = setInterval(() => { applyTitle(); applyFavicon(); }, 1000);
      const obs = new MutationObserver(() => { applyTitle(); applyFavicon(); });
      obs.observe(document.head ?? document.documentElement, { subtree: true, childList: true, characterData: true });

      (window as any).__tetherRemove = () => {
        clearInterval(intervalId);
        obs.disconnect();
        if (document.title.startsWith(prefix)) document.title = document.title.slice(prefix.length);
        document.querySelectorAll(`link[rel*="icon"][href="${icon}"]`).forEach(el => el.remove());
        (window as any).__tetherDot = false;
      };
    },
    args: [dot, iconUrl],
  });

  chrome.tabs.onUpdated.addListener(function onComplete(id, info) {
    if (id !== tabId || info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(onComplete);
    execDot().catch(console.error);
  });
  execDot().catch(() => {});
}

async function popOut(tab: chrome.tabs.Tab): Promise<void> {
  const [bounds, popups] = await Promise.all([getPopupBounds(), getAllPopups()]);
  const color = pickColor(popups);
  const stagger = Object.keys(popups).length * 30;

  // Use tabId to move the existing tab into the popup without a page reload.
  // (tabs.move disallows popup-type windows, but windows.create({ tabId }) does not.)
  const popupWindow = await chrome.windows.create({
    type: 'popup',
    tabId: tab.id!,
    width: bounds.width,
    height: bounds.height,
    left: bounds.left + stagger,
    top: bounds.top + stagger,
  });

  const popupTabId = tab.id!;
  const dot = COLOR_DOTS[color] ?? '⚫';
  const iconUrl = chrome.runtime.getURL('icons/icon48.png');

  injectDotWhenReady(popupTabId, dot, iconUrl);

  // Tab was moved; insert anchor at its vacated position
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
}

// ─── Auto-Tether (drag-out detection) ────────────────────────────────────────

const autoTetherNotifications = new Map<string, number>(); // notifId → popupWindowId

async function autoTether(
  tab: chrome.tabs.Tab,
  oldWindowId: number,
  oldPosition: number,
  newWindow: chrome.windows.Window
): Promise<void> {
  const popups = await getAllPopups();

  if (Object.keys(popups).length >= MAX_POPUPS) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: 'Tether',
      message: `You've reached the limit of ${MAX_POPUPS} popup tabs. Return one before popping another.`,
    });
    return;
  }

  const color = pickColor(popups);
  const dot = COLOR_DOTS[color] ?? '⚫';
  const iconUrl = chrome.runtime.getURL('icons/icon48.png');

  const left = newWindow.left ?? 100;
  const top = newWindow.top ?? 100;
  const width = newWindow.width ?? 900;
  const height = newWindow.height ?? 700;

  // onAttached can fire while the drag gesture is still active; Chrome rejects
  // tab/window write operations until the user releases. Retry until it allows it.
  // windows.create({ tabId }) is also a tab-move operation so it goes inside the loop.
  let popupWindow!: chrome.windows.Window;
  let anchorTab!: chrome.tabs.Tab;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      if (!popupWindow) {
        popupWindow = await chrome.windows.create({
          type: 'popup',
          tabId: tab.id!,
          width,
          height,
          left,
          top,
        });
      }
      try { await chrome.windows.remove(newWindow.id!); } catch { /* already gone */ }
      anchorTab = await chrome.tabs.create({
        url: chrome.runtime.getURL(`anchor.html#${popupWindow.id}`),
        index: oldPosition,
        windowId: oldWindowId,
        active: true,
      });
      break;
    } catch (e: any) {
      if (attempt < 14 && String(e?.message ?? '').includes('dragging')) {
        await new Promise(r => setTimeout(r, 150));
        continue;
      }
      throw e;
    }
  }

  injectDotWhenReady(tab.id!, dot, iconUrl);

  await addPopup({
    popupWindowId: popupWindow.id!,
    popupTabId: tab.id!,
    originalWindowId: oldWindowId,
    anchorTabId: anchorTab.id!,
    originalIndex: oldPosition,
    tabTitle: tab.title ?? '',
    tabFavicon: tab.favIconUrl ?? '',
    tabUrl: tab.url ?? '',
    color,
  });

  await chrome.storage.local.set({ lastPopupPosition: { left, top } });

  const notifId = `auto-tether-${popupWindow.id}`;
  autoTetherNotifications.set(notifId, popupWindow.id!);
  chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title: 'Tab tethered',
    message: tab.title || tab.url || '',
    buttons: [{ title: 'Undo' }],
  });
}

chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
  if (btnIdx !== 0) return;
  const popupWindowId = autoTetherNotifications.get(notifId);
  if (popupWindowId === undefined) return;
  autoTetherNotifications.delete(notifId);
  chrome.notifications.clear(notifId);

  const entry = await getPopupByWindowId(popupWindowId);
  if (!entry) return;
  let anchorIndex = entry.originalIndex;
  try {
    const anchorTab = await chrome.tabs.get(entry.anchorTabId);
    anchorIndex = anchorTab.index;
  } catch { /* anchor gone, fall back */ }
  await returnTab(popupWindowId, anchorIndex);
});

chrome.notifications.onClosed.addListener((notifId) => {
  autoTetherNotifications.delete(notifId);
});

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

  // Determine target window — create a new one if original was closed
  let targetWindowId = entry.originalWindowId;
  try {
    await chrome.windows.get(entry.originalWindowId);
  } catch {
    const newWindow = await chrome.windows.create({ type: 'normal' });
    targetWindowId = newWindow.id!;
  }

  // Remove dot decoration before moving the tab back
  await chrome.scripting.executeScript({
    target: { tabId: entry.popupTabId },
    func: () => { (window as any).__tetherRemove?.(); },
  }).catch(() => {});

  // Remove from storage BEFORE moving to prevent onRemoved races
  await removePopup(popupWindowId);

  // Move tab from popup to target window without a page reload.
  // tabs.move disallows popup-type source windows, so we route through a
  // minimized normal window as intermediary, then move normal→normal.
  const tempWindow = await chrome.windows.create({
    type: 'normal',
    tabId: entry.popupTabId,
    state: 'minimized',
  });
  await chrome.tabs.move(entry.popupTabId, {
    windowId: targetWindowId,
    index: anchorTabIndex,
  });
  await chrome.tabs.update(entry.popupTabId, { active: true });
  try { await chrome.windows.remove(tempWindow.id!); } catch { /* auto-closed */ }

  // Close anchor tab
  try { await chrome.tabs.remove(entry.anchorTabId); } catch { /* already gone */ }
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

// ─── Tab Removed ─────────────────────────────────────────────────────────────
// Case 1: Popup window X-closed → close the anchor tab (symmetric dismiss)
// Case 2: Anchor tab manually closed → close the orphaned popup window

chrome.tabs.onRemoved.addListener(async (tabId: number, removeInfo) => {
  // Case 1: popup tab removed because its window was X-closed → close the anchor too
  const popupEntry = await getPopupByPopupTabId(tabId);
  if (popupEntry && removeInfo.isWindowClosing) {
    // Remove from storage BEFORE closing anchor tab to prevent Case 2 race
    await removePopup(popupEntry.popupWindowId);
    try { await chrome.tabs.remove(popupEntry.anchorTabId); } catch { /* already gone */ }
    return;
  }

  // Case 2: anchor tab manually closed → close the orphaned popup window
  const anchorEntry = await getPopupByAnchorTabId(tabId);
  if (anchorEntry) {
    // Remove from storage BEFORE closing popup window to prevent Case 1 re-trigger
    await removePopup(anchorEntry.popupWindowId);
    try { await chrome.windows.remove(anchorEntry.popupWindowId); } catch {}
  }
});

// ─── Tab Updated — track URL/title/favicon changes inside popup ───────────────

chrome.tabs.onUpdated.addListener(async (tabId: number, changeInfo) => {
  if (!changeInfo.url && !changeInfo.title && !changeInfo.favIconUrl) return;
  const entry = await getPopupByPopupTabId(tabId);
  if (!entry) return;

  // Strip dot prefix that execDot injected, so anchor.ts doesn't double-render it
  let title = changeInfo.title;
  if (title) {
    const dot = COLOR_DOTS[entry.color];
    if (dot && title.startsWith(dot + ' ')) title = title.slice(dot.length + 1);
  }

  await addPopup({
    ...entry,
    ...(changeInfo.url && { tabUrl: changeInfo.url }),
    ...(title && { tabTitle: title }),
    ...(changeInfo.favIconUrl && { tabFavicon: changeInfo.favIconUrl }),
  });
  if (changeInfo.title || changeInfo.favIconUrl) {
    chrome.tabs.sendMessage(entry.anchorTabId, { action: 'refreshState' }).catch(() => {});
  }
});

// ─── Window Bounds Changed — persist popup position ──────────────────────────

chrome.windows.onBoundsChanged.addListener(async (win) => {
  const entry = await getPopupByWindowId(win.id!);
  if (!entry) return;
  await chrome.storage.local.set({
    lastPopupPosition: { left: win.left, top: win.top },
  });
});

// ─── Auto-Tether Detection ────────────────────────────────────────────────────
// onDetached records pending drags; onAttached confirms a new-window drag and converts.

const pendingDetaches = new Map<number, PendingDetach>();

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  pendingDetaches.set(tabId, {
    oldWindowId: detachInfo.oldWindowId,
    oldPosition: detachInfo.oldPosition,
  });
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  const pending = pendingDetaches.get(tabId);
  if (!pending) return;
  pendingDetaches.delete(tabId);

  const result = await chrome.storage.local.get('autoTetherDrags');
  if (!result['autoTetherDrags']) return;

  let win: chrome.windows.Window;
  try {
    win = await chrome.windows.get(attachInfo.newWindowId, { populate: true });
  } catch {
    return;
  }

  // Only intercept drag-to-new-window: must be normal type with exactly 1 tab
  if (win.type !== 'normal' || (win.tabs?.length ?? 0) !== 1) return;

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }

  // Skip restricted URLs that Chrome won't open in a popup
  const url = tab.url ?? '';
  if (!url || url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('chrome-extension://')) return;

  await autoTether(tab, pending.oldWindowId, pending.oldPosition, win);
});
