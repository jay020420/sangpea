import type {
  AspectRatio,
  GeneratedResult,
  ImageProviderId,
  PdpImageQualityReport,
  PdpLayerBounds,
  ProviderProof,
  ReferenceImageRole
} from "@runacademy/shared";

export const REDESIGN_SECTION_TOTAL = 8;
export const MAX_REDESIGN_REFERENCE_UPLOADS = 6;

export type RedesignSectionRevision = {
  id: string;
  imageUrl: string;
  label: string;
  createdAt: string;
  request?: string;
  providerProof?: ProviderProof;
};

export type RedesignSection = {
  id: string;
  section_id: string;
  image_id?: string;
  name: string;
  purpose: string;
  source: string;
  headline?: string;
  subheadline?: string;
  bullets?: string[];
  trust?: string;
  cta?: string;
  prompt: string;
  promptText?: string;
  imageUrl?: string;
  mimeType?: string;
  imageQualityReport?: PdpImageQualityReport;
  providerProof?: ProviderProof;
  error?: string;
  revisions?: RedesignSectionRevision[];
};

export type RedesignProject = {
  id: string;
  title: string;
  channel: string;
  model: ImageProviderId;
  modelLabel: string;
  modelId: string;
  count: number;
  ratio: AspectRatio;
  status: "완료" | "부분완료";
  files: string[];
  request: string;
  rolloutRequest: string;
  createdAt: string;
  analysis?: unknown;
  sections: RedesignSection[];
  failedSections?: RedesignSection[];
  warning?: string;
  providerProof?: ProviderProof;
  originalImage: string;
  referenceImages?: Array<{ id?: string; name?: string; role?: ReferenceImageRole; mimeType: string; base64: string }>;
};

export type RedesignGenerateResponse =
  | {
      ok: true;
      project: RedesignProject;
      result: GeneratedResult;
    }
  | {
      ok: false;
      error: string;
      detail?: string;
      code?: string;
    };

export type RedesignEditResponse =
  | {
      ok: true;
      imageUrl: string;
      mimeType?: string;
      prompt?: string;
      targetLayerId?: string;
      targetBounds?: PdpLayerBounds;
      imageQualityReport?: PdpImageQualityReport;
      providerProof?: ProviderProof;
    }
  | {
      ok: false;
      error: string;
      detail?: string;
      code?: string;
    };
