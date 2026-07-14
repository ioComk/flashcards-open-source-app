import { getStableInstallationId } from "../../../clientIdentity";
import {
  loadWorkspaceSettings,
  putWorkspaceSettings,
  setHotStateHydrated,
  setReviewHistoryHydrated,
} from "../../../localDb/cards/workspace";
import {
  ensurePersistentStorage,
  loadCloudSettings,
  putCloudSettings,
} from "../../../localDb/sync/cloudSettings";
import {
  loadLocalWorkspaceSummary,
  putLocalWorkspaceSummary,
} from "../../../localDb/meta/localWorkspace";
import type {
  SessionInfo,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
} from "../../../types";
import { buildDisconnectedCloudSettings } from "../cloud/workspaceSessionCloud";
import { defaultWorkspaceName } from "../activation/workspaceActivationHelpers";

export const localOnlyUserId = "local-user";

function createWorkspaceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `local-workspace-${Date.now().toString(36)}`;
}

function createOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `local-op-${Date.now().toString(36)}`;
}

function buildDefaultSchedulerSettings(
  installationId: string,
  nowIso: string,
): WorkspaceSchedulerSettings {
  return {
    algorithm: "fsrs-6",
    desiredRetention: 0.9,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    maximumIntervalDays: 36_500,
    enableFuzz: true,
    clientUpdatedAt: nowIso,
    lastModifiedByReplicaId: installationId,
    lastOperationId: createOperationId(),
    updatedAt: nowIso,
  };
}

export function buildLocalOnlySessionInfo(selectedWorkspaceId: string | null): SessionInfo {
  return {
    userId: localOnlyUserId,
    selectedWorkspaceId,
    authTransport: "local",
    csrfToken: null,
    preferences: {
      reviewReactionAnimationsEnabled: true,
    },
    profile: {
      email: null,
      locale: "en",
      createdAt: new Date(0).toISOString(),
    },
  };
}

export async function ensureLocalOnlyBootstrap(): Promise<Readonly<{
  session: SessionInfo;
  workspace: WorkspaceSummary;
}>> {
  await ensurePersistentStorage();

  const installationId = getStableInstallationId();
  const nowIso = new Date().toISOString();
  const existingWorkspace = await loadLocalWorkspaceSummary();
  const cloudSettings = await loadCloudSettings();

  const workspace: WorkspaceSummary = existingWorkspace ?? {
    workspaceId: cloudSettings?.linkedWorkspaceId ?? createWorkspaceId(),
    name: defaultWorkspaceName,
    createdAt: nowIso,
    isSelected: true,
  };

  const selectedWorkspace: WorkspaceSummary = {
    ...workspace,
    isSelected: true,
  };

  await putLocalWorkspaceSummary(selectedWorkspace);

  const disconnectedCloudSettings = buildDisconnectedCloudSettings(
    installationId,
    localOnlyUserId,
    selectedWorkspace.workspaceId,
  );
  await putCloudSettings(disconnectedCloudSettings);

  const existingSchedulerSettings = await loadWorkspaceSettings(selectedWorkspace.workspaceId);
  if (existingSchedulerSettings === null) {
    await putWorkspaceSettings(
      selectedWorkspace.workspaceId,
      buildDefaultSchedulerSettings(installationId, nowIso),
    );
  }

  await setHotStateHydrated(selectedWorkspace.workspaceId, true);
  await setReviewHistoryHydrated(selectedWorkspace.workspaceId, true);

  return {
    session: buildLocalOnlySessionInfo(selectedWorkspace.workspaceId),
    workspace: selectedWorkspace,
  };
}
