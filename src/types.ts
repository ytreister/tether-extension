// Shared types used by both the service worker and the anchor tab page.

export interface PopupEntry {
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

export type PopupsMap = Record<number, PopupEntry>;

export interface PopupBounds {
  width: number;
  height: number;
  left: number;
  top: number;
}
