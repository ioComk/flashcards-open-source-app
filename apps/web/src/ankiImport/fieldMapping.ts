import type { ParsedApkgModel, ParsedApkgNote } from "./parseApkg";

const STORAGE_KEY = "flashcards.apkgFieldMappings.v1";
const DEFAULT_JOIN = "\n\n";

export type ApkgFieldMapping = Readonly<{
  modelId: string;
  modelName: string;
  frontFieldNames: ReadonlyArray<string>;
  backFieldNames: ReadonlyArray<string>;
  joinSeparator: string;
}>;

type StoredMapping = Readonly<{
  frontFieldNames: ReadonlyArray<string>;
  backFieldNames: ReadonlyArray<string>;
  joinSeparator: string;
}>;

type StoredMappings = Record<string, StoredMapping>;

function storageKeyForModel(modelName: string): string {
  return modelName.trim().toLowerCase();
}

function loadStored(): StoredMappings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    return parsed as StoredMappings;
  } catch {
    return {};
  }
}

export function saveFieldMappings(mappings: ReadonlyArray<ApkgFieldMapping>): void {
  const next: StoredMappings = { ...loadStored() };
  for (const mapping of mappings) {
    next[storageKeyForModel(mapping.modelName)] = {
      frontFieldNames: [...mapping.frontFieldNames],
      backFieldNames: [...mapping.backFieldNames],
      joinSeparator: mapping.joinSeparator || DEFAULT_JOIN,
    };
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function looksLikeFront(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized.includes("front") ||
    normalized.includes("question") ||
    normalized.includes("prompt") ||
    normalized === "q" ||
    normalized.includes("表面") ||
    normalized.includes("おもて") ||
    normalized.includes("質問") ||
    normalized.includes("問題")
  );
}

function looksLikeBack(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized.includes("back") ||
    normalized.includes("answer") ||
    normalized.includes("response") ||
    normalized === "a" ||
    normalized.includes("裏面") ||
    normalized.includes("うら") ||
    normalized.includes("答え") ||
    normalized.includes("解答")
  );
}

function suggestForModel(model: ParsedApkgModel): ApkgFieldMapping {
  const stored = loadStored()[storageKeyForModel(model.name)];
  if (stored !== undefined) {
    const validFront = stored.frontFieldNames.filter((name) => model.fieldNames.includes(name));
    const validBack = stored.backFieldNames.filter((name) => model.fieldNames.includes(name));
    if (validFront.length > 0) {
      return {
        modelId: model.id,
        modelName: model.name,
        frontFieldNames: validFront,
        backFieldNames: validBack,
        joinSeparator: stored.joinSeparator || DEFAULT_JOIN,
      };
    }
  }

  const fronts = model.fieldNames.filter(looksLikeFront);
  const backs = model.fieldNames.filter(looksLikeBack);

  if (fronts.length > 0 || backs.length > 0) {
    return {
      modelId: model.id,
      modelName: model.name,
      frontFieldNames: fronts.length > 0 ? fronts : model.fieldNames.slice(0, 1),
      backFieldNames:
        backs.length > 0
          ? backs
          : model.fieldNames.filter((name) => fronts.includes(name) === false).slice(0, 1),
      joinSeparator: DEFAULT_JOIN,
    };
  }

  // Custom note types: first field → front, remaining → back
  if (model.fieldNames.length >= 2) {
    return {
      modelId: model.id,
      modelName: model.name,
      frontFieldNames: [model.fieldNames[0]!],
      backFieldNames: model.fieldNames.slice(1),
      joinSeparator: DEFAULT_JOIN,
    };
  }

  if (model.fieldNames.length === 1) {
    return {
      modelId: model.id,
      modelName: model.name,
      frontFieldNames: [model.fieldNames[0]!],
      backFieldNames: [],
      joinSeparator: DEFAULT_JOIN,
    };
  }

  return {
    modelId: model.id,
    modelName: model.name,
    frontFieldNames: [],
    backFieldNames: [],
    joinSeparator: DEFAULT_JOIN,
  };
}

export function suggestFieldMappings(models: ReadonlyArray<ParsedApkgModel>): ApkgFieldMapping[] {
  return models.map(suggestForModel);
}

export function applyFieldMapping(
  note: ParsedApkgNote,
  mapping: ApkgFieldMapping,
): Readonly<{ frontText: string; backText: string }> {
  const byName = new Map(note.fields.map((field) => [field.name, field.value]));
  const join = mapping.joinSeparator || DEFAULT_JOIN;

  function pick(names: ReadonlyArray<string>): string {
    return names
      .map((name) => byName.get(name)?.trim() ?? "")
      .filter((value) => value.length > 0)
      .join(join)
      .trim();
  }

  return {
    frontText: pick(mapping.frontFieldNames),
    backText: pick(mapping.backFieldNames),
  };
}

export function mappingIsValid(mapping: ApkgFieldMapping): boolean {
  return mapping.frontFieldNames.length > 0;
}

export function withToggledField(
  mapping: ApkgFieldMapping,
  side: "front" | "back",
  fieldName: string,
  checked: boolean,
): ApkgFieldMapping {
  const key = side === "front" ? "frontFieldNames" : "backFieldNames";
  const current = mapping[key];
  const nextNames = checked
    ? current.includes(fieldName)
      ? current
      : [...current, fieldName]
    : current.filter((name) => name !== fieldName);

  return {
    ...mapping,
    [key]: nextNames,
  };
}
