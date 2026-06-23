import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { canUseCommonKnowledge } from "@/lib/knowledge-access";
import { isRagConfigured, retrieveKnowledge } from "@/lib/rag";
import { hasExpectedImageSignature } from "@/lib/image-validation";

export const runtime = "nodejs";
export const maxDuration = 300;

const OPENAI_IMAGE_MODEL = "gpt-image-2-2026-04-21";
const GOOGLE_NANO_BANANA_2_MODEL = "gemini-3.1-flash-image-preview";
const ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL || "gpt-5.5";
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_IMAGE_BYTES = 16 * 1024 * 1024;
const SUPPORTED_REFERENCE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

type Provider = "openai" | "google";

type ReferenceImage = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

type Section = {
  section_id: string;
  image_id: string;
  name: string;
  purpose: string;
  source: string;
  prompt: string;
  promptText: string;
};

export async function POST(request: NextRequest) {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new UploadValidationError("요청 form-data를 읽지 못했습니다.");
    }

    const files = form.getAll("files").filter((file): file is File => file instanceof File);
    const requestText = String(form.get("request") || "");
    const rolloutRequest = String(form.get("rolloutRequest") || "");
    const knowledgeText = String(form.get("knowledgeText") || "").slice(0, 60000);
    const useKnowledge = String(form.get("useKnowledge") || "") === "true";
    const knowledgeAccessKey = String(form.get("knowledgeAccessKey") || "");
    const provider = String(form.get("model") || "openai") === "google" ? "google" : "openai";
    const channel = String(form.get("channel") || "스마트스토어");
    const ratio = String(form.get("ratio") || "9:16");
    const count = clamp(Number(form.get("count") || 1), 1, 8);
    const startSection = clamp(Number(form.get("startSection") || 1), 1, 8);
    const openaiKey = String(form.get("openaiKey") || "");
    const googleKey = String(form.get("googleKey") || "");
    const apiKey = provider === "google" ? googleKey : openaiKey;

    console.info(`[generate] request provider=${provider} count=${count} startSection=${startSection} files=${files.length} channel=${channel}`);

    if (!apiKey) {
      return NextResponse.json(
        { error: provider === "google" ? "Google Nano Banana 2 API 키가 필요합니다." : "OpenAI Image 2.0 API 키가 필요합니다." },
        { status: 400 }
      );
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "기존 상세페이지 이미지 또는 PDF를 업로드해주세요." }, { status: 400 });
    }

    if (useKnowledge && !canUseCommonKnowledge(knowledgeAccessKey)) {
      return NextResponse.json({ error: "공통 사전 지식 사용 키가 올바르지 않습니다." }, { status: 403 });
    }

    const jobId = randomUUID();
    const references = await prepareReferenceImages(files);
    console.info(`[generate] references prepared job=${jobId} references=${references.length}`);
    if (references.length === 0) {
      return NextResponse.json({ error: "이미지 생성에 사용할 참조 이미지가 없습니다. PDF는 브라우저에서 PNG로 변환한 뒤 전송됩니다." }, { status: 400 });
    }

    const modelInfo = modelMeta(provider);
    const retrievedKnowledgeText = useKnowledge
      ? await buildKnowledgeContext({
          requestText,
          rolloutRequest,
          channel,
          fallbackText: knowledgeText
        })
      : "";
    console.info(`[generate] knowledge ready job=${jobId} useKnowledge=${useKnowledge} chars=${retrievedKnowledgeText.length}`);
    const payload = { request: requestText, rolloutRequest, knowledgeText: retrievedKnowledgeText, options: { channel, ratio, count } };
    console.info(`[generate] analysis start job=${jobId}`);
    const analysis = await analyzeSource({ provider, apiKey, references, payload, modelInfo });
    console.info(`[generate] analysis done job=${jobId}`);
    const sections = buildSections(count, startSection, payload, analysis, modelInfo);
    const projectTitle = inferProjectTitle(analysis, channel);

    const generatedSections = [];
    const failedSections = [];
    for (const [index, section] of sections.entries()) {
      try {
        console.info(`[generate] ${provider} ${section.section_id} start (${index + 1}/${sections.length})`);
        const image = provider === "google"
          ? await generateGoogleImage({ apiKey, prompt: section.promptText, references })
          : await generateOpenAIImage({ apiKey, prompt: section.promptText, references });

        generatedSections.push({
          ...section,
          imageUrl: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`,
          mimeType: image.mimeType
        });
        console.info(`[generate] ${provider} ${section.section_id} done bytes=${image.buffer.length} mime=${image.mimeType}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "이미지 생성 실패";
        console.error(`[generate] ${provider} ${section.section_id} failed: ${message}`);
        failedSections.push({
          ...section,
          error: message
        });
        if (generatedSections.length === 0) {
          throw new Error(`${section.name} 생성 실패: ${humanizeProviderError(message)}`);
        }
        break;
      }
    }

    console.info(`[generate] complete provider=${provider} generated=${generatedSections.length} failed=${failedSections.length}`);

    const isCompleteProject = failedSections.length === 0 && startSection === 1 && generatedSections.length >= 8;

    return NextResponse.json({
      project: {
        id: jobId,
        title: projectTitle,
        channel,
        model: provider,
        modelLabel: modelInfo.label,
        modelId: modelInfo.id,
        count: generatedSections.length,
        ratio,
        status: isCompleteProject ? "완료" : "부분완료",
        files: files.map((file) => file.name),
        request: requestText,
        createdAt: new Date().toISOString(),
        analysis,
        sections: generatedSections,
        failedSections,
        warning: failedSections.length > 0
          ? `${generatedSections.length}장은 생성됐고 ${failedSections.length}장 이후는 실패했습니다. OpenAI Image 2.0 요청 제한이면 잠시 후 섹션별 재생성을 실행하세요.`
          : ""
      }
    });
  } catch (error) {
    console.error("[api/generate]", error);
    const status = error instanceof UploadValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? humanizeProviderError(error.message) : "이미지 생성 중 오류가 발생했습니다." }, { status });
  }
}

async function buildKnowledgeContext({
  requestText,
  rolloutRequest,
  channel,
  fallbackText
}: {
  requestText: string;
  rolloutRequest: string;
  channel: string;
  fallbackText: string;
}) {
  const fallback = fallbackText.slice(0, 60000);
  if (!isRagConfigured()) return fallback;

  try {
    const query = [
      "상세페이지 리디자인 CRO 지식 검색",
      `판매 채널: ${channel}`,
      `추가 요청사항: ${requestText || "전환율 중심 리디자인"}`,
      rolloutRequest ? `히어로 검토 후 요청: ${rolloutRequest}` : ""
    ].filter(Boolean).join("\n");
    const chunks = await retrieveKnowledge(query, 8);
    if (chunks.length === 0) return fallback;

    return chunks
      .map((chunk, index) => [
        `# RAG 검색 지식 ${index + 1}: ${chunk.sourceName} / chunk ${chunk.chunkIndex + 1}`,
        `similarity: ${chunk.similarity.toFixed(3)}`,
        chunk.content
      ].join("\n"))
      .join("\n\n")
      .slice(0, 30000);
  } catch (error) {
    console.warn("[rag] retrieve failed, using fallback knowledge", error);
    return fallback;
  }
}

async function analyzeSource({
  provider,
  apiKey,
  references,
  payload,
  modelInfo
}: {
  provider: Provider;
  apiKey: string;
  references: ReferenceImage[];
  payload: { request: string; rolloutRequest: string; knowledgeText: string; options: { channel: string; ratio: string; count: number } };
  modelInfo: ReturnType<typeof modelMeta>;
}) {
  const prompt = [
    "너는 전환율 중심 CRO 카피라이터 + 상세페이지 UX 디자이너 + 커머스 리서처다.",
    "업로드된 기존 상세페이지 이미지를 근거로 카테고리, USP, 타겟, 전환 저해 요소, 유지할 장점, 리디자인 전략을 한국어 JSON으로 요약하라.",
    "전환 설계는 첫 화면 후킹, 문제 공감, 선택 이유, 근거, 사용법, 불안 해소, 최종 CTA가 섹션별로 겹치지 않게 구성한다.",
    "리뷰, 인증, 수치형 신뢰 문구는 전환 카피로 작성해도 된다. 다만 확인되지 않은 기능, 효능, 가격, 공식 로고, 실제 연동 범위는 만들지 말고 위험 표현은 안전하게 완화하라.",
    `판매 채널: ${payload.options.channel}`,
    `추가 요청사항: ${payload.request || "전환율 중심으로 리디자인"}`,
    payload.rolloutRequest ? `히어로 검토 후 나머지 섹션에 반영할 요청: ${payload.rolloutRequest}` : "히어로 검토 후 요청: 없음",
    payload.knowledgeText ? `사용자 사전 지식:\n${payload.knowledgeText.slice(0, 30000)}` : "사용자 사전 지식: 없음",
    `이미지 생성 모델: ${modelInfo.label} (${modelInfo.id})`,
    "카피는 짧고 구체적인 한국어 전환 문장으로 작성한다. 대상 고객, 사용 상황, 선택 이유, 신뢰 근거가 보이는 표현을 우선한다.",
    "JSON 키: product_inferred, diagnostic_summary, strategy, page_blueprint, compliance_notes"
  ].join("\n");

  try {
    if (provider === "google") {
      return await analyzeWithGoogle({ apiKey, prompt, references });
    }
    return await analyzeWithOpenAI({ apiKey, prompt, references });
  } catch (error) {
    return {
      product_inferred: { category: "업로드 자료 기반 추정", confidence: 0.4 },
      diagnostic_summary: `AI 분석 호출 실패: ${error instanceof Error ? error.message : "unknown"}`,
      strategy: "원본 자료의 제품컷/USP/근거를 보존하고, 6~8장 섹션 구조로 전환 설계를 적용합니다.",
      page_blueprint: [],
      compliance_notes: "확인되지 않은 기능, 효능, 가격, 공식 로고는 생성하지 않습니다. 리뷰, 인증, 수치형 신뢰 문구는 마케팅 카피로 사용할 수 있습니다."
    };
  }
}

async function analyzeWithOpenAI({ apiKey, prompt, references }: { apiKey: string; prompt: string; references: ReferenceImage[] }) {
  const content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string }> = [{ type: "input_text", text: prompt }];
  for (const reference of references.slice(0, MAX_REFERENCE_IMAGES)) {
    content.push({
      type: "input_image",
      image_url: `data:${reference.mimeType};base64,${reference.buffer.toString("base64")}`
    });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      input: [{ role: "user", content }]
    })
  });

  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(withRequestId(data?.error?.message || "OpenAI 분석 요청 실패", response));
  const text = data.output_text || extractOpenAIText(data);
  return parseMaybeJson(text);
}

async function analyzeWithGoogle({ apiKey, prompt, references }: { apiKey: string; prompt: string; references: ReferenceImage[] }) {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];
  for (const reference of references.slice(0, MAX_REFERENCE_IMAGES)) {
    parts.push({
      inlineData: {
        mimeType: reference.mimeType,
        data: reference.buffer.toString("base64")
      }
    });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_NANO_BANANA_2_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ contents: [{ parts }] })
  });

  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(withRequestId(data?.error?.message || "Google 분석 요청 실패", response));
  const text = data?.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text || "";
  return parseMaybeJson(text);
}

async function generateOpenAIImage({ apiKey, prompt, references }: { apiKey: string; prompt: string; references: ReferenceImage[] }) {
  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("size", "1152x2048");
  form.append("quality", "low");
  form.append("output_format", "png");

  for (const reference of references.slice(0, MAX_REFERENCE_IMAGES)) {
    form.append("image[]", new Blob([new Uint8Array(reference.buffer)], { type: reference.mimeType }), reference.name);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(withRequestId(data?.error?.message || "OpenAI Image 2.0 생성 실패", response));
  const imageBase64 = data?.data?.[0]?.b64_json;
  if (!imageBase64) throw new Error("OpenAI 응답에 이미지 데이터가 없습니다.");
  return { mimeType: "image/png", buffer: Buffer.from(imageBase64, "base64") };
}

async function generateGoogleImage({ apiKey, prompt, references }: { apiKey: string; prompt: string; references: ReferenceImage[] }) {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];
  for (const reference of references.slice(0, MAX_REFERENCE_IMAGES)) {
    parts.push({
      inlineData: {
        mimeType: reference.mimeType,
        data: reference.buffer.toString("base64")
      }
    });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_NANO_BANANA_2_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ contents: [{ parts }] })
  });

  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(withRequestId(data?.error?.message || "Google Nano Banana 2 생성 실패", response));
  const imagePart = data?.candidates?.[0]?.content?.parts?.find((part: { inlineData?: { data?: string } }) => part.inlineData);
  if (!imagePart?.inlineData?.data) throw new Error("Google 응답에 이미지 데이터가 없습니다.");
  return {
    mimeType: imagePart.inlineData.mimeType || "image/png",
    buffer: Buffer.from(imagePart.inlineData.data, "base64")
  };
}

function buildSections(
  count: number,
  startSection: number,
  payload: { request: string; rolloutRequest: string; knowledgeText: string; options: { channel: string; ratio: string; count: number } },
  analysis: unknown,
  modelInfo: ReturnType<typeof modelMeta>
): Section[] {
  return sectionTemplates(count, startSection).map((template) => {
    const promptText = [
      "너는 커머스 상세페이지 리디자인 이미지 생성 엔진이다.",
      `이미지 생성 모델: ${modelInfo.label} (${modelInfo.id})`,
      "세로형 9:16 상세페이지 섹션 이미지 1장을 생성한다.",
      "결과는 포스터가 아니라 모바일 상세페이지의 한 섹션이어야 한다. 고급스러운 빈 카피 영역, 제품/화면 중심 비주얼, 신뢰감 있는 정보 패널, 명확한 스캔 동선을 만든다.",
      "선명도 규칙: 주요 제품컷, 패키지, 앱 화면, 브라우저 프레임, 대시보드, UI 위젯은 반드시 선명해야 한다. 블러, 유리 블러, 안개, 모션 블러, 피사계심도 흐림, 뭉개진 UI, 작은 가짜 글씨를 주요 비주얼에 쓰지 않는다.",
      "편집 영역 규칙: 헤드라인, 서브카피, 불릿/스펙, CTA가 올라갈 빈 영역은 상세페이지 안의 카드, 패널, 여백처럼 의도적으로 설계한다. 하단에 따로 붙은 빈 사각형처럼 만들지 않는다.",
      `섹션: ${template.name}`,
      `목적: ${template.purpose}`,
      `원본 참조: ${template.source}`,
      `권장 레이아웃: ${template.layout}`,
      `판매 채널: ${payload.options.channel}`,
      `추가 요청사항: ${payload.request || "전환율 중심으로 리디자인"}`,
      payload.rolloutRequest ? `히어로 1장 검토 후 사용자가 요청한 반영사항: ${payload.rolloutRequest}` : "히어로 검토 후 반영사항: 없음",
      payload.knowledgeText ? `참고 사전 지식: ${payload.knowledgeText.slice(0, 18000)}` : "참고 사전 지식: 없음",
      `분석 요약: ${JSON.stringify(analysis).slice(0, 2400)}`,
      "브랜드명 금지 규칙: '한이룸', '한이룸의', '한이룸 스킨', 'HANEERUM', 'Haneerum', 'HR'은 서비스명 또는 도구명일 뿐이며 제품 브랜드가 아니다. 이 단어들을 이미지 안의 제품명, 브랜드명, 로고, 라벨, 헤드라인, 후기, FAQ, CTA, 패키지 텍스트로 절대 사용하지 않는다.",
      "브랜드 사용 규칙: 제품 브랜드명과 제품명은 업로드된 원본 상세페이지 또는 제품 패키지에서 확인되는 이름만 사용한다. 원본에서 확인되지 않는 새 브랜드명, 새 제품명, 새 로고를 만들지 않는다.",
      "전체 연결 규칙: 8장을 이어 붙였을 때 하나의 상세페이지처럼 보여야 한다. 동일한 브랜드 색, 폰트 감각, 제품 사진 톤은 유지하되 각 섹션의 레이아웃은 반드시 다르게 구성한다. 모든 섹션이 큰 상단 헤드라인+중앙 제품컷으로 반복되면 안 된다.",
      "섹션별 변화 규칙: 제품 위치, 정보 카드 모양, 아이콘 밀도, 배경 분할, CTA/증빙 빈 영역 위치, 깊이감과 크롭 방식을 섹션마다 다르게 한다.",
      "텍스트 정책: 새 마케팅 문구를 이미지 픽셀로 직접 쓰지 않는다. 헤드라인, 불릿, CTA, FAQ 문구는 편집 가능한 레이어가 올라갈 수 있도록 정돈된 빈 영역으로 남긴다. 원본 패키지나 실제 화면 안의 기존 텍스트만 보존한다.",
      "안전 규칙: 원본 제품컷/색감/핵심 기능 정보는 보존한다. 리뷰, 인증, 수치형 신뢰 문구는 전환 카피로 사용할 수 있지만, 확인되지 않은 기능, 효능, 가격, 공식 로고, 실제 연동 범위는 만들지 않는다. 한 장에 메시지 하나만 담고, 작은 글씨와 복잡한 배경을 피한다."
    ].join("\n");

    return {
      section_id: template.id,
      image_id: `IMG_${template.id}`,
      name: template.name,
      purpose: template.purpose,
      source: template.source,
      prompt: promptText.replaceAll("\n", "<br>"),
      promptText
    };
  });
}

async function prepareReferenceImages(files: File[]): Promise<ReferenceImage[]> {
  const references: ReferenceImage[] = [];
  for (const file of files) {
    if (references.length >= MAX_REFERENCE_IMAGES) break;
    const safeName = sanitizeFileName(file.name || "upload");
    const mimeType = normalizeReferenceImageMimeType(file.type || guessMimeType(safeName));

    if (!mimeType) continue;
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
      throw new UploadValidationError(`${safeName} 이미지가 너무 큽니다. 참조 이미지는 1장당 최대 ${Math.round(MAX_REFERENCE_IMAGE_BYTES / 1024 / 1024)}MB까지 사용할 수 있습니다.`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!hasExpectedImageSignature(buffer, mimeType)) {
      throw new UploadValidationError(`${safeName} 이미지 데이터가 손상됐거나 ${mimeType} 형식과 일치하지 않습니다.`);
    }
    references.push({ name: safeName, mimeType, buffer });
  }
  return references;
}

function sectionTemplates(count: number, startSection = 1) {
  const templates = [
    ["S1 히어로", "3초 안에 대상 고객과 핵심 선택 이유, 첫 신뢰 단서를 전달합니다.", "제품컷, 대표 USP", "제품컷 또는 실제 화면을 가장 선명하게 쓰고, 상단/하단에 편집 가능한 헤드라인과 CTA 빈 영역을 둡니다."],
    ["S2 문제 공감", "고객이 자기 상황이라고 느낄 구매 전 고민을 짧게 짚습니다.", "사용 전 고민 문구", "체크리스트/상황 카드 중심. 제품컷은 보조로 두고 히어로와 다른 구도를 사용합니다."],
    ["S3 베네핏 3개", "기능 나열을 체감 가능한 사용 장점으로 바꿉니다.", "기능 설명, 사용 장점", "3개 베네핏을 스텝 또는 아이콘 타일로 구성하고, 제품은 측면/코너 배치로 반복을 피합니다."],
    ["S4 선택 이유", "대안 대비 왜 이 제품/서비스를 골라야 하는지 납득시킵니다.", "소재, 구성, 가격, 워크플로우", "선택 이유 카드와 비교 기준 패널 중심. 제품컷은 표 옆 또는 하단 보조 요소로 배치합니다."],
    ["S5 근거/신뢰", "원본에서 확인 가능한 근거만으로 신뢰 장벽을 낮춥니다.", "인증, 수치, 테스트, 화면 증거", "문서/라벨/성분표/화면 근거를 읽기 쉬운 정보 패널로 구성합니다."],
    ["S6 사용법/데모", "구매 또는 도입 후 첫 사용 흐름을 쉽게 상상하게 합니다.", "루틴, 구성품, 데모 흐름", "2~4단계 타임라인이나 화면 기반 데모 카드로 구성하고 큰 헤드라인 반복은 피합니다."],
    ["S7 상황별 활용", "고객이 자기 상황에 대입할 수 있는 사용 맥락을 만듭니다.", "리뷰, 사용 사례, 역할별 장면", "상황별 카드 4~6개 또는 리뷰형 신뢰 카드. 없는 기능이나 효능으로 연결하지 않습니다."],
    ["S8 FAQ/오퍼", "마지막 구매/도입 저항을 해소하고 행동을 유도합니다.", "배송, AS, 혜택, 보안, 요금제", "FAQ 아코디언처럼 보이는 질문 카드와 하단 CTA 빈 영역을 배치합니다."]
  ];

  return templates
    .map(([name, purpose, source, layout], index) => ({ id: `S${index + 1}`, name, purpose, source, layout }))
    .slice(startSection - 1, startSection - 1 + count);
}

function inferProjectTitle(analysis: unknown, channel: string) {
  const product = typeof analysis === "object" && analysis && "product_inferred" in analysis
    ? (analysis as { product_inferred?: Record<string, unknown> }).product_inferred || {}
    : {};
  const brand = pickString(product, ["brand_name", "brand", "manufacturer", "maker"]);
  const productName = pickString(product, ["product_name", "name", "product", "title"]);
  const category = pickString(product, ["category", "product_category"]);

  if (brand && productName) {
    return productName.includes(brand) ? `${productName} 리디자인` : `${brand} ${productName} 리디자인`;
  }
  if (productName) return `${productName} 리디자인`;
  if (category) return `${category} 상세페이지 리디자인`;
  return `${channel} 상세페이지 리디자인`;
}

function pickString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseMaybeJson(text: string) {
  const raw = String(text || "").trim();
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return { summary: raw };
  try {
    return JSON.parse(jsonText);
  } catch {
    return { summary: raw };
  }
}

function extractOpenAIText(data: { output?: Array<{ content?: Array<{ text?: string }> }> }) {
  return data.output?.flatMap((item) => item.content || []).map((content) => content.text || "").filter(Boolean).join("\n") || "";
}

function modelMeta(provider: Provider) {
  if (provider === "google") {
    return { provider: "google" as const, label: "Google Nano Banana 2", id: GOOGLE_NANO_BANANA_2_MODEL };
  }
  return { provider: "openai" as const, label: "OpenAI Image 2.0", id: OPENAI_IMAGE_MODEL };
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: simplifyPlainTextError(text, response.statusText) } };
  }
}

function simplifyPlainTextError(text: string, fallback: string) {
  const message = text.trim() || fallback || "요청 처리 중 오류가 발생했습니다.";
  if (message.startsWith("<!DOCTYPE") || message.startsWith("<html")) {
    return "외부 API가 JSON이 아닌 오류 페이지를 반환했습니다. API 키, 모델 권한, 요청 크기를 확인해 주세요.";
  }
  if (message.toLowerCase().includes("request entity too large") || message.includes("413")) {
    return "이미지 데이터가 너무 커서 외부 API가 요청을 거부했습니다. 업로드 이미지를 줄이거나 페이지 수를 줄여 다시 시도해 주세요.";
  }
  return message.slice(0, 500);
}

function withRequestId(message: string, response: Response) {
  const requestId = response.headers.get("x-request-id");
  return requestId ? `${message} (request_id: ${requestId})` : message;
}

function humanizeProviderError(message: string) {
  if (message.includes("Incorrect API key provided")) {
    return [
      "OpenAI API 키가 올바르지 않습니다.",
      "API 키 설정에서 기존 키를 삭제한 뒤 OpenAI Platform에서 발급한 최신 키를 다시 입력해주세요.",
      message.match(/request_id: [^)]+/)?.[0] || ""
    ].filter(Boolean).join(" ");
  }
  if (message.includes("invalid_api_key")) {
    return [
      "API 키가 올바르지 않습니다.",
      "선택한 이미지 생성 모델에 맞는 API 키를 다시 입력해주세요.",
      message.match(/request_id: [^)]+/)?.[0] || ""
    ].filter(Boolean).join(" ");
  }
  if (message.includes("must be verified") && message.includes("gpt-image-2-2026-04-21")) {
    return [
      "OpenAI Image 2.0 사용 권한이 아직 없습니다.",
      "이 모델은 OpenAI 조직 인증이 필요합니다.",
      "OpenAI Platform > Settings > Organization > General에서 Verify Organization을 완료한 뒤 15분 정도 기다려주세요.",
      message.match(/request_id: [^)]+/)?.[0] || ""
    ].filter(Boolean).join(" ");
  }
  if (message.includes("Invalid image file or mode")) {
    return [
      "업로드 이미지 형식이 OpenAI Image 2.0 편집 입력과 맞지 않습니다.",
      "긴 상세페이지 캡처나 JPG 색상 모드 문제일 수 있어, 앱에서 PNG 변환/분할 후 다시 전송하도록 수정했습니다.",
      "새로고침 후 다시 생성해주세요.",
      message.match(/request_id: [^)]+/)?.[0] || ""
    ].filter(Boolean).join(" ");
  }
  return message;
}

function sanitizeFileName(name: string) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "upload";
}

function guessMimeType(name: string) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function normalizeReferenceImageMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpg") return "image/jpeg";
  if (SUPPORTED_REFERENCE_IMAGE_MIME_TYPES.has(normalized)) return normalized;
  if (normalized.startsWith("image/")) {
    throw new UploadValidationError(`지원하지 않는 이미지 형식입니다: ${normalized}. JPG, PNG, WebP만 사용할 수 있습니다.`);
  }
  return "";
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
