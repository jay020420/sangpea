import { NextRequest, NextResponse } from "next/server";
import { hasExpectedImageSignature } from "@/lib/image-validation";

export const runtime = "nodejs";
export const maxDuration = 300;

const OPENAI_IMAGE_MODEL = "gpt-image-2-2026-04-21";
const GOOGLE_NANO_BANANA_2_MODEL = "gemini-3.1-flash-image-preview";
const MAX_EDIT_IMAGE_BYTES = 16 * 1024 * 1024;
const SUPPORTED_EDIT_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

class EditValidationError extends Error {
  readonly status = 400;
}

type Provider = "openai" | "google";

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "요청 JSON을 읽지 못했습니다." }, { status: 400 });
    }

    const provider: Provider = body.model === "google" ? "google" : "openai";
    const image = parseDataUrl(String(body.imageUrl || ""));
    const requestText = String(body.request || "");
    const section = body.section && typeof body.section === "object" ? body.section as Record<string, unknown> : {};
    const project = body.project && typeof body.project === "object" ? body.project as Record<string, unknown> : {};
    const openaiKey = String(body.openaiKey || "");
    const googleKey = String(body.googleKey || "");
    const apiKey = provider === "google" ? googleKey : openaiKey;

    if (!apiKey) {
      return NextResponse.json(
        { error: provider === "google" ? "Google Nano Banana 2 API 키가 필요합니다." : "OpenAI Image 2.0 API 키가 필요합니다." },
        { status: 400 }
      );
    }
    if (!image) {
      return NextResponse.json({ error: "수정할 섹션 이미지가 없습니다." }, { status: 400 });
    }
    if (!requestText.trim()) {
      return NextResponse.json({ error: "섹션 수정 요청사항을 입력해주세요." }, { status: 400 });
    }

    const prompt = [
      "너는 커머스 상세페이지 섹션 이미지 편집 엔진이다.",
      "첨부된 9:16 상세페이지 섹션 이미지를 기반으로 같은 제품과 전체 톤앤매너를 유지하면서 필요한 부분만 편집한다.",
      "결과는 포스터가 아니라 모바일 상세페이지 섹션이어야 한다. 고급스러운 빈 카피 영역, 신뢰감 있는 정보 패널, 제품/화면 중심 비주얼을 유지한다.",
      "선명도 규칙: 주요 제품컷, 패키지, 앱 화면, 브라우저 프레임, 대시보드, UI 위젯은 반드시 선명하게 유지한다. 블러, 유리 블러, 안개, 모션 블러, 뭉개진 UI, 작은 가짜 글씨를 주요 비주얼에 쓰지 않는다.",
      "편집 영역 규칙: 헤드라인, 서브카피, 불릿/스펙, CTA가 올라갈 빈 영역은 상세페이지 안의 카드, 패널, 여백처럼 의도적으로 설계한다. 하단에 따로 붙은 빈 사각형처럼 만들지 않는다.",
      `프로젝트: ${project.title || "상세페이지 리디자인"}`,
      `판매 채널: ${project.channel || "스마트스토어"}`,
      `섹션: ${section.id || ""} ${section.name || ""}`,
      `섹션 목적: ${section.purpose || ""}`,
      `원본 참조: ${section.source || ""}`,
      `사용자 수정 요청: ${requestText}`,
      "브랜드명 금지 규칙: '한이룸', '한이룸의', '한이룸 스킨', 'HANEERUM', 'Haneerum', 'HR'은 서비스명 또는 도구명일 뿐이며 제품 브랜드가 아니다. 이 단어들을 이미지 안의 제품명, 브랜드명, 로고, 라벨, 헤드라인, 후기, FAQ, CTA, 패키지 텍스트로 절대 사용하지 않는다.",
      "브랜드 사용 규칙: 제품 브랜드명과 제품명은 첨부된 이미지와 프로젝트 원본에서 확인되는 이름만 사용한다. 원본에서 확인되지 않는 새 브랜드명, 새 제품명, 새 로고를 만들지 않는다.",
      "텍스트 정책: 새 마케팅 문구를 이미지 픽셀로 직접 쓰지 않는다. 헤드라인, 불릿, CTA, FAQ 문구는 편집 가능한 레이어가 올라갈 수 있도록 정돈된 빈 영역으로 남긴다. 원본 패키지나 실제 화면 안의 기존 텍스트만 보존한다.",
      "규칙: 제품명, 패키지, 핵심 기능, 안전한 표현 원칙은 유지한다. 리뷰, 인증, 수치형 신뢰 문구는 전환 카피로 사용할 수 있지만, 확인되지 않은 기능, 효능, 가격, 공식 로고, 실제 연동 범위는 새로 만들지 않는다. 같은 상세페이지 안에서 이어 붙였을 때 반복 레이아웃처럼 보이지 않도록 정보 배치, 카드 구조, 타이포 리듬을 조정한다."
    ].join("\n");

    const edited = provider === "google"
      ? await editWithGoogle({ apiKey, prompt, image })
      : await editWithOpenAI({ apiKey, prompt, image });

    return NextResponse.json({
      imageUrl: `data:${edited.mimeType};base64,${edited.buffer.toString("base64")}`,
      mimeType: edited.mimeType,
      prompt
    });
  } catch (error) {
    console.error("[api/edit-section]", error);
    const status = error instanceof EditValidationError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? humanizeProviderError(error.message) : "섹션 수정 중 오류가 발생했습니다." }, { status });
  }
}

async function editWithOpenAI({
  apiKey,
  prompt,
  image
}: {
  apiKey: string;
  prompt: string;
  image: { mimeType: string; buffer: Buffer };
}) {
  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("size", "1152x2048");
  form.append("quality", "low");
  form.append("output_format", "png");
  form.append("image[]", new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }), "section.png");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(withRequestId(data?.error?.message || "OpenAI Image 2.0 섹션 수정 실패", response));
  const imageBase64 = data?.data?.[0]?.b64_json;
  if (!imageBase64) throw new Error("OpenAI 응답에 이미지 데이터가 없습니다.");
  return { mimeType: "image/png", buffer: Buffer.from(imageBase64, "base64") };
}

async function editWithGoogle({
  apiKey,
  prompt,
  image
}: {
  apiKey: string;
  prompt: string;
  image: { mimeType: string; buffer: Buffer };
}) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_NANO_BANANA_2_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: image.mimeType, data: image.buffer.toString("base64") } }
        ]
      }]
    })
  });

  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(withRequestId(data?.error?.message || "Google Nano Banana 2 섹션 수정 실패", response));
  const imagePart = data?.candidates?.[0]?.content?.parts?.find((part: { inlineData?: { data?: string } }) => part.inlineData);
  if (!imagePart?.inlineData?.data) throw new Error("Google 응답에 이미지 데이터가 없습니다.");
  return {
    mimeType: imagePart.inlineData.mimeType || "image/png",
    buffer: Buffer.from(imagePart.inlineData.data, "base64")
  };
}

function parseDataUrl(value: string) {
  if (!value.trim()) return null;
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new EditValidationError("수정할 섹션 이미지 데이터가 올바른 data URL 형식이 아닙니다.");
  }
  return validateImagePayload(match[2], match[1], "수정할 섹션 이미지");
}

function validateImagePayload(base64Value: string, mimeTypeValue: string, label: string) {
  const mimeType = normalizeMimeType(mimeTypeValue);
  if (!SUPPORTED_EDIT_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new EditValidationError(`${label}의 이미지 형식이 지원되지 않습니다. JPG, PNG, WebP만 사용할 수 있습니다.`);
  }

  const base64 = base64Value.replace(/\s+/g, "");
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new EditValidationError(`${label}의 이미지 데이터가 올바른 base64 형식이 아닙니다.`);
  }

  const byteLength = estimateBase64Bytes(base64);
  if (byteLength <= 0) {
    throw new EditValidationError(`${label}의 이미지 데이터가 비어 있습니다.`);
  }
  if (byteLength > MAX_EDIT_IMAGE_BYTES) {
    throw new EditValidationError(
      `${label}가 너무 큽니다. 수정용 이미지는 최대 ${Math.round(MAX_EDIT_IMAGE_BYTES / 1024 / 1024)}MB까지 사용할 수 있습니다.`
    );
  }

  const buffer = Buffer.from(base64, "base64");
  if (!hasExpectedImageSignature(buffer, mimeType)) {
    throw new EditValidationError(`${label}의 이미지 데이터가 손상됐거나 ${mimeType} 형식과 일치하지 않습니다.`);
  }

  return {
    mimeType,
    buffer
  };
}

function normalizeMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized;
}

function estimateBase64Bytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
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
    return "OpenAI API 키가 올바르지 않습니다. API 키 설정에서 기존 키를 삭제한 뒤 OpenAI Platform에서 발급한 최신 키를 다시 입력해주세요.";
  }
  if (message.includes("invalid_api_key")) {
    return "API 키가 올바르지 않습니다. 선택한 이미지 생성 모델에 맞는 API 키를 다시 입력해주세요.";
  }
  if (message.includes("must be verified") && message.includes("gpt-image-2-2026-04-21")) {
    return "OpenAI Image 2.0 사용 권한이 아직 없습니다. OpenAI 조직 인증을 완료한 뒤 다시 시도해주세요.";
  }
  return message;
}
