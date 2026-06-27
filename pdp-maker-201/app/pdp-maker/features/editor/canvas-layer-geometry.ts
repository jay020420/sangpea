import type { CanvasLayer, ShapeLayer, TextOverlay } from "../../pdp-drafts";

export const MIN_LAYER_SIZE = 24;
export const MIN_TEXT_SIZE = 32;

export function getCanvasLayerBounds(layer: CanvasLayer) {
  return {
    x: layer.x,
    y: layer.y,
    width: toNumericSize(layer.width, isShapeLayer(layer) ? 260 : 320),
    height: toNumericSize(layer.height, isShapeLayer(layer) ? 120 : 96)
  };
}

export function findTopCanvasLayerAtPoint(layers: CanvasLayer[], x: number, y: number) {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    const bounds = getCanvasLayerBounds(layer);
    const isInside =
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height;

    if (isInside) {
      return layer;
    }
  }

  return null;
}

export function toNumericSize(value: number | string, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isTextLayer(layer: CanvasLayer): layer is TextOverlay {
  return layer.kind === "text";
}

export function isShapeLayer(layer: CanvasLayer): layer is ShapeLayer {
  return layer.kind === "shape";
}
