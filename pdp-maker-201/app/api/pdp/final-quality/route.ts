import type { PdpFinalQualityRequest } from "@runacademy/shared";
import { PdpController } from "../../../../lib/pdp-server/pdp.controller";
import { REQUEST_LIMITS, jsonNoStore, readJsonBody, requestErrorResponse } from "../../../../lib/server/api-guards";
import { withOperationGuard } from "../../../../lib/server/operation-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const pdpController = new PdpController();

export async function POST(request: Request) {
  let body: PdpFinalQualityRequest;
  try {
    body = await readJsonBody<PdpFinalQualityRequest>(request, {
      maxBytes: REQUEST_LIMITS.redesignEditJson,
      label: "최종 품질 검수"
    });
  } catch (error) {
    return requestErrorResponse(error, {
      fallbackMessage: "요청 JSON을 읽지 못했습니다."
    });
  }

  return withOperationGuard(request, {
    operation: "pdp.final-quality",
    category: "quality"
  }, async () => {
    const response = await pdpController.evaluateFinalQuality(body);
    return jsonNoStore(response, {
      status: response.ok ? 200 : mapErrorCodeToStatus(response.code)
    });
  });
}

function mapErrorCodeToStatus(code?: string) {
  switch (code) {
    case "INVALID_IMAGE_PAYLOAD":
    case "INVALID_REQUEST":
      return 400;
    case "CODEX_AUTH_MISSING":
    case "CODEX_AUTH_STALE":
      return 401;
    case "CODEX_MODEL_ACCESS_DENIED":
    case "CODEX_MODEL_NOT_FOUND":
      return 403;
    case "CODEX_USAGE_LIMIT":
      return 429;
    case "CODEX_RESPONSE_INVALID":
    case "PDP_IMAGE_GENERATION_FAILED":
      return 502;
    default:
      return 500;
  }
}
