import type { CreateCardInput, CreateDeckInput } from "../types";
import type { ApkgFieldMapping } from "./fieldMapping";
import { applyFieldMapping, mappingIsValid, saveFieldMappings } from "./fieldMapping";
import type { ParsedApkgDeck, ParsedApkgNote } from "./parseApkg";

export type ApkgImportProgress = Readonly<{
  importedCount: number;
  totalCount: number;
}>;

export type ApkgImportResult = Readonly<{
  importedCount: number;
  skippedEmptyCount: number;
  skippedUnmappedCount: number;
  clozeNoteCount: number;
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

  if (note.modelType === 1) {
    tags.add("cloze");
  }

  const modelTag = sanitizeTagSegment(note.modelName);
  if (modelTag !== "") {
    tags.add(`model:${modelTag}`);
  }

  return [...tags];
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, max - 1)}…`;
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
  mappings: ReadonlyArray<ApkgFieldMapping>;
  createCardItem: (input: CreateCardInput) => Promise<unknown>;
  createDeckItem: (input: CreateDeckInput) => Promise<unknown>;
  onProgress?: (progress: ApkgImportProgress) => void;
}>): Promise<ApkgImportResult> {
  const importedAt = new Date();
  const importTag = buildApkgImportTag(params.parsed.sourceFileName, importedAt);
  const primaryDeckName = params.parsed.notes[0]?.deckName ?? "Anki import";
  const mappingByModelId = new Map(params.mappings.map((mapping) => [mapping.modelId, mapping]));

  await params.createDeckItem(buildApkgDeckInput(primaryDeckName, importTag));
  saveFieldMappings(params.mappings);

  let importedCount = 0;
  let skippedEmptyCount = 0;
  let skippedUnmappedCount = 0;
  const totalCount = params.parsed.notes.length;

  for (const note of params.parsed.notes) {
    const mapping = mappingByModelId.get(note.modelId);
    if (mapping === undefined || mappingIsValid(mapping) === false) {
      skippedUnmappedCount += 1;
      params.onProgress?.({
        importedCount,
        totalCount,
      });
      continue;
    }

    const mapped = applyFieldMapping(note, mapping);
    if (mapped.frontText === "") {
      skippedEmptyCount += 1;
      params.onProgress?.({
        importedCount,
        totalCount,
      });
      continue;
    }

    await params.createCardItem({
      frontText: truncate(mapped.frontText, 20_000),
      backText: truncate(mapped.backText, 20_000),
      tags: buildCardTags(note, importTag),
    });
    importedCount += 1;
    params.onProgress?.({
      importedCount,
      totalCount,
    });
  }

  return {
    importedCount,
    skippedEmptyCount,
    skippedUnmappedCount,
    clozeNoteCount: params.parsed.clozeNoteCount,
    deckName: deckLeafName(primaryDeckName),
    importTag,
  };
}
