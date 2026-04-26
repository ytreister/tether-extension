# tether-extension
A Chrome extension that pops a tab into a focused popup window and holds its place so it snaps back exactly where it left.

## File Map

| File | Responsibility |
|------|----------------|
| `manifest.json` | Extension config, permissions, `Ctrl+Shift+M` shortcut, action icon |
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
