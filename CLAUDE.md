# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm run build   # compile src/*.ts → root *.js (one-shot)
pnpm run watch   # compile in watch mode during development
```

There are no test or lint scripts. TypeScript strict mode (`strict: true`) is the primary correctness check.

To develop: run `pnpm run watch`, then load the repo root as an unpacked extension in Chrome (`chrome://extensions` → Load unpacked). Reload the extension after each recompile.

## Architecture

Tether is a **Manifest V3 Chrome extension** with no bundler — plain `tsc` compiles `src/*.ts` to CommonJS `.js` files committed at the repo root. Two runtimes:

### Service Worker (`src/background.ts` → `background.js`)
All business logic lives here. Entry points:
- `chrome.commands.onCommand` / `chrome.action.onClicked` → `handlePopCommand()`
- `chrome.runtime.onMessage` — handles `getState`, `returnTab`, `focusPopup` from anchor pages
- `chrome.tabs.onUpdated`, `chrome.windows.onBoundsChanged`, `chrome.tabs.onRemoved`, `chrome.windows.onRemoved` — reactive state sync and cleanup

### Anchor Page (`src/anchor.ts` → `anchor.js`, `anchor.html`)
Rendered as a placeholder tab in the original window. Loaded as `anchor.html#<popupWindowId>`. Communicates with the service worker via `chrome.runtime.sendMessage`.

### Shared (`src/types.ts`, `src/consts.ts`)
Pure TypeScript types and constants. `PopupEntry` is the central state record; `PopupsMap` (keyed by popup window ID) is stored in `chrome.storage.session`.

## Key Flows

**Pop-out** (`handlePopCommand` → `popOut`): captures active tab URL, creates a new popup window, injects a color dot into the popup title/favicon via `execDot()` + `MutationObserver`, closes the original tab, and opens an anchor tab in its place.

**Return** (`returnTab`): saves popup bounds to `chrome.storage.local`, recreates the tab in the original window at the anchor's current index, then closes both the popup window and anchor tab.

**Cleanup**: closing the popup window symmetrically closes the anchor tab, and vice versa. Race conditions are avoided by deleting from `chrome.storage.session` *before* closing the related window/tab so the removal listeners don't trigger the opposite cleanup.

**State sync**: `chrome.tabs.onUpdated` tracks URL/title/favicon changes in popup tabs, updates `chrome.storage.session`, and sends a `refreshState` message to the anchor tab.

## Specs & Plans

Design specs and implementation plans live in `.claude/superpowers/` (moved from `docs/superpowers/` to keep `docs/` clean for GitHub Pages).

## Important Constraints

- **Max 5 simultaneous popups** — enforced in `handlePopCommand`; also drives the 5-color system (`COLOR_DOTS` in `src/consts.ts`).
- **Compiled JS is committed** — after editing `src/`, always run `pnpm run build` and commit both the `.ts` source and the compiled `.js`.
- **No bundler** — keep imports as relative paths; circular imports between background and anchor are impossible at runtime (different runtimes).
- **MV3 service worker** — no persistent background page; the worker can be suspended. Avoid relying on in-memory state across activations; use `chrome.storage.session` instead.
