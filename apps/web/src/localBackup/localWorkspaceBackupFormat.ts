import { ApiContractError, parseArray, parseObject, parseRequiredField, parseString } from "../apiContracts/core";
import {
  parseCard,
  parseDeck,
  parseReviewEvent,
  parseWorkspaceSchedulerSettings,
} from "../apiContracts/studyData";
import {
  loadWorkspaceSettings,
  type PortableWorkspaceContent,
  replaceWorkspaceContent,
} from "../localDb/cards/workspace";
import {
  closeDatabaseAfter,
  getAllFromStore,
  type StoredCard,
} from "../localDb/core/database";
import { loadLocalWorkspaceSummary } from "../localDb/meta/localWorkspace";
import { loadCloudSettings } from "../localDb/sync/cloudSettings";
import { extractManagedMediaAssetIdsFromMarkdown } from "../media/managedMediaMarkdown";
import type { Deck, ReviewEvent, WorkspaceSchedulerSettings, WorkspaceSummary } from "../types";

export const localWorkspaceBackupFormat = "flashcards-local-backup-v1";

export type LocalWorkspaceBackupDocument = Readonly<{
  format: typeof localWorkspaceBackupFormat;
  exportedAt: string;
  workspace: WorkspaceSummary;
  cloudInstallationId: string | null;
  schedulerSettings: WorkspaceSchedulerSettings | null;
  cards: ReadonlyArray<StoredCard>;
  decks: ReadonlyArray<Deck>;
  reviewEvents: ReadonlyArray<ReviewEvent>;
}>;

export type LocalWorkspaceBackup = Readonly<{
  exportedAt: string;
  summary: Readonly<{
    activeCardCount: number;
    activeDeckCount: number;
    reviewEventCount: number;
    mediaLinkedCardCount: number;
  }>;
}>;

export type LocalWorkspaceBackupFileReadResult =
  | Readonly<{ kind: "ready"; backup: LocalWorkspaceBackup }>
  | Readonly<{ kind: "not_backup" }>
  | Readonly<{ kind: "damaged"; fieldPath: string }>;

const preparedBackupContents = new WeakMap<LocalWorkspaceBackup, PortableWorkspaceContent>();

export async function buildLocalWorkspaceBackup(workspaceId: string): Promise<LocalWorkspaceBackupDocument> {
  const [workspace, cloudSettings, schedulerSettings, cards, decks, reviewEvents] = await Promise.all([
    loadLocalWorkspaceSummary(),
    loadCloudSettings(),
    loadWorkspaceSettings(workspaceId),
    closeDatabaseAfter(async (database) => {
      const allCards = await getAllFromStore<StoredCard>(database, "cards");
      return allCards.filter((card) => card.workspaceId === workspaceId);
    }),
    closeDatabaseAfter(async (database) => {
      const allDecks = await getAllFromStore<Deck>(database, "decks");
      return allDecks.filter((deck) => deck.workspaceId === workspaceId);
    }),
    closeDatabaseAfter(async (database) => {
      const allReviewEvents = await getAllFromStore<ReviewEvent>(database, "reviewEvents");
      return allReviewEvents.filter((reviewEvent) => reviewEvent.workspaceId === workspaceId);
    }),
  ]);

  const resolvedWorkspace: WorkspaceSummary = workspace ?? {
    workspaceId,
    name: "Personal",
    createdAt: new Date(0).toISOString(),
    isSelected: true,
  };

  return {
    format: localWorkspaceBackupFormat,
    exportedAt: new Date().toISOString(),
    workspace: resolvedWorkspace,
    cloudInstallationId: cloudSettings?.installationId ?? null,
    schedulerSettings,
    cards,
    decks,
    reviewEvents,
  };
}

export function buildLocalBackupFilename(exportedAt: string): string {
  const stamp = exportedAt.replace(/[:.]/g, "-");
  return `flashcards-backup-${stamp}.json`;
}

export async function readLocalWorkspaceBackupFile(file: File): Promise<LocalWorkspaceBackupFileReadResult> {
  const text = await file.text();
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return { kind: "not_backup" };
  }

  if (
    typeof document !== "object"
    || document === null
    || "format" in document === false
    || document.format !== localWorkspaceBackupFormat
  ) {
    return { kind: "not_backup" };
  }

  const endpoint = localWorkspaceBackupFormat;
  let exportedAt: string;
  let content: PortableWorkspaceContent;
  try {
    const objectValue = parseObject(document, endpoint, "");
    exportedAt = parseRequiredField(objectValue, "exportedAt", endpoint, "", parseString);
    if (Number.isNaN(Date.parse(exportedAt))) {
      throw new ApiContractError(endpoint, "exportedAt", "a date");
    }

    content = {
      cards: parseRequiredField(objectValue, "cards", endpoint, "", (value, valueEndpoint, path) => (
        parseArray(value, valueEndpoint, path, parseCard)
      )),
      decks: parseRequiredField(objectValue, "decks", endpoint, "", (value, valueEndpoint, path) => (
        parseArray(value, valueEndpoint, path, parseDeck)
      )).map(({ workspaceId: _workspaceId, ...deck }) => deck),
      reviewEvents: parseRequiredField(objectValue, "reviewEvents", endpoint, "", (value, valueEndpoint, path) => (
        parseArray(value, valueEndpoint, path, parseReviewEvent)
      )).map(({ workspaceId: _workspaceId, ...reviewEvent }) => reviewEvent),
      schedulerSettings: parseRequiredField(objectValue, "schedulerSettings", endpoint, "", (value, valueEndpoint, path) => (
        value === null ? null : parseWorkspaceSchedulerSettings(value, valueEndpoint, path)
      )),
    };
  } catch (error) {
    if (error instanceof ApiContractError) {
      return { kind: "damaged", fieldPath: error.fieldPath };
    }

    throw error;
  }

  const activeCards = content.cards.filter((card) => card.deletedAt === null);
  const backup: LocalWorkspaceBackup = {
    exportedAt,
    summary: {
      activeCardCount: activeCards.length,
      activeDeckCount: content.decks.filter((deck) => deck.deletedAt === null).length,
      reviewEventCount: content.reviewEvents.length,
      mediaLinkedCardCount: activeCards.filter((card) => (
        extractManagedMediaAssetIdsFromMarkdown(card.frontText).length > 0
        || extractManagedMediaAssetIdsFromMarkdown(card.backText).length > 0
      )).length,
    },
  };
  preparedBackupContents.set(backup, content);
  return { kind: "ready", backup };
}

export async function replacePreparedLocalWorkspaceBackup(
  backup: LocalWorkspaceBackup,
  workspaceId: string,
): Promise<void> {
  const content = preparedBackupContents.get(backup);
  if (content === undefined) {
    throw new Error(`Local backup content is unavailable for restore: exportedAt=${backup.exportedAt}`);
  }

  await replaceWorkspaceContent(workspaceId, content);
}
