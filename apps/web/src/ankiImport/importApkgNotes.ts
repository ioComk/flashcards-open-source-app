import type { CreateCardInput, CreateDeckInput } from "../types";
import type { ParsedApkgDeck, ParsedApkgNote } from "./parseApkg";

export type ApkgImportProgress = Readonly<{
  importedCount: number;
  totalCount: number;
}>;

export type ApkgImportResult = Readonly<{
  importedCount: number;
  skippedClozeCount: number;
  skippedEmptyCount: number;
  deckName: string;
  importTag: string;
}>;

function sanitizeTagSegment(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}\s._:-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

function deckLeafName(deckName: string): string {
  const parts = deckName.split("::").map((part) => part.trim()).filter((part) => part !== "");
  return parts[parts.length - 1] ?? deckName;
}

export function buildApkgImportTag(sourceFileName: string, importedAt: Date): string {
  const stamp = importedAt.toISOString().slice(0, 10);
  const baseName = sourceFileName.replace(/\.apkg$/i, "");
  const sanitized = sanitizeTagSegment(baseName) || "anki";
  return `anki-import:${sanitized}:${stamp}`;
}

function buildCardTags(note: ParsedApkgNote, importTag: string): ReadonlyArray<string> {
  const tags = new Set<string>(["anki", importTag]);
  const leaf = sanitizeTagSegment(deckLeafName(note.deckName));
  if (leaf !== "") {
    tags.add(leaf);
  }

  for (const tag of note.tags) {
    const sanitized = sanitizeTagSegment(tag);
    if (sanitized !== "") {
      tags.add(sanitized);
    }
  }

  return [...tags];
}

function toCreateCardInput(note: ParsedApkgNote, importTag: string): CreateCardInput {
  return {
    frontText: note.frontText,
    backText: note.backText,
    tags: buildCardTags(note, importTag),
  };
}

export function buildApkgDeckInput(deckName: string, importTag: string): CreateDeckInput {
  const name = sanitizeTagSegment(deckLeafName(deckName)) || "Anki import";
  return {
    name,
    filterDefinition: {
      version: 2,
      tags: [importTag],
    },
  };
}

export async function importParsedApkgNotes(params: Readonly<{
  parsed: ParsedApkgDeck;
  createCardItem: (input: CreateCardInput) => Promise<unknown>;
  createDeckItem: (input: CreateDeckInput) => Promise<unknown>;
  onProgress?: (progress: ApkgImportProgress) => void;
}>): Promise<ApkgImportResult> {
  const importedAt = new Date();
  const importTag = buildApkgImportTag(params.parsed.sourceFileName, importedAt);
  const primaryDeckName = params.parsed.notes[0]?.deckName ?? "Anki import";

  await params.createDeckItem(buildApkgDeckInput(primaryDeckName, importTag));

  let importedCount = 0;
  const totalCount = params.parsed.notes.length;

  for (const note of params.parsed.notes) {
    await params.createCardItem(toCreateCardInput(note, importTag));
    importedCount += 1;
    params.onProgress?.({
      importedCount,
      totalCount,
    });
  }

  return {
    importedCount,
    skippedClozeCount: params.parsed.skippedClozeCount,
    skippedEmptyCount: params.parsed.skippedEmptyCount,
    deckName: deckLeafName(primaryDeckName),
    importTag,
  };
}
