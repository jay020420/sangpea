import { PdpController } from "../../../../lib/pdp-server/pdp.controller";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pdpController = new PdpController();

export async function GET() {
  const response = await pdpController.validateApiKey();

  return Response.json(response, {
    status: response.ok ? 200 : mapErrorCodeToStatus(response.code)
  });
}

function mapErrorCodeToStatus(code?: string) {
  switch (code) {
    case "CODEX_AUTH_MISSING":
    case "CODEX_AUTH_STALE":
      return 401;
    case "CODEX_MODEL_ACCESS_DENIED":
    case "CODEX_MODEL_NOT_FOUND":
      return 403;
    case "CODEX_RESPONSE_INVALID":
      return 502;
    default:
      return 500;
  }
}
