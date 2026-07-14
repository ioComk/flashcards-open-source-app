import type { WorkspaceSummary } from "../../types";
import {
  closeDatabaseAfter,
  closeDatabaseAfterWrite,
  getFromStore,
  runReadwrite,
} from "../core/database";

const localWorkspaceMetaKey = "local_workspace";

type LocalWorkspaceRecord = Readonly<{
  key: typeof localWorkspaceMetaKey;
  workspace: WorkspaceSummary;
}>;

export async function loadLocalWorkspaceSummary(): Promise<WorkspaceSummary | null> {
  const record = await closeDatabaseAfter((database) => (
    getFromStore<LocalWorkspaceRecord>(database, "meta", localWorkspaceMetaKey)
  ));
  return record?.workspace ?? null;
}

export async function putLocalWorkspaceSummary(workspace: WorkspaceSummary): Promise<void> {
  await closeDatabaseAfterWrite(async (database) => {
    await runReadwrite(database, ["meta"], (transaction) => transaction.objectStore("meta").put({
      key: localWorkspaceMetaKey,
      workspace,
    } satisfies LocalWorkspaceRecord));
  });
}
