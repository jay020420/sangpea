import packageJson from "../../../package.json";
import { CODEX_IMAGE_MODEL, CODEX_TEXT_MODEL, getCodexAuthStatus } from "../../../lib/codex-oauth";
import { listImageProviders } from "../../../lib/image-providers";
import { getKnowledgeStats } from "../../../lib/local-rag";
import { jsonNoStore } from "../../../lib/server/api-guards";
import { getRuntimeEnvStatus } from "../../../lib/server/runtime-env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const [auth, knowledge] = await Promise.all([getCodexAuthStatus(), getKnowledgeStats()]);
  const imageProvider = process.env.IMAGE_PROVIDER || "openai-codex-oauth";
  const runtimeEnv = getRuntimeEnvStatus();
  const warnings = buildReadinessWarnings({
    authOk: auth.ok,
    imageProvider,
    runtimeEnvOk: runtimeEnv.ok
  });

  return jsonNoStore(
    {
      ok: auth.ok && warnings.every((warning) => warning.severity !== "critical"),
      service: packageJson.name,
      version: packageJson.version,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      runtime: {
        textModel: CODEX_TEXT_MODEL,
        imageModel: CODEX_IMAGE_MODEL,
        imageProvider
      },
      checks: {
        runtimeEnv,
        codexOAuth: auth.ok
          ? {
              ok: true,
              accountConfigured: Boolean(auth.accountId),
              lastRefresh: auth.lastRefresh ?? null
            }
          : {
              ok: false,
              needsLogin: true,
              message: auth.message
            },
        knowledge,
        imageProviders: listImageProviders()
      },
      warnings
    },
    { status: auth.ok && runtimeEnv.ok ? 200 : 503 }
  );
}

function buildReadinessWarnings(input: { authOk: boolean; imageProvider: string; runtimeEnvOk: boolean }) {
  const warnings: Array<{ severity: "warning" | "critical"; code: string; message: string }> = [];

  if (!input.authOk) {
    warnings.push({
      severity: "critical",
      code: "CODEX_AUTH_MISSING",
      message: "Codex OAuth 인증 파일이 없어 PDP 분석/이미지 생성 API가 동작하지 않습니다."
    });
  }

  if (!input.runtimeEnvOk) {
    warnings.push({
      severity: "critical",
      code: "RUNTIME_ENV_INVALID",
      message: "환경 변수 설정에 오류가 있어 일부 생성 기능이 실패할 수 있습니다."
    });
  }

  if (process.env.NODE_ENV === "production" && input.imageProvider === "openai-codex-oauth") {
    warnings.push({
      severity: "warning",
      code: "LOCAL_OAUTH_PROVIDER_IN_PRODUCTION",
      message: "현재 provider는 로컬 Codex OAuth에 의존합니다. 사내 단일 서버 운영에서는 사용할 수 있지만, 서버 계정 로그아웃 또는 토큰 만료 시 생성 기능이 중단됩니다."
    });
  }

  return warnings;
}
