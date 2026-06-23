import { generateImageWithCodex } from "../../../../lib/codex-oauth";
import { hasExpectedImageSignature } from "../../../../lib/image-validation";
import { evaluateRedesignImageQuality } from "../../../../lib/redesign-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_EDIT_IMAGE_BYTES = 16 * 1024 * 1024;
const SUPPORTED_EDIT_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

class RedesignEditValidationError extends Error {
  readonly code = "INVALID_IMAGE_PAYLOAD";
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        {
          ok: false,
          error: "요청 JSON을 읽지 못했습니다.",
          code: "INVALID_REQUEST"
        },
        { status: 400 }
      );
    }

    const image = parseDataUrl(String(body.imageUrl || ""));
    const requestText = String(body.request || "").trim();
    const section = body.section && typeof body.section === "object" ? body.section as Record<string, unknown> : {};
    const project = body.project && typeof body.project === "object" ? body.project as Record<string, unknown> : {};
    const aspectRatio = String(body.aspectRatio || project.ratio || "9:16");

    if (!image) return Response.json({ ok: false, error: "수정할 섹션 이미지가 없습니다." }, { status: 400 });
    if (!requestText) return Response.json({ ok: false, error: "섹션 수정 요청사항을 입력해 주세요." }, { status: 400 });

    const prompt = [
      "Edit/redesign the attached ecommerce or software promotional PDP section image.",
      "Keep the same product, software UI, and factual constraints. Change only what is needed for the user's request.",
      "Korean-market style: trustworthy, mobile-readable, concrete, and not overhyped.",
      "The edited result must stay sharp. Do not blur, smear, fog, crop off, or hide the main product, package, app screen, browser frame, dashboard, or important UI geometry.",
      "Maintain integrated blank editable areas for headline, support copy, bullets/specs, and CTA; they should look like intentional PDP panels, not a disconnected empty block.",
      "Reviews, ratings, certifications, awards, and numeric proof-style copy are allowed as editable marketing elements. Do not invent product functions, software features, integrations, pricing, medical effects, official logos, customer logos, security/compliance capabilities, or dashboard data.",
      "Do not add new readable marketing copy as pixels. If copy needs to change, leave clean blank editable text areas; the app editor will place editable text overlays.",
      "If the request asks for a risky claim, soften it into a neutral expression.",
      `Project: ${project.title || "상세페이지 리디자인"}`,
      `Channel: ${project.channel || "스마트스토어"}`,
      `Section: ${section.section_id || section.id || ""} ${section.section_name || section.name || ""}`,
      `Section goal: ${section.goal || section.purpose || ""}`,
      `User edit request: ${requestText}`,
      "Preserve the product shape, package, color, visible factual information, or software screen structure, menus, colors, and visible text from the reference."
    ].join("\n");

    const result = await generateImageWithCodex({
      prompt,
      referenceImages: [image],
      aspectRatio
    });
    const imageQualityReport = await evaluateRedesignImageQuality({
      imageBase64: result.imageBase64,
      mimeType: result.mimeType,
      section: {
        section_id: String(section.section_id || section.id || "S1"),
        name: String(section.section_name || section.name || "리디자인 섹션"),
        purpose: String(section.goal || section.purpose || ""),
        headline: String(section.headline || ""),
        subheadline: String(section.subheadline || ""),
        bullets: Array.isArray(section.bullets) ? section.bullets.map(String) : [],
        trust: String(section.trust || section.trust_or_objection_line || ""),
        cta: String(section.cta || section.CTA || "")
      },
      aspectRatio,
      channel: String(project.channel || "스마트스토어"),
      requestText
    });

    return Response.json({
      ok: true,
      imageUrl: `data:${result.mimeType};base64,${result.imageBase64}`,
      mimeType: result.mimeType,
      prompt,
      imageQualityReport,
      providerProof: result.providerProof
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "섹션 수정 중 오류가 발생했습니다.",
        detail: error instanceof Error && "detail" in error ? String(error.detail ?? "") : undefined,
        code: error instanceof Error && "code" in error ? String(error.code) : "REDESIGN_EDIT_FAILED"
      },
      { status: mapErrorStatus(error) }
    );
  }
}

function parseDataUrl(value: string) {
  if (!value.trim()) return null;
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new RedesignEditValidationError("수정할 섹션 이미지 데이터가 올바른 data URL 형식이 아닙니다.");
  }
  return validateImagePayload(match[2], match[1], "수정할 섹션 이미지");
}

function mapErrorStatus(error: unknown) {
  const code = error instanceof Error && "code" in error ? String(error.code) : "";
  if (code === "INVALID_IMAGE_PAYLOAD" || code === "INVALID_REQUEST") return 400;
  if (code === "CODEX_AUTH_MISSING" || code === "CODEX_AUTH_STALE") return 401;
  if (code === "CODEX_MODEL_ACCESS_DENIED" || code === "CODEX_MODEL_NOT_FOUND") return 403;
  if (code === "CODEX_RESPONSE_INVALID" || code === "REDESIGN_EDIT_FAILED") return 502;
  return 500;
}

function validateImagePayload(base64Value: string, mimeTypeValue: string, label: string) {
  const mimeType = normalizeMimeType(mimeTypeValue);
  if (!SUPPORTED_EDIT_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new RedesignEditValidationError(`${label}의 이미지 형식이 지원되지 않습니다. JPG, PNG, WebP만 사용할 수 있습니다.`);
  }

  const base64 = base64Value.replace(/\s+/g, "");
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new RedesignEditValidationError(`${label}의 이미지 데이터가 올바른 base64 형식이 아닙니다.`);
  }

  const byteLength = estimateBase64Bytes(base64);
  if (byteLength <= 0) {
    throw new RedesignEditValidationError(`${label}의 이미지 데이터가 비어 있습니다.`);
  }
  if (byteLength > MAX_EDIT_IMAGE_BYTES) {
    throw new RedesignEditValidationError(
      `${label}가 너무 큽니다. 수정용 이미지는 최대 ${Math.round(MAX_EDIT_IMAGE_BYTES / 1024 / 1024)}MB까지 사용할 수 있습니다.`
    );
  }
  const bytes = Buffer.from(base64, "base64");
  if (!hasExpectedImageSignature(bytes, mimeType, MAX_EDIT_IMAGE_BYTES)) {
    throw new RedesignEditValidationError(`${label}의 이미지 데이터가 ${mimeType} 파일 형식과 일치하지 않습니다. 이미지를 다시 업로드해 주세요.`);
  }

  return { mimeType, base64 };
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
