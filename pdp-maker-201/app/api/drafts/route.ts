import { deleteServerDraft, getServerDraft, listServerDrafts, saveServerDraft } from "../../../lib/server/pdp-draft-store";
import { REQUEST_LIMITS, jsonNoStore, readJsonBody, requestErrorResponse } from "../../../lib/server/api-guards";
import { withOperationGuard } from "../../../lib/server/operation-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();

  if (id) {
    const draft = await getServerDraft(id);
    return jsonNoStore({
      ok: Boolean(draft),
      draft
    });
  }

  return jsonNoStore({
    ok: true,
    drafts: await listServerDrafts()
  });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody<Record<string, unknown>>(request, {
      maxBytes: REQUEST_LIMITS.draftJson,
      label: "초안 저장"
    });
  } catch (error) {
    return requestErrorResponse(error, {
      fallbackMessage: "초안 저장 요청 JSON을 읽지 못했습니다."
    });
  }

  return withOperationGuard(request, {
    operation: "drafts.save",
    category: "knowledge",
    maxConcurrent: 4,
    rateLimitMax: 120
  }, async () => jsonNoStore({ ok: true, draft: await saveServerDraft(body) }));
}

export async function DELETE(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody<Record<string, unknown>>(request, {
      maxBytes: REQUEST_LIMITS.knowledgeJson,
      label: "초안 삭제"
    });
  } catch (error) {
    return requestErrorResponse(error, {
      fallbackMessage: "초안 삭제 요청 JSON을 읽지 못했습니다."
    });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  return withOperationGuard(request, {
    operation: "drafts.delete",
    category: "knowledge",
    maxConcurrent: 4,
    rateLimitMax: 120
  }, async () => jsonNoStore(await deleteServerDraft(id)));
}
