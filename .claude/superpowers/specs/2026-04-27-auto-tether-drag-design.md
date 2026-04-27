# Auto-Tether on Drag — Design Spec

**Date:** 2026-04-27
**Feature:** Automatically convert tab drag-outs into tether popups when the feature is enabled.

---

## Overview

When a user drags a tab out of a window to create a new standalone window, Tether intercepts the action and converts the result into a tether popup — same as pressing `Ctrl+Shift+M`. An "Undo" notification lets the user reverse it immediately. The feature is off by default and toggled via an options page.

---

## Detection: Detach + Attach Correlation (Approach A)

Drag-out detection uses a two-event correlation:

1. **`chrome.tabs.onDetached`** fires when a tab leaves a window. Store `{ tabId, oldWindowId, oldPosition }` in a module-level `Map<number, PendingDetach>` (in-memory only — no persistence needed).

2. **`chrome.tabs.onAttached`** fires when the tab lands in its new window. Look up the tabId in the pending map. If found, call `chrome.windows.get(newWindowId, { populate: true })`:
   - If the window has **exactly 1 tab** and type `'normal'` → this is a drag-to-new-window.
   - Otherwise (tab moved to existing window) → discard the pending entry and do nothing.

3. Call `autoTether()` with the detach info and the new window reference. Clear the pending entry.

**Why not timing-based:** Service worker wake latency makes 300ms windows unreliable. The single-tab normal-window check is a deterministic signal.

**Edge case — feature disabled:** When `autoTetherDrags` is `false`, `tabs.onDetached` never populates the pending map. No behavior change.

**Edge case — MAX_POPUPS reached:** If already at 5 tethered popups, skip conversion (normal window stays as-is), fire a notification explaining the limit — same as the existing shortcut behavior.

**Edge case — tab is a chrome:// or restricted URL:** `popOut()` already skips these silently; `autoTether()` inherits the same guard.

---

## Conversion: autoTether()

`autoTether(tab, oldWindowId, oldPosition, newWindow)` mirrors `popOut()` with one difference: instead of using `getPopupBounds()` for position/size, it reuses the drag-created normal window's own bounds so the popup appears exactly where the user dropped it.

Steps:
1. Capture `newWindow.left`, `newWindow.top`, `newWindow.width`, `newWindow.height`.
2. Create popup window at those bounds with the tab's current URL (page reloads — same constraint as `popOut()`).
3. Close the normal window (removes the dragged tab with it).
4. Create the anchor tab in `oldWindowId` at `oldPosition`.
5. Call `addPopup()` to register state.
6. Inject the color-dot title/favicon marker into the new popup tab (same `execDot` path).
7. Fire the undo notification.
8. Save popup position to `lastPopupPosition` (reuses existing bounds-persist logic).

---

## Undo Notification

After conversion, fire `chrome.notifications.create`:

```
Title:   "Tab tethered"
Message: <tab title>
Buttons: ["Undo"]
```

State: a module-level `Map<string, number>` maps `notificationId → popupWindowId`.

- **`chrome.notifications.onButtonClicked`** (button 0 = Undo): look up the popup entry via `getPopupByWindowId(popupWindowId)`, get the anchor tab's current index via `chrome.tabs.get(entry.anchorTabId)`, then call `returnTab(popupWindowId, anchorIndex)`. Clear map entry.
- **`chrome.notifications.onClosed`**: clear map entry (leak prevention).

If the service worker restarts before Undo is clicked, the notification disappears and the tether remains — the user can still use `Ctrl+Shift+M` to return. This is acceptable behavior.

---

## Options Page

**New files:** `options.html`, `src/options.ts` → `options.js`

**`manifest.json` addition:**
```json
"options_ui": {
  "page": "options.html",
  "open_in_tab": true
}
```

**UI:** Single checkbox — "Automatically tether tabs dragged into new windows" — wired to `chrome.storage.local` key `autoTetherDrags` (boolean, default `false`). Reads on load, writes on change.

**Storage:** `autoTetherDrags` lives in `storage.local` alongside existing `lastPopupPosition`. No new storage area.

---

## Files Changed

| File | Change |
|------|--------|
| `src/background.ts` | Add `PendingDetach` type, pending map, `autoTether()`, `tabs.onDetached` handler, add `tabs.onAttached` handler (new), notification map + listeners |
| `src/types.ts` | Add `PendingDetach` interface |
| `src/options.ts` | New — options page script |
| `options.html` | New — options page markup |
| `manifest.json` | Add `options_ui` |

---

## Out of Scope

- Options for max popup count, default popup size, color palette — future work.
- "Ask first" confirmation dialog — not feasible in Chrome extension context.
- Auto-tether on drag to existing window — intentionally excluded (only new-window drags are intercepted).
