// src/background.ts
// Service worker — all business logic for the Tether extension.

import type { PopupEntry, PopupsMap, PopupBounds } from './types';

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
    left: saved?.left ?? 100,
    top: saved?.top ?? 100,
  };
}
