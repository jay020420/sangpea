import type { AspectRatio, ImageProviderCapability, ImageProviderId, ProviderProof } from "../shared";

export type ImageProviderReferenceImage = {
  base64: string;
  mimeType: string;
};

export type ImageProviderGenerateInput = {
  prompt: string;
  referenceImages?: ImageProviderReferenceImage[];
  aspectRatio?: AspectRatio | string;
  size?: string;
};

export type ImageProviderEditInput = ImageProviderGenerateInput & {
  sourceImage?: ImageProviderReferenceImage;
};

export type ImageProviderResult = {
  imageBase64: string;
  mimeType: string;
  response?: unknown;
  providerProof: ProviderProof;
};

export interface ImageProvider {
  id: ImageProviderId;
  label: string;
  defaultModel: string;
  capabilities: ImageProviderCapability[];
  generate(input: ImageProviderGenerateInput): Promise<ImageProviderResult>;
  edit(input: ImageProviderEditInput): Promise<ImageProviderResult>;
}
