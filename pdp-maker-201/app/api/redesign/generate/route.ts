import type { AspectRatio } from "../../../../lib/shared";
import { generateRedesignProject } from "../../../../lib/redesign-service";
import { REQUEST_LIMITS, assertRequestContentLength, jsonNoStore, requestErrorResponse } from "../../../../lib/server/api-guards";
import { withOperationGuard } from "../../../../lib/server/operation-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    let form: FormData;
    try {
      assertRequestContentLength(request, {
        maxBytes: REQUEST_LIMITS.redesignMultipart,
        label: "리디자인 업로드"
      });
      form = await request.formData();
    } catch (error) {
      return requestErrorResponse(error, {
        fallbackMessage: "요청 form-data를 읽지 못했습니다."
      });
    }

    const files = form.getAll("files").filter((file): file is File => file instanceof File);
    const requestText = String(form.get("request") || "");
    const rolloutRequest = String(form.get("rolloutRequest") || "");
    const channel = String(form.get("channel") || "스마트스토어");
    const aspectRatio = normalizeAspectRatio(String(form.get("ratio") || "9:16"));
    const count = clamp(Number(form.get("count") || 1), 1, 8);
    const startSection = clamp(Number(form.get("startSection") || 1), 1, 8);

    return withOperationGuard(request, {
      operation: "redesign.generate",
      category: "generation"
    }, async () => {
      const generated = await generateRedesignProject({
        files,
        requestText,
        rolloutRequest,
        channel,
        aspectRatio,
        count,
        startSection
      });

      return jsonNoStore({ ok: true, ...generated });
    });
  } catch (error) {
    return jsonNoStore(
      {
        ok: false,
        error: error instanceof Error ? error.message : "리디자인 생성 중 오류가 발생했습니다.",
        detail: error instanceof Error && "detail" in error ? String(error.detail ?? "") : undefined,
        code: error instanceof Error && "code" in error ? String(error.code) : "REDESIGN_GENERATE_FAILED"
      },
      { status: mapErrorStatus(error) }
    );
  }
}

function normalizeAspectRatio(value: string): AspectRatio {
  return value === "1:1" || value === "3:4" || value === "4:3" || value === "16:9" ? value : "9:16";
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function mapErrorStatus(error: unknown) {
  const code = error instanceof Error && "code" in error ? String(error.code) : "";
  if (code === "INVALID_IMAGE_PAYLOAD" || code === "INVALID_REQUEST") return 400;
  if (code === "CODEX_AUTH_MISSING" || code === "CODEX_AUTH_STALE") return 401;
  if (code === "CODEX_MODEL_ACCESS_DENIED" || code === "CODEX_MODEL_NOT_FOUND") return 403;
  if (code === "CODEX_USAGE_LIMIT") return 429;
  if (code === "CODEX_RESPONSE_INVALID" || code === "REDESIGN_GENERATE_FAILED") return 502;
  return 500;
}
