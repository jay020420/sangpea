import { getImageProvider } from "../../../../lib/image-providers";
import { REQUEST_LIMITS, jsonNoStore, readJsonBody, requestErrorResponse } from "../../../../lib/server/api-guards";
import { withOperationGuard } from "../../../../lib/server/operation-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_VERIFY_IMAGE_BYTES = 16 * 1024 * 1024;
const SUPPORTED_VERIFY_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

class VerifyImageValidationError extends Error {
  readonly code = "INVALID_IMAGE_PAYLOAD";
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody<Record<string, unknown>>(request, {
        maxBytes: REQUEST_LIMITS.verifyImageJson,
        label: "이미지 OAuth 검증"
      });
    } catch (error) {
      return requestErrorResponse(error, {
        fallbackMessage: "요청 JSON을 읽지 못했습니다."
      });
    }

    const prompt =
      typeof body.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim()
        : "A clean product-style test image: a white ceramic mug on a neutral desk, premium ecommerce lighting, no text.";
    const referenceImage =
      typeof body.referenceImageBase64 === "string" && typeof body.referenceImageMimeType === "string"
        ? [validateImagePayload(body.referenceImageBase64, body.referenceImageMimeType, "검증용 참조 이미지")]
        : [];

    return withOperationGuard(request, {
      operation: "oauth.verify-image",
      category: "generation",
      maxConcurrent: 1,
      rateLimitMax: 5
    }, async () => {
      const result = await getImageProvider().generate({
        prompt,
        referenceImages: referenceImage,
        aspectRatio: "1:1"
      });

      return jsonNoStore({
        ok: true,
        imageBase64: result.imageBase64,
        mimeType: result.mimeType,
        providerProof: result.providerProof
      });
    });
  } catch (error) {
    return jsonNoStore(
      {
        ok: false,
        error: error instanceof Error ? error.message : "이미지 OAuth 검증 실패",
        detail: error instanceof Error && "detail" in error ? String(error.detail ?? "") : undefined,
        code: error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN"
      },
      { status: mapErrorStatus(error) }
    );
  }
}

function mapErrorStatus(error: unknown) {
  const code = error instanceof Error && "code" in error ? String(error.code) : "";
  if (code === "INVALID_IMAGE_PAYLOAD" || code === "INVALID_REQUEST") return 400;
  if (code === "CODEX_AUTH_MISSING" || code === "CODEX_AUTH_STALE") return 401;
  if (code === "CODEX_MODEL_ACCESS_DENIED" || code === "CODEX_MODEL_NOT_FOUND") return 403;
  if (code === "CODEX_USAGE_LIMIT") return 429;
  if (code === "CODEX_RESPONSE_INVALID") return 502;
  return 500;
}

function validateImagePayload(base64Value: string, mimeTypeValue: string, label: string) {
  const mimeType = normalizeMimeType(mimeTypeValue);
  if (!SUPPORTED_VERIFY_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new VerifyImageValidationError(`${label}의 이미지 형식이 지원되지 않습니다. JPG, PNG, WebP만 사용할 수 있습니다.`);
  }

  const base64 = sanitizeBase64Payload(base64Value).replace(/\s+/g, "");
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new VerifyImageValidationError(`${label}의 이미지 데이터가 올바른 base64 형식이 아닙니다.`);
  }

  const byteLength = estimateBase64Bytes(base64);
  if (byteLength <= 0) {
    throw new VerifyImageValidationError(`${label}의 이미지 데이터가 비어 있습니다.`);
  }
  if (byteLength > MAX_VERIFY_IMAGE_BYTES) {
    throw new VerifyImageValidationError(
      `${label}가 너무 큽니다. 검증용 이미지는 최대 ${Math.round(MAX_VERIFY_IMAGE_BYTES / 1024 / 1024)}MB까지 사용할 수 있습니다.`
    );
  }

  return { mimeType, base64 };
}

function sanitizeBase64Payload(value: string) {
  return value.includes(",") ? value.split(",").pop() || "" : value;
}

function estimateBase64Bytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function normalizeMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized;
}
