"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileImage,
  FileText,
  FolderOpen,
  Loader2,
  Moon,
  RectangleVertical,
  RefreshCw,
  Sparkles,
  Sun,
  Trash2,
  Upload
} from "lucide-react";
import type { AspectRatio, GeneratedResult, PdpAnalyzeResponse, PdpImageQualityReport, ProviderProof, ReferenceImageRole, ReferenceModelUsage, SectionBlueprint } from "@runacademy/shared";
import type { PdpDraftSummary, PdpEditorDraftState, PreparedImageDraft, PreparedReferenceImageDraft } from "./pdp-drafts";
import { deletePdpDraft, getPdpDraft, listPdpDrafts, savePdpDraft } from "./pdp-drafts";
import { PdpEditor } from "./PdpEditor";
import { RATIO_OPTIONS, TONE_OPTIONS, apiJson, prepareImageFile } from "./pdp-utils";
import styles from "./pdp-maker.module.css";

type SourceMode = "product" | "redesign";
type ThemeMode = "dark" | "light";

const THEME_STORAGE_KEY = "codex-pdp-maker-theme";

type ConfigState = {
  auth?: { ok: boolean; message?: string; authPath?: string; accountId?: string };
  models?: string[];
  modelError?: string;
  textModel?: string;
  imageModel?: string;
  knowledge?: { documents: number; chunks: number };
};

type KnowledgeItem = {
  id: string;
  name: string;
  size: number;
  createdAt: string;
};

type RedesignSectionRevision = {
  id: string;
  imageUrl: string;
  label: string;
  createdAt: string;
  request?: string;
  providerProof?: ProviderProof;
};

type RedesignSection = {
  id: string;
  section_id: string;
  image_id?: string;
  name: string;
  purpose: string;
  source: string;
  headline?: string;
  subheadline?: string;
  bullets?: string[];
  trust?: string;
  cta?: string;
  prompt: string;
  promptText?: string;
  imageUrl?: string;
  mimeType?: string;
  imageQualityReport?: PdpImageQualityReport;
  providerProof?: ProviderProof;
  error?: string;
  revisions?: RedesignSectionRevision[];
};

type RedesignProject = {
  id: string;
  title: string;
  channel: string;
  model: "openai-codex-oauth";
  modelLabel: string;
  modelId: string;
  count: number;
  ratio: AspectRatio;
  status: "완료" | "부분완료";
  files: string[];
  request: string;
  rolloutRequest: string;
  createdAt: string;
  analysis?: unknown;
  sections: RedesignSection[];
  failedSections?: RedesignSection[];
  warning?: string;
  providerProof?: ProviderProof;
  originalImage: string;
  referenceImages?: Array<{ id?: string; name?: string; role?: ReferenceImageRole; mimeType: string; base64: string }>;
};

type RedesignGenerateResponse =
  | {
      ok: true;
      project: RedesignProject;
      result: GeneratedResult;
    }
  | {
      ok: false;
      error: string;
      detail?: string;
      code?: string;
    };

type RedesignEditResponse =
  | {
      ok: true;
      imageUrl: string;
      mimeType?: string;
      prompt?: string;
      imageQualityReport?: PdpImageQualityReport;
      providerProof?: ProviderProof;
    }
  | {
      ok: false;
      error: string;
      detail?: string;
      code?: string;
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

type SavedDraftMeta = {
  id: string;
  createdAt: string;
  updatedAt: string;
};

type ProductInputReadiness = {
  score: number;
  status: "ready" | "needs_review" | "blocked";
  summary: string;
  strengths: string[];
  issues: string[];
  actions: string[];
};

const REDESIGN_SECTION_TOTAL = 8;
const MAX_PRODUCT_REFERENCE_UPLOADS = 20;
const MAX_REDESIGN_REFERENCE_UPLOADS = 6;

const REFERENCE_ROLE_OPTIONS: Array<{ value: ReferenceImageRole; label: string; description: string }> = [
  { value: "primary", label: "대표", description: "제품/SW 정체성을 판단하는 기준" },
  { value: "detail", label: "디테일", description: "스펙, 구성, 화면 일부, 사용법" },
  { value: "proof", label: "증빙", description: "후기, 인증, 리뷰, 근거 자료" },
  { value: "reference", label: "참조", description: "톤, 구도, 보조 맥락" }
];

export function PdpMakerClient() {
  const [theme, setTheme] = useState<ThemeMode>("dark");
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
  const [notice, setNotice] = useState("Codex OAuth 로그인 상태를 확인한 뒤 제품 이미지, SW 화면 또는 기존 상세페이지를 업로드하세요.");
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
  const canGenerateProduct = Boolean(productImages.length && (!modelImage || modelImageUsage));
  const canGenerateRedesign = redesignFiles.length > 0;
  const currentRedesignResult = useMemo(
    () => (redesignProject ? redesignProjectToResult(redesignProject) : null),
    [redesignProject]
  );
  const canOpenCurrentRedesign = Boolean(currentRedesignResult?.blueprint.sections.length);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
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
            ? `${qualityLabel}. ${qualityReport?.nextActions[0] ?? "섹션별 이미지를 생성하거나 편집하세요."}`
            : warningCount
              ? `상품 브리프와 상세페이지 구조를 만들었습니다. 카피 경고 ${warningCount}건을 확인한 뒤 섹션 이미지를 생성하세요.`
              : startsWithReadinessWarning
                ? "부족한 입력으로 상세페이지 구조를 만들었습니다. 카피와 근거를 확인한 뒤 섹션 이미지를 생성하세요."
                : "상품 브리프와 상세페이지 구조를 만들었습니다. 섹션별 이미지를 생성하거나 편집하세요.";
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
      openEditor(response.result, nextNotice, savedEditorDraft);
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
      const savedDraft = generatedCount
        ? await persistDraftSnapshot({
            mode: "auto",
            resultOverride: nextResult,
            editorStateOverride: null,
            appStateOverride: "editor",
            sourceModeOverride: "redesign",
            noticeOverride: nextNotice,
            idOverride: baseProject ? activeDraftId : null,
            createdAtOverride: baseProject ? draftCreatedAt : null,
            markClean: true
          })
        : null;
      setRedesignProject(mergedProject);
      setRedesignProjects((current) => [mergedProject, ...current.filter((project) => project.id !== mergedProject.id)].slice(0, 8));
      setResult(nextResult);
      setNotice(
        savedDraft || !generatedCount
          ? nextNotice
          : `${nextNotice} 단, 로컬 초안 저장은 실패했습니다. 현재 리디자인을 편집기로 열거나 다시 생성해 주세요.`
      );
      setAppState("upload");
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
    const nextNotice = "리디자인 결과를 편집기로 넘겼습니다. 텍스트/도형 오버레이와 ZIP 다운로드를 사용할 수 있습니다.";
    if (!isEditorReadyResult(nextResult)) {
      setErrorMessage("편집기로 열 수 있는 생성 섹션이 없습니다. 먼저 히어로 또는 누락 섹션을 생성해 주세요.");
      return;
    }
    const savedEditorDraft = await persistDraftSnapshot({
      mode: "auto",
      resultOverride: nextResult,
      editorStateOverride: null,
      appStateOverride: "editor",
      sourceModeOverride: "redesign",
      noticeOverride: nextNotice,
      markClean: true
    });
    openEditor(nextResult, nextNotice, savedEditorDraft);
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
          body: JSON.stringify({ name: file.name, text })
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

  function openEditor(nextResult: GeneratedResult, nextNotice: string, draftMeta?: SavedDraftMeta | null) {
    if (!isEditorReadyResult(nextResult)) {
      setAppState("upload");
      setErrorMessage("편집기로 열 수 있는 섹션이 없습니다. 상세페이지 구조 생성을 다시 실행해 주세요.");
      return;
    }
    setResult(nextResult);
    setEditorDraftState(null);
    setEditorSessionKey(`editor-${crypto.randomUUID()}`);
    setActiveDraftId(draftMeta?.id ?? null);
    setDraftCreatedAt(draftMeta?.createdAt ?? null);
    setLastSavedAt(draftMeta?.updatedAt ?? null);
    setSaveState(draftMeta ? "saved" : "error");
    setIsDirty(!draftMeta);
    setNotice(
      draftMeta
        ? nextNotice
        : `${nextNotice} 단, 로컬 초안 저장은 실패했습니다. 현재 화면에서 작업 저장하기를 다시 눌러 주세요.`
    );
    setErrorMessage(draftMeta ? "" : "편집 화면은 열렸지만 로컬 초안 저장에 실패했습니다.");
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
            <span className={styles.toolKicker}>Codex Local PDP Workspace</span>
            <h1 className={styles.toolTitle}>Codex PDP Maker</h1>
            <p className={styles.toolDescription}>
              Codex OAuth로 제품·SW 홍보 상세페이지를 만들고, 기존 상세페이지를 원본 흐름처럼 1장 검토 후 이어 생성합니다.
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
          <section>
            <div className={styles.panelIntro}>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionStep}>1</span>
                <div className={styles.sectionHeadingCopy}>
                  <h2>작업 모드</h2>
                  <p>제품컷, 앱 화면, SW 스크린샷으로 새 PDP를 만들거나, 기존 상세페이지/PDF를 리디자인합니다.</p>
                </div>
              </div>
              <div className={styles.modelUsageGrid}>
                <button className={sourceMode === "product" ? styles.modelUsageCardActive : styles.modelUsageCard} onClick={() => setSourceMode("product")} type="button">
                  <strong>새 상세페이지 만들기</strong>
                  <span>제품컷, SW 화면, 증빙 자료 여러 장으로 상세페이지 구조를 설계합니다.</span>
                </button>
                <button className={sourceMode === "redesign" ? styles.modelUsageCardActive : styles.modelUsageCard} onClick={() => setSourceMode("redesign")} type="button">
                  <strong>기존 상세페이지 리디자인</strong>
                  <span>이미지 또는 PDF를 참조해 히어로부터 순차 생성합니다.</span>
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
                  <h2>생성 설정</h2>
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
                  placeholder="상품명, 카테고리, 주요 기능/소재/구성, 타깃 고객, 사용 상황, 가격 이유, 배송/AS, 절대 만들면 안 되는 주장까지 적어주세요. 이 내용은 이미지 분석보다 우선하는 사실 정보로 사용됩니다."
                  rows={7}
                  value={productDescription}
                />
                <p className={styles.helperCopy}>이미지에 안 보이는 핵심 장점과 금지 표현은 여기에 넣어야 카피와 섹션 기획에 안정적으로 반영됩니다.</p>
              </div>
            ) : null}

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="additionalInfo">{sourceMode === "product" ? "제작 방향 / 요청사항" : "요청사항"}</label>
              <textarea
                className={styles.textarea}
                id="additionalInfo"
                onChange={(event) => setAdditionalInfo(event.target.value)}
                placeholder={sourceMode === "product" ? "예: 모바일에서 첫 화면은 신뢰감 있게, 무료 체험 CTA 강조, 과장 표현 없이 실사용감 중심" : "예: 기존 카피는 줄이고, 제품 근거와 배송/교환 불안을 더 명확히 보여주세요."}
                rows={5}
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
              {sourceMode === "product"
                ? !productImages.length
                  ? "자료 업로드 후 생성"
                  : productInputReadiness.status === "blocked"
                  ? "경고 감수하고 구조 생성"
                  : "상세페이지 구조 생성"
                : redesignCount === 1
                  ? "히어로 1장 먼저 생성"
                  : `S1부터 ${redesignCount}장 생성`}
            </button>

            {sourceMode === "redesign" && redesignProject ? (
              <button className={styles.secondaryButtonWide} disabled={!canOpenCurrentRedesign} onClick={() => void openRedesignEditor()} type="button">
                <CheckCircle2 size={16} />
                현재 리디자인을 편집기로 열기
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

function ProductUpload({
  inputRef,
  modelInputRef,
  productImages,
  modelImage,
  modelImageUsage,
  onProductFiles,
  onReferenceRoleChange,
  removeProductImage,
  onModelImage,
  onModelImageUsage,
  removeModelImage
}: {
  inputRef: RefObject<HTMLInputElement>;
  modelInputRef: RefObject<HTMLInputElement>;
  productImages: PreparedReferenceImageDraft[];
  modelImage: PreparedImageDraft | null;
  modelImageUsage: ReferenceModelUsage | null;
  onProductFiles: (files: File[]) => void;
  onReferenceRoleChange: (imageId: string, role: ReferenceImageRole) => void;
  removeProductImage: (imageId: string) => void;
  onModelImage: (file: File) => void;
  onModelImageUsage: (usage: ReferenceModelUsage) => void;
  removeModelImage: () => void;
}) {
  const [isProductDragging, setIsProductDragging] = useState(false);
  const [isModelDragging, setIsModelDragging] = useState(false);
  const productDropzoneClass = isProductDragging ? styles.dropzoneActive : styles.dropzone;
  const modelDropzoneClass = `${isModelDragging ? styles.dropzoneActive : styles.dropzone} ${styles.dropzoneCompact}`;

  return (
    <>
      <button
        className={productDropzoneClass}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          preventFileDragDefault(event);
          setIsProductDragging(true);
        }}
        onDragLeave={(event) => {
          preventFileDragDefault(event);
          setIsProductDragging(false);
        }}
        onDragOver={preventFileDragDefault}
        onDrop={(event) => {
          preventFileDragDefault(event);
          setIsProductDragging(false);
          onProductFiles(filesFromDragEvent(event));
        }}
        type="button"
      >
        <span className={styles.dropzoneIcon}><Upload size={24} /></span>
        <strong>제품/SW 자료를 여러 장 업로드하세요</strong>
        <p>클릭하거나 드래그 앤 드롭하세요. 대표컷, 디테일컷, 증빙 이미지, 앱 화면, PDF 페이지를 최대 20개까지 함께 넣을 수 있습니다.</p>
        <span className={styles.dropzoneHint}>{productImages.length ? `${productImages.length}/${MAX_PRODUCT_REFERENCE_UPLOADS}개 참조 자료 준비됨` : "JPG, PNG, WebP, PDF"}</span>
      </button>
      <input
        className={styles.hiddenInput}
        multiple
        onChange={(event) => {
          onProductFiles(Array.from(event.target.files || []));
          event.currentTarget.value = "";
        }}
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
      />
      {productImages.length ? (
        <div className={styles.referenceAssetList}>
          {productImages.map((image, index) => (
            <div className={styles.referenceAssetCard} key={image.id}>
              <div className={styles.referenceAssetThumb}>
                <img alt={image.fileName} src={image.previewUrl} />
              </div>
              <div className={styles.referenceAssetMeta}>
                <strong>{image.fileName}</strong>
                <span>{index === 0 ? "첫 번째 참조 이미지" : "추가 참조 이미지"}</span>
                <div className={styles.roleChipGrid}>
                  {REFERENCE_ROLE_OPTIONS.map((role) => (
                    <button
                      className={image.role === role.value ? styles.optionChipActive : styles.optionChip}
                      key={role.value}
                      onClick={() => onReferenceRoleChange(image.id, role.value)}
                      title={role.description}
                      type="button"
                    >
                      {role.label}
                    </button>
                  ))}
                </div>
              </div>
              <button className={styles.inlineDangerButton} onClick={() => removeProductImage(image.id)} type="button">
                <Trash2 size={14} />
                제거
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.optionalUploadBlock}>
        <div className={styles.optionalUploadHeader}>
          <div>
            <span className={styles.panelLabel}>선택 옵션</span>
            <h3 className={styles.optionalUploadTitle}>모델 이미지</h3>
            <p className={styles.optionalUploadDescription}>특정 인물의 정체성을 유지한 모델컷이 필요할 때 사용합니다.</p>
          </div>
          {modelImage ? (
            <button className={styles.inlineButton} onClick={removeModelImage} type="button">
              <Trash2 size={14} />
              제거
            </button>
          ) : null}
        </div>
        <button
          className={modelDropzoneClass}
          onClick={() => modelInputRef.current?.click()}
          onDragEnter={(event) => {
            preventFileDragDefault(event);
            setIsModelDragging(true);
          }}
          onDragLeave={(event) => {
            preventFileDragDefault(event);
            setIsModelDragging(false);
          }}
          onDragOver={preventFileDragDefault}
          onDrop={(event) => {
            preventFileDragDefault(event);
            setIsModelDragging(false);
            const [file] = filesFromDragEvent(event);
            if (file) onModelImage(file);
          }}
          type="button"
        >
          <span className={styles.dropzoneIcon}><FileImage size={20} /></span>
          <strong>모델 이미지 업로드</strong>
          <span className={styles.dropzoneHint}>{modelImage?.fileName || "선택 사항, 드래그 가능"}</span>
        </button>
        <input
          className={styles.hiddenInput}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onModelImage(file);
            event.currentTarget.value = "";
          }}
          ref={modelInputRef}
          type="file"
          accept="image/*"
        />
        {modelImage ? <ImagePreview image={modelImage} ratioLabel="참조 모델" /> : null}
        {modelImage ? (
          <div className={styles.modelUsageGrid}>
            <button className={modelImageUsage === "hero-only" ? styles.modelUsageCardActive : styles.modelUsageCard} onClick={() => onModelImageUsage("hero-only")} type="button">
              <strong>히어로에만 사용</strong>
              <span>첫 섹션 모델컷에만 인물 정체성을 적용합니다.</span>
            </button>
            <button className={modelImageUsage === "all-sections" ? styles.modelUsageCardActive : styles.modelUsageCard} onClick={() => onModelImageUsage("all-sections")} type="button">
              <strong>전체 섹션에 유지</strong>
              <span>모델컷 포함 시 같은 인물을 계속 유지합니다.</span>
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function ProductInputReadinessPanel({ readiness }: { readiness: ProductInputReadiness }) {
  const statusLabel =
    readiness.status === "ready" ? "생성 준비 완료" : readiness.status === "blocked" ? "자료 보강 필요" : "검수 권장";
  const statusClass =
    readiness.status === "ready"
      ? styles.inputQualityReady
      : readiness.status === "blocked"
        ? styles.inputQualityBlocked
        : styles.inputQualityReview;

  return (
    <div className={styles.inputQualityPanel}>
      <div className={styles.inputQualityHeader}>
        <div>
          <span className={styles.panelLabel}>입력 품질 게이트</span>
          <strong>{statusLabel}</strong>
        </div>
        <span className={statusClass}>{readiness.score}점</span>
      </div>
      <p>{readiness.summary}</p>
      {readiness.strengths.length ? (
        <div className={styles.inputQualityChips}>
          {readiness.strengths.slice(0, 4).map((strength) => (
            <span key={strength}>{strength}</span>
          ))}
        </div>
      ) : null}
      {readiness.actions.length ? (
        <div className={styles.inputQualityActions}>
          <strong>생성 전 보강</strong>
          {readiness.actions.slice(0, 4).map((action) => (
            <span key={action}>{action}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildProductInputReadiness(input: {
  productImages: PreparedReferenceImageDraft[];
  productDescription: string;
  additionalInfo: string;
  desiredTone: string;
  modelImage: PreparedImageDraft | null;
  modelImageUsage: ReferenceModelUsage | null;
}): ProductInputReadiness {
  const issues: string[] = [];
  const actions: string[] = [];
  const strengths: string[] = [];
  let score = 100;

  const description = normalizeReadinessText(input.productDescription);
  const direction = normalizeReadinessText(input.additionalInfo);
  const combined = `${description} ${direction} ${input.productImages.map((image) => image.fileName).join(" ")}`.toLowerCase();
  const isSoftware = /(sw|saas|software|app|앱|소프트웨어|웹서비스|대시보드|ui|ux|obs|브라우저|프로그램|위젯|서비스)/i.test(combined);
  const hasPrimary = input.productImages.some((image) => image.role === "primary");
  const hasDetail = input.productImages.some((image) => image.role === "detail");
  const hasProof = input.productImages.some((image) => image.role === "proof");
  const hasReference = input.productImages.some((image) => image.role === "reference");

  if (!input.productImages.length) {
    score -= 45;
    issues.push("대표 제품/SW 자료가 없습니다.");
    actions.push("대표 제품컷이나 실제 SW 화면을 1장 이상 업로드하세요.");
  } else {
    strengths.push(`${input.productImages.length}개 참조 자료 업로드`);
  }

  if (input.productImages.length && !hasPrimary) {
    score -= 12;
    issues.push("대표 기준 이미지가 지정되지 않았습니다.");
    actions.push("가장 중요한 제품컷 또는 실제 화면을 대표 자료로 지정하세요.");
  } else if (hasPrimary) {
    strengths.push("대표 자료 지정");
  }

  if (isSoftware && input.productImages.length < 2) {
    score -= 10;
    issues.push("SW/SaaS는 실제 화면 근거가 더 필요합니다.");
    actions.push("대시보드, 설정, 결과 화면처럼 실제 사용 흐름을 보여주는 화면을 2장 이상 넣으세요.");
  }

  if (!hasDetail && !hasProof) {
    score -= 14;
    issues.push("디테일/증빙 자료가 부족합니다.");
    actions.push(isSoftware ? "설정 화면, 상태 화면, 결과 화면 중 하나를 디테일 자료로 추가하세요." : "스펙, 구성품, 사용 장면, 인증/후기 등 확인 자료를 추가하세요.");
  } else {
    strengths.push(hasProof ? "증빙 자료 포함" : "디테일 자료 포함");
  }

  if (description.length < 80) {
    score -= 26;
    issues.push("상품 설명이 짧아 카피와 스토리 근거가 약합니다.");
    actions.push("상품명, 대상 고객, 핵심 기능 3개, 사용 상황, 구매/도입 이유를 5문장 이상으로 적으세요.");
  } else if (description.length < 160) {
    score -= 10;
    issues.push("상품 설명이 유료 납품용으로는 다소 짧습니다.");
    actions.push("가격/도입 이유, AS/지원 범위, 절대 만들면 안 되는 주장을 추가하세요.");
  } else {
    strengths.push("상품 사실 정보 충분");
  }

  if (!/(대상|타깃|고객|사용자|구매자|판매자|스트리머|운영자|담당자|브랜드|팀|사장|셀러)/.test(description)) {
    score -= 8;
    issues.push("대상 고객이 명확하지 않습니다.");
    actions.push("누가 쓰는지 한 문장으로 명시하세요. 예: 치지직 스트리머, 육아 중인 부모, 스마트스토어 셀러.");
  }

  if (!/(기능|장점|특징|연동|자동|지원|구성|소재|성분|화면|대시보드|배송|교환|as|요금|가격|보안|권한)/i.test(description)) {
    score -= 10;
    issues.push("핵심 기능/장점 근거가 부족합니다.");
    actions.push("기능을 나열하지 말고 고객이 얻는 변화까지 함께 적으세요.");
  }

  if (!/(사용|상황|문제|고민|불편|운영|방송|도입|구매|설치|관리|확인|비교|전환)/.test(description)) {
    score -= 8;
    issues.push("사용 상황 또는 고객 문제가 약합니다.");
    actions.push("고객이 어떤 상황에서 왜 필요로 하는지 실제 사용 맥락을 추가하세요.");
  }

  if (!/(금지|하지 말|과장|허위|없는|효능|효과|의학|보장|주의|기능|연동|지원|가격|요금|공식|로고)/.test(`${description} ${direction}`)) {
    score -= 6;
    issues.push("금지 기능/주의 표현이 없어 기능 과장 위험이 있습니다.");
    actions.push("없는 기능, 연동, 지원 범위, 효능, 가격, 공식 로고처럼 만들면 안 되는 내용을 명시하세요.");
  } else {
    strengths.push("금지 기능/주의 표현 입력");
  }

  if (input.modelImage && !input.modelImageUsage) {
    score -= 20;
    issues.push("모델 이미지를 업로드했지만 사용 범위가 정해지지 않았습니다.");
    actions.push("모델 이미지를 히어로에만 쓸지, 모든 섹션에 쓸지 선택하세요.");
  }

  if (direction.length >= 20 || input.desiredTone) {
    strengths.push("제작 방향 입력");
  } else {
    score -= 4;
    actions.push("원하는 톤, 첫 화면 우선순위, 강조/제외할 메시지를 제작 방향에 적으세요.");
  }

  if (hasReference) {
    strengths.push("톤/구도 참조 포함");
  }

  const finalScore = clampReadinessScore(score);
  const status = !input.productImages.length || (input.modelImage && !input.modelImageUsage) || finalScore < 55 ? "blocked" : finalScore < 80 ? "needs_review" : "ready";

  return {
    score: finalScore,
    status,
    summary:
      status === "ready"
        ? "유료 초안 생성을 시작할 수 있을 만큼 상품 사실과 참조 자료가 준비됐습니다."
        : status === "blocked"
          ? "현재 자료로 생성하면 품질 게이트에서 막힐 가능성이 높습니다. 생성 전 필수 정보를 보강하세요."
          : "생성은 가능하지만 결과 품질을 높이려면 몇 가지 자료를 더 보강하는 편이 좋습니다.",
    strengths: uniqueReadinessItems(strengths),
    issues: uniqueReadinessItems(issues),
    actions: uniqueReadinessItems(actions)
  };
}

function normalizeReadinessText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function uniqueReadinessItems(items: string[]) {
  return Array.from(new Set(items.filter(Boolean))).slice(0, 8);
}

function clampReadinessScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function RedesignUpload({ inputRef, files, onFiles }: { inputRef: RefObject<HTMLInputElement>; files: File[]; onFiles: (files: File[]) => void }) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <>
      <button
        className={isDragging ? styles.dropzoneActive : styles.dropzone}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          preventFileDragDefault(event);
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          preventFileDragDefault(event);
          setIsDragging(false);
        }}
        onDragOver={preventFileDragDefault}
        onDrop={(event) => {
          preventFileDragDefault(event);
          setIsDragging(false);
          onFiles(filesFromDragEvent(event));
        }}
        type="button"
      >
        <span className={styles.dropzoneIcon}><Upload size={24} /></span>
        <strong>기존 상세페이지 이미지 또는 PDF</strong>
        <p>클릭하거나 드래그 앤 드롭하세요. PDF는 브라우저에서 최대 6페이지까지 이미지로 변환해 참조로 사용합니다.</p>
        <span className={styles.dropzoneHint}>{files.length ? `${files.length}개 파일 선택됨` : "이미지, PDF"}</span>
      </button>
      <input
        className={styles.hiddenInput}
        multiple
        onChange={(event) => {
          onFiles(Array.from(event.target.files || []));
          event.currentTarget.value = "";
        }}
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
      />
      {files.length ? (
        <div className={styles.emptyStatePanel}>
          <FileText size={18} />
          <div>
            <strong>선택한 참조 파일</strong>
            <ul className={styles.emptyList}>{files.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}</ul>
          </div>
        </div>
      ) : null}
    </>
  );
}

function RedesignProjectPanel({
  project,
  projects,
  rolloutRequest,
  setRolloutRequest,
  editRequests,
  editingSectionId,
  onEditRequestChange,
  onEditSection,
  onGenerateMissing,
  onOpenEditor,
  onActivateProject
}: {
  project: RedesignProject;
  projects: RedesignProject[];
  rolloutRequest: string;
  setRolloutRequest: (value: string) => void;
  editRequests: Record<string, string>;
  editingSectionId: string | null;
  onEditRequestChange: (sectionId: string, value: string) => void;
  onEditSection: (sectionId: string) => void;
  onGenerateMissing: () => void;
  onOpenEditor: () => void;
  onActivateProject: (project: RedesignProject) => void;
}) {
  const generatedCount = project.sections.filter((section) => section.imageUrl).length;
  const missingCount = Math.max(0, REDESIGN_SECTION_TOTAL - generatedCount);
  const blockedSections = project.sections.filter((section) => section.imageUrl && getRedesignSectionQualityStatus(section) === "blocked");
  const reviewSections = project.sections.filter((section) => section.imageUrl && getRedesignSectionQualityStatus(section) === "needs_review");
  const readySections = project.sections.filter((section) => section.imageUrl && getRedesignSectionQualityStatus(section) === "ready");
  const qualityLabel = blockedSections.length
    ? `납품 차단 ${blockedSections.length}개`
    : generatedCount
      ? `납품 가능 ${readySections.length}/${generatedCount}`
      : "품질 대기";

  return (
    <div className={styles.redesignProjectPanel}>
      <div className={styles.redesignProjectHeader}>
        <div>
          <span className={styles.panelLabel}>Redesign Project</span>
          <h3>{project.title}</h3>
          <p>{generatedCount}개 생성됨 · {qualityLabel} · {project.channel} · {project.modelLabel}</p>
        </div>
        <span className={project.status === "완료" ? styles.successPill : styles.warningPill}>{project.status}</span>
      </div>

      {blockedSections.length ? (
        <div className={styles.inlineWarning}>
          <AlertCircle size={16} />
          품질 게이트에서 차단된 섹션이 있습니다. {blockedSections.map((section) => section.name).slice(0, 3).join(", ")} 섹션을 수정하거나 다시 생성하세요.
        </div>
      ) : reviewSections.length ? (
        <div className={styles.inlineWarning}>
          <AlertCircle size={16} />
          {reviewSections.length}개 섹션은 고객 제공 전 수동 검수가 필요합니다.
        </div>
      ) : null}

      {project.warning ? (
        <div className={styles.inlineWarning}>
          <AlertCircle size={16} />
          {project.warning}
        </div>
      ) : null}

      <div className={styles.rolloutPanel}>
        <label className={styles.fieldLabel} htmlFor="rolloutRequest">히어로 검토 후 요청</label>
        <textarea
          className={styles.textarea}
          id="rolloutRequest"
          onChange={(event) => setRolloutRequest(event.target.value)}
          placeholder="예: 첫 장은 제품이 잘 보이지만 카피가 강합니다. 나머지는 후기/근거/배송 불안을 더 신뢰감 있게 풀어주세요."
          rows={4}
          value={rolloutRequest}
        />
        <div className={styles.inlineActionRow}>
          <button className={styles.secondaryButton} disabled={!missingCount} onClick={onGenerateMissing} type="button">
            <Sparkles size={16} />
            {missingCount ? `나머지/누락 ${missingCount}장 생성` : "8장 생성 완료"}
          </button>
          <button className={styles.primaryButtonCompact} disabled={!generatedCount} onClick={onOpenEditor} type="button">
            <CheckCircle2 size={16} />
            편집기로 넘기기
          </button>
        </div>
      </div>

      <div className={styles.redesignSectionGrid}>
        {project.sections.map((section, index) => (
          <div className={styles.redesignSectionCard} key={section.section_id || section.id}>
            <div className={styles.redesignThumb}>
              {section.imageUrl ? <img alt={section.name} src={section.imageUrl} /> : <PlaceholderThumb index={index} />}
            </div>
            <div className={styles.redesignSectionCopy}>
              <strong>{section.name}</strong>
              <p>{section.purpose}</p>
              {section.imageQualityReport ? (
                <span className={getRedesignQualityPillClass(section)}>
                  {getRedesignQualityLabel(section)} · {section.imageQualityReport.score}점
                </span>
              ) : section.imageUrl ? (
                <span className={styles.warningPill}>검수 필요</span>
              ) : null}
              {section.providerProof ? <span className={styles.providerProofPill}>{section.providerProof.model} · fallback off</span> : null}
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor={`edit-${section.section_id}`}>섹션 수정 요청</label>
              <textarea
                className={styles.textarea}
                id={`edit-${section.section_id}`}
                onChange={(event) => onEditRequestChange(section.section_id, event.target.value)}
                placeholder="예: 헤드라인을 줄이고 제품 컷을 더 크게, 배송/교환 불안 해소 문구 추가"
                rows={3}
                value={editRequests[section.section_id] || ""}
              />
            </div>
            <button className={styles.secondaryButton} disabled={!section.imageUrl || editingSectionId === section.section_id} onClick={() => onEditSection(section.section_id)} type="button">
              {editingSectionId === section.section_id ? <Loader2 className={styles.spinIcon} size={16} /> : <RefreshCw size={16} />}
              이 섹션 수정
            </button>
          </div>
        ))}
      </div>

      {projects.length > 1 ? (
        <div className={styles.redesignProjectList}>
          <span className={styles.fieldLabel}>최근 리디자인 프로젝트</span>
          <div className={styles.inlineActionRow}>
            {projects.slice(0, 5).map((candidate) => (
              <button className={candidate.id === project.id ? styles.toneButtonActive : styles.toneButton} key={candidate.id} onClick={() => onActivateProject(candidate)} type="button">
                {candidate.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlaceholderThumb({ index }: { index: number }) {
  return (
    <div className={styles.placeholderThumb}>
      <FileImage size={20} />
      <span>S{index + 1}</span>
    </div>
  );
}

function getRedesignSectionQualityStatus(section: RedesignSection) {
  if (!section.imageUrl) return "needs_review";
  return section.imageQualityReport?.status ?? "needs_review";
}

function getRedesignQualityLabel(section: RedesignSection) {
  const status = getRedesignSectionQualityStatus(section);
  if (status === "ready") return "납품 가능";
  if (status === "blocked") return "납품 차단";
  return "검수 필요";
}

function getRedesignQualityPillClass(section: RedesignSection) {
  const status = getRedesignSectionQualityStatus(section);
  if (status === "ready") return styles.successPill;
  if (status === "blocked") return styles.warningPill;
  return styles.providerProofPill;
}

function ImagePreview({ image, ratioLabel }: { image: PreparedImageDraft; ratioLabel: string }) {
  return (
    <div className={styles.uploadPreviewCard}>
      <div className={styles.previewFrame}>
        <img alt={image.fileName} className={styles.selectedImage} src={image.previewUrl} />
      </div>
      <div className={styles.uploadMeta}>
        <strong>{image.fileName}</strong>
        <div className={styles.metaList}>
          <div className={styles.metaItem}><span>유형</span><strong>{ratioLabel}</strong></div>
          <div className={styles.metaItem}><span>포맷</span><strong>JPEG</strong></div>
          <div className={styles.metaItem}><span>전송</span><strong>960px</strong></div>
        </div>
      </div>
    </div>
  );
}

function KnowledgePanel({
  inputRef,
  items,
  onFiles,
  onDelete
}: {
  inputRef: RefObject<HTMLInputElement>;
  items: KnowledgeItem[];
  onFiles: (files: FileList | null) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={styles.modelUsagePanel}>
      <div className={styles.modelUsageHeader}>
        <strong>로컬 RAG 지식파일</strong>
        <span>PDF/TXT/MD를 등록하면 생성 프롬프트에 로컬 검색 결과를 반영합니다.</span>
      </div>
      <button className={styles.secondaryButton} onClick={() => inputRef.current?.click()} type="button">
        <FileText size={16} />
        지식파일 등록
      </button>
      <input className={styles.hiddenInput} multiple onChange={(event) => onFiles(event.target.files)} ref={inputRef} type="file" accept=".pdf,.txt,.md,text/*,application/pdf" />
      {items.length ? (
        <ul className={styles.emptyList}>
          {items.map((item) => (
            <li key={item.id}>
              {item.name}
              <button className={styles.inlineButton} onClick={() => onDelete(item.id)} type="button">삭제</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DraftPanel({ drafts, onOpen, onDelete }: { drafts: PdpDraftSummary[]; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <div className={styles.modelUsagePanel}>
      <div className={styles.modelUsageHeader}>
        <strong>저장된 초안</strong>
        <span>브라우저 IndexedDB에 저장됩니다.</span>
      </div>
      {drafts.length ? (
        <div className={styles.metaList}>
          {drafts.slice(0, 6).map((draft) => {
            const opensEditor = draft.sectionCount > 0 && draft.stageLabel === "편집 중";
            const modeLabel = draft.sourceMode === "redesign" ? "리디자인" : "새 PDP";
            const sectionLabel = draft.sectionCount ? `${draft.sectionCount}섹션` : "구조 생성 전";
            return (
              <div className={styles.metaItem} key={draft.id}>
                <strong>{draft.title}</strong>
                <span>{modeLabel} · {draft.stageLabel} · {sectionLabel}</span>
                <button className={styles.inlineButton} onClick={() => onOpen(draft.id)} type="button">
                  <FolderOpen size={14} />
                  {opensEditor ? "편집 열기" : "설정 불러오기"}
                </button>
                <button className={styles.inlineDangerButton} onClick={() => onDelete(draft.id)} type="button"><Trash2 size={14} />삭제</button>
              </div>
            );
          })}
        </div>
      ) : (
        <span className={styles.dropzoneHint}>아직 저장된 초안이 없습니다.</span>
      )}
    </div>
  );
}

function applyThemePreference(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function preventFileDragDefault(event: DragEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}

function filesFromDragEvent(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.files || []);
}

async function normalizeFilesForUpload(files: File[], limit: number, options: { renderImages?: boolean } = {}) {
  const output: File[] = [];
  for (const file of files) {
    if (output.length >= limit) break;
    const remainingSlots = Math.max(0, limit - output.length);
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      output.push(...(await renderPdfToImages(file, remainingSlots)));
    } else if (file.type.startsWith("image/")) {
      if (options.renderImages) {
        output.push(...(await renderImageToReferenceFiles(file, remainingSlots)));
      } else {
        output.push(file);
      }
    }
  }
  return output.slice(0, limit);
}

async function renderImageToReferenceFiles(file: File, limit: number) {
  if (limit <= 0) return [];
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(objectUrl);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) throw new Error("업로드 이미지를 읽지 못했습니다.");

    const isLongDetailPage = naturalHeight / naturalWidth > 2.2;
    const sliceCount = isLongDetailPage ? Math.min(limit, Math.ceil(naturalHeight / naturalWidth / 1.8)) : 1;
    const files: File[] = [];

    for (let index = 0; index < sliceCount; index += 1) {
      const sourceY = Math.floor((naturalHeight / sliceCount) * index);
      const sourceHeight = index === sliceCount - 1 ? naturalHeight - sourceY : Math.floor(naturalHeight / sliceCount);
      files.push(await cropImageToJpegFile({
        image,
        sourceX: 0,
        sourceY,
        sourceWidth: naturalWidth,
        sourceHeight,
        fileName: file.name,
        index
      }));
    }

    return files;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderPdfToImages(file: File, limit: number) {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: File[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, limit); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("PDF 페이지를 이미지로 변환하지 못했습니다."))), "image/jpeg", 0.88);
    });
    pages.push(new File([blob], `${file.name.replace(/\.pdf$/i, "")}-page-${pageNumber}.jpg`, { type: "image/jpeg" }));
  }
  return pages;
}

function ensurePrimaryReferenceImages(images: PreparedReferenceImageDraft[]) {
  if (!images.length) return images;
  if (images.some((image) => image.role === "primary")) return images;
  return images.map((image, index) => (index === 0 ? { ...image, role: "primary" as const } : image));
}

async function extractKnowledgeText(file: File) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return extractPdfText(file);
  return file.text();
}

async function extractPdfText(file: File) {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 80); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    if (text.trim()) pages.push(`[${file.name} p.${pageNumber}] ${text}`);
    if (pages.join("\n").length > 120000) break;
  }
  return pages.join("\n");
}

function configurePdfWorker(pdfjs: typeof import("pdfjs-dist")) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지 파일을 브라우저에서 열 수 없습니다."));
    image.src = src;
  });
}

async function cropImageToJpegFile({
  image,
  sourceX,
  sourceY,
  sourceWidth,
  sourceHeight,
  fileName,
  index
}: {
  image: HTMLImageElement;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  fileName: string;
  index: number;
}) {
  const maxWidth = 1200;
  const maxHeight = 1800;
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("이미지 변환 캔버스를 만들지 못했습니다.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("이미지를 JPEG로 변환하지 못했습니다."));
    }, "image/jpeg", 0.88);
  });

  const safeName = fileName.replace(/\.[^.]+$/i, "");
  return new File([blob], `${safeName}-reference-${index + 1}.jpg`, { type: "image/jpeg" });
}

function mergeRedesignProjects(baseProject: RedesignProject | null | undefined, incoming: RedesignProject): RedesignProject {
  if (!baseProject) {
    return {
      ...incoming,
      sections: sortSections(incoming.sections.map((section) => ({ ...section, revisions: ensureSectionRevisions(section) })))
    };
  }

  const byId = new Map<string, RedesignSection>();
  for (const section of baseProject.sections) byId.set(section.section_id || section.id, section);
  for (const section of incoming.sections) {
    const existing = byId.get(section.section_id || section.id);
    byId.set(section.section_id || section.id, {
      ...existing,
      ...section,
      revisions: mergeRevisions(existing, section)
    });
  }

  const sections = sortSections(Array.from(byId.values()));
  const generatedCount = sections.filter((section) => section.imageUrl).length;
  const hasIncomingFailures = Boolean(incoming.failedSections?.length);
  const warning = hasIncomingFailures
    ? incoming.warning || `${incoming.failedSections?.length ?? 0}개 섹션 생성에 실패했습니다. 누락 섹션을 이어 생성하세요.`
    : generatedCount >= REDESIGN_SECTION_TOTAL
      ? ""
      : baseProject.warning
        ? "일부 섹션이 아직 생성되지 않았습니다. 누락 섹션을 이어 생성하세요."
        : "";
  return {
    ...baseProject,
    ...incoming,
    id: baseProject.id,
    title: baseProject.title || incoming.title,
    createdAt: baseProject.createdAt,
    originalImage: baseProject.originalImage || incoming.originalImage,
    referenceImages: baseProject.referenceImages?.length ? baseProject.referenceImages : incoming.referenceImages,
    sections,
    count: generatedCount,
    status: hasIncomingFailures ? "부분완료" : generatedCount >= REDESIGN_SECTION_TOTAL ? "완료" : incoming.status,
    warning,
    failedSections: incoming.failedSections || []
  };
}

function mergeRevisions(existing: RedesignSection | undefined, incoming: RedesignSection) {
  const revisions = ensureSectionRevisions(existing);
  if (!incoming.imageUrl) return revisions;
  if (revisions.some((revision) => revision.imageUrl === incoming.imageUrl)) return revisions;
  return [
    ...revisions,
    {
      id: `revision-${Date.now()}-${incoming.section_id}`,
      imageUrl: incoming.imageUrl,
      label: revisions.length ? `생성 ${revisions.length + 1}` : "초안",
      createdAt: new Date().toISOString(),
      providerProof: incoming.providerProof
    }
  ];
}

function ensureSectionRevisions(section?: RedesignSection | null): RedesignSectionRevision[] {
  const revisions = section?.revisions?.filter((revision) => revision.imageUrl) ?? [];
  if (!section?.imageUrl) return revisions;
  if (revisions.some((revision) => revision.imageUrl === section.imageUrl)) return revisions;
  return [
    {
      id: `revision-original-${section.section_id}`,
      imageUrl: section.imageUrl,
      label: "초안",
      createdAt: new Date().toISOString(),
      providerProof: section.providerProof
    },
    ...revisions
  ];
}

function redesignProjectToResult(project: RedesignProject): GeneratedResult {
  const sections = sortSections(project.sections)
    .filter((section) => section.imageUrl)
    .map((section, index) => redesignSectionToBlueprint(section, index, project.ratio));

  return {
    originalImage: project.originalImage,
    referenceImages: project.referenceImages,
    sourceMode: "redesign",
    providerProof: project.providerProof,
    blueprint: {
      executiveSummary: typeof project.analysis === "object" && project.analysis && "diagnostic_summary" in project.analysis
        ? String((project.analysis as { diagnostic_summary?: string }).diagnostic_summary || "기존 상세페이지를 리디자인했습니다.")
        : "기존 상세페이지를 리디자인했습니다.",
      scorecard: [
        {
          category: "리디자인",
          score: project.status,
          reason: project.warning || `${sections.length}개 섹션을 편집기로 넘길 수 있습니다.`
        }
      ],
      blueprintList: sections.map((section) => `${section.section_id} ${section.section_name}`),
      sections
    }
  };
}

function redesignSectionToBlueprint(section: RedesignSection, index: number, aspectRatio: AspectRatio): SectionBlueprint {
  return {
    section_id: section.section_id || `S${index + 1}`,
    section_name: section.name || `섹션 ${index + 1}`,
    goal: section.purpose || "구매전환을 위한 리디자인 섹션",
    headline: section.headline || section.name || `섹션 ${index + 1}`,
    headline_en: section.headline || section.name || `Section ${index + 1}`,
    subheadline: section.subheadline || section.purpose || "",
    subheadline_en: section.subheadline || section.purpose || "",
    bullets: section.bullets?.length ? section.bullets : [section.source || "원본 정보 보존", "한국형 모바일 가독성", "구매 불안 해소"],
    bullets_en: section.bullets?.length ? section.bullets : [section.source || "Preserve source facts", "Mobile readability", "Reduce purchase anxiety"],
    trust_or_objection_line: section.trust || "원본에서 확인 가능한 정보만 사용",
    trust_or_objection_line_en: section.trust || "Use only verifiable source information.",
    CTA: section.cta || "자세히 보기",
    CTA_en: section.cta || "Learn more",
    layout_notes: `${aspectRatio} 리디자인 섹션`,
    compliance_notes: "확인되지 않은 효능, 기능, 가격, 공식 로고는 사용하지 않습니다. 리뷰, 인증, 수치형 신뢰 문구는 마케팅 카피로 사용할 수 있습니다.",
    image_id: section.image_id || `redesign_${index + 1}`,
    purpose: section.purpose || "상세페이지 리디자인",
    prompt_ko: section.promptText || section.prompt,
    prompt_en: section.promptText || section.prompt,
    negative_prompt: "fake product functions, fake logos, fake pricing, unreadable dense text",
    style_guide: "Korean mobile commerce PDP, trustworthy, conversion-focused",
    reference_usage: "기존 상세페이지 이미지를 제품 사실과 시각 기준으로 사용",
    generatedImage: section.imageUrl,
    imageQualityReport: section.imageQualityReport,
    providerProof: section.providerProof
  };
}

function sortSections(sections: RedesignSection[]) {
  return sections.slice().sort((left, right) => sectionNumber(left.section_id || left.id) - sectionNumber(right.section_id || right.id));
}

function sectionNumber(sectionId: string) {
  const value = Number(String(sectionId || "").replace(/\D/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function isEditorReadyResult(result: GeneratedResult | null | undefined): result is GeneratedResult {
  return Boolean(result?.blueprint?.sections?.length);
}

function hasAnalysisFallback(result: GeneratedResult) {
  return Boolean(result.generationTrace?.stages.some((stage) => stage.name === "fallback-section-blueprint"));
}

function withDetail(message: string, detail?: string) {
  const error = new Error(message);
  if (detail) error.name = detail;
  return error;
}
