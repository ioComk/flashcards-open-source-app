import {
  buildLocalBackupFilename,
  buildLocalWorkspaceBackup,
} from "./buildLocalWorkspaceBackup";
import { storeLocalBackupLastSavedAt } from "./localBackupState";

function triggerBlobDownload(blob: Blob, filename: string): void {
  if (document.body === null) {
    throw new Error(`Document body is unavailable for backup download: filename=${filename}`);
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

async function shareBackupFile(file: File): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };

  if (typeof nav.share !== "function") {
    return false;
  }

  const shareData: ShareData = {
    files: [file],
    title: file.name,
  };

  if (typeof nav.canShare === "function" && nav.canShare(shareData) === false) {
    return false;
  }

  try {
    await nav.share(shareData);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return false;
    }

    throw error;
  }
}

export async function saveLocalBackupFile(workspaceId: string): Promise<Readonly<{
  filename: string;
  shared: boolean;
}>> {
  const backup = await buildLocalWorkspaceBackup(workspaceId);
  const filename = buildLocalBackupFilename(backup.exportedAt);
  const json = `${JSON.stringify(backup, null, 2)}\n`;
  const blob = new Blob([json], { type: "application/json" });
  const file = new File([blob], filename, { type: "application/json" });

  const shared = await shareBackupFile(file);
  if (shared === false) {
    triggerBlobDownload(blob, filename);
  }

  storeLocalBackupLastSavedAt(backup.exportedAt);
  return {
    filename,
    shared,
  };
}
