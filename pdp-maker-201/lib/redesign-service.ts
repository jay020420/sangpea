import type {
  AspectRatio,
  GeneratedResult,
  ImageProviderId,
  LandingPageBlueprint,
  PdpEditableLayer,
  PdpImageQualityReport,
  PdpLayoutTemplate,
  PdpQualityIssue,
  PdpQualityMetric,
  PdpQualityMetricKey,
  PdpQualityStatus,
  PdpReferenceImage,
  ProviderProof,
  SectionBlueprint
} from "./shared";
import { CodexProviderError, extractJsonObject, generateTextWithCodex } from "./codex-oauth";
import { getImageProvider, type ImageProvider } from "./image-providers";
import { hasExpectedImageSignature } from "./image-validation";
import { buildKnowledgeContext } from "./local-rag";
import { createLayeredDocumentV2FromBlueprint } from "./pdp-layered-document";

const MAX_REFERENCE_IMAGES = 6;
const MAX_REDESIGN_SECTIONS = 8;
const MAX_REFERENCE_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_REDESIGN_IMAGE_AUTO_REGEN_ATTEMPTS = 1;
const REDESIGN_IMAGE_AUTO_REGEN_SCORE_THRESHOLD = 72;
const REDESIGN_ANALYSIS_TIMEOUT_MS = 90_000;
const REDESIGN_IMAGE_QUALITY_TIMEOUT_MS = 45_000;
const SUPPORTED_REFERENCE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

class RedesignServiceError extends Error {
  constructor(
    public readonly code: "INVALID_IMAGE_PAYLOAD" | "INVALID_REQUEST" | "REDESIGN_GENERATE_FAILED",
    message: string,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "RedesignServiceError";
  }
}

type ReferenceImage = {
  name: string;
  mimeType: string;
  base64: string;
};

type RedesignAnalysis = {
  product_inferred?: Record<string, unknown>;
  diagnostic_summary?: string;
  strategy?: string;
  page_blueprint?: unknown[];
  compliance_notes?: string;
  summary?: string;
};

export type RedesignProjectSection = {
  id: string;
  section_id: string;
  image_id: string;
  name: string;
  purpose: string;
  source: string;
  headline?: string;
  subheadline?: string;
  bullets?: string[];
  trust?: string;
  cta?: string;
  prompt: string;
  promptText: string;
  imageUrl?: string;
  mimeType?: string;
  imageQualityReport?: PdpImageQualityReport;
  providerProof?: ProviderProof;
  error?: string;
};

export type RedesignProject = {
  id: string;
  title: string;
  channel: string;
  model: ImageProviderId;
  modelLabel: string;
  modelId: string;
  count: number;
  ratio: AspectRatio;
  status: "완료" | "부분완료";
  files: string[];
  request: string;
  rolloutRequest: string;
  createdAt: string;
  analysis: RedesignAnalysis;
  sections: RedesignProjectSection[];
  failedSections: RedesignProjectSection[];
  warning: string;
  providerProof?: ProviderProof;
  originalImage: string;
  referenceImages: PdpReferenceImage[];
};

type SectionTemplate = {
  id: string;
  name: string;
  purpose: string;
  source: string;
  layout: string;
  headline: string;
  subheadline: string;
  bullets: string[];
  trust: string;
  cta: string;
};

export async function generateRedesignProject(input: {
  files: File[];
  requestText: string;
  rolloutRequest?: string;
  channel: string;
  aspectRatio: AspectRatio;
  count: number;
  startSection?: number;
}) {
  const imageProvider = getImageProvider();
  const references = await prepareReferenceImages(input.files);
  if (!references.length) {
    throw new RedesignServiceError("INVALID_IMAGE_PAYLOAD", "이미지 생성에 사용할 참조 이미지가 없습니다. PDF는 브라우저에서 PNG로 변환한 뒤 전송해야 합니다.");
  }

  const startSection = clamp(input.startSection ?? 1, 1, MAX_REDESIGN_SECTIONS);
  const count = clamp(input.count, 1, MAX_REDESIGN_SECTIONS - startSection + 1);
  const rolloutRequest = input.rolloutRequest?.trim() || "";
  const requestText = input.requestText.trim();

  const analysisKnowledge = await buildKnowledgeContext(
    [
      "한국 이커머스 상세페이지 리디자인 진단",
      "한국 소비자 구매심리, 스마트스토어, 쿠팡, 모바일 상세페이지, 카피라이팅, 구매전환",
      "소프트웨어, SaaS, 앱, 웹서비스, 프로그램, 디지털 제품, 데모, 기능 소개, 워크플로우, 요금제, 무료 체험, 보안, 개인정보, API 연동",
      "기존 정보 보존, 원본 제품 사실 보존, Hero 진단, CTA 진단, 신뢰 근거, 배송 교환 AS 구매 불안",
      "전환 설계, 첫 화면 후킹, 문제 공감, 선택 이유, 근거, 사용법, 불안 해소, 최종 CTA",
      "failedSections, rolloutRequest, 누락 섹션 재생성, 법적 위험 표현, 과장광고 방지",
      "상세페이지스럽지 않음 방지, 포스터 금지, 모바일 세로 섹션, 원본 정보 보존, 섹션별 정보 위계",
      `판매 채널: ${input.channel}`,
      `사용자 요청: ${requestText || "구매전환 중심 리디자인"}`,
      rolloutRequest ? `히어로 검토 후 요청: ${rolloutRequest}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  );

  const analysis = await analyzeSource({
    references,
    requestText,
    rolloutRequest,
    channel: input.channel,
    aspectRatio: input.aspectRatio,
    count,
    startSection,
    knowledgeText: analysisKnowledge
  });

  const plannedSections = buildSections({
    count,
    startSection,
    channel: input.channel,
    aspectRatio: input.aspectRatio,
    requestText,
    rolloutRequest,
    analysis
  });

  const generatedSections: RedesignProjectSection[] = [];
  const failedSections: RedesignProjectSection[] = [];
  let providerProof: ProviderProof | undefined;

  for (const section of plannedSections) {
    try {
      const imageKnowledge = await buildKnowledgeContext(
        [
          "한국 상세페이지 이미지 생성 가이드",
          "참조 이미지 유지, 제품 형태 보존, 제품 색상 보존, 패키지 보존, 구성품 보존",
          "소프트웨어 화면, 앱 스크린샷, 웹 대시보드, UI 보존, 기능 콜아웃, 데모 화면, 워크플로우 카드, 브라우저 프레임",
          "모바일 가독성, 텍스트 오버레이, 편집기 텍스트 레이어, 섹션 구도, Hero Benefit Proof Spec FAQ",
          "소스 기반 시각 에셋, 섹션별 다른 레이아웃 리듬, 일관된 제품 조명과 색감",
          "금지 스타일, 제품 기능 왜곡 방지, 없는 기능/가격/효능 방지, 리뷰/인증/수치형 신뢰 카피 허용",
          "실사용감, 신뢰, 배송, 교환, AS, 구매 불안 해소",
          `판매 채널: ${input.channel}`,
          `섹션: ${section.section_id} ${section.name}`,
          `섹션 목적: ${section.purpose}`,
          `사용자 요청: ${requestText || "구매전환 중심 리디자인"}`
        ].join("\n")
      );

      const promptText = [section.promptText, imageKnowledge ? `\nRAG image guidance:\n${imageKnowledge.slice(0, 12000)}` : ""]
        .filter(Boolean)
        .join("\n");

      const candidates: RedesignImageCandidate[] = [
        await generateAndEvaluateRedesignImage({
          imageProvider,
          prompt: promptText,
          references,
          section,
          aspectRatio: input.aspectRatio,
          channel: input.channel,
          requestText,
          analysis
        })
      ];

      if (shouldAutoRegenerateRedesignImage(candidates[0].imageQualityReport)) {
        for (let attempt = 1; attempt <= MAX_REDESIGN_IMAGE_AUTO_REGEN_ATTEMPTS; attempt += 1) {
          const repairPrompt = buildRedesignImageRepairPrompt({
            basePrompt: promptText,
            failedReport: candidates[candidates.length - 1].imageQualityReport,
            attempt
          });
          candidates.push(
            await generateAndEvaluateRedesignImage({
              imageProvider,
              prompt: repairPrompt,
              references,
              section,
              aspectRatio: input.aspectRatio,
              channel: input.channel,
              requestText,
              analysis
            })
          );
          if (!shouldAutoRegenerateRedesignImage(candidates[candidates.length - 1].imageQualityReport)) break;
        }
      }

      const image = chooseBestRedesignImageCandidate(candidates);
      const imageQualityReport = annotateRedesignImageQualityAttempt(image.imageQualityReport, candidates, image);

      providerProof = image.providerProof;
      generatedSections.push({
        ...section,
        promptText,
        prompt: promptText.replaceAll("\n", "<br>"),
        imageUrl: `data:${image.mimeType};base64,${image.imageBase64}`,
        mimeType: image.mimeType,
        imageQualityReport,
        providerProof: image.providerProof
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "이미지 생성 실패";
      failedSections.push({ ...section, error: message });
      if (generatedSections.length === 0) {
        if (error instanceof CodexProviderError || error instanceof RedesignServiceError) throw error;
        throw new RedesignServiceError("REDESIGN_GENERATE_FAILED", `${section.name} 생성 실패: ${message}`, formatError(error));
      }
      break;
    }
  }

  const isCompleteProject = !failedSections.length && startSection === 1 && generatedSections.length >= MAX_REDESIGN_SECTIONS;
  const warning = failedSections.length
    ? `${generatedSections.length}장은 생성됐고 ${failedSections.length}장은 실패했습니다. 잠시 후 누락 섹션만 다시 생성하세요.`
    : "";

  const project: RedesignProject = {
    id: `redesign-${Date.now()}-${crypto.randomUUID()}`,
    title: inferProjectTitle(analysis, input.channel),
    channel: input.channel,
    model: imageProvider.id,
    modelLabel: imageProvider.label,
    modelId: imageProvider.defaultModel,
    count: generatedSections.length,
    ratio: input.aspectRatio,
    status: isCompleteProject ? "완료" : "부분완료",
    files: references.map((reference) => reference.name),
    request: requestText,
    rolloutRequest,
    createdAt: new Date().toISOString(),
    analysis,
    sections: generatedSections,
    failedSections,
    warning,
    providerProof,
    originalImage: `data:${references[0].mimeType};base64,${references[0].base64}`,
    referenceImages: references.map((reference, index) => ({
      id: `redesign-ref-${index + 1}`,
      name: reference.name,
      role: index === 0 ? "primary" : "reference",
      mimeType: reference.mimeType,
      base64: reference.base64
    }))
  };

  return {
    project,
    result: projectToGeneratedResult(project)
  };
}

export function projectToGeneratedResult(project: RedesignProject): GeneratedResult {
  const sections = project.sections.map((section, index) => projectSectionToBlueprint(section, index, project.ratio));
  const blueprint: LandingPageBlueprint = {
    executiveSummary:
      project.analysis.diagnostic_summary ||
      project.analysis.strategy ||
      "기존 상세페이지 또는 서비스 자료를 한국형 구매/도입 전환 흐름에 맞춰 리디자인했습니다.",
    scorecard: [
      {
        category: "리디자인 상태",
        score: project.status,
        reason: project.warning || "생성된 섹션을 편집기에서 이어서 조정할 수 있습니다."
      }
    ],
    blueprintList: sections.map((section) => `${section.section_id} ${section.section_name}`),
    sections
  };

  return {
    originalImage: project.originalImage,
    referenceImages: project.referenceImages,
    blueprint,
    layeredDocumentV2: createLayeredDocumentV2FromBlueprint({
      title: project.title,
      blueprint,
      originalImage: project.originalImage,
      referenceImages: project.referenceImages,
      aspectRatio: project.ratio
    }),
    sourceMode: "redesign",
    providerProof: project.providerProof
  };
}

type RedesignImageCandidate = {
  imageBase64: string;
  mimeType: string;
  providerProof: ProviderProof;
  imageQualityReport: PdpImageQualityReport;
};

export async function evaluateRedesignImageQuality(input: {
  imageBase64: string;
  mimeType: string;
  section: Pick<RedesignProjectSection, "section_id" | "name" | "purpose" | "headline" | "subheadline" | "bullets" | "trust" | "cta">;
  aspectRatio: AspectRatio | string;
  channel?: string;
  requestText?: string;
  analysis?: RedesignAnalysis;
}) {
  const prompt = buildRedesignImageQualityPrompt(input);

  try {
    const { text } = await generateTextWithCodex({
      prompt,
      images: [{ base64: input.imageBase64, mimeType: input.mimeType }],
      timeoutMs: REDESIGN_IMAGE_QUALITY_TIMEOUT_MS
    });
    return normalizeRedesignImageQualityReport(extractJsonObject<Record<string, unknown>>(text), input.section.section_id);
  } catch (error) {
    return {
      score: 70,
      status: "needs_review",
      summary: `자동 이미지 품질 검수를 완료하지 못했습니다. 고객 제공 전 수동 확인이 필요합니다: ${error instanceof Error ? error.message : "unknown"}`,
      checks: [],
      pdpChecks: buildFallbackPdpChecks(70, "needs_review", []),
      issues: [
        {
          sectionId: input.section.section_id,
          category: "visual",
          severity: "major",
          message: "자동 이미지 품질 검수가 실패했습니다.",
          fix: "시각 에셋의 선명도, 원본 보존, 가짜 UI, 픽셀 텍스트 유무를 직접 확인하세요."
        }
      ],
      nextActions: ["시각 에셋의 선명도, 원본 보존, 가짜 UI, 픽셀 텍스트 유무를 확인한 뒤 필요하면 다시 생성하세요."]
    } satisfies PdpImageQualityReport;
  }
}

async function generateAndEvaluateRedesignImage(input: {
  imageProvider: ImageProvider;
  prompt: string;
  references: ReferenceImage[];
  section: RedesignProjectSection;
  aspectRatio: AspectRatio;
  channel: string;
  requestText: string;
  analysis: RedesignAnalysis;
}): Promise<RedesignImageCandidate> {
  const image = await input.imageProvider.generate({
    prompt: input.prompt,
    referenceImages: input.references.map(({ base64, mimeType }) => ({ base64, mimeType })),
    aspectRatio: input.aspectRatio
  });
  const imageQualityReport = await evaluateRedesignImageQuality({
    imageBase64: image.imageBase64,
    mimeType: image.mimeType,
    section: input.section,
    aspectRatio: input.aspectRatio,
    channel: input.channel,
    requestText: input.requestText,
    analysis: input.analysis
  });

  return {
    imageBase64: image.imageBase64,
    mimeType: image.mimeType,
    providerProof: image.providerProof,
    imageQualityReport
  };
}

function buildRedesignImageQualityPrompt(input: {
  section: Pick<RedesignProjectSection, "section_id" | "name" | "purpose" | "headline" | "subheadline" | "bullets" | "trust" | "cta">;
  aspectRatio: AspectRatio | string;
  channel?: string;
  requestText?: string;
  analysis?: RedesignAnalysis;
}) {
  return [
    "Evaluate this generated Korean PDP redesign section for paid-service delivery readiness.",
    "Return one strict JSON object only. No markdown, no prose, no comments.",
    "Score harshly. A paid redesign customer should not receive blurry, poster-like, misleading, generic, or text-baked images.",
    "Check whether the generated image preserves the original product/service/source identity, works as a visual asset inside an editable mobile PDP document, avoids reserved text layouts, avoids fake product functions/prices/logos/dashboard data, and is sharp enough for mobile.",
    "Block the image if the main product, package, app screen, browser frame, dashboard, or important UI geometry is blurred, smeared, defocused, cropped off, or hidden behind decorative effects.",
    "Block the image if new readable marketing copy is baked into the pixels instead of being left for editable overlay layers.",
    "Needs_review is not enough for severe blur, source identity damage, fake product-function proof, fake UI, logo-only composition, poster-like layout, or reserved text layout.",
    "For software/SaaS/app sources, penalize fictional UI, generic game-like panels, fake dashboards, smeared text, and source-unfaithful screens.",
    "For physical product sources, penalize changed product shape, color, package, material, components, or unsupported product-function usage claims.",
    "Use blocked for images that should not be delivered to a paying customer. Use needs_review for usable images requiring human confirmation.",
    "Also fill pdpChecks with explicit 0-100 metrics for textReadability, ctaVisibility, mobileReadability, productExposure, whitespaceBalance, and layerEditability. For raw redesign visual assets, score text/CTA based on whether the asset avoids interfering with separate document text layers, not whether it reserves text space.",
    `Aspect ratio: ${input.aspectRatio}`,
    `Channel: ${input.channel || "한국 모바일 커머스"}`,
    `Section:\n${JSON.stringify(input.section, null, 2)}`,
    input.requestText ? `User request:\n${input.requestText}` : "",
    input.analysis ? `Source analysis:\n${JSON.stringify(input.analysis).slice(0, 5000)}` : "",
    "Required JSON shape:",
    JSON.stringify(
      {
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
        issues: [{ category: "visual", severity: "minor", message: "", fix: "" }],
        nextActions: []
      },
      null,
      2
    )
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRedesignImageRepairPrompt(input: { basePrompt: string; failedReport: PdpImageQualityReport; attempt: number }) {
  const issueLines = input.failedReport.issues.length
    ? input.failedReport.issues.map((issue, index) => `${index + 1}. ${issue.severity}/${issue.category}: ${issue.message} Fix: ${issue.fix}`).join("\n")
    : "Improve source fidelity, sharpness, and usefulness as a visual asset inside the layered PDP document.";

  return [
    input.basePrompt,
    "",
    `QUALITY REPAIR ATTEMPT ${input.attempt}: the previous redesign image was rejected by the paid-service quality gate.`,
    `Rejected quality score: ${input.failedReport.score}. Status: ${input.failedReport.status}.`,
    `Quality gate summary: ${input.failedReport.summary}`,
    "Correct these issues:",
    issueLines,
    "Hard repair requirements:",
    "- Stay closer to the uploaded source product, screen, package, layout, and visible factual identity.",
    "- Make the section look like a mobile PDP/detail-page module, not a decorative poster or social ad.",
    "- Keep one clear main subject as a source-faithful visual asset. Do not reserve text space inside the pixels.",
    "- Make the main product, package, app screen, or dashboard crisp and in focus; avoid glass blur, fog, motion blur, tiny fake text, and smeared UI.",
    "- Do not integrate blank headline, support-copy, bullet, FAQ, or CTA areas into the pixels. The app template supplies those as editable document layers.",
    "- Remove fake product functions, fake software capabilities, fake prices, logos, dashboard data, or unsupported service capabilities. Review/certification/numeric proof cards may remain as editable marketing zones.",
    "- If software UI is involved, use crisp source-faithful panels and blank abstract bars instead of fictional or smeared UI."
  ].join("\n");
}

function shouldAutoRegenerateRedesignImage(report: PdpImageQualityReport) {
  return report.status === "blocked" || report.score < REDESIGN_IMAGE_AUTO_REGEN_SCORE_THRESHOLD;
}

function chooseBestRedesignImageCandidate(candidates: RedesignImageCandidate[]) {
  return candidates.reduce((best, candidate) => {
    const bestRank = qualityStatusRank(best.imageQualityReport.status);
    const candidateRank = qualityStatusRank(candidate.imageQualityReport.status);
    if (candidateRank > bestRank) return candidate;
    if (candidateRank === bestRank && candidate.imageQualityReport.score > best.imageQualityReport.score) return candidate;
    return best;
  }, candidates[0]);
}

function annotateRedesignImageQualityAttempt(
  report: PdpImageQualityReport,
  candidates: RedesignImageCandidate[],
  selected: RedesignImageCandidate
): PdpImageQualityReport {
  if (candidates.length <= 1) {
    return { ...report, attemptCount: 1, autoRegenerated: false };
  }

  return {
    ...report,
    attemptCount: candidates.length,
    autoRegenerated: true,
    rejectedAttempts: candidates
      .filter((candidate) => candidate !== selected)
      .map((candidate) => ({
        score: candidate.imageQualityReport.score,
        status: candidate.imageQualityReport.status,
        summary: candidate.imageQualityReport.summary
      })),
    summary: `자동 재생성 ${candidates.length - 1}회 후 선택했습니다. ${report.summary}`
  };
}

async function analyzeSource(input: {
  references: ReferenceImage[];
  requestText: string;
  rolloutRequest: string;
  channel: string;
  aspectRatio: AspectRatio;
  count: number;
  startSection: number;
  knowledgeText: string;
}): Promise<RedesignAnalysis> {
  const prompt = [
    "You are a Korean ecommerce and software/SaaS CRO strategist, copywriter, and PDP redesign director.",
    "Analyze the attached existing product detail page, software landing page, app screenshot, web dashboard, or service promotional images. Return one JSON object only.",
    "A PDP/detail page is not a poster. It is a vertical mobile sales explanation flow that preserves source facts, clarifies purchase/adoption reasons, reduces anxiety, and guides the next action section by section.",
    "Design the conversion flow deliberately: first-screen hook, problem recognition, concrete benefit, reason to choose, proof/spec, usage/demo, objection handling, and final CTA. Do not repeat the same job in multiple sections.",
    "If the source is software/SaaS/app/web service, redesign around target user, workflow pain, demo flow, feature-to-benefit mapping, security/privacy, pricing/trial CTA, onboarding, and adoption FAQ.",
    "Write copy only from visible source facts and user request. Avoid generic slogans unrelated to the product. Each headline must mention the product category, target user, use case, selection reason, proof, support, or concrete result when it can be inferred from the source.",
    "Reviews, certifications, ratings, awards, rankings, and numeric proof copy may be used only when visible source facts or the user request support them. Do not invent brand names, logos, medical effects, product functions, software features, pricing plans, customer logos, security/compliance capabilities, integrations, reviews, certifications, rankings, percentages, or dashboard data that are not visible in the uploaded source.",
    "Use RAG as guidance for structure and tone only. The uploaded source and user request are the facts.",
    "Korean-market direction: trust before hype, mobile readability, realistic use cases, concrete purchase or adoption reasons, delivery/exchange/AS or onboarding/support/security anxiety handling, and cautious compliance language.",
    `Sales channel: ${input.channel}`,
    `Target aspect ratio: ${input.aspectRatio}`,
    `Sections requested in this call: S${input.startSection} to S${input.startSection + input.count - 1}`,
    `User request: ${input.requestText || "conversion-focused redesign"}`,
    input.rolloutRequest ? `Rollout request after hero review: ${input.rolloutRequest}` : "Rollout request after hero review: none",
    input.knowledgeText ? `RAG guidance:\n${input.knowledgeText.slice(0, 30000)}` : "RAG guidance: none",
    "JSON schema: product_inferred, diagnostic_summary, strategy, page_blueprint, compliance_notes. page_blueprint should be an array with section_id, headline, subheadline, bullets, trust, cta for S1-S8. Korean copy should be short, specific, and ready for editable overlays."
  ].join("\n");

  try {
    const { text } = await generateTextWithCodex({
      prompt,
      images: input.references.map(({ base64, mimeType }) => ({ base64, mimeType })),
      timeoutMs: REDESIGN_ANALYSIS_TIMEOUT_MS
    });
    return normalizeAnalysis(extractJsonObject<RedesignAnalysis>(text));
  } catch (error) {
    return {
      diagnostic_summary: `AI 분석 호출에 실패해 기본 리디자인 구조를 사용합니다: ${error instanceof Error ? error.message : "unknown"}`,
      strategy: "원본 정보와 제품 형태를 보존하고, 섹션별 구매 불안 해소와 모바일 가독성을 우선합니다.",
      compliance_notes: "확인되지 않은 효능, 기능, 가격, 공식 로고, 후기, 인증, 수치형 신뢰 문구는 만들지 않습니다."
    };
  }
}

function buildSections(input: {
  count: number;
  startSection: number;
  channel: string;
  aspectRatio: AspectRatio;
  requestText: string;
  rolloutRequest: string;
  analysis: RedesignAnalysis;
}) {
  return sectionTemplates()
    .slice(input.startSection - 1, input.startSection - 1 + input.count)
    .map((template) => {
      const sectionId = template.id;
      const copy = resolveSectionCopy(template, input.analysis);
      const promptText = [
        "Create one source-faithful visual asset for a Korean mobile PDP/detail-page editor from the attached original references. Do not make a standalone poster, ad banner, generic landing page, or full section background plate.",
        "The app template supplies section background, copy cards, CTA, FAQ, labels, and final typography as editable layers. The generated image should focus on product/screen/use-scene/proof/demo imagery only.",
        "Visual direction: premium but practical Korean commerce design, source-faithful product/screen preservation, consistent lighting/color across the page, and a visibly different layout rhythm for each section.",
        "Sharpness requirement: the main product, package, app screen, browser frame, dashboard, or UI widget must be crisp and in focus. Do not use blur, glass blur, fog, motion blur, depth-of-field blur, smeared UI, or tiny unreadable fake labels on the main subject.",
        "Layered-document requirement: do not solve headline, subcopy, bullet/spec, FAQ, or CTA layout inside the generated pixels. The editor template will provide those document layers.",
        "Preserve actual product appearance, package, visible factual claims, brand facts, or software UI structure, screen colors, menus, visible text, and feature names from the source.",
        "For software/SaaS/app pages, do not force a human model. Use real screenshots, browser/mobile frames, demo steps, workflow cards, and feature callouts; keep important text editable whenever possible.",
        "Reviews, ratings, certifications, awards, and numeric proof-style copy are allowed as editable marketing elements. Do not invent product functions, software features, pricing, medical effects, official logos, customer logos, security/compliance capabilities, integrations, or dashboard data.",
        "Do not render new readable marketing copy as pixels. Do not draw Korean or English headlines, CTA text, prices, reviews, certification text, labels, badges, paragraphs, headline panels, CTA buttons, or reserved text layouts.",
        "Existing text that is already part of an uploaded product package or software screenshot may remain. Do not add new text.",
        "Do not use Haneerum, Hanirum, HANEERUM, HR, or this tool name as the product brand unless it is visibly the product brand in the uploaded source.",
        "The eight sections should feel like one coherent mobile detail page, but each section must use a visibly different layout rhythm.",
        "Korean-market style: direct, trustworthy, concrete, scan-friendly, and less sensational than overseas DTC ads.",
        `Sales channel: ${input.channel}`,
        `Aspect ratio: ${input.aspectRatio}`,
        `Section: ${sectionId} ${template.name}`,
        `Section purpose: ${template.purpose}`,
        `Recommended source focus: ${template.source}`,
        `Recommended layout: ${template.layout}`,
        `Editable headline planned by analysis, do not render it: ${copy.headline}`,
        `Editable subheadline planned by analysis, do not render it: ${copy.subheadline}`,
        `Editable bullets planned by analysis, do not render them: ${copy.bullets.join(" / ")}`,
        `Trust or objection line planned by analysis, do not render it: ${copy.trust}`,
        `CTA planned by analysis, do not render it: ${copy.cta}`,
        `User request: ${input.requestText || "conversion-focused redesign"}`,
        input.rolloutRequest ? `Hero review rollout request: ${input.rolloutRequest}` : "Hero review rollout request: none",
        `Analysis summary: ${JSON.stringify(input.analysis).slice(0, 3200)}`,
        "Use source-faithful visual evidence instead of baked text or reserved text space. If factual support is unclear, use a neutral product/screen/use-scene visual instead of a claim."
      ].join("\n");

      return {
        id: sectionId,
        section_id: sectionId,
        image_id: `IMG_${sectionId}`,
        name: template.name,
        purpose: template.purpose,
        source: template.source,
        headline: copy.headline,
        subheadline: copy.subheadline,
        bullets: copy.bullets,
        trust: copy.trust,
        cta: copy.cta,
        prompt: promptText.replaceAll("\n", "<br>"),
        promptText
      } satisfies RedesignProjectSection;
    });
}

function projectSectionToBlueprint(section: RedesignProjectSection, index: number, aspectRatio: AspectRatio): SectionBlueprint {
  const template = sectionTemplates()[sectionNumber(section.section_id) - 1] ?? sectionTemplates()[index] ?? sectionTemplates()[0];
  const layoutTemplate = layoutTemplateForSectionNumber(sectionNumber(section.section_id) || index + 1);
  return {
    section_id: section.section_id || `S${index + 1}`,
    section_name: section.name || template.name,
    layout_template: layoutTemplate,
    goal: section.purpose || template.purpose,
    headline: section.headline || template.headline,
    headline_en: section.headline || template.headline,
    subheadline: section.subheadline || template.subheadline,
    subheadline_en: section.subheadline || template.subheadline,
    bullets: section.bullets?.length ? section.bullets : template.bullets,
    bullets_en: section.bullets?.length ? section.bullets : template.bullets,
    trust_or_objection_line: section.trust || template.trust,
    trust_or_objection_line_en: section.trust || template.trust,
    CTA: section.cta || template.cta,
    CTA_en: section.cta || template.cta,
    layout_notes: `${aspectRatio} ${template.layout}`,
    compliance_notes: "원본에서 확인되지 않는 효능, 기능, 요금제, 공식 로고는 사용하지 않습니다. 후기, 인증, 수치형 신뢰 문구는 마케팅 카피로 사용할 수 있습니다.",
    image_id: section.image_id || `redesign_${index + 1}`,
    purpose: section.purpose || template.purpose,
    prompt_ko: section.promptText || section.prompt,
    prompt_en: section.promptText || section.prompt,
    negative_prompt: "fake product functions, fake logos, fake software features, fake pricing, unreadable text, dense paragraphs, distorted product or UI",
    style_guide: "Korean mobile commerce or software promotional PDP, trustworthy, clear, conversion-focused, varied layouts",
    reference_usage: "기존 상세페이지 이미지 또는 서비스 화면을 제품/서비스 사실과 시각 기준으로 사용",
    editableLayers: buildDefaultEditableLayers(section.section_id || `S${index + 1}`, layoutTemplate),
    generatedImage: section.imageUrl,
    imageQualityReport: section.imageQualityReport,
    providerProof: section.providerProof
  };
}

function layoutTemplateForSectionNumber(value: number): PdpLayoutTemplate {
  const templates: PdpLayoutTemplate[] = ["hero", "problem", "benefit", "proof", "spec", "demo", "use-case", "faq-cta"];
  return templates[Math.max(0, Math.min(templates.length - 1, value - 1))] ?? "benefit";
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

function normalizeRedesignImageQualityReport(raw: Record<string, unknown>, sectionId?: string): PdpImageQualityReport {
  const reportedScore = clamp(Number(raw.score ?? 70), 0, 100);
  const issues = Array.isArray(raw.issues)
    ? raw.issues
        .filter((issue): issue is Record<string, unknown> => Boolean(issue && typeof issue === "object" && !Array.isArray(issue)))
        .slice(0, 8)
        .map((issue) => normalizeRedesignQualityIssue(issue, sectionId))
    : [];
  const normalizedIssues = issues.map(upgradeCriticalRedesignIssue);
  const hasCriticalDeliveryIssue = normalizedIssues.some((issue) => issue.severity === "critical");
  const score = hasCriticalDeliveryIssue ? Math.min(reportedScore, 52) : reportedScore;
  const status = hasCriticalDeliveryIssue ? "blocked" : getQualityStatus(score, normalizedIssues, String(raw.status || ""));

  return {
    score,
    status,
    summary:
      pickString(raw, ["summary", "message", "result"]) ||
      (status === "ready"
        ? "리디자인 이미지 품질이 고객 제시 가능한 수준입니다."
        : status === "blocked"
          ? "리디자인 이미지를 고객에게 제공하기 전에 다시 생성해야 합니다."
          : "리디자인 이미지는 사용 가능하지만 고객 제공 전 수동 검수가 필요합니다."),
    checks: normalizeStringArray(raw.checks).slice(0, 8),
    pdpChecks: normalizePdpChecks(readRawPdpChecks(raw), score, status, normalizedIssues),
    issues: normalizedIssues,
    nextActions: normalizeStringArray(raw.nextActions ?? raw.next_actions ?? raw.actions).length
      ? normalizeStringArray(raw.nextActions ?? raw.next_actions ?? raw.actions).slice(0, 4)
      : normalizedIssues.map((issue) => issue.fix).filter(Boolean).slice(0, 4)
  };
}

function upgradeCriticalRedesignIssue(issue: PdpQualityIssue): PdpQualityIssue {
  if (issue.severity === "critical") return issue;
  const text = `${issue.message} ${issue.fix}`.toLowerCase().replace(/[\s_-]+/g, "");
  const isCritical =
    /(blur|blurry|smeared|smear|defocus|fuzzy|croppedoff|textbaked|readabletext|fakelogo|fakeui|fakedashboard|흐림|블러|번짐|뭉개|초점|가짜텍스트|픽셀텍스트|글자가렌더|문구가렌더|가짜ui|가짜대시보드|원본훼손|잘림|크롭|가독성없)/i.test(text);
  return isCritical ? { ...issue, severity: "critical" } : issue;
}

function normalizeRedesignQualityIssue(raw: Record<string, unknown>, sectionId?: string): PdpQualityIssue {
  return {
    sectionId,
    category: normalizeQualityCategory(String(raw.category || "visual")),
    severity: normalizeQualitySeverity(String(raw.severity || "minor")),
    message: pickString(raw, ["message", "issue", "problem", "reason"]) || "이미지 품질 확인이 필요합니다.",
    fix: pickString(raw, ["fix", "action", "recommendation", "nextAction"]) || "이미지를 다시 생성하거나 편집 화면에서 보정하세요."
  };
}

function readRawPdpChecks(raw: Record<string, unknown>) {
  const value = raw.pdpChecks ?? raw.pdp_checks;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function normalizePdpChecks(
  checks: Record<string, unknown> | undefined,
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
      const metric = checks?.[key] && typeof checks[key] === "object" && !Array.isArray(checks[key]) ? (checks[key] as Record<string, unknown>) : {};
      const relatedIssue = findRelatedPdpIssue(key, issues);
      const score = clamp(Number(metric.score ?? (relatedIssue ? Math.min(fallbackScore, relatedIssue.severity === "critical" ? 45 : 68) : fallbackScore)), 0, 100);
      const status = normalizePdpMetricStatus(String(metric.status || ""), score, relatedIssue, fallbackStatus);
      return [
        key,
        {
          score,
          status,
          note: String(metric.note || relatedIssue?.message || defaultPdpCheckNote(key))
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

function normalizePdpMetricStatus(rawStatus: string, score: number, issue: PdpQualityIssue | undefined, fallbackStatus: PdpQualityStatus): PdpQualityStatus {
  const normalized = rawStatus.toLowerCase();
  if (normalized === "blocked" || normalized === "needs_review" || normalized === "ready") return normalized;
  if (issue?.severity === "critical" || score < 55) return "blocked";
  if (issue?.severity === "major" || score < 82 || fallbackStatus === "blocked") return "needs_review";
  return "ready";
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

function normalizeQualityCategory(value: string): PdpQualityIssue["category"] {
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, "");
  if (/(cta|button|calltoaction)/.test(normalized)) return "cta";
  if (/(mobile|viewport|smallscreen)/.test(normalized)) return "mobile";
  if (/(readability|legibility|contrast|fontsize|type)/.test(normalized)) return "readability";
  if (/(product|exposure|subject|package|screen|ui)/.test(normalized)) return "product";
  if (/(composition|layout|whitespace|balance|safezone|overlay)/.test(normalized)) return "composition";
  if (/(story|flow|conversion|composition|layout)/.test(normalized)) return "story";
  if (/(copy|text|headline|readability|safezone|overlay)/.test(normalized)) return "copy";
  if (/(proof|trust|truth|source|factual|producttruthfulness|claim)/.test(normalized)) return "proof";
  if (/(visual|image|blur|sharp|focus|ui|crop|mobile|poster)/.test(normalized)) return "visual";
  if (/(risk|compliance|invent|unsupported|misleading)/.test(normalized)) return "risk";
  if (/(input|brief|missing)/.test(normalized)) return "input";
  return "visual";
}

function normalizeQualitySeverity(value: string): PdpQualityIssue["severity"] {
  const normalized = value.toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "major" || normalized === "high") return "major";
  return "minor";
}

function getQualityStatus(score: number, issues: PdpQualityIssue[], rawStatus: string): PdpQualityStatus {
  const normalized = rawStatus.toLowerCase();
  if (normalized === "ready" || normalized === "needs_review" || normalized === "blocked") return normalized;
  if (issues.some((issue) => issue.severity === "critical") || score < 55) return "blocked";
  if (issues.some((issue) => issue.severity === "major") || score < 82) return "needs_review";
  return "ready";
}

function qualityStatusRank(status: PdpQualityStatus) {
  if (status === "ready") return 3;
  if (status === "needs_review") return 2;
  return 1;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") return JSON.stringify(item);
        return String(item ?? "");
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

async function prepareReferenceImages(files: File[]): Promise<ReferenceImage[]> {
  const output: ReferenceImage[] = [];
  for (const file of files) {
    if (output.length >= MAX_REFERENCE_IMAGES) break;
    const safeName = sanitizeFileName(file.name || "reference-image");
    const mimeType = normalizeMimeType(file.type || guessMimeType(safeName));

    if (!mimeType) continue;
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
      throw new RedesignServiceError(
        "INVALID_IMAGE_PAYLOAD",
        `${safeName} 이미지가 너무 큽니다. 참조 이미지는 1장당 최대 ${Math.round(MAX_REFERENCE_IMAGE_BYTES / 1024 / 1024)}MB까지 사용할 수 있습니다.`
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!hasExpectedImageSignature(buffer, mimeType, MAX_REFERENCE_IMAGE_BYTES)) {
      throw new RedesignServiceError(
        "INVALID_IMAGE_PAYLOAD",
        `${safeName} 이미지 데이터가 ${mimeType} 파일 형식과 일치하지 않습니다. 이미지를 다시 업로드해 주세요.`
      );
    }
    output.push({
      name: safeName,
      mimeType,
      base64: buffer.toString("base64")
    });
  }
  return output;
}

function sectionTemplates(): SectionTemplate[] {
  return [
    {
      id: "S1",
      name: "히어로",
      purpose: "3초 안에 대상 고객과 핵심 구매/도입 이유, 첫 신뢰 단서를 전달합니다.",
      source: "제품 컷, 패키지, 앱 화면, 웹 대시보드, 핵심 USP",
      layout: "가장 선명한 제품 컷 또는 실제 화면을 시각 에셋으로 배치하고, 헤드라인/신뢰 단서/CTA는 편집 가능한 문서 레이어로 분리합니다.",
      headline: "첫 화면에서 선택 이유가 보이게",
      subheadline: "제품/서비스 정체와 고객이 얻는 변화를 먼저 보여줍니다.",
      bullets: ["대상 고객", "핵심 선택 이유", "첫 신뢰 단서"],
      trust: "확인 가능한 정보만 사용",
      cta: "자세히 보기"
    },
    {
      id: "S2",
      name: "문제 공감",
      purpose: "고객이 자기 상황이라고 느낄 구매 전 고민을 짧고 구체적으로 보여줍니다.",
      source: "사용 전 고민, 업무 불편, 구매/도입 망설임",
      layout: "체크리스트나 상황 카드 중심으로 구성하고 제품 컷 또는 화면은 보조로 배치합니다.",
      headline: "이런 불편 때문에 찾고 있었다면",
      subheadline: "과장된 위기감보다 실제 사용 전 고민을 담백하게 짚습니다.",
      bullets: ["반복되는 불편", "구매 전 걱정", "선택 기준"],
      trust: "문제 제기는 공감형으로, 단정형 공포 표현은 금지",
      cta: "해결 기준 보기"
    },
    {
      id: "S3",
      name: "베네핏 3가지",
      purpose: "기능 나열을 고객 언어의 효익으로 바꿔 기억하기 쉽게 만듭니다.",
      source: "기능, 소재, 구성, 사용 장점, SW 기능별 사용자 이득",
      layout: "3개 카드 또는 아이콘 블록으로 리듬 있게 나눕니다.",
      headline: "기능보다 먼저 와닿는 장점",
      subheadline: "고객이 바로 이해할 수 있는 사용 결과로 정리합니다.",
      bullets: ["쉽게 이해", "빠른 비교", "짧은 문장"],
      trust: "효능 표현은 원본 근거가 있을 때만 사용",
      cta: "장점 확인하기"
    },
    {
      id: "S4",
      name: "USP 차별화",
      purpose: "대안 대비 선택할 이유를 납득 가능한 기준으로 정리합니다.",
      source: "소재, 구성, 가격 이유, 브랜드 맥락, 기능, 워크플로우, 연동 범위",
      layout: "비교 매트릭스보다 선택 이유 카드 중심으로 구성합니다.",
      headline: "왜 이 선택이 맞는지",
      subheadline: "가격, 구성, 사용감, 기능 흐름 중 실제로 확인 가능한 차이를 앞세웁니다.",
      bullets: ["선택 이유", "구성 가치", "사용 맥락"],
      trust: "경쟁사 비방이나 근거 없는 1위 표현은 금지",
      cta: "차이점 보기"
    },
    {
      id: "S5",
      name: "근거와 신뢰",
      purpose: "고객이 믿어도 되는 이유를 조건, 자료, 해석으로 나눠 보여줍니다.",
      source: "인증, 시험, 원산지, 성분, 후기, 보안, 연동, 고객사 등 신뢰 근거",
      layout: "문서형 카드와 핵심 문장 3개로 정보 신뢰도를 높입니다.",
      headline: "믿을 수 있는 이유를 분명하게",
      subheadline: "근거가 있는 내용만 크게 보여주고 불확실한 표현은 줄입니다.",
      bullets: ["확인된 근거", "조건 명시", "안전한 표현"],
      trust: "없는 기능/보안/연동 범위는 만들지 않음",
      cta: "근거 확인하기"
    },
    {
      id: "S6",
      name: "사용법과 데모",
      purpose: "구매 또는 도입 후 어떻게 쓰는지 상상되게 해 선택 피로를 줄입니다.",
      source: "사용 장면, 구성품, 순서, 보관법, 앱 화면, 데모 흐름",
      layout: "2~3단계 타임라인, 실제 사용 장면 카드, 또는 화면 기반 데모 카드로 구성합니다.",
      headline: "처음 써도 흐름이 보이게",
      subheadline: "복잡한 설명 대신 첫 사용 또는 첫 도입 흐름을 간단히 보여줍니다.",
      bullets: ["사용 순서", "상황 예시", "도입/관리 팁"],
      trust: "원본과 다른 구성품, 색상, 기능 화면은 추가하지 않음",
      cta: "사용 방법 보기"
    },
    {
      id: "S7",
      name: "후기와 실사용감",
      purpose: "고객 언어의 짧은 리뷰형 문장과 사용 사례로 신뢰를 만듭니다.",
      source: "리뷰, 평점, 실사용 문장, 사용 전후 맥락, 역할별 사용 사례",
      layout: "짧은 후기 카드 또는 실사용 포인트 카드 4~6개로 구성합니다.",
      headline: "실제로 궁금한 건 내 상황에 맞는지입니다",
      subheadline: "별점보다 고객이 말할 법한 구체적인 장면을 보여줍니다.",
      bullets: ["사용감", "고민 해소", "상황별 활용"],
      trust: "없는 기능이나 효능으로 연결하지 않음",
      cta: "사용감 살펴보기"
    },
    {
      id: "S8",
      name: "FAQ와 최종 CTA",
      purpose: "배송, 교환, AS 또는 도입, 보안, 요금제, 사용 전 걱정을 풀고 마지막 행동을 유도합니다.",
      source: "배송, AS, 보관, 구성, 주의사항, 요금제, 무료 체험, 보안, 연동, 지원 범위",
      layout: "FAQ 아코디언처럼 보이는 질문 카드와 하단 CTA를 배치합니다.",
      headline: "마지막으로 걱정되는 것들",
      subheadline: "구매 또는 도입 직전의 작은 불안을 짧게 정리합니다.",
      bullets: ["배송/교환 또는 요금제", "AS/지원", "사용 전 확인"],
      trust: "정책은 사용자 자료에 있을 때만 구체화",
      cta: "구매/도입 전 확인하기"
    }
  ];
}

function normalizeAnalysis(value: RedesignAnalysis): RedesignAnalysis {
  if (!value || typeof value !== "object") return {};
  return value;
}

function formatError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function resolveSectionCopy(template: SectionTemplate, analysis: RedesignAnalysis): SectionTemplate {
  const blueprint = Array.isArray(analysis.page_blueprint) ? analysis.page_blueprint : [];
  const matched = blueprint
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .find((item) => {
      const sectionId = pickString(item, ["section_id", "id", "section"]);
      const name = pickString(item, ["section_name", "name", "title"]);
      return sectionId.toUpperCase() === template.id || name.includes(template.name.replace(/^S\d+\s*/, ""));
    });

  if (!matched) return template;

  return {
    ...template,
    headline: pickString(matched, ["headline", "title", "main_copy"]) || template.headline,
    subheadline: pickString(matched, ["subheadline", "subtitle", "support_copy", "body"]) || template.subheadline,
    bullets: pickStringArray(matched, ["bullets", "points", "key_points"]).length
      ? pickStringArray(matched, ["bullets", "points", "key_points"]).slice(0, 3)
      : template.bullets,
    trust: pickString(matched, ["trust", "trust_or_objection_line", "objection", "proof"]) || template.trust,
    cta: pickString(matched, ["cta", "CTA", "call_to_action"]) || template.cta
  };
}

function inferProjectTitle(analysis: RedesignAnalysis, channel: string) {
  const product = analysis.product_inferred && typeof analysis.product_inferred === "object" ? analysis.product_inferred : {};
  const brand = pickString(product, ["brand_name", "brand", "manufacturer", "maker"]);
  const productName = pickString(product, ["product_name", "name", "product", "title"]);
  const category = pickString(product, ["category", "product_category"]);

  if (brand && productName) return productName.includes(brand) ? `${productName} 리디자인` : `${brand} ${productName} 리디자인`;
  if (productName) return `${productName} 리디자인`;
  if (category) return `${category} 상세페이지 리디자인`;
  return `${channel || "스마트스토어"} 상세페이지 리디자인`;
}

function pickString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function pickStringArray(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value.map(String).map((item) => item.trim()).filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/\n|,|\/|·/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function sectionNumber(sectionId: string) {
  const value = Number(sectionId.replace(/\D/g, ""));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizeMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpg") return "image/jpeg";
  if (SUPPORTED_REFERENCE_IMAGE_MIME_TYPES.has(normalized)) return normalized;
  if (normalized.startsWith("image/")) {
    throw new RedesignServiceError("INVALID_IMAGE_PAYLOAD", `지원하지 않는 이미지 형식입니다: ${normalized}. JPG, PNG, WebP만 사용할 수 있습니다.`);
  }
  return "";
}

function guessMimeType(name: string) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function sanitizeFileName(name: string) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "reference-image";
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
