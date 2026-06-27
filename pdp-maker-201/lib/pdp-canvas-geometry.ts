import type { AspectRatio } from "./shared";

export const PDP_LEGACY_CANVAS_WIDTH = 460;
export const PDP_EDITOR_CANVAS_WIDTH = 860;
export const PDP_EDITOR_CANVAS_SCALE = PDP_EDITOR_CANVAS_WIDTH / PDP_LEGACY_CANVAS_WIDTH;

export const PDP_CANVAS_HEIGHT_BY_ASPECT_RATIO: Record<AspectRatio, number> = {
  "1:1": 860,
  "4:3": 645,
  "16:9": 484,
  "3:4": 1147,
  "9:16": 1529
};

export function scalePdpCanvasValue(value: number) {
  return Math.round(value * PDP_EDITOR_CANVAS_SCALE);
}

export function getPdpCanvasHeight(aspectRatio: AspectRatio = "9:16") {
  return PDP_CANVAS_HEIGHT_BY_ASPECT_RATIO[aspectRatio] ?? PDP_CANVAS_HEIGHT_BY_ASPECT_RATIO["9:16"];
}
