import { useMemo, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { useAppData } from "../../../appData";
import type { ApkgFieldMapping } from "../../../ankiImport/fieldMapping";
import {
  applyFieldMapping,
  mappingIsValid,
  suggestFieldMappings,
  withToggledField,
} from "../../../ankiImport/fieldMapping";
import { importParsedApkgNotes } from "../../../ankiImport/importApkgNotes";
import type { ParsedApkgDeck } from "../../../ankiImport/parseApkg";
import { useI18n } from "../../../i18n";
import { SettingsActionCard } from "../SettingsShared";

function truncatePreview(value: string, max = 160): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, max - 1)}…`;
}

export function ApkgImportPanel(): ReactElement {
  const { activeWorkspace, createCardItem, createDeckItem } = useAppData();
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [parsedDeck, setParsedDeck] = useState<ParsedApkgDeck | null>(null);
  const [mappings, setMappings] = useState<ApkgFieldMapping[]>([]);
  const [progressLabel, setProgressLabel] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const canConfirmImport = useMemo(
    () => mappings.length > 0 && mappings.every((mapping) => mappingIsValid(mapping)),
    [mappings],
  );

  function resetMappingState(): void {
    setParsedDeck(null);
    setMappings([]);
  }

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

    setIsBusy(true);
    setStatusMessage("");
    setErrorMessage("");
    setProgressLabel(t("ankiImport.parsing"));
    resetMappingState();

    try {
      const { parseApkgFile } = await import("../../../ankiImport/parseApkg");
      const parsed = await parseApkgFile(file);
      setParsedDeck(parsed);
      setMappings(suggestFieldMappings(parsed.models));
      setProgressLabel("");
    } catch (error) {
      setProgressLabel("");
      setErrorMessage(
        error instanceof Error && error.message !== ""
          ? error.message
          : t("ankiImport.failed"),
      );
    } finally {
      setIsBusy(false);
    }
  }

  function updateMapping(modelId: string, next: ApkgFieldMapping): void {
    setMappings((current) =>
      current.map((mapping) => (mapping.modelId === modelId ? next : mapping)),
    );
  }

  async function handleConfirmImport(): Promise<void> {
    if (parsedDeck === null || canConfirmImport === false || activeWorkspace === null) {
      return;
    }

    setIsBusy(true);
    setStatusMessage("");
    setErrorMessage("");
    setProgressLabel(t("ankiImport.importing", { count: String(parsedDeck.notes.length) }));

    try {
      const result = await importParsedApkgNotes({
        parsed: parsedDeck,
        mappings,
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
          skippedEmpty: String(result.skippedEmptyCount),
          skippedUnmapped: String(result.skippedUnmappedCount),
          cloze: String(result.clozeNoteCount),
        }),
      );
      setProgressLabel("");
      resetMappingState();
    } catch (error) {
      setProgressLabel("");
      setErrorMessage(
        error instanceof Error && error.message !== ""
          ? error.message
          : t("ankiImport.failed"),
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <>
      <SettingsActionCard
        title={t("ankiImport.settingsTitle")}
        description={t("ankiImport.settingsDescription")}
        value={isBusy ? t("common.loading") : t("ankiImport.settingsValue")}
        disabled={isBusy}
        onClick={() => {
          if (isBusy) {
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

      {parsedDeck === null ? null : (
        <section
          className="workspace-import-preview"
          data-testid="settings-anki-import-mapping"
        >
          <div className="workspace-import-preview-stats">
            <div className="workspace-import-preview-stat">
              <span className="subtitle">{t("ankiImport.previewSourceLabel")}</span>
              <strong>{parsedDeck.sourceFileName}</strong>
            </div>
            <div className="workspace-import-preview-stat">
              <span className="subtitle">{t("ankiImport.previewNotesLabel")}</span>
              <strong>{parsedDeck.notes.length}</strong>
            </div>
            <div className="workspace-import-preview-stat">
              <span className="subtitle">{t("ankiImport.previewModelsLabel")}</span>
              <strong>{parsedDeck.models.length}</strong>
            </div>
          </div>

          <p className="subtitle">{t("ankiImport.mappingHint")}</p>

          {parsedDeck.models.map((model) => {
            const mapping = mappings.find((item) => item.modelId === model.id);
            if (mapping === undefined) {
              return null;
            }

            const sampleNote = parsedDeck.notes.find((note) => note.modelId === model.id);
            const preview =
              sampleNote === undefined
                ? null
                : applyFieldMapping(sampleNote, mapping);

            return (
              <article
                key={model.id}
                className="content-card"
                data-testid={`settings-anki-import-model-${model.id}`}
                style={{ display: "grid", gap: 12, padding: 16 }}
              >
                <div className="settings-nav-card-copy">
                  <strong className="panel-subtitle">
                    {model.name}
                    {model.type === 1 ? ` (${t("ankiImport.clozeLabel")})` : ""}
                  </strong>
                  <p className="subtitle">
                    {t("ankiImport.modelNoteCount", { count: String(model.noteCount) })}
                  </p>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <strong className="subtitle">{t("ankiImport.frontFieldsLabel")}</strong>
                    <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                      {model.fieldNames.map((fieldName) => (
                        <label key={`front-${model.id}-${fieldName}`} className="workspace-import-tag-control">
                          <input
                            type="checkbox"
                            checked={mapping.frontFieldNames.includes(fieldName)}
                            disabled={isBusy}
                            data-testid={`settings-anki-import-front-${model.id}-${fieldName}`}
                            onChange={(event) => {
                              updateMapping(
                                model.id,
                                withToggledField(mapping, "front", fieldName, event.currentTarget.checked),
                              );
                            }}
                          />
                          <span>{fieldName}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <strong className="subtitle">{t("ankiImport.backFieldsLabel")}</strong>
                    <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                      {model.fieldNames.map((fieldName) => (
                        <label key={`back-${model.id}-${fieldName}`} className="workspace-import-tag-control">
                          <input
                            type="checkbox"
                            checked={mapping.backFieldNames.includes(fieldName)}
                            disabled={isBusy}
                            data-testid={`settings-anki-import-back-${model.id}-${fieldName}`}
                            onChange={(event) => {
                              updateMapping(
                                model.id,
                                withToggledField(mapping, "back", fieldName, event.currentTarget.checked),
                              );
                            }}
                          />
                          <span>{fieldName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {preview === null ? null : (
                  <div className="workspace-import-preview-stat" data-testid={`settings-anki-import-preview-${model.id}`}>
                    <span className="subtitle">{t("ankiImport.previewSampleLabel")}</span>
                    <p className="subtitle" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                      <strong>{t("ankiImport.previewFrontLabel")}</strong>
                      {": "}
                      {truncatePreview(preview.frontText) || t("ankiImport.previewEmpty")}
                    </p>
                    <p className="subtitle" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
                      <strong>{t("ankiImport.previewBackLabel")}</strong>
                      {": "}
                      {truncatePreview(preview.backText) || t("ankiImport.previewEmpty")}
                    </p>
                  </div>
                )}

                {mappingIsValid(mapping) ? null : (
                  <p className="error-banner" role="alert">
                    {t("ankiImport.frontRequired")}
                  </p>
                )}
              </article>
            );
          })}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              className="primary-btn"
              disabled={isBusy || canConfirmImport === false}
              data-testid="settings-anki-import-confirm"
              onClick={() => {
                void handleConfirmImport();
              }}
            >
              {t("ankiImport.confirmImport")}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={isBusy}
              data-testid="settings-anki-import-cancel"
              onClick={() => {
                resetMappingState();
                setProgressLabel("");
              }}
            >
              {t("ankiImport.cancelMapping")}
            </button>
          </div>
        </section>
      )}

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
