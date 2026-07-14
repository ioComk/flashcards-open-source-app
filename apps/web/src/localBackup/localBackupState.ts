const pendingStorageKey = "flashcards-local-backup-pending";
const lastSavedStorageKey = "flashcards-local-backup-last-saved-at";

function getBrowserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isLocalBackupPending(): boolean {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return false;
  }

  return browserStorage.getItem(pendingStorageKey) === "1";
}

export function markLocalBackupPending(): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return;
  }

  browserStorage.setItem(pendingStorageKey, "1");
  window.dispatchEvent(new Event("flashcards-local-backup-changed"));
}

export function clearLocalBackupPending(): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return;
  }

  browserStorage.removeItem(pendingStorageKey);
  window.dispatchEvent(new Event("flashcards-local-backup-changed"));
}

export function loadLocalBackupLastSavedAt(): string | null {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return null;
  }

  const value = browserStorage.getItem(lastSavedStorageKey);
  return value === null || value === "" ? null : value;
}

export function storeLocalBackupLastSavedAt(savedAt: string): void {
  const browserStorage = getBrowserStorage();
  if (browserStorage === null) {
    return;
  }

  browserStorage.setItem(lastSavedStorageKey, savedAt);
  clearLocalBackupPending();
}
