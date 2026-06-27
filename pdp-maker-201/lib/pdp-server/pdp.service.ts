import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  CODEX_IMAGE_MODEL,
  CODEX_TEXT_MODEL,
  CodexProviderError,
  extractJsonObject,
  generateTextWithCodex,
  getCodexAuthStatus
} from "../codex-oauth";
import { getImageProvider, type ImageProvider } from "../image-providers";
import { hasExpectedImageSignature } from "../image-validation";
import { humanizeKoreanCopy, type KoreanCopyKind } from "../korean-humanize";
import { buildKnowledgeContextWithSources } from "../local-rag";
import { createLayeredDocumentV2FromBlueprint } from "../pdp-layered-document";
import type {
  AspectRatio,
  CopyWarning,
  GeneratedResult,
  GenerationTrace,
  GenerationTraceStep,
  ImageGenOptions,
  LandingPageBlueprint,
  PdpAnalyzeRequest,
  PdpDesignTemplateId,
  PdpErrorCode,
  PdpEditableLayer,
  PdpFinalQualityRequest,
  PdpGenerateImageRequest,
  PdpImagePromptPreviewRequest,
  PdpImageQualityReport,
  PdpLayerNode,
  PdpLayerPlanContext,
  PdpLayeredDocument,
  PdpLayoutTemplate,
  PdpQualityIssue,
  PdpQualityMetric,
  PdpQualityMetricKey,
  PdpQualityReport,
  PdpQualityStatus,
  PdpReferenceImage,
  ProductBrief,
  ProviderProof,
  SectionBlueprint
} from "../shared";

const MAX_PRODUCT_REFERENCE_IMAGES = 20;
const MAX_ANALYSIS_IMAGES = 10;
const MAX_IMAGE_PAYLOAD_BYTES = 16 * 1024 * 1024;
const MAX_BLOCKED_IMAGE_AUTO_REGEN_ATTEMPTS = 2;
const IMAGE_AUTO_REGEN_SCORE_THRESHOLD = 72;
const COMBINED_ANALYSIS_TIMEOUT_MS = 110_000;
const STORY_COPY_REFINEMENT_TIMEOUT_MS = 60_000;
const SCHEMA_REPAIR_TIMEOUT_MS = 30_000;
const IMAGE_QUALITY_TIMEOUT_MS = 45_000;
const LAYOUT_TEMPLATES = ["hero", "problem", "benefit", "proof", "spec", "demo", "use-case", "faq-cta"] as const;
const ALLOWED_LAYOUT_TEMPLATE_TEXT = LAYOUT_TEMPLATES.join(", ");
const DESIGN_TEMPLATE_IDS = [
  "hero-product-focus",
  "problem-checklist",
  "benefit-card-grid",
  "proof-spec-panel",
  "demo-step-flow",
  "usecase-split-scene",
  "faq-final-cta"
] as const satisfies readonly PdpDesignTemplateId[];
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const StringArraySchema = z.preprocess((value) => {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    return value
      .split(/\r?\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}, z.array(z.string()).default([]));

const BooleanLikeSchema = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(true|yes|y|1|software|sw|saas)$/i.test(value.trim());
  return false;
}, z.boolean().default(false));

const ConfidenceSchema = z.preprocess((value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized;
  return "medium";
}, z.enum(["low", "medium", "high"]).default("medium"));

const ProductBriefSchema = z.object({
  productName: z.string().default(""),
  category: z.string().default(""),
  targetBuyer: z.string().default(""),
  useCases: StringArraySchema,
  coreFeatures: StringArraySchema,
  proofPoints: StringArraySchema,
  constraints: StringArraySchema,
  prohibitedClaims: StringArraySchema,
  desiredTone: z.string().default(""),
  channel: z.string().default("한국 모바일 커머스"),
  isSoftware: BooleanLikeSchema,
  needsHumanModel: BooleanLikeSchema,
  confidence: ConfidenceSchema,
  missingInfo: StringArraySchema
});

const ScorecardItemSchema = z.object({
  category: z.string().default(""),
  score: z.string().default(""),
  reason: z.string().default("")
});

const AssetSummarySchema = z.object({
  assetSummary: z.string().default(""),
  likelyProductName: z.string().default(""),
  likelyCategory: z.string().default(""),
  isSoftware: BooleanLikeSchema,
  visibleProductFacts: StringArraySchema,
  visualAssets: z
    .array(
      z.object({
        id: z.string().default(""),
        role: z.string().default("reference"),
        observedFacts: StringArraySchema,
        cautions: StringArraySchema
      })
    )
    .default([]),
  missingInfo: StringArraySchema,
  complianceRisks: StringArraySchema
});

const SectionPlanSchema = z.object({
  executiveSummary: z.string().default(""),
  scorecard: z.array(ScorecardItemSchema).default([]),
  sections: z
    .array(
      z.object({
        section_id: z.string().default(""),
        section_name: z.string().default(""),
        layout_template: z.string().default("benefit"),
        goal: z.string().default(""),
        purpose: z.string().default(""),
        source_fact_refs: StringArraySchema
      })
    )
    .default([])
});

const SectionBlueprintSchema = z.object({
  section_id: z.string().default(""),
  section_name: z.string().default(""),
  layout_template: z.string().optional(),
  design_template_id: z.string().optional(),
  source_fact_refs: StringArraySchema.optional().default([]),
  goal: z.string().default(""),
  headline: z.string().default(""),
  headline_en: z.string().default(""),
  subheadline: z.string().default(""),
  subheadline_en: z.string().default(""),
  bullets: StringArraySchema,
  bullets_en: StringArraySchema,
  trust_or_objection_line: z.string().default(""),
  trust_or_objection_line_en: z.string().default(""),
  CTA: z.string().default(""),
  CTA_en: z.string().default(""),
  layout_notes: z.string().default(""),
  compliance_notes: z.string().default(""),
  image_id: z.string().default(""),
  purpose: z.string().default(""),
  prompt_ko: z.string().default(""),
  prompt_en: z.string().default(""),
  negative_prompt: z.string().default(""),
  style_guide: z.string().default(""),
  reference_usage: z.string().default(""),
  story_role: z.string().default(""),
  overlay_layout_hint: z.string().default(""),
  quality_notes: z.string().default(""),
  image_prompt_override: z.string().default("")
});

const BlueprintSchema = z.object({
  executiveSummary: z.string().default(""),
  scorecard: z.array(ScorecardItemSchema).default([]),
  sections: z.array(SectionBlueprintSchema).default([])
});

const CombinedAnalysisSchema = z.object({
  assetSummary: AssetSummarySchema,
  productBrief: ProductBriefSchema,
  blueprint: BlueprintSchema
});

const RefinedCopySectionSchema = z.object({
  section_id: z.string().default(""),
  headline: z.string().default(""),
  headline_en: z.string().default(""),
  subheadline: z.string().default(""),
  subheadline_en: z.string().default(""),
  bullets: StringArraySchema,
  bullets_en: StringArraySchema,
  trust_or_objection_line: z.string().default(""),
  trust_or_objection_line_en: z.string().default(""),
  CTA: z.string().default(""),
  CTA_en: z.string().default(""),
  story_role: z.string().default(""),
  copy_reason: z.string().default("")
});

const StoryCopyRefinementSchema = z.object({
  storySummary: z.string().default(""),
  sections: z.array(RefinedCopySectionSchema).default([]),
  warnings: StringArraySchema
});

const QualityIssueCategorySchema = z.preprocess((value) => {
  const normalized = String(value ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (/(cta|button|calltoaction)/.test(normalized)) return "cta";
  if (/(mobile|viewport|smallscreen)/.test(normalized)) return "mobile";
  if (/(readability|legibility|contrast|fontsize|type)/.test(normalized)) return "readability";
  if (/(product|exposure|subject|package|screen|ui)/.test(normalized)) return "product";
  if (/(composition|layout|whitespace|balance|safezone|overlay)/.test(normalized)) return "composition";
  if (/(story|flow|conversion)/.test(normalized)) return "story";
  if (/(copy|text|headline)/.test(normalized)) return "copy";
  if (/(proof|trust|truth|source|factual|producttruthfulness|claim)/.test(normalized)) return "proof";
  if (/(visual|image|blur|sharp|focus|crop|poster)/.test(normalized)) return "visual";
  if (/(risk|compliance|invent|unsupported|misleading)/.test(normalized)) return "risk";
  if (/(input|brief|missing)/.test(normalized)) return "input";
  return "visual";
}, z.enum(["story", "copy", "proof", "visual", "risk", "input", "readability", "cta", "mobile", "composition", "product"]).default("visual"));

const ImageQualityIssueSchema = z.object({
  category: QualityIssueCategorySchema,
  severity: z.enum(["critical", "major", "minor"]).default("minor"),
  message: z.string().default(""),
  fix: z.string().default("")
});

const QualityMetricSchema = z.object({
  score: z.number().default(70),
  status: z.enum(["ready", "needs_review", "blocked"]).default("needs_review"),
  note: z.string().default("")
});

const ImageQualityReportSchema = z.object({
  score: z.number().default(70),
  status: z.enum(["ready", "needs_review", "blocked"]).default("needs_review"),
  summary: z.string().default(""),
  checks: StringArraySchema,
  pdpChecks: z
    .object({
      textReadability: QualityMetricSchema.optional(),
      ctaVisibility: QualityMetricSchema.optional(),
      mobileReadability: QualityMetricSchema.optional(),
      productExposure: QualityMetricSchema.optional(),
      whitespaceBalance: QualityMetricSchema.optional(),
      layerEditability: QualityMetricSchema.optional()
    })
    .optional()
    .default({}),
  issues: z.array(ImageQualityIssueSchema).default([]),
  nextActions: StringArraySchema
});

type AssetSummary = z.infer<typeof AssetSummarySchema>;
type SectionPlan = z.infer<typeof SectionPlanSchema>;
type BlueprintJson = z.infer<typeof BlueprintSchema>;
type CombinedAnalysisJson = z.infer<typeof CombinedAnalysisSchema>;
type StoryCopyRefinementJson = z.infer<typeof StoryCopyRefinementSchema>;
type ImageQualityReportJson = z.infer<typeof ImageQualityReportSchema>;
type NormalizableSection = Partial<Omit<SectionBlueprint, "layout_template" | "design_template_id" | "source_fact_refs" | "bullets" | "bullets_en">> & {
  layout_template?: unknown;
  design_template_id?: unknown;
  source_fact_refs?: unknown;
  bullets?: unknown;
  bullets_en?: unknown;
};

type KnowledgeBundle = {
  analysis: string;
  copy: string;
  image: string;
  compliance: string;
  sourcesByStage: Record<string, string[]>;
};

export class PdpServiceError extends Error {
  constructor(
    readonly code: PdpErrorCode,
    message: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = "PdpServiceError";
  }
}

export class PdpService {
  constructor(private readonly imageProvider: ImageProvider = getImageProvider()) {}

  async validateCodexOAuth() {
    const status = await getCodexAuthStatus();
    if (!status.ok) {
      throw new PdpServiceError("CODEX_AUTH_MISSING", status.message, status.authCandidates.join(", "));
    }
    return {
      message: "Codex OAuth auth.json을 확인했습니다.",
      analyzeModel: CODEX_TEXT_MODEL,
      imageModel: CODEX_IMAGE_MODEL
    };
  }

  async analyzeProduct(request: PdpAnalyzeRequest) {
    const runId = crypto.randomUUID();
    const trace = createGenerationTrace(runId);
    let textProviderProof: ProviderProof | undefined;
    const debugPayload: Record<string, unknown> = {
      runId,
      request: {
        aspectRatio: request.aspectRatio,
        hasProductDescription: Boolean(request.productDescription?.trim()),
        hasAdditionalInfo: Boolean(request.additionalInfo?.trim())
      }
    };

    try {
      const references = normalizePdpReferenceImages(request);
      if (!references.length) {
        throw new PdpServiceError("INVALID_IMAGE_PAYLOAD", "제품 이미지, SW 화면 또는 참조 이미지를 1장 이상 업로드해 주세요.");
      }

      const primaryReference = references[0];
      const originalImage = toDataUrl(primaryReference.mimeType, sanitizeBase64Payload(primaryReference.base64));
      const productDescription = normalizePromptText(request.productDescription);
      const additionalInfo = normalizePromptText(request.additionalInfo);
      const analysisImages = selectAnalysisImages(references).map(({ base64, mimeType }) => ({ base64, mimeType }));
      if (request.modelImageBase64 && request.modelImageMimeType) {
        analysisImages.push(validateImagePayload(request.modelImageBase64, request.modelImageMimeType, "선택 모델 이미지"));
      }

      const knowledge = await runTraceStage(trace, "stage-rag-retrieval", async (step) => {
        const bundle = await buildStageKnowledgeBundle({
          productDescription,
          additionalInfo,
          desiredTone: request.desiredTone,
          aspectRatio: request.aspectRatio,
          references
        });
        step.ragDocuments = Object.values(bundle.sourcesByStage).flat();
        step.notes = [`${new Set(step.ragDocuments).size} unique RAG sources selected`];
        return bundle;
      });

      const { combinedAnalysis, providerProof } = await runSeparatedPdpAnalysis({
        trace,
        runId,
        debugPayload,
        productDescription,
        additionalInfo,
        desiredTone: request.desiredTone,
        aspectRatio: request.aspectRatio,
        references,
        analysisImages,
        knowledge
      });
      textProviderProof = providerProof;

      const assetSummary = combinedAnalysis.assetSummary;
      const productBrief = normalizeProductBrief(combinedAnalysis.productBrief, assetSummary, request.desiredTone);
      const sectionPlan = blueprintToSectionPlan(combinedAnalysis.blueprint);
      debugPayload.assetSummary = assetSummary;
      debugPayload.productBrief = productBrief;
      debugPayload.sectionPlan = sectionPlan;

      const rawBlueprint = normalizeBlueprint(combinedAnalysis.blueprint, request.aspectRatio, sectionPlan);
      const refinedCopyResult = await runTraceStage(trace, "stage-5-story-copy-refinement", async (step) => {
        const prompt = buildStoryCopyRefinementPrompt({
          blueprint: rawBlueprint,
          productBrief,
          assetSummary,
          productDescription,
          additionalInfo,
          desiredTone: request.desiredTone,
          aspectRatio: request.aspectRatio
        });
        step.model = CODEX_TEXT_MODEL;
        step.promptChars = prompt.length;
        step.notes = [
          "Rewrites visible copy after structure planning so user notes do not pass through as finished PDP copy."
        ];

        try {
          const { text } = await generateTextWithCodex({
            prompt,
            timeoutMs: STORY_COPY_REFINEMENT_TIMEOUT_MS
          });
          step.responseChars = text.length;
          const parsed = await parseJsonWithSchema({
            text,
            schema: StoryCopyRefinementSchema,
            schemaName: "PDP story/copy refinement",
            runId,
            stage: step.name,
            repairShape: STORY_COPY_REFINEMENT_REPAIR_SHAPE,
            debugPayload
          });

          const blueprint = mergeRefinedCopyIntoBlueprint(rawBlueprint, parsed, productBrief, {
            productDescription,
            additionalInfo
          });
          step.notes = [
            ...(step.notes ?? []),
            `${parsed.sections.length} refined copy sections returned`,
            ...parsed.warnings.map((warning) => `copy note: ${warning}`).slice(0, 4)
          ];
          return {
            blueprint,
            warnings: parsed.warnings.map((message) => ({
              field: "copy_refinement",
              severity: "warning" as const,
              message
            }))
          };
        } catch (error) {
          step.status = "warning";
          step.notes = [
            ...(step.notes ?? []),
            `warning: model copy refinement failed; deterministic rewrite applied. ${formatError(error)}`
          ];
          return {
            blueprint: refineBlueprintCopyDeterministically(rawBlueprint, productBrief, assetSummary, {
              productDescription,
              additionalInfo
            }),
            warnings: [
              {
                field: "copy_refinement",
                severity: "warning" as const,
                message: "AI 카피 정제 응답이 실패해 상품 브리프 기준의 안전한 짧은 카피로 대체했습니다."
              }
            ]
          };
        }
      });

      let { sanitizedBlueprint, warnings } = validateAndSanitizeCopy(refinedCopyResult.blueprint, productBrief, {
        productDescription,
        additionalInfo
      });
      const copyWarnings = [...refinedCopyResult.warnings, ...warnings];
      const qualityReport = await runTraceStage(trace, "stage-6-quality-gate", async (step) => {
        let report = buildPdpQualityReport({
          blueprint: sanitizedBlueprint,
          productBrief,
          copyWarnings,
          productDescription,
          additionalInfo
        });

        if (report.status === "blocked") {
          const initialScore = report.overallScore;
          const repairedBlueprint = refineBlueprintCopyDeterministically(sanitizedBlueprint, productBrief, assetSummary, {
            productDescription,
            additionalInfo
          });
          const repaired = validateAndSanitizeCopy(repairedBlueprint, productBrief, {
            productDescription,
            additionalInfo
          });
          sanitizedBlueprint = repaired.sanitizedBlueprint;
          warnings = [...warnings, ...repaired.warnings];
          copyWarnings.push(...repaired.warnings);
          report = buildPdpQualityReport({
            blueprint: sanitizedBlueprint,
            productBrief,
            copyWarnings,
            productDescription,
            additionalInfo
          });
          step.status = report.status === "ready" ? "ok" : "warning";
          step.notes = [
            `warning: initial quality gate blocked at ${initialScore}; repaired score is ${report.overallScore}.`,
            "Low-quality copy was replaced with conservative section-role copy."
          ];
        } else {
          step.status = report.status === "ready" ? "ok" : "warning";
          step.notes = [`Quality gate ${report.status} at ${report.overallScore}.`];
        }

        return report;
      });
      debugPayload.copyWarnings = copyWarnings;
      debugPayload.qualityReport = qualityReport;

      const debugPath = await writeRunDebug(runId, {
        ...debugPayload,
        trace,
        copyWarnings,
        qualityReport
      });
      trace.debugPath = debugPath;

      return {
        originalImage,
        referenceImages: references,
        productDescription,
        productBrief,
        generationTrace: trace,
        copyWarnings,
        qualityReport,
        blueprint: sanitizedBlueprint,
        layeredDocument: buildLayeredDocument(sanitizedBlueprint),
        layeredDocumentV2: createLayeredDocumentV2FromBlueprint({
          title: productBrief.productName || "PDP layered document",
          blueprint: sanitizedBlueprint,
          originalImage,
          referenceImages: references,
          aspectRatio: request.aspectRatio
        }),
        sourceMode: "product" as const,
        providerProof: textProviderProof
      } satisfies GeneratedResult;
    } catch (error) {
      const debugPath = await writeRunDebug(runId, {
        ...debugPayload,
        trace,
        error: formatError(error)
      });

      const fallbackResult = buildAnalyzeFallbackResult(request, trace, debugPath, error);
      if (fallbackResult) {
        return fallbackResult;
      }

      if (error instanceof PdpServiceError) {
        throw new PdpServiceError(error.code, error.message, [error.detail, `debug: ${debugPath}`].filter(Boolean).join("; "));
      }
      throw error;
    }
  }

  async generateSectionImage(request: PdpGenerateImageRequest) {
    const { prompt, references, productBrief, layerPlanPrompt } = await buildSectionImagePromptBundle(request);

    const firstCandidate = await generateAndEvaluateSectionImage({
      imageProvider: this.imageProvider,
      prompt,
      references,
      section: request.section,
      aspectRatio: request.aspectRatio,
      productBrief,
      desiredTone: request.desiredTone,
      layerPlanPrompt
    });
    const candidates = [firstCandidate];

    if (shouldAutoRegenerateImage(firstCandidate.imageQualityReport)) {
      for (let attempt = 1; attempt <= MAX_BLOCKED_IMAGE_AUTO_REGEN_ATTEMPTS; attempt += 1) {
        const repairPrompt = buildImageRepairPrompt({
          basePrompt: prompt,
          failedReport: candidates[candidates.length - 1].imageQualityReport,
          attempt
        });
        const repairedCandidate = await generateAndEvaluateSectionImage({
          imageProvider: this.imageProvider,
          prompt: repairPrompt,
          references,
          section: request.section,
          aspectRatio: request.aspectRatio,
          productBrief,
          desiredTone: request.desiredTone,
          layerPlanPrompt
        });
        candidates.push(repairedCandidate);
        if (!shouldAutoRegenerateImage(repairedCandidate.imageQualityReport)) break;
      }
    }

    const bestCandidate = chooseBestImageCandidate(candidates);
    const imageQualityReport = annotateImageQualityAttempt(bestCandidate.imageQualityReport, candidates, bestCandidate);

    return {
      imageBase64: bestCandidate.imageBase64,
      mimeType: bestCandidate.mimeType,
      imageQualityReport,
      providerProof: bestCandidate.providerProof
    };
  }

  async buildSectionImagePromptPreview(request: PdpImagePromptPreviewRequest) {
    const { prompt, usingOverride } = await buildSectionImagePromptBundle(request);
    return {
      prompt,
      usingOverride
    };
  }

  async evaluateFinalCompositeImage(request: PdpFinalQualityRequest) {
    if (!request?.section || typeof request.section !== "object") {
      throw new PdpServiceError("INVALID_REQUEST", "최종 검수할 섹션 정보가 없습니다.");
    }

    const validated = validateImagePayload(request.imageBase64, request.mimeType, "최종 합성 이미지");
    const productBrief = normalizeRequestProductBrief(request.productBrief, request.productDescription, request.desiredTone);

    return evaluateGeneratedSectionImage({
      imageBase64: validated.base64,
      mimeType: validated.mimeType,
      section: request.section,
      aspectRatio: request.aspectRatio,
      productBrief,
      desiredTone: request.desiredTone,
      mode: "final-composite",
      backgroundQualityReport: request.backgroundQualityReport
    });
  }
}

async function buildStageKnowledgeBundle(input: {
  productDescription: string;
  additionalInfo: string;
  desiredTone?: string;
  aspectRatio: AspectRatio;
  references: PdpReferenceImage[];
}): Promise<KnowledgeBundle> {
  const base = [
    input.productDescription,
    input.additionalInfo,
    input.desiredTone || "",
    input.references.map((reference) => `${reference.name || reference.id} ${roleLabel(reference.role)}`).join("\n")
  ]
    .filter(Boolean)
    .join("\n");

  const queries = {
    analysis: [
      "한국 상세페이지 제품 이해 구매심리 채널 구조 카테고리 법적 위험 제품 사실 보존",
      "SW SaaS 앱 상세페이지 대상 사용자 업무 문제 기능 데모 보안 개인정보",
      base
    ].join("\n"),
    copy: [
      "한국어 상세페이지 카피 짧은 헤드라인 구매 이유 신뢰 실사용감 과장광고 방지",
      "상품명 카테고리 사용상황 연결 카피라이팅 스마트스토어 쿠팡 모바일",
      base
    ].join("\n"),
    image: [
      "한국 상세페이지 섹션 이미지 생성 제품 보존 앱 합성 텍스트 고대비 영역 포스터 금지",
      "Hero Problem Benefit Proof Spec Demo FAQ 모바일 세로 구도 SW 스크린샷 목업",
      base
    ].join("\n"),
    compliance: [
      "상세페이지 제품 기능 과장 방지 의약 건기식 효능 가격 공식 로고 금지 리뷰 인증 수치형 신뢰 카피 허용",
      base
    ].join("\n")
  };

  const fallback = [
    "User-provided product facts are the source of truth. RAG must not invent product claims.",
    "Use RAG only for structure, tone, layout, image direction, and risk wording.",
    input.productDescription ? `User facts:\n${input.productDescription}` : "",
    input.additionalInfo ? `User direction:\n${input.additionalInfo}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const [analysis, copy, image, compliance] = await Promise.all([
    buildKnowledgeContextWithSources(queries.analysis, fallback),
    buildKnowledgeContextWithSources(queries.copy, fallback),
    buildKnowledgeContextWithSources(queries.image, fallback),
    buildKnowledgeContextWithSources(queries.compliance, fallback)
  ]);

  return {
    analysis: analysis.text,
    copy: copy.text,
    image: image.text,
    compliance: compliance.text,
    sourcesByStage: {
      analysis: analysis.sources,
      copy: copy.sources,
      image: image.sources,
      compliance: compliance.sources
    }
  };
}

async function runSeparatedPdpAnalysis(input: {
  trace: GenerationTrace;
  runId: string;
  debugPayload: Record<string, unknown>;
  productDescription: string;
  additionalInfo: string;
  desiredTone?: string;
  aspectRatio: AspectRatio;
  references: PdpReferenceImage[];
  analysisImages: Array<{ base64: string; mimeType: string }>;
  knowledge: KnowledgeBundle;
}): Promise<{ combinedAnalysis: CombinedAnalysisJson; providerProof?: ProviderProof }> {
  let providerProof: ProviderProof | undefined;

  const assetSummary = await runTraceStage(input.trace, "stage-1-asset-summary", async (step) => {
    const prompt = buildAssetSummaryPrompt({
      productDescription: input.productDescription,
      additionalInfo: input.additionalInfo,
      desiredTone: input.desiredTone,
      references: input.references,
      analyzedImageCount: input.analysisImages.length
    });
    step.model = CODEX_TEXT_MODEL;
    step.promptChars = prompt.length;
    step.ragDocuments = input.knowledge.sourcesByStage.analysis;
    step.notes = ["Separated analysis stage to keep the model response short and avoid truncated JSON."];
    const { text, providerProof: proof } = await generateTextWithCodex({
      prompt,
      images: input.analysisImages,
      timeoutMs: COMBINED_ANALYSIS_TIMEOUT_MS
    });
    providerProof = proof;
    step.model = proof.model;
    step.responseChars = text.length;
    return parseJsonWithSchema({
      text,
      schema: AssetSummarySchema,
      schemaName: "PDP asset summary",
      runId: input.runId,
      stage: step.name,
      repairShape: ASSET_SUMMARY_REPAIR_SHAPE,
      debugPayload: input.debugPayload
    });
  });

  const productBrief = await runTraceStage(input.trace, "stage-2-product-brief", async (step) => {
    const prompt = buildProductBriefPrompt({
      productDescription: input.productDescription,
      additionalInfo: input.additionalInfo,
      desiredTone: input.desiredTone,
      references: input.references,
      assetSummary,
      knowledgeText: input.knowledge.analysis
    });
    step.model = CODEX_TEXT_MODEL;
    step.promptChars = prompt.length;
    step.ragDocuments = input.knowledge.sourcesByStage.analysis;
    const { text, providerProof: proof } = await generateTextWithCodex({
      prompt,
      timeoutMs: STORY_COPY_REFINEMENT_TIMEOUT_MS
    });
    providerProof = providerProof ?? proof;
    step.model = proof.model;
    step.responseChars = text.length;
    const parsed = await parseJsonWithSchema({
      text,
      schema: ProductBriefSchema,
      schemaName: "PDP product brief",
      runId: input.runId,
      stage: step.name,
      repairShape: PRODUCT_BRIEF_REPAIR_SHAPE,
      debugPayload: {
        ...input.debugPayload,
        assetSummary
      }
    });
    return normalizeProductBrief(parsed, assetSummary, input.desiredTone);
  });

  const sectionPlan = await runTraceStage(input.trace, "stage-3-section-plan", async (step) => {
    const prompt = buildSectionPlanPrompt({
      productBrief,
      assetSummary,
      additionalInfo: input.additionalInfo,
      aspectRatio: input.aspectRatio,
      references: input.references,
      knowledgeText: input.knowledge.copy
    });
    step.model = CODEX_TEXT_MODEL;
    step.promptChars = prompt.length;
    step.ragDocuments = input.knowledge.sourcesByStage.copy;
    const { text, providerProof: proof } = await generateTextWithCodex({
      prompt,
      timeoutMs: STORY_COPY_REFINEMENT_TIMEOUT_MS
    });
    providerProof = providerProof ?? proof;
    step.model = proof.model;
    step.responseChars = text.length;
    return parseJsonWithSchema({
      text,
      schema: SectionPlanSchema,
      schemaName: "PDP section plan",
      runId: input.runId,
      stage: step.name,
      repairShape: SECTION_PLAN_REPAIR_SHAPE,
      debugPayload: {
        ...input.debugPayload,
        assetSummary,
        productBrief
      }
    });
  });

  let blueprint: BlueprintJson;
  try {
    blueprint = await runTraceStage(input.trace, "stage-4-copy-prompt-pack", async (step) => {
      const prompt = buildCopyPromptPackPrompt({
        productBrief,
        assetSummary,
        sectionPlan,
        additionalInfo: input.additionalInfo,
        desiredTone: input.desiredTone,
        aspectRatio: input.aspectRatio,
        references: input.references,
        knowledgeText: [input.knowledge.copy, input.knowledge.image, input.knowledge.compliance].join("\n\n")
      });
      step.model = CODEX_TEXT_MODEL;
      step.promptChars = prompt.length;
      step.ragDocuments = [...input.knowledge.sourcesByStage.copy, ...input.knowledge.sourcesByStage.image, ...input.knowledge.sourcesByStage.compliance];
      const { text, providerProof: proof } = await generateTextWithCodex({
        prompt,
        timeoutMs: COMBINED_ANALYSIS_TIMEOUT_MS
      });
      providerProof = providerProof ?? proof;
      step.model = proof.model;
      step.responseChars = text.length;
      return parseJsonWithSchema({
        text,
        schema: BlueprintSchema,
        schemaName: "PDP copy and image prompt pack",
        runId: input.runId,
        stage: step.name,
        repairShape: BLUEPRINT_REPAIR_SHAPE,
        debugPayload: {
          ...input.debugPayload,
          assetSummary,
          productBrief,
          sectionPlan
        }
      });
    });
  } catch (error) {
    const now = new Date().toISOString();
    input.trace.stages.push({
      name: "stage-4-copy-prompt-pack-deterministic",
      status: "warning",
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      notes: [
        "AI copy/prompt pack failed; product-specific deterministic copy was generated from the asset summary, product brief, and section plan.",
        formatError(error)
      ]
    });
    blueprint = buildDeterministicBlueprintFromSectionPlan(sectionPlan, input.aspectRatio, productBrief, assetSummary, {
      productDescription: input.productDescription,
      additionalInfo: input.additionalInfo
    });
  }

  return {
    combinedAnalysis: {
      assetSummary,
      productBrief,
      blueprint
    },
    providerProof
  };
}

async function parseJsonWithSchema<T>({
  text,
  schema,
  schemaName,
  runId,
  stage,
  repairShape,
  debugPayload
}: {
  text: string;
  schema: z.ZodType<T>;
  schemaName: string;
  runId: string;
  stage: string;
  repairShape: unknown;
  debugPayload: Record<string, unknown>;
}): Promise<T> {
  try {
    return parseJsonCandidate(text, schema);
  } catch (initialError) {
    await writeRunDebug(`${runId}-${stage}-initial-parse-failed`, {
      ...debugPayload,
      stage,
      schemaName,
      error: formatError(initialError),
      responseLength: text.length,
      responsePreview: text.slice(0, 60000)
    });

    if (!text.trim()) {
      throw new PdpServiceError(
        "PDP_ANALYZE_FAILED",
        `${schemaName} 단계에서 AI 응답이 비어 있습니다. 기본 템플릿으로 진행하지 않았습니다.`,
        `${stage}: ${formatError(initialError)}`
      );
    }

    try {
      const { text: repairedText } = await generateTextWithCodex({
        prompt: buildSchemaRepairPrompt({ schemaName, rawText: text, repairShape }),
        timeoutMs: SCHEMA_REPAIR_TIMEOUT_MS
      });
      return parseJsonCandidate(repairedText, schema);
    } catch (repairError) {
      const debugPath = await writeRunDebug(`${runId}-${stage}-repair-failed`, {
        ...debugPayload,
        stage,
        schemaName,
        initialError: formatError(initialError),
        repairError: formatError(repairError),
        responseLength: text.length,
        responsePreview: text.slice(0, 60000)
      });

      throw new PdpServiceError(
        "PDP_ANALYZE_FAILED",
        `${schemaName} 단계의 JSON 검증에 실패했습니다. 기본 구성을 사용하지 않았으니 상품 설명을 보강한 뒤 다시 분석해 주세요.`,
        `${stage}: initial=${formatError(initialError)}; repair=${formatError(repairError)}; debug=${debugPath}`
      );
    }
  }
}

function parseJsonCandidate<T>(text: string, schema: z.ZodType<T>): T {
  const parsed = extractJsonObject<unknown>(text);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(z.prettifyError(result.error));
  }
  return result.data;
}

function buildSchemaRepairPrompt(input: { schemaName: string; rawText: string; repairShape: unknown }) {
  return [
    `Convert the following ${input.schemaName} response into one strict JSON object only.`,
    "Do not add explanations, markdown fences, comments, single-quoted strings, or trailing commas.",
    "Keep user-provided product facts. You may create marketing social-proof copy such as reviews, certifications, and numeric claims, but do not invent product functions, software integrations, pricing, medical effects, official logos, customer logos, or dashboard data.",
    "If a string field is unknown, use an empty string. If an array field is unknown, use an empty array.",
    `For layout_template, use exactly one of: ${ALLOWED_LAYOUT_TEMPLATE_TEXT}. Map close variants such as feature-benefit or selection_reason to benefit, proof-spec to proof, demo-steps to demo, faq/final-cta/objection_handling to faq-cta.`,
    "If optional story_role or overlay_layout_hint fields exist, keep them concise. story_role should be one of hook, problem, benefit, reason, proof, demo, usecase, cta.",
    "Required JSON shape:",
    JSON.stringify(input.repairShape, null, 2),
    "Source response:",
    input.rawText.slice(0, 60000)
  ].join("\n");
}

function buildAssetSummaryPrompt(input: {
  productDescription: string;
  additionalInfo: string;
  desiredTone?: string;
  references: PdpReferenceImage[];
  analyzedImageCount: number;
}) {
  return [
    "Analyze the uploaded assets for a Korean mobile commerce detail page.",
    "This is stage 1: source fact extraction only. Do not write marketing copy yet.",
    "User-written product facts are highest priority. Images verify and enrich them, but do not override clear user text unless the image directly contradicts it.",
    input.productDescription ? `USER PRODUCT DESCRIPTION / FACTS:\n${input.productDescription}` : "USER PRODUCT DESCRIPTION / FACTS: not provided",
    input.additionalInfo ? `USER CREATIVE DIRECTION:\n${input.additionalInfo}` : "",
    input.desiredTone ? `Desired tone: ${input.desiredTone}` : "",
    `Uploaded assets: ${input.references.length}; images sent to this analysis call: ${input.analyzedImageCount}`,
    buildAssetInventory(input.references),
    "Classify whether this is software/SaaS/app/web service. If it is software, focus on screens, flows, dashboards, onboarding, security/support, and do not require a human model.",
    "Return only one strict JSON object with this shape:",
    JSON.stringify(ASSET_SUMMARY_REPAIR_SHAPE, null, 2)
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCombinedAnalyzePrompt(input: {
  productDescription: string;
  additionalInfo: string;
  desiredTone?: string;
  aspectRatio: AspectRatio;
  references: PdpReferenceImage[];
  analyzedImageCount: number;
  knowledgeText: string;
}) {
  return [
    "Create a complete Korean mobile PDP generation plan in one strict JSON object.",
    "Think through four logical stages internally, but return only the final JSON: 1 source fact extraction, 2 product brief, 3 section plan, 4 final app-composited copy and image prompt pack.",
    "User-written product facts are highest priority as raw notes, not finished marketing copy. Uploaded images verify and enrich them. RAG is only structure, tone, layout, and risk guidance; it must not invent product facts.",
    "Do not copy USER PRODUCT DESCRIPTION or USER CREATIVE DIRECTION verbatim into headline, subheadline, bullets, trust line, or CTA. Extract the facts, sharpen the value, and rewrite into concise customer-facing Korean copy.",
    input.productDescription ? `USER PRODUCT DESCRIPTION / FACTS:\n${input.productDescription}` : "USER PRODUCT DESCRIPTION / FACTS: not provided. Be conservative.",
    input.additionalInfo ? `USER CREATIVE DIRECTION:\n${input.additionalInfo}` : "USER CREATIVE DIRECTION: none",
    input.desiredTone ? `Desired tone: ${input.desiredTone}` : "",
    `Aspect ratio: ${input.aspectRatio}`,
    `Uploaded assets: ${input.references.length}; images sent to this call: ${input.analyzedImageCount}`,
    `ASSET INVENTORY:\n${buildAssetInventory(input.references)}`,
    input.knowledgeText ? `RAG GUIDANCE:\n${input.knowledgeText.slice(0, 32000)}` : "",
    "The result must be a real Korean ecommerce/product detail page, not a poster or social ad.",
    "Create 6 to 8 sections with a deliberate conversion architecture in this order: source fact extraction -> customer problem -> choice reason -> proof/numeric/review-style trust -> usage flow -> anxiety handling -> final CTA. Avoid repeating the same persuasion role twice.",
    `For every blueprint.sections[].layout_template, use exactly one of: ${ALLOWED_LAYOUT_TEMPLATE_TEXT}. Do not invent variants like feature-benefit, proof-spec, demo-steps, selection_reason, objection_handling, or final-cta.`,
    "For software/SaaS/app/web service, set productBrief.isSoftware true, productBrief.needsHumanModel false, and use screenshots, dashboard frames, workflows, onboarding, support/security, and practical adoption reasons.",
    "For physical products, preserve product shape, color, package, material, components, proof/detail assets, and realistic use scenes.",
    "Every headline must connect to productName, category, targetBuyer, useCases, coreFeatures, proofPoints, support/AS, workflow, or a user-provided constraint. Prefer concrete Korean conversion copy over abstract brand slogans.",
    "Copy must be rewritten and tightened for final app-composited text: headline 8-22 Korean characters when possible, subheadline 24-44 characters, each bullet 8-18 characters, CTA 4-10 characters. One idea per line.",
    "Never use section names or placeholders as customer-facing copy: 히어로, 베네핏, 문제 공감, CTA, 한국어 헤드라인, 불릿 1 are invalid copy.",
    "Reviews, certifications, badges, and numeric proof-style copy may be drafted as marketing copy when useful. Do not invent product functions, software integrations, pricing, medical effects, official logos, customer logos, security/compliance capabilities, or dashboard data.",
    "Image prompts must explicitly ask for sharp section artwork with calm high-contrast areas where the app will composite the final Korean copy. Do not ask the image model to render readable Korean marketing text.",
    "Return only one strict JSON object. No markdown fences, no prose, no comments, no trailing commas.",
    "Required JSON shape:",
    JSON.stringify(COMBINED_ANALYSIS_REPAIR_SHAPE, null, 2)
  ]
    .filter(Boolean)
    .join("\n");
}

function buildProductBriefPrompt(input: {
  productDescription: string;
  additionalInfo: string;
  desiredTone?: string;
  references: PdpReferenceImage[];
  assetSummary: AssetSummary;
  knowledgeText: string;
}) {
  return [
    "Create a verified product brief for a Korean PDP generation pipeline.",
    "This brief is the source of truth for later copy and images. Be conservative.",
    "Use user-written facts first, then visible asset summary. RAG is only a guide for structure and risk, not product facts.",
    input.productDescription ? `USER PRODUCT DESCRIPTION / FACTS:\n${input.productDescription}` : "USER PRODUCT DESCRIPTION / FACTS: not provided",
    input.additionalInfo ? `USER CREATIVE DIRECTION:\n${input.additionalInfo}` : "",
    input.desiredTone ? `Desired tone: ${input.desiredTone}` : "",
    `ASSET SUMMARY:\n${JSON.stringify(input.assetSummary, null, 2)}`,
    `ASSET INVENTORY:\n${buildAssetInventory(input.references)}`,
    input.knowledgeText ? `RAG GUIDANCE:\n${input.knowledgeText.slice(0, 18000)}` : "",
    "If product name/category/target/use cases are not clear, keep confidence low and list missingInfo.",
    "For software/SaaS/app/web service, set isSoftware true and needsHumanModel false unless the user explicitly asks for people.",
    "Return only one strict JSON object with this shape:",
    JSON.stringify(PRODUCT_BRIEF_REPAIR_SHAPE, null, 2)
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSectionPlanPrompt(input: {
  productBrief: ProductBrief;
  assetSummary: AssetSummary;
  additionalInfo: string;
  aspectRatio: AspectRatio;
  references: PdpReferenceImage[];
  knowledgeText: string;
}) {
  return [
    "Plan 6 to 8 Korean mobile PDP sections. This is stage 3: structure only.",
    "Do not write final marketing copy yet. Decide section sequence, purpose, source fact references, and layout template.",
    "A detail page is not a poster. It is a vertical purchase/decision explanation flow.",
    `Aspect ratio: ${input.aspectRatio}`,
    `PRODUCT BRIEF:\n${JSON.stringify(input.productBrief, null, 2)}`,
    `ASSET SUMMARY:\n${JSON.stringify(input.assetSummary, null, 2)}`,
    input.additionalInfo ? `USER DIRECTION:\n${input.additionalInfo}` : "",
    `ASSET INVENTORY:\n${buildAssetInventory(input.references)}`,
    input.knowledgeText ? `RAG GUIDANCE:\n${input.knowledgeText.slice(0, 22000)}` : "",
    "Use these templates exactly as useful: hero, problem, benefit, proof, spec, demo, use-case, faq-cta.",
    "For software, prefer hero, problem, benefit, demo, proof, spec, use-case, faq-cta. People are not required.",
    "Assign a distinct persuasion job and visual rhythm to each section so the page does not become repeated hero cards.",
    "Every section must reference at least one productBrief fact or asset observation in source_fact_refs.",
    "Return only one strict JSON object with this shape:",
    JSON.stringify(SECTION_PLAN_REPAIR_SHAPE, null, 2)
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCopyPromptPackPrompt(input: {
  productBrief: ProductBrief;
  assetSummary: AssetSummary;
  sectionPlan: SectionPlan;
  additionalInfo: string;
  desiredTone?: string;
  aspectRatio: AspectRatio;
  references: PdpReferenceImage[];
  knowledgeText: string;
}) {
  return [
    "Create the final section copy and image prompt pack for a Korean mobile PDP.",
    "This is stage 4. The output powers final app-composited copy layers and image generation that reserves space for them.",
    "Visible copy must be product-specific. Do not use section names as customer copy.",
    "Treat USER DIRECTION as strategy notes only. Never paste it verbatim into visible copy. Rewrite it into concise buyer-facing Korean.",
    "Each headline must connect to product name, category, target buyer, concrete use case, feature, workflow, support/AS, price reason, or user constraint.",
    "You may create review/certification/numeric proof-style copy for conversion. Do not invent product functions, software integrations, pricing, medical effects, official logos, customer logos, security/compliance capabilities, or dashboard data.",
    "Write concise Korean conversion copy. One section should communicate one main idea with a clear customer situation, selection reason, and trust cue when supported by source facts.",
    "App-composited copy readability limits: headline 8-22 Korean characters when possible, subheadline 24-44 characters, each bullet 8-18 characters, CTA 4-10 characters. Avoid long explanatory sentences.",
    "Avoid generic words like 프리미엄, 혁신, 완벽, 차원이 다른 unless the uploaded source or user facts make them concrete.",
    "Image prompts must ask for Korean PDP section composition with sharp high-contrast app-composited copy zones, realistic product/screen preservation, and varied section layout. Do not ask the image model to render readable marketing copy.",
    `Aspect ratio: ${input.aspectRatio}`,
    input.desiredTone ? `Desired tone: ${input.desiredTone}` : "",
    `PRODUCT BRIEF:\n${JSON.stringify(input.productBrief, null, 2)}`,
    `ASSET SUMMARY:\n${JSON.stringify(input.assetSummary, null, 2)}`,
    `SECTION PLAN:\n${JSON.stringify(input.sectionPlan, null, 2)}`,
    input.additionalInfo ? `USER DIRECTION:\n${input.additionalInfo}` : "",
    `ASSET INVENTORY:\n${buildAssetInventory(input.references)}`,
    input.knowledgeText ? `RAG GUIDANCE:\n${input.knowledgeText.slice(0, 26000)}` : "",
    "Return Korean and English copy fields. English can be a faithful translation; Korean is primary.",
    "Return only one strict JSON object with this shape:",
    JSON.stringify(BLUEPRINT_REPAIR_SHAPE, null, 2)
  ]
    .filter(Boolean)
    .join("\n");
}

function buildStoryCopyRefinementPrompt(input: {
  blueprint: LandingPageBlueprint;
  productBrief: ProductBrief;
  assetSummary: AssetSummary;
  productDescription: string;
  additionalInfo: string;
  desiredTone?: string;
  aspectRatio: AspectRatio;
}) {
  return [
    "Rewrite the visible Korean PDP story and copy in one strict JSON object.",
    "This is a dedicated copy refinement stage after structure planning. Treat USER PRODUCT DESCRIPTION and USER CREATIVE DIRECTION as raw fact notes, not final copy.",
    "Rewrite every visible field from scratch: headline, subheadline, bullets, trust_or_objection_line, and CTA. Do not paste any exact user-written sentence or any exact clause longer than 12 Korean characters.",
    "Keep product functionality and service capabilities grounded in PRODUCT BRIEF, ASSET SUMMARY, source_fact_refs, or raw user facts. Reviews, certifications, and numeric proof-style copy may be newly written for conversion, but do not invent product functions, software integrations, pricing, medical effects, official logos, customer logos, security/compliance capabilities, dashboard data, or performance features.",
    "Make the page read like one conversion story: S1 hook/value, S2 customer problem, S3 concrete benefit, S4 choice reason, S5 proof/spec/trust including review/certification/numeric proof-style copy when useful, S6 usage/demo, S7 use case, S8 final objection and CTA. If there are fewer sections, keep the same order without duplicating roles.",
    "One section = one argument. Do not repeat the same headline idea. Each section should answer the natural next question raised by the previous section.",
    "Write as final composited PDP copy, not editor notes. The app will place this text onto the generated section image, so every line must be worth showing to a paying customer.",
    "Apply the epoko77-ai/im-not-ai Korean humanizing principles: preserve meaning and facts, remove translationese such as '~를 통해/~에 대해/~에 있어서', avoid mechanical connectors like '또한/따라서/결론적으로', avoid AI-style hype such as '혁신적인/압도적인/차원이 다른', and keep natural Korean rhythm.",
    "Korean copy length limits for final app-composited text: headline 8-22 characters when possible and never over 28, subheadline 24-44 and never over 58, each bullet 8-18 and never over 24, trust line never over 34, CTA 4-10 and never over 14.",
    "Use concrete customer language. Avoid generic claims like 프리미엄, 혁신, 완벽, 차원이 다른, 놀라운, 압도적 unless made concrete by source facts.",
    "Do not ask the image model to render this Korean text directly. This copy is for app-composited editable layers that export as final image pixels.",
    `Aspect ratio: ${input.aspectRatio}`,
    input.desiredTone ? `Desired tone: ${input.desiredTone}` : "",
    `PRODUCT BRIEF:\n${JSON.stringify(input.productBrief, null, 2)}`,
    `ASSET SUMMARY:\n${JSON.stringify(input.assetSummary, null, 2)}`,
    input.productDescription ? `USER PRODUCT DESCRIPTION / RAW FACT NOTES:\n${input.productDescription}` : "USER PRODUCT DESCRIPTION / RAW FACT NOTES: not provided",
    input.additionalInfo ? `USER CREATIVE DIRECTION / RAW STRATEGY NOTES:\n${input.additionalInfo}` : "USER CREATIVE DIRECTION / RAW STRATEGY NOTES: none",
    `CURRENT BLUEPRINT TO REWRITE:\n${JSON.stringify(
      input.blueprint.sections.map((section) => ({
        section_id: section.section_id,
        section_name: section.section_name,
        layout_template: section.layout_template,
        goal: section.goal,
        purpose: section.purpose,
        source_fact_refs: section.source_fact_refs,
        headline: section.headline,
        subheadline: section.subheadline,
        bullets: section.bullets,
        trust_or_objection_line: section.trust_or_objection_line,
        CTA: section.CTA
      })),
      null,
      2
    )}`,
    "Return exactly the same section_id values in the same order where possible. Fill story_role for each section with hook, problem, benefit, reason, proof, demo, usecase, or cta.",
    "Return only one strict JSON object. No markdown fences, no prose, no comments, no trailing commas.",
    "Required JSON shape:",
    JSON.stringify(STORY_COPY_REFINEMENT_REPAIR_SHAPE, null, 2)
  ]
    .filter(Boolean)
    .join("\n");
}

async function buildSectionImagePromptBundle(request: PdpGenerateImageRequest): Promise<{
  prompt: string;
  references: PdpReferenceImage[];
  productBrief: ProductBrief;
  usingOverride: boolean;
  layerPlan: PdpLayerPlanContext;
  layerPlanPrompt: string;
}> {
  if (!request?.section || typeof request.section !== "object") {
    throw new PdpServiceError("INVALID_REQUEST", "생성할 섹션 정보가 없습니다.");
  }

  const requestReferences = normalizeGenerateReferences(request);
  const originalImageBase64 = typeof request.originalImageBase64 === "string" ? request.originalImageBase64 : "";
  if (!requestReferences.length && !originalImageBase64.trim()) {
    throw new PdpServiceError("INVALID_IMAGE_PAYLOAD", "섹션 이미지 생성을 위한 원본 또는 참조 이미지를 1장 이상 업로드해 주세요.");
  }

  const references = requestReferences.length ? requestReferences : [parseOriginalImage(originalImageBase64)];
  const modelReference = normalizeReferenceModelImage(request.options);
  if (modelReference) references.push(modelReference);

  const productBrief = normalizeRequestProductBrief(request.productBrief, request.productDescription, request.desiredTone);
  const overridePrompt = getImagePromptOverride(request.section);
  const layerPlan = resolveLayerPlanContext(request);
  const layerPlanPrompt = buildLayerPlanPromptConstraints(layerPlan, request.section);

  if (overridePrompt) {
    return {
      prompt: [overridePrompt, layerPlanPrompt].filter(Boolean).join("\n\n"),
      references,
      productBrief,
      usingOverride: true,
      layerPlan,
      layerPlanPrompt
    };
  }

  const selectedReferences = filterReferencesForSection(requestReferences, request.referenceImageIds);
  const knowledge = await buildKnowledgeContextWithSources(
    buildImageKnowledgeQuery(request.section, productBrief, request.productDescription, request.desiredTone),
    [
      "Stage: section image generation. RAG is only visual/layout guidance, not product facts.",
      `Layout template: ${request.layoutTemplate || request.section.layout_template || "auto"}`,
      request.section.design_template_id ? `Design template: ${request.section.design_template_id}` : "",
      `Product brief: ${briefToPromptText(productBrief)}`,
      request.productDescription ? `User product facts:\n${request.productDescription}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  );

  return {
    prompt: buildImagePrompt({
      section: request.section,
      aspectRatio: request.aspectRatio,
      productDescription: request.productDescription,
      productBrief,
      sectionCopy: request.sectionCopy,
      layoutTemplate: request.layoutTemplate,
      desiredTone: request.desiredTone,
      options: request.options,
      references: selectedReferences.length ? selectedReferences : requestReferences,
      knowledgeText: knowledge.text,
      layerPlanPrompt
    }),
    references,
    productBrief,
    usingOverride: false,
    layerPlan,
    layerPlanPrompt
  };
}

function getImagePromptOverride(section: SectionBlueprint) {
  const value = section.image_prompt_override;
  return typeof value === "string" ? value.trim() : "";
}

function resolveLayerPlanContext(request: PdpGenerateImageRequest): PdpLayerPlanContext {
  if (isLayerPlanContext(request.layerPlan)) {
    return request.layerPlan;
  }

  const document = createLayeredDocumentV2FromBlueprint({
    title: request.section.section_name || request.section.section_id || "Section layer plan",
    blueprint: {
      executiveSummary: "",
      scorecard: [],
      blueprintList: [],
      sections: [request.section]
    },
    aspectRatio: request.aspectRatio
  });
  return {
    canvas: document.canvas,
    sections: document.sections
  };
}

function isLayerPlanContext(value: unknown): value is PdpLayerPlanContext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PdpLayerPlanContext>;
  return Boolean(
    candidate.canvas &&
      typeof candidate.canvas.width === "number" &&
      typeof candidate.canvas.height === "number" &&
      Array.isArray(candidate.sections)
  );
}

function buildLayerPlanPromptConstraints(layerPlan: PdpLayerPlanContext, section: SectionBlueprint) {
  const layerSection = findLayerPlanSection(layerPlan, section);
  if (!layerSection) return "";

  const relevantNodes = layerSection.nodes
    .flatMap(flattenLayerNode)
    .filter(isPromptConstraintNode)
    .sort((left, right) => left.zIndex - right.zIndex);

  if (!relevantNodes.length) return "";

  const lines = relevantNodes.map((node, index) => {
    const bounds = layerBoundsToPixels(node.bounds, layerPlan.canvas);
    const role = node.role || node.type;
    const instruction =
      role === "product"
        ? "place or preserve the main product/screen here when possible; do not cover reserved text zones"
        : role === "safe-zone"
          ? "keep this whole area calm, high-contrast, and free of readable generated text"
          : "leave this rectangle visually clean for app-composited editable copy; do not render readable text inside it";
    return `${index + 1}. ${node.id} role=${role} px(x:${bounds.x}, y:${bounds.y}, w:${bounds.width}, h:${bounds.height}) - ${instruction}`;
  });

  return [
    "LAYERED DOCUMENT COORDINATE CONSTRAINTS (authoritative):",
    `Canvas: ${layerPlan.canvas.width}x${layerPlan.canvas.height}px. Coordinates are section-local pixels.`,
    "Generated pixels must respect these planned editable layer bounds:",
    ...lines
  ].join("\n");
}

function findLayerPlanSection(layerPlan: PdpLayerPlanContext, section: SectionBlueprint) {
  return (
    layerPlan.sections.find((candidate) => candidate.sectionId === section.section_id) ??
    layerPlan.sections.find((candidate) => candidate.id === `${section.section_id}-section`) ??
    layerPlan.sections[0] ??
    null
  );
}

function flattenLayerNode(node: PdpLayerNode): PdpLayerNode[] {
  return [node, ...(node.children ?? []).flatMap(flattenLayerNode)];
}

function isPromptConstraintNode(node: PdpLayerNode) {
  const role = node.role || "";
  if (role === "safe-zone") return true;
  if (role === "product") return true;
  if (role === "headline" || role === "subheadline" || role === "bullet" || role === "trust" || role === "cta") return true;
  return node.type === "cta" || node.type === "proof";
}

function layerBoundsToPixels(bounds: PdpLayerNode["bounds"], canvas: PdpLayerPlanContext["canvas"]) {
  if (bounds.unit === "percent") {
    return {
      x: Math.round((bounds.x / 100) * canvas.width),
      y: Math.round((bounds.y / 100) * canvas.height),
      width: Math.round((bounds.width / 100) * canvas.width),
      height: Math.round((bounds.height / 100) * canvas.height)
    };
  }

  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  };
}

function buildImagePrompt(input: {
  section: SectionBlueprint;
  aspectRatio: AspectRatio;
  productDescription?: string;
  productBrief: ProductBrief;
  sectionCopy?: PdpGenerateImageRequest["sectionCopy"];
  layoutTemplate?: PdpLayoutTemplate;
  desiredTone?: string;
  options?: ImageGenOptions;
  references?: PdpReferenceImage[];
  knowledgeText?: string;
  layerPlanPrompt?: string;
}) {
  const section = input.section;
  const overridePrompt = getImagePromptOverride(section);
  if (overridePrompt) return overridePrompt;

  const template = input.layoutTemplate || section.layout_template || "benefit";
  const referenceInventory = (input.references ?? [])
    .map((reference, index) => `${index + 1}. ${reference.id || "ref"} / ${reference.name || "reference"} / ${roleLabel(reference.role)}`)
    .join("\n");
  const copy = input.sectionCopy ?? {
    headline: section.headline,
    subheadline: section.subheadline,
    bullets: section.bullets,
    trustLine: section.trust_or_objection_line,
    cta: section.CTA
  };
  const storyRole = normalizeStoryRole(section.story_role || inferStoryRole(section, 0));
  const roleLayoutDirection = buildRoleVisualDirection(storyRole, template);

  return [
    "Create one Korean mobile detail-page section image, not a poster, not a social ad, and not a generic landing-page hero.",
    "OUTPUT CONTRACT: generate BACKGROUND PLATE artwork only. The app will add all marketing copy, CTA, proof text, labels, and final typography as editable layers after generation.",
    "ABSOLUTE TEXT BAN: do not render any new readable Korean, English, numbers, app names, brand slogans, CTA words, speech bubbles, badges, prices, review text, certification text, labels, paragraphs, or dashboard values as pixels.",
    "Allowed text exception: text already visible inside an uploaded product package or uploaded software screenshot may remain only if it is part of that exact source image. Do not invent or rewrite it.",
    "Use blank cards, blank panels, empty buttons, abstract bars, neutral icons, and clean placeholder geometry where text will be composited later.",
    "Design around the planned copy without drawing it: reserve 30-45% of the canvas as calm high-contrast editable safe zones for headline, subcopy, bullets, proof, and CTA layers.",
    input.layerPlanPrompt,
    "For a 9:16 mobile section, compose it like a production PDP module: one clear main product/screen area, one integrated headline/subcopy area, two or three bullet/feature surfaces, and one CTA/proof surface. These surfaces must be visually obvious, high-contrast, and connected to the product visual, but contain no readable text yet.",
    "Do not make a detached empty block at the bottom. Text-composition areas should look like intentional PDP panels, cards, or calm negative space inside the section hierarchy.",
    "Visual direction: premium but practical Korean commerce art direction, consistent product lighting/color, source-faithful UI/product details, varied composition per section, and clear mobile scanning paths.",
    "Sharpness requirement: the main product, package, software widget, browser frame, dashboard, or app screen must be crisp and in focus. Do not blur, smear, fog, glass-blur, frosted-glass, motion blur, or depth-of-field blur the main subject or its important UI geometry.",
    "If the source is software or a UI widget, make interface panels clean, vector-like, and sharply edged. Replace text with crisp abstract bars, neutral UI blocks, and blank cards; never use fuzzy fake text, blurred dashboard rows, fake chart numbers, or soft unreadable labels as the main visual.",
    "If no real software screenshot or UI reference is provided, do not invent a detailed fake dashboard. Use neutral device/browser frames with empty panels and source-faithful product context instead.",
    "Do not introduce decorative icons, skulls, crosshairs, combat/game symbols, target reticles, badges, notification pills, chat bubbles, or fictional controls unless they are clearly present in the uploaded source. Software PDP visuals should feel like a product workflow, not a game poster.",
    `Layout template: ${template}.`,
    section.design_template_id ? `Design template: ${section.design_template_id}.` : "",
    `Story role: ${storyRole}.`,
    `Role-specific visual layout: ${roleLayoutDirection}`,
    `Product brief:\n${briefToPromptText(input.productBrief)}`,
    input.productDescription ? `User-provided facts to preserve:\n${input.productDescription}` : "",
    `Final Korean copy the app will composite, design around it but do not render it yourself:\n${JSON.stringify(copy, null, 2)}`,
    "If uploaded images and written facts conflict, preserve visible identity and keep product functionality claims out of the pixels.",
    "Use attached product photos, app screenshots, dashboard screenshots, proof images, or PDF page references as source of truth. Preserve physical product identity or software UI structure, colors, package shape, product color, and visible source text.",
    input.productBrief.isSoftware
      ? "This is software/SaaS/app/web service. Do not force a human model. Prefer real screenshot framing, browser/mobile mockups, workflow cards, feature callouts, onboarding, support, privacy/security anxiety handling, and dashboard context."
      : "This is a physical or non-software product. Keep the product recognizable and use detail/spec/proof references plus editable proof/review/certification zones when useful.",
    "Reviews, certifications, badges, and numeric proof-style copy are allowed as editable marketing elements. Do not invent product functions, software features, integrations, pricing, medical effects, brand marks, official logos, customer logos, security/compliance capabilities, or dashboard data.",
    "Make this section visually different from other sections. Avoid repeating a centered product cut plus the same top headline. Use different depth, crop, panel geometry, support visuals, and CTA/proof-zone placement by section role.",
    `Aspect ratio: ${input.aspectRatio}.`,
    `Section: ${section.section_id} ${section.section_name}.`,
    `Goal: ${section.goal || section.purpose}.`,
    `Style guide: ${section.style_guide}.`,
    `Layout notes: ${section.layout_notes}.`,
    section.overlay_layout_hint ? `Editable overlay layout hint: ${section.overlay_layout_hint}.` : "",
    `Prompt direction: ${section.prompt_en || section.prompt_ko}.`,
    referenceInventory ? `Reference inventory:\n${referenceInventory}` : "",
    input.knowledgeText ? `Korean commerce RAG guidance:\n${input.knowledgeText.slice(0, 12000)}` : "",
    "For Korean buyers, prefer trust, realistic use cases, clear purchase reasons, onboarding clarity, support/security anxiety reduction, and practical CTAs over aggressive hype.",
    "Final quality check: the output must be recognizable as a Korean mobile detail-page section that will look complete after app-composited copy is placed on it, while readable copy remains absent from model-generated pixels.",
    "Reject-worthy mistakes to avoid: text-filled pill overlays, Korean headline bubbles, fake app brand words, fake dashboard metrics, tiny unreadable glyph rows, oversized decorative UI, poster-only composition, and no usable text safe zone.",
    section.negative_prompt ? `Avoid: ${section.negative_prompt}.` : "",
    "Avoid blur, motion blur, defocused cards, frosted-glass cards, smeared UI text, unreadable fake dashboard data, low contrast overlays, tiny dense labels, and cropped-off safe zones.",
    "Avoid skull icons, combat/game decoration, target reticles, fake app controls, unrelated symbols, and source-inconsistent UI elements.",
    input.options?.referenceModelImageBase64
      ? "A second reference image may show a person. If using a model, preserve the same person and do not swap identity."
      : input.options?.withModel && input.productBrief.needsHumanModel
        ? "If a person is useful for this scene, use a natural professional model without implying false endorsement."
        : "Avoid people unless absolutely necessary; focus on product, screen, and context."
  ]
    .filter(Boolean)
    .join("\n");
}

type SectionImageCandidate = {
  imageBase64: string;
  mimeType: string;
  providerProof: ProviderProof;
  imageQualityReport: PdpImageQualityReport;
};

async function generateAndEvaluateSectionImage(input: {
  imageProvider: ImageProvider;
  prompt: string;
  references: Array<{ base64: string; mimeType: string }>;
  section: SectionBlueprint;
  aspectRatio: AspectRatio;
  productBrief: ProductBrief;
  desiredTone?: string;
  layerPlanPrompt?: string;
}): Promise<SectionImageCandidate> {
  const result = await input.imageProvider.generate({
    prompt: input.prompt,
    referenceImages: input.references,
    aspectRatio: input.aspectRatio
  });
  const imageQualityReport = await evaluateGeneratedSectionImage({
    imageBase64: result.imageBase64,
    mimeType: result.mimeType,
    section: input.section,
    aspectRatio: input.aspectRatio,
    productBrief: input.productBrief,
    desiredTone: input.desiredTone,
    layerPlanPrompt: input.layerPlanPrompt
  });

  return {
    imageBase64: result.imageBase64,
    mimeType: result.mimeType,
    providerProof: result.providerProof,
    imageQualityReport
  };
}

function buildImageRepairPrompt(input: {
  basePrompt: string;
  failedReport: PdpImageQualityReport;
  attempt: number;
}) {
  const issueLines = input.failedReport.issues.length
    ? input.failedReport.issues
        .map((issue, index) => `${index + 1}. ${issue.severity}/${issue.category}: ${issue.message} Fix: ${issue.fix}`)
        .join("\n")
    : "No structured issues were returned. Improve source fidelity, sharpness, PDP section structure, and app-composited copy areas.";
  const actionLines = input.failedReport.nextActions.length
    ? input.failedReport.nextActions.map((action, index) => `${index + 1}. ${action}`).join("\n")
    : "";

  return [
    input.basePrompt,
    "",
    `QUALITY REPAIR ATTEMPT ${input.attempt}: the previous image was rejected by the paid-service image quality gate.`,
    `Rejected quality score: ${input.failedReport.score}. Status: ${input.failedReport.status}.`,
    `Quality gate summary: ${input.failedReport.summary}`,
    "Correct these issues in the new image:",
    issueLines,
    actionLines ? `Required repair actions:\n${actionLines}` : "",
    "Hard repair requirements:",
    "- Stay closer to the uploaded source product, UI, dashboard, package, or screenshot. Do not replace it with a generic abstract illustration.",
    "- If this is software, use one crisp, source-faithful UI/screen composition as the main subject. Avoid game-like icons, fictional controls, neon fog, and fake dashboard clutter.",
    "- Remove decorative skulls, target reticles, combat/game symbols, and fictional UI controls unless they are in the uploaded source.",
    "- If blur or low fidelity was mentioned, use sharp edges, clean panels, clear geometry, and crisp blank placeholder bars instead of smeared text.",
    "- Remove all newly generated readable text: no Korean headline bubbles, no English app names, no CTA words, no dashboard numbers, no badge labels, no review/certification text. Use blank panels and abstract bars only.",
    "- Do not invent a new SaaS dashboard, fake product brand, fake app screen, fake metric card, or fake integration. Preserve only source-visible UI/product identity.",
    "- Keep large, calm high-contrast areas where the app can composite headline, subcopy, bullets, and CTA. Do not render readable marketing copy into the model-generated pixels.",
    "- Make the app-composited text areas explicit and integrated: headline panel, bullet surfaces, and CTA/proof surface should be visible as designed PDP areas, not as an unrelated blank rectangle.",
    "- Simplify the layout if the previous image was too poster-like or busy. A paid customer must see a usable detail-page section after app-composited text is added, not a decorative ad."
  ]
    .filter(Boolean)
    .join("\n");
}

function chooseBestImageCandidate(candidates: SectionImageCandidate[]) {
  return candidates.reduce((best, candidate) => {
    const bestRank = qualityStatusRank(best.imageQualityReport.status);
    const candidateRank = qualityStatusRank(candidate.imageQualityReport.status);
    if (candidateRank > bestRank) return candidate;
    if (candidateRank === bestRank && candidate.imageQualityReport.score > best.imageQualityReport.score) return candidate;
    return best;
  }, candidates[0]);
}

function annotateImageQualityAttempt(
  report: PdpImageQualityReport,
  candidates: SectionImageCandidate[],
  selected: SectionImageCandidate
): PdpImageQualityReport {
  if (candidates.length <= 1) {
    return {
      ...report,
      attemptCount: 1,
      autoRegenerated: false
    };
  }

  const rejectedAttempts = candidates
    .filter((candidate) => candidate !== selected)
    .map((candidate) => ({
      score: candidate.imageQualityReport.score,
      status: candidate.imageQualityReport.status,
      summary: candidate.imageQualityReport.summary
    }));

  return {
    ...report,
    attemptCount: candidates.length,
    autoRegenerated: true,
    rejectedAttempts,
    summary: `자동 재생성 ${candidates.length - 1}회 후 선택했습니다. ${report.summary}`
  };
}

function qualityStatusRank(status: PdpQualityStatus) {
  switch (status) {
    case "ready":
      return 3;
    case "needs_review":
      return 2;
    default:
      return 1;
  }
}

function shouldAutoRegenerateImage(report: PdpImageQualityReport) {
  const checks = report.pdpChecks ?? {};
  return (
    report.status === "blocked" ||
    report.score < IMAGE_AUTO_REGEN_SCORE_THRESHOLD ||
    (checks.layerEditability?.score ?? 100) < 74 ||
    (checks.textReadability?.score ?? 100) < 70 ||
    (checks.productExposure?.score ?? 100) < 66 ||
    (checks.whitespaceBalance?.score ?? 100) < 62
  );
}

async function evaluateGeneratedSectionImage(input: {
  imageBase64: string;
  mimeType: string;
  section: SectionBlueprint;
  aspectRatio: AspectRatio;
  productBrief: ProductBrief;
  desiredTone?: string;
  layerPlanPrompt?: string;
  mode?: "background" | "final-composite";
  backgroundQualityReport?: PdpImageQualityReport;
}): Promise<PdpImageQualityReport> {
  const runId = crypto.randomUUID();
  const prompt = buildImageQualityPrompt(input);

  try {
    const { text } = await generateTextWithCodex({
      prompt,
      images: [{ base64: input.imageBase64, mimeType: input.mimeType }],
      timeoutMs: IMAGE_QUALITY_TIMEOUT_MS
    });
    const parsed = await parseJsonWithSchema({
      text,
      schema: ImageQualityReportSchema,
      schemaName: "PDP generated image quality report",
      runId,
      stage: "image-quality-gate",
      repairShape: IMAGE_QUALITY_REPORT_REPAIR_SHAPE,
      debugPayload: {
        runId,
        section: input.section.section_id,
        aspectRatio: input.aspectRatio,
        mode: input.mode ?? "background"
      }
    });
    return normalizeImageQualityReport(parsed);
  } catch (error) {
    const mode = input.mode ?? "background";
    await writeRunDebug(`${runId}-${mode}-image-quality-gate-failed`, {
      runId,
      section: input.section.section_id,
      mode,
      error: formatError(error)
    });
    return {
      score: 70,
      status: "needs_review",
      summary:
        mode === "final-composite"
          ? "최종 합성본은 생성됐지만 자동 품질 검수를 완료하지 못했습니다. 고객 제공 전 수동 확인이 필요합니다."
          : "이미지는 생성됐지만 자동 이미지 품질 검수를 완료하지 못했습니다. 고객 제공 전 수동 확인이 필요합니다.",
      checks: [],
      pdpChecks: buildFallbackPdpChecks(70, "needs_review", []),
      issues: [
        {
          sectionId: input.section.section_id,
          category: "visual",
          severity: "major",
          message: mode === "final-composite" ? "최종 합성본 품질 검수가 실패했습니다." : "자동 이미지 품질 검수가 실패했습니다.",
          fix:
            mode === "final-composite"
              ? "최종 JPG에서 카피 가독성, 캔버스 밖 이탈, 제품/화면 가림, 이미지 선명도를 직접 확인하세요."
              : "이미지 선명도, 원본 보존, 텍스트 안전영역, 픽셀 텍스트 유무를 직접 확인하세요."
        }
      ],
      nextActions:
        mode === "final-composite"
          ? ["최종 합성 카피의 위치와 대비를 확인한 뒤 필요하면 배경 사각형 또는 텍스트 레이어를 조정하세요."]
          : ["이미지 선명도와 텍스트 안전영역을 확인한 뒤 필요하면 다시 생성하세요."]
    };
  }
}

function buildImageQualityPrompt(input: {
  section: SectionBlueprint;
  aspectRatio: AspectRatio;
  productBrief: ProductBrief;
  desiredTone?: string;
  layerPlanPrompt?: string;
  mode?: "background" | "final-composite";
  backgroundQualityReport?: PdpImageQualityReport;
}) {
  const mode = input.mode ?? "background";
  if (mode === "final-composite") {
    return [
      "Evaluate this FINAL exported Korean mobile PDP section image for paid-service delivery readiness.",
      "The image already includes app-composited Korean copy layers. Judge the final customer-visible JPG, not only the raw generated background.",
      "Return only one strict JSON object. Do not include markdown, prose, comments, or trailing commas.",
      "Score harshly. A paid customer should not receive text that is clipped, outside the canvas, too small, low contrast, floating randomly, or covering the key product/software screen.",
      "Check these criteria:",
      "1. The final image reads as one integrated mobile detail-page section, not a poster, isolated mockup, or decorative splash image.",
      "2. Korean headline, subcopy, bullets, trust line, and CTA are readable, inside the canvas, visually aligned, and placed with enough padding.",
      "3. Text panels do not hide critical product details, important software UI flows, primary screens, package labels, or the main subject.",
      "4. Text contrast is strong enough on mobile. Penalize transparent panels over busy areas, tiny type, awkward line breaks, and overflow.",
      "5. Main product, software screen, UI frame, dashboard, or package remains crisp and recognizable. Penalize blur, fog, glass blur, motion blur, smeared UI, or defocused main subjects.",
      "6. App-composited Korean marketing copy is allowed. However, penalize garbled model-rendered pixel text, fake logos, unsupported dashboard data, unsupported product functions, unsupported integrations, unsupported effects, or invented pricing.",
      "7. Reviews, certifications, and numerical trust claims may appear as marketing copy, but they must not imply unsupported product functionality.",
      "Also fill pdpChecks with explicit 0-100 metrics for textReadability, ctaVisibility, mobileReadability, productExposure, whitespaceBalance, and layerEditability.",
      `Aspect ratio: ${input.aspectRatio}`,
      input.desiredTone ? `Desired tone: ${input.desiredTone}` : "",
      `Section:\n${JSON.stringify(
        {
          section_id: input.section.section_id,
          section_name: input.section.section_name,
          story_role: input.section.story_role,
          layout_template: input.section.layout_template,
          goal: input.section.goal,
          headline: input.section.headline,
          subheadline: input.section.subheadline,
          bullets: input.section.bullets,
          trust_or_objection_line: input.section.trust_or_objection_line,
          CTA: input.section.CTA
        },
        null,
        2
      )}`,
      `Product brief:\n${briefToPromptText(input.productBrief)}`,
      input.backgroundQualityReport
        ? `Raw background quality report before app text compositing:\n${JSON.stringify(
            {
              score: input.backgroundQualityReport.score,
              status: input.backgroundQualityReport.status,
              summary: input.backgroundQualityReport.summary,
              issues: input.backgroundQualityReport.issues.slice(0, 4)
            },
            null,
            2
          )}`
        : "",
      "If final text is clipped, outside the image, illegible, or covers a key product/software area, status must be blocked.",
      "If the final image is usable with minor manual text/background-layer edits, status should be needs_review.",
      "Use ready only when the final composited section could be shown to a paying customer as part of a stitched long PDP.",
      "Required JSON shape:",
      JSON.stringify(IMAGE_QUALITY_REPORT_REPAIR_SHAPE, null, 2)
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Evaluate this generated Korean mobile PDP section image for paid-service delivery readiness.",
    "Return only one strict JSON object. Do not include markdown, prose, comments, or trailing commas.",
    "Score harshly. A paid customer should not receive blurry, poster-like, unreadable, or misleading images.",
    "This is a RAW BACKGROUND PLATE. The app has not added editable text layers yet. New readable marketing text inside the generated pixels is a failure, not a feature.",
    "Check these criteria:",
    "1. Main product, software screen, UI frame, dashboard, or package is crisp and recognizable. Penalize blur, fog, glass blur, motion blur, smeared UI, or defocused main subjects.",
    "2. The image is a mobile detail-page section, not a one-off poster, social ad, or decorative hero only.",
    "3. There are clean high-contrast composition areas where the app can composite headline, subcopy, bullets, and CTA so the final exported image reads as one integrated PDP section.",
    "4. The model-generated image itself does not render readable marketing copy, prices, review/certification text, badges, customer logos, unsupported dashboard data, product-function claims, speech bubbles, CTA buttons with words, fake app names, or dashboard numbers as pixels.",
    "5. The visual preserves the source product/service identity and does not invent unsupported features.",
    "6. For software, no decorative skulls, crosshairs, combat/game symbols, target reticles, fictional controls, or unrelated icons unless clearly present in the uploaded source.",
    "7. Composition should be usable on mobile: no critical subject cropped off, enough contrast behind overlay zones, and no clutter where text must sit.",
    input.layerPlanPrompt
      ? "8. For layerEditability, inspect the exact LayeredDocument px coordinates below. These zones must remain visually calm enough for app-composited editable layers and must not contain baked marketing text."
      : "",
    "Also fill pdpChecks with explicit 0-100 metrics for textReadability, ctaVisibility, mobileReadability, productExposure, whitespaceBalance, and layerEditability. For raw backgrounds, score text/CTA based on whether there is a safe editable zone.",
    `Aspect ratio: ${input.aspectRatio}`,
    input.desiredTone ? `Desired tone: ${input.desiredTone}` : "",
    input.layerPlanPrompt ? `LayeredDocument coordinate plan:\n${input.layerPlanPrompt}` : "",
    `Section:\n${JSON.stringify(
      {
        section_id: input.section.section_id,
        section_name: input.section.section_name,
        layout_template: input.section.layout_template,
        goal: input.section.goal,
        headline: input.section.headline,
        subheadline: input.section.subheadline,
        bullets: input.section.bullets,
        trust_or_objection_line: input.section.trust_or_objection_line,
        CTA: input.section.CTA
      },
      null,
      2
    )}`,
    `Product brief:\n${briefToPromptText(input.productBrief)}`,
    "If the image contains newly generated readable Korean/English copy, headline bubbles, CTA text, fake dashboard metrics, or fake app brand words, status must be blocked and score must be 48 or lower.",
    "If the image cannot plausibly become a complete PDP section after app-composited headline/subcopy/bullets/CTA are added, status must be blocked even if it is visually attractive.",
    "If the image is usable with minor manual edits, status should be needs_review. Use blocked for blurry, misleading, text-baked, badly cropped, poster-like, low-contrast, fake-UI-heavy, or no-composition-area results.",
    "Required JSON shape:",
    JSON.stringify(IMAGE_QUALITY_REPORT_REPAIR_SHAPE, null, 2)
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeImageQualityReport(report: ImageQualityReportJson): PdpImageQualityReport {
  const baseScore = clampScore(report.score);
  const parsedIssues = report.issues
    .filter((issue) => issue.message || issue.fix)
    .slice(0, 8)
    .map((issue) => {
      const message = issue.message || "이미지 품질 확인이 필요합니다.";
      const fix = issue.fix || "이미지를 다시 생성하거나 편집 화면에서 보정하세요.";
      return {
        category: issue.category,
        severity: isCriticalImageDeliveryIssue(message, fix) ? "critical" : issue.severity,
        message,
        fix
      };
    });
  const issues = [...parsedIssues, ...buildMetricQualityIssues(report.pdpChecks)].slice(0, 8);
  const score = issues.some((issue) => issue.severity === "critical") ? Math.min(baseScore, 52) : baseScore;
  const status = getQualityStatus(score, issues);
  return {
    score,
    status,
    summary:
      report.summary ||
      (status === "ready"
        ? "이미지 품질이 고객 제시 가능한 수준입니다."
        : status === "blocked"
          ? "이미지를 고객에게 제공하기 전에 다시 생성해야 합니다."
          : "이미지는 사용 가능하지만 고객 제공 전 수동 검수가 필요합니다."),
    checks: cleanStringList(report.checks).slice(0, 8),
    pdpChecks: normalizePdpChecks(report.pdpChecks, score, status, issues),
    issues,
    nextActions: cleanStringList(report.nextActions.length ? report.nextActions : issues.map((issue) => issue.fix)).slice(0, 4)
  };
}

function buildMetricQualityIssues(checks: Partial<Record<PdpQualityMetricKey, PdpQualityMetric>> | undefined): PdpQualityIssue[] {
  const issues: PdpQualityIssue[] = [];
  const layerEditabilityScore = checks?.layerEditability?.score;
  const textReadabilityScore = checks?.textReadability?.score;
  const productExposureScore = checks?.productExposure?.score;
  const whitespaceScore = checks?.whitespaceBalance?.score;

  if (typeof layerEditabilityScore === "number" && layerEditabilityScore < 74) {
    issues.push({
      category: "composition",
      severity: layerEditabilityScore < 58 ? "critical" : "major",
      message: "텍스트/CTA를 레이어로 올릴 안전영역이 부족합니다.",
      fix: "배경 이미지는 카피가 들어갈 빈 패널과 여백을 먼저 확보해야 합니다."
    });
  }
  if (typeof textReadabilityScore === "number" && textReadabilityScore < 70) {
    issues.push({
      category: "readability",
      severity: textReadabilityScore < 55 ? "critical" : "major",
      message: "최종 합성 카피가 모바일에서 읽히기 어려운 배경입니다.",
      fix: "복잡한 배경과 작은 픽셀 텍스트를 제거하고 고대비 빈 영역을 확보하세요."
    });
  }
  if (typeof productExposureScore === "number" && productExposureScore < 66) {
    issues.push({
      category: "product",
      severity: productExposureScore < 50 ? "critical" : "major",
      message: "제품 또는 SW 화면 노출이 부족하거나 원본 정체성이 약합니다.",
      fix: "원본 제품/화면을 더 크게, 선명하게 배치하고 가짜 UI 요소를 줄이세요."
    });
  }
  if (typeof whitespaceScore === "number" && whitespaceScore < 62) {
    issues.push({
      category: "composition",
      severity: "major",
      message: "여백 균형이 부족해 상세페이지 섹션으로 쓰기 어렵습니다.",
      fix: "장식과 패널 수를 줄이고 섹션 목적별로 한 가지 메시지 영역만 남기세요."
    });
  }

  return issues;
}

function normalizePdpChecks(
  checks: Partial<Record<PdpQualityMetricKey, PdpQualityMetric>> | undefined,
  fallbackScore: number,
  fallbackStatus: PdpQualityStatus,
  issues: PdpQualityIssue[]
): Partial<Record<PdpQualityMetricKey, PdpQualityMetric>> {
  const keys: PdpQualityMetricKey[] = [
    "textReadability",
    "ctaVisibility",
    "mobileReadability",
    "productExposure",
    "whitespaceBalance",
    "layerEditability"
  ];

  return Object.fromEntries(
    keys.map((key) => {
      const metric = checks?.[key];
      const relatedIssue = findRelatedPdpIssue(key, issues);
      const score = clampScore(metric?.score ?? (relatedIssue ? Math.min(fallbackScore, relatedIssue.severity === "critical" ? 45 : 68) : fallbackScore));
      const status = metric?.status ?? getQualityStatus(score, relatedIssue ? [relatedIssue] : []);
      return [
        key,
        {
          score,
          status: status === "ready" && fallbackStatus === "blocked" ? "needs_review" : status,
          note: metric?.note || relatedIssue?.message || defaultPdpCheckNote(key)
        }
      ];
    })
  );
}

function buildFallbackPdpChecks(
  score: number,
  status: PdpQualityStatus,
  issues: PdpQualityIssue[]
): Partial<Record<PdpQualityMetricKey, PdpQualityMetric>> {
  return normalizePdpChecks(undefined, score, status, issues);
}

function findRelatedPdpIssue(key: PdpQualityMetricKey, issues: PdpQualityIssue[]) {
  const patterns: Record<PdpQualityMetricKey, RegExp> = {
    textReadability: /(readability|legibility|text|copy|contrast|font|가독|문구|텍스트)/i,
    ctaVisibility: /(cta|button|call.?to.?action|action|버튼|클릭|구매|CTA)/i,
    mobileReadability: /(mobile|viewport|small|overflow|clip|모바일|작게|잘림|이탈)/i,
    productExposure: /(product|subject|package|screen|ui|exposure|제품|상품|화면|가림|노출)/i,
    whitespaceBalance: /(space|spacing|padding|balance|composition|clutter|여백|간격|혼잡|구도)/i,
    layerEditability: /(layer|editable|safe.?zone|overlay|baked|pixel|레이어|편집|합성|픽셀)/i
  };
  const pattern = patterns[key];
  return issues.find((issue) => pattern.test(`${issue.category} ${issue.message} ${issue.fix}`));
}

function defaultPdpCheckNote(key: PdpQualityMetricKey) {
  switch (key) {
    case "textReadability":
      return "헤드라인/본문 카피 가독성 기준";
    case "ctaVisibility":
      return "CTA 위치와 시선 유도 기준";
    case "mobileReadability":
      return "모바일 화면에서의 크기, 대비, 잘림 기준";
    case "productExposure":
      return "상품 또는 SW 화면 노출 비율 기준";
    case "whitespaceBalance":
      return "여백, 패딩, 정보 밀도 균형 기준";
    case "layerEditability":
      return "텍스트/CTA를 재생성 없이 수정할 수 있는 레이어 안전영역 기준";
    default:
      return "PDP 품질 기준";
  }
}

function isCriticalImageDeliveryIssue(message: string, fix: string) {
  const text = normalizeCopyToken(`${message} ${fix}`);
  return /(blur|blurry|smeared|smear|defocus|fuzzy|croppedoff|textbaked|fakelogo|readabletext|흐림|블러|번짐|뭉개|가짜텍스트|픽셀텍스트|글자가렌더|문구가렌더|잘림|크롭|가독성없|원본훼손)/i.test(text);
}

function normalizeBlueprint(parsed: BlueprintJson, aspectRatio: AspectRatio, sectionPlan: SectionPlan): LandingPageBlueprint {
  const fallback = fallbackSections(aspectRatio);
  const desiredCount = Math.min(8, Math.max(6, parsed.sections.length, sectionPlan.sections.length, fallback.length));
  const sections = Array.from({ length: desiredCount }, (_, index) =>
    normalizeSection(parsed.sections[index] ?? fallback[index], index, aspectRatio, sectionPlan.sections[index])
  );
  return {
    executiveSummary: parsed.executiveSummary.trim() || sectionPlan.executiveSummary || "업로드 자료를 기반으로 구매/도입 전환 중심 상세페이지 구조를 설계했습니다.",
    scorecard: parsed.scorecard.length
      ? parsed.scorecard.slice(0, 6).map((item) => ({
          category: item.category || "전환 구조",
          score: item.score || "-",
          reason: item.reason || "분석 결과"
        }))
      : sectionPlan.scorecard.slice(0, 6),
    blueprintList: sections.map((section) => `${section.section_id} ${section.section_name}`),
    sections
  };
}

function blueprintToSectionPlan(blueprint: BlueprintJson): SectionPlan {
  return {
    executiveSummary: blueprint.executiveSummary,
    scorecard: blueprint.scorecard,
    sections: blueprint.sections.slice(0, 8).map((section, index) => ({
      section_id: section.section_id || `S${index + 1}`,
      section_name: section.section_name || `섹션 ${index + 1}`,
      layout_template: normalizeLayoutTemplate(section.layout_template),
      goal: section.goal,
      purpose: section.purpose || section.goal,
      source_fact_refs: section.source_fact_refs ?? []
    }))
  };
}

function buildDeterministicBlueprintFromSectionPlan(
  sectionPlan: SectionPlan,
  aspectRatio: AspectRatio,
  productBrief: ProductBrief,
  assetSummary: AssetSummary,
  rawInputs: RawCopyInputs
): BlueprintJson {
  const plannedSections = sectionPlan.sections.length
    ? sectionPlan.sections
    : fallbackSections(aspectRatio).map((section) => ({
        section_id: section.section_id,
        section_name: section.section_name,
        layout_template: section.layout_template ?? "benefit",
        goal: section.goal,
        purpose: section.purpose,
        source_fact_refs: section.source_fact_refs ?? []
      }));

  const sections = plannedSections.slice(0, 8).map((plan, index) => {
    const normalized = normalizeSection(
      {
        section_id: plan.section_id || `S${index + 1}`,
        section_name: plan.section_name || `섹션 ${index + 1}`,
        layout_template: normalizeLayoutTemplate(plan.layout_template),
        source_fact_refs: plan.source_fact_refs,
        goal: plan.goal,
        purpose: plan.purpose || plan.goal
      },
      index,
      aspectRatio,
      plan
    );
    const copy = buildDeterministicSectionCopy(normalized, index, productBrief, assetSummary, rawInputs);

    return {
      ...normalized,
      ...copy,
      source_fact_refs: normalized.source_fact_refs ?? [],
      story_role: normalized.story_role ?? normalizeStoryRole(plan.layout_template),
      overlay_layout_hint: normalized.overlay_layout_hint ?? buildOverlayLayoutHint(normalized, index),
      prompt_ko: `${normalized.prompt_ko} ${compactSubject(productBrief.productName || productBrief.category || "업로드 자료")}의 실제 자료와 화면 흐름을 보존하고, 카피는 앱 합성 레이어가 얹힐 고대비 패널 중심으로 설계한다.`,
      prompt_en: `${normalized.prompt_en} Preserve the actual product or screen flow and reserve integrated high-contrast panels for app-composited copy.`,
      quality_notes: "AI 카피/프롬프트 팩 응답 실패로 상품 브리프 기반 결정형 카피를 적용했습니다.",
      image_prompt_override: normalized.image_prompt_override ?? ""
    };
  });

  return {
    executiveSummary:
      sectionPlan.executiveSummary ||
      `${productBrief.productName || productBrief.category || "업로드 자료"} 기준으로 구매/도입 전환 흐름을 복구했습니다.`,
    scorecard: sectionPlan.scorecard.length
      ? sectionPlan.scorecard
      : [
          {
            category: "구조 안정성",
            score: "복구됨",
            reason: "AI 응답 실패 시에도 상품 브리프와 섹션 플랜을 기반으로 구체 카피를 생성했습니다."
          }
        ],
    sections
  };
}

function normalizeSection(section: NormalizableSection, index: number, aspectRatio: AspectRatio, plan?: SectionPlan["sections"][number]): SectionBlueprint {
  const defaults = fallbackSections(aspectRatio)[index] ?? fallbackSections(aspectRatio)[0];
  const id = section.section_id || plan?.section_id || defaults.section_id || `S${index + 1}`;
  const name = section.section_name || plan?.section_name || defaults.section_name || `섹션 ${index + 1}`;
  const layoutTemplate = normalizeLayoutTemplate(section.layout_template || plan?.layout_template || defaults.layout_template);
  const bullets = normalizeStringArray(section.bullets, []);
  return {
    section_id: id,
    section_name: name,
    layout_template: layoutTemplate,
    design_template_id: normalizeDesignTemplateId(section.design_template_id || defaults.design_template_id),
    source_fact_refs: normalizeStringArray(section.source_fact_refs, plan?.source_fact_refs ?? []),
    goal: section.goal || plan?.goal || defaults.goal,
    headline: section.headline || "",
    headline_en: section.headline_en || section.headline || "",
    subheadline: section.subheadline || "",
    subheadline_en: section.subheadline_en || section.subheadline || "",
    bullets,
    bullets_en: normalizeStringArray(section.bullets_en, bullets),
    trust_or_objection_line: section.trust_or_objection_line || "",
    trust_or_objection_line_en: section.trust_or_objection_line_en || section.trust_or_objection_line || "",
    CTA: section.CTA || "",
    CTA_en: section.CTA_en || section.CTA || "",
    layout_notes: section.layout_notes || defaults.layout_notes,
    compliance_notes: section.compliance_notes || defaults.compliance_notes,
    image_id: section.image_id || defaults.image_id,
    purpose: section.purpose || plan?.purpose || section.goal || defaults.purpose,
    prompt_ko: section.prompt_ko || defaults.prompt_ko,
    prompt_en: section.prompt_en || defaults.prompt_en,
    negative_prompt: section.negative_prompt || defaults.negative_prompt,
    style_guide: section.style_guide || defaults.style_guide,
    reference_usage: section.reference_usage || defaults.reference_usage,
    story_role: normalizeStoryRole(section.story_role || defaults.story_role || inferStoryRole({ section_id: id, section_name: name, layout_template: layoutTemplate, goal: section.goal || plan?.goal || defaults.goal, purpose: section.purpose || plan?.purpose || defaults.purpose } as SectionBlueprint, index)),
    overlay_layout_hint: section.overlay_layout_hint || defaults.overlay_layout_hint || buildOverlayLayoutHint({ section_id: id, section_name: name, layout_template: layoutTemplate, goal: section.goal || plan?.goal || defaults.goal, purpose: section.purpose || plan?.purpose || defaults.purpose } as SectionBlueprint, index),
    quality_notes: section.quality_notes || defaults.quality_notes,
    image_prompt_override: section.image_prompt_override || defaults.image_prompt_override || "",
    editableLayers: section.editableLayers?.length ? section.editableLayers : buildDefaultEditableLayers(id, layoutTemplate),
    generatedImage: section.generatedImage,
    imageQualityReport: section.imageQualityReport,
    providerProof: section.providerProof
  };
}

function buildDefaultEditableLayers(sectionId: string, layoutTemplate: PdpLayoutTemplate): PdpEditableLayer[] {
  const isHero = layoutTemplate === "hero";
  const isFaq = layoutTemplate === "faq-cta";
  return [
    {
      id: `${sectionId}-background`,
      kind: "background",
      name: "Background artwork",
      sectionId,
      editable: false,
      zIndex: 0,
      bounds: { x: 0, y: 0, width: 100, height: 100, unit: "percent" }
    },
    {
      id: `${sectionId}-product`,
      kind: "product",
      name: "Product or software visual",
      sectionId,
      editable: false,
      zIndex: 10,
      bounds: { x: isHero ? 12 : 10, y: isHero ? 26 : 20, width: isHero ? 76 : 80, height: isFaq ? 34 : 48, unit: "percent" }
    },
    {
      id: `${sectionId}-headline`,
      kind: "text",
      name: "Headline text",
      sectionId,
      editable: true,
      role: "headline",
      zIndex: 20,
      bounds: { x: 8, y: isHero ? 8 : 7, width: 84, height: 14, unit: "percent" }
    },
    {
      id: `${sectionId}-support-copy`,
      kind: "text",
      name: "Support copy and bullets",
      sectionId,
      editable: true,
      role: "body",
      zIndex: 21,
      bounds: { x: 8, y: isHero ? 70 : 68, width: 84, height: isFaq ? 17 : 20, unit: "percent" }
    },
    {
      id: `${sectionId}-cta`,
      kind: "cta",
      name: "CTA button",
      sectionId,
      editable: true,
      role: "cta",
      zIndex: 22,
      bounds: { x: 24, y: 90, width: 52, height: 7, unit: "percent" }
    }
  ];
}

function buildLayeredDocument(blueprint: LandingPageBlueprint): PdpLayeredDocument {
  return {
    version: 1,
    format: "pdp-layered-document",
    sections: blueprint.sections.map((section) => ({
      sectionId: section.section_id,
      backgroundImageId: section.image_id,
      layers: section.editableLayers ?? buildDefaultEditableLayers(section.section_id, section.layout_template ?? "benefit")
    }))
  };
}

type RawCopyInputs = {
  productDescription: string;
  additionalInfo: string;
};

type CopyFieldKind = "headline" | "subheadline" | "bullet" | "trust" | "cta";

const COPY_FIELD_LIMITS: Record<CopyFieldKind, number> = {
  headline: 22,
  subheadline: 44,
  bullet: 18,
  trust: 28,
  cta: 10
};

function mergeRefinedCopyIntoBlueprint(
  blueprint: LandingPageBlueprint,
  refinement: StoryCopyRefinementJson,
  brief: ProductBrief,
  rawInputs: RawCopyInputs
): LandingPageBlueprint {
  const byId = new Map(refinement.sections.map((section) => [normalizeCopyToken(section.section_id), section]));

  return {
    ...blueprint,
    sections: blueprint.sections.map((section, index) => {
      const refined = byId.get(normalizeCopyToken(section.section_id)) ?? refinement.sections[index];
      const fallback = buildDeterministicSectionCopy(section, index, brief, undefined, rawInputs);
      const bullets = sanitizeRefinedBullets(refined?.bullets, fallback.bullets, rawInputs);
      const bulletsEn = sanitizeRefinedBullets(refined?.bullets_en, fallback.bullets_en, rawInputs);

      return {
        ...section,
        headline: chooseRefinedCopy(refined?.headline, fallback.headline, "headline", rawInputs),
        headline_en: chooseRefinedCopy(refined?.headline_en, fallback.headline_en, "headline", rawInputs),
        subheadline: chooseRefinedCopy(refined?.subheadline, fallback.subheadline, "subheadline", rawInputs),
        subheadline_en: chooseRefinedCopy(refined?.subheadline_en, fallback.subheadline_en, "subheadline", rawInputs),
        bullets,
        bullets_en: bulletsEn.length ? bulletsEn : bullets,
        trust_or_objection_line: chooseRefinedCopy(refined?.trust_or_objection_line, fallback.trust_or_objection_line, "trust", rawInputs),
        trust_or_objection_line_en: chooseRefinedCopy(refined?.trust_or_objection_line_en, fallback.trust_or_objection_line_en, "trust", rawInputs),
        CTA: chooseRefinedCopy(refined?.CTA, fallback.CTA, "cta", rawInputs),
        CTA_en: chooseRefinedCopy(refined?.CTA_en, fallback.CTA_en, "cta", rawInputs),
        story_role: normalizeStoryRole(refined?.story_role || inferStoryRole(section, index)),
        overlay_layout_hint: section.overlay_layout_hint || buildOverlayLayoutHint(section, index),
        quality_notes: refined?.copy_reason || section.quality_notes || ""
      };
    })
  };
}

function refineBlueprintCopyDeterministically(
  blueprint: LandingPageBlueprint,
  brief: ProductBrief,
  assetSummary: AssetSummary | undefined,
  rawInputs: RawCopyInputs
): LandingPageBlueprint {
  return {
    ...blueprint,
    sections: blueprint.sections.map((section, index) => ({
      ...section,
      ...buildDeterministicSectionCopy(section, index, brief, assetSummary, rawInputs)
    }))
  };
}

function buildDeterministicSectionCopy(
  section: SectionBlueprint,
  index: number,
  brief: ProductBrief,
  assetSummary: AssetSummary | undefined,
  rawInputs: RawCopyInputs
): Pick<
  SectionBlueprint,
  | "headline"
  | "headline_en"
  | "subheadline"
  | "subheadline_en"
  | "bullets"
  | "bullets_en"
  | "trust_or_objection_line"
  | "trust_or_objection_line_en"
  | "CTA"
  | "CTA_en"
> {
  const subject = compactSubject(brief.productName || assetSummary?.likelyProductName || brief.category || "이 상품");
  const category = compactFactPhrase(brief.category, brief.isSoftware ? "서비스" : "상품");
  const audience = compactAudiencePhrase(brief.targetBuyer, brief.isSoftware ? "도입 검토자" : "구매 고객");
  const feature = compactFactPhrase(brief.coreFeatures[0] || assetSummary?.visibleProductFacts[0], brief.isSoftware ? "핵심 기능" : "핵심 장점");
  const heroValue = buildHeroValuePhrase(brief, assetSummary, category, feature);
  const useCase = compactFactPhrase(brief.useCases[0], brief.isSoftware ? "업무 흐름" : "사용 상황");
  const proof = compactFactPhrase(brief.proofPoints[0], "업로드 자료 기준");
  const support = compactFactPhrase(brief.constraints[0] || brief.proofPoints[1], brief.isSoftware ? "지원 기준" : "AS 기준");
  const sectionNumber = sectionIndexFromId(section.section_id, index);

  const templates = [
    {
      headline: `${subject}, ${heroValue}`,
      subheadline: `${withSubjectParticle(audience)} ${useCase}에서 얻는 변화를 첫 화면에서 바로 이해합니다.`,
      bullets: [heroValue, useCase, support],
      trust: proof,
      cta: brief.isSoftware ? "흐름 보기" : "상세 보기",
      headlineEn: `${subject} at a glance`,
      subheadlineEn: "Show the value and next action in the first viewport.",
      bulletsEn: ["Key value", "Use case", "Check now"],
      trustEn: "Based on uploaded materials",
      ctaEn: "View flow"
    },
    {
      headline: brief.isSoftware ? "도입 전 막힘부터" : "구매 전 고민부터",
      subheadline: `${withSubjectParticle(audience)} 망설이는 지점을 먼저 짚고 ${subject}의 해결 흐름으로 이어갑니다.`,
      bullets: [brief.isSoftware ? "설정 부담" : "비교 피로", "확인 부담", "선택 불안"],
      trust: "과장 없이 문제만 정리",
      cta: "고민 줄이기",
      headlineEn: "Start with the concern",
      subheadlineEn: "Lead from hesitation into a clearer decision path.",
      bulletsEn: ["Less comparison", "Easier checks", "Lower doubt"],
      trustEn: "No exaggerated claims",
      ctaEn: "Reduce doubt"
    },
    {
      headline: `${feature}의 체감 가치`,
      subheadline: `${category} 기능 설명보다 ${withSubjectParticle(audience)} 실제로 얻는 결과를 먼저 보여줍니다.`,
      bullets: [feature, useCase, "바로 체감"],
      trust: "확인된 기능만 사용",
      cta: "장점 보기",
      headlineEn: "What the feature changes",
      subheadlineEn: "Connect features to practical value for the buyer.",
      bulletsEn: ["Core feature", "Use scene", "Value"],
      trustEn: "Only verified functions",
      ctaEn: "See value"
    },
    {
      headline: `${subject} 선택 기준`,
      subheadline: `대안 비교 전에 ${feature}, ${useCase}, ${support}를 기준으로 판단하게 합니다.`,
      bullets: ["선택 이유", feature, support],
      trust: "근거 없는 비교는 제외",
      cta: "기준 확인",
      headlineEn: "Clarify the choice",
      subheadlineEn: "Make the reason to choose clear before comparison.",
      bulletsEn: ["Why choose", "Check criteria", "Best fit"],
      trustEn: "No unsupported comparison",
      ctaEn: "Check fit"
    },
    {
      headline: "근거만 따로 확인",
      subheadline: `${proof}을 별도 영역으로 묶어 구매나 도입 전 의심 지점을 줄입니다.`,
      bullets: [proof, support, "조건 확인"],
      trust: "없는 기능은 제외",
      cta: "근거 보기",
      headlineEn: "Only verified proof",
      subheadlineEn: "Separate the proof area so buyers can check before acting.",
      bulletsEn: ["Proof basis", "Details", "Criteria"],
      trustEn: "No invented features",
      ctaEn: "View proof"
    },
    {
      headline: brief.isSoftware ? "처음 쓰는 흐름" : "사용 장면 한눈에",
      subheadline: brief.isSoftware
        ? `${subject}를 처음 쓰는 사람이 설정, 실행, 결과 확인 순서를 바로 따라갑니다.`
        : `${subject}를 받은 뒤 준비, 사용, 관리 흐름을 자연스럽게 떠올립니다.`,
      bullets: brief.isSoftware ? ["설정", feature, "결과 확인"] : ["준비", useCase, support],
      trust: "실제와 다른 기능 제외",
      cta: "사용법 보기",
      headlineEn: "Show the flow",
      subheadlineEn: "Make first use easy to understand step by step.",
      bulletsEn: brief.isSoftware ? ["First screen", "Main action", "Result"] : ["Setup", "Use scene", "Care"],
      trustEn: "No unreal features",
      ctaEn: "See how"
    },
    {
      headline: `${useCase}에 맞게`,
      subheadline: `${withSubjectParticle(audience)} 자신의 상황에서 ${subject}를 어떻게 활용할지 빠르게 판단합니다.`,
      bullets: brief.useCases.length ? brief.useCases.slice(0, 3).map((item) => compactFactPhrase(item, useCase)) : [useCase, "상황별 판단", "활용 기준"],
      trust: "대상 고객을 좁혀 설명",
      cta: "활용 보기",
      headlineEn: "Fit by situation",
      subheadlineEn: "Show how the same value changes by use case.",
      bulletsEn: ["Use case", "Situation", "Fit"],
      trustEn: "Narrower audience, clearer value",
      ctaEn: "View cases"
    },
    {
      headline: "마지막 걱정 정리",
      subheadline: brief.isSoftware
        ? `권한, 요금, ${support}처럼 도입 직전 확인할 질문을 CTA 앞에 모읍니다.`
        : `배송, 구성, 교환, ${support}처럼 구매 직전 질문을 CTA 앞에 모읍니다.`,
      bullets: brief.isSoftware ? ["권한 범위", "요금 확인", support] : ["배송/교환", "구성 확인", support],
      trust: "정책 문구는 직접 확인",
      cta: "최종 확인",
      headlineEn: "Final checks first",
      subheadlineEn: "Answer the last doubts before the final action.",
      bulletsEn: brief.isSoftware ? ["Access", "Pricing", "Support"] : ["Shipping", "Contents", "Care"],
      trustEn: "Confirm policy details",
      ctaEn: "Final check"
    }
  ];

  const selected = templates[Math.min(sectionNumber - 1, templates.length - 1)];
  return {
    headline: chooseRefinedCopy(selected.headline, `${subject} 핵심 보기`, "headline", rawInputs),
    headline_en: cleanVisibleCopy(selected.headlineEn, "headline"),
    subheadline: chooseRefinedCopy(selected.subheadline, `${subject}의 핵심 가치와 확인 포인트를 짧게 정리합니다.`, "subheadline", rawInputs),
    subheadline_en: cleanVisibleCopy(selected.subheadlineEn, "subheadline"),
    bullets: sanitizeRefinedBullets(selected.bullets, [feature, useCase, proof], rawInputs),
    bullets_en: sanitizeRefinedBullets(selected.bulletsEn, ["Key value", "Use case", "Proof"], rawInputs),
    trust_or_objection_line: chooseRefinedCopy(selected.trust, "확인 가능한 자료 기준", "trust", rawInputs),
    trust_or_objection_line_en: cleanVisibleCopy(selected.trustEn, "trust"),
    CTA: chooseRefinedCopy(selected.cta, "자세히 보기", "cta", rawInputs),
    CTA_en: cleanVisibleCopy(selected.ctaEn, "cta")
  };
}

function chooseRefinedCopy(value: string | undefined, fallback: string, kind: CopyFieldKind, rawInputs: RawCopyInputs) {
  const cleaned = cleanVisibleCopy(value, kind);
  if (!cleaned || isGenericCopy(cleaned) || isTooCloseToUserCopy(cleaned, rawInputs)) {
    return cleanVisibleCopy(fallback, kind);
  }
  return cleaned;
}

function sanitizeRefinedBullets(value: unknown, fallback: string[], rawInputs: RawCopyInputs) {
  const bullets = normalizeStringArray(value, [])
    .map((bullet) => cleanVisibleCopy(bullet, "bullet"))
    .filter((bullet) => bullet && !isGenericCopy(bullet) && !isTooCloseToUserCopy(bullet, rawInputs));
  const fallbackBullets = fallback.map((bullet) => cleanVisibleCopy(bullet, "bullet")).filter(Boolean);
  return cleanStringList([...bullets, ...fallbackBullets]).slice(0, 3);
}

function shouldForceHeroProductName(headline: string, productName: string | undefined) {
  const subject = compactSubject(productName || "");
  if (!subject || subject === "이 상품") return false;
  return !normalizeCopyToken(headline).includes(normalizeCopyToken(subject));
}

function buildBrandedHeroHeadline(brief: ProductBrief, fallbackHeadline: string) {
  const subject = compactSubject(brief.productName);
  if (!subject || subject === "이 상품") return "";
  const category = compactFactPhrase(brief.category, brief.isSoftware ? "서비스" : "상품");
  const feature = compactFactPhrase(brief.coreFeatures[0], brief.isSoftware ? "핵심 기능" : "핵심 장점");
  const heroValue = buildHeroValuePhrase(brief, undefined, category, feature);
  return cleanVisibleCopy(`${subject}, ${heroValue}`, "headline") || cleanVisibleCopy(fallbackHeadline, "headline");
}

function buildHeroValuePhrase(
  brief: ProductBrief,
  assetSummary: AssetSummary | undefined,
  category: string,
  feature: string
) {
  const candidates = [
    category,
    compactFactPhrase(assetSummary?.visibleProductFacts.find((fact) => /카운터|대시보드|앱|서비스|도구|관리|분석|자동화|연동|루틴|세트|키트|크림|팩|식품|소재/.test(fact)), ""),
    feature,
    compactFactPhrase(brief.useCases[0], "")
  ]
    .map((candidate) => cleanVisibleCopy(candidate, "headline"))
    .filter(Boolean)
    .filter((candidate) => !isWeakHeroValuePhrase(candidate, brief.isSoftware));

  return candidates[0] || feature || (brief.isSoftware ? "도입 흐름" : "핵심 장점");
}

function isWeakHeroValuePhrase(value: string, isSoftware: boolean) {
  const normalized = normalizeCopyToken(value);
  if (!normalized) return true;
  const weak = isSoftware
    ? new Set(["서비스", "소프트웨어", "앱", "웹서비스", "핵심기능", "주요기능", "도입흐름"])
    : new Set(["상품", "제품", "핵심장점", "주요장점", "구매고객"]);
  if (weak.has(normalized)) return true;
  return /^(핵심|주요|대표)?(기능|장점|가치|특징)$/.test(normalized);
}

function cleanVisibleCopy(value: string | undefined, kind: CopyFieldKind) {
  const limit = COPY_FIELD_LIMITS[kind];
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\bCTA\b/gi, "")
    .replace(/^[-•·ㆍ*\s]+/, "")
    .replace(/\s+([,.!?。！？])/g, "$1")
    .trim();

  if (!normalized) return "";
  const humanized = humanizeKoreanCopy(normalized, {
    kind: toKoreanHumanizeKind(kind),
    maxLength: limit
  });
  const withoutTerminal = removeDanglingCopyEnding(kind === "headline" || kind === "cta" ? humanized.replace(/[.!?。！？]+$/g, "") : humanized);
  if (withoutTerminal.length <= limit) return withoutTerminal;
  return removeDanglingCopyEnding(trimCopyAtBoundary(withoutTerminal, limit));
}

function toKoreanHumanizeKind(kind: CopyFieldKind): KoreanCopyKind {
  return kind === "bullet" || kind === "cta" || kind === "headline" || kind === "subheadline" || kind === "trust"
    ? kind
    : "body";
}

function trimCopyAtBoundary(value: string, limit: number) {
  const sliced = value.slice(0, limit + 1);
  const boundary = Math.max(sliced.lastIndexOf(" "), sliced.lastIndexOf(","), sliced.lastIndexOf("·"), sliced.lastIndexOf("/"));
  const trimmed = boundary >= Math.floor(limit * 0.55) ? sliced.slice(0, boundary) : value.slice(0, limit);
  return trimmed.replace(/[,:：·ㆍ/\-\s]+$/g, "").trim();
}

function removeDanglingCopyEnding(value: string) {
  let cleaned = value.trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = cleaned
      .replace(/\s+(편이|경우|때문에|위해|따라|전에|처럼|하며|하고|되고|되는|하는|있는|없는)$/g, "")
      .replace(/(할\s*수|볼\s*수|쓸\s*수|줄\s*수|될\s*수|편이|경우|때문에|위해|따라|따른|전에|처럼|하며|하고|되고|되는|하는|있는|없는|보여주는|만드는|제공하는|지원하는|연동되는|연동된|기반으로|기반|으로만|로만)$/g, "")
      .replace(/[,:：·ㆍ/\-\s]+$/g, "")
      .trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  return cleaned;
}

function isVerbatimUserCopy(value: string, rawInputs: RawCopyInputs) {
  const normalized = normalizeLooseCopy(value);
  if (normalized.length < 10) return false;
  const source = normalizeLooseCopy([rawInputs.productDescription, rawInputs.additionalInfo].filter(Boolean).join("\n"));
  if (!source) return false;
  if (source.includes(normalized)) return true;
  return splitCopyClauses(value).some((clause) => {
    const normalizedClause = normalizeLooseCopy(clause);
    return normalizedClause.length >= 10 && source.includes(normalizedClause);
  });
}

function isTooCloseToUserCopy(value: string, rawInputs: RawCopyInputs) {
  if (isVerbatimUserCopy(value, rawInputs)) return true;
  const sourceTokens = meaningfulCopyTokens([rawInputs.productDescription, rawInputs.additionalInfo].filter(Boolean).join(" "));
  if (sourceTokens.length < 6) return false;
  const valueTokens = meaningfulCopyTokens(value);
  if (valueTokens.length < 4) return false;
  const sourceSet = new Set(sourceTokens);
  const overlap = valueTokens.filter((token) => sourceSet.has(token)).length;
  return overlap >= Math.max(4, Math.ceil(valueTokens.length * 0.8));
}

function normalizeLooseCopy(value: string) {
  return value.toLowerCase().replace(/[\s\r\n\t.,!?。！？:：;'"`~()[\]{}<>·ㆍ/_|\\-]+/g, "");
}

function meaningfulCopyTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[\s\r\n\t.,!?。！？:：;'"`~()[\]{}<>·ㆍ/_|\\-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !COPY_TOKEN_STOPWORDS.has(normalizeCopyToken(token)));
}

function splitCopyClauses(value: string) {
  return value
    .split(/[,.!?。！？\n]|(?:\s+(?:그리고|또는|및|으로|해서|하며|하고)\s+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function compactSubject(value: string) {
  const cleaned = cleanVisibleCopy(value, "headline");
  if (!cleaned) return "이 상품";
  if (cleaned.length <= 16) return cleaned;
  const firstToken = cleaned.split(/\s+/).find((token) => token.length >= 2 && token.length <= 16);
  return firstToken || "이 상품";
}

function compactFactPhrase(value: string | undefined, fallback: string) {
  const cleaned = cleanVisibleCopy(value, "bullet");
  if (!cleaned) return fallback;

  const tokens = cleaned
    .split(/[\s,/·ㆍ|]+/)
    .map((token) =>
      token
        .replace(/(은|는|이|가|을|를|에|에서|으로|로|와|과|도|만|의)$/g, "")
        .replace(/(됩니다|합니다|해주는|되어요|되는|하는)$/g, "")
    )
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !FACT_PHRASE_STOPWORDS.has(normalizeCopyToken(token)));

  const compacted = tokens.slice(0, 4).join(" ");
  return cleanVisibleCopy(compacted || cleaned, "bullet") || fallback;
}

function compactAudiencePhrase(value: string | undefined, fallback: string) {
  const cleaned = cleanVisibleCopy(value, "trust");
  if (!cleaned) return fallback;
  const tokens = cleaned
    .split(/[\s,/·ㆍ|]+/)
    .map((token) =>
      token
        .replace(/(은|는|이|가|을|를|에|에서|으로|로|와|과|도|만|의)$/g, "")
        .replace(/(운영하는|검토하는|고민하는|사용하는|구매하는|찾는)$/g, "")
    )
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !FACT_PHRASE_STOPWORDS.has(normalizeCopyToken(token)));
  const roleToken = [...tokens].reverse().find((token) => /스트리머|운영자|담당자|판매자|구매자|고객|사용자|팀|브랜드|크리에이터/.test(token));
  if (roleToken) {
    const context = tokens.filter((token) => token !== roleToken).slice(0, 2);
    return cleanVisibleCopy([...context, roleToken].join(" "), "bullet") || roleToken;
  }
  return cleanVisibleCopy(tokens.slice(0, 3).join(" ") || cleaned, "bullet") || fallback;
}

function withSubjectParticle(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return cleaned;
  return `${cleaned}${hasKoreanFinalConsonant(cleaned) ? "이" : "가"}`;
}

function hasKoreanFinalConsonant(value: string) {
  const last = Array.from(value).reverse().find((char) => /[가-힣]/.test(char));
  if (!last) return false;
  const code = last.charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

function sectionIndexFromId(sectionId: string, fallbackIndex: number) {
  const match = sectionId.match(/\d+/);
  if (!match) return fallbackIndex + 1;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackIndex + 1;
}

const FACT_PHRASE_STOPWORDS = new Set([
  "그리고",
  "또는",
  "바로",
  "따라",
  "통해",
  "위해",
  "대한",
  "합니다",
  "됩니다",
  "있는",
  "없는",
  "자동으로",
  "자동",
  "깔끔하게",
  "따른",
  "기반",
  "확인",
  "사용",
  "상품",
  "서비스"
]);

const COPY_TOKEN_STOPWORDS = new Set([
  "그리고",
  "또는",
  "및",
  "바로",
  "따라",
  "통해",
  "위해",
  "대한",
  "합니다",
  "됩니다",
  "있는",
  "없는",
  "자동으로",
  "자동",
  "깔끔하게",
  "따른",
  "기반",
  "상품",
  "제품",
  "서비스",
  "기능",
  "고객",
  "사용"
]);

function validateAndSanitizeCopy(blueprint: LandingPageBlueprint, brief: ProductBrief, rawInputs?: RawCopyInputs) {
  const warnings: CopyWarning[] = [];
  const factTerms = buildFactTerms(brief);
  const seenHeadlines = new Set<string>();
  const sections = blueprint.sections.map((section, index) => {
    const next = { ...section };
    const fallback = buildDeterministicSectionCopy(section, index, brief, undefined, rawInputs ?? { productDescription: "", additionalInfo: "" });

    for (const field of ["headline", "subheadline", "trust_or_objection_line", "CTA"] as const) {
      const kind: CopyFieldKind =
        field === "headline" ? "headline" : field === "subheadline" ? "subheadline" : field === "CTA" ? "cta" : "trust";
      const fallbackValue = field === "trust_or_objection_line" ? fallback.trust_or_objection_line : fallback[field];
      const originalValue = next[field];
      next[field] = chooseRefinedCopy(originalValue, fallbackValue, kind, rawInputs ?? { productDescription: "", additionalInfo: "" });
      if (field === "headline" && index === 0 && shouldForceHeroProductName(next[field], brief.productName)) {
        const brandedHeadline = buildBrandedHeroHeadline(brief, fallback.headline);
        if (brandedHeadline) {
          next[field] = brandedHeadline;
          warnings.push({
            sectionId: next.section_id,
            field,
            severity: "warning",
            message: "첫 화면 헤드라인에 상품명이 빠져 브랜드 식별 가능한 카피로 보정했습니다."
          });
        }
      }
      const value = next[field];
      if (!value) continue;
      if (originalValue && originalValue !== value) {
        warnings.push({
          sectionId: next.section_id,
          field,
          severity: "warning",
          message: "텍스트 레이어에 맞도록 긴 문장 또는 원문 복붙 문구를 짧은 전환 카피로 정리했습니다."
        });
      }
      if (isGenericCopy(value)) {
        warnings.push({
          sectionId: next.section_id,
          field,
          severity: "error",
          message: `"${value}"는 섹션명 또는 placeholder에 가까워 텍스트 레이어에서 제외했습니다.`
        });
        next[field] = "";
      } else if (field === "headline" && seenHeadlines.has(normalizeCopyToken(value))) {
        warnings.push({
          sectionId: next.section_id,
          field,
          severity: "warning",
          message: "중복 헤드라인을 섹션 역할에 맞는 기본 카피로 교체했습니다."
        });
        next[field] = fallback.headline;
      } else if (field === "headline" && factTerms.length && !copyConnectsToFacts(value, factTerms)) {
        warnings.push({
          sectionId: next.section_id,
          field,
          severity: "warning",
          message: "헤드라인이 상품 브리프의 제품명/카테고리/사용상황/기능과 직접 연결되지 않을 수 있습니다."
        });
      }
      if (field === "headline" && next[field]) {
        seenHeadlines.add(normalizeCopyToken(next[field]));
      }
    }

    next.bullets = sanitizeRefinedBullets(next.bullets, fallback.bullets, rawInputs ?? { productDescription: "", additionalInfo: "" }).filter((bullet) => {
      if (!isGenericCopy(bullet)) return true;
      warnings.push({
        sectionId: next.section_id,
        field: "bullets",
        severity: "error",
        message: `"${bullet}"는 placeholder에 가까워 불릿에서 제외했습니다.`
      });
      return false;
    });
    next.bullets_en = sanitizeRefinedBullets(next.bullets_en, fallback.bullets_en, rawInputs ?? { productDescription: "", additionalInfo: "" });

    if (!next.source_fact_refs?.length) {
      next.source_fact_refs = buildDefaultSourceFactRefs(brief);
    }

    return next;
  });
  const roleAdjustedSections = enforceConversionRoleCoverage(sections);

  return {
    sanitizedBlueprint: {
      ...blueprint,
      sections: roleAdjustedSections
    },
    warnings
  };
}

const CONVERSION_LAYOUT_SEQUENCE: PdpLayoutTemplate[] = ["hero", "problem", "benefit", "spec", "proof", "demo", "use-case", "faq-cta"];
const COMPACT_CONVERSION_LAYOUT_SEQUENCE: PdpLayoutTemplate[] = ["hero", "problem", "benefit", "proof", "demo", "faq-cta"];

function enforceConversionRoleCoverage(sections: SectionBlueprint[]) {
  const sequence = sections.length >= 8 ? CONVERSION_LAYOUT_SEQUENCE : COMPACT_CONVERSION_LAYOUT_SEQUENCE;
  return sections.map((section, index) => {
    const targetLayout = index === sections.length - 1 ? "faq-cta" : sequence[Math.min(index, sequence.length - 1)];
    const roleAdjustedSection = { ...section, layout_template: targetLayout };
    const targetRole = normalizeStoryRole(inferStoryRole(roleAdjustedSection, index));
    return {
      ...section,
      layout_template: targetLayout,
      goal: section.goal || conversionRoleGoal(targetLayout),
      purpose: section.purpose || conversionRoleGoal(targetLayout),
      layout_notes: ensureTextSafeLayoutNotes(section.layout_notes),
      prompt_ko: ensureTextSafePrompt(section.prompt_ko),
      prompt_en: ensureTextSafePrompt(section.prompt_en),
      story_role: targetRole,
      overlay_layout_hint: section.overlay_layout_hint || buildOverlayLayoutHint(roleAdjustedSection, index)
    };
  });
}

function buildDefaultSourceFactRefs(brief: ProductBrief) {
  return cleanStringList([
    brief.productName,
    brief.category,
    brief.targetBuyer,
    brief.coreFeatures[0],
    brief.useCases[0],
    brief.proofPoints[0]
  ]).slice(0, 4);
}

function conversionRoleGoal(layout: PdpLayoutTemplate) {
  switch (layout) {
    case "hero":
      return "첫 화면에서 제품 정체와 핵심 가치를 즉시 이해시킵니다.";
    case "problem":
      return "고객이 도입 또는 구매 전에 겪는 불편을 먼저 짚습니다.";
    case "benefit":
      return "핵심 기능을 고객이 얻는 변화와 이점으로 번역합니다.";
    case "spec":
      return "선택 기준과 확인 포인트를 구조적으로 보여줍니다.";
    case "proof":
      return "업로드 자료와 확인 가능한 근거만 별도 영역으로 제시합니다.";
    case "demo":
      return "처음 사용하는 흐름을 단계적으로 이해시킵니다.";
    case "use-case":
      return "고객 상황별 활용 장면을 분리해 적합성을 판단하게 합니다.";
    case "faq-cta":
      return "마지막 불안을 정리하고 다음 행동으로 연결합니다.";
  }
}

function ensureTextSafeLayoutNotes(value: string) {
  const note = value?.trim() || "";
  if (/app-composited|composite|합성|editable|카피|텍스트|safe/i.test(note)) return note;
  return `${note ? `${note} ` : ""}앱이 헤드라인, 불릿, CTA를 합성해도 읽히는 고대비 여백과 패널을 남깁니다.`.trim();
}

function ensureTextSafePrompt(value: string) {
  const prompt = value?.trim() || "";
  if (/app-composited|composite|합성|editable|카피|텍스트|safe/i.test(prompt)) return prompt;
  return `${prompt ? `${prompt} ` : ""}한글 문구는 이미지 모델이 직접 그리지 않고 앱이 합성하므로, 선명한 상세페이지 모듈과 고대비 텍스트 영역을 만든다.`.trim();
}

function buildPdpQualityReport(input: {
  blueprint: LandingPageBlueprint;
  productBrief: ProductBrief;
  copyWarnings: CopyWarning[];
  productDescription: string;
  additionalInfo: string;
}): PdpQualityReport {
  const issues: PdpQualityIssue[] = [];
  const sections = input.blueprint.sections.map((section, index) => evaluateSectionQuality(section, index, input));
  sections.forEach((section) => issues.push(...section.issues));

  if (input.blueprint.sections.length < 6) {
    issues.push({
      category: "story",
      severity: "major",
      message: "상세페이지 섹션 수가 부족해 구매 설득 흐름이 짧습니다.",
      fix: "후킹, 문제, 해결, 근거, 사용법, FAQ/CTA가 모두 보이도록 최소 6개 섹션으로 재생성하세요."
    });
  }

  if (!input.productDescription.trim()) {
    issues.push({
      category: "input",
      severity: "major",
      message: "사용자가 직접 입력한 상품 사실 정보가 부족합니다.",
      fix: "상품명, 대상 고객, 핵심 기능, 사용 상황, 금지 주장, 배송/AS 또는 도입 조건을 입력하세요."
    });
  }

  const expectedRoles = ["hook", "problem", "benefit", "reason", "proof", "demo", "usecase", "cta"] as const;
  const roleCoverage = new Set(input.blueprint.sections.map((section, index) => inferStoryRole(section, index)));
  const missingRoles = expectedRoles.filter((role) => !roleCoverage.has(role));
  if (missingRoles.includes("problem") || missingRoles.includes("proof") || missingRoles.includes("cta")) {
    issues.push({
      category: "story",
      severity: "major",
      message: "문제 공감, 근거, 최종 CTA 중 일부 설득 단계가 약합니다.",
      fix: "섹션 목적이 겹치지 않도록 문제-해결-근거-불안해소-CTA 순서를 보강하세요."
    });
  }

  const duplicateHeadlineCount = countDuplicateHeadlineIdeas(input.blueprint.sections);
  if (duplicateHeadlineCount) {
    issues.push({
      category: "story",
      severity: duplicateHeadlineCount >= 2 ? "major" : "minor",
      message: `비슷한 헤드라인 주장이 ${duplicateHeadlineCount + 1}개 이상 반복됩니다.`,
      fix: "각 섹션이 문제, 베네핏, 선택 이유, 신뢰, 사용 흐름 중 하나만 맡도록 헤드라인을 다시 분리하세요."
    });
  }

  if (!hasStrongStoryArc(input.blueprint.sections)) {
    issues.push({
      category: "story",
      severity: "major",
      message: "상세페이지 흐름이 고객 질문 순서대로 이어지지 않습니다.",
      fix: "첫 화면 후킹 다음에 문제, 해결, 선택 이유, 신뢰, 사용법, 불안 해소, CTA 순서가 보이게 재구성하세요."
    });
  }

  const actionableWarnings = input.copyWarnings.filter(isActionableCopyWarning);
  const errorWarnings = actionableWarnings.filter((warning) => warning.severity === "error").length;
  const warningCount = actionableWarnings.length;
  const issuePenalty = issues.reduce((total, issue) => total + (issue.severity === "critical" ? 22 : issue.severity === "major" ? 12 : 5), 0);
  const sectionAverage = sections.length
    ? Math.round(sections.reduce((total, section) => total + section.score, 0) / sections.length)
    : 0;
  const score = clampScore(sectionAverage - issuePenalty - errorWarnings * 10 - warningCount * 2);
  const status = getQualityStatus(score, issues);
  const strengths = buildQualityStrengths(input.blueprint, input.productBrief, sections);
  const nextActions = buildQualityNextActions(status, issues);

  return {
    overallScore: score,
    status,
    summary: buildQualitySummary(score, status, input.blueprint.sections.length),
    strengths,
    nextActions,
    issues: issues.slice(0, 12),
    sections
  };
}

function isActionableCopyWarning(warning: CopyWarning) {
  if (warning.severity === "error") return true;
  const message = warning.message || "";
  if (warning.field === "source_fact_refs") return true;
  if (warning.field === "copy_refinement") return false;
  if (/보정했습니다|정리했습니다|상품명이 빠져/.test(message)) return false;
  return /약합니다|부족|placeholder|중복|원문|근거|연결되지/.test(message);
}

function evaluateSectionQuality(
  section: SectionBlueprint,
  index: number,
  input: {
    blueprint: LandingPageBlueprint;
    productBrief: ProductBrief;
    copyWarnings: CopyWarning[];
    productDescription: string;
    additionalInfo: string;
  }
) {
  const issues: PdpQualityIssue[] = [];
  const checks: string[] = [];
  let score = 100;
  const role = normalizeStoryRole(section.story_role || inferStoryRole(section, index));
  const rawInputs = { productDescription: input.productDescription, additionalInfo: input.additionalInfo };

  if (section.headline && section.headline.length <= COPY_FIELD_LIMITS.headline) {
    checks.push("헤드라인 길이 적정");
  } else {
    score -= 14;
    issues.push({
      sectionId: section.section_id,
      category: "copy",
      severity: "major",
      message: "헤드라인이 비어 있거나 편집 레이어에 비해 깁니다.",
      fix: "8-22자 중심의 짧은 결과/상황형 헤드라인으로 줄이세요."
    });
  }

  if (section.subheadline && section.subheadline.length <= COPY_FIELD_LIMITS.subheadline) {
    checks.push("서브카피 길이 적정");
  } else {
    score -= 9;
    issues.push({
      sectionId: section.section_id,
      category: "copy",
      severity: "minor",
      message: "서브카피가 없거나 한 줄에서 읽기 어렵습니다.",
      fix: "고객 상황과 선택 이유가 보이는 24-44자 문장으로 정리하세요."
    });
  }

  const usableBullets = section.bullets.filter((bullet) => bullet && bullet.length <= COPY_FIELD_LIMITS.bullet);
  if (usableBullets.length >= 2) {
    checks.push("스캔 가능한 불릿");
  } else {
    score -= 8;
    issues.push({
      sectionId: section.section_id,
      category: "copy",
      severity: "minor",
      message: "불릿이 부족하거나 길어 모바일에서 스캔하기 어렵습니다.",
      fix: "8-18자 불릿 2-3개로 기능, 상황, 확인 포인트를 분리하세요."
    });
  }

  if (section.source_fact_refs?.length || copyConnectsToFacts([section.headline, section.subheadline, ...section.bullets].join(" "), buildFactTerms(input.productBrief))) {
    checks.push("상품 사실 연결");
  } else {
    score -= 12;
    issues.push({
      sectionId: section.section_id,
      category: "proof",
      severity: role === "proof" ? "major" : "minor",
      message: "이 섹션의 카피가 상품 브리프나 업로드 근거와 약하게 연결됩니다.",
      fix: "상품명, 대상 고객, 기능, 사용 상황, 증빙 이미지 중 하나를 카피에 직접 반영하세요."
    });
  }

  if (role === "proof" && !section.trust_or_objection_line && !input.productBrief.proofPoints.length) {
    score -= 10;
    issues.push({
      sectionId: section.section_id,
      category: "proof",
      severity: "major",
      message: "근거 섹션인데 검증 가능한 신뢰 단서가 부족합니다.",
      fix: "업로드한 증빙 자료, 실제 화면, 정책, 구성품처럼 확인 가능한 근거만 넣으세요."
    });
  }

  if (isVerbatimUserCopy(section.headline, rawInputs) || isVerbatimUserCopy(section.subheadline, rawInputs)) {
    score -= 16;
    issues.push({
      sectionId: section.section_id,
      category: "copy",
      severity: "major",
      message: "사용자 입력 문장이 고객용 카피로 그대로 남아 있을 가능성이 있습니다.",
      fix: "원문 설명을 기능 메모로만 쓰고 고객이 얻는 결과 중심으로 다시 쓰세요."
    });
  }

  if (/app-composited|composite|합성|editable|카피|텍스트|safe|고대비/i.test([section.prompt_ko, section.prompt_en, section.layout_notes, section.overlay_layout_hint ?? ""].join(" "))) {
    checks.push("합성 텍스트 영역 지시");
  } else {
    score -= 8;
    issues.push({
      sectionId: section.section_id,
      category: "visual",
      severity: "minor",
      message: "이미지 프롬프트에 앱 합성 카피가 들어갈 고대비 영역 지시가 약합니다.",
      fix: "이미지 모델은 문구를 직접 그리지 않고, 앱이 헤드라인/불릿/CTA를 합성할 패널과 여백을 명시하세요."
    });
  }

  const roleIssue = evaluateRoleSpecificCopy(section, role);
  if (roleIssue) {
    score -= roleIssue.severity === "major" ? 12 : 6;
    issues.push(roleIssue);
  } else {
    checks.push("섹션 역할별 카피 적합");
  }

  if (!section.CTA || section.CTA.length > COPY_FIELD_LIMITS.cta || isGenericCopy(section.CTA)) {
    score -= 8;
    issues.push({
      sectionId: section.section_id,
      category: "copy",
      severity: role === "cta" ? "major" : "minor",
      message: "CTA가 없거나 고객 행동을 분명하게 만들지 못합니다.",
      fix: "4-10자 수준의 행동형 문구로 바꾸세요. 예: 확인하기, 시작하기, 도입 문의."
    });
  } else {
    checks.push("CTA 행동 명확");
  }

  const sectionWarnings = input.copyWarnings.filter((warning) => warning.sectionId === section.section_id && isActionableCopyWarning(warning));
  if (sectionWarnings.length) {
    score -= Math.min(18, sectionWarnings.length * 6);
    issues.push({
      sectionId: section.section_id,
      category: "risk",
      severity: sectionWarnings.some((warning) => warning.severity === "error") ? "major" : "minor",
      message: `카피 검증 경고가 ${sectionWarnings.length}건 있습니다.`,
      fix: "섹션별 카피 탭에서 경고 문구를 확인하고 보강하세요."
    });
  }

  return {
    sectionId: section.section_id,
    score: clampScore(score),
    status: getQualityStatus(score, issues),
    checks,
    issues: issues.slice(0, 5)
  };
}

function inferStoryRole(section: SectionBlueprint, index: number) {
  if (index === 0 || section.layout_template === "hero") return "hook";
  if (section.layout_template === "problem") return "problem";
  if (section.layout_template === "benefit") return "benefit";
  if (section.layout_template === "spec") return "reason";
  if (section.layout_template === "proof") return "proof";
  if (section.layout_template === "demo") return "demo";
  if (section.layout_template === "use-case") return "usecase";
  if (section.layout_template === "faq-cta") return "cta";
  const text = normalizeCopyToken([section.section_id, section.section_name, section.layout_template, section.goal, section.purpose].filter(Boolean).join(" "));
  if (/(faq|cta|objection|final|질문|마지막|최종)/.test(text)) return "cta";
  if (/(hero|hook|첫화면|히어로)/.test(text)) return "hook";
  if (/(problem|pain|concern|문제|고민|불안)/.test(text)) return "problem";
  if (/(proof|trust|evidence|근거|신뢰|증빙|스펙|구성|조건)/.test(text)) return "proof";
  if (/(demo|workflow|howto|usage|사용법|데모|흐름)/.test(text)) return "demo";
  if (/(usecase|situation|case|상황|활용)/.test(text)) return "usecase";
  if (/(reason|selection|why|선택|이유|차별)/.test(text)) return "reason";
  if (/(benefit|feature|value|장점|베네핏|기능)/.test(text)) return "benefit";
  return index >= 7 ? "cta" : index >= 5 ? "demo" : index >= 4 ? "proof" : index >= 3 ? "reason" : "benefit";
}

type PdpStoryRole = "hook" | "problem" | "benefit" | "reason" | "proof" | "demo" | "usecase" | "cta";

function normalizeStoryRole(value: string): PdpStoryRole {
  const normalized = normalizeCopyToken(value);
  if (/(hook|hero|first|첫화면|후킹|히어로)/.test(normalized)) return "hook";
  if (/(problem|pain|concern|문제|고민|불편|불안)/.test(normalized)) return "problem";
  if (/(reason|selection|why|choice|선택|이유|기준|차별)/.test(normalized)) return "reason";
  if (/(proof|trust|evidence|review|cert|number|근거|신뢰|후기|인증|수치|증빙|스펙)/.test(normalized)) return "proof";
  if (/(demo|workflow|howto|usage|step|사용법|흐름|설치|도입)/.test(normalized)) return "demo";
  if (/(usecase|situation|scenario|case|상황|활용|역할)/.test(normalized)) return "usecase";
  if (/(cta|faq|objection|final|마지막|질문|구매|문의|시작)/.test(normalized)) return "cta";
  return "benefit";
}

function buildOverlayLayoutHint(section: SectionBlueprint, index: number) {
  const role = normalizeStoryRole(section.story_role || inferStoryRole(section, index));
  switch (role) {
    case "hook":
      return "상단 좌측 대형 헤드라인, 바로 아래 서브카피, 하단 CTA/신뢰 칩";
    case "problem":
      return "상단 문제 헤드라인, 중하단 체크리스트형 불릿 카드";
    case "reason":
      return "상단 선택 이유 헤드라인, 우측 또는 하단 비교/기준 카드";
    case "proof":
      return "상단 신뢰 헤드라인, 중단 리뷰/인증/수치형 proof 카드, 하단 CTA";
    case "demo":
      return "상단 사용 흐름 헤드라인, 중단 2-3단계 스텝 라벨, 하단 결과/CTA";
    case "usecase":
      return "상단 상황별 헤드라인, 중하단 역할/상황 카드 2-3개";
    case "cta":
      return "상단 마지막 불안 해소 헤드라인, 중단 FAQ 카드, 하단 넓은 CTA";
    default:
      return "상단 헤드라인, 중단 베네핏 카드, 하단 CTA";
  }
}

function buildRoleVisualDirection(role: PdpStoryRole, template: PdpLayoutTemplate) {
  const base = `Use the ${template} section rhythm and reserve high-contrast surfaces for app-composited Korean text.`;
  switch (role) {
    case "hook":
      return `${base} First-screen hook: strong source-faithful product/screen focus, large top-left copy panel, small proof/CTA area near the bottom.`;
    case "problem":
      return `${base} Problem recognition: checklist or pain-point cards, restrained product/screen support visual, no decorative poster mood.`;
    case "reason":
      return `${base} Choice reason: decision criteria cards or comparison-like panels, product/screen on the side, clear hierarchy for why-to-choose copy.`;
    case "proof":
      return `${base} Trust/proof: review, certification, numeric-proof style card surfaces are allowed as blank visual containers, but readable text is app-composited later.`;
    case "demo":
      return `${base} Usage/demo: 2-3 step workflow, crisp software/browser/mobile frames or practical product usage stages, with step label surfaces.`;
    case "usecase":
      return `${base} Use case: role/situation cards with varied crops and practical context, not another centered hero composition.`;
    case "cta":
      return `${base} Final CTA: FAQ-like question cards and a strong bottom CTA surface that will receive app-composited text.`;
    default:
      return `${base} Benefit: clear benefit cards, product/screen preserved, compact text surfaces for bullets and CTA.`;
  }
}

function evaluateRoleSpecificCopy(section: SectionBlueprint, role: PdpStoryRole): PdpQualityIssue | null {
  const text = normalizeCopyToken([section.headline, section.subheadline, ...section.bullets, section.trust_or_objection_line, section.CTA].join(" "));
  const hasAny = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));
  const rolePatterns: Record<PdpStoryRole, RegExp[]> = {
    hook: [/선택|바로|첫|핵심|한눈|이유|시작|도입|구매/],
    problem: [/불편|고민|문제|수동|번거|놓치|헷갈|걱정|막히|어려/],
    benefit: [/쉽|빠르|줄이|늘리|정리|자동|확인|개선|변화|효율/],
    reason: [/왜|선택|이유|기준|비교|차이|맞는|합리|검토/],
    proof: [/후기|리뷰|인증|수치|근거|신뢰|확인|검증|증빙|평점|만족/],
    demo: [/사용|설치|도입|흐름|단계|처음|바로|연결|완료|확인/],
    usecase: [/상황|활용|대상|고객|팀|방송|업무|역할|내게|맞/],
    cta: [/확인|시작|문의|구매|도입|살펴|보기|상담|신청|체험/]
  };

  if (hasAny(rolePatterns[role])) return null;
  return {
    sectionId: section.section_id,
    category: "story",
    severity: role === "problem" || role === "proof" || role === "cta" ? "major" : "minor",
    message: `${role} 역할에 맞는 설득 단서가 카피에 약합니다.`,
    fix: "섹션 역할이 바로 읽히도록 헤드라인과 불릿에 고객 문제, 선택 이유, 신뢰 단서, 행동 문구를 더 구체적으로 넣으세요."
  };
}

function countDuplicateHeadlineIdeas(sections: SectionBlueprint[]) {
  const seen = new Set<string>();
  let duplicates = 0;
  sections.forEach((section) => {
    const normalized = normalizeCopyToken(section.headline)
      .replace(/(합니다|하세요|보기|확인|정리|보여줍니다|드립니다)$/g, "")
      .slice(0, 12);
    if (normalized.length < 4) return;
    if (seen.has(normalized)) {
      duplicates += 1;
      return;
    }
    seen.add(normalized);
  });
  return duplicates;
}

function hasStrongStoryArc(sections: SectionBlueprint[]) {
  const roles = sections.map((section, index) => normalizeStoryRole(section.story_role || inferStoryRole(section, index)));
  const required = ["hook", "problem", "benefit", "proof", "cta"] as const;
  if (!required.every((role) => roles.includes(role))) return false;
  const roleIndex = (role: PdpStoryRole) => roles.indexOf(role);
  return roleIndex("hook") <= roleIndex("problem") && roleIndex("problem") <= roleIndex("benefit") && roleIndex("benefit") <= roleIndex("proof") && roleIndex("proof") <= roleIndex("cta");
}

function buildQualityStrengths(blueprint: LandingPageBlueprint, brief: ProductBrief, sections: Array<{ score: number; checks: string[] }>) {
  return cleanStringList([
    blueprint.sections.length >= 6 ? "상세페이지형 섹션 흐름이 구성됨" : "",
    brief.productName || brief.category ? "상품 브리프 기반 카피 생성" : "",
    sections.filter((section) => section.score >= 80).length >= Math.ceil(sections.length * 0.6) ? "대부분 섹션의 카피 길이와 근거 연결이 안정적" : "",
    blueprint.sections.some((section) => section.layout_template === "proof" || section.layout_template === "spec") ? "근거/스펙 확인 섹션 포함" : "",
    blueprint.sections.some((section) => section.layout_template === "faq-cta") ? "최종 불안 해소와 CTA 섹션 포함" : "",
    hasStrongStoryArc(blueprint.sections) ? "고객 질문 순서에 맞춘 전환 스토리 구성" : ""
  ]).slice(0, 4);
}

function buildQualityNextActions(status: PdpQualityStatus, issues: PdpQualityIssue[]) {
  if (status === "ready") {
    return ["섹션 이미지를 생성한 뒤 합성된 카피가 한 장의 상세페이지처럼 읽히는지 확인하세요.", "업로드 전 정책/가격/AS 문구처럼 판매 조건이 바뀌는 정보만 최종 검수하세요."];
  }

  const actions = issues
    .filter((issue) => issue.severity !== "minor")
    .map((issue) => issue.fix);
  return cleanStringList(actions.length ? actions : issues.map((issue) => issue.fix)).slice(0, 4);
}

function buildQualitySummary(score: number, status: PdpQualityStatus, sectionCount: number) {
  if (status === "ready") {
    return `품질 점수 ${score}점입니다. ${sectionCount}개 섹션이 유료 초안으로 제시 가능한 수준입니다.`;
  }
  if (status === "blocked") {
    return `품질 점수 ${score}점입니다. 고객에게 제공하기 전에 상품 정보와 카피 근거를 보강해야 합니다.`;
  }
  return `품질 점수 ${score}점입니다. 편집 가능한 초안으로는 사용 가능하지만 고객 제공 전 검수가 필요합니다.`;
}

function getQualityStatus(score: number, issues: PdpQualityIssue[]): PdpQualityStatus {
  if (issues.some((issue) => issue.severity === "critical") || score < 55) return "blocked";
  if (issues.some((issue) => issue.severity === "major") || score < 82) return "needs_review";
  return "ready";
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildImageKnowledgeQuery(section: SectionBlueprint, brief: ProductBrief, productDescription?: string, desiredTone?: string) {
  return [
    "한국 상세페이지 섹션 이미지 생성 앱 합성 텍스트 고대비 영역 제품 보존",
    section.layout_template || section.section_name,
    section.goal,
    section.prompt_ko,
    brief.isSoftware ? "SW SaaS 앱 스크린샷 대시보드 워크플로우 목업 사람 모델 불필요" : "제품컷 디테일컷 증빙컷 구성품 실사용감",
    brief.category,
    brief.coreFeatures.join(" "),
    productDescription || "",
    desiredTone || ""
  ].join("\n");
}

function createGenerationTrace(runId: string): GenerationTrace {
  return {
    runId,
    createdAt: new Date().toISOString(),
    stages: []
  };
}

async function runTraceStage<T>(
  trace: GenerationTrace,
  name: string,
  callback: (step: GenerationTraceStep) => Promise<T>
): Promise<T> {
  const started = Date.now();
  const step: GenerationTraceStep = {
    name,
    status: "ok",
    startedAt: new Date(started).toISOString()
  };
  trace.stages.push(step);

  try {
    return await callback(step);
  } catch (error) {
    step.status = "error";
    step.notes = [...(step.notes ?? []), formatError(error)];
    throw error;
  } finally {
    const ended = Date.now();
    step.endedAt = new Date(ended).toISOString();
    step.durationMs = ended - started;
    if (step.status !== "error" && step.notes?.some((note) => note.toLowerCase().includes("warning"))) {
      step.status = "warning";
    }
  }
}

async function writeRunDebug(runId: string, payload: Record<string, unknown>) {
  try {
    const debugDir = path.join(process.cwd(), ".data", "debug", "runs");
    await fs.mkdir(debugDir, { recursive: true });
    const safeRunId = runId.replace(/[^a-z0-9-]/gi, "-");
    const filename = `${safeRunId}.json`;
    const fullPath = path.join(debugDir, filename);
    await fs.writeFile(fullPath, JSON.stringify({ createdAt: new Date().toISOString(), ...payload }, null, 2), "utf-8");
    return path.relative(process.cwd(), fullPath);
  } catch {
    return "";
  }
}

function normalizeProductBrief(brief: ProductBrief, assetSummary: AssetSummary, desiredTone?: string): ProductBrief {
  const legacyBrief = brief as ProductBrief & {
    targetCustomer?: string;
    keyFacts?: string[];
  };
  const useCases = cleanStringList(brief.useCases);
  const coreFeatures = cleanStringList(brief.coreFeatures).length
    ? cleanStringList(brief.coreFeatures)
    : cleanStringList(legacyBrief.keyFacts);
  const proofPoints = cleanStringList(brief.proofPoints);
  const constraints = cleanStringList(brief.constraints);
  const prohibitedClaims = cleanStringList([...cleanStringList(brief.prohibitedClaims), ...assetSummary.complianceRisks]);
  const missingInfo = cleanStringList([...cleanStringList(brief.missingInfo), ...assetSummary.missingInfo]);

  return {
    ...brief,
    productName: brief.productName || assetSummary.likelyProductName,
    category: brief.category || assetSummary.likelyCategory || (assetSummary.isSoftware ? "소프트웨어/디지털 서비스" : ""),
    targetBuyer: brief.targetBuyer || legacyBrief.targetCustomer || "",
    desiredTone: brief.desiredTone || desiredTone || "",
    isSoftware: brief.isSoftware || assetSummary.isSoftware,
    needsHumanModel: brief.isSoftware || assetSummary.isSoftware ? false : brief.needsHumanModel,
    useCases,
    coreFeatures,
    proofPoints,
    constraints,
    prohibitedClaims,
    channel: brief.channel || "한국 모바일 커머스",
    confidence: brief.confidence || "medium",
    missingInfo
  };
}

function inferSoftwareProduct(value: string) {
  return /(sw|saas|software|web\s*app|app|앱|소프트웨어|웹\s*서비스|웹서비스|대시보드|스크린샷|프로그램|obs|오버레이|브라우저\s*소스|api|연동|스트리머|관리자\s*화면|워크플로우)/i.test(
    value
  );
}

function normalizeRequestProductBrief(brief: ProductBrief | undefined, productDescription?: string, desiredTone?: string): ProductBrief {
  if (brief) {
    return normalizeProductBrief(brief, {
      assetSummary: "",
      likelyProductName: "",
      likelyCategory: "",
      isSoftware: false,
      visibleProductFacts: [],
      visualAssets: [],
      missingInfo: [],
      complianceRisks: []
    }, desiredTone);
  }

  const isSoftware = inferSoftwareProduct(productDescription || "");
  return {
    productName: "",
    category: isSoftware ? "소프트웨어/디지털 서비스" : "",
    targetBuyer: "",
    useCases: [],
    coreFeatures: [],
    proofPoints: [],
    constraints: productDescription ? [productDescription] : [],
    prohibitedClaims: [],
    desiredTone: desiredTone || "",
    channel: "한국 모바일 커머스",
    isSoftware,
    needsHumanModel: false,
    confidence: productDescription ? "medium" : "low",
    missingInfo: productDescription ? [] : ["상품 설명이 충분하지 않습니다."]
  };
}

function selectAnalysisImages(references: PdpReferenceImage[]) {
  const primary = references.filter((reference) => reference.role === "primary");
  const proof = references.filter((reference) => reference.role === "proof");
  const detail = references.filter((reference) => reference.role === "detail");
  const rest = references.filter((reference) => reference.role !== "primary" && reference.role !== "proof" && reference.role !== "detail");
  const selected = [...primary, ...proof, ...detail, ...rest];
  return selected.slice(0, MAX_ANALYSIS_IMAGES);
}

function filterReferencesForSection(references: PdpReferenceImage[], ids: string[] | undefined) {
  if (!ids?.length) return references;
  const idSet = new Set(ids);
  return references.filter((reference) => reference.id && idSet.has(reference.id));
}

function buildAssetInventory(references: PdpReferenceImage[]) {
  return references
    .map((reference, index) => {
      const role = roleLabel(reference.role);
      return `${index + 1}. id=${reference.id || `ref-${index + 1}`} / name=${reference.name || "reference"} / role=${role} / mime=${reference.mimeType}`;
    })
    .join("\n");
}

function briefToPromptText(brief: ProductBrief) {
  return [
    `productName: ${brief.productName || "unknown"}`,
    `category: ${brief.category || "unknown"}`,
    `targetBuyer: ${brief.targetBuyer || "unknown"}`,
    `isSoftware: ${brief.isSoftware}`,
    `needsHumanModel: ${brief.needsHumanModel}`,
    `useCases: ${brief.useCases.join(", ") || "none"}`,
    `coreFeatures: ${brief.coreFeatures.join(", ") || "none"}`,
    `proofPoints: ${brief.proofPoints.join(", ") || "none"}`,
    `constraints: ${brief.constraints.join(", ") || "none"}`,
    `prohibitedClaims: ${brief.prohibitedClaims.join(", ") || "none"}`,
    `missingInfo: ${brief.missingInfo.join(", ") || "none"}`
  ].join("\n");
}

function buildFactTerms(brief: ProductBrief) {
  return cleanStringList([
    brief.productName,
    brief.category,
    brief.targetBuyer,
    ...brief.useCases,
    ...brief.coreFeatures,
    ...brief.proofPoints
  ])
    .flatMap((item) => item.split(/[\s,/·|]+/))
    .map((item) => normalizeCopyToken(item))
    .filter((item) => item.length >= 2 && !GENERIC_COPY_TOKENS.has(item));
}

function copyConnectsToFacts(copy: string, factTerms: string[]) {
  const normalized = normalizeCopyToken(copy);
  return factTerms.some((term) => normalized.includes(term));
}

function isGenericCopy(value: string) {
  const normalized = normalizeCopyToken(value);
  if (!normalized) return true;
  if (GENERIC_COPY_TOKENS.has(normalized)) return true;
  return /^(s\d+|section\d+|headline|subheadline|cta|bullet\d*)$/i.test(normalized);
}

function normalizeCopyToken(value: string) {
  return value.toLowerCase().replace(/[\s\-_./:;'"!?()[\]{}]+/g, "");
}

const GENERIC_COPY_TOKENS = new Set([
  "hero",
  "benefit",
  "benefits",
  "proof",
  "evidence",
  "spec",
  "specs",
  "faq",
  "cta",
  "headline",
  "subheadline",
  "copy",
  "section",
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

function fallbackSections(aspectRatio: AspectRatio): SectionBlueprint[] {
  const base: Array<[string, string, PdpLayoutTemplate, string, string]> = [
    ["S1", "히어로", "hero", "첫 화면에서 대상 고객과 선택 이유가 바로 보이게 합니다.", "강한 제품/화면 컷, 상단 넓은 헤드라인 합성 영역, 하단 신뢰 단서와 CTA 영역"],
    ["S2", "문제 공감", "problem", "고객이 자기 상황이라고 느낄 구매 전 고민을 짧게 짚습니다.", "상황 카드와 체크 포인트 중심, 제품/화면은 보조 배치"],
    ["S3", "핵심 베네핏", "benefit", "기능을 고객이 얻는 변화와 사용 장면으로 번역합니다.", "3개 베네핏 카드 또는 단계형 레이아웃, 짧은 라벨 합성 영역"],
    ["S4", "선택 이유", "benefit", "대안 대비 왜 이 제품/서비스를 골라야 하는지 납득시킵니다.", "선택 기준 카드, 구성/흐름/사용 맥락 패널, 제품은 측면 배치"],
    ["S5", "근거와 신뢰", "proof", "원본에서 확인 가능한 근거만 모아 신뢰 장벽을 낮춥니다.", "증빙/디테일/스펙 패널과 조건 명시 영역, 과장 배지 금지"],
    ["S6", "사용법/데모", "demo", "구매 또는 도입 후 첫 사용 흐름을 쉽게 상상하게 합니다.", "2~4단계 사용 흐름, SW는 실제 화면 기반 워크플로우 카드"],
    ["S7", "상황별 활용", "use-case", "고객 역할이나 상황별로 내게 맞는 사용 이유를 보여줍니다.", "역할별/상황별 카드, 생활 또는 업무 맥락, 반복 히어로 구도 금지"],
    ["S8", "FAQ/CTA", "faq-cta", "마지막 불안 요소를 정리하고 다음 행동을 자연스럽게 유도합니다.", "FAQ 카드와 하단 CTA 합성 영역, 배송/교환/AS 또는 보안/요금제 확인"]
  ];

  return base.map(([section_id, section_name, layout_template, goal, layout], index) => ({
    section_id,
    section_name,
    layout_template,
    source_fact_refs: [],
    goal,
    headline: "",
    headline_en: "",
    subheadline: "",
    subheadline_en: "",
    bullets: [],
    bullets_en: [],
    trust_or_objection_line: "",
    trust_or_objection_line_en: "",
    CTA: "",
    CTA_en: "",
    layout_notes: `${aspectRatio} 비율에 맞춘 모바일 상세페이지 섹션. ${layout}`,
    compliance_notes: "확인되지 않은 효능, 기능, 요금제, 공식 로고 금지. 리뷰, 인증, 수치형 신뢰 문구는 마케팅 카피로 사용 가능.",
    image_id: `section_${index + 1}`,
    purpose: goal,
    prompt_ko: `${section_name} 섹션용 한국형 모바일 상세페이지 이미지. 포스터가 아니라 구매/도입 결정을 돕는 세로 섹션으로 구성하고, 한글 카피는 앱이 합성하므로 고대비 텍스트 패널과 여백을 둔다.`,
    prompt_en: `Korean mobile PDP section image for ${section_name}. Use a source-faithful premium composition with high-contrast app-composited headline, bullet, and CTA surfaces.`,
    negative_prompt: "fake logos, unsupported product functions, fake software features, fake pricing, tiny unreadable text, distorted product or UI, rendered Korean headline text",
    style_guide: "clean, trustworthy, conversion-focused, mobile-first",
    reference_usage: "제품 이미지 또는 서비스 스크린샷을 정확한 참조로 사용",
    story_role: normalizeStoryRole(layout_template),
    overlay_layout_hint: buildOverlayLayoutHint({ section_id, section_name, layout_template, goal } as SectionBlueprint, index),
    quality_notes: "",
    image_prompt_override: ""
  }));
}

function buildAnalyzeFallbackResult(request: PdpAnalyzeRequest, trace: GenerationTrace, debugPath: string, error: unknown): GeneratedResult | null {
  if (!shouldUseAnalyzeFallback(error)) return null;

  try {
    const references = normalizePdpReferenceImages(request);
    if (!references.length) return null;

    const primaryReference = references[0];
    const productDescription = normalizePromptText(request.productDescription);
    const additionalInfo = normalizePromptText(request.additionalInfo);
    const productBrief = buildFallbackProductBrief(request, references, productDescription, additionalInfo);
    const sections = buildFallbackCopySections(request.aspectRatio, productBrief, references, productDescription, additionalInfo);
    const fallbackBlueprint: LandingPageBlueprint = {
      executiveSummary: "AI 분석 실패 시에도 편집을 계속할 수 있도록 업로드 자료 기준의 기본 전환형 상세페이지 구조를 만들었습니다.",
      scorecard: [
        {
          category: "전환 흐름",
          score: "기본 구조",
          reason: "후킹, 문제 공감, 선택 이유, 근거, 사용법, FAQ/CTA 순서로 이어집니다."
        },
        {
          category: "정보 신뢰도",
          score: productBrief.confidence === "medium" ? "제한적" : "낮음",
          reason: "AI 이미지 분석 결과가 아니라 사용자가 업로드한 자료와 입력 문구만 기준으로 구성했습니다."
        },
        {
          category: "편집 필요",
          score: "높음",
          reason: "섹션별 이미지 생성 전 상품 고유 기능, 가격, 효능은 직접 확인해 보강해야 합니다."
        }
      ],
      blueprintList: sections.map((section) => `${section.section_id} ${section.section_name}`),
      sections
    };
    const warningMessage = "AI 분석 호출이 실패해 기본 상세페이지 구조로 열었습니다. 업로드 자료를 보강하거나 다시 생성하면 더 정밀한 카피와 섹션 구성이 나옵니다.";
    const now = new Date().toISOString();

    trace.debugPath = debugPath;
    trace.stages.push({
      name: "fallback-section-blueprint",
      status: "warning",
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      notes: [warningMessage, formatError(error)]
    });

    const copyWarnings: CopyWarning[] = [
      {
        field: "analysis",
        severity: "warning",
        message: warningMessage
      }
    ];
    const qualityReport = buildPdpQualityReport({
      blueprint: fallbackBlueprint,
      productBrief,
      copyWarnings,
      productDescription,
      additionalInfo
    });

    return {
      originalImage: toDataUrl(primaryReference.mimeType, sanitizeBase64Payload(primaryReference.base64)),
      referenceImages: references,
      productDescription,
      productBrief,
      generationTrace: trace,
      copyWarnings,
      qualityReport,
      blueprint: fallbackBlueprint,
      layeredDocument: buildLayeredDocument(fallbackBlueprint),
      layeredDocumentV2: createLayeredDocumentV2FromBlueprint({
        title: productBrief.productName || "PDP fallback layered document",
        blueprint: fallbackBlueprint,
        originalImage: toDataUrl(primaryReference.mimeType, sanitizeBase64Payload(primaryReference.base64)),
        referenceImages: references,
        aspectRatio: request.aspectRatio
      }),
      sourceMode: "product"
    } satisfies GeneratedResult;
  } catch {
    return null;
  }
}

function shouldUseAnalyzeFallback(error: unknown) {
  if (error instanceof PdpServiceError) {
    return error.code === "PDP_ANALYZE_FAILED" || error.code === "CODEX_RESPONSE_INVALID";
  }

  if (error instanceof CodexProviderError) {
    return error.code === "CODEX_RESPONSE_INVALID";
  }

  if (error instanceof Error) {
    return !/(auth\.json|login|oauth|CODEX_AUTH|access denied|model access|model not found)/i.test(`${error.name}: ${error.message}`);
  }

  return true;
}

function buildFallbackProductBrief(
  request: PdpAnalyzeRequest,
  references: PdpReferenceImage[],
  productDescription: string,
  additionalInfo: string
): ProductBrief {
  const referenceNames = references.map((reference) => reference.name?.replace(/\.[^.]+$/, "").trim()).filter(Boolean) as string[];
  const primaryName = referenceNames[0] ?? "";
  const userFacts = extractFallbackUserFacts(productDescription, additionalInfo);
  const firstUserFact = firstReadableSentence(productDescription || additionalInfo);
  const isSoftware = inferSoftwareProduct([productDescription, additionalInfo, referenceNames.join(" ")].join("\n"));
  const productName = userFacts.productName || primaryName;
  const category = userFacts.category || (isSoftware ? "소프트웨어/디지털 서비스" : "");
  const targetBuyer = userFacts.targetBuyer || (isSoftware ? "화면 흐름과 도입 가치를 빠르게 확인하려는 고객" : "구매 전 비교와 확신이 필요한 고객");
  const coreFeatures = userFacts.coreFeatures.length
    ? userFacts.coreFeatures
    : firstUserFact
      ? [firstUserFact]
      : ["업로드 자료에서 확인 가능한 제품/서비스 정보"];

  return normalizeProductBrief(
    {
      productName,
      category,
      targetBuyer,
      useCases: userFacts.useCases.length
        ? userFacts.useCases
        : isSoftware
          ? ["핵심 화면 흐름 확인", "도입 전 사용 맥락 검토", "기능 이해"]
          : ["구매 전 비교", "디테일 확인", "사용 상황 상상"],
      coreFeatures,
      proofPoints: references.some((reference) => reference.role === "proof" || reference.role === "detail")
        ? ["업로드한 디테일/증빙 이미지 기준"]
        : [],
      constraints: cleanStringList([productDescription, additionalInfo, "AI 분석 실패로 이미지 세부 사실은 수동 확인 필요"]),
      prohibitedClaims: cleanStringList([
        ...userFacts.prohibitedClaims,
        "원본에서 확인되지 않은 가격, 효능, 기능 추가 금지. 후기, 인증, 수치형 신뢰 문구는 마케팅 카피로 사용 가능."
      ]),
      desiredTone: request.desiredTone || "",
      channel: "한국 모바일 커머스",
      isSoftware,
      needsHumanModel: false,
      confidence: productDescription || additionalInfo ? "medium" : "low",
      missingInfo: productDescription || additionalInfo
        ? ["AI 분석 실패로 세부 USP와 증빙 문구 확인이 필요합니다."]
        : ["상품 설명, 핵심 장점, 증빙 자료가 부족합니다."]
    },
    {
      assetSummary: "AI 분석 실패로 업로드 자료와 사용자 입력만 기준으로 기본 구조를 생성했습니다.",
      likelyProductName: productName,
      likelyCategory: category,
      isSoftware,
      visibleProductFacts: coreFeatures,
      visualAssets: references.map((reference) => ({
        id: reference.id ?? "",
        role: reference.role ?? "reference",
        observedFacts: reference.name ? [`업로드 파일: ${reference.name}`] : [],
        cautions: ["이미지 세부 내용은 수동 확인 필요"]
      })),
      missingInfo: productDescription || additionalInfo ? [] : ["상품 설명"],
      complianceRisks: ["검증되지 않은 주장 추가 금지"]
    },
    request.desiredTone
  );
}

function buildFallbackCopySections(
  aspectRatio: AspectRatio,
  brief: ProductBrief,
  references: PdpReferenceImage[],
  productDescription: string,
  additionalInfo: string
): SectionBlueprint[] {
  const subject = buildFallbackSubject(brief, references);
  const customer = brief.targetBuyer || (brief.isSoftware ? "도입을 검토하는 고객" : "구매를 고민하는 고객");
  const primaryFeature = brief.coreFeatures[0] || (brief.isSoftware ? "핵심 기능" : "핵심 장점");
  const secondaryFeature = brief.coreFeatures[1] || (brief.isSoftware ? "설정 흐름" : "사용 장면");
  const rawInputs = { productDescription, additionalInfo };
  const sourceRefs = cleanStringList([
    "업로드 이미지",
    productDescription ? "사용자 상품 설명" : "",
    additionalInfo ? "추가 요청사항" : ""
  ]);

  const copies: Array<Pick<SectionBlueprint, "headline" | "headline_en" | "subheadline" | "subheadline_en" | "bullets" | "bullets_en" | "trust_or_objection_line" | "trust_or_objection_line_en" | "CTA" | "CTA_en">> = [
    {
      headline: brief.isSoftware ? `${subject}, 바로 쓰는 ${primaryFeature}` : `${subject}를 선택해야 할 이유`,
      headline_en: `Why choose ${subject}`,
      subheadline: brief.isSoftware
        ? `${secondaryFeature}까지 이어지는 실제 사용 흐름을 보여줍니다.`
        : `${customer}가 첫 화면에서 ${primaryFeature}의 가치를 바로 이해하도록 구성합니다.`,
      subheadline_en: "Make the core value clear in the first viewport.",
      bullets: [primaryFeature, secondaryFeature, "CTA 영역 분리"],
      bullets_en: ["Hero image focus", "Clear reason to choose", "Separated CTA area"],
      trust_or_objection_line: "확인 가능한 자료만 기준으로 시작합니다.",
      trust_or_objection_line_en: "Built only from verifiable uploaded materials.",
      CTA: "상세 확인하기",
      CTA_en: "View details"
    },
    {
      headline: brief.isSoftware ? "도입 전 고민부터 짚어줍니다" : "구매 전 고민부터 짚어줍니다",
      headline_en: "Address the concern first",
      subheadline: `${customer}가 망설이는 상황을 먼저 보여주고 ${subject}의 해결 논리로 연결합니다.`,
      subheadline_en: "Start with hesitation and lead into the solution logic.",
      bullets: ["비교 피로", "정보 부족", "사용 후 확신 부족"],
      bullets_en: ["Comparison fatigue", "Lack of information", "Unclear usage confidence"],
      trust_or_objection_line: "과장 대신 실제 확인 포인트를 남깁니다.",
      trust_or_objection_line_en: "Use practical checks instead of exaggeration.",
      CTA: "내 상황에 맞는지 보기",
      CTA_en: "Check fit"
    },
    {
      headline: brief.isSoftware ? "핵심 기능을 한눈에 정리합니다" : "핵심 장점을 한눈에 정리합니다",
      headline_en: "Summarize key benefits",
      subheadline: "기능 나열보다 고객이 얻게 되는 변화를 짧은 문장과 카드 구조로 보여줍니다.",
      subheadline_en: "Translate features into customer outcomes.",
      bullets: brief.coreFeatures.length ? brief.coreFeatures.slice(0, 3) : ["핵심 가치", "사용 장면", "비교 기준"],
      bullets_en: brief.coreFeatures.length ? brief.coreFeatures.slice(0, 3) : ["Core value", "Use scene", "Decision criteria"],
      trust_or_objection_line: "구체 문구는 편집 레이어에서 보강할 수 있습니다.",
      trust_or_objection_line_en: "Specific copy can be refined in editable layers.",
      CTA: "장점 확인하기",
      CTA_en: "See benefits"
    },
    {
      headline: "왜 이 선택이 합리적인지 보여줍니다",
      headline_en: "Show why this choice makes sense",
      subheadline: "대안 비교 전에 확인해야 할 기준을 정리해 선택 이유를 분명하게 만듭니다.",
      subheadline_en: "Clarify decision criteria before comparison.",
      bullets: ["선택 기준", "사용 맥락", "확인할 디테일"],
      bullets_en: ["Selection criteria", "Usage context", "Details to check"],
      trust_or_objection_line: "근거 없는 비교 표현은 사용하지 않습니다.",
      trust_or_objection_line_en: "Avoid unsupported comparison claims.",
      CTA: "선택 기준 보기",
      CTA_en: "View criteria"
    },
    {
      headline: "신뢰할 수 있는 근거만 모읍니다",
      headline_en: "Collect only reliable proof",
      subheadline: "업로드한 디테일, 증빙, 화면 자료를 근거 영역으로 분리해 불안을 낮춥니다.",
      subheadline_en: "Separate detail and proof materials to reduce hesitation.",
      bullets: brief.proofPoints.length ? brief.proofPoints.slice(0, 3) : ["디테일 자료", "확인 가능한 조건", "주의할 기준"],
      bullets_en: brief.proofPoints.length ? brief.proofPoints.slice(0, 3) : ["Detail material", "Verifiable conditions", "Check criteria"],
      trust_or_objection_line: "없는 기능만 넣지 않습니다.",
      trust_or_objection_line_en: "Do not add unsupported features.",
      CTA: "근거 확인하기",
      CTA_en: "Check proof"
    },
    {
      headline: brief.isSoftware ? "처음 사용하는 흐름까지 쉽게" : "사용 흐름을 쉽게 상상하게",
      headline_en: brief.isSoftware ? "Make first use easy" : "Make usage easy to imagine",
      subheadline: "구매 또는 도입 이후의 첫 행동을 단계형 레이아웃으로 정리합니다.",
      subheadline_en: "Turn the first actions after purchase or adoption into steps.",
      bullets: brief.isSoftware ? ["첫 화면", "핵심 조작", "완료 결과"] : ["개봉/준비", "사용 장면", "관리/보관"],
      bullets_en: brief.isSoftware ? ["First screen", "Main action", "Result"] : ["Unbox/setup", "Usage scene", "Care/storage"],
      trust_or_objection_line: "실제와 다른 화면 또는 기능은 추가하지 않습니다.",
      trust_or_objection_line_en: "Do not add screens or features that are not real.",
      CTA: "사용법 보기",
      CTA_en: "See how it works"
    },
    {
      headline: "내 상황에 맞는 활용을 보여줍니다",
      headline_en: "Show fit by situation",
      subheadline: "고객 역할이나 사용 맥락별로 같은 장점이 어떻게 다르게 체감되는지 나눕니다.",
      subheadline_en: "Split benefits by role or situation.",
      bullets: brief.useCases.length ? brief.useCases.slice(0, 3) : ["상황 A", "상황 B", "상황 C"],
      bullets_en: brief.useCases.length ? brief.useCases.slice(0, 3) : ["Situation A", "Situation B", "Situation C"],
      trust_or_objection_line: "대상 고객을 좁히면 섹션 설득력이 높아집니다.",
      trust_or_objection_line_en: "Narrowing the audience improves persuasion.",
      CTA: "활용 장면 보기",
      CTA_en: "View use cases"
    },
    {
      headline: "마지막 걱정까지 정리합니다",
      headline_en: "Resolve the last concerns",
      subheadline: "배송, 교환, AS, 보안, 요금제처럼 구매 직전 확인할 질문을 CTA 앞에 배치합니다.",
      subheadline_en: "Place final questions before the CTA.",
      bullets: brief.isSoftware ? ["보안/권한", "요금/도입", "지원 범위"] : ["배송/교환", "구성/호환", "관리/AS"],
      bullets_en: brief.isSoftware ? ["Security/access", "Pricing/adoption", "Support scope"] : ["Shipping/exchange", "Contents/fit", "Care/AS"],
      trust_or_objection_line: "정책 정보는 판매 조건에 맞게 수정하세요.",
      trust_or_objection_line_en: "Adjust policy copy to match actual selling terms.",
      CTA: "구매 전 확인하기",
      CTA_en: "Final check"
    }
  ];

  return fallbackSections(aspectRatio).map((section, index) => ({
    ...section,
    ...buildDeterministicSectionCopy(section, index, brief, undefined, rawInputs),
    source_fact_refs: sourceRefs,
    prompt_ko: `${section.prompt_ko} ${subject}의 원본 시각 정보를 보존하고, 새 마케팅 문구는 앱이 합성하므로 고대비 카피 패널과 여백만 정돈한다.`,
    prompt_en: `${section.prompt_en} Preserve the source product or UI visuals and reserve high-contrast app-composited copy areas without rendering readable text.`
  }));
}

function buildFallbackSubject(brief: ProductBrief, references: PdpReferenceImage[]) {
  const subject = brief.productName || brief.category || references[0]?.name?.replace(/\.[^.]+$/, "").trim() || "업로드 상품";
  return subject.length > 28 ? "이 상품" : subject;
}

function extractFallbackUserFacts(productDescription: string, additionalInfo: string) {
  const source = [productDescription, additionalInfo].filter(Boolean).join("\n");
  return {
    productName: extractLabeledPhrase(source, ["상품명", "제품명", "서비스명", "앱 이름", "브랜드명"]),
    category: extractLabeledPhrase(source, ["카테고리", "분류", "업종"]),
    targetBuyer:
      extractLabeledPhrase(source, ["대상 고객", "타깃 고객", "타겟 고객", "주요 고객", "고객층", "사용자"]) ||
      extractKoreanClause(source, /대상\s*고객(?:은|는)\s*([^.\n。]+)/i),
    coreFeatures: extractLabeledList(source, ["핵심 기능", "주요 기능", "핵심 장점", "주요 장점", "기능"]),
    useCases: extractLabeledList(source, ["사용 상황", "활용 상황", "사용 장면", "용도", "사용처"]),
    prohibitedClaims: extractLabeledList(source, ["금지 표현", "금지 주장", "쓰면 안 되는 표현", "주의 표현"])
  };
}

function extractLabeledPhrase(source: string, labels: string[]) {
  for (const label of labels) {
    const escapedLabel = escapeRegExp(label);
    const colonMatch = source.match(new RegExp(`${escapedLabel}\\s*[:：]\\s*([^\\n.。]+)`, "i"));
    const clauseMatch = source.match(new RegExp(`${escapedLabel}\\s*(?:은|는)\\s*([^\\n.。]+)`, "i"));
    const value = cleanFallbackFact(colonMatch?.[1] || clauseMatch?.[1] || "");
    if (value) return value;
  }
  return "";
}

function extractLabeledList(source: string, labels: string[]) {
  for (const label of labels) {
    const escapedLabel = escapeRegExp(label);
    const colonMatch = source.match(new RegExp(`${escapedLabel}\\s*[:：]\\s*([^\\n.。]+)`, "i"));
    const clauseMatch = source.match(new RegExp(`${escapedLabel}\\s*(?:은|는)\\s*([^\\n.。]+)`, "i"));
    const value = colonMatch?.[1] || clauseMatch?.[1] || "";
    const items = splitFallbackFactList(value);
    if (items.length) return items;
  }
  return [];
}

function extractKoreanClause(source: string, pattern: RegExp) {
  return cleanFallbackFact(source.match(pattern)?.[1] || "");
}

function splitFallbackFactList(value: string) {
  return cleanStringList(
    value
      .replace(/입니다$/g, "")
      .split(/[,，、/]|(?:\s및\s)|(?:\s그리고\s)|(?:\s와\s)|(?:\s과\s)/)
      .map(cleanFallbackFact)
  ).slice(0, 6);
}

function cleanFallbackFact(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^(은|는|이|가|:|：)\s*/, "")
    .replace(/\s*(입니다|합니다|쓰지 않습니다|사용하지 않습니다)$/g, "")
    .trim()
    .slice(0, 80);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstReadableSentence(value: string) {
  return value
    .split(/[\r\n.!?。！？]/)
    .map((item) => item.trim())
    .find((item) => item.length >= 4)
    ?.slice(0, 60) ?? "";
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value) && value.length ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 6) : fallback;
}

function cleanStringList(value: unknown) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,|;/)
      : [];
  return Array.from(new Set(items.map((item) => String(item).trim()).filter(Boolean))).slice(0, 12);
}

function normalizeLayoutTemplate(value: unknown): PdpLayoutTemplate {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");

  if (LAYOUT_TEMPLATES.includes(normalized as PdpLayoutTemplate)) return normalized as PdpLayoutTemplate;
  if (/(faq|objection|final.*cta|cta|qna|question)/.test(normalized)) return "faq-cta";
  if (/(demo|workflow|step|how-to|usage|onboarding)/.test(normalized)) return "demo";
  if (/(use-case|usecase|situation|scenario|case)/.test(normalized)) return "use-case";
  if (/(proof|trust|review|evidence|credibility)/.test(normalized)) return "proof";
  if (/(spec|detail|information)/.test(normalized)) return "spec";
  if (/(problem|pain|concern|issue)/.test(normalized)) return "problem";
  if (/(hero|hook|intro|first)/.test(normalized)) return "hero";
  if (/(benefit|feature|selection|reason|differentiator|value|why)/.test(normalized)) return "benefit";
  return "benefit";
}

function normalizeDesignTemplateId(value: unknown): PdpDesignTemplateId | undefined {
  const normalized = String(value ?? "").trim();
  return DESIGN_TEMPLATE_IDS.includes(normalized as PdpDesignTemplateId) ? (normalized as PdpDesignTemplateId) : undefined;
}

function normalizePdpReferenceImages(request: PdpAnalyzeRequest): PdpReferenceImage[] {
  const references = (request.referenceImages ?? [])
    .map((reference, index) => normalizeReferenceImage(reference, index))
    .filter((reference): reference is PdpReferenceImage => Boolean(reference));

  if (!references.length && request.imageBase64 && request.mimeType) {
    const validated = validateImagePayload(request.imageBase64, request.mimeType, "업로드 대표 이미지");
    references.push({
      id: "legacy-primary",
      name: "업로드 대표 이미지",
      role: "primary",
      mimeType: validated.mimeType,
      base64: validated.base64
    });
  }

  return ensurePrimaryReference(references).slice(0, MAX_PRODUCT_REFERENCE_IMAGES);
}

function normalizeGenerateReferences(request: PdpGenerateImageRequest): PdpReferenceImage[] {
  return ensurePrimaryReference(
    (request.referenceImages ?? [])
      .map((reference, index) => normalizeReferenceImage(reference, index))
      .filter((reference): reference is PdpReferenceImage => Boolean(reference))
  ).slice(0, MAX_PRODUCT_REFERENCE_IMAGES);
}

function normalizeReferenceImage(reference: PdpReferenceImage, index: number): PdpReferenceImage | null {
  if (!reference?.base64 || !reference.mimeType) return null;
  const validated = validateImagePayload(reference.base64, reference.mimeType, reference.name || `reference-${index + 1}`);
  return {
    id: reference.id || `ref-${index + 1}`,
    name: reference.name || `reference-${index + 1}`,
    role: normalizeReferenceRole(reference.role, index),
    mimeType: validated.mimeType,
    base64: validated.base64
  };
}

function ensurePrimaryReference(references: PdpReferenceImage[]) {
  if (!references.length) return references;
  if (references.some((reference) => reference.role === "primary")) return references;
  return references.map((reference, index) => (index === 0 ? { ...reference, role: "primary" as const } : reference));
}

function normalizeReferenceRole(role: PdpReferenceImage["role"], index: number): NonNullable<PdpReferenceImage["role"]> {
  if (role === "primary" || role === "detail" || role === "proof" || role === "reference" || role === "optional_model") return role;
  return index === 0 ? "primary" : "reference";
}

function roleLabel(role: PdpReferenceImage["role"]) {
  switch (role) {
    case "primary":
      return "대표 제품/서비스";
    case "detail":
      return "디테일/스펙/구성";
    case "proof":
      return "증빙/리뷰/인증";
    case "optional_model":
      return "선택 모델";
    default:
      return "참조/톤";
  }
}

function parseOriginalImage(value: string) {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return validateImagePayload(match[2], match[1], "원본 이미지");
  }
  return validateImagePayload(value, "image/jpeg", "원본 이미지");
}

function normalizeReferenceModelImage(options?: ImageGenOptions) {
  if (!options?.referenceModelImageBase64 || !options.referenceModelImageMimeType) return null;
  return validateImagePayload(options.referenceModelImageBase64, options.referenceModelImageMimeType, "참조 모델 이미지");
}

function normalizePromptText(value: string | undefined) {
  return value?.trim().replace(/\r\n/g, "\n").slice(0, 12000) ?? "";
}

function sanitizeBase64Payload(value: string) {
  return value.includes(",") ? value.split(",").pop() || "" : value;
}

function validateImagePayload(base64Value: string, mimeTypeValue: string, label: string) {
  const mimeType = normalizeMimeType(mimeTypeValue);
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new PdpServiceError("INVALID_IMAGE_PAYLOAD", `${label}의 이미지 형식이 지원되지 않습니다. JPG, PNG, WebP만 사용할 수 있습니다.`);
  }

  const base64 = sanitizeBase64Payload(base64Value).replace(/\s+/g, "");
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new PdpServiceError("INVALID_IMAGE_PAYLOAD", `${label}의 이미지 데이터가 올바른 base64 형식이 아닙니다.`);
  }

  const byteLength = estimateBase64Bytes(base64);
  if (byteLength <= 0) {
    throw new PdpServiceError("INVALID_IMAGE_PAYLOAD", `${label}의 이미지 데이터가 비어 있습니다.`);
  }
  if (byteLength > MAX_IMAGE_PAYLOAD_BYTES) {
    throw new PdpServiceError(
      "INVALID_IMAGE_PAYLOAD",
      `${label} 이미지가 너무 큽니다. 이미지 1장당 최대 ${Math.round(MAX_IMAGE_PAYLOAD_BYTES / 1024 / 1024)}MB까지 사용할 수 있습니다.`
    );
  }
  const bytes = Buffer.from(base64, "base64");
  if (!hasExpectedImageSignature(bytes, mimeType)) {
    throw new PdpServiceError("INVALID_IMAGE_PAYLOAD", `${label}의 이미지 데이터가 ${mimeType} 파일 형식과 일치하지 않습니다. 이미지를 다시 업로드해 주세요.`);
  }

  return { mimeType, base64 };
}

function estimateBase64Bytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function normalizeMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpg") return "image/jpeg";
  if (normalized === "image/jpeg" || normalized === "image/png" || normalized === "image/webp") return normalized;
  return normalized;
}

function toDataUrl(mimeType: string, base64: string) {
  return `data:${mimeType};base64,${base64}`;
}

function formatError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function toPdpErrorResponse(error: unknown) {
  if (error instanceof PdpServiceError) {
    return {
      ok: false as const,
      code: error.code,
      message: error.message,
      detail: error.detail
    };
  }

  if (error instanceof CodexProviderError) {
    return {
      ok: false as const,
      code: error.code,
      message: error.message,
      detail: error.detail
    };
  }

  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return {
    ok: false as const,
    code: "PDP_ANALYZE_FAILED" as const,
    message: error instanceof Error ? error.message : "상세페이지 처리 중 오류가 발생했습니다.",
    detail
  };
}

const ASSET_SUMMARY_REPAIR_SHAPE = {
  assetSummary: "",
  likelyProductName: "",
  likelyCategory: "",
  isSoftware: false,
  visibleProductFacts: [],
  visualAssets: [{ id: "ref-1", role: "primary", observedFacts: [], cautions: [] }],
  missingInfo: [],
  complianceRisks: []
};

const PRODUCT_BRIEF_REPAIR_SHAPE = {
  productName: "",
  category: "",
  targetBuyer: "",
  useCases: [],
  coreFeatures: [],
  proofPoints: [],
  constraints: [],
  prohibitedClaims: [],
  desiredTone: "",
  channel: "한국 모바일 커머스",
  isSoftware: false,
  needsHumanModel: false,
  confidence: "medium",
  missingInfo: []
};

const SECTION_PLAN_REPAIR_SHAPE = {
  executiveSummary: "",
  scorecard: [{ category: "", score: "", reason: "" }],
  sections: [
    {
      section_id: "S1",
      section_name: "",
      layout_template: "hero",
      design_template_id: "hero-product-focus",
      goal: "",
      purpose: "",
      source_fact_refs: []
    }
  ]
};

const BLUEPRINT_REPAIR_SHAPE = {
  executiveSummary: "",
  scorecard: [{ category: "", score: "", reason: "" }],
  sections: [
    {
      section_id: "S1",
      section_name: "",
      layout_template: "hero",
      design_template_id: "hero-product-focus",
      source_fact_refs: [],
      goal: "",
      headline: "",
      headline_en: "",
      subheadline: "",
      subheadline_en: "",
      bullets: [],
      bullets_en: [],
      trust_or_objection_line: "",
      trust_or_objection_line_en: "",
      CTA: "",
      CTA_en: "",
      layout_notes: "",
      compliance_notes: "",
      image_id: "",
      purpose: "",
      prompt_ko: "",
      prompt_en: "",
      negative_prompt: "",
      style_guide: "",
      reference_usage: "",
      story_role: "",
      overlay_layout_hint: "",
      quality_notes: ""
    }
  ]
};

const STORY_COPY_REFINEMENT_REPAIR_SHAPE = {
  storySummary: "",
  sections: [
    {
      section_id: "S1",
      headline: "",
      headline_en: "",
      subheadline: "",
      subheadline_en: "",
      bullets: [],
      bullets_en: [],
      trust_or_objection_line: "",
      trust_or_objection_line_en: "",
      CTA: "",
      CTA_en: "",
      story_role: "",
      copy_reason: ""
    }
  ],
  warnings: []
};

const IMAGE_QUALITY_REPORT_REPAIR_SHAPE = {
  score: 70,
  status: "needs_review",
  summary: "",
  checks: [],
  pdpChecks: {
    textReadability: { score: 70, status: "needs_review", note: "" },
    ctaVisibility: { score: 70, status: "needs_review", note: "" },
    mobileReadability: { score: 70, status: "needs_review", note: "" },
    productExposure: { score: 70, status: "needs_review", note: "" },
    whitespaceBalance: { score: 70, status: "needs_review", note: "" },
    layerEditability: { score: 70, status: "needs_review", note: "" }
  },
  issues: [
    {
      category: "visual",
      severity: "minor",
      message: "",
      fix: ""
    }
  ],
  nextActions: []
};

const COMBINED_ANALYSIS_REPAIR_SHAPE = {
  assetSummary: ASSET_SUMMARY_REPAIR_SHAPE,
  productBrief: PRODUCT_BRIEF_REPAIR_SHAPE,
  blueprint: BLUEPRINT_REPAIR_SHAPE
};
