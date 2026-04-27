# tether-extension
A Chrome extension that pops a tab into a focused popup window and holds its place so it snaps back exactly where it left.

## Usage

### Pop a tab out
Press `Ctrl+K` (Windows) / `Cmd+K` (Mac) on any tab to pop it into a focused popup window. The original tab is replaced by a color-coded anchor placeholder that holds its position in the tab bar.

### Return a tab
Click the **Return** button on the anchor placeholder (or press the shortcut again while focused on the popup) to snap the tab back to its original position. The popup closes and the anchor disappears.

### Color coding
Each popup is assigned one of 5 colors. A matching colored dot appears in both the popup window's title and the anchor tab so you can tell which belongs to which at a glance. Up to 5 popups can be open simultaneously.

### Options
Right-click the Tether toolbar icon → **Options** to configure behavior.

**Auto-tether dragged tabs** — when enabled, any tab you drag out of a Chrome window into its own new window is automatically tethered: it becomes a popup and an anchor placeholder is left behind, exactly as if you had used the shortcut. Disabled by default.

---

## File Map

| File | Responsibility |
|------|----------------|
| `manifest.json` | Extension config, permissions, `Ctrl+K` shortcut (`Cmd+K` on Mac), action icon |
| `src/types.ts` | Shared TypeScript interfaces (`PopupEntry`, `PopupsMap`, `PopupBounds`) — erased at compile time, no runtime output |
| `src/background.ts` | Service worker source — all logic: state, pop-out, return, focus, events, startup validation |
| `src/anchor.ts` | Anchor tab source — reads `popupWindowId` from URL hash, renders state, button handlers |
| `background.js` | **Compiled from `src/background.ts` — do not edit directly** |
| `anchor.js` | **Compiled from `src/anchor.ts` — do not edit directly** |
| `anchor.html` | Anchor tab markup |
| `anchor.css` | Anchor tab styling — muted, placeholder-like, color accent bar at top |
| `icons/icon{16,48,128}.png` | Tether chain-link icons |
| `tsconfig.json` | TypeScript compiler config — `src/` in, root out, strict mode |
| `package.json` | Dev dependencies (`typescript`, `@types/chrome`) and build scripts |

## Development

```bash
pnpm install        # install dependencies
pnpm run build      # compile TypeScript once
pnpm run watch      # recompile on save
```

Compiled `.js` files are committed alongside source so the repo root can be loaded directly as an unpacked Chrome extension at `chrome://extensions/`.
