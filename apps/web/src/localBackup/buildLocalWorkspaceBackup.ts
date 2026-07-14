import { loadWorkspaceSettings } from "../localDb/cards/workspace";
import {
  closeDatabaseAfter,
  getAllFromStore,
  type StoredCard,
} from "../localDb/core/database";
import { loadLocalWorkspaceSummary } from "../localDb/meta/localWorkspace";
import { loadCloudSettings } from "../localDb/sync/cloudSettings";
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
