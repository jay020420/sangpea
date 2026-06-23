import type { AspectRatio, PdpValidateApiKeyResponse } from "@runacademy/shared";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

export const RATIO_OPTIONS: Array<{
  value: AspectRatio;
  label: string;
  description: string;
  icon: "square" | "portrait" | "phone" | "landscape" | "wide";
}> = [
  { value: "1:1", label: "정방형", description: "썸네일, 마켓 대표 이미지", icon: "square" },
  { value: "3:4", label: "일반 세로", description: "상세페이지 기본형", icon: "portrait" },
  { value: "9:16", label: "모바일 세로", description: "모바일 집중형 상세페이지", icon: "phone" },
  { value: "4:3", label: "일반 가로", description: "배너, 중간 섹션 컷", icon: "landscape" },
  { value: "16:9", label: "와이드", description: "히어로 배너형", icon: "wide" }
];

export const TONE_OPTIONS = ["AI 자동 추천", "프리미엄", "모던", "테크", "미니멀", "팝아트", "인스타감성", "레트로"];

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers
  });

  const text = await response.text();
  if (!text) {
    if (!response.ok) {
      throw new Error(response.statusText || "요청 처리 중 오류가 발생했습니다.");
    }
    return {} as T;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(simplifyPlainTextError(text, response.status));
  }

  if (!response.ok) {
    throw new Error(extractApiErrorMessage(data, response.statusText || "요청 처리 중 오류가 발생했습니다."));
  }

  return data as T;
}

export async function validateCodexOAuth() {
  return apiJson<PdpValidateApiKeyResponse>("/pdp/validate-key", { method: "GET" });
}

export function toDataUrl(mimeType: string, base64: string) {
  return `data:${mimeType};base64,${base64}`;
}

export async function prepareImageFile(file: File) {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const sourceImage = await loadImage(sourceDataUrl);

  const maxDimension = 960;
  let width = sourceImage.width;
  let height = sourceImage.height;

  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지 캔버스를 초기화하지 못했습니다.");

  context.drawImage(sourceImage, 0, 0, width, height);
  const previewUrl = canvas.toDataURL("image/jpeg", 0.82);
  const base64 = previewUrl.split(",")[1] ?? "";
  if (!base64) throw new Error("이미지 변환 결과가 비어 있습니다.");

  return {
    base64,
    mimeType: "image/jpeg" as const,
    previewUrl,
    fileName: file.name
  };
}

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

async function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}

function simplifyPlainTextError(text: string, status: number) {
  const message = text.trim() || "요청 처리 중 오류가 발생했습니다.";
  if (status === 413 || message.toLowerCase().includes("request entity too large")) {
    return "이미지 데이터가 너무 커서 요청을 처리하지 못했습니다. 업로드 이미지를 줄이거나 페이지 수를 줄여 다시 시도해 주세요.";
  }
  if (message.startsWith("<!DOCTYPE") || message.startsWith("<html")) {
    return "서버가 JSON이 아닌 오류 페이지를 반환했습니다. 요청 크기나 서버 로그를 확인해 주세요.";
  }
  return message.slice(0, 500);
}

function extractApiErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"]) {
      const message = record[key];
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  }
  return fallback;
}
