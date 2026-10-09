/** Compound-key range matching every key prefixed by `workspaceId`: lower `[workspaceId]` is shorter than any real key, and upper `[workspaceId, []]` exploits IDB's type ordering (Array > String/Number) to sort above every primitive second component. */
export function makeWorkspaceKeyRange(workspaceId: string): IDBKeyRange {
  return IDBKeyRange.bound([workspaceId], [workspaceId, []]);
}
