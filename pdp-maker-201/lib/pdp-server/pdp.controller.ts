import type { PdpAnalyzeRequest, PdpFinalQualityRequest, PdpGenerateImageRequest, PdpImagePromptPreviewRequest } from "../shared";
import { CodexProviderError } from "../codex-oauth";
import { PdpService, PdpServiceError, toPdpErrorResponse } from "./pdp.service";

export class PdpController {
  constructor(private readonly pdpService = new PdpService()) {}

  async validateApiKey() {
    try {
      const result = await this.pdpService.validateCodexOAuth();
      return {
        ok: true as const,
        ...result
      };
    } catch (error) {
      return toPdpErrorResponse(error);
    }
  }

  async analyze(body: PdpAnalyzeRequest) {
    try {
      const result = await this.pdpService.analyzeProduct(body);
      return {
        ok: true as const,
        result
      };
    } catch (error) {
      return toPdpErrorResponse(error);
    }
  }

  async generateImage(body: PdpGenerateImageRequest) {
    try {
      const result = await this.pdpService.generateSectionImage(body);
      return {
        ok: true as const,
        ...result
      };
    } catch (error) {
      return toPdpErrorResponse(
        error instanceof PdpServiceError || error instanceof CodexProviderError
          ? error
          : new PdpServiceError(
              "PDP_IMAGE_GENERATION_FAILED",
              "이미지 생성 중 오류가 발생했습니다.",
              error instanceof Error ? `${error.name}: ${error.message}` : String(error)
            )
      );
    }
  }

  async previewImagePrompt(body: PdpImagePromptPreviewRequest) {
    try {
      const result = await this.pdpService.buildSectionImagePromptPreview(body);
      return {
        ok: true as const,
        ...result
      };
    } catch (error) {
      return toPdpErrorResponse(
        error instanceof PdpServiceError || error instanceof CodexProviderError
          ? error
          : new PdpServiceError(
              "PDP_IMAGE_GENERATION_FAILED",
              "이미지 프롬프트 조회 중 오류가 발생했습니다.",
              error instanceof Error ? `${error.name}: ${error.message}` : String(error)
            )
      );
    }
  }

  async evaluateFinalQuality(body: PdpFinalQualityRequest) {
    try {
      const imageQualityReport = await this.pdpService.evaluateFinalCompositeImage(body);
      return {
        ok: true as const,
        imageQualityReport
      };
    } catch (error) {
      return toPdpErrorResponse(
        error instanceof PdpServiceError || error instanceof CodexProviderError
          ? error
          : new PdpServiceError(
              "PDP_IMAGE_GENERATION_FAILED",
              "최종 합성본 품질 검수 중 오류가 발생했습니다.",
              error instanceof Error ? `${error.name}: ${error.message}` : String(error)
            )
      );
    }
  }
}
