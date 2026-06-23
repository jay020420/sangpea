import { CODEX_IMAGE_MODEL, generateImageWithCodex } from "../codex-oauth";
import type { ImageProvider, ImageProviderEditInput, ImageProviderGenerateInput } from "./types";

export const codexImageProvider: ImageProvider = {
  id: "openai-codex-oauth",
  label: "Codex OAuth / OpenAI gpt-image-2",
  defaultModel: CODEX_IMAGE_MODEL,
  capabilities: ["generate", "edit", "reference-image"],
  async generate(input: ImageProviderGenerateInput) {
    return generateImageWithCodex(input);
  },
  async edit(input: ImageProviderEditInput) {
    return generateImageWithCodex({
      ...input,
      referenceImages: [input.sourceImage, ...(input.referenceImages ?? [])].filter((image): image is NonNullable<typeof image> => Boolean(image))
    });
  }
};
