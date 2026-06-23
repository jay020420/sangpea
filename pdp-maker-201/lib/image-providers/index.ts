import type { ImageProviderId } from "../shared";
import { codexImageProvider } from "./codex";
import type { ImageProvider } from "./types";

const IMAGE_PROVIDERS: Record<ImageProviderId, ImageProvider | null> = {
  "openai-codex-oauth": codexImageProvider,
  flux: null,
  comfyui: null,
  qwen: null,
  sdxl: null
};

export function getImageProvider(providerId: ImageProviderId = readConfiguredImageProvider()) {
  const provider = IMAGE_PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`이미지 provider '${providerId}'는 아직 구현되지 않았습니다. lib/image-providers에 구현을 추가해 주세요.`);
  }
  return provider;
}

export function listImageProviders() {
  return Object.entries(IMAGE_PROVIDERS).map(([id, provider]) => ({
    id: id as ImageProviderId,
    label: provider?.label ?? `${id} (not configured)`,
    enabled: Boolean(provider),
    defaultModel: provider?.defaultModel ?? "",
    capabilities: provider?.capabilities ?? []
  }));
}

function readConfiguredImageProvider(): ImageProviderId {
  const raw = (process.env.IMAGE_PROVIDER || "openai-codex-oauth").trim().toLowerCase();
  if (raw === "openai" || raw === "codex" || raw === "openai-codex-oauth") return "openai-codex-oauth";
  if (raw === "flux") return "flux";
  if (raw === "comfyui") return "comfyui";
  if (raw === "qwen") return "qwen";
  if (raw === "sdxl") return "sdxl";
  return "openai-codex-oauth";
}

export type { ImageProvider, ImageProviderEditInput, ImageProviderGenerateInput, ImageProviderReferenceImage, ImageProviderResult } from "./types";
