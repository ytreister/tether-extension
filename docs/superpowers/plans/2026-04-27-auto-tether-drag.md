# Auto-Tether on Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user drags a tab out to create a new window, automatically convert it into a Tether popup (with an Undo notification), controlled by an options page toggle.

**Architecture:** `tabs.onDetached` records pending detaches in memory; `tabs.onAttached` checks if the tab landed in a fresh single-tab normal window and calls `autoTether()`. `autoTether()` mirrors `popOut()` but reuses the drag-created window's bounds. An options page (`options.html` + `src/options.ts`) toggles `chrome.storage.local.autoTetherDrags`. Notification undo is handled by a module-level map of `notifId → popupWindowId`.

**Tech Stack:** TypeScript compiled by `tsc` (no bundler). `pnpm run build` to compile, `pnpm run watch` for dev. Reload extension at `chrome://extensions/` after each `background.ts` change. Chrome MV3 service worker.

> **Note:** `tabs.move` between popup↔normal window types is not supported by Chrome — `autoTether()` opens a new popup window at the URL (page reloads), same constraint as `popOut()`.

> **Development workflow:** Run `pnpm run watch` in a terminal. Reload the extension at `chrome://extensions/` after any `background.ts` change. Other files (options.html, options.js) hot-reload on tab refresh.

---

## File Map

| File | Change |
|------|--------|
| `src/types.ts` | Add `PendingDetach` interface |
| `manifest.json` | Add `options_ui` block |
| `options.html` | New — options page markup |
| `src/options.ts` | New — options page script |
| `options.js` | Compiled from `src/options.ts` (do not edit directly) |
| `src/background.ts` | Extract `injectDotWhenReady()`, add `autoTether()`, add notification map + listeners, add `pendingDetaches` map + `tabs.onDetached` + `tabs.onAttached` handlers |
| `background.js` | Compiled from `src/background.ts` (do not edit directly) |

---

## Task 1: PendingDetach Type + Manifest options_ui

**Files:**
- Modify: `src/types.ts`
- Modify: `manifest.json`

- [ ] **Step 1: Add PendingDetach to src/types.ts**

Append to the end of `src/types.ts`:

```typescript
interface PendingDetach {
  oldWindowId: number;
  oldPosition: number;
}
```

The full file should now read:

```typescript
// Shared types used by both the service worker and the anchor tab page.

interface PopupEntry {
  popupWindowId: number;
  popupTabId: number;
  originalWindowId: number;
  anchorTabId: number;
  originalIndex: number;
  tabTitle: string;
  tabFavicon: string;
  tabUrl: string;
  color: string;
}

type PopupsMap = Record<number, PopupEntry>;

interface PopupBounds {
  width: number;
  height: number;
  left: number;
  top: number;
}

interface PendingDetach {
  oldWindowId: number;
  oldPosition: number;
}
```

- [ ] **Step 2: Add options_ui to manifest.json**

Add `"options_ui"` after the `"commands"` block. The full `manifest.json` should read:

```json
{
  "manifest_version": 3,
  "name": "Tether",
  "version": "1.0.0",
  "description": "Pop a tab into a popup window with a color-coded anchor to snap it back.",
  "permissions": ["tabs", "windows", "storage", "contextMenus", "scripting", "notifications"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "Tether: pop tab into popup (Ctrl+Shift+M)"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "commands": {
    "pop-tab": {
      "suggested_key": {
        "default": "Ctrl+Shift+M"
      },
      "description": "Pop current tab into popup / return tab to main window"
    }
  },
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  }
}
```

- [ ] **Step 3: Build and verify**

```bash
pnpm run build
```

Expected: exits with code 0. No new `.js` files yet (types.ts produces no output).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts manifest.json
git commit -m "feat: PendingDetach type, manifest options_ui"
```

---

## Task 2: Options Page

**Files:**
- Create: `options.html`
- Create: `src/options.ts`

- [ ] **Step 1: Create options.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Tether — Options</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 2rem;
      max-width: 480px;
      color: #333;
    }
    h1 { font-size: 1.25rem; margin-bottom: 1.5rem; }
    label { display: flex; align-items: center; gap: 10px; font-size: 0.95rem; cursor: pointer; }
    input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Tether Settings</h1>
  <label>
    <input type="checkbox" id="auto-tether-toggle">
    Automatically tether tabs dragged into new windows
  </label>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create src/options.ts**

```typescript
const toggle = document.getElementById('auto-tether-toggle') as HTMLInputElement;

chrome.storage.local.get('autoTetherDrags').then(result => {
  toggle.checked = (result['autoTetherDrags'] as boolean) ?? false;
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ autoTetherDrags: toggle.checked });
});
```

- [ ] **Step 3: Build**

```bash
pnpm run build
```

Expected: exits with code 0. `options.js` appears at repo root.

- [ ] **Step 4: Verify options page loads in Chrome**

1. Reload extension at `chrome://extensions/`
2. Right-click the Tether toolbar icon → **Options**
3. Expected: page opens in a new tab showing "Tether Settings" with a checkbox "Automatically tether tabs dragged into new windows" (unchecked)
4. Check the checkbox → uncheck it. Open service worker DevTools console and run:
   ```js
   chrome.storage.local.get('autoTetherDrags').then(r => console.log(r))
   ```
   Expected: `{ autoTetherDrags: false }` after unchecking.

- [ ] **Step 5: Commit**

```bash
git add options.html src/options.ts options.js
git commit -m "feat: options page — auto-tether drag toggle"
```

---

## Task 3: injectDotWhenReady() + autoTether() + Notification Undo

**Files:**
- Modify: `src/background.ts`

This task extracts the dot-injection logic from `popOut()` into a shared helper, adds `autoTether()`, and wires up the notification undo flow.

- [ ] **Step 1: Extract injectDotWhenReady() and update popOut()**

Replace the entire `// ─── Pop Out Flow` section (currently starting at line 89) with the version below. The key change: the inline `execDot` + `onComplete` listener inside `popOut()` is extracted into `injectDotWhenReady()`, and `popOut()` now calls it.

```typescript
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
      setInterval(() => { applyTitle(); applyFavicon(); }, 1000);
      new MutationObserver(() => { applyTitle(); applyFavicon(); })
        .observe(document.head ?? document.documentElement, { subtree: true, childList: true, characterData: true });
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

  injectDotWhenReady(popupTabId, dot, iconUrl);

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
}
```

- [ ] **Step 2: Build and verify popOut still works**

```bash
pnpm run build
```

Expected: exits with code 0. Reload extension, press `Ctrl+Shift+M` on any page — pop-out should work exactly as before with the colored dot in the title bar.

- [ ] **Step 3: Add autoTether() and notification undo infrastructure**

Insert the following block immediately after the `popOut()` function (before `// ─── Return Flow`):

```typescript
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

  const popupWindow = await chrome.windows.create({
    type: 'popup',
    url: tab.url,
    width,
    height,
    left,
    top,
  });

  const popupTabId = popupWindow.tabs![0].id!;

  injectDotWhenReady(popupTabId, dot, iconUrl);

  try { await chrome.windows.remove(newWindow.id!); } catch { /* already gone */ }

  const anchorTab = await chrome.tabs.create({
    url: chrome.runtime.getURL(`anchor.html#${popupWindow.id}`),
    index: oldPosition,
    windowId: oldWindowId,
    active: true,
  });

  await addPopup({
    popupWindowId: popupWindow.id!,
    popupTabId,
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
```

- [ ] **Step 4: Build**

```bash
pnpm run build
```

Expected: exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add src/background.ts background.js
git commit -m "feat: injectDotWhenReady helper, autoTether(), notification undo"
```

---

## Task 4: Detection Handlers (tabs.onDetached + tabs.onAttached)

**Files:**
- Modify: `src/background.ts`

- [ ] **Step 1: Append detection handlers to background.ts**

Add the following block at the very end of `src/background.ts` (after `// ─── Window Bounds Changed`):

```typescript
// ─── Auto-Tether Detection ────────────────────────────────────────────────────
// onDetached records pending drags; onAttached confirms a new-window drag and converts.

const pendingDetaches = new Map<number, PendingDetach>();

chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
  const result = await chrome.storage.local.get('autoTetherDrags');
  if (!result['autoTetherDrags']) return;
  pendingDetaches.set(tabId, {
    oldWindowId: detachInfo.oldWindowId,
    oldPosition: detachInfo.oldPosition,
  });
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  const pending = pendingDetaches.get(tabId);
  if (!pending) return;
  pendingDetaches.delete(tabId);

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
```

- [ ] **Step 2: Build**

```bash
pnpm run build
```

Expected: exits with code 0.

- [ ] **Step 3: Enable feature and test basic drag-out**

1. Reload extension at `chrome://extensions/`
2. Right-click Tether icon → **Options** → check "Automatically tether tabs dragged into new windows"
3. Open `https://news.ycombinator.com` in a tab
4. Drag the tab out of the window (drag tab down/away until cursor shows detach)
5. Expected:
   - The new normal window disappears
   - A tether popup window appears at the same position with the HN page loading
   - An anchor tab appears in the original window at the original position
   - A "Tab tethered" notification appears with an "Undo" button

- [ ] **Step 4: Test Undo button**

1. After the notification appears (Step 3 above), click **Undo**
2. Expected:
   - The popup closes
   - HN page returns to the original window at the anchor's position
   - Anchor tab disappears
   - `getAllPopups()` in service worker console → `{}`

- [ ] **Step 5: Test feature disabled — no interception**

1. Right-click Tether icon → **Options** → uncheck the toggle
2. Drag a tab out to a new window
3. Expected: normal window stays as-is. No tether popup, no notification.

- [ ] **Step 6: Test move to existing window — no interception**

1. Enable the feature
2. Have two browser windows open with multiple tabs each
3. Drag a tab from window A into window B (existing window, not a new window)
4. Expected: tab moves to window B normally. No tether popup, no notification.

- [ ] **Step 7: Test MAX_POPUPS cap during drag**

1. Pop 5 tabs using `Ctrl+Shift+M` (the manual shortcut)
2. With feature enabled, drag a 6th tab out
3. Expected: normal window stays, a "You've reached the limit of 5 popup tabs" notification appears.

- [ ] **Step 8: Commit**

```bash
git add src/background.ts background.js
git commit -m "feat: auto-tether on drag — onDetached/onAttached detection"
```
