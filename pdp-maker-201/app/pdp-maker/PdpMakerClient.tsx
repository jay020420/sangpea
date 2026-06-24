"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Moon,
  RectangleVertical,
  Sparkles,
  Sun
} from "lucide-react";
import type { AspectRatio, GeneratedResult, PdpAnalyzeResponse, ReferenceImageRole, ReferenceModelUsage } from "@runacademy/shared";
import type { PdpDraftSummary, PdpEditorDraftState, PreparedImageDraft, PreparedReferenceImageDraft } from "./pdp-drafts";
import { deletePdpDraft, getPdpDraft, listPdpDrafts, savePdpDraft } from "./pdp-drafts";
import { PdpEditor } from "./PdpEditor";
import { RATIO_OPTIONS, TONE_OPTIONS, apiJson, prepareImageFile } from "./pdp-utils";
import { DraftPanel } from "./features/draft/DraftPanel";
import { ProductInputReadinessPanel } from "./features/generation/ProductInputReadinessPanel";
import { buildProductInputReadiness } from "./features/generation/product-readiness";
import { KnowledgePanel, type KnowledgeItem } from "./features/knowledge/KnowledgePanel";
import { RedesignProjectPanel } from "./features/redesign/RedesignProjectPanel";
import { ensureSectionRevisions, mergeRedesignProjects, redesignProjectToResult, sectionNumber } from "./features/redesign/redesign-result";
import {
  MAX_REDESIGN_REFERENCE_UPLOADS,
  REDESIGN_SECTION_TOTAL,
  type RedesignEditResponse,
  type RedesignGenerateResponse,
  type RedesignProject
} from "./features/redesign/types";
import { ProductUpload, MAX_PRODUCT_REFERENCE_UPLOADS } from "./features/upload/ProductUpload";
import { RedesignUpload } from "./features/upload/RedesignUpload";
import { ensurePrimaryReferenceImages, extractKnowledgeText, normalizeFilesForUpload, preventFileDragDefault } from "./features/upload/file-input";
import styles from "./pdp-maker.module.css";

type SourceMode = "product" | "redesign";
type ThemeMode = "dark" | "light";

const THEME_STORAGE_KEY = "codex-pdp-maker-theme-v2";

type ConfigState = {
  auth?: { ok: boolean; message?: string; authPath?: string; accountId?: string };
  models?: string[];
  modelError?: string;
  textModel?: string;
  imageModel?: string;
  knowledge?: { documents: number; chunks: number };
};

type DraftSnapshotInput = {
  mode?: "manual" | "auto";
  resultOverride?: GeneratedResult | null;
  editorStateOverride?: PdpEditorDraftState | null;
  appStateOverride?: "upload" | "processing" | "editor";
  sourceModeOverride?: SourceMode;
  noticeOverride?: string;
  idOverride?: string | null;
  createdAtOverride?: string | null;
  markClean?: boolean;
};

type OpenEditorOptions = {
  pendingSave?: boolean;
};

type SavedDraftMeta = {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export function PdpMakerClient() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>("product");
  const [appState, setAppState] = useState<"upload" | "processing" | "editor">("upload");
  const [preparedImage, setPreparedImage] = useState<PreparedImageDraft | null>(null);
  const [productImages, setProductImages] = useState<PreparedReferenceImageDraft[]>([]);
  const [modelImage, setModelImage] = useState<PreparedImageDraft | null>(null);
  const [modelImageUsage, setModelImageUsage] = useState<ReferenceModelUsage | null>(null);
  const [redesignFiles, setRedesignFiles] = useState<File[]>([]);
  const [redesignProject, setRedesignProject] = useState<RedesignProject | null>(null);
  const [redesignProjects, setRedesignProjects] = useState<RedesignProject[]>([]);
  const [rolloutRequest, setRolloutRequest] = useState("");
  const [sectionEditRequests, setSectionEditRequests] = useState<Record<string, string>>({});
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [productDescription, setProductDescription] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [desiredTone, setDesiredTone] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [channel, setChannel] = useState("스마트스토어");
  const [redesignCount, setRedesignCount] = useState(1);
  const [notice, setNotice] = useState("자료를 넣고 구조를 만든 뒤, 편집기에서 문구와 CTA를 레이어로 조정합니다.");
  const [errorMessage, setErrorMessage] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [loadingStep, setLoadingStep] = useState("");
  const [config, setConfig] = useState<ConfigState>({});
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [drafts, setDrafts] = useState<PdpDraftSummary[]>([]);
  const [editorDraftState, setEditorDraftState] = useState<PdpEditorDraftState | null>(null);
  const [editorSessionKey, setEditorSessionKey] = useState("initial");
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [draftCreatedAt, setDraftCreatedAt] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [manualSaveToastToken, setManualSaveToastToken] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [isOpeningEditor, setIsOpeningEditor] = useState(false);

  const productInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const redesignInputRef = useRef<HTMLInputElement>(null);
  const knowledgeInputRef = useRef<HTMLInputElement>(null);

  const apiConnectionLabel = config.auth?.ok ? "Codex OAuth" : "로그인 필요";
  const productInputReadiness = useMemo(
    () =>
      buildProductInputReadiness({
        productImages,
        productDescription,
        additionalInfo,
        desiredTone,
        modelImage,
        modelImageUsage
      }),
    [additionalInfo, desiredTone, modelImage, modelImageUsage, productDescription, productImages]
  );
  const authBlockReason = config.auth && !config.auth.ok ? config.auth.message || "Codex OAuth 로그인 후 생성할 수 있습니다." : "";
  const productGenerateBlockReason = getProductGenerateBlockReason({
    authBlockReason,
    productImageCount: productImages.length,
    hasModelImage: Boolean(modelImage),
    modelImageUsage
  });
  const redesignGenerateBlockReason = getRedesignGenerateBlockReason({
    authBlockReason,
    redesignFileCount: redesignFiles.length
  });
  const canGenerateProduct = !productGenerateBlockReason;
  const canGenerateRedesign = !redesignGenerateBlockReason;
  const currentGenerateBlockReason = sourceMode === "product" ? productGenerateBlockReason : redesignGenerateBlockReason;
  const currentGenerateStatusMessage = getGenerateStatusMessage({
    appState,
    loadingStep,
    sourceMode,
    blockReason: currentGenerateBlockReason,
    productReadinessStatus: productInputReadiness.status,
    redesignCount
  });
  const currentRedesignResult = useMemo(
    () => (redesignProject ? redesignProjectToResult(redesignProject) : null),
    [redesignProject]
  );
  const canOpenCurrentRedesign = Boolean(currentRedesignResult?.blueprint.sections.length);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "light";
    applyThemePreference(nextTheme);
    setTheme(nextTheme);
    setThemeLoaded(true);
  }, []);

  useEffect(() => {
    if (!themeLoaded) return;
    applyThemePreference(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, themeLoaded]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      const nextConfig = await apiJson<ConfigState>("/config");
      setConfig(nextConfig);
    } catch {
      setConfig({});
    }
  }, []);

  const refreshKnowledge = useCallback(async () => {
    try {
      const data = await apiJson<{ items: KnowledgeItem[]; documents: number; chunks: number }>("/knowledge");
      setKnowledgeItems(data.items || []);
      setConfig((current) => ({ ...current, knowledge: { documents: data.documents, chunks: data.chunks } }));
    } catch {}
  }, []);

  const refreshDrafts = useCallback(async () => {
    try {
      setDrafts(await listPdpDrafts());
    } catch {
      setDrafts([]);
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
    void refreshKnowledge();
    void refreshDrafts();
  }, [refreshConfig, refreshDrafts, refreshKnowledge]);

  useEffect(() => {
    if (appState === "editor" && result) setIsDirty(true);
  }, [editorDraftState, appState, result]);

  useEffect(() => {
    if (!isDirty || appState !== "editor" || !result) return;
    const timer = window.setInterval(() => {
      void persistDraft("auto");
    }, 30000);
    return () => window.clearInterval(timer);
  }, [isDirty, appState, result, editorDraftState]);

  function resetDraftIdentityForNewInput() {
    setActiveDraftId(null);
    setDraftCreatedAt(null);
    setLastSavedAt(null);
    setSaveState("idle");
    setIsDirty(false);
    setEditorDraftState(null);
  }

  function handleRedesignFiles(files: File[]) {
    if (!files.length) return;
    resetDraftIdentityForNewInput();
    setRedesignFiles(files);
    setRedesignProject(null);
    setResult(null);
    setRolloutRequest("");
    setSectionEditRequests({});
    setErrorMessage("");
    setErrorDetail("");
    if (files.length) {
      setNotice(`${files.length}개 참조 파일을 선택했습니다. 히어로부터 새 리디자인을 생성하세요.`);
    }
  }

  function activateRedesignProject(project: RedesignProject) {
    resetDraftIdentityForNewInput();
    setRedesignProject(project);
    setResult(redesignProjectToResult(project));
    setErrorMessage("");
    setErrorDetail("");
    setNotice("선택한 리디자인 결과를 확인 중입니다. 편집기로 열면 별도 초안으로 저장됩니다.");
  }

  async function handleProductFiles(files: File[]) {
    try {
      if (!files.length) return;
      const uploadFiles = await normalizeFilesForUpload(files, MAX_PRODUCT_REFERENCE_UPLOADS);
      if (!uploadFiles.length) {
        setErrorMessage("제품 이미지, SW 화면 또는 PDF 페이지를 이미지로 변환하지 못했습니다.");
        return;
      }
      const availableSlots = Math.max(0, MAX_PRODUCT_REFERENCE_UPLOADS - productImages.length);
      if (!availableSlots) {
        setNotice(`제품/SW 참조 자료는 최대 ${MAX_PRODUCT_REFERENCE_UPLOADS}개까지 사용할 수 있습니다.`);
        return;
      }
      resetDraftIdentityForNewInput();
      setResult(null);
      const prepared = await Promise.all(uploadFiles.slice(0, availableSlots).map(async (file, index) => {
        const image = await prepareImageFile(file);
        const firstOverall = productImages.length === 0 && index === 0;
        return {
          ...image,
          id: crypto.randomUUID(),
          role: firstOverall ? "primary" : "reference"
        } satisfies PreparedReferenceImageDraft;
      }));
      const nextImages = ensurePrimaryReferenceImages([...productImages, ...prepared].slice(0, MAX_PRODUCT_REFERENCE_UPLOADS));
      setProductImages(nextImages);
      setPreparedImage(nextImages[0] ?? null);
      setErrorMessage("");
      setNotice(`${nextImages.length}개 참조 자료를 준비했습니다. 대표/디테일/증빙 역할을 확인한 뒤 상세페이지 구조를 생성하세요.`);
    } catch (error) {
      showError(error, "제품 이미지 또는 SW 화면을 준비하지 못했습니다.");
    }
  }

  function updateProductImageRole(imageId: string, role: ReferenceImageRole) {
    setProductImages((current) => {
      const next = current.map((image) => (image.id === imageId ? { ...image, role } : role === "primary" && image.role === "primary" ? { ...image, role: "reference" as const } : image));
      const normalized = ensurePrimaryReferenceImages(next);
      setPreparedImage(normalized[0] ?? null);
      return normalized;
    });
  }

  function removeProductImage(imageId: string) {
    setProductImages((current) => {
      const normalized = ensurePrimaryReferenceImages(current.filter((image) => image.id !== imageId));
      setPreparedImage(normalized[0] ?? null);
      return normalized;
    });
  }

  async function handleModelImage(file: File) {
    try {
      if (!file.type.startsWith("image/")) {
        setErrorMessage("모델 이미지는 이미지 파일만 업로드할 수 있습니다.");
        return;
      }
      setModelImage(await prepareImageFile(file));
      setModelImageUsage(null);
      setErrorMessage("");
      setNotice("모델 이미지를 준비했습니다. 사용할 범위를 선택하세요.");
    } catch (error) {
      showError(error, "모델 이미지를 준비하지 못했습니다.");
    }
  }

  async function generateProduct() {
    const primaryImage = productImages[0];
    if (authBlockReason) {
      setErrorMessage(authBlockReason);
      setErrorDetail("");
      return;
    }
    if (!primaryImage) {
      setErrorMessage("먼저 제품 이미지, SW 화면 또는 참조 자료를 업로드해 주세요.");
      return;
    }
    if (modelImage && !modelImageUsage) {
      setErrorMessage("모델 이미지 사용 방식을 먼저 선택해 주세요.");
      return;
    }
    const startsWithReadinessWarning = productInputReadiness.status === "blocked";

    setSourceMode("product");
    const setupDraft = await persistDraftSnapshot({
      mode: "auto",
      resultOverride: null,
      editorStateOverride: null,
      appStateOverride: "upload",
      sourceModeOverride: "product",
      noticeOverride: startsWithReadinessWarning
        ? "자료가 부족한 상태로 구조 생성을 시작했습니다. 결과가 기본 구조로 대체될 수 있습니다."
        : "상세페이지 구조 생성 전 설정 초안입니다.",
      markClean: false
    });

    setAppState("processing");
    setLoadingStep(
      startsWithReadinessWarning
        ? "입력 자료가 부족하지만 Codex OAuth로 가능한 범위의 상세페이지 구조를 생성하는 중입니다."
        : "Codex OAuth로 제품 이미지 또는 SW 화면을 분석하고 한국형 상세페이지 구조를 설계하는 중입니다."
    );
    setErrorMessage("");
    setErrorDetail("");

    try {
      const response = await apiJson<PdpAnalyzeResponse>("/pdp/analyze", {
        method: "POST",
        body: JSON.stringify({
          imageBase64: primaryImage.base64,
          mimeType: primaryImage.mimeType,
          referenceImages: productImages.map((image) => ({
            id: image.id,
            name: image.fileName,
            role: image.role,
            mimeType: image.mimeType,
            base64: image.base64
          })),
          modelImageBase64: modelImage?.base64,
          modelImageMimeType: modelImage?.mimeType,
          modelImageFileName: modelImage?.fileName,
          productDescription: productDescription.trim() || undefined,
          additionalInfo: additionalInfo.trim() || undefined,
          desiredTone: desiredTone.trim() || undefined,
          aspectRatio
        })
      });

      if (!response.ok) throw new Error(response.message);
      setSourceMode("product");
      const warningCount = response.result.copyWarnings?.length ?? 0;
      const qualityReport = response.result.qualityReport;
      const analysisFallbackUsed = hasAnalysisFallback(response.result);
      const qualityLabel =
        qualityReport?.status === "ready"
          ? `품질 ${qualityReport.overallScore}점, 고객 제시 가능`
          : qualityReport?.status === "blocked"
            ? `품질 ${qualityReport.overallScore}점, 보강 필요`
            : qualityReport
              ? `품질 ${qualityReport.overallScore}점, 검수 후 사용`
              : "";
      const nextNotice =
        analysisFallbackUsed
          ? `AI 분석이 기본 구조로 대체되었습니다. 상품명과 핵심 기능은 반영했지만 고객 납품 전 원본 자료와 카피를 검수하세요. ${qualityLabel || ""}`.trim()
          : qualityLabel
            ? `${qualityLabel}. ${qualityReport?.nextActions[0] ?? "편집기에서 문구, CTA, 색상, 배경을 반복 수정하세요."}`
            : warningCount
              ? `상품 브리프와 상세페이지 구조를 만들었습니다. 카피 경고 ${warningCount}건을 확인한 뒤 섹션 이미지를 생성하세요.`
              : startsWithReadinessWarning
                ? "부족한 입력으로 상세페이지 구조를 만들었습니다. 카피와 근거를 확인한 뒤 섹션 이미지를 생성하세요."
                : "상품 브리프와 상세페이지 구조를 만들었습니다. 편집기에서 문구, CTA, 색상, 배경을 반복 수정하세요.";
      openEditor(response.result, nextNotice, setupDraft, { pendingSave: true });
      const savedEditorDraft = await persistDraftSnapshot({
        mode: "auto",
        resultOverride: response.result,
        editorStateOverride: null,
        appStateOverride: "editor",
        sourceModeOverride: "product",
        noticeOverride: nextNotice,
        idOverride: setupDraft?.id ?? activeDraftId,
        createdAtOverride: setupDraft?.createdAt ?? draftCreatedAt,
        markClean: true
      });
      if (!savedEditorDraft) {
        setNotice(`${nextNotice} 단, 로컬 초안 저장은 실패했습니다. 편집은 계속할 수 있고, 상단의 작업 저장하기를 다시 눌러 주세요.`);
      }
    } catch (error) {
      setAppState("upload");
      showError(error, "업로드 자료 분석에 실패했습니다.");
    } finally {
      setLoadingStep("");
    }
  }

  async function generateRedesign() {
    await generateRedesignBatch({ count: redesignCount, startSection: 1, nextRolloutRequest: "" });
  }

  async function generateRedesignBatch({
    count,
    startSection,
    nextRolloutRequest,
    baseProject
  }: {
    count: number;
    startSection: number;
    nextRolloutRequest: string;
    baseProject?: RedesignProject | null;
  }) {
    if (authBlockReason) {
      setErrorMessage(authBlockReason);
      setErrorDetail("");
      return null;
    }
    if (!redesignFiles.length) {
      setErrorMessage("기존 상세페이지 이미지 또는 PDF를 업로드해 주세요.");
      return null;
    }

    setSourceMode("redesign");
    setAppState("processing");
    setLoadingStep(
      startSection === 1 && count === 1
        ? "히어로 1장을 먼저 생성하는 중입니다."
        : `S${startSection}부터 ${count}개 섹션을 생성하는 중입니다.`
    );
    setErrorMessage("");
    setErrorDetail("");

    try {
      const uploadFiles = await normalizeFilesForUpload(redesignFiles, MAX_REDESIGN_REFERENCE_UPLOADS, { renderImages: true });
      if (!uploadFiles.length) throw new Error("이미지로 변환할 수 있는 참조 파일이 없습니다.");

      const form = new FormData();
      uploadFiles.forEach((file) => form.append("files", file));
      form.append("request", additionalInfo);
      form.append("rolloutRequest", nextRolloutRequest);
      form.append("channel", channel);
      form.append("ratio", aspectRatio);
      form.append("count", String(count));
      form.append("startSection", String(startSection));

      const data = await apiJson<RedesignGenerateResponse>("/redesign/generate", { method: "POST", body: form });
      if (!data.ok) {
        const message = "error" in data ? data.error : "리디자인 생성 실패";
        const detail = "detail" in data ? data.detail : "";
        throw withDetail(message, detail);
      }

      const mergedProject = mergeRedesignProjects(baseProject, data.project);
      const nextResult = redesignProjectToResult(mergedProject);
      const generatedCount = nextResult.blueprint.sections.length;
      const nextNotice =
        mergedProject.warning ||
        `${generatedCount}개 섹션을 생성했습니다. 결과를 확인한 뒤 이어 생성하거나 편집기로 넘기세요.`;
      setRedesignProject(mergedProject);
      setRedesignProjects((current) => [mergedProject, ...current.filter((project) => project.id !== mergedProject.id)].slice(0, 8));
      setResult(nextResult);
      setNotice(nextNotice);
      setAppState("upload");
      if (generatedCount) {
        const savedDraft = await persistDraftSnapshot({
          mode: "auto",
          resultOverride: nextResult,
          editorStateOverride: null,
          appStateOverride: "editor",
          sourceModeOverride: "redesign",
          noticeOverride: nextNotice,
          idOverride: baseProject ? activeDraftId : null,
          createdAtOverride: baseProject ? draftCreatedAt : null,
          markClean: true
        });
        if (!savedDraft) {
          setNotice(`${nextNotice} 단, 로컬 초안 저장은 실패했습니다. 현재 리디자인을 편집기로 열거나 다시 생성해 주세요.`);
        }
      }
      return mergedProject;
    } catch (error) {
      setAppState("upload");
      showError(error, "리디자인 생성에 실패했습니다.");
      return null;
    } finally {
      setLoadingStep("");
    }
  }

  async function generateRemainingSections() {
    if (!redesignProject) {
      await generateRedesignBatch({ count: 1, startSection: 1, nextRolloutRequest: "" });
      return;
    }

    let workingProject: RedesignProject | null = redesignProject;
    const existingNumbers = new Set(
      workingProject.sections
        .filter((section) => section.imageUrl)
        .map((section) => sectionNumber(section.section_id))
        .filter(Boolean)
    );
    const missing = Array.from({ length: REDESIGN_SECTION_TOTAL }, (_, index) => index + 1).filter((number) => !existingNumbers.has(number));

    if (!missing.length) {
      setNotice("이미 8개 섹션이 모두 생성되어 있습니다.");
      return;
    }

    for (const [index, sectionNumberValue] of missing.entries()) {
      const nextProject = await generateRedesignBatch({
        count: 1,
        startSection: sectionNumberValue,
        nextRolloutRequest: rolloutRequest,
        baseProject: workingProject
      });
      if (!nextProject) break;
      workingProject = nextProject;
      setNotice(`누락 섹션 생성 중: ${index + 1}/${missing.length}`);
    }
  }

  async function editRedesignSection(sectionId: string) {
    const project = redesignProject;
    const section = project?.sections.find((candidate) => candidate.section_id === sectionId || candidate.id === sectionId);
    const editRequest = sectionEditRequests[sectionId]?.trim() || "";
    if (!project || !section?.imageUrl) {
      setErrorMessage("수정할 리디자인 섹션 이미지가 없습니다.");
      return;
    }
    if (!editRequest) {
      setErrorMessage("섹션 수정 요청사항을 입력해 주세요.");
      return;
    }

    setEditingSectionId(sectionId);
    setErrorMessage("");
    setErrorDetail("");

    try {
      const data = await apiJson<RedesignEditResponse>("/redesign/edit-section", {
        method: "POST",
        body: JSON.stringify({
          imageUrl: section.imageUrl,
          request: editRequest,
          section,
          project,
          aspectRatio
        })
      });
      if (!data.ok) throw withDetail(data.error || "섹션 수정 실패", data.detail);

      const nextProject: RedesignProject = {
        ...project,
        sections: project.sections.map((candidate) => {
          if (candidate.section_id !== section.section_id) return candidate;
          const revisions = ensureSectionRevisions(candidate);
          return {
            ...candidate,
            imageUrl: data.imageUrl,
            mimeType: data.mimeType || candidate.mimeType,
            imageQualityReport: data.imageQualityReport,
            providerProof: data.providerProof || candidate.providerProof,
            revisions: [
              ...revisions,
              {
                id: `revision-${Date.now()}`,
                imageUrl: data.imageUrl,
                label: `수정 ${revisions.length}`,
                createdAt: new Date().toISOString(),
                request: editRequest,
                providerProof: data.providerProof
              }
            ]
          };
        })
      };
      setRedesignProject(nextProject);
      setRedesignProjects((current) => [nextProject, ...current.filter((item) => item.id !== nextProject.id)].slice(0, 8));
      setResult(redesignProjectToResult(nextProject));
      setNotice(`${section.name} 섹션을 수정했습니다.`);
    } catch (error) {
      showError(error, "섹션 수정에 실패했습니다.");
    } finally {
      setEditingSectionId(null);
    }
  }

  async function openRedesignEditor(project = redesignProject) {
    if (!project) return;
    const nextResult = redesignProjectToResult(project);
    const nextNotice = "리디자인 결과를 편집기로 넘겼습니다. 문구, CTA, 색상, 배경을 섹션별로 반복 수정할 수 있습니다.";
    if (!isEditorReadyResult(nextResult)) {
      setErrorMessage("편집기로 열 수 있는 생성 섹션이 없습니다. 먼저 히어로 또는 누락 섹션을 생성해 주세요.");
      return;
    }
    const currentDraftMeta =
      activeDraftId && draftCreatedAt
        ? { id: activeDraftId, createdAt: draftCreatedAt, updatedAt: lastSavedAt ?? draftCreatedAt }
        : null;
    setIsOpeningEditor(true);
    openEditor(nextResult, nextNotice, currentDraftMeta, { pendingSave: true });
    try {
      const savedEditorDraft = await persistDraftSnapshot({
        mode: "auto",
        resultOverride: nextResult,
        editorStateOverride: null,
        appStateOverride: "editor",
        sourceModeOverride: "redesign",
        noticeOverride: nextNotice,
        markClean: true
      });
      if (!savedEditorDraft) {
        setNotice(`${nextNotice} 단, 로컬 초안 저장은 실패했습니다. 편집은 계속할 수 있고, 상단의 작업 저장하기를 다시 눌러 주세요.`);
      }
    } finally {
      setIsOpeningEditor(false);
    }
  }

  async function handleKnowledgeFiles(files: FileList | null) {
    if (!files?.length) return;
    setLoadingStep("지식파일 텍스트를 추출하는 중입니다.");
    setAppState("processing");
    try {
      let indexedCount = 0;
      const skippedReasons: string[] = [];
      for (const file of Array.from(files).slice(0, 5)) {
        const text = await extractKnowledgeText(file);
        const response = await apiJson<{ indexed: boolean; reason?: string }>("/knowledge", {
          method: "POST",
          body: JSON.stringify({ name: file.name, text, sourceKind: inferKnowledgeSourceKind(file.name, text), tags: inferKnowledgeTags(file.name, text) })
        });
        if (response.indexed) {
          indexedCount += 1;
        } else if (response.reason) {
          skippedReasons.push(`${file.name}: ${response.reason}`);
        }
      }
      await refreshKnowledge();
      if (indexedCount) {
        setNotice(
          skippedReasons.length
            ? `${indexedCount}개 지식파일을 등록했습니다. 일부 파일은 건너뛰었습니다: ${skippedReasons[0]}`
            : `${indexedCount}개 지식파일을 로컬 RAG 저장소에 등록했습니다.`
        );
      } else {
        setNotice(skippedReasons[0] || "지식 파일에서 색인할 텍스트를 찾지 못했습니다.");
      }
    } catch (error) {
      showError(error, "지식파일을 등록하지 못했습니다.");
    } finally {
      setAppState("upload");
      setLoadingStep("");
      if (knowledgeInputRef.current) knowledgeInputRef.current.value = "";
    }
  }

  async function removeKnowledge(documentId: string) {
    try {
      const response = await apiJson<{ deleted: boolean }>("/knowledge", {
        method: "DELETE",
        body: JSON.stringify({ documentId })
      });
      await refreshKnowledge();
      if (!response.deleted) setNotice("이미 삭제되었거나 찾을 수 없는 지식파일입니다.");
    } catch (error) {
      showError(error, "지식파일을 삭제하지 못했습니다.");
    }
  }

  async function loadDraft(id: string) {
    try {
      const draft = await getPdpDraft(id);
      if (!draft) return;
      const editorReady = isEditorReadyResult(draft.result);
      setSourceMode(draft.sourceMode);
      setProductImages(draft.productImages);
      setPreparedImage(draft.productImages[0] ?? draft.preparedImage);
      setModelImage(draft.modelImage);
      setModelImageUsage(draft.modelImageUsage);
      setResult(editorReady ? draft.result : null);
      setProductDescription(draft.productDescription);
      setAdditionalInfo(draft.additionalInfo);
      setDesiredTone(draft.desiredTone);
      setAspectRatio(draft.aspectRatio);
      setNotice(editorReady ? draft.notice : "구조 생성 전 설정 초안입니다. 상세페이지 구조 생성을 누르면 편집 화면으로 이동합니다.");
      setEditorDraftState(editorReady ? draft.editorState : null);
      setEditorSessionKey(`draft-${draft.id}-${draft.updatedAt}`);
      setActiveDraftId(draft.id);
      setDraftCreatedAt(draft.createdAt);
      setLastSavedAt(draft.updatedAt);
      setSaveState("saved");
      setErrorMessage("");
      setErrorDetail("");
      setAppState(editorReady ? "editor" : "upload");
      setIsDirty(false);
    } catch (error) {
      showError(error, "저장된 초안을 불러오지 못했습니다.");
    }
  }

  async function persistDraft(mode: "manual" | "auto") {
    if (!result) return null;
    return persistDraftSnapshot({
      mode,
      resultOverride: result,
      editorStateOverride: editorDraftState,
      appStateOverride: "editor",
      markClean: true
    });
  }

  async function persistDraftSnapshot(input: DraftSnapshotInput = {}) {
    const snapshotResult = "resultOverride" in input ? input.resultOverride ?? null : result;
    const snapshotEditorState = "editorStateOverride" in input ? input.editorStateOverride ?? null : editorDraftState;
    const snapshotAppState = input.appStateOverride ?? (snapshotResult ? "editor" : appState);
    const snapshotSourceMode = input.sourceModeOverride ?? sourceMode;
    const snapshotProductImages = snapshotSourceMode === "product" ? productImages : [];
    const snapshotPreparedImage = snapshotSourceMode === "product" ? productImages[0] ?? preparedImage : null;
    const snapshotModelImage = snapshotSourceMode === "product" ? modelImage : null;
    const snapshotModelImageUsage = snapshotSourceMode === "product" ? modelImageUsage : null;

    if (!snapshotResult && !snapshotProductImages.length && !snapshotPreparedImage) return null;
    setSaveState("saving");
    try {
      const saved = await savePdpDraft({
        id: input.idOverride ?? activeDraftId ?? undefined,
        createdAt: input.createdAtOverride ?? draftCreatedAt ?? undefined,
        sourceMode: snapshotSourceMode,
        appState: snapshotAppState,
        preparedImage: snapshotPreparedImage,
        productImages: snapshotProductImages,
        modelImage: snapshotModelImage,
        modelImageUsage: snapshotModelImageUsage,
        result: snapshotResult,
        productDescription,
        additionalInfo,
        desiredTone,
        aspectRatio,
        notice: input.noticeOverride ?? notice,
        editorState: snapshotEditorState
      });
      setActiveDraftId(saved.id);
      setDraftCreatedAt(saved.createdAt);
      setLastSavedAt(saved.updatedAt);
      setSaveState("saved");
      if (input.markClean ?? Boolean(snapshotResult)) {
        setIsDirty(false);
      }
      if (input.mode === "manual") {
        setManualSaveToastToken(Date.now());
        setNotice("현재 작업을 저장했습니다.");
      }
      await refreshDrafts();
      return saved;
    } catch (error) {
      setSaveState("error");
      showError(error, "작업을 저장하지 못했습니다.");
      return null;
    }
  }

  function openEditor(nextResult: GeneratedResult, nextNotice: string, draftMeta?: SavedDraftMeta | null, options: OpenEditorOptions = {}) {
    if (!isEditorReadyResult(nextResult)) {
      setAppState("upload");
      setErrorMessage("편집기로 열 수 있는 섹션이 없습니다. 상세페이지 구조 생성을 다시 실행해 주세요.");
      return;
    }
    const shouldShowDraftSaveError = !options.pendingSave && !draftMeta;
    setResult(nextResult);
    setEditorDraftState(null);
    setEditorSessionKey(`editor-${crypto.randomUUID()}`);
    setActiveDraftId(draftMeta?.id ?? null);
    setDraftCreatedAt(draftMeta?.createdAt ?? null);
    setLastSavedAt(options.pendingSave ? null : draftMeta?.updatedAt ?? null);
    setSaveState(options.pendingSave ? "saving" : draftMeta ? "saved" : "error");
    setIsDirty(options.pendingSave || !draftMeta);
    setNotice(
      draftMeta || options.pendingSave
        ? nextNotice
        : `${nextNotice} 단, 로컬 초안 저장은 실패했습니다. 현재 화면에서 작업 저장하기를 다시 눌러 주세요.`
    );
    setErrorMessage(shouldShowDraftSaveError ? "편집 화면은 열렸지만 로컬 초안 저장에 실패했습니다." : "");
    setErrorDetail("");
    setAppState("editor");
  }

  function resetWorkspace() {
    setAppState("upload");
    setResult(null);
    setEditorDraftState(null);
    setEditorSessionKey(`reset-${crypto.randomUUID()}`);
    setActiveDraftId(null);
    setDraftCreatedAt(null);
    setLastSavedAt(null);
    setSaveState("idle");
    setIsDirty(false);
    setNotice("새 작업을 시작할 수 있습니다.");
  }

  function showError(error: unknown, fallback: string) {
    setErrorMessage(error instanceof Error ? error.message : fallback);
    setErrorDetail(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }

  if (appState === "editor" && result) {
    return (
      <PdpEditor
        key={editorSessionKey}
        apiConnectionLabel={apiConnectionLabel}
        aspectRatio={aspectRatio}
        desiredTone={desiredTone}
        initialDraftState={editorDraftState}
        initialResult={result}
        lastSavedAt={lastSavedAt}
        manualSaveToastToken={manualSaveToastToken}
        onDraftStateChange={setEditorDraftState}
        onManualSave={() => void persistDraft("manual")}
        onReset={resetWorkspace}
        onToggleTheme={toggleTheme}
        referenceModelImage={sourceMode === "product" ? modelImage : null}
        referenceModelUsage={sourceMode === "product" ? modelImageUsage : null}
        saveState={saveState}
        theme={theme}
      />
    );
  }

  return (
    <main className={styles.page} data-theme={theme} onDragOver={preventFileDragDefault} onDrop={preventFileDragDefault}>
      <section className={styles.shell}>
        <header className={styles.toolHeader}>
          <div className={styles.toolHeaderCopy}>
            <span className={styles.toolKicker}>PDP Maker</span>
            <h1 className={styles.toolTitle}>상세페이지 제작</h1>
            <p className={styles.toolDescription}>
              자료를 구조화하고, 이미지와 카피를 레이어로 분리해 편집합니다.
            </p>
          </div>
          <div className={styles.toolHeaderActions}>
            <span className={styles.metaPill}>API {apiConnectionLabel}</span>
            <span className={styles.metaPill}>RAG {config.knowledge?.documents ?? 0} files</span>
            <button
              aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
              className={`${styles.secondaryButton} ${styles.headerActionButton} ${styles.themeToggleButton}`}
              onClick={toggleTheme}
              type="button"
            >
              {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
              {theme === "dark" ? "다크" : "라이트"}
            </button>
            <button className={styles.secondaryButton} onClick={() => void refreshConfig()} type="button">
              상태 확인
            </button>
          </div>
        </header>

        <section className={styles.uploadStage}>
          <aside className={styles.workflowRail}>
            <div className={styles.workflowRailHeader}>
              <strong>Workflow</strong>
              <span>{sourceMode === "product" ? "새 PDP" : "리디자인"}</span>
            </div>
            <div className={styles.workflowStepList}>
              <div className={styles.workflowRailStepActive}>
                <span>1</span>
                <strong>Input</strong>
                <small>{sourceMode === "product" ? `${productImages.length}개 자료` : `${redesignFiles.length}개 파일`}</small>
              </div>
              <div className={appState === "processing" ? styles.workflowRailStepActive : styles.workflowRailStep}>
                <span>2</span>
                <strong>Structure</strong>
                <small>{appState === "processing" ? "생성 중" : result ? "완료" : "대기"}</small>
              </div>
              <div className={appState === "editor" || result ? styles.workflowRailStepActive : styles.workflowRailStep}>
                <span>3</span>
                <strong>Edit</strong>
                <small>{result ? "레이어 편집" : "생성 후"}</small>
              </div>
            </div>
            <div className={styles.workflowRailStatus}>
              <span>품질 게이트</span>
              <strong>{sourceMode === "product" ? `${productInputReadiness.score}점` : canOpenCurrentRedesign ? "열기 가능" : "대기"}</strong>
            </div>
          </aside>

          <section className={styles.uploadMain}>
            <div className={styles.panelIntro}>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionStep}>1</span>
                <div className={styles.sectionHeadingCopy}>
                  <h2>입력</h2>
                  <p>제품컷, SW 화면, 증빙 자료를 역할별로 넣습니다.</p>
                </div>
              </div>
              <div className={styles.modelUsageGrid}>
                <button className={sourceMode === "product" ? styles.modelUsageCardActive : styles.modelUsageCard} onClick={() => setSourceMode("product")} type="button">
                  <strong>새 PDP</strong>
                  <span>자료에서 구조를 만듭니다.</span>
                </button>
                <button className={sourceMode === "redesign" ? styles.modelUsageCardActive : styles.modelUsageCard} onClick={() => setSourceMode("redesign")} type="button">
                  <strong>리디자인</strong>
                  <span>기존 PDP를 다시 구성합니다.</span>
                </button>
              </div>
            </div>

            {sourceMode === "product" ? (
              <ProductUpload
                inputRef={productInputRef}
                modelInputRef={modelInputRef}
                modelImage={modelImage}
                modelImageUsage={modelImageUsage}
                onModelImage={handleModelImage}
                onModelImageUsage={setModelImageUsage}
                onProductFiles={handleProductFiles}
                onReferenceRoleChange={updateProductImageRole}
                productImages={productImages}
                removeProductImage={removeProductImage}
                removeModelImage={() => {
                  setModelImage(null);
                  setModelImageUsage(null);
                }}
              />
            ) : (
              <>
                <RedesignUpload files={redesignFiles} inputRef={redesignInputRef} onFiles={handleRedesignFiles} />
                {redesignProject ? (
                  <RedesignProjectPanel
                    editingSectionId={editingSectionId}
                    editRequests={sectionEditRequests}
                    isOpeningEditor={isOpeningEditor}
                    onActivateProject={activateRedesignProject}
                    onEditRequestChange={(sectionId, value) => setSectionEditRequests((current) => ({ ...current, [sectionId]: value }))}
                    onEditSection={(sectionId) => void editRedesignSection(sectionId)}
                    onGenerateMissing={() => void generateRemainingSections()}
                    onOpenEditor={() => void openRedesignEditor()}
                    projects={redesignProjects}
                    project={redesignProject}
                    rolloutRequest={rolloutRequest}
                    setRolloutRequest={setRolloutRequest}
                  />
                ) : null}
              </>
            )}

            {errorMessage ? (
              <div className={styles.errorPanel}>
                <div className={styles.errorBanner}>
                  <AlertCircle size={16} />
                  {errorMessage}
                </div>
                {errorDetail ? <pre className={styles.errorDetail}>{errorDetail}</pre> : null}
              </div>
            ) : null}
          </section>

          <aside className={styles.controlRail}>
            <div className={styles.panelIntro}>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionStep}>2</span>
                <div className={styles.sectionHeadingCopy}>
                  <h2>설정</h2>
                  <p>{notice}</p>
                </div>
              </div>
            </div>

            {config.auth && !config.auth.ok ? (
              <div className={styles.inlineWarning}>
                <AlertCircle size={16} />
                {config.auth.message || "Codex OAuth 로그인이 필요합니다."}
              </div>
            ) : null}

            {sourceMode === "product" ? <ProductInputReadinessPanel readiness={productInputReadiness} /> : null}

            {sourceMode === "product" ? (
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel} htmlFor="productDescription">상품 설명 / 사실 정보</label>
                <textarea
                  className={styles.textarea}
                  id="productDescription"
                  onChange={(event) => setProductDescription(event.target.value)}
                  placeholder="상품명, 대상 고객, 핵심 기능 3개, 사용 상황, 금지 표현을 적어주세요."
                  rows={5}
                  value={productDescription}
                />
                <p className={styles.helperCopy}>이미지에 없는 사실과 금지 표현만 짧게 보강합니다.</p>
              </div>
            ) : null}

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="additionalInfo">{sourceMode === "product" ? "제작 방향 / 요청사항" : "요청사항"}</label>
              <textarea
                className={styles.textarea}
                id="additionalInfo"
                onChange={(event) => setAdditionalInfo(event.target.value)}
                placeholder={sourceMode === "product" ? "예: 과장 없이 실사용감 중심, CTA는 무료 체험" : "예: 카피를 줄이고 근거와 불안을 더 명확히"}
                rows={4}
                value={additionalInfo}
              />
            </div>

            {sourceMode === "redesign" ? (
              <>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="channel">판매 채널</label>
                  <input className={styles.input} id="channel" onChange={(event) => setChannel(event.target.value)} value={channel} />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="count">이번에 생성할 섹션 수</label>
                  <input
                    className={styles.input}
                    id="count"
                    max={8}
                    min={1}
                    onChange={(event) => setRedesignCount(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
                    type="number"
                    value={redesignCount}
                  />
                </div>
              </>
            ) : null}

            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>비율</span>
              <div className={styles.ratioGrid}>
                {RATIO_OPTIONS.map((option) => (
                  <button
                    className={aspectRatio === option.value ? styles.ratioButtonActive : styles.ratioButton}
                    key={option.value}
                    onClick={() => setAspectRatio(option.value)}
                    type="button"
                  >
                    <RectangleVertical size={16} />
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>톤</span>
              <div className={styles.toneGrid}>
                {TONE_OPTIONS.map((tone) => {
                  const value = tone === "AI 자동 추천" ? "" : tone;
                  return (
                    <button className={desiredTone === value ? styles.toneButtonActive : styles.toneButton} key={tone} onClick={() => setDesiredTone(value)} type="button">
                      {tone}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              className={styles.primaryButtonWide}
              disabled={appState === "processing" || (sourceMode === "product" ? !canGenerateProduct : !canGenerateRedesign)}
              onClick={() => void (sourceMode === "product" ? generateProduct() : generateRedesign())}
              type="button"
            >
              {appState === "processing" ? <Loader2 className={styles.spinIcon} size={16} /> : <Sparkles size={16} />}
              {getGenerateButtonLabel({
                appState,
                sourceMode,
                productImageCount: productImages.length,
                productReadinessStatus: productInputReadiness.status,
                redesignCount
              })}
            </button>
            <div className={currentGenerateBlockReason ? styles.generateActionWarning : styles.generateActionStatus}>
              {currentGenerateBlockReason ? <AlertCircle size={14} /> : appState === "processing" ? <Loader2 className={styles.spinIcon} size={14} /> : <CheckCircle2 size={14} />}
              <span>{currentGenerateStatusMessage}</span>
            </div>

            {sourceMode === "redesign" && redesignProject ? (
              <button className={styles.secondaryButtonWide} disabled={!canOpenCurrentRedesign || isOpeningEditor} onClick={() => void openRedesignEditor()} type="button">
                {isOpeningEditor ? <Loader2 className={styles.spinIcon} size={16} /> : <CheckCircle2 size={16} />}
                {isOpeningEditor ? "편집기 여는 중" : "현재 리디자인을 편집기로 열기"}
              </button>
            ) : null}

            <KnowledgePanel
              inputRef={knowledgeInputRef}
              items={knowledgeItems}
              onDelete={removeKnowledge}
              onFiles={handleKnowledgeFiles}
            />

            <DraftPanel drafts={drafts} onDelete={deletePdpDraftAndRefresh} onOpen={loadDraft} />
          </aside>
        </section>

        {appState === "processing" ? (
          <div className={styles.processingPanel}>
            <Loader2 className={styles.spinIcon} size={22} />
            <h2>{loadingStep || "처리 중입니다."}</h2>
          </div>
        ) : null}
      </section>
    </main>
  );

  async function deletePdpDraftAndRefresh(id: string) {
    try {
      await deletePdpDraft(id);
      await refreshDrafts();
    } catch (error) {
      showError(error, "초안을 삭제하지 못했습니다.");
    }
  }
}

function applyThemePreference(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function isEditorReadyResult(result: GeneratedResult | null | undefined): result is GeneratedResult {
  return Boolean(result?.blueprint?.sections?.length);
}

function hasAnalysisFallback(result: GeneratedResult) {
  return Boolean(result.generationTrace?.stages.some((stage) => stage.name === "fallback-section-blueprint"));
}

function getProductGenerateBlockReason(input: {
  authBlockReason: string;
  productImageCount: number;
  hasModelImage: boolean;
  modelImageUsage: ReferenceModelUsage | null;
}) {
  if (input.authBlockReason) return input.authBlockReason;
  if (!input.productImageCount) return "대표 제품/SW 자료를 1장 이상 업로드해야 생성할 수 있습니다.";
  if (input.hasModelImage && !input.modelImageUsage) return "모델 이미지 사용 범위를 먼저 선택해야 생성할 수 있습니다.";
  return "";
}

function getRedesignGenerateBlockReason(input: { authBlockReason: string; redesignFileCount: number }) {
  if (input.authBlockReason) return input.authBlockReason;
  if (!input.redesignFileCount) return "기존 상세페이지 이미지 또는 PDF를 업로드해야 생성할 수 있습니다.";
  return "";
}

function getGenerateButtonLabel(input: {
  appState: "upload" | "processing" | "editor";
  sourceMode: SourceMode;
  productImageCount: number;
  productReadinessStatus: "ready" | "needs_review" | "blocked";
  redesignCount: number;
}) {
  if (input.appState === "processing") {
    return input.sourceMode === "product" ? "구조 생성 중" : "리디자인 생성 중";
  }
  if (input.sourceMode === "product") {
    if (!input.productImageCount) return "자료 업로드 후 생성";
    if (input.productReadinessStatus === "blocked") return "경고 감수하고 구조 생성";
    return "구조 생성 후 편집 시작";
  }
  return input.redesignCount === 1 ? "히어로 1장 먼저 생성" : `S1부터 ${input.redesignCount}장 생성`;
}

function getGenerateStatusMessage(input: {
  appState: "upload" | "processing" | "editor";
  loadingStep: string;
  sourceMode: SourceMode;
  blockReason: string;
  productReadinessStatus: "ready" | "needs_review" | "blocked";
  redesignCount: number;
}) {
  if (input.appState === "processing") {
    return input.loadingStep || "생성 요청을 처리하는 중입니다. 완료되면 자동으로 편집 화면으로 이동합니다.";
  }
  if (input.blockReason) return input.blockReason;
  if (input.sourceMode === "product") {
    if (input.productReadinessStatus === "blocked") return "자료가 부족해도 구조 생성은 가능하지만, 편집기에서 카피와 근거를 반드시 검수하세요.";
    if (input.productReadinessStatus === "needs_review") return "생성은 가능하지만 결과 품질을 높이려면 입력 자료를 추가로 보강하는 편이 좋습니다.";
    return "생성 버튼을 누르면 구조 생성 후 편집 화면으로 자동 전환됩니다.";
  }
  return input.redesignCount === 1 ? "히어로 1장을 만든 뒤 이어 생성하거나 편집기로 열 수 있습니다." : `${input.redesignCount}개 섹션을 생성한 뒤 편집기로 넘길 수 있습니다.`;
}

function withDetail(message: string, detail?: string) {
  const error = new Error(message);
  if (detail) error.name = detail;
  return error;
}

function inferKnowledgeSourceKind(name: string, text: string) {
  const source = `${name} ${text.slice(0, 2000)}`.toLowerCase();
  if (/(review|reviews|후기|리뷰|평점|별점)/i.test(source)) return "review";
  if (/(competitor|comparison|benchmark|경쟁사|타사|비교|상세페이지\s*분석)/i.test(source)) return "competitor_pdp";
  if (/(category|카테고리|시장|구매심리|소비자|buyer)/i.test(source)) return "category";
  if (/(product|상품명|제품명|스펙|구성|소재|성분|기능|가격|배송|as)/i.test(source)) return "product_data";
  return "general";
}

function inferKnowledgeTags(name: string, text: string) {
  const source = `${name} ${text.slice(0, 2000)}`;
  return ["스마트스토어", "쿠팡", "SaaS", "뷰티", "식품", "패션", "전자제품", "홈리빙", "B2B"]
    .filter((tag) => source.toLowerCase().includes(tag.toLowerCase()))
    .slice(0, 6);
}
