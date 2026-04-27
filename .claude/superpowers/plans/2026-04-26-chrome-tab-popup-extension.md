# Tether Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that moves a tab into a distraction-free popup window and leaves a color-coded anchor placeholder in the original tab strip for one-click return. Supports up to 5 simultaneous popups.

**Architecture:** A Manifest V3 service worker (`background.js`, compiled from `src/background.ts`) owns all state and business logic. State is a map keyed by `popupWindowId` stored in `chrome.storage.session`. Each popup gets a color from a fixed palette. An anchor tab page (`anchor.html/js`, compiled from `src/anchor.ts`) communicates with the background via `chrome.runtime.sendMessage`, identifying itself by `popupWindowId` encoded in its URL hash. Last popup position persists in `chrome.storage.local`. On service worker startup, orphaned state is pruned.

**Tech Stack:** TypeScript compiled by `tsc` (no bundler). `@types/chrome` for typed Chrome API access. Compiled JS files live at repo root alongside HTML/CSS/assets — the repo root IS the unpacked extension directory. Package manager: **pnpm**.

> **Note on TDD:** This extension cannot be unit-tested without a Chrome API mock harness, and MV3 service workers make in-browser testing the most reliable approach. Each task ends with specific manual verification steps.

> **Development workflow:** Run `pnpm run watch` in a terminal — TypeScript recompiles on every save. Reload the extension at `chrome://extensions/` after each `background.ts` change (other files hot-reload on tab refresh).

---

## File Map

| File | Responsibility |
|------|----------------|
| `manifest.json` | Extension config, permissions, `Ctrl+Shift+M` shortcut, action icon |
| `src/types.ts` | Shared TypeScript interfaces (`PopupEntry`, `PopupsMap`, `PopupBounds`) — imported via `import type`, erased at compile time |
| `src/background.ts` | Service worker source — all logic: state, pop-out, return, focus, events, startup validation |
| `src/anchor.ts` | Anchor tab source — reads `popupWindowId` from URL hash, renders state, button handlers |
| `background.js` | Compiled from `src/background.ts` (do not edit directly) |
| `anchor.js` | Compiled from `src/anchor.ts` (do not edit directly) |
| `anchor.html` | Anchor tab markup |
| `anchor.css` | Anchor tab styling — muted, placeholder-like, color accent bar at top |
| `icons/icon{16,48,128}.png` | Tether chain-link icons (generated via Pillow script) |
| `tsconfig.json` | TypeScript compiler config — `src/` in, root out, strict mode |
| `package.json` | Dev dependencies (`typescript`, `@types/chrome`) and build scripts |
| `.gitignore` | Ignores `node_modules/` only — compiled JS is committed so Chrome can load the repo directly |

---

## Task 1: Scaffold, TypeScript Setup, and Icons

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/background.ts` (empty)
- Create: `src/anchor.ts` (empty)
- Create: `anchor.html`, `anchor.css` (empty)
- Create: `manifest.json` (empty)
- Create: `icons/icon{16,48,128}.png`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p src icons
touch manifest.json anchor.html anchor.css src/background.ts src/anchor.ts
```

- [ ] **Step 2: Write package.json**

```json
{
  "name": "tether-extension",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "strict": true,
    "outDir": ".",
    "rootDir": "src",
    "skipLibCheck": true,
    "types": ["chrome"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`outDir: "."` + `rootDir: "src"` means `src/background.ts` → `./background.js` and `src/anchor.ts` → `./anchor.js` at the repo root — exactly where `manifest.json` and `anchor.html` reference them.

- [ ] **Step 4: Write .gitignore**

```
node_modules/
```

Compiled `.js` files are intentionally committed so the repo can be loaded directly as an unpacked Chrome extension without a build step for the end-user.

- [ ] **Step 5: Install dependencies**

```bash
pnpm install
```

Expected: `node_modules/` created, `pnpm-lock.yaml` created. No errors.

- [ ] **Step 6: Verify TypeScript can see Chrome types**

```bash
echo 'const x: chrome.tabs.Tab = {} as chrome.tabs.Tab; console.log(x);' > src/_typecheck.ts
pnpm exec tsc --noEmit
rm src/_typecheck.ts
```

Expected: no errors (confirms `@types/chrome` is wired up correctly).

- [ ] **Step 7: Generate tether chain-link icons**

```bash
pip3 install pillow
python3 - <<'EOF'
from PIL import Image, ImageDraw

def create_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    color = (0, 180, 216, 255)  # teal #00b4d8
    lw = {16: 2, 48: 4, 128: 8}[size]

    # Two interlocked ovals — chain link / tether motif
    w, h = size * 0.52, size * 0.36
    m = size * 0.06

    # Oval 1 — upper-left
    draw.ellipse([m, size * 0.12, m + w, size * 0.12 + h], outline=color, width=lw)
    # Oval 2 — lower-right (overlapping)
    draw.ellipse([size - m - w, size * 0.52, size - m, size * 0.52 + h], outline=color, width=lw)
    return img

for s in [16, 48, 128]:
    create_icon(s).save(f'icons/icon{s}.png')
print('Icons created.')
EOF
```

Expected: `Icons created.`

- [ ] **Step 8: Commit scaffold**

```bash
git add -A
git commit -m "chore: TypeScript scaffold, npm setup, tether chain-link icons"
```

---

## Task 2: manifest.json

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Write manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Tether",
  "version": "1.0.0",
  "description": "Pop a tab into a popup window with a color-coded anchor to snap it back.",
  "permissions": ["tabs", "windows", "storage", "contextMenus"],
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
  }
}
```

`contextMenus` permission is included now (costs nothing) for the future page context menu feature.

- [ ] **Step 2: Verify extension loads in Chrome**

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. **Load unpacked** → select the repo root (the folder containing `manifest.json`)
4. Expected: "Tether" appears with teal chain-link icon, no errors
5. `chrome://extensions/shortcuts` shows "Pop current tab into popup / return tab to main window" with `Ctrl+Shift+M`

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: manifest.json — MV3, Ctrl+Shift+M, contextMenus permission"
```

---

## Task 3: Anchor Tab UI (anchor.html + anchor.css)

**Files:**
- Modify: `anchor.html`
- Modify: `anchor.css`

- [ ] **Step 1: Write anchor.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tab in popup</title>
  <link rel="stylesheet" href="anchor.css">
</head>
<body>
  <div id="color-bar" class="color-bar"></div>
  <div class="container">
    <div class="tab-info">
      <img id="favicon" class="favicon" src="" alt="" style="display:none">
      <div class="text-info">
        <div id="title" class="tab-title">Loading…</div>
        <div class="subtitle">Currently open in a popup window</div>
      </div>
    </div>
    <div class="actions">
      <button id="focus-btn" class="btn btn-secondary">Focus popup</button>
      <button id="return-btn" class="btn btn-primary">Return tab here</button>
    </div>
  </div>
  <script src="anchor.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write anchor.css**

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: #ebebeb;
  color: #555;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}

.color-bar {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 5px;
}

.container {
  text-align: center;
  padding: 2rem;
  max-width: 520px;
  width: 100%;
}

.tab-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-bottom: 2.5rem;
}

.favicon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 4px;
}

.text-info {
  text-align: left;
}

.tab-title {
  font-size: 1.15rem;
  font-weight: 600;
  color: #333;
  margin-bottom: 5px;
}

.subtitle {
  font-size: 0.85rem;
  color: #999;
}

.actions {
  display: flex;
  gap: 14px;
  justify-content: center;
}

.btn {
  padding: 10px 22px;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn:hover { opacity: 0.82; }

.btn-secondary { background: #d8d8d8; color: #444; }

.btn-primary { background: #1a73e8; color: #fff; }
```

- [ ] **Step 3: Visual check**

Drag `anchor.html` into Chrome directly.
Expected: grey background, "Loading…" title, subtitle, two buttons, no layout issues.

- [ ] **Step 4: Commit**

```bash
git add anchor.html anchor.css
git commit -m "feat: anchor tab markup and styles"
```

---

## Task 4: src/anchor.ts

**Files:**
- Modify: `src/anchor.ts`

- [ ] **Step 1: Write src/anchor.ts**

```typescript
// src/anchor.ts
// Runs in the anchor tab page context.
// Identifies its popup by reading popupWindowId from the URL hash.

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

  // Color bar accent
  document.getElementById('color-bar')!.style.background = state.color;

  // Favicon
  if (state.tabFavicon) {
    const img = document.getElementById('favicon') as HTMLImageElement;
    img.src = state.tabFavicon;
    img.style.display = 'block';
  }

  // Title — page body and browser tab strip
  const title = state.tabTitle || '(Untitled)';
  document.getElementById('title')!.textContent = title;
  document.title = `\u{1F441} ${title}`;

  // "Focus popup" button
  document.getElementById('focus-btn')!.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'focusPopup', popupWindowId });
  });

  // "Return tab here" button — send current tab index to background
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
```

- [ ] **Step 2: Build and verify no TypeScript errors**

```bash
pnpm run build
```

Expected: exits with code 0, `anchor.js` appears at repo root.

- [ ] **Step 3: Verify anchor tab renders correctly with injected state**

1. Reload extension at `chrome://extensions/`
2. Open service worker DevTools console (click "Service Worker" link on the extension card)
3. Inject test state:
   ```js
   chrome.storage.session.set({ popups: {
     999: {
       popupWindowId: 999, popupTabId: 1, originalWindowId: 2, anchorTabId: 3,
       originalIndex: 2, tabTitle: 'Hacker News',
       tabFavicon: 'https://news.ycombinator.com/favicon.ico',
       tabUrl: 'https://news.ycombinator.com', color: '#0f9d58'
     }
   }});
   ```
4. Navigate to `chrome-extension://<extension-id>/anchor.html#999`
   (get the extension ID from `chrome://extensions/`)
5. Expected:
   - Green (`#0f9d58`) 5px bar at top
   - HN favicon visible
   - Title shows "Hacker News"
   - Browser tab strip shows "👁 Hacker News"

- [ ] **Step 4: Commit**

```bash
git add src/anchor.ts anchor.js
git commit -m "feat: anchor tab TypeScript — hash lookup, color bar, button handlers"
```

---

## Task 5: src/background.ts — State & Position Helpers

**Files:**
- Modify: `src/background.ts`

- [ ] **Step 1: Write state and position helpers**

```typescript
// src/background.ts
// Service worker — all business logic for the Tether extension.

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS: readonly string[] = [
  '#1a73e8', // blue
  '#0f9d58', // green
  '#f4511e', // red-orange
  '#9c27b0', // purple
  '#ff6d00', // amber
];

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
  return COLORS.find(c => !used.has(c)) ?? COLORS[0];
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
    left: saved?.left ?? Math.round(screen.width / 2),
    top: saved?.top ?? Math.round((screen.height - height) / 2),
  };
}
```

- [ ] **Step 2: Build and verify**

```bash
pnpm run build
```

Expected: no errors, `background.js` created at repo root.

- [ ] **Step 3: Spot-check from service worker console**

Reload extension. Open service worker DevTools. Paste (adapted to JS since DevTools runs JS not TS):

```js
getAllPopups().then(p => console.log('popups:', p))
// Expected: popups: {}

addPopup({ popupWindowId: 1, popupTabId: 2, anchorTabId: 3, color: '#1a73e8',
           originalWindowId: 4, originalIndex: 0, tabTitle: 'Test',
           tabFavicon: '', tabUrl: 'https://example.com' })
  .then(() => getAllPopups())
  .then(p => console.log('after add:', JSON.stringify(p)))
// Expected: after add: {"1":{"popupWindowId":1,...}}

removePopup(1).then(() => getAllPopups()).then(p => console.log('after remove:', p))
// Expected: after remove: {}

getPopupBounds().then(b => console.log('bounds:', b))
// Expected: bounds: {width: 900, height: 700, left: <number>, top: <number>}
```

- [ ] **Step 4: Commit**

```bash
git add src/background.ts background.js
git commit -m "feat: background.ts state helpers — map-based multi-popup, color palette"
```

---

## Task 6: src/background.ts — popOut()

**Files:**
- Modify: `src/background.ts` (append)

- [ ] **Step 1: Append popOut + temporary command listener**

```typescript
// ─── Pop Out Flow ─────────────────────────────────────────────────────────────

async function popOut(tab: chrome.tabs.Tab): Promise<void> {
  const [bounds, popups] = await Promise.all([getPopupBounds(), getAllPopups()]);
  const color = pickColor(popups);

  // Create popup window with about:blank so we can MOVE the real tab in.
  // Moving preserves tab state/history; creating with the URL would reload the page.
  const popupWindow = await chrome.windows.create({
    type: 'popup',
    url: 'about:blank',
    width: bounds.width,
    height: bounds.height,
    left: bounds.left,
    top: bounds.top,
  });

  const blankTabId = popupWindow.tabs![0].id!;

  // Move original tab into popup — same tab ID, JS state and scroll preserved
  await chrome.tabs.move(tab.id!, { windowId: popupWindow.id!, index: 0 });

  // Remove the auto-created blank tab
  await chrome.tabs.remove(blankTabId);

  // Insert anchor at original position (not active — keep focus on popup)
  const anchorTab = await chrome.tabs.create({
    url: chrome.runtime.getURL(`anchor.html#${popupWindow.id}`),
    index: tab.index,
    windowId: tab.windowId,
    active: false,
  });

  // Bring popup window to front
  await chrome.windows.update(popupWindow.id!, { focused: true });

  await addPopup({
    popupWindowId: popupWindow.id!,
    popupTabId: tab.id!,
    originalWindowId: tab.windowId!,
    anchorTabId: anchorTab.id!,
    originalIndex: tab.index,
    tabTitle: tab.title ?? '',
    tabFavicon: tab.favIconUrl ?? '',
    tabUrl: tab.url ?? '',
    color,
  });
}

// ─── TEMP command listener — replaced in Task 8 ───────────────────────────────

chrome.commands.onCommand.addListener(async (command: string) => {
  if (command !== 'pop-tab') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await popOut(tab);
});
```

- [ ] **Step 2: Build**

```bash
pnpm run build
```

Expected: no errors.

- [ ] **Step 3: Test pop-out**

1. Reload extension
2. Navigate to `https://news.ycombinator.com`
3. Press `Ctrl+Shift+M`
4. Expected:
   - Popup window (no tab bar) opens at ~right half of screen
   - Original tab replaced by anchor tab: colored top bar, HN favicon, title "Hacker News", subtitle
   - Browser tab strip shows "👁 Hacker News" for the anchor
5. Service worker console: `getAllPopups().then(p => console.log(JSON.stringify(p, null, 2)))`
   Expected: one entry with correct IDs and a color value

- [ ] **Step 4: Test a second pop-out gets a different color**

1. Open another real tab (e.g. `https://example.com`)
2. Press `Ctrl+Shift+M`
3. Expected: second anchor has a different color bar than the first

- [ ] **Step 5: Commit**

```bash
git add src/background.ts background.js
git commit -m "feat: background.ts popOut — moves tab, color-coded anchor"
```

---

## Task 7: src/background.ts — returnTab() + focusPopup()

**Files:**
- Modify: `src/background.ts` (insert before TEMP listener)

- [ ] **Step 1: Insert returnTab and focusPopup before the TEMP comment**

```typescript
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

  // Move popup tab back at anchor's current index
  await chrome.tabs.move(entry.popupTabId, {
    windowId: targetWindowId,
    index: anchorTabIndex,
  });

  // Activate the returned tab
  await chrome.tabs.update(entry.popupTabId, { active: true });

  // Close popup window (now empty)
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
```

- [ ] **Step 2: Build**

```bash
pnpm run build
```

Expected: no errors.

- [ ] **Step 3: Test returnTab from service worker console**

1. Reload extension, pop a tab out
2. Get anchor's current index:
   ```js
   getAllPopups().then(p => {
     const e = Object.values(p)[0];
     chrome.tabs.get(e.anchorTabId).then(t =>
       console.log('anchor index:', t.index, 'popupWindowId:', e.popupWindowId)
     );
   })
   ```
3. Call return (replace values with those logged above):
   ```js
   returnTab(<popupWindowId>, <anchorIndex>)
   ```
4. Expected: popup closes, tab returns at that position and activates, anchor disappears, `getAllPopups()` → `{}`

- [ ] **Step 4: Commit**

```bash
git add src/background.ts background.js
git commit -m "feat: background.ts returnTab and focusPopup"
```

---

## Task 8: src/background.ts — Command Handler, Action Click, Message Handler

**Files:**
- Modify: `src/background.ts` (replace TEMP listener, append message handler)

- [ ] **Step 1: Replace the TEMP listener block with the real handlers**

Remove the `// ─── TEMP` block entirely and replace with:

```typescript
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
  if (Object.keys(popups).length >= MAX_POPUPS) return;
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

// ─── Message Handler (from anchor tab) ───────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: Record<string, unknown>, _sender, sendResponse) => {
    (async () => {
      switch (message['action']) {
        case 'getState':
          sendResponse({ state: await getPopupByWindowId(message['popupWindowId'] as number) });
          break;
        case 'returnTab':
          await returnTab(
            message['popupWindowId'] as number,
            message['anchorTabIndex'] as number
          );
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
    return true; // Keep channel open for async sendResponse
  }
);
```

- [ ] **Step 2: Build**

```bash
pnpm run build
```

Expected: no errors.

- [ ] **Step 3: Test all interaction flows**

**Flow A — Pop out via shortcut:**
Press `Ctrl+Shift+M` on any real page. Popup opens, anchor appears.

**Flow B — Return via shortcut (popup focused):**
Click inside popup, press `Ctrl+Shift+M`. Popup closes, tab returns.

**Flow C — Pop out via toolbar icon:**
Click Tether icon in Chrome toolbar. Same result as Flow A.

**Flow D — Return via "Return tab here" button:**
Pop a tab out, click "Return tab here" in anchor. Popup closes, tab returns.

**Flow E — "Focus popup" button:**
Pop a tab out, click back to original window, click "Focus popup". Popup comes to front.

**Flow F — Max 5 popups:**
Pop 5 tabs out. Open a 6th, press `Ctrl+Shift+M`. Nothing happens. `getAllPopups()` shows 5 entries.

- [ ] **Step 4: Commit**

```bash
git add src/background.ts background.js
git commit -m "feat: background.ts command handler, toolbar click, anchor message handler"
```

---

## Task 9: src/background.ts — Startup Validation

**Files:**
- Modify: `src/background.ts` (insert after constants, before state helpers)

- [ ] **Step 1: Insert validateStoredPopups after the MAX_POPUPS line**

```typescript
// ─── Startup Validation ───────────────────────────────────────────────────────
// On every service worker activation, prune any popup entries whose
// windows or tabs no longer exist (caused by crashes or mid-op SW restarts).

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

validateStoredPopups(); // Runs on every service worker activation
```

- [ ] **Step 2: Build**

```bash
pnpm run build
```

Expected: no errors.

- [ ] **Step 3: Verify orphan pruning**

1. Pop a tab out
2. In service worker console, inject a fake orphan:
   ```js
   getAllPopups().then(p => {
     p[99999] = { popupWindowId: 99999, popupTabId: 99998, anchorTabId: 99997,
                  originalWindowId: 1, originalIndex: 0, tabTitle: 'Orphan',
                  tabFavicon: '', tabUrl: 'https://example.com', color: '#f4511e' };
     chrome.storage.session.set({ popups: p });
   });
   ```
3. Confirm two entries: `getAllPopups().then(p => console.log(Object.keys(p)))`
4. Force SW restart: disable then re-enable extension at `chrome://extensions/`
5. Re-open service worker console
6. `getAllPopups().then(p => console.log(Object.keys(p)))`
   Expected: only the real popup entry; `99999` is gone

- [ ] **Step 4: Commit**

```bash
git add src/background.ts background.js
git commit -m "feat: background.ts startup validation — prune orphaned popup state"
```

---

## Task 10: src/background.ts — onRemoved, onUpdated, onBoundsChanged

**Files:**
- Modify: `src/background.ts` (append)

- [ ] **Step 1: Append the three event handlers**

```typescript
// ─── Tab Removed ─────────────────────────────────────────────────────────────
// Case 1: Popup window X-closed → recreate tab from saved URL at anchor position
// Case 2: Anchor tab manually closed → treat as "Return tab here"

chrome.tabs.onRemoved.addListener(async (tabId: number, removeInfo) => {
  // Case 1: popup tab removed because its window was X-closed
  const popupEntry = await getPopupByPopupTabId(tabId);
  if (popupEntry && removeInfo.isWindowClosing) {
    let anchorIndex = popupEntry.originalIndex;
    try {
      const anchorTab = await chrome.tabs.get(popupEntry.anchorTabId);
      anchorIndex = anchorTab.index;
    } catch { /* anchor gone */ }

    // Recreate tab from saved URL — scroll/JS state is lost (expected per spec)
    try {
      await chrome.tabs.create({
        url: popupEntry.tabUrl,
        index: anchorIndex,
        windowId: popupEntry.originalWindowId,
        active: true,
      });
    } catch {
      // Original window also closed — open in any window
      await chrome.tabs.create({ url: popupEntry.tabUrl });
    }

    try { await chrome.tabs.remove(popupEntry.anchorTabId); } catch { /* already gone */ }
    await removePopup(popupEntry.popupWindowId);
    return;
  }

  // Case 2: anchor tab manually closed → return the popup tab
  const anchorEntry = await getPopupByAnchorTabId(tabId);
  if (anchorEntry) {
    try {
      const win = await chrome.windows.get(anchorEntry.popupWindowId);
      await chrome.storage.local.set({
        lastPopupPosition: { left: win.left, top: win.top },
      });
    } catch {}

    let targetWindowId = anchorEntry.originalWindowId;
    try {
      await chrome.windows.get(anchorEntry.originalWindowId);
    } catch {
      const newWindow = await chrome.windows.create({ type: 'normal' });
      targetWindowId = newWindow.id!;
    }

    try {
      await chrome.tabs.move(anchorEntry.popupTabId, {
        windowId: targetWindowId,
        index: anchorEntry.originalIndex,
      });
      await chrome.tabs.update(anchorEntry.popupTabId, { active: true });
    } catch {}

    try { await chrome.windows.remove(anchorEntry.popupWindowId); } catch {}
    await removePopup(anchorEntry.popupWindowId);
  }
});

// ─── Tab Updated — track URL changes inside popup ────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId: number, changeInfo) => {
  if (!changeInfo.url) return;
  const entry = await getPopupByPopupTabId(tabId);
  if (!entry) return;
  await addPopup({ ...entry, tabUrl: changeInfo.url });
});

// ─── Window Bounds Changed — persist popup position ──────────────────────────

chrome.windows.onBoundsChanged.addListener(async (win) => {
  const entry = await getPopupByWindowId(win.id!);
  if (!entry) return;
  await chrome.storage.local.set({
    lastPopupPosition: { left: win.left, top: win.top },
  });
});
```

- [ ] **Step 2: Build**

```bash
pnpm run build
```

Expected: no errors.

- [ ] **Step 3: Test X-close fallback**

1. Reload extension, pop out `https://example.com`
2. Click the red X on the popup window
3. Expected: new tab at anchor's position loading `https://example.com` (fresh reload), anchor disappears, `getAllPopups()` → `{}`

- [ ] **Step 4: Test anchor tab manually closed**

1. Pop a tab out
2. Right-click the anchor tab → Close tab
3. Expected: popup closes, original tab returns to anchor's position and activates

- [ ] **Step 5: Test URL tracking**

1. Pop out `https://example.com`
2. Inside popup, navigate to `https://iana.org`
3. `getAllPopups().then(p => console.log(Object.values(p)[0].tabUrl))`
   Expected: `https://www.iana.org/`
4. Close popup with X
5. Expected: tab recreated at anchor position loading `https://www.iana.org/` (not the original URL)

- [ ] **Step 6: Test position memory**

1. Pop a tab out
2. Drag popup to a different screen position
3. Return the tab
4. Pop another tab out
5. Expected: new popup opens at the dragged position, not the default

- [ ] **Step 7: Commit**

```bash
git add src/background.ts background.js
git commit -m "feat: background.ts onRemoved, onUpdated, onBoundsChanged handlers"
```

---

## Task 11: Integration Test Checklist

- [ ] **Scenario 1: Shortcut with 5 popups already open**
Open 5 tabs, pop each. Open a 6th, press `Ctrl+Shift+M`. Nothing happens.

- [ ] **Scenario 2: Original window closed while popup open**
Pop a tab. Close the entire original window. Press `Ctrl+Shift+M` with popup focused.
Expected: Chrome creates a new window containing the returned tab.

- [ ] **Scenario 3: Multiple simultaneous popups — colors distinct**
Pop 3 tabs from the same window. Confirm 3 different color bars on the anchor tabs.
Return each one — each returns to its own anchor position.

- [ ] **Scenario 4: Golden path — state preserved through popup session**
1. Navigate to `https://news.ycombinator.com`
2. Press `Ctrl+Shift+M`
3. Inside popup, scroll down and click a story link (page navigates)
4. Press `Ctrl+Shift+M` with popup focused
5. Expected: story page (not HN homepage) returns to original position; `getAllPopups()` → `{}`

- [ ] **Scenario 5: Startup validation with live popups**
1. Pop 2 tabs out
2. Disable then re-enable extension
3. Click "Return tab here" on each anchor
4. Expected: both tabs return correctly (session storage survives re-enable; SW validated on restart)

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat: Tether extension v1.0 — complete implementation"
```

---

## Future Enhancements (not in v1)

### Page context menu ("Tether this tab")
- `contextMenus` permission already in `manifest.json`
- Add `chrome.contextMenus.create` in background on install event
- Right-click on page content → "Tether this tab" → calls `popOut(tab)`
- Limitation: Chrome does not expose the tab strip context menu to extensions — only page content

### Auto-tether on drag
When a user drags a tab out to create a new window, automatically convert it to a tether popup. Configurable via an options page.

Implementation sketch:
1. `chrome.tabs.onDetached` fires: record `{ tabId, oldWindowId, oldPosition, timestamp }`
2. `chrome.windows.onCreated` fires with `type === 'normal'`: if it occurred within ~300ms of a matching detach, intercept
3. Get the new window's bounds, create a tether popup at those bounds, move the tab in, close the normal window, create anchor in the old window
4. Requires: options page toggle — `chrome.storage.local: { autoTetherDrags: false }` default off
5. "Ask first" variant is not feasible (no modal in browser chrome). Auto-convert + `chrome.notifications` toast: "Tab tethered — press Ctrl+Shift+M to return"
6. Scope: implement after v1 is stable and tested
