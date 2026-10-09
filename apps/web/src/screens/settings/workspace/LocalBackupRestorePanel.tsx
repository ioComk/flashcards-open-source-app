import { useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { useAppData } from "../../../appData";
import { useI18n } from "../../../i18n";
import {
  type LocalWorkspaceBackup,
  readLocalWorkspaceBackupFile,
} from "../../../localBackup/localWorkspaceBackupFormat";
import { SettingsActionCard } from "../SettingsShared";
import { WorkspaceActionDialog } from "./WorkspaceActionDialog";

type RestoreState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "reading" }>
  | Readonly<{ kind: "confirming"; backup: LocalWorkspaceBackup }>
  | Readonly<{ kind: "restoring"; backup: LocalWorkspaceBackup }>
  | Readonly<{ kind: "restored"; message: string }>
  | Readonly<{ kind: "failed"; message: string }>;

export function LocalBackupRestorePanel(): ReactElement {
  const { localCardCount, restoreLocalBackup } = useAppData();
  const { formatDateTime, t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const [state, setState] = useState<RestoreState>({ kind: "idle" });
  const dialogBackup = state.kind === "confirming" || state.kind === "restoring" ? state.backup : null;
  const isBusy = state.kind === "reading" || state.kind === "restoring";

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (file === null) {
      return;
    }

    setState({ kind: "reading" });
    try {
      const result = await readLocalWorkspaceBackupFile(file);
      switch (result.kind) {
        case "ready":
          setState({ kind: "confirming", backup: result.backup });
          return;
        case "not_backup":
          setState({ kind: "failed", message: t("localBackup.restoreNotBackup") });
          return;
        case "damaged":
          setState({ kind: "failed", message: t("localBackup.restoreDamaged", { field: result.fieldPath }) });
          return;
      }
    } catch (error) {
      console.error("Local backup file read failed", error);
      setState({ kind: "failed", message: t("localBackup.restoreReadFailed") });
    }
  }

  async function handleConfirmRestore(): Promise<void> {
    if (state.kind !== "confirming") {
      return;
    }

    const { backup } = state;
    setState({ kind: "restoring", backup });
    try {
      const result = await restoreLocalBackup(backup);
      setState({
        kind: "restored",
        message: result.kind === "restored"
          ? t("localBackup.restoreSucceeded", {
            cards: String(backup.summary.activeCardCount),
            decks: String(backup.summary.activeDeckCount),
            reviews: String(backup.summary.reviewEventCount),
          })
          : t("localBackup.restoreNeedsReload"),
      });
    } catch (error) {
      console.error("Local backup restore failed", error);
      setState({ kind: "failed", message: t("localBackup.restoreFailed") });
    }
  }

  return (
    <>
      <SettingsActionCard
        title={t("localBackup.restoreTitle")}
        description={t("localBackup.restoreDescription")}
        value={isBusy ? t("common.loading") : t("localBackup.restoreValue")}
        disabled={isBusy}
        onClick={() => {
          fileInputRef.current?.click();
        }}
        testId="settings-row-local-backup-restore"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="local-backup-restore-file"
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />
      {state.kind === "restored" ? (
        <p className="settings-temporary-banner" role="status" data-testid="settings-local-backup-restore-status">
          {state.message}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <p className="error-banner" role="alert" data-testid="settings-local-backup-restore-error">
          {state.message}
        </p>
      ) : null}

      <WorkspaceActionDialog
        isOpen={dialogBackup !== null}
        titleId="local-backup-restore-dialog-title"
        title={t("localBackup.restoreConfirmTitle")}
        descriptionId="local-backup-restore-dialog-description"
        description={dialogBackup === null ? "" : t("localBackup.restoreConfirmBody", {
          exportedAt: formatDateTime(dialogBackup.exportedAt),
          cards: String(dialogBackup.summary.activeCardCount),
          decks: String(dialogBackup.summary.activeDeckCount),
          reviews: String(dialogBackup.summary.reviewEventCount),
          currentCards: String(localCardCount),
        })}
        testId="local-backup-restore-dialog"
        initialFocusRef={cancelButtonRef}
        operationReturnFocusRef={confirmButtonRef}
        isOperationSubmitting={state.kind === "restoring"}
        onDismiss={() => setState({ kind: "idle" })}
      >
        {dialogBackup === null || dialogBackup.summary.mediaLinkedCardCount === 0 ? null : (
          <p className="subtitle">
            {t("localBackup.restoreConfirmMedia", { count: String(dialogBackup.summary.mediaLinkedCardCount) })}
          </p>
        )}
        {state.kind === "restoring" ? <p className="subtitle" role="status">{t("common.loading")}</p> : null}
        <div className="screen-actions">
          <button
            ref={cancelButtonRef}
            className="ghost-btn"
            type="button"
            onClick={() => setState({ kind: "idle" })}
            disabled={state.kind === "restoring"}
          >
            {t("common.cancel")}
          </button>
          <button
            ref={confirmButtonRef}
            className="primary-btn"
            type="button"
            onClick={() => {
              void handleConfirmRestore();
            }}
            disabled={state.kind === "restoring"}
          >
            {t("localBackup.restoreConfirmAction")}
          </button>
        </div>
      </WorkspaceActionDialog>
    </>
  );
}
