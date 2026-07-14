import { useCallback, useEffect, useState } from "react";
import {
  clearLocalBackupPending,
  isLocalBackupPending,
  loadLocalBackupLastSavedAt,
  markLocalBackupPending,
} from "./localBackupState";
import { saveLocalBackupFile } from "./saveLocalBackupFile";

export type LocalBackupController = Readonly<{
  isPending: boolean;
  lastSavedAt: string | null;
  isSaving: boolean;
  statusMessage: string;
  errorMessage: string;
  markPending: () => void;
  dismissPending: () => void;
  saveBackup: (workspaceId: string) => Promise<void>;
}>;

export function useLocalBackupController(
  translate: (key: "localBackup.saved" | "localBackup.saveFailed" | "localBackup.shareOpened") => string,
): LocalBackupController {
  const [isPending, setIsPending] = useState<boolean>(() => isLocalBackupPending());
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(() => loadLocalBackupLastSavedAt());
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    const syncFromStorage = (): void => {
      setIsPending(isLocalBackupPending());
      setLastSavedAt(loadLocalBackupLastSavedAt());
    };

    window.addEventListener("flashcards-local-backup-changed", syncFromStorage);
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener("flashcards-local-backup-changed", syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  const markPending = useCallback(function markPending(): void {
    markLocalBackupPending();
    setIsPending(true);
  }, []);

  const dismissPending = useCallback(function dismissPending(): void {
    clearLocalBackupPending();
    setIsPending(false);
  }, []);

  const saveBackup = useCallback(async function saveBackup(workspaceId: string): Promise<void> {
    setIsSaving(true);
    setStatusMessage("");
    setErrorMessage("");
    try {
      const result = await saveLocalBackupFile(workspaceId);
      setIsPending(false);
      setLastSavedAt(loadLocalBackupLastSavedAt());
      setStatusMessage(result.shared ? translate("localBackup.shareOpened") : translate("localBackup.saved"));
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message !== ""
        ? error.message
        : translate("localBackup.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [translate]);

  return {
    isPending,
    lastSavedAt,
    isSaving,
    statusMessage,
    errorMessage,
    markPending,
    dismissPending,
    saveBackup,
  };
}
