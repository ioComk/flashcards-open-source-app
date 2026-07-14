import JSZip from "jszip";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

const fieldSeparator = "\u001f";

export type ParsedApkgNote = Readonly<{
  noteId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  modelName: string;
  deckName: string;
}>;

export type ParsedApkgDeck = Readonly<{
  notes: ReadonlyArray<ParsedApkgNote>;
  skippedClozeCount: number;
  skippedEmptyCount: number;
  sourceFileName: string;
}>;

type AnkiModelField = Readonly<{
  name: string;
  ord: number;
}>;

type AnkiModel = Readonly<{
  id: string;
  name: string;
  type: number;
  fields: ReadonlyArray<AnkiModelField>;
}>;

type AnkiDeck = Readonly<{
  id: string;
  name: string;
}>;

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function loadSqlJs(): Promise<SqlJsStatic> {
  if (sqlJsPromise === null) {
    sqlJsPromise = initSqlJs({
      locateFile: () => sqlWasmUrl,
    });
  }

  return sqlJsPromise;
}

function stripHtmlToPlainText(value: string): string {
  const withLineBreaks = value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n");
  const document = new DOMParser().parseFromString(withLineBreaks, "text/html");
  return (document.body.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitFields(flds: string): ReadonlyArray<string> {
  return flds.split(fieldSeparator).map((field) => stripHtmlToPlainText(field));
}

function parseTags(rawTags: string): ReadonlyArray<string> {
  return rawTags
    .split(" ")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

function readJsonObject(raw: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

function parseModels(rawModels: string): ReadonlyMap<string, AnkiModel> {
  const modelsJson = readJsonObject(rawModels, "models");
  const models = new Map<string, AnkiModel>();

  for (const [modelId, value] of Object.entries(modelsJson)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }

    const record = value as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : `Model ${modelId}`;
    const type = typeof record.type === "number" ? record.type : 0;
    const fieldsRaw = Array.isArray(record.flds) ? record.flds : [];
    const fields: Array<AnkiModelField> = [];

    for (const fieldValue of fieldsRaw) {
      if (typeof fieldValue !== "object" || fieldValue === null || Array.isArray(fieldValue)) {
        continue;
      }

      const fieldRecord = fieldValue as Record<string, unknown>;
      const fieldName = typeof fieldRecord.name === "string" ? fieldRecord.name : "";
      const ord = typeof fieldRecord.ord === "number" ? fieldRecord.ord : fields.length;
      if (fieldName === "") {
        continue;
      }

      fields.push({ name: fieldName, ord });
    }

    fields.sort((left, right) => left.ord - right.ord);
    models.set(String(modelId), {
      id: String(modelId),
      name,
      type,
      fields,
    });
  }

  return models;
}

function parseDecks(rawDecks: string): ReadonlyMap<string, AnkiDeck> {
  const decksJson = readJsonObject(rawDecks, "decks");
  const decks = new Map<string, AnkiDeck>();

  for (const [deckId, value] of Object.entries(decksJson)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }

    const record = value as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : `Deck ${deckId}`;
    decks.set(String(deckId), {
      id: String(deckId),
      name,
    });
  }

  return decks;
}

function normalizeFieldName(name: string): string {
  return name.trim().toLowerCase();
}

function pickFrontBack(
  fields: ReadonlyArray<string>,
  modelFields: ReadonlyArray<AnkiModelField>,
): Readonly<{ frontText: string; backText: string }> | null {
  const valuesByName = new Map<string, string>();
  for (const modelField of modelFields) {
    const value = fields[modelField.ord] ?? "";
    valuesByName.set(normalizeFieldName(modelField.name), value);
  }

  const frontCandidates = ["front", "question", "expression", "word", "term", "prompt"];
  const backCandidates = ["back", "answer", "meaning", "definition", "reading", "translation"];

  let frontText = "";
  for (const candidate of frontCandidates) {
    const value = valuesByName.get(candidate);
    if (value !== undefined && value !== "") {
      frontText = value;
      break;
    }
  }

  let backText = "";
  for (const candidate of backCandidates) {
    const value = valuesByName.get(candidate);
    if (value !== undefined && value !== "") {
      backText = value;
      break;
    }
  }

  if (frontText === "" && fields[0] !== undefined) {
    frontText = fields[0];
  }

  if (backText === "" && fields[1] !== undefined) {
    backText = fields[1];
  }

  if (frontText === "" && backText === "") {
    return null;
  }

  if (frontText === "") {
    frontText = backText;
  }

  if (backText === "") {
    backText = frontText;
  }

  return { frontText, backText };
}

function queryCollectionDatabase(database: Database): {
  models: ReadonlyMap<string, AnkiModel>;
  decks: ReadonlyMap<string, AnkiDeck>;
} {
  const colResult = database.exec("SELECT models, decks FROM col LIMIT 1");
  if (colResult.length === 0 || colResult[0]?.values[0] === undefined) {
    throw new Error("Anki collection metadata (col) was not found.");
  }

  const row = colResult[0].values[0];
  const modelsRaw = String(row[0] ?? "{}");
  const decksRaw = String(row[1] ?? "{}");
  return {
    models: parseModels(modelsRaw),
    decks: parseDecks(decksRaw),
  };
}

function chooseCollectionPath(fileNames: ReadonlyArray<string>): string {
  if (fileNames.includes("collection.anki21")) {
    return "collection.anki21";
  }

  if (fileNames.includes("collection.anki2")) {
    return "collection.anki2";
  }

  if (fileNames.includes("collection.anki21b")) {
    throw new Error(
      "This .apkg uses the newer Anki 21b format, which is not supported yet. In Anki Desktop, export again with an older .apkg format (or update Anki and re-export as a compatible package).",
    );
  }

  throw new Error("No Anki collection database was found inside the .apkg file.");
}

function isCompatibilityStubCollection(database: Database): boolean {
  const notesResult = database.exec("SELECT COUNT(*) AS count FROM notes");
  const noteCount = Number(notesResult[0]?.values[0]?.[0] ?? 0);
  if (noteCount !== 1) {
    return false;
  }

  const fldsResult = database.exec("SELECT flds FROM notes LIMIT 1");
  const flds = String(fldsResult[0]?.values[0]?.[0] ?? "");
  return flds.toLowerCase().includes("please update to the latest anki version");
}

export async function parseApkgFile(file: File): Promise<ParsedApkgDeck> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const fileNames = Object.keys(zip.files);
  const collectionPath = chooseCollectionPath(fileNames);
  const collectionFile = zip.file(collectionPath);
  if (collectionFile === null) {
    throw new Error(`Could not read ${collectionPath} from the .apkg archive.`);
  }

  const SQL = await loadSqlJs();
  const collectionBytes = await collectionFile.async("uint8array");
  const database = new SQL.Database(collectionBytes);

  try {
    if (isCompatibilityStubCollection(database)) {
      throw new Error(
        "This package only contains the Anki compatibility stub. Prefer a package that includes collection.anki21, or re-export from a newer Anki Desktop.",
      );
    }

    const { models, decks } = queryCollectionDatabase(database);
    const notesResult = database.exec(
      "SELECT notes.id, notes.mid, notes.tags, notes.flds, cards.did FROM notes JOIN cards ON cards.nid = notes.id GROUP BY notes.id",
    );

    const notes: Array<ParsedApkgNote> = [];
    let skippedClozeCount = 0;
    let skippedEmptyCount = 0;

    if (notesResult.length > 0) {
      for (const row of notesResult[0].values) {
        const noteId = String(row[0] ?? "");
        const modelId = String(row[1] ?? "");
        const tags = parseTags(String(row[2] ?? ""));
        const fields = splitFields(String(row[3] ?? ""));
        const deckId = String(row[4] ?? "");
        const model = models.get(modelId);
        const deckName = decks.get(deckId)?.name ?? "Anki";

        if (model?.type === 1) {
          skippedClozeCount += 1;
          continue;
        }

        const mapped = pickFrontBack(fields, model?.fields ?? []);
        if (mapped === null) {
          skippedEmptyCount += 1;
          continue;
        }

        notes.push({
          noteId,
          frontText: mapped.frontText,
          backText: mapped.backText,
          tags,
          modelName: model?.name ?? "Basic",
          deckName,
        });
      }
    }

    if (notes.length === 0) {
      throw new Error("No importable Basic notes were found in this .apkg file.");
    }

    return {
      notes,
      skippedClozeCount,
      skippedEmptyCount,
      sourceFileName: file.name,
    };
  } finally {
    database.close();
  }
}
