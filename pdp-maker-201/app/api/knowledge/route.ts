import {
  deleteKnowledgeDocument,
  getKnowledgeStats,
  indexKnowledgeDocument,
  listKnowledgeDocuments,
  retrieveKnowledge
} from "../../../lib/local-rag";

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
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "요청 JSON을 읽지 못했습니다.", code: "INVALID_REQUEST" }, { status: 400 });
    }
    const name = String(body.name || "knowledge-file");
    const text = String(body.text || "");
    const result = await indexKnowledgeDocument({ name, text });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "지식파일 등록 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "요청 JSON을 읽지 못했습니다.", code: "INVALID_REQUEST" }, { status: 400 });
    }
    const documentId = String(body.documentId || "");
    return Response.json(await deleteKnowledgeDocument(documentId));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "지식파일 삭제 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
