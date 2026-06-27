import { CODEX_IMAGE_MODEL, CODEX_TEXT_MODEL } from "../codex-oauth";
import { jsonNoStore, noStoreHeaders } from "./api-guards";

type OperationCategory = "analysis" | "generation" | "quality" | "knowledge" | "health";
type OperationStatus = "ok" | "limited" | "error";

export type OperationGuardOptions = {
  operation: string;
  category: OperationCategory;
  maxConcurrent?: number;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
};

export type OperationAuditEvent = {
  requestId: string;
  operation: string;
  category: OperationCategory;
  status: OperationStatus;
  statusCode: number;
  startedAt: string;
  durationMs: number;
  clientKey: string;
  errorCode?: string;
  errorMessage?: string;
  provider: string;
  textModel: string;
  imageModel: string;
};

type RateWindow = {
  startedAt: number;
  count: number;
};

type OperationalState = {
  inFlight: Map<string, number>;
  windows: Map<string, RateWindow>;
  events: OperationAuditEvent[];
};

type GuardContext = {
  requestId: string;
};

const GLOBAL_OPERATION_STATE_KEY = "__pdpMakerOperationalState";
const MAX_AUDIT_EVENTS = 120;

export class OperationLimitError extends Error {
  constructor(
    readonly status: 429 | 503,
    readonly code: "RATE_LIMITED" | "CONCURRENCY_LIMITED",
    message: string,
    readonly retryAfterSeconds: number
  ) {
    super(message);
    this.name = "OperationLimitError";
  }
}

export async function withOperationGuard(
  request: Request,
  options: OperationGuardOptions,
  handler: (context: GuardContext) => Promise<Response>
) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const clientKey = readClientKey(request);
  const state = getOperationalState();
  const limits = resolveOperationLimits(options);
  let enteredOperation = false;

  try {
    enforceRateLimit(state, {
      clientKey,
      operation: options.operation,
      maxRequests: limits.rateLimitMax,
      windowMs: limits.rateLimitWindowMs
    });
    enterOperation(state, options.operation, limits.maxConcurrent);
    enteredOperation = true;

    const response = await handler({ requestId });
    response.headers.set("X-Request-Id", requestId);
    const responseErrorInfo = response.status >= 400 ? await readResponseErrorInfo(response) : {};
    recordAuditEvent(state, {
      requestId,
      operation: options.operation,
      category: options.category,
      status: response.status >= 400 ? "error" : "ok",
      statusCode: response.status,
      startedAt,
      durationMs: Date.now() - startedAt,
      clientKey,
      errorCode: responseErrorInfo.errorCode,
      errorMessage: responseErrorInfo.errorMessage
    });
    return response;
  } catch (error) {
    if (error instanceof OperationLimitError) {
      recordAuditEvent(state, {
        requestId,
        operation: options.operation,
        category: options.category,
        status: "limited",
        statusCode: error.status,
        startedAt,
        durationMs: Date.now() - startedAt,
        clientKey,
        errorCode: error.code,
        errorMessage: error.message
      });
      return operationLimitResponse(error, requestId);
    }

    recordAuditEvent(state, {
      requestId,
      operation: options.operation,
      category: options.category,
      status: "error",
      statusCode: 500,
      startedAt,
      durationMs: Date.now() - startedAt,
      clientKey,
      errorCode: "UNHANDLED_OPERATION_ERROR",
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    if (enteredOperation) {
      leaveOperation(state, options.operation);
    }
  }
}

export function getOperationalSnapshot() {
  const state = getOperationalState();
  const events = [...state.events].reverse();
  const since = Date.now() - 60 * 60 * 1000;
  const recentEvents = events.filter((event) => new Date(event.startedAt).getTime() >= since);
  const limitedCount = recentEvents.filter((event) => event.status === "limited").length;
  const errorCount = recentEvents.filter((event) => event.status === "error" || event.statusCode >= 500).length;
  const completedCount = recentEvents.filter((event) => event.status === "ok").length;

  return {
    inFlight: Object.fromEntries(state.inFlight),
    limits: getDefaultOperationLimits(),
    lastHour: {
      total: recentEvents.length,
      completed: completedCount,
      limited: limitedCount,
      errors: errorCount
    },
    recentEvents: events.slice(0, 30)
  };
}

function operationLimitResponse(error: OperationLimitError, requestId: string) {
  return jsonNoStore(
    {
      ok: false,
      code: error.code,
      message: error.message,
      error: error.message,
      requestId,
      retryAfterSeconds: error.retryAfterSeconds
    },
    {
      status: error.status,
      headers: noStoreHeaders({
        "Retry-After": String(error.retryAfterSeconds),
        "X-Request-Id": requestId
      })
    }
  );
}

function enforceRateLimit(
  state: OperationalState,
  input: {
    clientKey: string;
    operation: string;
    maxRequests: number;
    windowMs: number;
  }
) {
  const now = Date.now();
  const key = `${input.clientKey}:${input.operation}`;
  const current = state.windows.get(key);

  if (!current || now - current.startedAt >= input.windowMs) {
    state.windows.set(key, { startedAt: now, count: 1 });
    pruneRateWindows(state, now);
    return;
  }

  current.count += 1;
  if (current.count > input.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.startedAt + input.windowMs - now) / 1000));
    throw new OperationLimitError(
      429,
      "RATE_LIMITED",
      `내부 사용량 보호를 위해 ${input.operation} 요청을 잠시 제한했습니다. ${retryAfterSeconds}초 후 다시 시도해 주세요.`,
      retryAfterSeconds
    );
  }
}

function enterOperation(state: OperationalState, operation: string, maxConcurrent: number) {
  const current = state.inFlight.get(operation) ?? 0;
  if (current >= maxConcurrent) {
    throw new OperationLimitError(
      503,
      "CONCURRENCY_LIMITED",
      `${operation} 작업이 이미 ${current}개 실행 중입니다. 현재 내부 동시 실행 한도는 ${maxConcurrent}개입니다.`,
      15
    );
  }
  state.inFlight.set(operation, current + 1);
}

function leaveOperation(state: OperationalState, operation: string) {
  const current = state.inFlight.get(operation) ?? 0;
  if (current <= 1) {
    state.inFlight.delete(operation);
    return;
  }
  state.inFlight.set(operation, current - 1);
}

function recordAuditEvent(
  state: OperationalState,
  input: Omit<OperationAuditEvent, "startedAt" | "provider" | "textModel" | "imageModel"> & {
    startedAt: number;
  }
) {
  state.events.push({
    ...input,
    startedAt: new Date(input.startedAt).toISOString(),
    provider: process.env.IMAGE_PROVIDER || "openai-codex-oauth",
    textModel: CODEX_TEXT_MODEL,
    imageModel: CODEX_IMAGE_MODEL
  });
  if (state.events.length > MAX_AUDIT_EVENTS) {
    state.events.splice(0, state.events.length - MAX_AUDIT_EVENTS);
  }
}

async function readResponseErrorInfo(response: Response) {
  try {
    const payload = (await response.clone().json()) as unknown;
    if (!payload || typeof payload !== "object") return {};
    const record = payload as Record<string, unknown>;
    return {
      errorCode: typeof record.code === "string" ? record.code : undefined,
      errorMessage:
        typeof record.message === "string"
          ? record.message
          : typeof record.error === "string"
            ? record.error
            : undefined
    };
  } catch {
    return {};
  }
}

function resolveOperationLimits(options: OperationGuardOptions) {
  const defaults = getDefaultOperationLimits();
  const categoryMaxConcurrent =
    options.category === "generation"
      ? defaults.maxConcurrentGeneration
      : options.category === "analysis" || options.category === "quality"
        ? defaults.maxConcurrentAnalysis
        : defaults.maxConcurrentStandard;

  return {
    maxConcurrent: options.maxConcurrent ?? categoryMaxConcurrent,
    rateLimitMax: options.rateLimitMax ?? defaults.rateLimitMax,
    rateLimitWindowMs: options.rateLimitWindowMs ?? defaults.rateLimitWindowMs
  };
}

function getDefaultOperationLimits() {
  return {
    maxConcurrentGeneration: readPositiveInteger(process.env.INTERNAL_MAX_CONCURRENT_GENERATION, 2),
    maxConcurrentAnalysis: readPositiveInteger(process.env.INTERNAL_MAX_CONCURRENT_ANALYSIS, 3),
    maxConcurrentStandard: readPositiveInteger(process.env.INTERNAL_MAX_CONCURRENT_STANDARD, 8),
    rateLimitMax: readPositiveInteger(process.env.INTERNAL_RATE_LIMIT_MAX, 30),
    rateLimitWindowMs: readPositiveInteger(process.env.INTERNAL_RATE_LIMIT_WINDOW_MS, 60_000)
  };
}

function pruneRateWindows(state: OperationalState, now: number) {
  for (const [key, window] of state.windows) {
    if (now - window.startedAt > 10 * 60 * 1000) {
      state.windows.delete(key);
    }
  }
}

function readClientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwardedFor || realIp || "internal-local";
}

function readPositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function getOperationalState(): OperationalState {
  const globalRecord = globalThis as typeof globalThis & {
    [GLOBAL_OPERATION_STATE_KEY]?: OperationalState;
  };
  if (!globalRecord[GLOBAL_OPERATION_STATE_KEY]) {
    globalRecord[GLOBAL_OPERATION_STATE_KEY] = {
      inFlight: new Map(),
      windows: new Map(),
      events: []
    };
  }
  return globalRecord[GLOBAL_OPERATION_STATE_KEY];
}
