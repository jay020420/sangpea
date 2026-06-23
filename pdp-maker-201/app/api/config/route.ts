import { CODEX_IMAGE_MODEL, CODEX_TEXT_MODEL, getCodexAuthStatus, listCodexModels } from "../../../lib/codex-oauth";
import { listImageProviders } from "../../../lib/image-providers";
import { getKnowledgeStats } from "../../../lib/local-rag";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await getCodexAuthStatus();
  const knowledge = await getKnowledgeStats();
  let models: string[] = [];
  let modelError = "";

  if (auth.ok) {
    try {
      models = await listCodexModels();
    } catch (error) {
      modelError = error instanceof Error ? error.message : "모델 목록 확인 실패";
    }
  }

  return Response.json({
    auth,
    models,
    modelError,
    textModel: CODEX_TEXT_MODEL,
    imageModel: CODEX_IMAGE_MODEL,
    imageProvider: process.env.IMAGE_PROVIDER || "openai-codex-oauth",
    imageProviders: listImageProviders(),
    knowledge
  });
}
