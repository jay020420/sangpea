"use client";

import type {
  AspectRatio,
  GeneratedResult,
  ImageGenOptions,
  PdpCopyLanguage,
  PdpLayeredDocumentV2,
  ReferenceImageRole,
  ReferenceModelUsage,
  SectionBlueprint
} from "@runacademy/shared";

const PDP_DRAFT_DB = "codex-pdp-maker";
const PDP_DRAFT_STORE = "drafts";
const PDP_DRAFT_VERSION = 3;
const MAX_DRAFT_REFERENCE_IMAGES = 20;

export type PdpAppState = "upload" | "processing" | "editor";
export type OverlayTextAlign = "left" | "center" | "right";
export type WorkbenchTab = "image" | "layer" | "copy" | "guide";
export type CanvasLayerKind = "text" | "shape";

interface CanvasLayerBase {
  id: string;
  kind: CanvasLayerKind;
  x: number;
  y: number;
  width: number | string;
  height: number | string;
}

export interface TextOverlay extends CanvasLayerBase {
  kind: "text";
  text: string;
  language: PdpCopyLanguage;
  translations: Record<PdpCopyLanguage, string>;
  fontSize: number;
  color: string;
  backgroundColor: string;
  backgroundEnabled: boolean;
  backgroundOpacity: number;
  backgroundRadius: number;
  fontFamily: string;
  fontWeight: string;
  textAlign: OverlayTextAlign;
  lineHeight: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowOpacity: number;
  shadowBlur: number;
  shadowOffsetY: number;
}

export interface ShapeLayer extends CanvasLayerBase {
  kind: "shape";
  fillColor: string;
  fillOpacity: number;
  borderRadius: number;
}

export type CanvasLayer = TextOverlay | ShapeLayer;

export interface FloatingWorkbenchState {
  x: number;
  y: number;
  width: number;
  height: number;
  isOpen: boolean;
}

export interface PdpEditorDraftState {
  currentSectionIndex: number;
  sections: SectionBlueprint[];
  sectionOptions: Record<number, ImageGenOptions>;
  overlaysBySection: Record<number, CanvasLayer[]>;
  layeredDocumentV2?: PdpLayeredDocumentV2 | null;
  defaultCopyLanguage: PdpCopyLanguage;
  notice: string;
  workbenchTab: WorkbenchTab;
  workbenchState: FloatingWorkbenchState;
}

export interface PreparedImageDraft {
  base64: string;
  mimeType: string;
  previewUrl: string;
  fileName: string;
}

export interface PreparedReferenceImageDraft extends PreparedImageDraft {
  id: string;
  role: ReferenceImageRole;
}

export interface PdpDraftRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceMode: "product" | "redesign";
  appState: PdpAppState;
  preparedImage: PreparedImageDraft | null;
  productImages: PreparedReferenceImageDraft[];
  modelImage: PreparedImageDraft | null;
  modelImageUsage: ReferenceModelUsage | null;
  result: GeneratedResult | null;
  productDescription: string;
  additionalInfo: string;
  desiredTone: string;
  aspectRatio: AspectRatio;
  notice: string;
  editorState: PdpEditorDraftState | null;
}

export interface PdpDraftSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  aspectRatio: AspectRatio;
  sourceMode: "product" | "redesign";
  sectionCount: number;
  stageLabel: string;
  thumbnailUrl: string | null;
}

export type PdpDraftInput = Omit<PdpDraftRecord, "id" | "title" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
};

export async function listPdpDrafts(): Promise<PdpDraftSummary[]> {
  const records = await withStore("readonly", (store) => requestAsPromise<PdpDraftRecord[]>(store.getAll()));
  return records
    .map((record) => normalizeDraftRecord(record))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((record) => {
      const editorSections = Array.isArray(record.editorState?.sections) ? record.editorState.sections : [];
      const resultSections = Array.isArray(record.result?.blueprint?.sections) ? record.result.blueprint.sections : [];
      const analysisFallbackUsed = Boolean(
        record.result?.generationTrace?.stages?.some((stage) => stage.name === "fallback-section-blueprint") ||
          record.result?.blueprint?.scorecard?.some((item) => [item.category, item.score, item.reason].join(" ").includes("기본 구조"))
      );
      return {
        id: record.id,
        title: record.title,
        updatedAt: record.updatedAt,
        createdAt: record.createdAt,
        aspectRatio: record.aspectRatio,
        sourceMode: record.sourceMode,
        sectionCount: editorSections.length || resultSections.length,
        stageLabel: analysisFallbackUsed ? "기본 구조" : resultSections.length ? "편집 중" : "설정 초안",
        thumbnailUrl:
          editorSections[0]?.generatedImage ??
          resultSections[0]?.generatedImage ??
          record.productImages[0]?.previewUrl ??
          record.preparedImage?.previewUrl ??
          record.result?.originalImage ??
          null
      };
    });
}

export async function getPdpDraft(id: string): Promise<PdpDraftRecord | null> {
  return withStore("readonly", (store) =>
    requestAsPromise<PdpDraftRecord | undefined>(store.get(id)).then((record) => (record ? normalizeDraftRecord(record) : null))
  );
}

export async function savePdpDraft(input: PdpDraftInput): Promise<PdpDraftRecord> {
  const now = new Date().toISOString();
  const nextRecord: PdpDraftRecord = {
    id: input.id ?? crypto.randomUUID(),
    title: buildDraftTitle(input),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    sourceMode: input.sourceMode ?? input.result?.sourceMode ?? "product",
    appState: input.appState,
    preparedImage: input.productImages?.[0] ?? input.preparedImage,
    productImages: normalizeReferenceImages(input.productImages, input.preparedImage),
    modelImage: input.modelImage,
    modelImageUsage: input.modelImageUsage,
    result: input.result,
    productDescription: input.productDescription ?? input.result?.productDescription ?? "",
    additionalInfo: input.additionalInfo,
    desiredTone: input.desiredTone,
    aspectRatio: input.aspectRatio,
    notice: input.notice,
    editorState: input.editorState
  };

  const normalizedRecord = normalizeDraftRecord(nextRecord);

  await withStore("readwrite", (store) => requestAsPromise(store.put(normalizedRecord)));
  return normalizedRecord;
}

export async function deletePdpDraft(id: string): Promise<void> {
  await withStore("readwrite", (store) => requestAsPromise(store.delete(id)));
}

function buildDraftTitle(input: PdpDraftInput) {
  const rawFileName = input.productImages?.[0]?.fileName ?? input.preparedImage?.fileName ?? "";
  const cleanedFileName = rawFileName.replace(/\.[^.]+$/, "").trim();
  const fallbackSection = input.editorState?.sections[0]?.section_name ?? input.result?.blueprint?.sections?.[0]?.section_name ?? "상세페이지 초안";
  return cleanedFileName || fallbackSection;
}

function normalizeDraftRecord(record: PdpDraftRecord): PdpDraftRecord {
  const preparedImage = normalizePreparedImage(record.preparedImage);
  const productImages = normalizeReferenceImages(record.productImages, preparedImage);
  const modelImage = normalizePreparedImage(record.modelImage);
  const result = normalizeGeneratedResult(record.result, productImages[0] ?? preparedImage, record.editorState);
  const normalizedSections = Array.isArray(result?.blueprint?.sections)
    ? result.blueprint.sections
    : Array.isArray(record.editorState?.sections)
      ? record.editorState.sections
      : [];

  return {
    id: record.id,
    title: record.title?.trim() || buildFallbackDraftTitle(preparedImage, normalizedSections),
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
    sourceMode: record.sourceMode === "redesign" || record.result?.sourceMode === "redesign" ? "redesign" : "product",
    appState: record.appState === "processing" || record.appState === "editor" ? record.appState : "upload",
    preparedImage: productImages[0] ?? preparedImage,
    productImages,
    modelImage,
    modelImageUsage: record.modelImageUsage === "all-sections" || record.modelImageUsage === "hero-only" ? record.modelImageUsage : null,
    result,
    productDescription: record.productDescription ?? result?.productDescription ?? "",
    additionalInfo: record.additionalInfo ?? "",
    desiredTone: record.desiredTone ?? "",
    aspectRatio: normalizeAspectRatio(record.aspectRatio),
    notice: record.notice ?? "저장된 작업을 불러왔습니다.",
    editorState: normalizeEditorState(record.editorState, result)
  };
}

function normalizePreparedImage(image: PreparedImageDraft | null | undefined) {
  if (!image?.base64 || !image.mimeType) {
    return null;
  }

  const previewUrl = image.previewUrl || `data:${image.mimeType};base64,${image.base64}`;

  return {
    base64: image.base64,
    mimeType: image.mimeType,
    previewUrl,
    fileName: image.fileName || "image"
  };
}

function normalizeReferenceImages(
  images: PreparedReferenceImageDraft[] | PreparedImageDraft[] | null | undefined,
  fallback: PreparedImageDraft | null
): PreparedReferenceImageDraft[] {
  const normalized = Array.isArray(images)
    ? images
        .map((image, index) => {
          const prepared = normalizePreparedImage(image);
          if (!prepared) return null;
          const role = "role" in image ? normalizeRole(image.role, index) : index === 0 ? "primary" : "reference";
          return {
            ...prepared,
            id: "id" in image && typeof image.id === "string" && image.id ? image.id : `ref-${index + 1}`,
            role
          };
        })
        .filter((image): image is PreparedReferenceImageDraft => Boolean(image))
    : [];

  if (!normalized.length && fallback) {
    normalized.push({
      ...fallback,
      id: "legacy-primary",
      role: "primary"
    });
  }

  if (normalized.length && !normalized.some((image) => image.role === "primary")) {
    normalized[0] = { ...normalized[0], role: "primary" };
  }

  return normalized.slice(0, MAX_DRAFT_REFERENCE_IMAGES);
}

function normalizeRole(role: unknown, index: number): ReferenceImageRole {
  if (role === "primary" || role === "detail" || role === "proof" || role === "reference" || role === "optional_model") return role;
  return index === 0 ? "primary" : "reference";
}

function normalizeGeneratedResult(
  result: GeneratedResult | null | undefined,
  preparedImage: PreparedImageDraft | null,
  editorState: PdpEditorDraftState | null | undefined
): GeneratedResult | null {
  if (result?.blueprint?.sections?.length) {
    return {
      originalImage: result.originalImage || preparedImage?.previewUrl || toDataUrl(preparedImage),
      referenceImages: result.referenceImages,
      productDescription: result.productDescription,
      productBrief: result.productBrief,
      generationTrace: result.generationTrace,
      copyWarnings: result.copyWarnings,
      layeredDocument: result.layeredDocument,
      layeredDocumentV2: result.layeredDocumentV2,
      blueprint: {
        executiveSummary: result.blueprint.executiveSummary ?? "",
        scorecard: Array.isArray(result.blueprint.scorecard) ? result.blueprint.scorecard : [],
        blueprintList: Array.isArray(result.blueprint.blueprintList) ? result.blueprint.blueprintList : [],
        sections: result.blueprint.sections
      },
      sourceMode: result.sourceMode,
      providerProof: result.providerProof
    };
  }

  if (editorState?.sections?.length) {
    const fallbackImage = preparedImage?.previewUrl || editorState.sections.find((section) => section.generatedImage)?.generatedImage || "";
    return {
      originalImage: fallbackImage || toDataUrl(preparedImage),
      productDescription: "",
      referenceImages: preparedImage
        ? [
            {
              name: preparedImage.fileName,
              role: "primary",
              mimeType: preparedImage.mimeType,
              base64: preparedImage.base64
            }
          ]
        : [],
      blueprint: {
        executiveSummary: "",
        scorecard: [],
        blueprintList: [],
        sections: editorState.sections
      }
    };
  }

  return null;
}

function normalizeEditorState(editorState: PdpEditorDraftState | null | undefined, result: GeneratedResult | null): PdpEditorDraftState | null {
  const sections = Array.isArray(editorState?.sections) && editorState.sections.length
    ? editorState.sections
    : result?.blueprint?.sections?.length
      ? result.blueprint.sections
      : [];
  const sectionOptions =
    editorState?.sectionOptions && typeof editorState.sectionOptions === "object" && !Array.isArray(editorState.sectionOptions)
      ? editorState.sectionOptions
      : {};
  const overlaysBySection =
    editorState?.overlaysBySection && typeof editorState.overlaysBySection === "object" && !Array.isArray(editorState.overlaysBySection)
      ? editorState.overlaysBySection
      : {};

  if (!sections.length && !editorState) {
    return null;
  }

  return {
    currentSectionIndex:
      typeof editorState?.currentSectionIndex === "number" ? Math.max(0, Math.min(editorState.currentSectionIndex, Math.max(0, sections.length - 1))) : 0,
    sections,
    sectionOptions,
    overlaysBySection,
    layeredDocumentV2: editorState?.layeredDocumentV2 ?? result?.layeredDocumentV2 ?? null,
    defaultCopyLanguage: editorState?.defaultCopyLanguage === "en" ? "en" : "ko",
    notice: editorState?.notice ?? "저장된 작업을 이어서 편집할 수 있습니다.",
    workbenchTab:
      editorState?.workbenchTab === "copy" ||
      editorState?.workbenchTab === "guide" ||
      editorState?.workbenchTab === "layer" ||
      editorState?.workbenchTab === "image"
        ? editorState.workbenchTab
        : "image",
    workbenchState: {
      x: editorState?.workbenchState?.x ?? 756,
      y: editorState?.workbenchState?.y ?? 24,
      width: editorState?.workbenchState?.width ?? 332,
      height: editorState?.workbenchState?.height ?? 500,
      isOpen: editorState?.workbenchState?.isOpen ?? true
    }
  };
}

function buildFallbackDraftTitle(preparedImage: PreparedImageDraft | null, sections: SectionBlueprint[]) {
  const cleanedFileName = preparedImage?.fileName?.replace(/\.[^.]+$/, "").trim();
  return cleanedFileName || sections[0]?.section_name || "상세페이지 초안";
}

function normalizeAspectRatio(value: AspectRatio | string | undefined): AspectRatio {
  if (value === "1:1" || value === "3:4" || value === "4:3" || value === "9:16" || value === "16:9") {
    return value;
  }

  return "9:16";
}

function toDataUrl(image: PreparedImageDraft | null) {
  if (!image) {
    return "";
  }

  return `data:${image.mimeType};base64,${image.base64}`;
}

function openDraftDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("이 브라우저에서는 로컬 저장 기능을 사용할 수 없습니다."));
      return;
    }

    const request = indexedDB.open(PDP_DRAFT_DB, PDP_DRAFT_VERSION);

    request.onerror = () => reject(request.error ?? new Error("저장소를 열지 못했습니다."));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PDP_DRAFT_STORE)) {
        database.createObjectStore(PDP_DRAFT_STORE, { keyPath: "id" });
      }
    };
  });
}

function withStore<T>(mode: IDBTransactionMode, handler: (store: IDBObjectStore) => Promise<T>) {
  return openDraftDb().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(PDP_DRAFT_STORE, mode);
        const store = transaction.objectStore(PDP_DRAFT_STORE);
        let resultValue: T;

        transaction.oncomplete = () => {
          database.close();
          resolve(resultValue);
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error("저장소 작업에 실패했습니다."));
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? new Error("저장소 작업이 중단되었습니다."));
        };

        handler(store)
          .then((result) => {
            resultValue = result;
          })
          .catch((error) => {
            database.close();
            reject(error);
          });
      })
  );
}

function requestAsPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 요청에 실패했습니다."));
  });
}
