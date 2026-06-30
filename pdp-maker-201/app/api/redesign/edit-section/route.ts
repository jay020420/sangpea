import { getImageProvider } from "../../../../lib/image-providers";
import { hasExpectedImageSignature } from "../../../../lib/image-validation";
import { evaluateRedesignImageQuality } from "../../../../lib/redesign-service";
import { REQUEST_LIMITS, jsonNoStore, readJsonBody, requestErrorResponse } from "../../../../lib/server/api-guards";
import { withOperationGuard } from "../../../../lib/server/operation-guards";
import type { PdpLayerBounds, PdpLayerNode, PdpLayerPlanContext } from "@runacademy/shared";

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
      body = await readJsonBody<Record<string, unknown>>(request, {
        maxBytes: REQUEST_LIMITS.redesignEditJson,
        label: "리디자인 섹션 수정"
      });
    } catch (error) {
      return requestErrorResponse(error, {
        fallbackMessage: "요청 JSON을 읽지 못했습니다."
      });
    }

    const image = parseDataUrl(String(body.imageUrl || ""));
    const requestText = String(body.request || "").trim();
    const section = body.section && typeof body.section === "object" ? body.section as Record<string, unknown> : {};
    const project = body.project && typeof body.project === "object" ? body.project as Record<string, unknown> : {};
    const aspectRatio = String(body.aspectRatio || project.ratio || "9:16");
    const targetLayerId = typeof body.targetLayerId === "string" ? body.targetLayerId.trim() : "";
    const targetLayerRole = typeof body.targetLayerRole === "string" ? body.targetLayerRole.trim() : "";
    const targetBounds = parseLayerBounds(body.targetBounds);
    const layerPlan = parseLayerPlan(body.layerPlan);
    const targetPrompt = buildTargetLayerPrompt({
      targetLayerId,
      targetLayerRole,
      targetBounds,
      layerPlan
    });

    if (!image) return Response.json({ ok: false, error: "수정할 섹션 이미지가 없습니다." }, { status: 400 });
    if (!requestText) return Response.json({ ok: false, error: "섹션 수정 요청사항을 입력해 주세요." }, { status: 400 });

    const prompt = [
      "Edit/redesign only the targeted visual asset inside the attached ecommerce or software PDP document.",
      targetPrompt,
      "Keep the same product, software UI, and factual constraints. Change only what is needed for the user's request.",
      "Korean-market style: trustworthy, mobile-readable, concrete, and not overhyped.",
      "The edited visual asset must stay sharp. Do not blur, smear, fog, crop off, or hide the main product, package, app screen, browser frame, dashboard, or important UI geometry.",
      "Do not create or preserve blank text panels, empty headline areas, CTA placeholders, poster banners, or copy slots inside the edited pixels. The app template owns copy surfaces, CTA, badges, and other editable document layers.",
      "Reviews, ratings, certifications, awards, and numeric proof-style copy are allowed as editable marketing elements. Do not invent product functions, software features, integrations, pricing, medical effects, official logos, customer logos, security/compliance capabilities, or dashboard data.",
      "Do not add new readable marketing copy as pixels. If copy needs to change, keep the visual asset clean and let the app editor place or update editable text overlays.",
      "If the request asks for a risky claim, soften it into a neutral expression.",
      `Project: ${project.title || "상세페이지 리디자인"}`,
      `Channel: ${project.channel || "스마트스토어"}`,
      `Section: ${section.section_id || section.id || ""} ${section.section_name || section.name || ""}`,
      `Section goal: ${section.goal || section.purpose || ""}`,
      `User edit request: ${requestText}`,
      "Preserve the product shape, package, color, visible factual information, or software screen structure, menus, colors, and visible text from the reference."
    ].join("\n");

    return withOperationGuard(request, {
      operation: "redesign.edit-section",
      category: "generation"
    }, async () => {
      const result = await getImageProvider().edit({
        prompt,
        sourceImage: image,
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

      return jsonNoStore({
        ok: true,
        imageUrl: `data:${result.mimeType};base64,${result.imageBase64}`,
        mimeType: result.mimeType,
        prompt,
        targetLayerId: targetLayerId || undefined,
        targetBounds: targetBounds ?? undefined,
        imageQualityReport,
        providerProof: result.providerProof
      });
    });
  } catch (error) {
    return jsonNoStore(
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

function parseLayerBounds(value: unknown): PdpLayerBounds | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PdpLayerBounds>;
  const unit = candidate.unit === "percent" ? "percent" : "px";
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    x,
    y,
    width,
    height,
    unit,
    rotation: Number.isFinite(Number(candidate.rotation)) ? Number(candidate.rotation) : undefined
  };
}

function parseLayerPlan(value: unknown): PdpLayerPlanContext | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PdpLayerPlanContext>;
  if (!candidate.canvas || typeof candidate.canvas.width !== "number" || typeof candidate.canvas.height !== "number" || !Array.isArray(candidate.sections)) {
    return null;
  }
  return {
    canvas: candidate.canvas,
    sections: candidate.sections
  };
}

function buildTargetLayerPrompt(input: {
  targetLayerId: string;
  targetLayerRole: string;
  targetBounds: PdpLayerBounds | null;
  layerPlan: PdpLayerPlanContext | null;
}) {
  const layerPlanSummary = input.layerPlan ? summarizeLayerPlan(input.layerPlan, input.targetLayerId) : "";
  if (!input.targetLayerId || !input.targetBounds) {
    return [
      "TARGETING MODE: whole-section edit. Preserve the current section composition unless the user explicitly asks for a broader redesign.",
      layerPlanSummary
    ]
      .filter(Boolean)
      .join("\n");
  }

  const bounds = boundsToPrompt(input.targetBounds, input.layerPlan?.canvas ?? null);
  return [
    "TARGETING MODE: layer-targeted edit.",
    `Target layer id: ${input.targetLayerId}`,
    input.targetLayerRole ? `Target layer role: ${input.targetLayerRole}` : "",
    `Target bounds: ${bounds}`,
    "Change only the visual treatment needed around this target rectangle. Preserve everything outside the target bounds unless it must be adjusted to maintain continuity.",
    "Do not redraw the full section from scratch. Do not move unrelated product/screen areas, proof areas, headline zones, bullet zones, or CTA zones.",
    layerPlanSummary
  ]
    .filter(Boolean)
    .join("\n");
}

function summarizeLayerPlan(layerPlan: PdpLayerPlanContext, targetLayerId: string) {
  const nodes = layerPlan.sections.flatMap((section) => section.nodes.flatMap(flattenLayerNode)).filter(isRelevantLayerPlanNode);
  if (!nodes.length) return "";
  const lines = nodes.slice(0, 16).map((node) => {
    const marker = node.id === targetLayerId ? "TARGET" : "PRESERVE";
    return `${marker} ${node.id} role=${node.role || node.type} ${boundsToPrompt(node.bounds, layerPlan.canvas)}`;
  });
  return [`LayeredDocument section plan: canvas ${layerPlan.canvas.width}x${layerPlan.canvas.height}px`, ...lines].join("\n");
}

function flattenLayerNode(node: PdpLayerNode): PdpLayerNode[] {
  return [node, ...(node.children ?? []).flatMap(flattenLayerNode)];
}

function isRelevantLayerPlanNode(node: PdpLayerNode) {
  const role = node.role || "";
  return role === "product" || role === "safe-zone" || role === "headline" || role === "subheadline" || role === "bullet" || role === "trust" || role === "cta" || node.type === "cta" || node.type === "proof";
}

function boundsToPrompt(bounds: PdpLayerBounds, canvas: PdpLayerPlanContext["canvas"] | null) {
  const px =
    bounds.unit === "percent" && canvas
      ? {
          x: Math.round((bounds.x / 100) * canvas.width),
          y: Math.round((bounds.y / 100) * canvas.height),
          width: Math.round((bounds.width / 100) * canvas.width),
          height: Math.round((bounds.height / 100) * canvas.height)
        }
      : {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height)
        };
  return `px(x:${px.x}, y:${px.y}, w:${px.width}, h:${px.height})`;
}

function mapErrorStatus(error: unknown) {
  const code = error instanceof Error && "code" in error ? String(error.code) : "";
  if (code === "INVALID_IMAGE_PAYLOAD" || code === "INVALID_REQUEST") return 400;
  if (code === "CODEX_AUTH_MISSING" || code === "CODEX_AUTH_STALE") return 401;
  if (code === "CODEX_MODEL_ACCESS_DENIED" || code === "CODEX_MODEL_NOT_FOUND") return 403;
  if (code === "CODEX_USAGE_LIMIT") return 429;
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
