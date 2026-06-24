"use client";

import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import JSZip from "jszip";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FileText,
  Globe2,
  Image as ImageIcon,
  Loader2,
  Moon,
  Palette,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Trash2,
  Type,
  User
} from "lucide-react";
import { Rnd } from "react-rnd";
import type {
  AspectRatio,
  GeneratedResult,
  ImageGenOptions,
  PdpCopyLanguage,
  PdpFinalQualityResponse,
  PdpGenerateImageRequest,
  PdpGenerateImageResponse,
  PdpImagePromptPreviewResponse,
  PdpLayerPlanContext,
  PdpLayeredDocumentV2,
  ReferenceModelUsage,
  SectionBlueprint
} from "@runacademy/shared";
import type {
  CanvasLayer,
  FloatingWorkbenchState,
  OverlayTextAlign,
  PdpEditorDraftState,
  PreparedImageDraft,
  ShapeLayer,
  TextOverlay,
  WorkbenchTab
} from "./pdp-drafts";
import { buildEditorLayeredDocumentV2, exportFigmaDocument } from "./features/layered/editor-layered-document";
import { buildLayerExportManifest } from "./features/layered/layered-export-manifest";
import { canvasLayersFromLayeredDocumentV2 } from "./features/layered/layered-document-migration";
import { buildLayerTreePreview, summarizeLayeredDocument } from "./features/layered/layered-document-summary";
import styles from "./pdp-maker.module.css";
import { apiJson, toDataUrl } from "./pdp-utils";

interface PdpEditorProps {
  initialResult: GeneratedResult;
  aspectRatio: AspectRatio;
  desiredTone: string;
  theme: "dark" | "light";
  initialDraftState?: PdpEditorDraftState | null;
  lastSavedAt?: string | null;
  manualSaveToastToken?: number;
  onOpenSettings?: () => void;
  onReset: () => void;
  onToggleTheme: () => void;
  onDraftStateChange?: (draftState: PdpEditorDraftState) => void;
  onManualSave?: () => void;
  apiConnectionLabel?: string;
  referenceModelImage?: PreparedImageDraft | null;
  referenceModelUsage?: ReferenceModelUsage | null;
  saveState?: "idle" | "saving" | "saved" | "error";
}

interface ImageColorRecommendations {
  photoColors: string[];
  recommendedTextColors: string[];
  recommendedShapeColors: string[];
  accentColor: string;
  darkColor: string;
  lightColor: string;
}

type DeliveryStatus = NonNullable<GeneratedResult["qualityReport"]>["status"];
type SectionImageQualityReport = NonNullable<SectionBlueprint["imageQualityReport"]>;

interface DeliveryReportSection {
  sectionId: string;
  sectionName: string;
  generated: boolean;
  status: DeliveryStatus;
  score: number | null;
  autoRegenerated: boolean;
  providerProof: SectionBlueprint["providerProof"] | null;
  headline: string;
  subheadline: string;
  purpose: string;
  editableTextLayerCount: number;
  issues: NonNullable<SectionBlueprint["imageQualityReport"]>["issues"];
  nextActions: string[];
  copyWarnings: NonNullable<GeneratedResult["copyWarnings"]>;
}

interface DeliveryReport {
  generatedAt: string;
  sourceMode: NonNullable<GeneratedResult["sourceMode"]> | "product";
  analysisMode: "model_analysis" | "fallback_blueprint";
  analysisFallbackUsed: boolean;
  aspectRatio: AspectRatio;
  desiredTone: string;
  overallStatus: DeliveryStatus;
  summary: string;
  counts: {
    totalSections: number;
    generatedSections: number;
    readySections: number;
    reviewSections: number;
    blockedSections: number;
    missingSections: number;
    copyWarnings: number;
  };
  productBrief: GeneratedResult["productBrief"] | null;
  structureQuality: GeneratedResult["qualityReport"] | null;
  providerProof: GeneratedResult["providerProof"] | null;
  sections: DeliveryReportSection[];
  nextActions: string[];
}

const FONT_OPTIONS = [
  { label: "Pretendard", value: "'Pretendard', sans-serif" },
  { label: "Noto Sans KR", value: "'Noto Sans KR', sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Monospace", value: "monospace" }
];

const STYLE_OPTIONS: Array<{ value: NonNullable<ImageGenOptions["style"]>; label: string; description: string }> = [
  { value: "studio", label: "스튜디오컷", description: "정제된 배경과 집중도 높은 제품 연출" },
  { value: "lifestyle", label: "라이프스타일컷", description: "실사용 장면과 감정선이 느껴지는 연출" },
  { value: "outdoor", label: "아웃도어컷", description: "씬이 살아있는 외부 공간 연출" }
];

const MODEL_GENDER_OPTIONS: Array<{ value: NonNullable<ImageGenOptions["modelGender"]>; label: string }> = [
  { value: "female", label: "여자 모델" },
  { value: "male", label: "남자 모델" }
];

const MODEL_AGE_OPTIONS: Array<{ value: NonNullable<ImageGenOptions["modelAgeRange"]>; label: string }> = [
  { value: "teen", label: "10대 후반" },
  { value: "20s", label: "20대" },
  { value: "30s", label: "30대" },
  { value: "40s", label: "40대" },
  { value: "50s_plus", label: "50대+" }
];

const MODEL_COUNTRY_OPTIONS: Array<{ value: NonNullable<ImageGenOptions["modelCountry"]>; label: string }> = [
  { value: "korea", label: "한국" },
  { value: "japan", label: "일본" },
  { value: "usa", label: "미국" },
  { value: "france", label: "프랑스" },
  { value: "germany", label: "독일" },
  { value: "africa", label: "아프리카" }
];

const FONT_WEIGHT_OPTIONS = [
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "700", label: "Bold" },
  { value: "900", label: "Black" }
];

const ALIGN_OPTIONS: Array<{ value: OverlayTextAlign; label: string; Icon: typeof AlignLeft }> = [
  { value: "left", label: "왼쪽", Icon: AlignLeft },
  { value: "center", label: "가운데", Icon: AlignCenter },
  { value: "right", label: "오른쪽", Icon: AlignRight }
];

const DEFAULT_COLOR_RECOMMENDATIONS: ImageColorRecommendations = {
  photoColors: ["#e8ddcb", "#102532", "#7a6b5a", "#d5b692"],
  recommendedTextColors: ["#ffffff", "#102532", "#f4efe6", "#4cb7aa"],
  recommendedShapeColors: ["#102532", "#1d3748", "#f4efe6", "#85735e", "#c8474d"],
  accentColor: "#4cb7aa",
  darkColor: "#102532",
  lightColor: "#f4efe6"
};
const BASIC_SOLID_COLORS = [
  "#ffffff",
  "#f4efe6",
  "#d9d2c3",
  "#c4b8a0",
  "#c8474d",
  "#e05a63",
  "#102532",
  "#1d3748",
  "#4cb7aa",
  "#cf6f52",
  "#d8b65b",
  "#111111"
];

const INSUFFICIENT_COPY_MESSAGE = "제품 관련 카피를 만들 정보가 부족합니다. 요청사항이나 제품 자료를 더 넣고 재분석하세요.";
const GENERIC_COPY_TOKENS = new Set([
  "hero",
  "benefit",
  "benefits",
  "evidence",
  "proof",
  "review",
  "reviews",
  "spec",
  "specs",
  "faq",
  "cta",
  "headline",
  "subheadline",
  "section",
  "copy",
  "한국어헤드라인",
  "한국어서브카피",
  "구매저항해소문장",
  "불릿1",
  "불릿2",
  "히어로",
  "문제공감",
  "핵심베네핏",
  "베네핏",
  "차별점",
  "근거",
  "근거와신뢰",
  "사용법데모",
  "사용사례",
  "상세페이지",
  "섹션",
  "자세히보기"
]);
export function PdpEditor({
  initialResult,
  aspectRatio,
  desiredTone,
  theme,
  initialDraftState,
  lastSavedAt,
  manualSaveToastToken = 0,
  onOpenSettings,
  onReset,
  onToggleTheme,
  onDraftStateChange,
  onManualSave,
  apiConnectionLabel = "키 필요",
  referenceModelImage = null,
  referenceModelUsage = null,
  saveState = "idle"
}: PdpEditorProps) {
  const initialSections = initialDraftState?.sections?.length
    ? initialDraftState.sections.map((section) => normalizeSectionCopyFields({ ...section }))
    : initialResult.blueprint.sections.map((section) => normalizeSectionCopyFields({ ...section }));
  const [currentSectionIndex, setCurrentSectionIndex] = useState(() => initialDraftState?.currentSectionIndex ?? 0);
  const [sections, setSections] = useState(() => initialSections);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState(
    () => initialDraftState?.notice ?? "섹션 컷을 고르고 텍스트를 배치한 뒤 바로 다운로드할 수 있습니다."
  );
  const [sectionOptions, setSectionOptions] = useState<Record<number, ImageGenOptions>>(
    () => normalizeSectionOptions(initialDraftState?.sectionOptions ?? {}, referenceModelUsage)
  );
  const [overlaysBySection, setOverlaysBySection] = useState<Record<number, CanvasLayer[]>>(
    () => {
      const savedOverlays = normalizeOverlayRecord(initialDraftState?.overlaysBySection ?? {});
      if (Object.keys(savedOverlays).length) {
        return savedOverlays;
      }
      const recoveredOverlays = normalizeOverlayRecord(
        canvasLayersFromLayeredDocumentV2({
          document: initialDraftState?.layeredDocumentV2 ?? initialResult.layeredDocumentV2 ?? null,
          sections: initialSections
        })
      );
      return Object.keys(recoveredOverlays).length ? recoveredOverlays : buildAutoCopyOverlayRecord(initialSections, aspectRatio);
    }
  );
  const [defaultCopyLanguage, setDefaultCopyLanguage] = useState<PdpCopyLanguage>(
    () => initialDraftState?.defaultCopyLanguage ?? "ko"
  );
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null);
  const [activeColorPalette, setActiveColorPalette] = useState<null | { layerId: string; role: "text" | "shape" | "shadow" }>(null);
  const [colorRecommendations, setColorRecommendations] = useState<ImageColorRecommendations>(DEFAULT_COLOR_RECOMMENDATIONS);
  const [inspectorSections, setInspectorSections] = useState({
    shotMood: true,
    persona: true
  });
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>(() => initialDraftState?.workbenchTab ?? "image");
  const [workbenchState, setWorkbenchState] = useState<FloatingWorkbenchState>(
    () =>
      initialDraftState?.workbenchState ?? {
        x: 756,
        y: 24,
        width: 332,
        height: 500,
        isOpen: true
      }
  );
  const [showSaveToast, setShowSaveToast] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [isDownloadingLongPage, setIsDownloadingLongPage] = useState(false);
  const [batchGenerationMode, setBatchGenerationMode] = useState<null | "missing" | "quality">(null);
  const [isLoadingImagePromptPreview, setIsLoadingImagePromptPreview] = useState(false);
  const [imagePromptPreviewBySection, setImagePromptPreviewBySection] = useState<Record<number, string>>({});
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const resizeSessionRef = useRef<Record<string, { width: number; height: number; fontSize: number }>>({});

  const safeCurrentSectionIndex = sections.length
    ? Math.min(Math.max(currentSectionIndex, 0), sections.length - 1)
    : 0;
  const currentSection = sections[safeCurrentSectionIndex];
  const currentLayers = overlaysBySection[safeCurrentSectionIndex] ?? [];
  const currentCopyWarnings = (initialResult.copyWarnings ?? []).filter(
    (warning) => !warning.sectionId || warning.sectionId === currentSection?.section_id
  );
  const currentTextLayers = currentLayers.filter(isTextLayer);
  const currentShapeLayers = currentLayers.filter(isShapeLayer);
  const selectedLayer = currentLayers.find((overlay) => overlay.id === selectedOverlayId) ?? null;
  const selectedTextLayer = selectedLayer && isTextLayer(selectedLayer) ? selectedLayer : null;
  const selectedShapeLayer = selectedLayer && isShapeLayer(selectedLayer) ? selectedLayer : null;
  const generatedCount = sections.filter((section) => Boolean(section.generatedImage)).length;
  const missingGeneratedSections = sections.filter((section) => !section.generatedImage);
  const readyGeneratedCount = sections.filter((section) => section.generatedImage && getSectionQualityStatus(section) === "ready").length;
  const reviewGeneratedSections = sections.filter((section) => section.generatedImage && getSectionQualityStatus(section) === "needs_review");
  const blockedGeneratedSections = sections.filter((section) => section.generatedImage && getSectionQualityStatus(section) === "blocked");
  const qualityRetrySections = sections.filter((section) => section.generatedImage && getSectionQualityStatus(section) !== "ready");
  const isGenerationBusy = isGeneratingImage || Boolean(batchGenerationMode);
  const analysisFallbackUsed = hasAnalysisFallback(initialResult);
  const deliveryGateLabel = blockedGeneratedSections.length
    ? `납품 차단 ${blockedGeneratedSections.length}개`
    : generatedCount
      ? `납품 가능 ${readyGeneratedCount}/${generatedCount}`
      : "납품 대기";
  const blueprintList = (initialResult.blueprint.blueprintList ?? []).filter(Boolean);
  const toneLabel = desiredTone || "AI 자동 추천";
  const progressPercent = sections.length ? Math.round(((safeCurrentSectionIndex + 1) / sections.length) * 100) : 0;
  const layeredDocumentV2 = useMemo(
    () =>
      buildEditorLayeredDocumentV2({
        initialResult,
        sections,
        overlaysBySection,
        aspectRatio,
        existingDocument: initialDraftState?.layeredDocumentV2 ?? initialResult.layeredDocumentV2 ?? null
      }),
    [aspectRatio, initialDraftState?.layeredDocumentV2, initialResult, overlaysBySection, sections]
  );
  const layeredDocumentSummary = useMemo(() => summarizeLayeredDocument(layeredDocumentV2), [layeredDocumentV2]);
  const figmaPayload = useMemo(() => exportFigmaDocument(layeredDocumentV2), [layeredDocumentV2]);
  const layerExportManifest = useMemo(
    () =>
      buildLayerExportManifest({
        document: layeredDocumentV2,
        figmaPayload,
        summary: layeredDocumentSummary
      }),
    [figmaPayload, layeredDocumentSummary, layeredDocumentV2]
  );
  const currentLayeredSectionSummary = layeredDocumentSummary.sections.find(
    (section) => section.sectionId === currentSection?.section_id
  );
  const currentLayerTreePreview = useMemo(
    () =>
      buildLayerTreePreview({
        document: layeredDocumentV2,
        sectionId: currentSection?.section_id,
        sectionIndex: safeCurrentSectionIndex,
        maxItems: 18
      }),
    [currentSection?.section_id, layeredDocumentV2, safeCurrentSectionIndex]
  );

  useEffect(() => {
    if (currentSectionIndex !== safeCurrentSectionIndex) {
      setCurrentSectionIndex(safeCurrentSectionIndex);
    }
  }, [currentSectionIndex, safeCurrentSectionIndex]);

  useEffect(() => {
    setSelectedOverlayId(null);
    setEditingOverlayId(null);
    setActiveColorPalette(null);
    setErrorMessage("");
  }, [safeCurrentSectionIndex]);

  useEffect(() => {
    if (!selectedLayer) {
      return;
    }

    setWorkbenchState((current) => ({
      ...current,
      isOpen: true
    }));
  }, [safeCurrentSectionIndex, selectedLayer]);

  useEffect(() => {
    if (!previewStageRef.current) {
      return;
    }

    setWorkbenchState((current) => clampWorkbenchToStage(current, previewStageRef.current));
  }, [safeCurrentSectionIndex, currentSection?.generatedImage]);

  useEffect(() => {
    onDraftStateChange?.({
      currentSectionIndex: safeCurrentSectionIndex,
      sections,
      sectionOptions,
      overlaysBySection,
      layeredDocumentV2,
      defaultCopyLanguage,
      notice,
      workbenchTab,
      workbenchState
    });
  }, [defaultCopyLanguage, layeredDocumentV2, notice, onDraftStateChange, overlaysBySection, safeCurrentSectionIndex, sectionOptions, sections, workbenchState, workbenchTab]);

  useEffect(() => {
    let isCancelled = false;

    if (!currentSection?.generatedImage) {
      setColorRecommendations(DEFAULT_COLOR_RECOMMENDATIONS);
      return;
    }

    void extractImageColorRecommendations(currentSection.generatedImage).then((next) => {
      if (!isCancelled) {
        setColorRecommendations(next);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [currentSection?.generatedImage]);

  useEffect(() => {
    if (!manualSaveToastToken) {
      return;
    }

    setShowSaveToast(true);
    const timeout = window.setTimeout(() => {
      setShowSaveToast(false);
    }, 2200);

    return () => window.clearTimeout(timeout);
  }, [manualSaveToastToken]);

  const textColorRecommendations = useMemo(
    () => sortColorsByContrast(colorRecommendations.recommendedTextColors, selectedTextLayer?.color ?? null),
    [colorRecommendations.recommendedTextColors, selectedTextLayer?.color]
  );
  const shapeColorRecommendations = useMemo(
    () => sortColorsByContrast(colorRecommendations.recommendedShapeColors, selectedShapeLayer?.fillColor ?? null),
    [colorRecommendations.recommendedShapeColors, selectedShapeLayer?.fillColor]
  );
  const photoColorRecommendations = useMemo(() => uniqueColors(colorRecommendations.photoColors), [colorRecommendations.photoColors]);

  const referenceModelAppliesToSection = (sectionIndex: number) =>
    Boolean(referenceModelImage && referenceModelUsage && (referenceModelUsage === "all-sections" || sectionIndex === 0));
  const referenceModelAppliesToCurrentSection = referenceModelAppliesToSection(safeCurrentSectionIndex);
  const currentOptions = useMemo(() => {
    return normalizeImageOptions(sectionOptions[safeCurrentSectionIndex], referenceModelAppliesToCurrentSection);
  }, [referenceModelAppliesToCurrentSection, safeCurrentSectionIndex, sectionOptions]);
  const usesReferenceModel = Boolean(currentOptions.withModel && referenceModelAppliesToCurrentSection);
  const personaLockedMessage = usesReferenceModel
    ? referenceModelUsage === "all-sections"
      ? "모델 일관성 유지 선택으로 타깃 페르소나가 비활성화되었습니다."
      : "히어로우 전용 업로드 모델이 적용되어 타깃 페르소나가 비활성화되었습니다."
    : "";

  if (!currentSection) {
    return (
      <main className={styles.page} data-theme={theme}>
        <section className={styles.editorShell}>
          <div className={styles.errorBanner}>섹션 정보를 불러오지 못했습니다.</div>
        </section>
      </main>
    );
  }

  const finalImagePromptValue = currentSection.image_prompt_override ?? imagePromptPreviewBySection[safeCurrentSectionIndex] ?? "";
  const isUsingFinalImagePromptOverride = Boolean(currentSection.image_prompt_override?.trim());

  const setCurrentOptions = (updates: Partial<ImageGenOptions>) => {
    setSectionOptions((current) => ({
      ...current,
      [safeCurrentSectionIndex]: {
        ...currentOptions,
        ...updates
      }
    }));
  };

  const updateCurrentSection = (updates: Partial<SectionBlueprint>) => {
    setSections((current) =>
      current.map((section, index) =>
        index === safeCurrentSectionIndex ? normalizeSectionCopyFields({ ...section, ...updates }) : section
      )
    );
  };

  const updateCurrentSectionList = (field: "bullets" | "bullets_en" | "source_fact_refs", value: string) => {
    updateCurrentSection({
      [field]: value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    } as Partial<SectionBlueprint>);
  };

  const handleLoadFinalImagePromptPreview = async () => {
    setIsLoadingImagePromptPreview(true);
    setErrorMessage("");

    try {
      const response = await apiJson<PdpImagePromptPreviewResponse>("/pdp/image-prompt", {
        method: "POST",
        body: JSON.stringify(buildSectionImageRequest(safeCurrentSectionIndex, currentSection))
      });

      if (!response.ok) {
        throw new Error(response.message);
      }

      setImagePromptPreviewBySection((current) => ({
        ...current,
        [safeCurrentSectionIndex]: response.prompt
      }));
      updateCurrentSection({ image_prompt_override: response.prompt });
      setNotice(
        response.usingOverride
          ? "현재 수동 최종 프롬프트를 서버 기준으로 확인했습니다."
          : "서버가 실제로 조합할 최종 프롬프트를 불러와 수동 편집 상태로 전환했습니다."
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "최종 이미지 프롬프트를 불러오지 못했습니다.");
    } finally {
      setIsLoadingImagePromptPreview(false);
    }
  };

  const handleClearFinalImagePromptOverride = () => {
    updateCurrentSection({ image_prompt_override: "" });
    setImagePromptPreviewBySection((current) => {
      const next = { ...current };
      delete next[safeCurrentSectionIndex];
      return next;
    });
    setNotice("최종 이미지 프롬프트를 자동 조합 모드로 되돌렸습니다. 섹션 가이드 변경 사항이 다음 생성에 다시 반영됩니다.");
  };

  const updateTextOverlayContent = (overlayId: string, nextText: string) => {
    setOverlaysBySection((current) => ({
      ...current,
      [safeCurrentSectionIndex]: (current[safeCurrentSectionIndex] ?? []).map((overlay) => {
        if (overlay.id !== overlayId || !isTextLayer(overlay)) {
          return overlay;
        }

        return normalizeTextOverlay({
          ...overlay,
          text: nextText,
          translations: {
            ...overlay.translations,
            [overlay.language]: nextText
          }
        });
      })
    }));
  };

  const handleOverlayLanguageChange = (overlay: TextOverlay, nextLanguage: PdpCopyLanguage) => {
    if (overlay.language === nextLanguage) {
      return;
    }

    setDefaultCopyLanguage(nextLanguage);
    updateOverlay(overlay.id, applyLanguageToTextOverlay(overlay, nextLanguage));
  };

  const handleTextAlignChange = (overlay: TextOverlay, nextAlign: OverlayTextAlign) => {
    const currentWidth = toNumericSize(overlay.width, 320);
    const recommendedWidth = clampValue(Math.round(overlay.fontSize * 10), 220, 520);
    const nextWidth = Math.max(currentWidth, recommendedWidth);

    updateOverlay(overlay.id, {
      textAlign: nextAlign,
      width: nextWidth
    });

    if (nextWidth > currentWidth) {
      setNotice("줄맞춤이 잘 보이도록 텍스트 박스 폭도 함께 넓혔습니다.");
    }
  };

  const stopShellClick = (event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const clearLayerSelection = () => {
    setSelectedOverlayId(null);
    setEditingOverlayId(null);
    setActiveColorPalette(null);
  };

  const toggleInspectorSection = (key: keyof typeof inspectorSections) => {
    setInspectorSections((current) => ({
      ...current,
      [key]: !current[key]
    }));
  };

  const openWorkbench = (tab: WorkbenchTab) => {
    setWorkbenchTab(tab);
    setWorkbenchState((current) => {
      const fallback = getWorkbenchPosition(previewStageRef.current);

      return {
        ...(current.isOpen ? current : fallback),
        isOpen: true
      };
    });
  };

  const snapWorkbenchToEdge = () => {
    const nextPosition = getWorkbenchPosition(previewStageRef.current);
    setWorkbenchState((current) => ({
      ...current,
      ...nextPosition,
      isOpen: true
    }));
  };

  const snapWorkbenchToOverlay = () => {
    if (!selectedLayer) {
      return;
    }

    setWorkbenchState((current) => ({
      ...current,
      ...anchorWorkbenchToOverlay(selectedLayer, imageContainerRef.current, previewStageRef.current, current),
      isOpen: true
    }));
  };

  const renderColorPaletteField = ({
    label,
    layerId,
    role,
    currentColor,
    recommendedColors,
    onSelect
  }: {
    label: string;
    layerId: string;
    role: "text" | "shape" | "shadow";
    currentColor: string;
    recommendedColors: string[];
    onSelect: (color: string) => void;
  }) => {
    const isOpen = activeColorPalette?.layerId === layerId && activeColorPalette.role === role;

    return (
      <label className={styles.floatingField}>
        <span className={styles.optionMiniLabel}>{label}</span>
        <div className={styles.colorFieldStack}>
          <button
            className={styles.colorTriggerButton}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setActiveColorPalette((current) =>
                current?.layerId === layerId && current.role === role ? null : { layerId, role }
              );
            }}
            style={{ ["--swatch-color" as string]: currentColor }}
            type="button"
          >
            <span className={styles.colorTriggerPreview} />
            <code>{currentColor}</code>
          </button>

          {isOpen ? (
            <div className={styles.colorPopover}>
              <div className={styles.paletteSection}>
                <span className={styles.optionMiniLabel}>사진 색상</span>
                <div className={styles.swatchGridWide}>
                  {photoColorRecommendations.map((color) => (
                    <button
                      className={styles.swatchButton}
                      key={`${role}-photo-${color}`}
                      onClick={() => {
                        onSelect(color);
                        setActiveColorPalette(null);
                      }}
                      style={{ ["--swatch-color" as string]: color }}
                      type="button"
                    >
                      <span className={styles.swatchPreview} />
                      <code>{color}</code>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.paletteSection}>
                <span className={styles.optionMiniLabel}>기본 단색</span>
                <div className={styles.swatchGridWide}>
                  {BASIC_SOLID_COLORS.map((color) => (
                    <button
                      className={styles.swatchButton}
                      key={`${role}-basic-${color}`}
                      onClick={() => {
                        onSelect(color);
                        setActiveColorPalette(null);
                      }}
                      style={{ ["--swatch-color" as string]: color }}
                      type="button"
                    >
                      <span className={styles.swatchPreview} />
                      <code>{color}</code>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.paletteSection}>
                <span className={styles.optionMiniLabel}>어울리는 컬러 추천</span>
                <div className={styles.swatchGridWide}>
                  {recommendedColors.map((color) => (
                    <button
                      className={styles.swatchButton}
                      key={`${role}-recommended-${color}`}
                      onClick={() => {
                        onSelect(color);
                        setActiveColorPalette(null);
                      }}
                      style={{ ["--swatch-color" as string]: color }}
                      type="button"
                    >
                      <span className={styles.swatchPreview} />
                      <code>{color}</code>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.colorInputRow}>
                <input
                  className={styles.colorInputLarge}
                  onChange={(event) => onSelect(event.target.value)}
                  type="color"
                  value={currentColor}
                />
                <button className={styles.inlineButton} onClick={() => setActiveColorPalette(null)} type="button">
                  닫기
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </label>
    );
  };

  const renderWorkbenchBody = () => {
    switch (workbenchTab) {
      case "image":
        return (
          <div className={styles.workbenchSectionStack}>
            <div className={styles.optionSummaryBar}>
              <span className={styles.summaryChip}>
                {STYLE_OPTIONS.find((option) => option.value === currentOptions.style)?.label ?? "스튜디오컷"}
              </span>
              <span className={styles.summaryChip}>{selectedModelSummary}</span>
              <span className={styles.summaryChip}>
                {currentOptions.guidePriorityMode === "guide-first" ? "디자인 가이드 우선" : "컷 타입 우선"}
              </span>
            </div>

            <div className={styles.optionSurface}>
              <div className={styles.optionSectionHeader}>
                <div>
                  <span className={styles.optionSectionEyebrow}>샷 타입</span>
                  <strong>배경과 연출 무드</strong>
                </div>
                <button className={styles.sectionToggleButton} onClick={() => toggleInspectorSection("shotMood")} type="button">
                  {inspectorSections.shotMood ? "숨기기" : "보이기"}
                  {inspectorSections.shotMood ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              {inspectorSections.shotMood ? (
                <>
                  <div className={styles.styleOptionGrid}>
                    {STYLE_OPTIONS.map((style) => (
                      <button
                        className={currentOptions.style === style.value ? styles.styleCardActive : styles.styleCard}
                        key={style.value}
                        onClick={() => setCurrentOptions({ style: style.value })}
                        type="button"
                      >
                        <strong>{style.label}</strong>
                        <small>{style.description}</small>
                      </button>
                    ))}
                  </div>

                  <label className={styles.toggleCard}>
                    <div className={styles.toggleCardCopy}>
                      <strong>디자인 가이드 우선</strong>
                      <span>
                        {currentOptions.guidePriorityMode === "guide-first"
                          ? "Image Purpose, Layout Notes, Style Guide를 함께 반영합니다."
                          : "Image Purpose만 유지하고, 선택한 컷 타입을 우선해 이미지를 설계합니다."}
                      </span>
                    </div>
                    <input
                      checked={currentOptions.guidePriorityMode === "guide-first"}
                      onChange={(event) =>
                        setCurrentOptions({
                          guidePriorityMode: event.target.checked ? "guide-first" : "style-first"
                        })
                      }
                      type="checkbox"
                    />
                  </label>
                </>
              ) : (
                <p className={styles.collapsedHint}>
                  현재 선택: {STYLE_OPTIONS.find((style) => style.value === currentOptions.style)?.label ?? "스튜디오컷"} ·{" "}
                  {currentOptions.guidePriorityMode === "guide-first" ? "디자인 가이드 우선" : "컷 타입 우선"}
                </p>
              )}
            </div>

            <div className={styles.optionSurface}>
              <div className={styles.optionSectionHeader}>
                <div>
                  <span className={styles.optionSectionEyebrow}>모델 설정</span>
                  <strong>타깃 페르소나 지정</strong>
                </div>
                <div className={styles.optionHeaderTools}>
                  <User size={16} />
                  <button className={styles.sectionToggleButton} onClick={() => toggleInspectorSection("persona")} type="button">
                    {inspectorSections.persona ? "숨기기" : "보이기"}
                    {inspectorSections.persona ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
              </div>
              {inspectorSections.persona ? (
                <>
                  <label className={styles.toggleCard}>
                    <div className={styles.toggleCardCopy}>
                      <strong>모델컷 포함</strong>
                      <span>
                        {referenceModelImage
                          ? "제품과 함께 연출되는 인물컷이 필요하면 켜 두세요. 업로드 모델이 적용되는 구간에서는 동일 인물이 유지됩니다."
                          : "제품과 함께 연출되는 인물컷이 필요한 경우 켜 두세요."}
                      </span>
                    </div>
                    <input
                      checked={currentOptions.withModel}
                      onChange={(event) => setCurrentOptions({ withModel: event.target.checked })}
                      type="checkbox"
                    />
                  </label>

                  {currentOptions.withModel ? (
                    <div className={styles.optionStack}>
                      {usesReferenceModel ? (
                        <div className={styles.lockedHint}>
                          <AlertCircle size={15} />
                          <div>
                            <strong>{referenceModelUsage === "all-sections" ? "전체 일관성 유지 적용 중" : "히어로우 업로드 모델 적용 중"}</strong>
                            <span>{personaLockedMessage}</span>
                          </div>
                        </div>
                      ) : null}

                      <div className={styles.optionFieldBlock}>
                        <span className={styles.optionMiniLabel}>성별</span>
                        <div className={styles.segmentedRow}>
                          {MODEL_GENDER_OPTIONS.map((option) => (
                            <button
                              className={currentOptions.modelGender === option.value ? styles.segmentedButtonActive : styles.segmentedButton}
                              disabled={usesReferenceModel}
                              key={option.value}
                              onClick={() => setCurrentOptions({ modelGender: option.value })}
                              type="button"
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className={styles.optionFieldBlock}>
                        <span className={styles.optionMiniLabel}>연령대</span>
                        <div className={styles.segmentedGridCompact}>
                          {MODEL_AGE_OPTIONS.map((option) => (
                            <button
                              className={currentOptions.modelAgeRange === option.value ? styles.segmentedButtonActive : styles.segmentedButton}
                              disabled={usesReferenceModel}
                              key={option.value}
                              onClick={() => setCurrentOptions({ modelAgeRange: option.value })}
                              type="button"
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className={styles.optionFieldBlock}>
                        <div className={styles.optionFieldHeader}>
                          <span className={styles.optionMiniLabel}>국가</span>
                          <Globe2 size={14} />
                        </div>
                        <div className={styles.countryGrid}>
                          {MODEL_COUNTRY_OPTIONS.map((option) => (
                            <button
                              className={currentOptions.modelCountry === option.value ? styles.countryCardActive : styles.countryCard}
                              disabled={usesReferenceModel}
                              key={option.value}
                              onClick={() => setCurrentOptions({ modelCountry: option.value })}
                              type="button"
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className={styles.collapsedHint}>현재 설정: {selectedModelSummary}</p>
              )}
            </div>

            <button className={styles.primaryButtonWide} disabled={isGenerationBusy} onClick={handleGenerateImage} type="button">
              {isGenerationBusy ? <Loader2 className={styles.spinIcon} size={16} /> : currentSection.generatedImage ? <RefreshCw size={16} /> : <ImageIcon size={16} />}
              {batchGenerationMode
                ? batchGenerationMode === "missing"
                  ? "남은 섹션 생성 중"
                  : "품질 개선 재생성 중"
                : currentSection.generatedImage
                  ? "이미지 다시 만들기"
                  : "이미지 생성하기"}
            </button>

            <p className={styles.inspectorHelper}>
              {usesReferenceModel
                ? "업로드한 모델 이미지를 참조하면서 현재 섹션 컷만 다시 생성합니다."
                : "섹션 헤드라인과 지금 선택한 모델 조건을 반영해 현재 컷만 다시 생성합니다."}
            </p>
          </div>
        );
      case "layer":
        return selectedTextLayer ? (
            <div className={styles.workbenchSectionStack}>
              <div className={styles.toolbarRow}>
                <button className={styles.inlineDangerButton} onClick={() => deleteOverlay(selectedTextLayer.id)} type="button">
                  <Trash2 size={14} />
                  삭제
                </button>
              </div>

            <label className={styles.floatingField}>
              <div className={styles.fieldHeaderInline}>
                <span className={styles.optionMiniLabel}>텍스트 내용</span>
                <div className={styles.languageControlRow}>
                  <select
                    className={styles.miniSelect}
                    onChange={(event) => handleOverlayLanguageChange(selectedTextLayer, event.target.value as PdpCopyLanguage)}
                    value={selectedTextLayer.language}
                  >
                    <option value="ko">한국어</option>
                    <option value="en">영어</option>
                  </select>
                </div>
              </div>
              <textarea
                className={styles.floatingTextarea}
                onChange={(event) => updateTextOverlayContent(selectedTextLayer.id, event.target.value)}
                rows={3}
                value={selectedTextLayer.text}
              />
            </label>

            <div className={styles.floatingCompactGrid}>
              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>폰트</span>
                <select
                  className={styles.select}
                  onChange={(event) => updateOverlay(selectedTextLayer.id, { fontFamily: event.target.value })}
                  value={selectedTextLayer.fontFamily}
                >
                  {FONT_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>굵기</span>
                <select
                  className={styles.select}
                  onChange={(event) => updateOverlay(selectedTextLayer.id, { fontWeight: event.target.value })}
                  value={selectedTextLayer.fontWeight}
                >
                  {FONT_WEIGHT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className={styles.floatingCompactGrid}>
              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>폭</span>
                <input
                  className={styles.input}
                  min={80}
                  onChange={(event) =>
                    updateOverlay(selectedTextLayer.id, {
                      width: clampValue(Number(event.target.value) || 320, 80, 1200)
                    })
                  }
                  type="number"
                  value={toNumericSize(selectedTextLayer.width, 320)}
                />
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>크기</span>
                <div className={styles.rangeField}>
                  <input
                    className={styles.rangeInput}
                    max={180}
                    min={10}
                    onChange={(event) => updateOverlay(selectedTextLayer.id, { fontSize: Number(event.target.value) || 16 })}
                    type="range"
                    value={selectedTextLayer.fontSize}
                  />
                  <input
                    className={styles.input}
                    min={10}
                    onChange={(event) => updateOverlay(selectedTextLayer.id, { fontSize: Number(event.target.value) || 16 })}
                    type="number"
                    value={selectedTextLayer.fontSize}
                  />
                </div>
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>줄 간격</span>
                <div className={styles.rangeField}>
                  <input
                    className={styles.rangeInput}
                    max={3}
                    min={0.8}
                    onChange={(event) => updateOverlay(selectedTextLayer.id, { lineHeight: Number(event.target.value) || 1.2 })}
                    step={0.1}
                    type="range"
                    value={selectedTextLayer.lineHeight}
                  />
                  <input
                    className={styles.input}
                    max={3}
                    min={0.8}
                    onChange={(event) => updateOverlay(selectedTextLayer.id, { lineHeight: Number(event.target.value) || 1.2 })}
                    step={0.1}
                    type="number"
                    value={selectedTextLayer.lineHeight}
                  />
                </div>
              </label>
            </div>

            <div className={styles.optionSurface}>
              <div className={styles.optionSectionHeader}>
                <div>
                  <span className={styles.optionSectionEyebrow}>Color palette</span>
                  <strong>글자색</strong>
                </div>
                <Palette size={16} />
              </div>
              {renderColorPaletteField({
                label: "글자색",
                layerId: selectedTextLayer.id,
                role: "text",
                currentColor: selectedTextLayer.color,
                recommendedColors: textColorRecommendations,
                onSelect: (color) => updateOverlay(selectedTextLayer.id, { color })
              })}
            </div>

            <div className={styles.optionSurface}>
              <div className={styles.optionSectionHeader}>
                <div>
                  <span className={styles.optionSectionEyebrow}>Shadow</span>
                  <strong>가독성 그림자</strong>
                </div>
                <Sparkles size={16} />
              </div>
              <label className={styles.toggleCard}>
                <div className={styles.toggleCardCopy}>
                  <strong>그림자 사용</strong>
                  <span>밝은 이미지 위에서도 텍스트가 묻히지 않도록 깊이를 더합니다.</span>
                </div>
                <input
                  checked={selectedTextLayer.shadowEnabled}
                  onChange={(event) => updateOverlay(selectedTextLayer.id, { shadowEnabled: event.target.checked })}
                  type="checkbox"
                />
              </label>

              {selectedTextLayer.shadowEnabled ? (
                <>
                  {renderColorPaletteField({
                    label: "그림자색",
                    layerId: selectedTextLayer.id,
                    role: "shadow",
                    currentColor: selectedTextLayer.shadowColor,
                    recommendedColors: [colorRecommendations.darkColor, "#000000", colorRecommendations.accentColor],
                    onSelect: (color) => updateOverlay(selectedTextLayer.id, { shadowColor: color })
                  })}
                  <div className={styles.floatingCompactGrid}>
                    <label className={styles.floatingField}>
                      <span className={styles.optionMiniLabel}>강도</span>
                      <div className={styles.rangeField}>
                        <input className={styles.rangeInput} max={1} min={0} step={0.05} type="range" value={selectedTextLayer.shadowOpacity} onChange={(event) => updateOverlay(selectedTextLayer.id, { shadowOpacity: Number(event.target.value) || 0 })} />
                        <input className={styles.input} max={1} min={0} step={0.05} type="number" value={selectedTextLayer.shadowOpacity} onChange={(event) => updateOverlay(selectedTextLayer.id, { shadowOpacity: Number(event.target.value) || 0 })} />
                      </div>
                    </label>
                    <label className={styles.floatingField}>
                      <span className={styles.optionMiniLabel}>흐림</span>
                      <div className={styles.rangeField}>
                        <input className={styles.rangeInput} max={40} min={0} step={1} type="range" value={selectedTextLayer.shadowBlur} onChange={(event) => updateOverlay(selectedTextLayer.id, { shadowBlur: Number(event.target.value) || 0 })} />
                        <input className={styles.input} max={40} min={0} step={1} type="number" value={selectedTextLayer.shadowBlur} onChange={(event) => updateOverlay(selectedTextLayer.id, { shadowBlur: Number(event.target.value) || 0 })} />
                      </div>
                    </label>
                    <label className={styles.floatingField}>
                      <span className={styles.optionMiniLabel}>거리</span>
                      <div className={styles.rangeField}>
                        <input className={styles.rangeInput} max={24} min={-24} step={1} type="range" value={selectedTextLayer.shadowOffsetY} onChange={(event) => updateOverlay(selectedTextLayer.id, { shadowOffsetY: Number(event.target.value) || 0 })} />
                        <input className={styles.input} max={24} min={-24} step={1} type="number" value={selectedTextLayer.shadowOffsetY} onChange={(event) => updateOverlay(selectedTextLayer.id, { shadowOffsetY: Number(event.target.value) || 0 })} />
                      </div>
                    </label>
                  </div>
                </>
              ) : null}
            </div>

            <div className={styles.floatingField}>
              <span className={styles.optionMiniLabel}>정렬</span>
              <div className={styles.alignButtonGroup}>
                {ALIGN_OPTIONS.map(({ value, label, Icon }) => (
                  <button
                    className={selectedTextLayer.textAlign === value ? styles.alignButtonActive : styles.alignButton}
                    key={value}
                    onClick={() => handleTextAlignChange(selectedTextLayer, value)}
                    type="button"
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : selectedShapeLayer ? (
          <div className={styles.workbenchSectionStack}>
            <div className={styles.toolbarRow}>
              <p className={styles.floatingHint}>사각형은 이미지 위, 텍스트 아래에 깔리는 독립 배경 오브젝트입니다.</p>
              <button className={styles.inlineDangerButton} onClick={() => deleteOverlay(selectedShapeLayer.id)} type="button">
                <Trash2 size={14} />
                삭제
              </button>
            </div>

            <div className={styles.optionSurface}>
              <div className={styles.optionSectionHeader}>
                <div>
                  <span className={styles.optionSectionEyebrow}>Shape fill</span>
                  <strong>배경 사각형 색상</strong>
                </div>
                <Palette size={16} />
              </div>
              {renderColorPaletteField({
                label: "채우기 색상",
                layerId: selectedShapeLayer.id,
                role: "shape",
                currentColor: selectedShapeLayer.fillColor,
                recommendedColors: shapeColorRecommendations,
                onSelect: (color) => updateOverlay(selectedShapeLayer.id, { fillColor: color })
              })}
            </div>

            <div className={styles.floatingCompactGrid}>
              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>투명도</span>
                <div className={styles.rangeField}>
                  <input className={styles.rangeInput} max={1} min={0} step={0.05} type="range" value={selectedShapeLayer.fillOpacity} onChange={(event) => updateOverlay(selectedShapeLayer.id, { fillOpacity: Number(event.target.value) || 0 })} />
                  <input className={styles.input} max={1} min={0} step={0.05} type="number" value={selectedShapeLayer.fillOpacity} onChange={(event) => updateOverlay(selectedShapeLayer.id, { fillOpacity: Number(event.target.value) || 0 })} />
                </div>
              </label>
              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>모서리</span>
                <div className={styles.rangeField}>
                  <input className={styles.rangeInput} max={48} min={0} step={1} type="range" value={selectedShapeLayer.borderRadius} onChange={(event) => updateOverlay(selectedShapeLayer.id, { borderRadius: Number(event.target.value) || 0 })} />
                  <input className={styles.input} max={48} min={0} step={1} type="number" value={selectedShapeLayer.borderRadius} onChange={(event) => updateOverlay(selectedShapeLayer.id, { borderRadius: Number(event.target.value) || 0 })} />
                </div>
              </label>
            </div>
          </div>
        ) : (
          <div className={styles.inspectorEmpty}>
            <Type size={18} />
            <div>
              <strong>텍스트나 사각형을 선택해 주세요</strong>
              <p>캔버스의 텍스트나 배경 사각형을 클릭하면 이 패널에서 바로 편집할 수 있습니다.</p>
              <div className={styles.inspectorEmptyActions}>
                <button className={styles.copyUtilityButton} onClick={handleAddShapeLayer} type="button">
                  <Square size={15} />
                  배경 사각형 추가
                </button>
              </div>
            </div>
          </div>
        );
      case "copy": {
        const headlineCopy = getUsableCopyPair(currentSection.headline, currentSection.headline_en);
        const subheadlineCopy = getUsableCopyPair(currentSection.subheadline, currentSection.subheadline_en);
        const bulletCopies = getUsableBulletCopies(currentSection);
        const trustCopy = getUsableCopyPair(
          currentSection.trust_or_objection_line,
          currentSection.trust_or_objection_line_en
        );
        const ctaCopy = getUsableCopyPair(currentSection.CTA, currentSection.CTA_en);
        const hasUsableCopy = Boolean(headlineCopy || subheadlineCopy || bulletCopies.length || trustCopy || ctaCopy);

        return (
          <div className={styles.copyLibrary}>
            <div className={styles.copySection}>
              <p className={styles.cardLabel}>Layout Object</p>
              <button className={styles.copyUtilityButton} onClick={handleAddShapeLayer} type="button">
                <Palette size={15} />
                배경 사각형 추가
              </button>
            </div>

            <div className={styles.copyNoticeBox}>
              최종 JPG에는 이 카피가 이미지처럼 합성됩니다. 수정하려면 텍스트 레이어를 편집하거나 배경 사각형으로 기존 문구를 덮고 새 문구를 올리세요.
            </div>

            {currentCopyWarnings.length ? (
              <div className={styles.copyMissingNotice}>
                {currentCopyWarnings.slice(0, 3).map((warning) => warning.message).join(" ")}
              </div>
            ) : null}

            {!hasUsableCopy ? (
              <div className={styles.copyMissingNotice}>{INSUFFICIENT_COPY_MESSAGE}</div>
            ) : null}

            {headlineCopy ? (
            <div className={styles.copySection}>
              <p className={styles.cardLabel}>Headline</p>
              <button
                className={styles.copyBlock}
                onClick={() => handleAddTextOverlay(headlineCopy, "headline")}
                type="button"
              >
                {headlineCopy[defaultCopyLanguage] || headlineCopy.ko}
              </button>
            </div>
            ) : null}

            {subheadlineCopy ? (
            <div className={styles.copySection}>
              <p className={styles.cardLabel}>Subheadline</p>
              <button
                className={styles.copyBlockSoft}
                onClick={() => handleAddTextOverlay(subheadlineCopy, "subheadline")}
                type="button"
              >
                {subheadlineCopy[defaultCopyLanguage] || subheadlineCopy.ko}
              </button>
            </div>
            ) : null}

            {bulletCopies.length ? (
              <div className={styles.copySection}>
                <p className={styles.cardLabel}>Key Points</p>
                <div className={styles.bulletStack}>
                  {bulletCopies.map((bullet, index) => (
                    <button
                      className={styles.bulletButton}
                      key={`${bullet.ko}-${index}`}
                      onClick={() => handleAddTextOverlay(bullet, "keypoint")}
                      type="button"
                    >
                      <CheckCircle2 size={14} />
                      {bullet[defaultCopyLanguage] || bullet.ko}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {trustCopy ? (
              <div className={styles.trustBox}>
                <p className={styles.cardLabel}>Trust / Objection</p>
                <p>{trustCopy[defaultCopyLanguage] || trustCopy.ko}</p>
              </div>
            ) : null}

            {ctaCopy ? (
              <button className={styles.ctaPreview} type="button">
                {ctaCopy[defaultCopyLanguage] || ctaCopy.ko}
              </button>
            ) : null}
          </div>
        );
      }
      case "guide":
      default:
        return (
          <div className={styles.workbenchSectionStack}>
            <div className={styles.guidelineGrid}>
              <div>
                <strong>Guide Mode</strong>
                <p>{currentOptions.guidePriorityMode === "guide-first" ? "디자인 가이드 우선" : "컷 타입 우선"}</p>
              </div>
              <div>
                <strong>Image Purpose</strong>
                <p>{currentSection.purpose}</p>
              </div>
              <div>
                <strong>Story Role</strong>
                <p>{currentSection.story_role || getSectionStoryRole(currentSection)}</p>
              </div>
              <div>
                <strong>Prompt Source</strong>
                <p>{currentOptions.guidePriorityMode === "guide-first" ? "섹션 가이드 반영" : "컷 타입 우선"}</p>
              </div>
            </div>

            <div className={styles.optionSurface}>
              <div className={styles.optionSectionHeader}>
                <div>
                  <span className={styles.optionSectionEyebrow}>Story</span>
                  <strong>스토리와 카피</strong>
                </div>
              </div>

              <div className={styles.floatingCompactGrid}>
                <label className={styles.floatingField}>
                  <span className={styles.optionMiniLabel}>섹션명</span>
                  <input
                    className={styles.input}
                    onChange={(event) => updateCurrentSection({ section_name: event.target.value })}
                    value={currentSection.section_name}
                  />
                </label>
                <label className={styles.floatingField}>
                  <span className={styles.optionMiniLabel}>스토리 역할</span>
                  <select
                    className={styles.select}
                    onChange={(event) => updateCurrentSection({ story_role: event.target.value })}
                    value={currentSection.story_role || getSectionStoryRole(currentSection)}
                  >
                    <option value="hook">hook</option>
                    <option value="problem">problem</option>
                    <option value="benefit">benefit</option>
                    <option value="reason">reason</option>
                    <option value="proof">proof</option>
                    <option value="demo">demo</option>
                    <option value="usecase">usecase</option>
                    <option value="cta">cta</option>
                  </select>
                </label>
              </div>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>섹션 목표</span>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSection({ goal: event.target.value })}
                  rows={2}
                  value={currentSection.goal}
                />
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>이미지 목적</span>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSection({ purpose: event.target.value })}
                  rows={2}
                  value={currentSection.purpose}
                />
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>헤드라인</span>
                <input
                  className={styles.input}
                  onChange={(event) => updateCurrentSection({ headline: event.target.value })}
                  value={currentSection.headline}
                />
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>서브카피</span>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSection({ subheadline: event.target.value })}
                  rows={2}
                  value={currentSection.subheadline}
                />
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>불릿</span>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSectionList("bullets", event.target.value)}
                  rows={3}
                  value={currentSection.bullets.join("\n")}
                />
              </label>

              <div className={styles.floatingCompactGrid}>
                <label className={styles.floatingField}>
                  <span className={styles.optionMiniLabel}>신뢰/반박</span>
                  <textarea
                    className={styles.floatingTextarea}
                    onChange={(event) => updateCurrentSection({ trust_or_objection_line: event.target.value })}
                    rows={2}
                    value={currentSection.trust_or_objection_line}
                  />
                </label>
                <label className={styles.floatingField}>
                  <span className={styles.optionMiniLabel}>CTA</span>
                  <input
                    className={styles.input}
                    onChange={(event) => updateCurrentSection({ CTA: event.target.value })}
                    value={currentSection.CTA}
                  />
                </label>
              </div>
            </div>

            <div className={styles.optionSurface}>
              <div className={styles.optionSectionHeader}>
                <div>
                  <span className={styles.optionSectionEyebrow}>Image Prompt</span>
                  <strong>생성 프롬프트</strong>
                </div>
              </div>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>한국어 프롬프트</span>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSection({ prompt_ko: event.target.value })}
                  rows={5}
                  value={currentSection.prompt_ko}
                />
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>영어 프롬프트</span>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSection({ prompt_en: event.target.value })}
                  rows={5}
                  value={currentSection.prompt_en}
                />
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>네거티브 프롬프트</span>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSection({ negative_prompt: event.target.value })}
                  rows={3}
                  value={currentSection.negative_prompt}
                />
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>레이아웃 노트</span>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSection({ layout_notes: event.target.value })}
                  rows={3}
                  value={currentSection.layout_notes}
                />
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>스타일 가이드</span>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSection({ style_guide: event.target.value })}
                  rows={3}
                  value={currentSection.style_guide}
                />
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>참조 이미지 사용</span>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSection({ reference_usage: event.target.value })}
                  rows={2}
                  value={currentSection.reference_usage}
                />
              </label>

              <label className={styles.floatingField}>
                <span className={styles.optionMiniLabel}>합성 텍스트 배치 힌트</span>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSection({ overlay_layout_hint: event.target.value })}
                  rows={2}
                  value={currentSection.overlay_layout_hint ?? ""}
                />
              </label>

              <div className={styles.optionGroup}>
                <div className={styles.inlineActionRow}>
                  <button
                    className={styles.secondaryButton}
                    disabled={isLoadingImagePromptPreview}
                    onClick={handleLoadFinalImagePromptPreview}
                    type="button"
                  >
                    {isLoadingImagePromptPreview ? <Loader2 className={styles.spinIcon} size={14} /> : <RefreshCw size={14} />}
                    서버 기준 불러오기
                  </button>
                  <button
                    className={styles.secondaryButton}
                    disabled={!isUsingFinalImagePromptOverride || isLoadingImagePromptPreview}
                    onClick={handleClearFinalImagePromptOverride}
                    type="button"
                  >
                    자동 조합으로 되돌리기
                  </button>
                  <span className={styles.optionMiniLabel}>
                    {isUsingFinalImagePromptOverride ? "수동 최종 프롬프트 사용" : "자동 조합 사용"}
                  </span>
                </div>
                <label className={styles.floatingField}>
                  <span className={styles.optionMiniLabel}>최종 모델 프롬프트</span>
                  <textarea
                    className={styles.floatingTextarea}
                    onChange={(event) => updateCurrentSection({ image_prompt_override: event.target.value })}
                    placeholder="서버 기준 불러오기를 누르면 실제 이미지 모델에 전달될 전체 프롬프트가 들어옵니다."
                    rows={12}
                    value={finalImagePromptValue}
                  />
                </label>
                <p className={styles.helperCopy}>
                  값을 수정하면 다음 섹션 이미지 생성은 이 최종 프롬프트를 그대로 사용합니다. 자동 조합으로 되돌리면 위 스토리/이미지
                  프롬프트 필드가 다시 서버에서 조합됩니다.
                </p>
              </div>
            </div>

            {currentSection.compliance_notes ? (
              <div className={styles.warningBox}>
                <strong>Compliance Notes</strong>
                <textarea
                  className={styles.floatingTextarea}
                  onChange={(event) => updateCurrentSection({ compliance_notes: event.target.value })}
                  rows={3}
                  value={currentSection.compliance_notes}
                />
              </div>
            ) : null}

            <label className={styles.floatingField}>
              <span className={styles.optionMiniLabel}>품질 메모</span>
              <textarea
                className={styles.floatingTextarea}
                onChange={(event) => updateCurrentSection({ quality_notes: event.target.value })}
                rows={2}
                value={currentSection.quality_notes ?? ""}
              />
            </label>

            {currentSection.imageQualityReport ? (
              <div className={styles.imageQualityBox}>
                <div className={styles.scoreRow}>
                  <strong>Image Quality Gate</strong>
                  <span className={getQualityBadgeClass(currentSection.imageQualityReport.status)}>
                    {currentSection.imageQualityReport.score}점
                  </span>
                </div>
                <p>{currentSection.imageQualityReport.summary}</p>
                {currentSection.imageQualityReport.autoRegenerated ? (
                  <div className={styles.qualityChipRow}>
                    <span>자동 재생성 {Math.max(1, (currentSection.imageQualityReport.attemptCount ?? 2) - 1)}회 적용</span>
                    {currentSection.imageQualityReport.rejectedAttempts?.[0] ? (
                      <span>이전 시도 {currentSection.imageQualityReport.rejectedAttempts[0].score}점</span>
                    ) : null}
                  </div>
                ) : null}
                {currentSection.imageQualityReport.nextActions.length ? (
                  <div className={styles.qualityIssueList}>
                    {currentSection.imageQualityReport.nextActions.slice(0, 3).map((action) => (
                      <span key={action}>{action}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
    }
  };

  const selectedModelSummary = currentOptions.withModel
    ? usesReferenceModel
      ? referenceModelUsage === "all-sections"
        ? "업로드 모델 일관성 유지"
        : "히어로우 업로드 모델 사용"
      : `${getModelCountryLabel(currentOptions.modelCountry)} ${getModelAgeLabel(currentOptions.modelAgeRange)} ${getModelGenderLabel(currentOptions.modelGender)}`
    : "모델 없이 화면/제품 중심";

  const buildSectionImageRequest = (sectionIndex: number, section: SectionBlueprint): PdpGenerateImageRequest => {
    const targetReferenceModelApplies = referenceModelAppliesToSection(sectionIndex);
    const targetOptions = normalizeImageOptions(sectionOptions[sectionIndex], targetReferenceModelApplies);
    const targetUsesReferenceModel = Boolean(targetOptions.withModel && targetReferenceModelApplies);

    return {
      originalImageBase64: initialResult.originalImage,
      referenceImages: initialResult.referenceImages,
      productDescription: initialResult.productDescription,
      productBrief: initialResult.productBrief,
      sectionCopy: {
        headline: section.headline,
        subheadline: section.subheadline,
        bullets: section.bullets,
        trustLine: section.trust_or_objection_line,
        cta: section.CTA
      },
      layoutTemplate: section.layout_template,
      section,
      aspectRatio,
      desiredTone: desiredTone || undefined,
      layerPlan: buildLayerPlanContextForSection(layeredDocumentV2, section, sectionIndex),
      options: {
        ...targetOptions,
        headline: section.headline,
        subheadline: section.subheadline,
        isRegeneration: Boolean(section.generatedImage),
        referenceModelImageBase64: targetUsesReferenceModel ? referenceModelImage?.base64 : undefined,
        referenceModelImageMimeType: targetUsesReferenceModel ? referenceModelImage?.mimeType : undefined,
        referenceModelImageFileName: targetUsesReferenceModel ? referenceModelImage?.fileName : undefined
      }
    };
  };

  const evaluateFinalCompositeQuality = async (input: {
    imageSrc: string;
    layers: CanvasLayer[];
    section: SectionBlueprint;
    backgroundQualityReport?: SectionImageQualityReport;
  }): Promise<SectionImageQualityReport> => {
    const blob = await captureCompositeBlob(input.imageSrc, input.layers);
    const payload = await blobToBase64Payload(blob);
    const response = await apiJson<PdpFinalQualityResponse>("/pdp/final-quality", {
      method: "POST",
      body: JSON.stringify({
        imageBase64: payload.base64,
        mimeType: payload.mimeType,
        section: input.section,
        aspectRatio,
        productDescription: initialResult.productDescription,
        productBrief: initialResult.productBrief,
        desiredTone: desiredTone || undefined,
        backgroundQualityReport: input.backgroundQualityReport
      })
    });

    if (!response.ok) {
      throw new Error(response.message);
    }

    return response.imageQualityReport;
  };

  const generateSectionImageForIndex = async (sectionIndex: number) => {
    const targetSection = sections[sectionIndex];
    if (!targetSection) {
      throw new Error("생성할 섹션 정보를 찾지 못했습니다.");
    }

    const existingLayers = overlaysBySection[sectionIndex] ?? [];
    const hadExistingTextLayers = existingLayers.some(isTextLayer);
    const imageRequest = buildSectionImageRequest(sectionIndex, targetSection);

    const response = await apiJson<PdpGenerateImageResponse>("/pdp/images", {
      method: "POST",
      body: JSON.stringify(imageRequest)
    });

    if (!response.ok) {
      throw new Error(response.message);
    }

    const generatedImage = toDataUrl(response.mimeType, response.imageBase64);
    const generatedCopyOverlays = buildLayeredDocumentCopyOverlays({
      document: layeredDocumentV2,
      sections,
      sectionIndex,
      aspectRatio
    });
    let nextLayers = buildGeneratedSectionLayers(existingLayers, generatedCopyOverlays);
    let finalQualityReport = response.imageQualityReport ?? buildFinalQualityFallbackReport(targetSection, null);

    try {
      finalQualityReport = await evaluateFinalCompositeQuality({
        imageSrc: generatedImage,
        layers: nextLayers,
        section: targetSection,
        backgroundQualityReport: response.imageQualityReport
      });
    } catch (error) {
      finalQualityReport = buildFinalQualityFallbackReport(targetSection, error, response.imageQualityReport);
    }

    setSections((current) =>
      current.map((section, index) =>
        index === sectionIndex
          ? {
              ...section,
              generatedImage,
              imageQualityReport: finalQualityReport,
              providerProof: response.providerProof
            }
          : section
      )
    );
    setOverlaysBySection((current) => {
      if (!generatedCopyOverlays.length) return current;
      return {
        ...current,
        [sectionIndex]: nextLayers
      };
    });

    return {
      section: targetSection,
      imageQuality: finalQualityReport,
      hadExistingTextLayers,
      generatedCopyOverlays
    };
  };

  const handleGenerateImage = async () => {
    setIsGeneratingImage(true);
    setErrorMessage("");

    try {
      const result = await generateSectionImageForIndex(safeCurrentSectionIndex);
      setNotice(buildGeneratedImageNotice(result));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "이미지를 다시 만들지 못했습니다.");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleBatchGenerateMissing = async () => {
    const targetIndices = sections
      .map((section, index) => ({ section, index }))
      .filter(({ section }) => !section.generatedImage)
      .map(({ index }) => index);

    await runBatchGeneration("missing", targetIndices);
  };

  const handleBatchRegenerateQuality = async () => {
    const targetIndices = sections
      .map((section, index) => ({ section, index }))
      .filter(({ section }) => section.generatedImage && getSectionQualityStatus(section) !== "ready")
      .map(({ index }) => index);

    await runBatchGeneration("quality", targetIndices);
  };

  const runBatchGeneration = async (mode: "missing" | "quality", targetIndices: number[]) => {
    if (!targetIndices.length) {
      setNotice(mode === "missing" ? "생성할 남은 섹션이 없습니다." : "재생성할 검수/차단 섹션이 없습니다.");
      return;
    }

    setBatchGenerationMode(mode);
    setIsGeneratingImage(true);
    setErrorMessage("");

    let completedCount = 0;
    let blockedCount = 0;
    let reviewCount = 0;

    try {
      for (const sectionIndex of targetIndices) {
        const targetSection = sections[sectionIndex];
        if (!targetSection) continue;

        setCurrentSectionIndex(sectionIndex);
        setNotice(
          mode === "missing"
            ? `${getDisplaySectionName(targetSection)} 생성 중입니다. (${completedCount + 1}/${targetIndices.length})`
            : `${getDisplaySectionName(targetSection)} 품질 개선 재생성 중입니다. (${completedCount + 1}/${targetIndices.length})`
        );

        const result = await generateSectionImageForIndex(sectionIndex);
        completedCount += 1;
        if (result.imageQuality?.status === "blocked") blockedCount += 1;
        if (result.imageQuality?.status === "needs_review") reviewCount += 1;
      }

      const qualitySummary = blockedCount
        ? ` 단, ${blockedCount}개 섹션은 여전히 납품 차단 상태입니다.`
        : reviewCount
          ? ` ${reviewCount}개 섹션은 고객 제공 전 수동 검수가 필요합니다.`
          : " 모든 대상 섹션이 납품 가능 기준을 통과했습니다.";
      setNotice(`${completedCount}개 섹션 처리를 완료했습니다.${qualitySummary}`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? `${completedCount}개 섹션 처리 후 중단되었습니다. ${error.message}`
          : `${completedCount}개 섹션 처리 후 중단되었습니다.`
      );
    } finally {
      setBatchGenerationMode(null);
      setIsGeneratingImage(false);
    }
  };

  const handleAddTextOverlay = (
    translations: Record<PdpCopyLanguage, string>,
    type: "headline" | "subheadline" | "keypoint" | "default" = "default"
  ) => {
    if (!currentSection.generatedImage) {
      setErrorMessage("이미지를 먼저 생성해야 텍스트를 올릴 수 있습니다.");
      return;
    }

    const usableTranslations = getUsableCopyPair(translations.ko, translations.en);
    if (!usableTranslations) {
      setNotice(INSUFFICIENT_COPY_MESSAGE);
      return;
    }

    const newOverlay = createTextOverlay({
      translations: usableTranslations,
      type,
      language: defaultCopyLanguage,
      x: 52,
      y: type === "headline" ? 52 : type === "subheadline" ? 148 : 238,
      textColor: "#ffffff",
      backgroundColor: shapeColorRecommendations[0] ?? "#102532",
      shadowColor: colorRecommendations.darkColor
    });

    setOverlaysBySection((current) => ({
      ...current,
      [safeCurrentSectionIndex]: [...(current[safeCurrentSectionIndex] ?? []), normalizeTextOverlay(newOverlay)]
    }));
    setSelectedOverlayId(newOverlay.id);
    setWorkbenchState((current) => ({
      ...current,
      isOpen: true
    }));
    setNotice("텍스트를 추가했습니다. 위치와 크기를 직접 조절해 레이아웃을 완성해 보세요.");
  };

  const handleAddShapeLayer = () => {
    if (!currentSection.generatedImage) {
      setErrorMessage("이미지를 먼저 생성해야 배경 사각형을 배치할 수 있습니다.");
      return;
    }

    const newShape: ShapeLayer = normalizeShapeLayer({
      id: crypto.randomUUID(),
      kind: "shape",
      x: 64,
      y: 64,
      width: 260,
      height: 120,
      fillColor: shapeColorRecommendations[0] ?? colorRecommendations.darkColor,
      fillOpacity: 1,
      borderRadius: 0
    });

    setOverlaysBySection((current) => ({
      ...current,
      [safeCurrentSectionIndex]: [...(current[safeCurrentSectionIndex] ?? []), newShape]
    }));
    setSelectedOverlayId(newShape.id);
    setEditingOverlayId(null);
    setWorkbenchTab("layer");
    setWorkbenchState((current) => ({
      ...current,
      isOpen: true
    }));
    setNotice("배경 사각형을 추가했습니다. 기존 카피를 덮고 새 텍스트를 올리거나, 드래그와 리사이즈로 레이아웃을 보정할 수 있습니다.");
  };

  const updateOverlay = (overlayId: string, updates: Partial<CanvasLayer>) => {
    setOverlaysBySection((current) => ({
      ...current,
      [safeCurrentSectionIndex]: (current[safeCurrentSectionIndex] ?? []).map((overlay) =>
        overlay.id === overlayId ? normalizeCanvasLayer({ ...overlay, ...updates }) ?? overlay : overlay
      )
    }));
  };

  const deleteOverlay = (overlayId: string) => {
    setOverlaysBySection((current) => ({
      ...current,
      [safeCurrentSectionIndex]: (current[safeCurrentSectionIndex] ?? []).filter((overlay) => overlay.id !== overlayId)
    }));
    if (selectedOverlayId === overlayId) {
      setSelectedOverlayId(null);
      setEditingOverlayId(null);
    }
  };

  const handleResizeStart = (overlay: CanvasLayer) => {
    resizeSessionRef.current[overlay.id] = {
      width: toNumericSize(overlay.width, 320),
      height: toNumericSize(overlay.height, 92),
      fontSize: isTextLayer(overlay) ? overlay.fontSize : 0
    };
  };

  const handleResize = (
    overlay: CanvasLayer,
    direction: string,
    ref: HTMLElement,
    position: { x: number; y: number }
  ) => {
    const base = resizeSessionRef.current[overlay.id] ?? {
      width: toNumericSize(overlay.width, 320),
      height: toNumericSize(overlay.height, 92),
      fontSize: isTextLayer(overlay) ? overlay.fontSize : 0
    };

    const nextWidth = ref.offsetWidth;
    const nextHeight = ref.offsetHeight;
    const isHorizontalOnly = direction === "left" || direction === "right";
    const isVerticalOnly = direction === "top" || direction === "bottom";

    if (isHorizontalOnly) {
      updateOverlay(overlay.id, {
        width: nextWidth,
        x: position.x
      });
      return;
    }

    if (isVerticalOnly) {
      updateOverlay(overlay.id, {
        height: nextHeight,
        y: position.y
      });
      return;
    }

    if (isShapeLayer(overlay)) {
      updateOverlay(overlay.id, {
        width: nextWidth,
        height: nextHeight,
        x: position.x,
        y: position.y
      });
      return;
    }

    const scale = Math.max(nextWidth / Math.max(base.width, 1), nextHeight / Math.max(base.height, 1));
    const nextFontSize = clampValue(Math.round(base.fontSize * scale), 10, 180);

    updateOverlay(overlay.id, {
      width: nextWidth,
      height: nextHeight,
      x: position.x,
      y: position.y,
      fontSize: nextFontSize
    });
  };

  const handleResizeStop = (overlayId: string) => {
    delete resizeSessionRef.current[overlayId];
  };

  const handleOverlayDrag = (overlay: CanvasLayer, x: number, y: number) => {
    updateOverlay(overlay.id, {
      x,
      y
    });
  };

  const handleDownloadDeliveryReport = () => {
    try {
      const report = buildDeliveryReport({
        initialResult,
        sections,
        overlaysBySection,
        aspectRatio,
        desiredTone
      });
      const blob = new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json;charset=utf-8"
      });

      downloadBlob(blob, `pdp-delivery-report-${new Date().toISOString().slice(0, 10)}.json`);
      setNotice("납품 품질 리포트를 다운로드했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "납품 리포트를 만들지 못했습니다.");
    }
  };

  const handleDownloadFigmaPayload = () => {
    try {
      const blob = new Blob([JSON.stringify(figmaPayload, null, 2)], {
        type: "application/json;charset=utf-8"
      });
      downloadBlob(blob, `pdp-figma-payload-${new Date().toISOString().slice(0, 10)}.json`);
      setNotice("Figma plugin-ready 계층 payload를 다운로드했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Figma payload를 만들지 못했습니다.");
    }
  };

  const captureSectionBlob = async (sectionIndex: number) => {
    const section = sections[sectionIndex];
    if (!section?.generatedImage) {
      throw new Error("이미지가 없는 섹션은 다운로드할 수 없습니다.");
    }

    const width = OVERLAY_CANVAS_WIDTH;
    const layers = overlaysBySection[sectionIndex] ?? [];
    return captureCompositeBlob(section.generatedImage, layers, width);
  };

  const handleDownload = async () => {
    if (!currentSection.generatedImage) {
      return;
    }
    if (isSectionDeliveryBlocked(currentSection)) {
      setErrorMessage(`${getDisplaySectionName(currentSection)}은 품질 게이트에서 차단되어 납품 파일로 다운로드할 수 없습니다. 이미지를 다시 생성하거나 자료를 보강하세요.`);
      return;
    }

    try {
      setSelectedOverlayId(null);
      setEditingOverlayId(null);
      setActiveColorPalette(null);
      const blob = await captureSectionBlob(safeCurrentSectionIndex);
      downloadBlob(blob, `pdp-${sanitizeSectionFileName(currentSection.section_id)}.jpg`);
      setNotice(`${getDisplaySectionName(currentSection)} 컷을 다운로드했습니다.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "이미지를 다운로드하지 못했습니다.");
    }
  };

  const handleDownloadAll = async () => {
    const downloadableSections = sections
      .map((section, index) => ({ section, index }))
      .filter((entry) => Boolean(entry.section.generatedImage));

    if (!downloadableSections.length) {
      setErrorMessage("다운로드할 이미지가 아직 없습니다.");
      return;
    }
    const blockedSections = downloadableSections.filter((entry) => isSectionDeliveryBlocked(entry.section));
    if (blockedSections.length) {
      setErrorMessage(buildBlockedDownloadMessage(blockedSections.map((entry) => entry.section)));
      return;
    }

    try {
      setIsDownloadingAll(true);
      setSelectedOverlayId(null);
      setEditingOverlayId(null);
      setActiveColorPalette(null);

      const zip = new JSZip();
      const deliveryReport = buildDeliveryReport({
        initialResult,
        sections,
        overlaysBySection,
        aspectRatio,
        desiredTone
      });

      for (const { section, index } of downloadableSections) {
        const blob = await captureSectionBlob(index);
        zip.file(`pdp-${String(index + 1).padStart(2, "0")}-${sanitizeSectionFileName(section.section_id)}.jpg`, blob);
      }

      zip.file("delivery-report.json", JSON.stringify(deliveryReport, null, 2));
      zip.file("delivery-summary.txt", buildDeliverySummaryText(deliveryReport));
      zip.file("figma-payload.json", JSON.stringify(figmaPayload, null, 2));
      zip.file("figma-payload-summary.json", JSON.stringify({ importHints: figmaPayload.importHints, summary: figmaPayload.summary, validation: figmaPayload.validation }, null, 2));
      zip.file("layered-document-v2.json", JSON.stringify(layeredDocumentV2, null, 2));
      zip.file("layer-export-manifest.json", JSON.stringify(layerExportManifest, null, 2));

      const archive = await zip.generateAsync({ type: "blob" });
      downloadBlob(archive, `pdp-sections-${new Date().toISOString().slice(0, 10)}.zip`);
      setNotice(`${downloadableSections.length}개 섹션 이미지와 납품 리포트를 ZIP으로 다운로드했습니다.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "전체 이미지를 ZIP으로 다운로드하지 못했습니다.");
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const handleDownloadLongPage = async () => {
    const downloadableSections = sections
      .map((section, index) => ({ section, index }))
      .filter((entry) => Boolean(entry.section.generatedImage));

    if (!downloadableSections.length) {
      setErrorMessage("이어 붙일 이미지가 아직 없습니다.");
      return;
    }
    const blockedSections = downloadableSections.filter((entry) => isSectionDeliveryBlocked(entry.section));
    if (blockedSections.length) {
      setErrorMessage(buildBlockedDownloadMessage(blockedSections.map((entry) => entry.section)));
      return;
    }

    const urls: string[] = [];

    try {
      setIsDownloadingLongPage(true);
      setSelectedOverlayId(null);
      setEditingOverlayId(null);
      setActiveColorPalette(null);

      const images: HTMLImageElement[] = [];

      for (const { index } of downloadableSections) {
        const blob = await captureSectionBlob(index);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        images.push(await loadImageElement(url));
      }

      const width = Math.max(...images.map((image) => image.naturalWidth || image.width));
      const heights = images.map((image) => Math.round(((image.naturalHeight || image.height) * width) / Math.max(image.naturalWidth || image.width, 1)));
      const height = heights.reduce((total, value) => total + value, 0);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("긴 상세페이지 캔버스를 만들지 못했습니다.");

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);

      let y = 0;
      images.forEach((image, index) => {
        context.drawImage(image, 0, y, width, heights[index]);
        y += heights[index];
      });

      const output = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.92);
      });

      if (!output) throw new Error("긴 상세페이지 이미지를 만들지 못했습니다.");

      downloadBlob(output, `pdp-long-detail-page-${new Date().toISOString().slice(0, 10)}.jpg`);
      setNotice(`${downloadableSections.length}개 섹션을 하나의 긴 상세페이지 JPG로 다운로드했습니다.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "긴 상세페이지 이미지를 다운로드하지 못했습니다.");
    } finally {
      urls.forEach((url) => URL.revokeObjectURL(url));
      setIsDownloadingLongPage(false);
    }
  };

  return (
    <main className={styles.page} data-theme={theme}>
      <section className={styles.editorShell} onClick={clearLayerSelection}>
        <header className={styles.editorHeader} onClick={stopShellClick}>
          <div>
            <h1 className={styles.editorHeading}>
              <button className={styles.brandHomeButton} onClick={onReset} type="button">
                Codex PDP Maker
              </button>
            </h1>
            <p className={styles.editorSubcopy}>섹션 컷을 고르고 텍스트를 배치한 뒤 바로 완성본을 저장하세요.</p>
          </div>

          <div className={styles.editorHeaderMeta}>
            <span className={styles.metaPill}>비율 {aspectRatio}</span>
            <span className={styles.metaPill}>톤 {toneLabel}</span>
            <span className={styles.metaPill}>API {apiConnectionLabel}</span>
            {initialResult.productBrief ? <span className={styles.metaPill}>브리프 {initialResult.productBrief.confidence}</span> : null}
            {analysisFallbackUsed ? <span className={styles.deliveryReviewPill}>기본 구조</span> : null}
            <span className={styles.metaPill}>생성됨 {generatedCount}/{sections.length}</span>
            <span className={blockedGeneratedSections.length ? styles.deliveryBlockedPill : reviewGeneratedSections.length ? styles.deliveryReviewPill : styles.deliveryReadyPill}>
              {deliveryGateLabel}
            </span>
            {lastSavedAt ? <span className={styles.metaPill}>최근 저장 {formatSavedAt(lastSavedAt)}</span> : null}
            {saveState === "saving" ? <span className={styles.metaPill}>저장 중</span> : null}
            {saveState === "error" ? <span className={styles.warningPill}>초안 저장 실패</span> : null}
          </div>

          <div className={styles.topbarActions}>
            <button
              aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
              className={`${styles.secondaryButton} ${styles.headerActionButton} ${styles.themeToggleButton}`}
              onClick={onToggleTheme}
              type="button"
            >
              {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
              {theme === "dark" ? "다크" : "라이트"}
            </button>
            {onOpenSettings ? (
              <button className={`${styles.secondaryButton} ${styles.headerActionButton}`} onClick={onOpenSettings} type="button">
                <Settings2 size={16} />
                설정
              </button>
            ) : null}
            {onManualSave ? (
              <button className={`${styles.secondaryButton} ${styles.headerActionButton} ${styles.headerSaveButton}`} disabled={saveState === "saving"} onClick={onManualSave} type="button">
                {saveState === "saving" ? <Loader2 className={styles.spinIcon} size={16} /> : <Save size={16} />}
                작업 저장하기
              </button>
            ) : null}
            <button
              className={`${styles.secondaryButton} ${styles.headerActionButton}`}
              disabled={!missingGeneratedSections.length || isGenerationBusy}
              onClick={handleBatchGenerateMissing}
              type="button"
            >
              {batchGenerationMode === "missing" ? <Loader2 className={styles.spinIcon} size={16} /> : <ImageIcon size={16} />}
              남은 섹션 생성
            </button>
            <button
              className={`${styles.secondaryButton} ${styles.headerActionButton}`}
              disabled={!qualityRetrySections.length || isGenerationBusy}
              onClick={handleBatchRegenerateQuality}
              type="button"
            >
              {batchGenerationMode === "quality" ? <Loader2 className={styles.spinIcon} size={16} /> : <RefreshCw size={16} />}
              검수 섹션 재생성
            </button>
            <button className={`${styles.secondaryButton} ${styles.headerActionButton}`} disabled={isGenerationBusy} onClick={handleDownloadDeliveryReport} type="button">
              <FileText size={16} />
              납품 리포트
            </button>
            <button className={`${styles.secondaryButton} ${styles.headerActionButton}`} disabled={isGenerationBusy} onClick={handleDownloadFigmaPayload} type="button">
              <FileText size={16} />
              Figma payload
            </button>
            <button
              className={`${styles.secondaryButton} ${styles.headerActionButton} ${styles.zipDownloadButton}`}
              disabled={!generatedCount || isDownloadingAll || isGenerationBusy}
              onClick={handleDownloadAll}
              type="button"
            >
              {isDownloadingAll ? <Loader2 className={styles.spinIcon} size={16} /> : <Download size={16} />}
              전체 이미지 ZIP
            </button>
            <button
              className={`${styles.secondaryButton} ${styles.headerActionButton}`}
              disabled={!generatedCount || isDownloadingLongPage || isGenerationBusy}
              onClick={handleDownloadLongPage}
              type="button"
            >
              {isDownloadingLongPage ? <Loader2 className={styles.spinIcon} size={16} /> : <Download size={16} />}
              긴 상세페이지 JPG
            </button>
            <button className={styles.primaryButton} onClick={handleDownload} type="button" disabled={!currentSection.generatedImage || isGenerationBusy}>
              <Download size={16} />
              현재 섹션 다운로드
            </button>
          </div>
        </header>

        {blockedGeneratedSections.length ? (
          <div className={styles.deliveryGateBanner} onClick={stopShellClick}>
            <AlertCircle size={18} />
            <div>
              <strong>납품 파일 다운로드가 차단된 섹션이 있습니다.</strong>
              <p>
                {blockedGeneratedSections.slice(0, 4).map(getDisplaySectionName).join(", ")}
                {blockedGeneratedSections.length > 4 ? ` 외 ${blockedGeneratedSections.length - 4}개` : ""} 섹션을 다시 생성하거나 실제 제품/화면 자료를 보강하세요.
              </p>
            </div>
          </div>
        ) : reviewGeneratedSections.length ? (
          <div className={styles.deliveryReviewBanner} onClick={stopShellClick}>
            <AlertCircle size={18} />
            <div>
              <strong>검수 후 납품 권장</strong>
              <p>{reviewGeneratedSections.length}개 섹션은 품질 게이트에서 수동 확인이 필요하다고 판단했습니다. 다운로드 전 이미지 선명도와 텍스트 영역을 확인하세요.</p>
            </div>
          </div>
        ) : null}

        {analysisFallbackUsed ? (
          <div className={styles.deliveryReviewBanner} onClick={stopShellClick}>
            <AlertCircle size={18} />
            <div>
              <strong>AI 분석이 기본 구조로 대체되었습니다.</strong>
              <p>업로드 이미지 분석 또는 모델 응답이 실패해 사용자 입력 기반 구조로 열었습니다. 상품명과 핵심 기능은 반영했지만, 고객 납품 전 실제 화면/제품 정보와 섹션 카피를 검수하세요.</p>
            </div>
          </div>
        ) : null}

        {showSaveToast ? <div className={styles.saveToast}>저장되었습니다.</div> : null}

        <div className={styles.noticeRow} onClick={stopShellClick}>
          <div className={styles.noticeBanner}>{notice}</div>
          {errorMessage ? (
            <div className={styles.errorBanner}>
              <AlertCircle size={16} />
              {errorMessage}
            </div>
          ) : null}
        </div>

        <div className={styles.editorLayout}>
          <aside className={styles.sectionRail} onClick={stopShellClick}>
            <div className={styles.railCard}>
              <p className={styles.sidebarLabel}>현재 섹션</p>
              <h2 className={styles.railTitle}>{getDisplaySectionName(currentSection)}</h2>
              <p className={styles.railDescription}>{getDisplaySectionGoal(currentSection)}</p>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
              </div>
                <div className={styles.metricGrid}>
                  <div className={styles.metricCard}>
                    <span>현재 섹션</span>
                  <strong>
                    {safeCurrentSectionIndex + 1}/{sections.length}
                  </strong>
                  </div>
                  <div className={styles.metricCard}>
                    <span>레이어</span>
                    <strong>{currentLayers.length}</strong>
                  </div>
                  <div className={styles.metricCard}>
                    <span>문서 노드</span>
                    <strong>{currentLayeredSectionSummary?.totalNodes ?? 0}</strong>
                  </div>
                  <div className={styles.metricCard}>
                    <span>Asset</span>
                    <strong>{layeredDocumentSummary.assetCount}</strong>
                  </div>
                </div>
              </div>

            <div className={styles.sectionRailCard}>
              <p className={styles.sidebarLabel}>섹션 목록</p>
              <div className={styles.sectionList}>
                {sections.map((section, index) => (
                  <button
                    className={index === safeCurrentSectionIndex ? styles.sectionButtonActive : styles.sectionButton}
                    key={section.section_id}
                    onClick={() => setCurrentSectionIndex(index)}
                    type="button"
                  >
                    <span className={styles.sectionStep}>
                      {section.generatedImage && index !== safeCurrentSectionIndex ? <CheckCircle2 size={12} /> : index + 1}
                    </span>
                    <span className={styles.sectionButtonCopy}>
                      <strong>{getDisplaySectionName(section)}</strong>
                      <small>{getDisplaySectionGoal(section) || "전환 목적을 정리한 섹션"}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <details className={styles.analysisDisclosure}>
              <summary className={styles.disclosureSummary}>
                <FileText size={16} />
                계층형 문서 상태
              </summary>
              <div className={styles.analysisBody}>
                <div className={styles.metricGrid}>
                  <div className={styles.metricCard}>
                    <span>Section frame</span>
                    <strong>
                      {layeredDocumentSummary.frameCount}/{layeredDocumentSummary.sectionCount}
                    </strong>
                  </div>
                  <div className={styles.metricCard}>
                    <span>Editable copy</span>
                    <strong>{layeredDocumentSummary.editableCopyNodeCount}</strong>
                  </div>
                  <div className={styles.metricCard}>
                    <span>Generated bg</span>
                    <strong>{layeredDocumentSummary.backgroundNodeCount}</strong>
                  </div>
                  <div className={styles.metricCard}>
                    <span>Product ref</span>
                    <strong>{layeredDocumentSummary.productReferenceNodeCount}</strong>
                  </div>
                </div>

                <div className={styles.blueprintList}>
                  <span>전체 node {layeredDocumentSummary.totalNodes}</span>
                  <span>표시 node {layeredDocumentSummary.visibleNodes}</span>
                  <span>잠금 node {layeredDocumentSummary.lockedNodes}</span>
                  <span>생성 asset {layeredDocumentSummary.generatedAssetCount}</span>
                  <span>제품 asset {layeredDocumentSummary.productAssetCount}</span>
                  <span>Figma frame {figmaPayload.summary.frameCount}</span>
                  <span>Figma height {figmaPayload.importHints.totalHeight}px</span>
                  <span>Figma 검증 {figmaPayload.validation.status}</span>
                </div>

                {currentLayeredSectionSummary ? (
                  <div className={styles.qualityActionList}>
                    <strong>{currentLayeredSectionSummary.name}</strong>
                    <span>
                      text {currentLayeredSectionSummary.textNodes} · CTA {currentLayeredSectionSummary.ctaNodes} · shape{" "}
                      {currentLayeredSectionSummary.shapeNodes}
                    </span>
                    <span>
                      image {currentLayeredSectionSummary.imageNodes} · product {currentLayeredSectionSummary.productNodes} · editable{" "}
                      {currentLayeredSectionSummary.editableNodes}
                    </span>
                  </div>
                ) : null}

                {currentLayerTreePreview.length ? (
                  <div className={styles.layerTreePanel}>
                    <div className={styles.layerTreeHeader}>
                      <strong>현재 섹션 layer tree</strong>
                      <span>{currentLayerTreePreview.length}개 표시</span>
                    </div>
                    <div className={styles.layerTreeList}>
                      {currentLayerTreePreview.map((node) => (
                        <div className={styles.layerTreeRow} key={node.id} style={{ paddingLeft: `${8 + node.depth * 14}px` }}>
                          <span className={styles.layerTreeType}>{node.type}</span>
                          <span className={styles.layerTreeName}>{node.name}</span>
                          <span className={styles.layerTreeMeta}>
                            {node.role || "role 없음"}
                            {node.assetId ? ` · ${node.assetId}` : ""}
                          </span>
                          <span className={styles.layerTreeFlags}>
                            {node.visible ? "visible" : "hidden"} · {node.locked ? "locked" : "unlocked"} · {node.editable ? "editable" : "fixed"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {layeredDocumentSummary.warnings.length ? (
                  <div className={styles.inlineWarning}>
                    <AlertCircle size={16} />
                    계층 문서 warning {layeredDocumentSummary.warnings.length}건: {layeredDocumentSummary.warnings[0]}
                  </div>
                ) : figmaPayload.validation.warnings.length ? (
                  <div className={styles.inlineWarning}>
                    <AlertCircle size={16} />
                    Figma payload warning {figmaPayload.validation.warnings.length}건: {figmaPayload.validation.warnings[0]}
                  </div>
                ) : (
                  <div className={styles.copyNoticeBox}>
                    <strong>Layer export ready</strong>
                    <p>저장 draft와 Figma payload에 현재 node tree, image asset 참조, 세로 frame 배치 정보가 포함됩니다.</p>
                  </div>
                )}
              </div>
            </details>

            <details className={styles.analysisDisclosure}>
              <summary className={styles.disclosureSummary}>
                <Sparkles size={16} />
                AI 분석 요약 보기
              </summary>
              <div className={styles.analysisBody}>
                {analysisFallbackUsed ? (
                  <div className={styles.inlineWarning}>
                    <AlertCircle size={16} />
                    AI 분석 호출이 실패해 기본 상세페이지 구조로 대체되었습니다. 세부 USP와 증빙 문구는 원본 자료 기준으로 확인하세요.
                  </div>
                ) : null}

                {initialResult.productBrief ? (
                  <div className={styles.copyNoticeBox}>
                    <strong>상품 이해 결과</strong>
                    <p>
                      {[
                        initialResult.productBrief.productName || "제품명 미확인",
                        initialResult.productBrief.category || "카테고리 미확인",
                        initialResult.productBrief.isSoftware ? "SW/디지털 서비스" : "일반 제품",
                        initialResult.productBrief.needsHumanModel ? "모델 사용 가능" : "모델 기본 미사용"
                      ].join(" · ")}
                    </p>
                    {initialResult.productBrief.coreFeatures.length ? (
                      <small>핵심 기능: {initialResult.productBrief.coreFeatures.slice(0, 4).join(", ")}</small>
                    ) : null}
                    {initialResult.productBrief.missingInfo.length ? (
                      <small>부족한 정보: {initialResult.productBrief.missingInfo.slice(0, 4).join(", ")}</small>
                    ) : null}
                  </div>
                ) : null}

                {initialResult.qualityReport ? (
                  <div className={styles.qualityPanel}>
                    <div className={styles.qualityHeader}>
                      <div>
                        <span className={styles.optionSectionEyebrow}>결과 품질 게이트</span>
                        <strong>{getQualityStatusLabel(initialResult.qualityReport.status)}</strong>
                      </div>
                      <span className={getQualityBadgeClass(initialResult.qualityReport.status)}>
                        {initialResult.qualityReport.overallScore}점
                      </span>
                    </div>
                    <p>{initialResult.qualityReport.summary}</p>
                    {initialResult.qualityReport.strengths.length ? (
                      <div className={styles.qualityChipRow}>
                        {initialResult.qualityReport.strengths.slice(0, 4).map((strength) => (
                          <span key={strength}>{strength}</span>
                        ))}
                      </div>
                    ) : null}
                    {initialResult.qualityReport.nextActions.length ? (
                      <div className={styles.qualityActionList}>
                        <strong>다음 보강 작업</strong>
                        {initialResult.qualityReport.nextActions.slice(0, 3).map((action) => (
                          <span key={action}>{action}</span>
                        ))}
                      </div>
                    ) : null}
                    {initialResult.qualityReport.issues.length ? (
                      <div className={styles.qualityIssueList}>
                        {initialResult.qualityReport.issues.slice(0, 4).map((issue, issueIndex) => (
                          <span key={`${issue.sectionId || "global"}-${issueIndex}`}>
                            {issue.sectionId ? `${issue.sectionId} · ` : ""}
                            {issue.message}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {initialResult.copyWarnings?.length ? (
                  <div className={styles.inlineWarning}>
                    <AlertCircle size={16} />
                    카피 검증 경고 {initialResult.copyWarnings.length}건이 있습니다. 섹션별 카피 탭에서 문구를 확인하세요.
                  </div>
                ) : null}

                {initialResult.generationTrace?.stages.length ? (
                  <div className={styles.blueprintList}>
                    {initialResult.generationTrace.stages.map((stage) => (
                      <span key={stage.name}>
                        {stage.name.replace(/^stage-\d?-?/, "")} · {stage.status} · {stage.durationMs ?? 0}ms
                      </span>
                    ))}
                  </div>
                ) : null}

                <p className={styles.summaryText}>{initialResult.blueprint.executiveSummary}</p>

                {blueprintList.length ? (
                  <div className={styles.blueprintList}>
                    {blueprintList.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                ) : null}

                <div className={styles.scoreStack}>
                  {initialResult.blueprint.scorecard.map((item) => (
                    <article className={styles.scoreCard} key={`${item.category}-${item.score}`}>
                      <div className={styles.scoreRow}>
                        <strong>{item.category}</strong>
                        <span
                          className={
                            item.score.startsWith("A")
                              ? styles.scoreBadgeStrong
                              : item.score.startsWith("B")
                                ? styles.scoreBadgeMid
                                : styles.scoreBadgeSoft
                          }
                        >
                          {item.score}
                        </span>
                      </div>
                      <p>{item.reason}</p>
                    </article>
                  ))}
                </div>
              </div>
            </details>
          </aside>

          <section className={styles.canvasColumn}>
            <article className={styles.canvasPanel}>
              <div className={styles.canvasHeader}>
                <div>
                  <p className={styles.panelLabel}>편집 섹션</p>
                  <h2 className={styles.panelTitle}>{getDisplaySectionName(currentSection)}</h2>
                  <p className={styles.panelDescription}>{getDisplaySectionGoal(currentSection)}</p>
                </div>

                <div className={styles.canvasActions}>
                  <button
                    className={styles.navButton}
                    disabled={safeCurrentSectionIndex === 0}
                    onClick={() => setCurrentSectionIndex((current) => Math.max(0, current - 1))}
                    type="button"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span className={styles.metaPill}>
                    {safeCurrentSectionIndex + 1}/{sections.length}
                  </span>
                  <button
                    className={styles.navButton}
                    disabled={safeCurrentSectionIndex === sections.length - 1}
                    onClick={() => setCurrentSectionIndex((current) => Math.min(sections.length - 1, current + 1))}
                    type="button"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>

              <div className={styles.canvasToolbar}>
                <button
                  className={workbenchTab === "image" && workbenchState.isOpen ? styles.workbenchDockButtonActive : styles.workbenchDockButton}
                  onClick={() => openWorkbench("image")}
                  type="button"
                >
                  <Settings2 size={15} />
                  이미지
                </button>
                <button
                  className={workbenchTab === "layer" && workbenchState.isOpen ? styles.workbenchDockButtonActive : styles.workbenchDockButton}
                  onClick={() => openWorkbench("layer")}
                  type="button"
                >
                  <Type size={15} />
                  텍스트 편집
                </button>
                <button
                  className={workbenchTab === "copy" && workbenchState.isOpen ? styles.workbenchDockButtonActive : styles.workbenchDockButton}
                  onClick={() => openWorkbench("copy")}
                  type="button"
                >
                  <Sparkles size={15} />
                  카피
                </button>
                <button className={styles.workbenchDockCreateButton} onClick={handleAddShapeLayer} type="button">
                  <Square size={15} />
                  배경 사각형 추가
                </button>
                <button
                  className={workbenchTab === "guide" && workbenchState.isOpen ? styles.workbenchDockButtonActive : styles.workbenchDockButton}
                  onClick={() => openWorkbench("guide")}
                  type="button"
                >
                  <Palette size={15} />
                  가이드
                </button>
              </div>

              <div className={styles.previewStage} ref={previewStageRef}>
                {currentSection.generatedImage ? (
                  <div className={styles.imageCanvas} ref={imageContainerRef}>
                    <img
                      alt={currentSection.section_name}
                      className={styles.sectionImage}
                      draggable={false}
                      src={currentSection.generatedImage}
                    />

                    {[...currentShapeLayers, ...currentTextLayers].map((overlay) => (
                      <Rnd
                        bounds="parent"
                        className={`${styles.overlayBox} ${isShapeLayer(overlay) ? styles.shapeLayerBox : styles.textLayerBox} ${selectedOverlayId === overlay.id ? styles.overlaySelected : ""}`}
                        enableUserSelectHack={false}
                        enableResizing={
                          selectedOverlayId === overlay.id
                            ? {
                                top: true,
                                right: true,
                                bottom: true,
                                left: true,
                                topRight: true,
                                bottomRight: true,
                                bottomLeft: true,
                                topLeft: true
                              }
                            : false
                        }
                        key={overlay.id}
                        onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
                          event.stopPropagation();
                          setSelectedOverlayId(overlay.id);
                        }}
                        onDragStart={() => {
                          setSelectedOverlayId(overlay.id);
                          setActiveColorPalette(null);
                        }}
                        onDrag={(_, data) => handleOverlayDrag(overlay, data.x, data.y)}
                        onDragStop={(_, data) => handleOverlayDrag(overlay, data.x, data.y)}
                        onResize={(_, direction, ref, __, position) => handleResize(overlay, direction, ref, position)}
                        onResizeStart={() => {
                          handleResizeStart(overlay);
                        }}
                        onResizeStop={(_, direction, ref, __, position) => {
                          handleResize(overlay, direction, ref, position);
                          handleResizeStop(overlay.id);
                        }}
                        position={{ x: overlay.x, y: overlay.y }}
                        resizeHandleClasses={{
                          top: styles.resizeHandleTop,
                          bottom: styles.resizeHandleBottom,
                          left: styles.resizeHandleLeft,
                          right: styles.resizeHandleRight,
                          topLeft: styles.resizeHandleTopLeft,
                          topRight: styles.resizeHandleTopRight,
                          bottomLeft: styles.resizeHandleBottomLeft,
                          bottomRight: styles.resizeHandleBottomRight
                        }}
                        style={{
                          zIndex: isShapeLayer(overlay)
                            ? selectedOverlayId === overlay.id
                              ? 2
                              : 1
                            : selectedOverlayId === overlay.id
                              ? 5
                              : 4
                        }}
                        size={{ width: overlay.width, height: overlay.height }}
                      >
                        {isShapeLayer(overlay) ? (
                          <div className={`${styles.overlayContent} ${styles.overlayDragSurface}`}>
                            <div className={styles.shapeLayerSurface} style={buildShapeLayerStyle(overlay)} />
                          </div>
                        ) : (
                          <div
                            className={`${editingOverlayId === overlay.id ? styles.overlayEditing : styles.overlayContent} ${styles.overlayDragSurface}`}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              setSelectedOverlayId(overlay.id);
                              setEditingOverlayId(overlay.id);
                            }}
                            style={buildOverlayShellStyle(overlay)}
                          >
                            {overlay.backgroundEnabled ? (
                              <div className={styles.overlayBackdrop} style={buildOverlayBackgroundStyle(overlay)} />
                            ) : null}
                            {editingOverlayId === overlay.id ? (
                              <textarea
                                autoFocus
                                className={styles.overlayTextarea}
                                onBlur={() => setEditingOverlayId(null)}
                                onChange={(event) => updateTextOverlayContent(overlay.id, event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    setEditingOverlayId(null);
                                  }
                                }}
                                style={buildOverlayTextStyle(overlay)}
                                value={overlay.text}
                              />
                            ) : (
                              <div className={styles.overlayTextLayer} style={buildOverlayTextStyle(overlay)}>
                                {overlay.text}
                              </div>
                            )}
                          </div>
                        )}
                      </Rnd>
                    ))}

                  </div>
                ) : (
                  <div className={styles.placeholderPanel}>
                    <div className={styles.placeholderIcon}>
                      {isGenerationBusy ? <Loader2 className={styles.spinIcon} size={28} /> : <ImageIcon size={28} />}
                    </div>
                    <div className={styles.placeholderCopy}>
                      <strong>{isGenerationBusy ? "이미지를 생성하는 중입니다." : "이 섹션의 이미지를 아직 만들지 않았습니다."}</strong>
                      <p>
                        {isGenerationBusy
                          ? "Codex OAuth로 OpenAI 이미지 모델을 호출하고 있습니다. 보통 1~2분 정도 걸립니다."
                          : "기본 옵션으로 바로 만들거나, 아래 이미지 탭에서 세부 옵션을 조정할 수 있습니다."}
                      </p>
                      <div className={styles.placeholderActions}>
                        <button className={styles.primaryButtonWide} disabled={isGenerationBusy} onClick={handleGenerateImage} type="button">
                          {isGenerationBusy ? <Loader2 className={styles.spinIcon} size={16} /> : <ImageIcon size={16} />}
                          {isGenerationBusy ? "생성 중" : "이미지 생성하기"}
                        </button>
                        {!workbenchState.isOpen ? (
                          <button className={styles.secondaryButtonWide} onClick={() => openWorkbench("image")} type="button">
                            <Settings2 size={16} />
                            생성 옵션 열기
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}

                {workbenchState.isOpen ? (
                  <Rnd
                    bounds="parent"
                    className={styles.workbenchShell}
                    dragHandleClassName={styles.workbenchHandle}
                    enableResizing={{
                      top: false,
                      right: true,
                      bottom: true,
                      left: false,
                      topRight: false,
                      bottomRight: true,
                      bottomLeft: false,
                      topLeft: false
                    }}
                    minHeight={420}
                    minWidth={320}
                    onDragStop={(_, data) =>
                      setWorkbenchState((current) => ({
                        ...current,
                        x: data.x,
                        y: data.y
                      }))
                    }
                    onResizeStop={(_, __, ref, ___, position) =>
                      setWorkbenchState((current) => ({
                        ...current,
                        x: position.x,
                        y: position.y,
                        width: ref.offsetWidth,
                        height: ref.offsetHeight
                      }))
                    }
                    position={{ x: workbenchState.x, y: workbenchState.y }}
                    size={{ width: workbenchState.width, height: workbenchState.height }}
                  >
                    <div className={styles.workbenchPanel} onClick={(event: ReactMouseEvent<HTMLDivElement>) => event.stopPropagation()}>
                      <div className={styles.workbenchHandle}>
                        <div className={styles.workbenchHandleCopy}>
                          <span className={styles.optionMiniLabel}>Canvas Workbench</span>
                          <strong>
                            {workbenchTab === "image"
                              ? "이미지 옵션"
                              : workbenchTab === "layer"
                                ? "텍스트 편집"
                                : workbenchTab === "copy"
                                  ? "카피 라이브러리"
                                  : "섹션 가이드"}
                          </strong>
                        </div>
                        <div className={styles.workbenchHeaderActions}>
                          <button
                            className={styles.inlineButton}
                            onClick={workbenchTab === "layer" && selectedLayer ? snapWorkbenchToOverlay : snapWorkbenchToEdge}
                            type="button"
                          >
                            <RefreshCw size={14} />
                            옆으로 붙이기
                          </button>
                          <button
                            className={styles.inlineButton}
                            onClick={() =>
                              setWorkbenchState((current) => ({
                                ...current,
                                isOpen: false
                              }))
                            }
                            type="button"
                          >
                            닫기
                          </button>
                        </div>
                      </div>

                      <div className={styles.workbenchTabs}>
                        <button
                          className={workbenchTab === "image" ? styles.workbenchTabActive : styles.workbenchTab}
                          onClick={() => setWorkbenchTab("image")}
                          type="button"
                        >
                          <Settings2 size={15} />
                          이미지
                        </button>
                        <button
                          className={workbenchTab === "layer" ? styles.workbenchTabActive : styles.workbenchTab}
                          onClick={() => setWorkbenchTab("layer")}
                          type="button"
                        >
                          <Type size={15} />
                          텍스트 편집
                        </button>
                        <button
                          className={workbenchTab === "copy" ? styles.workbenchTabActive : styles.workbenchTab}
                          onClick={() => setWorkbenchTab("copy")}
                          type="button"
                        >
                          <Sparkles size={15} />
                          카피
                        </button>
                        <button
                          className={workbenchTab === "guide" ? styles.workbenchTabActive : styles.workbenchTab}
                          onClick={() => setWorkbenchTab("guide")}
                          type="button"
                        >
                          <Palette size={15} />
                          가이드
                        </button>
                      </div>

                      <div className={styles.workbenchBody}>{renderWorkbenchBody()}</div>
                    </div>
                  </Rnd>
                ) : null}
              </div>

              <div className={styles.canvasFooter}>
                <span className={styles.footerStatus}>{currentSection.generatedImage ? "이미지 준비 완료" : "이미지 생성 필요"}</span>
                <span className={styles.footerStatus}>레이어 {currentLayers.length}개</span>
                <span className={styles.footerStatus}>문서 노드 {currentLayeredSectionSummary?.totalNodes ?? 0}개</span>
                <span className={styles.footerStatus}>Asset {layeredDocumentSummary.assetCount}개</span>
                <span className={styles.footerStatus}>{workbenchState.isOpen ? "플로팅 워크벤치 열림" : "플로팅 워크벤치 닫힘"}</span>
              </div>
            </article>
          </section>
        </div>
      </section>
    </main>
  );
}

function buildOverlayShellStyle(overlay: TextOverlay): CSSProperties {
  const padding = getOverlayPadding(overlay.fontSize);

  return {
    position: "relative",
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    padding: `${padding.vertical}px ${padding.horizontal}px`,
    overflow: "hidden"
  };
}

function buildOverlayBackgroundStyle(overlay: TextOverlay): CSSProperties {
  return {
    backgroundColor: toRgba(overlay.backgroundColor, overlay.backgroundOpacity),
    borderRadius: `${overlay.backgroundRadius}px`
  };
}

function buildShapeLayerStyle(layer: ShapeLayer): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    backgroundColor: toRgba(layer.fillColor, layer.fillOpacity),
    borderRadius: `${layer.borderRadius}px`
  };
}

async function buildExportNode(input: {
  imageSrc: string;
  width: number;
  layers: CanvasLayer[];
}) {
  const image = await loadImage(input.imageSrc);
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round((image.naturalHeight / Math.max(image.naturalWidth, 1)) * width));

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-100000px";
  container.style.top = "0";
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.background = "transparent";
  container.style.overflow = "hidden";
  container.style.pointerEvents = "none";
  container.style.zIndex = "-1";

  const imageEl = document.createElement("img");
  imageEl.src = input.imageSrc;
  imageEl.alt = "";
  imageEl.draggable = false;
  imageEl.style.display = "block";
  imageEl.style.width = "100%";
  imageEl.style.height = "100%";
  imageEl.style.objectFit = "cover";
  container.appendChild(imageEl);

  const shapeLayers = input.layers.filter(isShapeLayer);
  const textLayers = input.layers.filter(isTextLayer);

  for (const layer of [...shapeLayers, ...textLayers]) {
    const layerEl = document.createElement("div");
    layerEl.style.position = "absolute";
    layerEl.style.left = `${layer.x}px`;
    layerEl.style.top = `${layer.y}px`;
    layerEl.style.width = `${toNumericSize(layer.width, width)}px`;
    layerEl.style.height = `${toNumericSize(layer.height, height)}px`;

    if (isShapeLayer(layer)) {
      const shapeSurface = document.createElement("div");
      shapeSurface.style.width = "100%";
      shapeSurface.style.height = "100%";
      shapeSurface.style.backgroundColor = toRgba(layer.fillColor, layer.fillOpacity);
      shapeSurface.style.borderRadius = `${layer.borderRadius}px`;
      shapeSurface.style.border = "1px solid rgba(255, 255, 255, 0.18)";
      shapeSurface.style.boxShadow = "inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 12px 28px rgba(8, 16, 28, 0.18)";
      layerEl.appendChild(shapeSurface);
    } else {
      const shell = document.createElement("div");
      const shellStyle = buildOverlayShellStyle(layer);
      applyInlineStyle(shell, shellStyle);
      shell.style.overflow = "hidden";

      if (layer.backgroundEnabled) {
        const backdrop = document.createElement("div");
        backdrop.style.position = "absolute";
        backdrop.style.inset = "0";
        const backdropStyle = buildOverlayBackgroundStyle(layer);
        applyInlineStyle(backdrop, backdropStyle);
        shell.appendChild(backdrop);
      }

      const textEl = document.createElement("div");
      textEl.textContent = layer.text;
      const textStyle = buildOverlayTextStyle(layer);
      applyInlineStyle(textEl, textStyle);
      textEl.style.position = "relative";
      textEl.style.zIndex = "1";
      shell.appendChild(textEl);
      layerEl.appendChild(shell);
    }

    container.appendChild(layerEl);
  }

  return container;
}

async function captureCompositeBlob(imageSrc: string, layers: CanvasLayer[], width = OVERLAY_CANVAS_WIDTH) {
  const exportNode = await buildExportNode({
    imageSrc,
    width,
    layers
  });

  document.body.appendChild(exportNode);

  try {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });

    const canvas = await html2canvas(exportNode, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      scale: 2
    });

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });

    if (!blob) {
      throw new Error("최종 합성 이미지를 만들지 못했습니다.");
    }

    return blob;
  } finally {
    exportNode.remove();
  }
}

async function blobToBase64Payload(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("최종 합성 이미지를 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("최종 합성 이미지 데이터가 올바르지 않습니다.");
  }
  return {
    mimeType: match[1],
    base64: match[2]
  };
}

function applyInlineStyle(target: HTMLElement, style: CSSProperties) {
  Object.entries(style).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    const cssKey = key.replace(/[A-Z]/g, (segment) => `-${segment.toLowerCase()}`);
    target.style.setProperty(cssKey, String(value));
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("섹션 이미지를 합치지 못했습니다."));
    image.src = src;
  });
}

function buildGeneratedImageNotice(input: {
  section: SectionBlueprint;
  imageQuality?: SectionBlueprint["imageQualityReport"];
  hadExistingTextLayers: boolean;
  generatedCopyOverlays: TextOverlay[];
}) {
  if (input.imageQuality?.autoRegenerated) {
    return `${getDisplaySectionName(input.section)} 이미지를 품질 게이트 기준으로 자동 재생성했습니다. 최종 점수 ${input.imageQuality.score}점입니다.`;
  }
  if (input.imageQuality?.status === "blocked") {
    return `${getDisplaySectionName(input.section)} 이미지는 생성됐지만 품질 검수에서 재생성이 필요하다고 판단했습니다.`;
  }
  if (input.imageQuality?.status === "needs_review") {
    return `${getDisplaySectionName(input.section)} 이미지를 만들었습니다. 품질 점수 ${input.imageQuality.score}점이므로 고객 제공 전 확인하세요.`;
  }

  return input.hadExistingTextLayers || input.generatedCopyOverlays.length
    ? `${getDisplaySectionName(input.section)} 이미지를 만들고 편집 가능한 카피 레이어를 유지했습니다.`
    : "이미지는 만들었지만 제품 관련 카피를 만들 정보가 부족해 자동 텍스트 레이어는 올리지 않았습니다. 카피 탭에서 직접 입력하거나 자료를 보강해 재분석하세요.";
}

function buildDeliveryReport(input: {
  initialResult: GeneratedResult;
  sections: SectionBlueprint[];
  overlaysBySection: Record<number, CanvasLayer[]>;
  aspectRatio: AspectRatio;
  desiredTone: string;
}): DeliveryReport {
  const copyWarnings = input.initialResult.copyWarnings ?? [];
  const analysisFallbackUsed = hasAnalysisFallback(input.initialResult);
  const sectionReports = input.sections.map((section, index) => {
    const matchingCopyWarnings = copyWarnings.filter((warning) => warning.sectionId === section.section_id);
    const missingImageIssue: DeliveryReportSection["issues"] = section.generatedImage
      ? []
      : [
          {
            sectionId: section.section_id,
            category: "visual",
            severity: "major",
            message: "섹션 이미지가 아직 생성되지 않았습니다.",
            fix: "이미지를 생성한 뒤 납품 리포트를 다시 확인하세요."
          }
        ];

    return {
      sectionId: section.section_id,
      sectionName: getDisplaySectionName(section),
      generated: Boolean(section.generatedImage),
      status: getSectionQualityStatus(section),
      score: section.imageQualityReport?.score ?? null,
      autoRegenerated: Boolean(section.imageQualityReport?.autoRegenerated),
      providerProof: section.providerProof ?? null,
      headline: getUsableCopy(section.headline) || section.headline,
      subheadline: getUsableCopy(section.subheadline) || section.subheadline,
      purpose: getDisplaySectionGoal(section),
      editableTextLayerCount: (input.overlaysBySection[index] ?? []).filter(isTextLayer).length,
      issues: [...(section.imageQualityReport?.issues ?? []), ...missingImageIssue],
      nextActions: section.imageQualityReport?.nextActions ?? [],
      copyWarnings: matchingCopyWarnings
    } satisfies DeliveryReportSection;
  });

  const generatedSections = sectionReports.filter((section) => section.generated).length;
  const readySections = sectionReports.filter((section) => section.generated && section.status === "ready").length;
  const reviewSections = sectionReports.filter((section) => section.generated && section.status === "needs_review").length;
  const blockedSections = sectionReports.filter((section) => section.generated && section.status === "blocked").length;
  const missingSections = Math.max(0, sectionReports.length - generatedSections);
  const overallStatus: DeliveryStatus = blockedSections
    ? "blocked"
    : reviewSections || missingSections || copyWarnings.length
      ? "needs_review"
      : "ready";
  const counts = {
    totalSections: sectionReports.length,
    generatedSections,
    readySections,
    reviewSections,
    blockedSections,
    missingSections,
    copyWarnings: copyWarnings.length
  };

  return {
    generatedAt: new Date().toISOString(),
    sourceMode: input.initialResult.sourceMode ?? "product",
    analysisMode: analysisFallbackUsed ? "fallback_blueprint" : "model_analysis",
    analysisFallbackUsed,
    aspectRatio: input.aspectRatio,
    desiredTone: input.desiredTone || "AI 자동 추천",
    overallStatus,
    summary: buildDeliveryReportSummary(overallStatus, counts, analysisFallbackUsed),
    counts,
    productBrief: input.initialResult.productBrief ?? null,
    structureQuality: input.initialResult.qualityReport ?? null,
    providerProof: input.initialResult.providerProof ?? null,
    sections: sectionReports,
    nextActions: buildDeliveryReportNextActions(overallStatus, counts, input.initialResult.qualityReport?.nextActions ?? [], analysisFallbackUsed)
  };
}

function buildDeliveryReportSummary(status: DeliveryStatus, counts: DeliveryReport["counts"], analysisFallbackUsed: boolean) {
  const fallbackPrefix = analysisFallbackUsed ? "AI 분석이 기본 구조로 대체된 결과입니다. " : "";
  if (status === "blocked") {
    return `${fallbackPrefix}품질 게이트에서 ${counts.blockedSections}개 섹션이 차단되어 고객 납품 전 재생성이 필요합니다.`;
  }
  if (counts.missingSections) {
    return `${fallbackPrefix}${counts.generatedSections}/${counts.totalSections}개 섹션만 생성되어 전체 상세페이지 납품 전 남은 섹션 생성이 필요합니다.`;
  }
  if (counts.reviewSections || counts.copyWarnings) {
    return `${fallbackPrefix}이미지는 생성되었지만 ${counts.reviewSections}개 섹션과 카피 경고 ${counts.copyWarnings}건은 수동 검수가 필요합니다.`;
  }
  return `${fallbackPrefix}${counts.totalSections}개 섹션이 모두 생성되었고 품질 게이트 기준상 고객 제시가 가능합니다.`;
}

function buildDeliveryReportNextActions(
  status: DeliveryStatus,
  counts: DeliveryReport["counts"],
  structureNextActions: string[],
  analysisFallbackUsed: boolean
) {
  const actions: string[] = [];

  if (analysisFallbackUsed) {
    actions.push("AI 분석이 기본 구조로 대체되었으므로 상품명, 핵심 기능, 증빙 문구를 원본 자료와 대조하세요.");
  }
  if (status === "blocked") {
    actions.push("차단된 섹션은 이미지 재생성 또는 원본 자료 보강 후 다시 다운로드하세요.");
  }
  if (counts.missingSections) {
    actions.push("아직 이미지가 없는 섹션을 모두 생성해 긴 상세페이지 흐름을 완성하세요.");
  }
  if (counts.reviewSections) {
    actions.push("검수 필요 섹션은 제품 선명도, 합성 카피 가독성, 편집 레이어 위치를 확인하세요.");
  }
  if (counts.copyWarnings) {
    actions.push("카피 경고가 있는 문구는 고객이 준 원문 반복, 근거 없는 주장, 너무 긴 문장을 우선 점검하세요.");
  }
  actions.push(...structureNextActions.slice(0, 3));

  return actions.length ? Array.from(new Set(actions)).slice(0, 6) : ["다운로드 전 최종 상품명, 가격, 금지 표현만 확인하세요."];
}

function buildDeliverySummaryText(report: DeliveryReport) {
  const lines = [
    "PDP Delivery Quality Report",
    `Generated at: ${report.generatedAt}`,
    `Analysis mode: ${report.analysisMode}`,
    `Overall status: ${getQualityStatusLabel(report.overallStatus)}`,
    `Summary: ${report.summary}`,
    "",
    "Counts",
    `- Total sections: ${report.counts.totalSections}`,
    `- Generated sections: ${report.counts.generatedSections}`,
    `- Ready sections: ${report.counts.readySections}`,
    `- Needs review sections: ${report.counts.reviewSections}`,
    `- Blocked sections: ${report.counts.blockedSections}`,
    `- Missing sections: ${report.counts.missingSections}`,
    `- Copy warnings: ${report.counts.copyWarnings}`,
    "",
    "Next actions",
    ...report.nextActions.map((action) => `- ${action}`),
    "",
    "Sections",
    ...report.sections.map((section, index) =>
      [
        `${String(index + 1).padStart(2, "0")}. ${section.sectionName}`,
        `   Status: ${getQualityStatusLabel(section.status)}${section.score === null ? "" : ` (${section.score}점)`}`,
        `   Generated: ${section.generated ? "yes" : "no"}`,
        `   Provider: ${section.providerProof ? `${section.providerProof.model} (${section.providerProof.authRoute})` : "unknown"}`,
        `   Editable text layers: ${section.editableTextLayerCount}`,
        `   Headline: ${section.headline || "미확인"}`,
        `   Purpose: ${section.purpose || "미확인"}`,
        section.issues.length ? `   Issues: ${section.issues.map((issue) => issue.message).join(" / ")}` : "   Issues: none"
      ].join("\n")
    )
  ];

  return `${lines.join("\n")}\n`;
}

const OVERLAY_CANVAS_WIDTH = 460;

function getOverlayCanvasHeight(aspectRatio: AspectRatio) {
  switch (aspectRatio) {
    case "1:1":
      return 460;
    case "4:3":
      return 345;
    case "16:9":
      return 259;
    case "3:4":
      return 613;
    case "9:16":
    default:
      return 818;
  }
}

function getQualityStatusLabel(status: NonNullable<GeneratedResult["qualityReport"]>["status"]) {
  switch (status) {
    case "ready":
      return "고객 제시 가능";
    case "blocked":
      return "보강 필요";
    default:
      return "검수 후 사용";
  }
}

function getSectionQualityStatus(section: SectionBlueprint) {
  if (!section.generatedImage) return "needs_review";
  return section.imageQualityReport?.status ?? "needs_review";
}

function isSectionDeliveryBlocked(section: SectionBlueprint) {
  return Boolean(section.generatedImage && getSectionQualityStatus(section) === "blocked");
}

function buildBlockedDownloadMessage(sections: SectionBlueprint[]) {
  const sectionNames = sections.slice(0, 4).map(getDisplaySectionName).join(", ");
  const suffix = sections.length > 4 ? ` 외 ${sections.length - 4}개` : "";
  return `품질 게이트에서 차단된 섹션이 있어 납품 파일을 만들지 않았습니다. ${sectionNames}${suffix} 섹션을 다시 생성하거나 실제 제품/화면 자료를 보강하세요.`;
}

function getQualityBadgeClass(status: NonNullable<GeneratedResult["qualityReport"]>["status"]) {
  switch (status) {
    case "ready":
      return styles.qualityBadgeReady;
    case "blocked":
      return styles.qualityBadgeBlocked;
    default:
      return styles.qualityBadgeReview;
  }
}

function hasAnalysisFallback(result: GeneratedResult) {
  return Boolean(result.generationTrace?.stages.some((stage) => stage.name === "fallback-section-blueprint"));
}

function getOverlaySafeArea(canvasHeight: number) {
  const horizontalInset = canvasHeight < 400 ? 24 : 34;
  return {
    left: horizontalInset,
    top: canvasHeight < 400 ? 24 : 38,
    width: OVERLAY_CANVAS_WIDTH - horizontalInset * 2,
    bottom: Math.max(24, canvasHeight - 28)
  };
}

type SectionStoryRole = "hook" | "problem" | "benefit" | "reason" | "proof" | "demo" | "usecase" | "cta";

interface OverlaySlot {
  x: number;
  y: number;
  maxWidth: number;
  textColor?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  backgroundRadius?: number;
  textAlign?: OverlayTextAlign;
}

function getSectionStoryRole(section: SectionBlueprint): SectionStoryRole {
  const normalized = normalizeCopyToken([section.story_role, section.layout_template, section.section_id, section.section_name, section.goal, section.purpose].filter(Boolean).join(" "));
  if (/(hook|hero|first|첫화면|후킹|히어로)/.test(normalized)) return "hook";
  if (/(problem|pain|concern|문제|고민|불편|불안)/.test(normalized)) return "problem";
  if (/(spec|reason|selection|why|choice|선택|이유|기준|차별)/.test(normalized)) return "reason";
  if (/(proof|trust|evidence|review|cert|number|근거|신뢰|후기|인증|수치|증빙)/.test(normalized)) return "proof";
  if (/(demo|workflow|howto|usage|step|사용법|흐름|설치|도입)/.test(normalized)) return "demo";
  if (/(usecase|situation|scenario|case|상황|활용|역할)/.test(normalized)) return "usecase";
  if (/(cta|faq|objection|final|마지막|질문|구매|문의|시작)/.test(normalized)) return "cta";
  const numeric = Number(section.section_id?.match(/\d+/)?.[0] ?? 0);
  if (numeric === 1) return "hook";
  if (numeric === 2) return "problem";
  if (numeric === 4) return "reason";
  if (numeric === 5) return "proof";
  if (numeric === 6) return "demo";
  if (numeric === 7) return "usecase";
  if (numeric >= 8) return "cta";
  return "benefit";
}

function getRoleOverlayTheme(role: SectionStoryRole) {
  const themes: Record<SectionStoryRole, { darkPanel: string; lightPanel: string; accent: string; textOnDark: string; textOnLight: string; textOnAccent: string; shadow: string }> = {
    hook: { darkPanel: "#102532", lightPanel: "#f3f7fb", accent: "#167b72", textOnDark: "#ffffff", textOnLight: "#102532", textOnAccent: "#ffffff", shadow: "#07141d" },
    problem: { darkPanel: "#25323f", lightPanel: "#fff7ed", accent: "#c94747", textOnDark: "#ffffff", textOnLight: "#1f2933", textOnAccent: "#ffffff", shadow: "#111827" },
    benefit: { darkPanel: "#102532", lightPanel: "#eef7f4", accent: "#16806f", textOnDark: "#ffffff", textOnLight: "#12332d", textOnAccent: "#ffffff", shadow: "#07141d" },
    reason: { darkPanel: "#172033", lightPanel: "#f4f2ff", accent: "#315ac5", textOnDark: "#ffffff", textOnLight: "#172033", textOnAccent: "#ffffff", shadow: "#101827" },
    proof: { darkPanel: "#1c2630", lightPanel: "#fff8e8", accent: "#a66a00", textOnDark: "#ffffff", textOnLight: "#1c2630", textOnAccent: "#ffffff", shadow: "#111827" },
    demo: { darkPanel: "#14243a", lightPanel: "#eef6ff", accent: "#2463d8", textOnDark: "#ffffff", textOnLight: "#14243a", textOnAccent: "#ffffff", shadow: "#0b1628" },
    usecase: { darkPanel: "#19312d", lightPanel: "#eef8ed", accent: "#26734d", textOnDark: "#ffffff", textOnLight: "#19312d", textOnAccent: "#ffffff", shadow: "#0b1d19" },
    cta: { darkPanel: "#13202a", lightPanel: "#f7f1e8", accent: "#14736c", textOnDark: "#ffffff", textOnLight: "#13202a", textOnAccent: "#ffffff", shadow: "#07141d" }
  };
  return themes[role];
}

function getHeadlineOverlaySlot(role: SectionStoryRole, safe: ReturnType<typeof getOverlaySafeArea>, canvasHeight: number): OverlaySlot {
  if (canvasHeight < 400) {
    return { x: safe.left, y: safe.top, maxWidth: safe.width, backgroundOpacity: 0.9 };
  }
  switch (role) {
    case "reason":
    case "demo":
      return { x: safe.left + 18, y: safe.top + 10, maxWidth: safe.width - 40, backgroundOpacity: 0.86 };
    case "proof":
      return { x: safe.left, y: safe.top + 20, maxWidth: safe.width - 16, backgroundOpacity: 0.9 };
    case "cta":
      return { x: safe.left, y: safe.top + 34, maxWidth: safe.width, backgroundOpacity: 0.9, textAlign: "center" };
    default:
      return { x: safe.left, y: safe.top, maxWidth: safe.width, backgroundOpacity: 0.88 };
  }
}

function getSubheadlineOverlaySlot(
  role: SectionStoryRole,
  safe: ReturnType<typeof getOverlaySafeArea>,
  canvasHeight: number,
  headlineSlot: OverlaySlot,
  headlineHeight: number
): OverlaySlot {
  const stackedY = clampValue(headlineSlot.y + headlineHeight + 10, safe.top + 54, Math.max(safe.top + 54, canvasHeight - 260));
  if (role === "cta") {
    return { x: safe.left + 16, y: stackedY, maxWidth: safe.width - 32, backgroundOpacity: 0.78, textAlign: "center" };
  }
  if (role === "proof" || role === "reason") {
    return { x: safe.left + 18, y: stackedY, maxWidth: safe.width - 52, backgroundOpacity: 0.74 };
  }
  return { x: safe.left, y: stackedY, maxWidth: safe.width - 18, backgroundOpacity: 0.76 };
}

function getCtaOverlaySlot(role: SectionStoryRole, safe: ReturnType<typeof getOverlaySafeArea>, canvasHeight: number): OverlaySlot {
  const y = clampValue(canvasHeight - 82, safe.top + 240, canvasHeight - 58);
  if (role === "cta") {
    return { x: safe.left + 18, y, maxWidth: safe.width - 36, backgroundRadius: 999, textAlign: "center" };
  }
  if (role === "proof" || role === "reason") {
    return { x: safe.left + 18, y, maxWidth: Math.min(240, safe.width - 40), backgroundRadius: 999, textAlign: "center" };
  }
  return { x: safe.left, y, maxWidth: Math.min(220, safe.width - 86), backgroundRadius: 999, textAlign: "center" };
}

function getBulletOverlaySlots(role: SectionStoryRole, safe: ReturnType<typeof getOverlaySafeArea>, canvasHeight: number, ctaY: number): OverlaySlot[] {
  const compact = canvasHeight < 560;
  const startY = clampValue(
    role === "demo" ? Math.round(canvasHeight * 0.42) : role === "proof" || role === "usecase" ? Math.round(canvasHeight * 0.48) : Math.max(safe.top + 216, Math.round(canvasHeight * 0.56)),
    safe.top + 142,
    Math.max(safe.top + 142, ctaY - 122)
  );
  const slots: OverlaySlot[] = [];
  const maxCount = compact ? 1 : role === "proof" || role === "usecase" || role === "demo" ? 3 : 2;
  const availableCount = Math.max(1, Math.min(maxCount, Math.floor((ctaY - startY - 8) / 46) + 1));

  for (let index = 0; index < availableCount; index += 1) {
    if ((role === "benefit" || role === "usecase" || role === "proof") && !compact) {
      const columnWidth = Math.floor((safe.width - 14) / 2);
      slots.push({
        x: safe.left + (index % 2) * (columnWidth + 14),
        y: startY + Math.floor(index / 2) * 54,
        maxWidth: columnWidth,
        backgroundOpacity: role === "proof" ? 0.9 : 0.86
      });
      continue;
    }

    slots.push({
      x: role === "reason" ? safe.left + 30 : safe.left,
      y: startY + index * 50,
      maxWidth: role === "reason" ? safe.width - 60 : safe.width - 42,
      backgroundOpacity: role === "problem" ? 0.9 : 0.86
    });
  }

  return slots;
}

function buildAutoCopyOverlayRecord(sections: SectionBlueprint[], aspectRatio: AspectRatio): Record<number, CanvasLayer[]> {
  return sections.reduce<Record<number, CanvasLayer[]>>((record, section, index) => {
    if (section.generatedImage) {
      record[index] = buildAutoCopyOverlays(section, aspectRatio);
    }
    return record;
  }, {});
}

function buildLayerPlanContextForSection(
  document: PdpLayeredDocumentV2,
  section: SectionBlueprint,
  sectionIndex: number
): PdpLayerPlanContext | undefined {
  const plannedSection =
    document.sections.find((candidate) => candidate.sectionId === section.section_id) ??
    document.sections[sectionIndex] ??
    null;
  if (!plannedSection) return undefined;
  return {
    canvas: document.canvas,
    sections: [plannedSection]
  };
}

function buildLayeredDocumentCopyOverlays(input: {
  document: PdpLayeredDocumentV2;
  sections: SectionBlueprint[];
  sectionIndex: number;
  aspectRatio: AspectRatio;
}): TextOverlay[] {
  const section = input.sections[input.sectionIndex];
  const recovered = canvasLayersFromLayeredDocumentV2({
    document: input.document,
    sections: input.sections
  });
  const layeredText = (recovered[input.sectionIndex] ?? []).filter(isTextLayer);
  if (layeredText.length) {
    const canvasHeight = getOverlayCanvasHeight(input.aspectRatio);
    return layeredText.map((overlay) => clampTextOverlayToCanvas(overlay, canvasHeight));
  }
  return section ? buildAutoCopyOverlays(section, input.aspectRatio) : [];
}

function buildGeneratedSectionLayers(existingLayers: CanvasLayer[], generatedCopyOverlays: TextOverlay[]) {
  if (!generatedCopyOverlays.length) return existingLayers;
  const existingTextLayers = existingLayers.filter(isTextLayer);
  if (existingTextLayers.length && !shouldReplaceAutoCopyLayers(existingLayers, generatedCopyOverlays)) {
    return existingLayers;
  }
  return [...existingLayers.filter(isShapeLayer), ...generatedCopyOverlays];
}

function shouldReplaceAutoCopyLayers(existingLayers: CanvasLayer[], nextAutoLayers: TextOverlay[]) {
  const existingTextLayers = existingLayers.filter(isTextLayer);
  if (!existingTextLayers.length) return true;
  if (existingLayers.some(isShapeLayer)) return false;

  const nextById = new Map(nextAutoLayers.map((layer) => [layer.id, layer]));
  return existingTextLayers.every((existing) => {
    const next = nextById.get(existing.id);
    if (!next) return false;
    return normalizeCopyToken(existing.translations.ko || existing.text) === normalizeCopyToken(next.translations.ko || next.text);
  });
}

async function buildContentAwareAutoCopyOverlays(
  section: SectionBlueprint,
  aspectRatio: AspectRatio,
  imageSrc: string,
  mode: "balanced" | "safe-stack"
): Promise<TextOverlay[]> {
  const baseOverlays = buildAutoCopyOverlays(section, aspectRatio);
  return baseOverlays.map((overlay) => clampTextOverlayToCanvas(overlay, getOverlayCanvasHeight(aspectRatio)));
}

interface ImageOccupancyMap {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  canvasHeight: number;
}

interface OverlayPlacementCandidate {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageRegionStats {
  brightness: number;
  variance: number;
  edgeDensity: number;
  centerWeight: number;
  busyScore: number;
}

async function buildImageOccupancyMap(imageSrc: string, canvasHeight: number): Promise<ImageOccupancyMap> {
  const image = await loadImage(imageSrc);
  const width = 92;
  const height = Math.max(1, Math.round((canvasHeight / OVERLAY_CANVAS_WIDTH) * width));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("이미지 분석 캔버스를 만들지 못했습니다.");
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);
  return {
    data: context.getImageData(0, 0, width, height).data,
    width,
    height,
    canvasHeight
  };
}

function buildOverlayPlacementCandidates(
  overlay: TextOverlay,
  role: SectionStoryRole,
  canvasHeight: number,
  placed: TextOverlay[],
  mode: "balanced" | "safe-stack"
): OverlayPlacementCandidate[] {
  const safe = getOverlaySafeArea(canvasHeight);
  const width = Math.min(toNumericSize(overlay.width, 320), safe.width);
  const height = Math.min(toNumericSize(overlay.height, 72), Math.max(34, canvasHeight - 24));
  const maxX = OVERLAY_CANVAS_WIDTH - width - 12;
  const maxY = canvasHeight - height - 12;
  const current = {
    x: clampValue(overlay.x, 12, maxX),
    y: clampValue(overlay.y, 12, maxY),
    width,
    height
  };
  const xCandidates = uniqueNumbers([
    current.x,
    safe.left,
    safe.left + 16,
    Math.round((OVERLAY_CANVAS_WIDTH - width) / 2),
    OVERLAY_CANVAS_WIDTH - safe.left - width,
    OVERLAY_CANVAS_WIDTH - safe.left - width - 16
  ]).map((x) => clampValue(x, 12, maxX));
  const previous = placed[placed.length - 1];
  const stackedY = previous ? previous.y + toNumericSize(previous.height, 48) + 10 : safe.top;
  const isCta = overlay.fontWeight === "800" || overlay.backgroundRadius >= 100;
  const isHeadline = overlay.fontSize >= 20 && placed.length === 0;
  const roleLowerBias =
    role === "proof" || role === "demo" || role === "usecase" ? Math.round(canvasHeight * 0.48) : Math.round(canvasHeight * 0.56);
  const baseY = isCta
    ? [canvasHeight - height - 34, canvasHeight - height - 88, safe.top + 24, Math.round(canvasHeight * 0.54)]
    : isHeadline
      ? [current.y, safe.top, safe.top + 28, Math.round(canvasHeight * 0.12), Math.round(canvasHeight * 0.46)]
      : [current.y, stackedY, safe.top + 98, safe.top + 156, roleLowerBias, Math.round(canvasHeight * 0.66)];
  const safeY =
    mode === "safe-stack"
      ? [stackedY, safe.top, safe.top + 42, Math.round(canvasHeight * 0.44), Math.round(canvasHeight * 0.62), canvasHeight - height - 96]
      : baseY;
  const yCandidates = uniqueNumbers(safeY).map((y) => clampValue(y, 12, maxY));

  const candidates: OverlayPlacementCandidate[] = [];
  for (const x of xCandidates) {
    for (const y of yCandidates) {
      candidates.push({ x, y, width, height });
    }
  }

  return dedupePlacementCandidates([current, ...candidates]);
}

function selectBestOverlayPlacement(
  overlay: TextOverlay,
  candidates: OverlayPlacementCandidate[],
  occupancy: ImageOccupancyMap,
  placed: TextOverlay[],
  mode: "balanced" | "safe-stack"
) {
  const current = { x: overlay.x, y: overlay.y };
  return candidates.reduce((best, candidate) => {
    const candidateScore = scoreOverlayPlacement(candidate, current, occupancy, placed, mode);
    const bestScore = scoreOverlayPlacement(best, current, occupancy, placed, mode);
    return candidateScore < bestScore ? candidate : best;
  }, candidates[0]);
}

function scoreOverlayPlacement(
  candidate: OverlayPlacementCandidate,
  current: { x: number; y: number },
  occupancy: ImageOccupancyMap,
  placed: TextOverlay[],
  mode: "balanced" | "safe-stack"
) {
  const stats = getImageRegionStats(occupancy, candidate);
  const overlapPenalty = placed.reduce((total, overlay) => total + getOverlayIntersectionRatio(candidate, overlay) * 140, 0);
  const movementPenalty = (Math.abs(candidate.x - current.x) / OVERLAY_CANVAS_WIDTH + Math.abs(candidate.y - current.y) / occupancy.canvasHeight) * 8;
  const centerPenalty = mode === "safe-stack" ? stats.centerWeight * 22 : stats.centerWeight * 14;
  const edgePenalty = getCanvasEdgePenalty(candidate, occupancy.canvasHeight);
  return stats.busyScore * 100 + stats.edgeDensity * 45 + overlapPenalty + movementPenalty + centerPenalty + edgePenalty;
}

function adjustOverlayForImageRegion(overlay: TextOverlay, occupancy: ImageOccupancyMap, mode: "balanced" | "safe-stack") {
  const stats = getImageRegionStats(occupancy, {
    x: overlay.x,
    y: overlay.y,
    width: toNumericSize(overlay.width, 320),
    height: toNumericSize(overlay.height, 72)
  });
  const needsStrongerPanel = mode === "safe-stack" || stats.busyScore > 0.42 || stats.edgeDensity > 0.18;
  const nextBackgroundColor =
    needsStrongerPanel && stats.brightness > 0.68 && overlay.backgroundOpacity < 0.9 ? "#ffffff" : overlay.backgroundColor;
  const nextTextColor =
    needsStrongerPanel && stats.brightness > 0.68 && overlay.backgroundOpacity < 0.9 ? "#102532" : overlay.color;

  return {
    ...overlay,
    color: nextTextColor,
    backgroundColor: nextBackgroundColor,
    backgroundEnabled: true,
    backgroundOpacity: needsStrongerPanel
      ? Math.max(overlay.backgroundOpacity, mode === "safe-stack" ? 0.96 : 0.92)
      : Math.max(overlay.backgroundOpacity, 0.82),
    shadowEnabled: true,
    shadowOpacity: needsStrongerPanel ? Math.max(overlay.shadowOpacity, 0.5) : overlay.shadowOpacity,
    shadowBlur: needsStrongerPanel ? Math.max(overlay.shadowBlur, 20) : overlay.shadowBlur
  };
}

function getImageRegionStats(occupancy: ImageOccupancyMap, rect: OverlayPlacementCandidate): ImageRegionStats {
  const x1 = clampValue(Math.floor((rect.x / OVERLAY_CANVAS_WIDTH) * occupancy.width), 0, occupancy.width - 1);
  const y1 = clampValue(Math.floor((rect.y / occupancy.canvasHeight) * occupancy.height), 0, occupancy.height - 1);
  const x2 = clampValue(Math.ceil(((rect.x + rect.width) / OVERLAY_CANVAS_WIDTH) * occupancy.width), x1 + 1, occupancy.width);
  const y2 = clampValue(Math.ceil(((rect.y + rect.height) / occupancy.canvasHeight) * occupancy.height), y1 + 1, occupancy.height);
  const luminanceValues: number[] = [];
  let edgeTotal = 0;
  let edgeCount = 0;

  for (let y = y1; y < y2; y += 1) {
    for (let x = x1; x < x2; x += 1) {
      const luminance = getSampleLuminance(occupancy, x, y);
      luminanceValues.push(luminance);
      if (x + 1 < x2) {
        edgeTotal += Math.abs(luminance - getSampleLuminance(occupancy, x + 1, y));
        edgeCount += 1;
      }
      if (y + 1 < y2) {
        edgeTotal += Math.abs(luminance - getSampleLuminance(occupancy, x, y + 1));
        edgeCount += 1;
      }
    }
  }

  const brightness = luminanceValues.reduce((total, value) => total + value, 0) / Math.max(1, luminanceValues.length);
  const variance =
    luminanceValues.reduce((total, value) => total + Math.pow(value - brightness, 2), 0) / Math.max(1, luminanceValues.length);
  const edgeDensity = edgeCount ? edgeTotal / edgeCount : 0;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const distanceFromCenter = Math.sqrt(
    Math.pow((centerX - OVERLAY_CANVAS_WIDTH / 2) / (OVERLAY_CANVAS_WIDTH / 2), 2) +
      Math.pow((centerY - occupancy.canvasHeight / 2) / (occupancy.canvasHeight / 2), 2)
  );
  const centerWeight = clampValue(1 - distanceFromCenter, 0, 1);
  const busyScore = clampValue(variance * 4.2 + edgeDensity * 2.8 + centerWeight * 0.14, 0, 1);

  return {
    brightness,
    variance,
    edgeDensity,
    centerWeight,
    busyScore
  };
}

function getSampleLuminance(occupancy: ImageOccupancyMap, x: number, y: number) {
  const index = (y * occupancy.width + x) * 4;
  const r = occupancy.data[index] ?? 0;
  const g = occupancy.data[index + 1] ?? 0;
  const b = occupancy.data[index + 2] ?? 0;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function getOverlayIntersectionRatio(candidate: OverlayPlacementCandidate, overlay: TextOverlay) {
  const left = Math.max(candidate.x, overlay.x);
  const top = Math.max(candidate.y, overlay.y);
  const right = Math.min(candidate.x + candidate.width, overlay.x + toNumericSize(overlay.width, 0));
  const bottom = Math.min(candidate.y + candidate.height, overlay.y + toNumericSize(overlay.height, 0));
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (!width || !height) return 0;
  const candidateArea = candidate.width * candidate.height;
  const overlayArea = toNumericSize(overlay.width, 0) * toNumericSize(overlay.height, 0);
  return (width * height) / Math.max(1, Math.min(candidateArea, overlayArea));
}

function getCanvasEdgePenalty(candidate: OverlayPlacementCandidate, canvasHeight: number) {
  const horizontalMargin = Math.min(candidate.x, OVERLAY_CANVAS_WIDTH - candidate.x - candidate.width);
  const verticalMargin = Math.min(candidate.y, canvasHeight - candidate.y - candidate.height);
  return (horizontalMargin < 16 ? 8 : 0) + (verticalMargin < 16 ? 8 : 0);
}

function dedupePlacementCandidates(candidates: OverlayPlacementCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${Math.round(candidate.x)}:${Math.round(candidate.y)}:${Math.round(candidate.width)}:${Math.round(candidate.height)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueNumbers(values: number[]) {
  return Array.from(new Set(values.map((value) => Math.round(value)).filter((value) => Number.isFinite(value))));
}

function shouldRetryFinalCompositeLayout(
  report: SectionImageQualityReport,
  nextLayers: CanvasLayer[],
  existingLayers: CanvasLayer[],
  generatedCopyOverlays: TextOverlay[]
) {
  if (report.status === "ready" || !generatedCopyOverlays.length || !nextLayers.some(isTextLayer)) return false;
  const existingTextLayers = existingLayers.filter(isTextLayer);
  if (existingTextLayers.length && !shouldReplaceAutoCopyLayers(existingLayers, generatedCopyOverlays)) return false;

  const text = normalizeCopyToken(
    [
      report.summary,
      ...report.issues.flatMap((issue) => [issue.message, issue.fix]),
      ...report.nextActions
    ].join(" ")
  );
  return /(text|copy|overlay|readability|contrast|clip|outside|cover|padding|overflow|텍스트|카피|문구|가독|대비|잘림|이탈|밖|가림|덮|겹침|여백|레이어)/i.test(text);
}

function isBetterFinalCompositeReport(candidate: SectionImageQualityReport, current: SectionImageQualityReport) {
  const candidateRank = qualityStatusRankValue(candidate.status);
  const currentRank = qualityStatusRankValue(current.status);
  if (candidateRank !== currentRank) return candidateRank > currentRank;
  return candidate.score >= current.score + 3;
}

function qualityStatusRankValue(status: DeliveryStatus) {
  switch (status) {
    case "ready":
      return 3;
    case "needs_review":
      return 2;
    default:
      return 1;
  }
}

function buildFinalQualityFallbackReport(
  section: SectionBlueprint,
  error: unknown,
  backgroundReport?: SectionImageQualityReport
): SectionImageQualityReport {
  const base = backgroundReport ?? {
    score: 70,
    status: "needs_review" as const,
    summary: "배경 이미지는 생성됐지만 최종 합성본 검수 결과가 없습니다.",
    checks: [],
    issues: [],
    nextActions: []
  };
  const errorMessage = error instanceof Error ? error.message : "";
  const finalIssue = {
    sectionId: section.section_id,
    category: "visual" as const,
    severity: "major" as const,
    message: errorMessage ? `최종 합성본 AI 검수가 실패했습니다: ${errorMessage}` : "최종 합성본 AI 검수가 완료되지 않았습니다.",
    fix: "최종 JPG에서 카피 가독성, 캔버스 밖 이탈, 제품/화면 가림, 이미지 선명도를 직접 확인하세요."
  };

  return {
    ...base,
    score: Math.min(base.score, 70),
    status: base.status === "blocked" ? "blocked" : "needs_review",
    summary: "최종 합성본 품질 검수를 완료하지 못해 수동 검수가 필요합니다.",
    checks: Array.from(new Set([...base.checks, "최종 합성본 검수 미완료"])).slice(0, 8),
    issues: [...base.issues, finalIssue].slice(0, 8),
    nextActions: Array.from(
      new Set(["최종 합성 카피의 위치와 대비를 확인하세요.", "문제가 있으면 배경 사각형 또는 텍스트 레이어를 조정하세요.", ...base.nextActions])
    ).slice(0, 4)
  };
}

function buildAutoCopyOverlays(section: SectionBlueprint, aspectRatio: AspectRatio): TextOverlay[] {
  const overlays: TextOverlay[] = [];
  const canvasHeight = getOverlayCanvasHeight(aspectRatio);
  const safe = getOverlaySafeArea(canvasHeight);
  const role = getSectionStoryRole(section);
  const theme = getRoleOverlayTheme(role);
  const headline = getUsableCopy(section.headline);
  const headlineEn = getUsableCopy(section.headline_en) || headline;
  const subheadline = getUsableCopy(section.subheadline);
  const subheadlineEn = getUsableCopy(section.subheadline_en) || subheadline;
  const trustLine = getUsableCopyPair(section.trust_or_objection_line, section.trust_or_objection_line_en);
  const bulletCopies = role === "proof" || role === "cta"
    ? [...(trustLine ? [trustLine] : []), ...getUsableBulletCopies(section)]
    : [...getUsableBulletCopies(section), ...(trustLine ? [trustLine] : [])];
  const cta = getUsableCopy(section.CTA);
  const ctaEn = getUsableCopy(section.CTA_en) || cta;
  const headlineSlot = getHeadlineOverlaySlot(role, safe, canvasHeight);

  if (headline) {
    overlays.push(
      createTextOverlay({
        translations: { ko: headline, en: headlineEn },
        type: "headline",
        language: "ko",
        x: headlineSlot.x,
        y: headlineSlot.y,
        textColor: headlineSlot.textColor ?? theme.textOnDark,
        backgroundColor: headlineSlot.backgroundColor ?? theme.darkPanel,
        shadowColor: theme.shadow,
        backgroundEnabled: true,
        backgroundOpacity: headlineSlot.backgroundOpacity ?? 0.88,
        backgroundRadius: headlineSlot.backgroundRadius ?? 18,
        textAlign: headlineSlot.textAlign,
        maxWidth: headlineSlot.maxWidth
      })
    );
  }

  const headlineHeight = overlays[0] && isTextLayer(overlays[0]) ? toNumericSize(overlays[0].height, 96) : 0;
  const subheadlineSlot = getSubheadlineOverlaySlot(role, safe, canvasHeight, headlineSlot, headlineHeight);
  if (subheadline) {
    overlays.push(
      createTextOverlay({
        translations: { ko: subheadline, en: subheadlineEn },
        type: "subheadline",
        language: "ko",
        x: subheadlineSlot.x,
        y: subheadlineSlot.y,
        textColor: subheadlineSlot.textColor ?? theme.textOnDark,
        backgroundColor: subheadlineSlot.backgroundColor ?? theme.darkPanel,
        shadowColor: theme.shadow,
        backgroundEnabled: true,
        backgroundOpacity: subheadlineSlot.backgroundOpacity ?? 0.76,
        backgroundRadius: subheadlineSlot.backgroundRadius ?? 16,
        textAlign: subheadlineSlot.textAlign,
        maxWidth: subheadlineSlot.maxWidth
      })
    );
  }

  const ctaSlot = getCtaOverlaySlot(role, safe, canvasHeight);
  const bulletSlots = getBulletOverlaySlots(role, safe, canvasHeight, ctaSlot.y);
  const bullets = bulletCopies.slice(0, bulletSlots.length);
  bullets.forEach((bullet, index) => {
    const slot = bulletSlots[index] ?? bulletSlots[0];
    overlays.push(
      createTextOverlay({
        translations: bullet,
        type: "keypoint",
        language: "ko",
        x: slot.x,
        y: slot.y,
        textColor: slot.textColor ?? theme.textOnLight,
        backgroundColor: slot.backgroundColor ?? theme.lightPanel,
        shadowColor: theme.shadow,
        backgroundEnabled: true,
        backgroundOpacity: slot.backgroundOpacity ?? 0.86,
        backgroundRadius: slot.backgroundRadius ?? 14,
        textAlign: slot.textAlign,
        maxWidth: slot.maxWidth
      })
    );
  });

  if (cta) {
    overlays.push(
      createTextOverlay({
        translations: { ko: cta, en: ctaEn },
        type: "default",
        language: "ko",
        x: ctaSlot.x,
        y: ctaSlot.y,
        textColor: ctaSlot.textColor ?? theme.textOnAccent,
        backgroundColor: ctaSlot.backgroundColor ?? theme.accent,
        shadowColor: theme.shadow,
        backgroundEnabled: true,
        backgroundOpacity: ctaSlot.backgroundOpacity ?? 0.92,
        backgroundRadius: ctaSlot.backgroundRadius ?? 999,
        textAlign: ctaSlot.textAlign ?? "center",
        fontWeight: "800",
        maxWidth: ctaSlot.maxWidth
      })
    );
  }

  return overlays.map((overlay) => clampTextOverlayToCanvas(overlay, canvasHeight));
}

function clampTextOverlayToCanvas(overlay: TextOverlay, canvasHeight: number): TextOverlay {
  const width = clampValue(toNumericSize(overlay.width, 320), 120, OVERLAY_CANVAS_WIDTH - overlay.x - 24);
  const height = clampValue(toNumericSize(overlay.height, 96), 34, Math.max(34, canvasHeight - overlay.y - 24));
  const x = clampValue(overlay.x, 12, Math.max(12, OVERLAY_CANVAS_WIDTH - width - 12));
  const y = clampValue(overlay.y, 12, Math.max(12, canvasHeight - height - 12));

  return fitTextOverlayToBox(ensureReadableTextOverlay({
    ...overlay,
    x,
    y,
    width,
    height
  }));
}

function fitTextOverlayToBox(overlay: TextOverlay): TextOverlay {
  const width = toNumericSize(overlay.width, 320);
  const height = toNumericSize(overlay.height, 96);
  let fontSize = clampValue(overlay.fontSize, 11, 34);
  let fitted = overlay;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const estimated = estimateOverlayBox(fitted.text, {
      fontSize,
      fontWeight: fitted.fontWeight,
      fontFamily: fitted.fontFamily,
      lineHeight: fitted.lineHeight,
      maxWidth: width
    });
    if (estimated.height <= height + 2 || fontSize <= 11) break;
    fontSize -= 1;
    fitted = { ...fitted, fontSize };
  }

  return {
    ...fitted,
    fontSize
  };
}

function ensureReadableTextOverlay(overlay: TextOverlay): TextOverlay {
  if (!overlay.backgroundEnabled || !isHexColor(overlay.backgroundColor) || !isHexColor(overlay.color)) {
    return overlay;
  }

  const background = hexToRgb(overlay.backgroundColor);
  const currentText = hexToRgb(overlay.color);
  if (getContrastRatio(background, currentText) >= 4.5) {
    return overlay;
  }

  const black = { r: 16, g: 24, b: 32 };
  const white = { r: 255, g: 255, b: 255 };
  return {
    ...overlay,
    color: getContrastRatio(background, white) >= getContrastRatio(background, black) ? "#ffffff" : "#101820"
  };
}

function getContrastRatio(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }) {
  const lighter = Math.max(getRelativeLuminance(left), getRelativeLuminance(right));
  const darker = Math.min(getRelativeLuminance(left), getRelativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function isHexColor(value: string) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

function getUsableBulletCopies(section: SectionBlueprint) {
  return section.bullets
    .map((bullet, index) => {
      const ko = getUsableCopy(bullet);
      const en = getUsableCopy(section.bullets_en[index]) || ko;
      return ko ? { ko, en } : null;
    })
    .filter((copy): copy is Record<PdpCopyLanguage, string> => Boolean(copy));
}

function getUsableCopyPair(korean: string | undefined | null, english: string | undefined | null) {
  const ko = getUsableCopy(korean);
  const en = getUsableCopy(english) || ko;
  if (!ko && !en) return null;
  return {
    ko: ko || en,
    en: en || ko
  } satisfies Record<PdpCopyLanguage, string>;
}

function getUsableCopy(value: string | undefined | null) {
  const text = value?.trim() ?? "";
  if (!text || isGenericVisibleCopy(text)) return "";
  return text;
}

function prepareOverlayTranslations(
  translations: Record<PdpCopyLanguage, string>,
  type: "headline" | "subheadline" | "keypoint" | "default"
) {
  return {
    ko: compactOverlayCopy(translations.ko, type),
    en: compactOverlayCopy(translations.en || translations.ko, type)
  } satisfies Record<PdpCopyLanguage, string>;
}

function compactOverlayCopy(value: string, type: "headline" | "subheadline" | "keypoint" | "default") {
  const maxLength = type === "headline" ? 20 : type === "subheadline" ? 34 : type === "keypoint" ? 14 : 9;
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/\bCTA\b/gi, "")
    .replace(/연동되는/g, "연동")
    .replace(/자동으로/g, "자동")
    .replace(/깔끔하게/g, "명확하게")
    .replace(/방송 화면에/g, "화면에")
    .replace(/목표 킬이/g, "목표 킬")
    .trim();

  if (normalized.length <= maxLength) return cleanOverlayCopyEnding(normalized);

  const sentence = normalized
    .split(/[.!?。！？]\s*/)
    .map((part) => part.trim())
    .find((part) => part.length >= 4 && part.length <= maxLength);
  if (sentence) return cleanOverlayCopyEnding(sentence);

  const chunks = normalized.split(/\s+/);
  let output = "";
  for (const chunk of chunks) {
    const next = output ? `${output} ${chunk}` : chunk;
    if (next.length > maxLength) break;
    output = next;
  }

  return cleanOverlayCopyEnding(output || normalized.slice(0, maxLength));
}

function cleanOverlayCopyEnding(value: string) {
  let cleaned = value.replace(/[,:：·ㆍ-]$/, "").trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = cleaned
      .replace(/(편이|경우|때문에|위해|따라|따른|전에|처럼|하며|하고|되고|되는|하는|있는|없는|보여주는|만드는|제공하는|지원하는|연동되는|연동된|기반으로|기반|으로만|로만)$/g, "")
      .replace(/(할\s*수|볼\s*수|쓸\s*수|줄\s*수|될\s*수)$/g, "")
      .replace(/[,:：·ㆍ/\-\s]+$/g, "")
      .trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  return cleaned;
}

function getOverlayFontSize(text: string, type: "headline" | "subheadline" | "keypoint" | "default") {
  const length = text.replace(/\s+/g, "").length;
  if (type === "headline") {
    if (length > 16) return 20;
    if (length > 12) return 23;
    return 26;
  }
  if (type === "subheadline") {
    if (length > 28) return 13;
    if (length > 20) return 15;
    return 17;
  }
  if (type === "keypoint") {
    return length > 14 ? 14 : 16;
  }
  return length > 10 ? 15 : 17;
}

function isGenericVisibleCopy(value: string) {
  const normalized = normalizeCopyToken(value);
  if (!normalized) return true;
  if (GENERIC_COPY_TOKENS.has(normalized)) return true;
  if (/^s\d+$/.test(normalized)) return true;
  if (/^section\d+$/.test(normalized)) return true;
  if (/^bullet\d+$/.test(normalized)) return true;
  if (/^섹션\d+$/.test(normalized)) return true;
  if (/^\d+번섹션$/.test(normalized)) return true;
  return false;
}

function normalizeCopyToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[·ㆍ:：.,!?()[\]{}"'`~/_|\\-]/g, "");
}

function createTextOverlay(input: {
  translations: Record<PdpCopyLanguage, string>;
  type: "headline" | "subheadline" | "keypoint" | "default";
  language: PdpCopyLanguage;
  x: number;
  y: number;
  textColor: string;
  backgroundColor: string;
  shadowColor: string;
  backgroundEnabled?: boolean;
  backgroundOpacity?: number;
  backgroundRadius?: number;
  textAlign?: OverlayTextAlign;
  lineHeight?: number;
  fontWeight?: string;
  maxWidth?: number;
}): TextOverlay {
  const preparedTranslations = prepareOverlayTranslations(input.translations, input.type);
  const defaultFontSize = getOverlayFontSize(preparedTranslations[input.language] || preparedTranslations.ko, input.type);
  const normalizedTranslations =
    input.type === "keypoint"
      ? {
          ko: `• ${preparedTranslations.ko}`,
          en: `• ${preparedTranslations.en}`
        }
      : preparedTranslations;
  const displayText = normalizedTranslations[input.language] || normalizedTranslations.ko;
  const defaultFontWeight = input.fontWeight ?? (input.type === "subheadline" ? "500" : "700");
  const lineHeight = input.lineHeight ?? 1.18;
  const maxWidth = input.maxWidth ?? (input.type === "headline" ? 360 : input.type === "subheadline" ? 320 : 280);
  const estimatedBox = estimateOverlayBox(displayText, {
    fontSize: defaultFontSize,
    fontWeight: defaultFontWeight,
    fontFamily: "'Pretendard', sans-serif",
    lineHeight,
    maxWidth
  });

  return normalizeTextOverlay({
    id: crypto.randomUUID(),
    kind: "text",
    text: displayText,
    language: input.language,
    translations: normalizedTranslations,
    x: input.x,
    y: input.y,
    width: estimatedBox.width,
    height: estimatedBox.height,
    fontSize: defaultFontSize,
    color: input.textColor,
    backgroundColor: input.backgroundColor,
    backgroundEnabled: input.backgroundEnabled ?? false,
    backgroundOpacity: input.backgroundOpacity ?? 0.82,
    backgroundRadius: input.backgroundRadius ?? 18,
    fontFamily: "'Pretendard', sans-serif",
    fontWeight: defaultFontWeight,
    textAlign: input.textAlign ?? "left",
    lineHeight,
    shadowEnabled: true,
    shadowColor: input.shadowColor,
    shadowOpacity: 0.42,
    shadowBlur: 18,
    shadowOffsetY: 6
  });
}

function sanitizeSectionFileName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}

function buildOverlayTextStyle(overlay: TextOverlay): CSSProperties {
  return {
    display: "block",
    width: "100%",
    height: "100%",
    color: overlay.color,
    fontFamily: overlay.fontFamily,
    fontSize: `${overlay.fontSize}px`,
    fontWeight: overlay.fontWeight,
    lineHeight: overlay.lineHeight,
    textAlign: overlay.textAlign,
    whiteSpace: "pre-wrap",
    wordBreak: "normal",
    overflowWrap: "anywhere",
    boxSizing: "border-box",
    overflow: "hidden",
    textShadow: overlay.shadowEnabled
      ? `0px ${overlay.shadowOffsetY}px ${overlay.shadowBlur}px ${toRgba(overlay.shadowColor, overlay.shadowOpacity)}`
      : "none"
  };
}

function normalizeOverlayRecord(record: Record<number, CanvasLayer[]>) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, overlays]) => [
      Number(key),
      (Array.isArray(overlays) ? overlays : [])
        .map((overlay) => normalizeCanvasLayer(overlay))
        .filter((overlay): overlay is CanvasLayer => Boolean(overlay))
    ])
  ) as Record<number, CanvasLayer[]>;
}

function normalizeCanvasLayer(layer: Partial<CanvasLayer> & Pick<CanvasLayer, "id" | "x" | "y" | "width" | "height">) {
  if (!layer || typeof layer !== "object") {
    return null;
  }

  if (layer.kind === "shape") {
    return normalizeShapeLayer(layer as Partial<ShapeLayer> & Pick<ShapeLayer, "id" | "x" | "y" | "width" | "height">);
  }

  return normalizeTextOverlay(
    layer as Partial<TextOverlay> &
      Pick<TextOverlay, "id" | "text" | "x" | "y" | "width" | "height" | "fontSize" | "color" | "fontFamily" | "fontWeight" | "textAlign" | "lineHeight" | "backgroundColor">
  );
}

function normalizeTextOverlay(overlay: Partial<TextOverlay> & Pick<TextOverlay, "id" | "text" | "x" | "y" | "width" | "height" | "fontSize" | "color" | "fontFamily" | "fontWeight" | "textAlign" | "lineHeight" | "backgroundColor">): TextOverlay {
  const hasLegacyBackground = Boolean(overlay.backgroundColor && overlay.backgroundColor !== "transparent");
  const translations = normalizeOverlayTranslations(overlay.translations, overlay.text);
  const language = overlay.language === "en" ? "en" : "ko";
  const fontSize = Number.isFinite(Number(overlay.fontSize)) ? Number(overlay.fontSize) : 24;

  const normalized: TextOverlay = {
    ...overlay,
    id: typeof overlay.id === "string" && overlay.id ? overlay.id : crypto.randomUUID(),
    kind: "text",
    language,
    text: translations[language] || translations.ko,
    translations,
    x: Number.isFinite(Number(overlay.x)) ? Number(overlay.x) : 48,
    y: Number.isFinite(Number(overlay.y)) ? Number(overlay.y) : 48,
    width: toNumericSize(overlay.width, 320),
    height: toNumericSize(overlay.height, 96),
    fontSize,
    color: overlay.color ?? "#ffffff",
    fontFamily: overlay.fontFamily || "'Pretendard', sans-serif",
    fontWeight: overlay.fontWeight || "700",
    textAlign: overlay.textAlign === "center" || overlay.textAlign === "right" ? overlay.textAlign : "left",
    lineHeight: Number.isFinite(Number(overlay.lineHeight)) ? Number(overlay.lineHeight) : 1.2,
    backgroundColor: !overlay.backgroundColor || overlay.backgroundColor === "transparent" ? "#102532" : overlay.backgroundColor,
    backgroundEnabled: overlay.backgroundEnabled ?? hasLegacyBackground,
    backgroundOpacity: overlay.backgroundOpacity ?? 0.72,
    backgroundRadius: overlay.backgroundRadius ?? 18,
    shadowEnabled: overlay.shadowEnabled ?? false,
    shadowColor: overlay.shadowColor ?? "#102532",
    shadowOpacity: overlay.shadowOpacity ?? 0.4,
    shadowBlur: overlay.shadowBlur ?? 18,
    shadowOffsetY: overlay.shadowOffsetY ?? 6
  };

  return fitTextOverlayToBox(ensureReadableTextOverlay(normalized));
}

function applyLanguageToTextOverlay(overlay: TextOverlay, nextLanguage: PdpCopyLanguage): TextOverlay {
  const translations = normalizeOverlayTranslations(
    {
      ...overlay.translations,
      [overlay.language]: overlay.text
    },
    overlay.text
  );
  const nextText = translations[nextLanguage] || translations.ko;

  return normalizeTextOverlay({
    ...overlay,
    language: nextLanguage,
    text: nextText,
    translations: {
      ...translations,
      [nextLanguage]: nextText
    }
  });
}

function normalizeShapeLayer(layer: Partial<ShapeLayer> & Pick<ShapeLayer, "id" | "x" | "y" | "width" | "height">): ShapeLayer {
  return {
    ...layer,
    id: typeof layer.id === "string" && layer.id ? layer.id : crypto.randomUUID(),
    kind: "shape",
    x: Number.isFinite(Number(layer.x)) ? Number(layer.x) : 64,
    y: Number.isFinite(Number(layer.y)) ? Number(layer.y) : 64,
    width: toNumericSize(layer.width, 260),
    height: toNumericSize(layer.height, 120),
    fillColor: layer.fillColor ?? "#102532",
    fillOpacity: layer.fillOpacity ?? 1,
    borderRadius: layer.borderRadius ?? 0
  };
}

function getOverlayPadding(fontSize: number) {
  return {
    horizontal: clampValue(Math.round(fontSize * 0.32), 10, 24),
    vertical: clampValue(Math.round(fontSize * 0.18), 8, 18)
  };
}

function normalizeOverlayTranslations(
  translations: Partial<Record<PdpCopyLanguage, string>> | undefined,
  fallbackText: string
) {
  const ko = translations?.ko?.trim() ? translations.ko : fallbackText;
  const en = translations?.en?.trim() ? translations.en : ko;

  return {
    ko,
    en
  } satisfies Record<PdpCopyLanguage, string>;
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toNumericSize(value: number | string, fallback: number) {
  if (typeof value === "number") {
    return value;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function estimateOverlayBox(
  text: string,
  options: {
    fontSize: number;
    fontWeight: string;
    fontFamily: string;
    lineHeight: number;
    maxWidth: number;
  }
) {
  const horizontalPadding = 20;
  const verticalPadding = 12;
  const availableLineWidth = Math.max(120, options.maxWidth - horizontalPadding);
  const lines = text.split("\n").map((line) => line.trimEnd());
  const measure = createTextMeasure(options);

  let wrappedLineCount = 0;
  let widestLine = 0;

  lines.forEach((line) => {
    const targetLine = line || " ";
    const measuredWidth = measure(targetLine);
    widestLine = Math.max(widestLine, Math.min(measuredWidth, availableLineWidth));
    wrappedLineCount += Math.max(1, Math.ceil(measuredWidth / availableLineWidth));
  });

  const lineHeightPx = options.fontSize * options.lineHeight;

  return {
    width: Math.round(
      clampValue(
        Math.max(widestLine + horizontalPadding, Math.min(options.maxWidth, Math.max(220, options.fontSize * 8))),
        96,
        options.maxWidth
      )
    ),
    height: Math.round(clampValue(wrappedLineCount * lineHeightPx + verticalPadding, 40, 220))
  };
}

function createTextMeasure(options: { fontSize: number; fontWeight: string; fontFamily: string }) {
  if (typeof document === "undefined") {
    return (text: string) => Math.max(options.fontSize * 1.6, text.length * options.fontSize * 0.58);
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return (text: string) => Math.max(options.fontSize * 1.6, text.length * options.fontSize * 0.58);
  }

  context.font = `${options.fontWeight} ${options.fontSize}px ${options.fontFamily}`;
  return (text: string) => context.measureText(text).width;
}

async function extractImageColorRecommendations(imageSrc: string): Promise<ImageColorRecommendations> {
  if (typeof document === "undefined") {
    return DEFAULT_COLOR_RECOMMENDATIONS;
  }

  try {
    const image = await loadImage(imageSrc);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      return DEFAULT_COLOR_RECOMMENDATIONS;
    }

    const width = 48;
    const height = Math.max(48, Math.round((image.naturalHeight / Math.max(image.naturalWidth, 1)) * 48));
    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);

    const { data } = context.getImageData(0, 0, width, height);
    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

    for (let index = 0; index < data.length; index += 16) {
      const alpha = data[index + 3];
      if (alpha < 24) {
        continue;
      }

      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const key = `${Math.round(r / 32)}-${Math.round(g / 32)}-${Math.round(b / 32)}`;
      const current = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      current.count += 1;
      current.r += r;
      current.g += g;
      current.b += b;
      buckets.set(key, current);
    }

    const swatches = Array.from(buckets.values())
      .map((bucket) => ({
        count: bucket.count,
        color: {
          r: Math.round(bucket.r / bucket.count),
          g: Math.round(bucket.g / bucket.count),
          b: Math.round(bucket.b / bucket.count)
        }
      }))
      .sort((left, right) => right.count - left.count);

    if (!swatches.length) {
      return DEFAULT_COLOR_RECOMMENDATIONS;
    }

    const dominant = swatches[0]?.color ?? hexToRgb(DEFAULT_COLOR_RECOMMENDATIONS.darkColor);
    const accent =
      swatches
        .slice(0, 8)
        .sort((left, right) => getSaturation(right.color) - getSaturation(left.color))[0]?.color ?? dominant;
    const dark = swatches.find((swatch) => getRelativeLuminance(swatch.color) < 0.34)?.color ?? darkenRgb(dominant, 0.58);
    const light = swatches.find((swatch) => getRelativeLuminance(swatch.color) > 0.72)?.color ?? lightenRgb(dominant, 0.68);

    const accentHex = rgbToHex(boostColorPresence(accent));
    const darkHex = rgbToHex(darkenRgb(dark, 0.08));
    const lightHex = rgbToHex(lightenRgb(light, 0.04));
    const complementHex = rgbToHex(rotateHue(accent, 180));
    const mutedAccentHex = rgbToHex(mixRgb(accent, dark, 0.36));
    const warmTintHex = rgbToHex(lightenRgb(mixRgb(accent, light, 0.5), 0.12));
    const deepContrastHex = rgbToHex(darkenRgb(mixRgb(dominant, accent, 0.22), 0.22));

    return {
      photoColors: uniqueColors(swatches.slice(0, 6).map((swatch) => rgbToHex(swatch.color))),
      recommendedTextColors: uniqueColors([
        "#ffffff",
        getRelativeLuminance(dominant) < 0.48 ? "#f9f7f1" : "#102532",
        lightHex,
        darkHex,
        accentHex
      ]),
      recommendedShapeColors: uniqueColors([
        darkHex,
        mutedAccentHex,
        rgbToHex(mixRgb(light, dark, 0.2)),
        warmTintHex,
        deepContrastHex,
        complementHex
      ]),
      accentColor: accentHex,
      darkColor: darkHex,
      lightColor: lightHex
    };
  } catch {
    return DEFAULT_COLOR_RECOMMENDATIONS;
  }
}

function sortColorsByContrast(colors: string[], against: string | null) {
  if (!against) {
    return uniqueColors(colors);
  }

  const target = hexToRgb(against);
  return uniqueColors(colors).sort(
    (left, right) => contrastScore(hexToRgb(right), target) - contrastScore(hexToRgb(left), target)
  );
}

function uniqueColors(colors: string[]) {
  return Array.from(new Set(colors.map((color) => color.toLowerCase())));
}

function contrastScore(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }) {
  return Math.abs(getRelativeLuminance(left) - getRelativeLuminance(right));
}

function getRelativeLuminance(color: { r: number; g: number; b: number }) {
  const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getSaturation(color: { r: number; g: number; b: number }) {
  const [r, g, b] = [color.r / 255, color.g / 255, color.b / 255];
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function lightenRgb(color: { r: number; g: number; b: number }, amount: number) {
  return {
    r: Math.round(color.r + (255 - color.r) * amount),
    g: Math.round(color.g + (255 - color.g) * amount),
    b: Math.round(color.b + (255 - color.b) * amount)
  };
}

function darkenRgb(color: { r: number; g: number; b: number }, amount: number) {
  return {
    r: Math.round(color.r * (1 - amount)),
    g: Math.round(color.g * (1 - amount)),
    b: Math.round(color.b * (1 - amount))
  };
}

function mixRgb(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }, ratio: number) {
  return {
    r: Math.round(left.r * (1 - ratio) + right.r * ratio),
    g: Math.round(left.g * (1 - ratio) + right.g * ratio),
    b: Math.round(left.b * (1 - ratio) + right.b * ratio)
  };
}

function boostColorPresence(color: { r: number; g: number; b: number }) {
  const saturation = getSaturation(color);
  if (saturation > 0.3) {
    return color;
  }

  const max = Math.max(color.r, color.g, color.b);
  const next = { ...color };
  if (max === color.r) {
    next.r = clampValue(next.r + 28, 0, 255);
  } else if (max === color.g) {
    next.g = clampValue(next.g + 28, 0, 255);
  } else {
    next.b = clampValue(next.b + 28, 0, 255);
  }
  return next;
}

function rotateHue(color: { r: number; g: number; b: number }, degrees: number) {
  const { h, s, l } = rgbToHsl(color);
  return hslToRgb({
    h: (h + degrees + 360) % 360,
    s,
    l
  });
}

function rgbToHsl(color: { r: number; g: number; b: number }) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }

  return {
    h: h < 0 ? h + 360 : h,
    s,
    l
  };
}

function hslToRgb(color: { h: number; s: number; l: number }) {
  const c = (1 - Math.abs(2 * color.l - 1)) * color.s;
  const x = c * (1 - Math.abs(((color.h / 60) % 2) - 1));
  const m = color.l - c / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (color.h < 60) {
    rPrime = c;
    gPrime = x;
  } else if (color.h < 120) {
    rPrime = x;
    gPrime = c;
  } else if (color.h < 180) {
    gPrime = c;
    bPrime = x;
  } else if (color.h < 240) {
    gPrime = x;
    bPrime = c;
  } else if (color.h < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255)
  };
}

function hexToRgb(value: string) {
  const normalized = value.replace("#", "");
  const hex = normalized.length === 3 ? normalized.split("").map((segment) => `${segment}${segment}`).join("") : normalized;
  const numeric = Number.parseInt(hex, 16);

  return {
    r: (numeric >> 16) & 255,
    g: (numeric >> 8) & 255,
    b: numeric & 255
  };
}

function rgbToHex(color: { r: number; g: number; b: number }) {
  return `#${[color.r, color.g, color.b]
    .map((channel) => clampValue(channel, 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function toRgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clampValue(alpha, 0, 1)})`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지 색상을 분석하지 못했습니다."));
    image.src = src;
  });
}

function formatSavedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "방금";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function anchorWorkbenchToOverlay(
  overlay: CanvasLayer,
  canvasEl: HTMLDivElement | null,
  stageEl: HTMLDivElement | null,
  workbench: FloatingWorkbenchState
) {
  const workbenchWidth = workbench.width;
  const workbenchHeight = workbench.height;
  const gap = 18;
  const stageWidth = stageEl?.clientWidth ?? 1240;
  const stageHeight = stageEl?.clientHeight ?? 720;
  const canvasLeft = canvasEl?.offsetLeft ?? 0;
  const canvasTop = canvasEl?.offsetTop ?? 0;
  const overlayWidth = toNumericSize(overlay.width, 320);

  let x = canvasLeft + overlay.x + overlayWidth + gap;
  if (x + workbenchWidth > stageWidth - 16) {
    x = canvasLeft + overlay.x - workbenchWidth - gap;
  }
  if (x < 12) {
    x = clampValue(canvasLeft + overlay.x + 12, 12, Math.max(12, stageWidth - workbenchWidth - 16));
  }

  const y = clampValue(canvasTop + overlay.y, 12, Math.max(12, stageHeight - workbenchHeight - 16));

  return {
    x: Math.round(x),
    y: Math.round(y)
  };
}

function isTextLayer(layer: CanvasLayer): layer is TextOverlay {
  return layer.kind === "text";
}

function isShapeLayer(layer: CanvasLayer): layer is ShapeLayer {
  return layer.kind === "shape";
}

function getWorkbenchPosition(stageEl: HTMLDivElement | null) {
  const width = 332;
  const height = 500;
  const stageWidth = stageEl?.clientWidth ?? 1240;
  const stageHeight = stageEl?.clientHeight ?? 720;

  return {
    x: Math.max(16, stageWidth - width - 20),
    y: 20,
    width,
    height: Math.min(height, Math.max(420, stageHeight - 40)),
    isOpen: true
  };
}

function clampWorkbenchToStage(workbench: FloatingWorkbenchState, stageEl: HTMLDivElement | null) {
  if (!stageEl) {
    return workbench;
  }

  const maxX = Math.max(16, stageEl.clientWidth - workbench.width - 16);
  const maxY = Math.max(16, stageEl.clientHeight - workbench.height - 16);

  return {
    ...workbench,
    x: clampValue(workbench.x, 16, maxX),
    y: clampValue(workbench.y, 16, maxY)
  };
}

function normalizeImageOptions(
  options: ImageGenOptions | undefined,
  fallbackWithModel: boolean
): ImageGenOptions & { guidePriorityMode: NonNullable<ImageGenOptions["guidePriorityMode"]> } {
  return {
    style: options?.style ?? "studio",
    withModel: options?.withModel ?? fallbackWithModel,
    modelGender: options?.modelGender ?? "female",
    modelAgeRange: options?.modelAgeRange ?? "20s",
    modelCountry: options?.modelCountry ?? "korea",
    guidePriorityMode: options?.guidePriorityMode ?? "guide-first",
    headline: options?.headline,
    subheadline: options?.subheadline,
    isRegeneration: options?.isRegeneration,
    referenceModelImageBase64: options?.referenceModelImageBase64,
    referenceModelImageMimeType: options?.referenceModelImageMimeType,
    referenceModelImageFileName: options?.referenceModelImageFileName
  };
}

function normalizeSectionOptions(
  record: Record<number, ImageGenOptions>,
  referenceModelUsage: ReferenceModelUsage | null
) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {} as Record<number, ImageGenOptions>;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, options]) => [
      Number(key),
      normalizeImageOptions(options, referenceModelUsage === "all-sections" ? true : Number(key) === 0)
    ])
  ) as Record<number, ImageGenOptions>;
}

function normalizeSectionCopyFields(section: GeneratedResult["blueprint"]["sections"][number]) {
  const { on_image_text: _legacyOnImageText, ...rest } =
    section as GeneratedResult["blueprint"]["sections"][number] & { on_image_text?: string };

  return {
    ...rest,
    headline_en: section.headline_en || section.headline,
    subheadline_en: section.subheadline_en || section.subheadline,
    bullets_en: Array.isArray(section.bullets_en) && section.bullets_en.length ? section.bullets_en : section.bullets,
    trust_or_objection_line_en: section.trust_or_objection_line_en || section.trust_or_objection_line,
    CTA_en: section.CTA_en || section.CTA
  };
}

function getLocalizedCopy(korean: string, english: string | undefined, language: PdpCopyLanguage) {
  const copy = getUsableCopyPair(korean, english);
  if (!copy) return INSUFFICIENT_COPY_MESSAGE;
  return copy[language] || copy.ko;
}

function getLocalizedBullets(section: GeneratedResult["blueprint"]["sections"][number], language: PdpCopyLanguage) {
  if (language === "en" && Array.isArray(section.bullets_en) && section.bullets_en.length) {
    return section.bullets_en;
  }

  return section.bullets;
}

function getDisplaySectionName(section: GeneratedResult["blueprint"]["sections"][number]) {
  if (containsHangul(section.section_name)) {
    return section.section_name;
  }

  const normalized = section.section_name.replace(/^S\d+[_-]?/i, "");
  const tokens = normalized.split(/[_-]+/).filter(Boolean);

  if (!tokens.length) {
    return section.section_name;
  }

  const mappedTokens = tokens.map((token) => translateSectionToken(token));

  if (mappedTokens.length >= 2 && mappedTokens[0] === "베네핏" && /^\d+$/.test(tokens[1] ?? "")) {
    const descriptor = mappedTokens.slice(2).join(" ");
    return descriptor ? `베네핏 ${tokens[1]} · ${descriptor}` : `베네핏 ${tokens[1]}`;
  }

  return mappedTokens.join(" ");
}

function getDisplaySectionGoal(section: GeneratedResult["blueprint"]["sections"][number]) {
  if (containsHangul(section.goal)) {
    return section.goal;
  }

  if (containsHangul(section.headline)) {
    return section.headline;
  }

  if (containsHangul(section.subheadline)) {
    return section.subheadline;
  }

  return section.goal;
}

function getModelGenderLabel(gender?: ImageGenOptions["modelGender"]) {
  return gender === "male" ? "남자 모델" : "여자 모델";
}

function getModelAgeLabel(ageRange?: ImageGenOptions["modelAgeRange"]) {
  if (ageRange === "teen") {
    return "10대 후반";
  }
  if (ageRange === "30s") {
    return "30대";
  }
  if (ageRange === "40s") {
    return "40대";
  }
  if (ageRange === "50s_plus") {
    return "50대+";
  }

  return "20대";
}

function getModelCountryLabel(country?: ImageGenOptions["modelCountry"]) {
  if (country === "japan") {
    return "일본";
  }
  if (country === "usa") {
    return "미국";
  }
  if (country === "france") {
    return "프랑스";
  }
  if (country === "germany") {
    return "독일";
  }
  if (country === "africa") {
    return "아프리카";
  }

  return "한국";
}

function containsHangul(value: string) {
  return /[가-힣]/.test(value);
}

function translateSectionToken(token: string) {
  const normalized = token.trim().toLowerCase();

  if (normalized === "hero") {
    return "히어로";
  }
  if (normalized === "benefit") {
    return "베네핏";
  }
  if (normalized === "evidence") {
    return "근거";
  }
  if (normalized === "review" || normalized === "reviews") {
    return "후기";
  }
  if (normalized === "routine" || normalized === "howto" || normalized === "usage") {
    return "사용법";
  }
  if (normalized === "checklist") {
    return "체크리스트";
  }
  if (normalized === "cta") {
    return "구매 유도";
  }
  if (normalized === "windproof") {
    return "방풍";
  }
  if (normalized === "lightweight") {
    return "경량";
  }
  if (normalized === "style") {
    return "스타일";
  }
  if (normalized === "waterproof") {
    return "방수";
  }
  if (normalized === "comfort") {
    return "편안함";
  }
  if (normalized === "fit") {
    return "핏";
  }

  return /^\d+$/.test(token) ? token : token;
}
