export const REQUEST_LIMITS = {
  knowledgeJson: 1 * 1024 * 1024,
  draftJson: 90 * 1024 * 1024,
  pdpWorkflowJson: 80 * 1024 * 1024,
  redesignEditJson: 24 * 1024 * 1024,
  verifyImageJson: 20 * 1024 * 1024,
  redesignMultipart: 110 * 1024 * 1024
} as const;

type ApiRequestErrorCode = "INVALID_REQUEST" | "REQUEST_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiRequestErrorCode,
    message: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function readJsonBody<T>(
  request: Request,
  options: {
    maxBytes: number;
    label?: string;
  }
): Promise<T> {
  const label = options.label ?? "JSON";
  assertRequestContentLength(request, { maxBytes: options.maxBytes, label });

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new ApiRequestError(415, "UNSUPPORTED_MEDIA_TYPE", `${label} 요청은 application/json 형식이어야 합니다.`);
  }

  const text = await readRequestTextWithLimit(request, options.maxBytes, label);
  if (!text.trim()) {
    throw new ApiRequestError(400, "INVALID_REQUEST", `${label} 요청 본문이 비어 있습니다.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ApiRequestError(
      400,
      "INVALID_REQUEST",
      `${label} 요청 JSON을 읽지 못했습니다.`,
      error instanceof Error ? error.message : undefined
    );
  }
}

export function assertRequestContentLength(
  request: Request,
  options: {
    maxBytes: number;
    label?: string;
  }
) {
  const rawContentLength = request.headers.get("content-length");
  if (!rawContentLength) return;

  const contentLength = Number(rawContentLength);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new ApiRequestError(400, "INVALID_REQUEST", "요청 Content-Length가 올바르지 않습니다.");
  }

  if (contentLength > options.maxBytes) {
    throwRequestTooLarge(options.maxBytes, options.label ?? "요청");
  }
}

export function requestErrorResponse(
  error: unknown,
  options: {
    fallbackMessage?: string;
    fallbackCode?: string;
  } = {}
) {
  if (error instanceof ApiRequestError) {
    return Response.json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        error: error.message,
        detail: error.detail
      },
      { status: error.status, headers: noStoreHeaders() }
    );
  }

  const message = options.fallbackMessage ?? "요청을 읽지 못했습니다.";
  return Response.json(
    {
      ok: false,
      code: options.fallbackCode ?? "INVALID_REQUEST",
      message,
      error: message
    },
    { status: 400, headers: noStoreHeaders() }
  );
}

export function jsonNoStore(body: unknown, init?: ResponseInit) {
  const headers = noStoreHeaders(init?.headers);
  return Response.json(body, {
    ...init,
    headers
  });
}

export function noStoreHeaders(input?: HeadersInit) {
  const headers = new Headers(input);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

async function readRequestTextWithLimit(request: Request, maxBytes: number, label: string) {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      throwRequestTooLarge(maxBytes, label);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

function throwRequestTooLarge(maxBytes: number, label: string): never {
  throw new ApiRequestError(
    413,
    "REQUEST_TOO_LARGE",
    `${label} 요청이 너무 큽니다. 최대 ${formatBytes(maxBytes)}까지 처리할 수 있습니다.`
  );
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
