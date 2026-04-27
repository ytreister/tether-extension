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
