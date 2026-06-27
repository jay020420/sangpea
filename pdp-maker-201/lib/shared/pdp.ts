export type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type PdpImageStyle = "studio" | "lifestyle" | "outdoor";
export type PdpModelGender = "female" | "male";
export type PdpModelAgeRange = "teen" | "20s" | "30s" | "40s" | "50s_plus";
export type PdpModelCountry = "korea" | "japan" | "usa" | "france" | "germany" | "africa";
export type PdpCopyLanguage = "ko" | "en";
export type ReferenceModelUsage = "hero-only" | "all-sections";
export type PdpGuidePriorityMode = "guide-first" | "style-first";
export type ReferenceImageRole = "primary" | "detail" | "proof" | "reference" | "optional_model";
export type PdpLayoutTemplate = "hero" | "problem" | "benefit" | "proof" | "spec" | "demo" | "use-case" | "faq-cta";
export type ImageProviderId = "openai-codex-oauth" | "flux" | "comfyui" | "qwen" | "sdxl";
export type ImageProviderCapability = "generate" | "edit" | "reference-image" | "layer-aware" | "local-runtime";
export type PdpEditableLayerKind = "background" | "product" | "text" | "shape" | "cta" | "proof" | "section";
export type PdpQualityMetricKey = "textReadability" | "ctaVisibility" | "mobileReadability" | "productExposure" | "whitespaceBalance" | "layerEditability";
export type PdpLayerNodeType = "frame" | "group" | "image" | "text" | "shape" | "cta" | "proof" | "product";
export type PdpLayerBoundsUnit = "px" | "percent";
export type PdpImageFit = "cover" | "contain" | "fill";
export type PdpDesignTemplateId =
  | "hero-product-focus"
  | "problem-checklist"
  | "benefit-card-grid"
  | "proof-spec-panel"
  | "demo-step-flow"
  | "usecase-split-scene"
  | "faq-final-cta";

export interface ProductBrief {
  productName: string;
  category: string;
  targetBuyer: string;
  useCases: string[];
  coreFeatures: string[];
  proofPoints: string[];
  constraints: string[];
  prohibitedClaims: string[];
  desiredTone: string;
  channel: string;
  isSoftware: boolean;
  needsHumanModel: boolean;
  confidence: "low" | "medium" | "high";
  missingInfo: string[];
}

export interface GenerationTraceStep {
  name: string;
  status: "ok" | "warning" | "error";
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  model?: string;
  ragDocuments?: string[];
  promptChars?: number;
  responseChars?: number;
  notes?: string[];
}

export interface GenerationTrace {
  runId: string;
  createdAt: string;
  stages: GenerationTraceStep[];
  debugPath?: string;
}

export interface CopyWarning {
  sectionId?: string;
  field?: string;
  message: string;
  severity: "warning" | "error";
}

export type PdpQualityStatus = "ready" | "needs_review" | "blocked";

export interface PdpQualityIssue {
  sectionId?: string;
  category: "story" | "copy" | "proof" | "visual" | "risk" | "input" | "readability" | "cta" | "mobile" | "composition" | "product";
  severity: "critical" | "major" | "minor";
  message: string;
  fix: string;
}

export interface PdpSectionQuality {
  sectionId: string;
  score: number;
  status: PdpQualityStatus;
  checks: string[];
  issues: PdpQualityIssue[];
}

export interface PdpQualityReport {
  overallScore: number;
  status: PdpQualityStatus;
  summary: string;
  strengths: string[];
  nextActions: string[];
  issues: PdpQualityIssue[];
  sections: PdpSectionQuality[];
}

export interface PdpImageQualityReport {
  score: number;
  status: PdpQualityStatus;
  summary: string;
  checks: string[];
  pdpChecks?: Partial<Record<PdpQualityMetricKey, PdpQualityMetric>>;
  issues: PdpQualityIssue[];
  nextActions: string[];
  attemptCount?: number;
  autoRegenerated?: boolean;
  rejectedAttempts?: Array<{
    score: number;
    status: PdpQualityStatus;
    summary: string;
  }>;
}

export interface PdpQualityMetric {
  score: number;
  status: PdpQualityStatus;
  note: string;
}

export interface PdpEditableLayer {
  id: string;
  kind: PdpEditableLayerKind;
  name: string;
  sectionId?: string;
  editable: boolean;
  role?: string;
  text?: string;
  zIndex?: number;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
    unit: "px" | "percent";
  };
}

export interface PdpLayeredDocument {
  version: 1;
  format: "pdp-layered-document";
  sections: Array<{
    sectionId: string;
    backgroundImageId?: string;
    layers: PdpEditableLayer[];
  }>;
}

export interface PdpLayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: PdpLayerBoundsUnit;
  rotation?: number;
}

export interface PdpLayerTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  color: string;
  align: "left" | "center" | "right";
}

export interface PdpLayerFill {
  color?: string;
  opacity?: number;
  imageAssetId?: string;
}

export interface PdpLayerNode {
  id: string;
  name: string;
  type: PdpLayerNodeType;
  visible: boolean;
  locked: boolean;
  editable: boolean;
  opacity?: number;
  role?: string;
  zIndex: number;
  bounds: PdpLayerBounds;
  text?: string;
  assetId?: string;
  imageFit?: PdpImageFit;
  fills?: PdpLayerFill[];
  cornerRadius?: number;
  textStyle?: PdpLayerTextStyle;
  children?: PdpLayerNode[];
}

export interface PdpLayerImageAsset {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  sourceRole: "original" | "reference" | "generated" | "product" | "background" | "shadow" | "decoration";
  sectionId?: string;
}

export interface PdpLayeredDocumentV2 {
  version: 2;
  format: "pdp-layered-document-v2";
  documentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  canvas: {
    width: number;
    height: number;
    unit: "px";
    aspectRatio?: AspectRatio;
  };
  assets: {
    images: PdpLayerImageAsset[];
  };
  styles: {
    colors: string[];
    textStyles: PdpLayerTextStyle[];
  };
  exportTargets: {
    figma: {
      pluginPayloadVersion: 1;
    };
  };
  sections: Array<{
    id: string;
    sectionId: string;
    name: string;
    templateId?: PdpDesignTemplateId;
    frameNodeId: string;
    nodes: PdpLayerNode[];
  }>;
}

export type PdpLayerPlanContext = Pick<PdpLayeredDocumentV2, "canvas" | "sections">;

export interface PdpReferenceImage {
  id?: string;
  name?: string;
  role?: ReferenceImageRole;
  mimeType: string;
  base64: string;
}

export interface ScorecardItem {
  category: string;
  score: string;
  reason: string;
}

export interface SectionBlueprint {
  section_id: string;
  section_name: string;
  layout_template?: PdpLayoutTemplate;
  design_template_id?: PdpDesignTemplateId;
  source_fact_refs?: string[];
  goal: string;
  headline: string;
  headline_en: string;
  subheadline: string;
  subheadline_en: string;
  bullets: string[];
  bullets_en: string[];
  trust_or_objection_line: string;
  trust_or_objection_line_en: string;
  CTA: string;
  CTA_en: string;
  layout_notes: string;
  compliance_notes: string;
  image_id: string;
  purpose: string;
  prompt_ko: string;
  prompt_en: string;
  negative_prompt: string;
  style_guide: string;
  reference_usage: string;
  story_role?: string;
  overlay_layout_hint?: string;
  quality_notes?: string;
  image_prompt_override?: string;
  editableLayers?: PdpEditableLayer[];
  generatedImage?: string;
  imageQualityReport?: PdpImageQualityReport;
  providerProof?: ProviderProof;
}

export interface LandingPageBlueprint {
  executiveSummary: string;
  scorecard: ScorecardItem[];
  blueprintList: string[];
  sections: SectionBlueprint[];
}

export interface GeneratedResult {
  originalImage: string;
  referenceImages?: PdpReferenceImage[];
  productDescription?: string;
  productBrief?: ProductBrief;
  generationTrace?: GenerationTrace;
  copyWarnings?: CopyWarning[];
  qualityReport?: PdpQualityReport;
  layeredDocument?: PdpLayeredDocument;
  layeredDocumentV2?: PdpLayeredDocumentV2;
  blueprint: LandingPageBlueprint;
  sourceMode?: "product" | "redesign";
  providerProof?: ProviderProof;
}

export interface ImageGenOptions {
  style: PdpImageStyle;
  withModel: boolean;
  modelGender?: PdpModelGender;
  modelAgeRange?: PdpModelAgeRange;
  modelCountry?: PdpModelCountry;
  guidePriorityMode?: PdpGuidePriorityMode;
  headline?: string;
  subheadline?: string;
  isRegeneration?: boolean;
  referenceModelImageBase64?: string;
  referenceModelImageMimeType?: string;
  referenceModelImageFileName?: string;
}

export interface PdpAnalyzeRequest {
  imageBase64?: string;
  mimeType?: string;
  referenceImages?: PdpReferenceImage[];
  modelImageBase64?: string;
  modelImageMimeType?: string;
  modelImageFileName?: string;
  productDescription?: string;
  additionalInfo?: string;
  desiredTone?: string;
  aspectRatio: AspectRatio;
}

export interface PdpAnalyzeSuccessResponse {
  ok: true;
  result: GeneratedResult;
}

export interface PdpGenerateImageRequest {
  originalImageBase64: string;
  referenceImages?: PdpReferenceImage[];
  section: SectionBlueprint;
  aspectRatio: AspectRatio;
  productDescription?: string;
  productBrief?: ProductBrief;
  sectionCopy?: {
    headline?: string;
    subheadline?: string;
    bullets?: string[];
    trustLine?: string;
    cta?: string;
  };
  layoutTemplate?: PdpLayoutTemplate;
  referenceImageIds?: string[];
  desiredTone?: string;
  options?: ImageGenOptions;
  layerPlan?: PdpLayerPlanContext;
}

export interface PdpGenerateImageSuccessResponse {
  ok: true;
  imageBase64: string;
  mimeType: string;
  imageQualityReport?: PdpImageQualityReport;
  providerProof?: ProviderProof;
}

export interface PdpImagePromptPreviewRequest extends PdpGenerateImageRequest {}

export interface PdpImagePromptPreviewSuccessResponse {
  ok: true;
  prompt: string;
  usingOverride: boolean;
}

export interface PdpFinalQualityRequest {
  imageBase64: string;
  mimeType: string;
  section: SectionBlueprint;
  aspectRatio: AspectRatio;
  productDescription?: string;
  productBrief?: ProductBrief;
  desiredTone?: string;
  backgroundQualityReport?: PdpImageQualityReport;
}

export interface PdpFinalQualitySuccessResponse {
  ok: true;
  imageQualityReport: PdpImageQualityReport;
}

export interface PdpValidateApiKeySuccessResponse {
  ok: true;
  message: string;
  analyzeModel: string;
  imageModel: string;
}

export interface ProviderProof {
  provider: ImageProviderId;
  resolvedProvider: ImageProviderId;
  model: string;
  authRoute: string;
  fallbackUsed: boolean;
  capabilities?: ImageProviderCapability[];
}

export type PdpErrorCode =
  | "CODEX_AUTH_MISSING"
  | "CODEX_AUTH_STALE"
  | "CODEX_MODEL_ACCESS_DENIED"
  | "CODEX_MODEL_NOT_FOUND"
  | "CODEX_USAGE_LIMIT"
  | "CODEX_RESPONSE_INVALID"
  | "INVALID_IMAGE_PAYLOAD"
  | "INVALID_REQUEST"
  | "PDP_ANALYZE_FAILED"
  | "PDP_IMAGE_GENERATION_FAILED";

export interface PdpErrorResponse {
  ok: false;
  code: PdpErrorCode;
  message: string;
  detail?: string;
}

export type PdpAnalyzeResponse = PdpAnalyzeSuccessResponse | PdpErrorResponse;
export type PdpGenerateImageResponse = PdpGenerateImageSuccessResponse | PdpErrorResponse;
export type PdpImagePromptPreviewResponse = PdpImagePromptPreviewSuccessResponse | PdpErrorResponse;
export type PdpFinalQualityResponse = PdpFinalQualitySuccessResponse | PdpErrorResponse;
export type PdpValidateApiKeyResponse = PdpValidateApiKeySuccessResponse | PdpErrorResponse;
