import {
  deleteKnowledgeDocument,
  getKnowledgeStats,
  indexKnowledgeDocument,
  listKnowledgeDocuments,
  retrieveKnowledge
} from "../../../lib/local-rag";
import { REQUEST_LIMITS, jsonNoStore, readJsonBody, requestErrorResponse } from "../../../lib/server/api-guards";
import { withOperationGuard } from "../../../lib/server/operation-guards";
import type { KnowledgeSourceKind } from "../../../lib/local-rag";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  if (query) {
    const limit = Number(url.searchParams.get("limit") || 8);
    return Response.json({
      query,
      results: await retrieveKnowledge(query, Number.isFinite(limit) ? Math.max(1, Math.min(limit, 20)) : 8)
    });
  }

  return Response.json({
    ...(await getKnowledgeStats()),
    items: await listKnowledgeDocuments()
  });
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody<Record<string, unknown>>(request, {
        maxBytes: REQUEST_LIMITS.knowledgeJson,
        label: "Knowledge 등록"
      });
    } catch (error) {
      return requestErrorResponse(error, {
        fallbackMessage: "요청 JSON을 읽지 못했습니다."
      });
    }
    const name = String(body.name || "knowledge-file");
    const text = String(body.text || "");
    const sourceKind = String(body.sourceKind || "general") as KnowledgeSourceKind;
    const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
    return withOperationGuard(request, {
      operation: "knowledge.index",
      category: "knowledge"
    }, async () => {
      const result = await indexKnowledgeDocument({ name, text, sourceKind, tags });
      return jsonNoStore(result);
    });
  } catch (error) {
    return jsonNoStore(
      { error: error instanceof Error ? error.message : "지식파일 등록 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody<Record<string, unknown>>(request, {
        maxBytes: REQUEST_LIMITS.knowledgeJson,
        label: "Knowledge 삭제"
      });
    } catch (error) {
      return requestErrorResponse(error, {
        fallbackMessage: "요청 JSON을 읽지 못했습니다."
      });
    }
    const documentId = String(body.documentId || "");
    return withOperationGuard(request, {
      operation: "knowledge.delete",
      category: "knowledge"
    }, async () => jsonNoStore(await deleteKnowledgeDocument(documentId)));
  } catch (error) {
    return jsonNoStore(
      { error: error instanceof Error ? error.message : "지식파일 삭제 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
