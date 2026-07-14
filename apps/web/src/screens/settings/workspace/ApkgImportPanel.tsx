import { useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { useAppData } from "../../../appData";
import { importParsedApkgNotes } from "../../../ankiImport/importApkgNotes";
import { useI18n } from "../../../i18n";
import { SettingsActionCard } from "../SettingsShared";

export function ApkgImportPanel(): ReactElement {
  const { activeWorkspace, createCardItem, createDeckItem } = useAppData();
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [progressLabel, setProgressLabel] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (file === null) {
      return;
    }

    if (activeWorkspace === null) {
      setErrorMessage(t("ankiImport.workspaceUnavailable"));
      return;
    }

    if (file.name.toLowerCase().endsWith(".apkg") === false) {
      setErrorMessage(t("ankiImport.invalidFile"));
      return;
    }

    setIsImporting(true);
    setStatusMessage("");
    setErrorMessage("");
    setProgressLabel(t("ankiImport.parsing"));

    try {
      const { parseApkgFile } = await import("../../../ankiImport/parseApkg");
      const parsed = await parseApkgFile(file);
      setProgressLabel(t("ankiImport.importing", { count: String(parsed.notes.length) }));

      const result = await importParsedApkgNotes({
        parsed,
        createCardItem,
        createDeckItem,
        onProgress: (progress) => {
          setProgressLabel(
            t("ankiImport.progress", {
              imported: String(progress.importedCount),
              total: String(progress.totalCount),
            }),
          );
        },
      });

      setStatusMessage(
        t("ankiImport.success", {
          imported: String(result.importedCount),
          deck: result.deckName,
          skippedCloze: String(result.skippedClozeCount),
          skippedEmpty: String(result.skippedEmptyCount),
        }),
      );
      setProgressLabel("");
    } catch (error) {
      setProgressLabel("");
      setErrorMessage(error instanceof Error && error.message !== ""
        ? error.message
        : t("ankiImport.failed"));
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <>
      <SettingsActionCard
        title={t("ankiImport.settingsTitle")}
        description={t("ankiImport.settingsDescription")}
        value={isImporting ? t("common.loading") : t("ankiImport.settingsValue")}
        onClick={() => {
          if (isImporting) {
            return;
          }

          fileInputRef.current?.click();
        }}
        testId="settings-row-anki-import"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".apkg,application/octet-stream,application/zip"
        hidden
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />
      {progressLabel === "" ? null : (
        <p className="settings-temporary-banner" role="status" data-testid="settings-anki-import-progress">
          {progressLabel}
        </p>
      )}
      {statusMessage === "" ? null : (
        <p className="settings-temporary-banner" role="status" data-testid="settings-anki-import-status">
          {statusMessage}
        </p>
      )}
      {errorMessage === "" ? null : (
        <p className="error-banner" role="alert" data-testid="settings-anki-import-error">
          {errorMessage}
        </p>
      )}
    </>
  );
}
