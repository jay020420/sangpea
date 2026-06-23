import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderProof } from "./shared";

const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_ISSUER = "https://auth.openai.com";
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const DEFAULT_CODEX_VERSION = "0.111.0";
const REFRESH_EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const REFRESH_INTERVAL_MS = 55 * 60 * 1000;

export const CODEX_TEXT_MODEL = process.env.CODEX_TEXT_MODEL || "gpt-5.4-mini";
export const CODEX_IMAGE_MODEL = process.env.CODEX_IMAGE_MODEL || "openai/gpt-image-2";
const DEFAULT_TEXT_RESPONSE_TIMEOUT_MS = readPositiveNumber(process.env.CODEX_TEXT_RESPONSE_TIMEOUT_MS, 150_000);
const DEFAULT_IMAGE_RESPONSE_TIMEOUT_MS = readPositiveNumber(process.env.CODEX_IMAGE_RESPONSE_TIMEOUT_MS, 270_000);

export type CodexAuthStatus =
  | {
      ok: true;
      authPath: string;
      accountId: string;
      lastRefresh?: string;
    }
  | {
      ok: false;
      needsLogin: true;
      authCandidates: string[];
      message: string;
    };

type StoredTokens = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  account_id?: string;
};

type AuthFile = {
  tokens?: StoredTokens;
  last_refresh?: string;
};

type EffectiveAuth = {
  accessToken: string;
  accountId: string;
  sourcePath: string;
  idToken?: string;
  refreshToken?: string;
  lastRefresh?: string;
};

type ReferenceImage = {
  base64: string;
  mimeType: string;
};

export type CodexImageResult = {
  imageBase64: string;
  mimeType: string;
  response: unknown;
  providerProof: ProviderProof;
};

export function resolveAuthFileCandidates(authFilePath?: string) {
  if (authFilePath?.trim()) return [authFilePath.trim()];

  const chatgptLocalHome = process.env.CHATGPT_LOCAL_HOME;
  const codexHome = process.env.CODEX_HOME;
  return uniqueStrings(
    [
      chatgptLocalHome ? path.join(chatgptLocalHome, "auth.json") : undefined,
      codexHome ? path.join(codexHome, "auth.json") : undefined,
      path.join(os.homedir(), ".chatgpt-local", "auth.json"),
      path.join(os.homedir(), ".codex", "auth.json")
    ].filter((candidate): candidate is string => Boolean(candidate))
  );
}

export async function getCodexAuthStatus(): Promise<CodexAuthStatus> {
  try {
    const auth = await loadCodexAuth({ ensureFresh: false });
    return {
      ok: true,
      authPath: auth.sourcePath,
      accountId: auth.accountId,
      lastRefresh: auth.lastRefresh
    };
  } catch {
    return {
      ok: false,
      needsLogin: true,
      authCandidates: resolveAuthFileCandidates(),
      message: "Codex OAuth auth.json을 찾지 못했습니다. 먼저 `npx @openai/codex login`을 실행해 주세요."
    };
  }
}

export async function listCodexModels() {
  const auth = await loadCodexAuth({ ensureFresh: true });
  const response = await fetch(
    `${DEFAULT_CODEX_BASE_URL}/models?client_version=${encodeURIComponent(process.env.CODEX_CLIENT_VERSION || DEFAULT_CODEX_VERSION)}`,
    {
      method: "GET",
      headers: codexHeaders(auth, { acceptJson: true }),
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw await toCodexError(response, "Codex 모델 목록을 불러오지 못했습니다.");
  }

  const data = await response.json();
  if (!isRecord(data) || !Array.isArray(data.models)) return [];
  return uniqueStrings(
    data.models
      .map((model) => (isRecord(model) && typeof model.slug === "string" ? model.slug : ""))
      .filter(Boolean)
  );
}

export async function createCodexResponse(body: Record<string, unknown>, options?: { timeoutMs?: number }) {
  const auth = await loadCodexAuth({ ensureFresh: true });
  const controller = new AbortController();
  const timeoutMs = readPositiveNumber(options?.timeoutMs, DEFAULT_TEXT_RESPONSE_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${DEFAULT_CODEX_BASE_URL}/responses`, {
      method: "POST",
      headers: codexHeaders(auth, { jsonBody: true, acceptEventStream: true }),
      body: JSON.stringify(normalizeResponsesBody(body)),
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw await toCodexError(response, "Codex Responses 요청이 실패했습니다.");
    }

    return await readCodexResponse(response);
  } catch (error) {
    if (isAbortError(error)) {
      throw new CodexProviderError("CODEX_RESPONSE_INVALID", `Codex Responses 요청 시간이 초과되었습니다. ${Math.round(timeoutMs / 1000)}초 안에 응답을 완료하지 못했습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateImageWithCodex(input: {
  prompt: string;
  referenceImages?: ReferenceImage[];
  aspectRatio?: string;
  size?: string;
}) {
  const size = input.size || imageSizeForAspectRatio(input.aspectRatio);
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: input.prompt }];
  for (const image of input.referenceImages ?? []) {
    content.push({
      type: "input_image",
      image_url: `data:${image.mimeType};base64,${sanitizeBase64(image.base64)}`
    });
  }

  const response = await createCodexResponse({
    model: CODEX_TEXT_MODEL,
    input: [{ role: "user", content }],
    tools: [
      {
        type: "image_generation",
        model: CODEX_IMAGE_MODEL.replace(/^openai\//, ""),
        size,
        output_format: "png",
        quality: "auto"
      }
    ],
    tool_choice: { type: "image_generation" },
    instructions: "You are an image generation assistant.",
    stream: true,
    store: false
  }, { timeoutMs: DEFAULT_IMAGE_RESPONSE_TIMEOUT_MS });

  const imageBase64 = findFirstBase64Image(response);
  if (!imageBase64) {
    throw new CodexProviderError(
      "CODEX_RESPONSE_INVALID",
      "Codex OAuth 이미지 응답에서 이미지 데이터를 찾지 못했습니다.",
      JSON.stringify(response).slice(0, 4000)
    );
  }

  return {
    imageBase64,
    mimeType: "image/png",
    response,
    providerProof: {
      provider: "openai-codex-oauth",
      resolvedProvider: "openai-codex-oauth",
      model: CODEX_IMAGE_MODEL,
      authRoute: "chatgpt.com/backend-api/codex/responses:image_generation",
      fallbackUsed: false
    }
  } satisfies CodexImageResult;
}

export async function generateTextWithCodex(input: {
  prompt: string;
  images?: ReferenceImage[];
  model?: string;
  timeoutMs?: number;
}) {
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: input.prompt }];
  for (const image of input.images ?? []) {
    content.push({
      type: "input_image",
      image_url: `data:${image.mimeType};base64,${sanitizeBase64(image.base64)}`
    });
  }

  const response = await createCodexResponse({
    model: input.model || CODEX_TEXT_MODEL,
    input: [{ role: "user", content }],
    stream: true,
    store: false
  }, { timeoutMs: input.timeoutMs ?? DEFAULT_TEXT_RESPONSE_TIMEOUT_MS });
  return {
    text: extractOutputText(response),
    response,
    providerProof: {
      provider: "openai-codex-oauth",
      resolvedProvider: "openai-codex-oauth",
      model: input.model || CODEX_TEXT_MODEL,
      authRoute: "chatgpt.com/backend-api/codex/responses:text",
      fallbackUsed: false
    } satisfies ProviderProof
  };
}

export function extractJsonObject<T>(text: string): T {
  const candidates = collectJsonCandidates(text);
  let lastError: unknown;

  for (const candidate of candidates) {
    for (const jsonText of uniqueStrings([candidate, stripTrailingJsonCommas(candidate)])) {
      try {
        return JSON.parse(jsonText) as T;
      } catch (error) {
        lastError = error;
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : "unknown JSON parse error";
  throw new SyntaxError(`Codex response did not contain parseable JSON: ${message}`);
}

function collectJsonCandidates(text: string) {
  const normalized = text.trim().replace(/^\uFEFF/, "");
  const fenced = Array.from(normalized.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const candidates = [...fenced, ...collectBalancedJsonObjects(normalized)];
  return candidates.length ? uniqueStrings(candidates) : [normalized];
}

function collectBalancedJsonObjects(text: string) {
  const candidates: string[] = [];

  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, index + 1).trim());
          break;
        }
      }
    }
  }

  return candidates;
}

function stripTrailingJsonCommas(value: string) {
  return value.replace(/,\s*([}\]])/g, "$1");
}

export class CodexProviderError extends Error {
  constructor(
    readonly code:
      | "CODEX_AUTH_MISSING"
      | "CODEX_AUTH_STALE"
      | "CODEX_MODEL_ACCESS_DENIED"
      | "CODEX_MODEL_NOT_FOUND"
      | "CODEX_RESPONSE_INVALID",
    message: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = "CodexProviderError";
  }
}

async function loadCodexAuth(options: { ensureFresh: boolean }): Promise<EffectiveAuth> {
  const candidates = resolveAuthFileCandidates(process.env.CODEX_AUTH_FILE);
  const read = await readAuthFile(candidates);
  if (!read.data || !read.path) {
    throw new CodexProviderError(
      "CODEX_AUTH_MISSING",
      "Codex OAuth auth.json을 찾지 못했습니다. `npx @openai/codex login`을 먼저 실행해 주세요.",
      candidates.join(", ")
    );
  }

  let accessToken = read.data.tokens?.access_token;
  let idToken = read.data.tokens?.id_token;
  let refreshToken = read.data.tokens?.refresh_token;
  let accountId = read.data.tokens?.account_id || deriveAccountId(idToken);
  let lastRefresh = read.data.last_refresh;

  if (options.ensureFresh && refreshToken && shouldRefreshAccessToken(accessToken, lastRefresh)) {
    const refreshed = await refreshTokens(refreshToken);
    accessToken = refreshed.accessToken;
    idToken = refreshed.idToken || idToken;
    refreshToken = refreshed.refreshToken || refreshToken;
    accountId = refreshed.accountId || accountId;
    lastRefresh = new Date().toISOString();

    await fs.writeFile(
      read.path,
      JSON.stringify(
        {
          ...read.data,
          tokens: {
            ...read.data.tokens,
            access_token: accessToken,
            id_token: idToken,
            refresh_token: refreshToken,
            account_id: accountId
          },
          last_refresh: lastRefresh
        },
        null,
        2
      ),
      { encoding: "utf-8", mode: 0o600 }
    );
  }

  if (!accessToken) {
    throw new CodexProviderError(
      "CODEX_AUTH_MISSING",
      "Codex access token이 없습니다. `npx @openai/codex login`을 다시 실행해 주세요.",
      read.path
    );
  }

  if (!accountId) {
    throw new CodexProviderError(
      "CODEX_AUTH_MISSING",
      "Codex account id를 찾지 못했습니다. `npx @openai/codex login`을 다시 실행해 주세요.",
      read.path
    );
  }

  return {
    accessToken,
    accountId,
    idToken,
    refreshToken,
    sourcePath: read.path,
    lastRefresh
  };
}

async function readAuthFile(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      const text = await fs.readFile(candidate, "utf-8");
      const parsed = JSON.parse(text);
      if (isRecord(parsed)) return { path: candidate, data: normalizeAuthFile(parsed) };
    } catch {}
  }
  return { path: undefined, data: undefined };
}

function normalizeAuthFile(value: Record<string, unknown>): AuthFile {
  const tokens = isRecord(value.tokens) ? value.tokens : {};
  return {
    tokens: {
      id_token: typeof tokens.id_token === "string" ? tokens.id_token : undefined,
      access_token: typeof tokens.access_token === "string" ? tokens.access_token : undefined,
      refresh_token: typeof tokens.refresh_token === "string" ? tokens.refresh_token : undefined,
      account_id: typeof tokens.account_id === "string" ? tokens.account_id : undefined
    },
    last_refresh: typeof value.last_refresh === "string" ? value.last_refresh : undefined
  };
}

async function refreshTokens(refreshToken: string) {
  const response = await fetch(`${DEFAULT_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.CHATGPT_LOCAL_CLIENT_ID || DEFAULT_CLIENT_ID,
      scope: "openid profile email offline_access"
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new CodexProviderError(
      "CODEX_AUTH_STALE",
      "Codex OAuth token refresh가 실패했습니다. `npx @openai/codex login`을 다시 실행해 주세요.",
      await response.text()
    );
  }

  const payload = await response.json();
  if (!isRecord(payload) || typeof payload.access_token !== "string") {
    throw new CodexProviderError("CODEX_AUTH_STALE", "Codex OAuth token refresh 응답이 올바르지 않습니다.");
  }

  const idToken = typeof payload.id_token === "string" ? payload.id_token : undefined;
  return {
    accessToken: payload.access_token,
    idToken,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : refreshToken,
    accountId: deriveAccountId(idToken)
  };
}

function codexHeaders(auth: EffectiveAuth, options?: { jsonBody?: boolean; acceptJson?: boolean; acceptEventStream?: boolean }) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    "chatgpt-account-id": auth.accountId,
    "OpenAI-Beta": "responses=experimental"
  };
  if (options?.jsonBody) headers["Content-Type"] = "application/json";
  if (options?.acceptJson) headers.Accept = "application/json";
  if (options?.acceptEventStream) headers.Accept = "text/event-stream";
  return headers;
}

function normalizeResponsesBody(body: Record<string, unknown>) {
  const instructions =
    typeof body.instructions === "string" && body.instructions.trim()
      ? body.instructions.trim()
      : "You are a precise product-page analysis and generation assistant. Follow the user's requested output format exactly.";
  const next: Record<string, unknown> = {
    ...body,
    instructions,
    store: body.store ?? false,
    stream: body.stream ?? true
  };
  delete next.max_output_tokens;
  return next;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

function readPositiveNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function readCodexResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const isSse = contentType.includes("text/event-stream") || /^\s*event:/m.test(text) || /^\s*data:/m.test(text);
  if (!isSse) {
    try {
      return JSON.parse(text);
    } catch {
      return { output_text: text };
    }
  }

  return parseCodexSse(text);
}

function parseCodexSse(text: string) {
  let completed: unknown;
  let lastResponse: unknown;
  const events: unknown[] = [];
  const outputTextParts: string[] = [];

  for (const block of text.split(/\r?\n\r?\n/)) {
    const payload = block
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith("data:"))
      .map((line) => line.slice(line.indexOf("data:") + 5).trim())
      .join("\n")
      .trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload);
      events.push(parsed);
      if (isRecord(parsed)) {
        if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
          outputTextParts.push(parsed.delta);
        }
        if (parsed.type === "response.output_text.done" && typeof parsed.text === "string") {
          outputTextParts.length = 0;
          outputTextParts.push(parsed.text);
        }
        if (isRecord(parsed.response)) lastResponse = parsed.response;
        if (parsed.type === "response.completed" && isRecord(parsed.response)) completed = parsed.response;
      }
    } catch {}
  }

  const output_text = outputTextParts.join("").trim();
  if (completed) return isRecord(completed) ? { ...completed, output_text, events } : { completed, output_text, events };
  if (lastResponse) return { ...((isRecord(lastResponse) && lastResponse) || {}), output_text, events };
  if (events.length) return { output_text, events };

  if (!completed) {
    throw new CodexProviderError("CODEX_RESPONSE_INVALID", "Codex SSE 응답에서 완료된 response를 찾지 못했습니다.", text.slice(0, 4000));
  }

  return completed;
}

async function toCodexError(response: Response, fallback: string) {
  const text = await response.text();
  if (response.status === 401) {
    return new CodexProviderError("CODEX_AUTH_STALE", "Codex OAuth 인증이 만료되었습니다. `npx @openai/codex login`을 다시 실행해 주세요.", text);
  }
  if (response.status === 403) {
    return new CodexProviderError("CODEX_MODEL_ACCESS_DENIED", "현재 Codex OAuth 프로필이나 워크스페이스에서 이 모델/도구를 사용할 수 없습니다.", text);
  }
  if (response.status === 404) {
    return new CodexProviderError("CODEX_MODEL_NOT_FOUND", "요청한 Codex 모델 또는 도구를 찾지 못했습니다.", text);
  }
  return new CodexProviderError("CODEX_RESPONSE_INVALID", fallback, text);
}

function findFirstBase64Image(value: unknown): string | null {
  if (typeof value === "string") {
    return looksLikeBase64Image(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstBase64Image(item);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.type === "image_generation_call" && typeof value.result === "string") return value.result;
  for (const key of ["result", "b64_json", "image_base64", "image", "image_data", "partial_image", "partial_image_b64", "data"]) {
    const found = findFirstBase64Image(value[key]);
    if (found) return found;
  }
  for (const child of Object.values(value)) {
    const found = findFirstBase64Image(child);
    if (found) return found;
  }
  return null;
}

function extractOutputText(value: unknown): string {
  const direct = isRecord(value) && typeof value.output_text === "string" ? value.output_text : "";
  if (direct) return direct;

  const parts: string[] = [];
  collectTextParts(value, parts);
  return parts.join("\n").trim();
}

function collectTextParts(value: unknown, output: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTextParts(item, output));
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === "response.output_text.delta" && typeof value.delta === "string") {
    output.push(value.delta);
  }
  if (value.type === "response.output_text.done" && typeof value.text === "string") {
    output.push(value.text);
  }
  if ((value.type === "output_text" || value.type === "text") && typeof value.text === "string") {
    output.push(value.text);
  }
  if (isRecord(value.part)) collectTextParts(value.part, output);
  if (isRecord(value.item)) collectTextParts(value.item, output);
  if (Array.isArray(value.events)) collectTextParts(value.events, output);
  if (Array.isArray(value.content)) collectTextParts(value.content, output);
  if (Array.isArray(value.output)) collectTextParts(value.output, output);
}

function shouldRefreshAccessToken(accessToken: string | undefined, lastRefresh: string | undefined) {
  if (!accessToken) return true;
  const claims = parseJwtClaims(accessToken);
  if (typeof claims?.exp === "number" && claims.exp * 1000 <= Date.now() + REFRESH_EXPIRY_MARGIN_MS) return true;
  const lastRefreshDate = lastRefresh ? new Date(lastRefresh) : null;
  return Boolean(lastRefreshDate && lastRefreshDate.getTime() <= Date.now() - REFRESH_INTERVAL_MS);
}

function parseJwtClaims(token: string | undefined): Record<string, unknown> | undefined {
  if (!token || !token.includes(".")) return undefined;
  const [, payload] = token.split(".");
  if (!payload) return undefined;
  try {
    const padded = payload + "=".repeat((4 - (payload.length % 4 || 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64url").toString("utf-8"));
  } catch {
    return undefined;
  }
}

function deriveAccountId(idToken: string | undefined) {
  const claims = parseJwtClaims(idToken);
  const authClaim = isRecord(claims?.["https://api.openai.com/auth"]) ? claims?.["https://api.openai.com/auth"] : undefined;
  const accountId = authClaim?.chatgpt_account_id;
  return typeof accountId === "string" ? accountId : undefined;
}

function imageSizeForAspectRatio(aspectRatio?: string) {
  switch (aspectRatio) {
    case "1:1":
      return "1024x1024";
    case "16:9":
    case "4:3":
      return "1536x1024";
    case "9:16":
    case "3:4":
    default:
      return "1024x1536";
  }
}

function looksLikeBase64Image(value: string) {
  return value.length > 1000 && /^[A-Za-z0-9+/=\s_-]+$/.test(value);
}

function sanitizeBase64(value: string) {
  return value.includes(",") ? value.split(",").pop() || "" : value;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
