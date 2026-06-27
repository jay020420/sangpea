const SUPPORTED_IMAGE_PROVIDERS = new Set(["openai-codex-oauth", "openai", "codex", "flux", "comfyui", "qwen", "sdxl"]);

export type RuntimeEnvIssue = {
  severity: "error" | "warning";
  key: string;
  message: string;
};

export function getRuntimeEnvStatus() {
  const issues: RuntimeEnvIssue[] = [];
  const imageProvider = readStringEnv("IMAGE_PROVIDER", "openai-codex-oauth");
  const textModel = readStringEnv("CODEX_TEXT_MODEL", "gpt-5.4-mini");
  const imageModel = readStringEnv("CODEX_IMAGE_MODEL", "openai/gpt-image-2");

  if (!textModel.trim()) {
    issues.push({
      severity: "error",
      key: "CODEX_TEXT_MODEL",
      message: "텍스트 분석 모델명이 비어 있습니다."
    });
  }

  if (!imageModel.trim()) {
    issues.push({
      severity: "error",
      key: "CODEX_IMAGE_MODEL",
      message: "이미지 생성 모델명이 비어 있습니다."
    });
  }

  if (!SUPPORTED_IMAGE_PROVIDERS.has(imageProvider.trim().toLowerCase())) {
    issues.push({
      severity: "error",
      key: "IMAGE_PROVIDER",
      message: `지원하지 않는 이미지 provider입니다: ${imageProvider}`
    });
  }

  checkPositiveInteger(issues, "INTERNAL_MAX_CONCURRENT_GENERATION");
  checkPositiveInteger(issues, "INTERNAL_MAX_CONCURRENT_ANALYSIS");
  checkPositiveInteger(issues, "INTERNAL_MAX_CONCURRENT_STANDARD");
  checkPositiveInteger(issues, "INTERNAL_RATE_LIMIT_MAX");
  checkPositiveInteger(issues, "INTERNAL_RATE_LIMIT_WINDOW_MS");
  checkPositiveInteger(issues, "CODEX_TEXT_RESPONSE_TIMEOUT_MS");
  checkPositiveInteger(issues, "CODEX_IMAGE_RESPONSE_TIMEOUT_MS");

  if (!process.env.CODEX_AUTH_FILE && !process.env.CODEX_HOME && !process.env.CHATGPT_LOCAL_HOME) {
    issues.push({
      severity: "warning",
      key: "CODEX_AUTH_FILE",
      message: "명시적인 Codex auth 경로가 없습니다. 기본 홈 디렉터리 auth.json 후보를 사용합니다."
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    values: {
      imageProvider,
      textModel,
      imageModel,
      maxConcurrentGeneration: readStringEnv("INTERNAL_MAX_CONCURRENT_GENERATION", "2"),
      maxConcurrentAnalysis: readStringEnv("INTERNAL_MAX_CONCURRENT_ANALYSIS", "3"),
      rateLimitMax: readStringEnv("INTERNAL_RATE_LIMIT_MAX", "30"),
      rateLimitWindowMs: readStringEnv("INTERNAL_RATE_LIMIT_WINDOW_MS", "60000")
    },
    issues
  };
}

function checkPositiveInteger(issues: RuntimeEnvIssue[], key: string) {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || Math.round(value) !== value) {
    issues.push({
      severity: "error",
      key,
      message: `${key}는 양의 정수여야 합니다. 현재 값: ${raw}`
    });
  }
}

function readStringEnv(key: string, fallback: string) {
  return process.env[key] ?? fallback;
}
