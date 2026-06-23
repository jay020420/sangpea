import type { PdpFinalQualityRequest } from "@runacademy/shared";
import { PdpController } from "../../../../lib/pdp-server/pdp.controller";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const pdpController = new PdpController();

export async function POST(request: Request) {
  let body: PdpFinalQualityRequest;
  try {
    body = (await request.json()) as PdpFinalQualityRequest;
  } catch {
    return Response.json(
      {
        ok: false,
        code: "INVALID_REQUEST",
        message: "요청 JSON을 읽지 못했습니다."
      },
      { status: 400 }
    );
  }

  const response = await pdpController.evaluateFinalQuality(body);

  return Response.json(response, {
    status: response.ok ? 200 : mapErrorCodeToStatus(response.code)
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
    case "CODEX_RESPONSE_INVALID":
    case "PDP_IMAGE_GENERATION_FAILED":
      return 502;
    default:
      return 500;
  }
}
