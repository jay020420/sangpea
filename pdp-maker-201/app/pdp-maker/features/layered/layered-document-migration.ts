"use client";

import type { PdpLayerBounds, PdpLayerNode, PdpLayeredDocumentV2, SectionBlueprint } from "@runacademy/shared";
import type { CanvasLayer, ShapeLayer, TextOverlay } from "../../pdp-drafts";

export function canvasLayersFromLayeredDocumentV2(input: {
  document?: PdpLayeredDocumentV2 | null;
  sections: SectionBlueprint[];
}): Record<number, CanvasLayer[]> {
  if (!input.document?.sections?.length || !input.sections.length) {
    return {};
  }

  const document = input.document;

  return input.sections.reduce<Record<number, CanvasLayer[]>>((record, section, index) => {
    const layeredSection = findLayeredSection(document, section.section_id, index);
    if (!layeredSection) return record;

    const layers = layeredSection.nodes
      .flatMap(flattenNode)
      .filter(isRecoverableEditorNode)
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((node) => nodeToCanvasLayer(node, document.canvas))
      .filter((layer): layer is CanvasLayer => Boolean(layer));

    if (layers.length) {
      record[index] = dedupeCanvasLayers(layers);
    }

    return record;
  }, {});
}

function findLayeredSection(document: PdpLayeredDocumentV2, sectionId: string, index: number) {
  return document.sections.find((section) => section.sectionId === sectionId) ?? document.sections[index] ?? null;
}

function flattenNode(node: PdpLayerNode): PdpLayerNode[] {
  return [node, ...(node.children ?? []).flatMap(flattenNode)];
}

function isRecoverableEditorNode(node: PdpLayerNode) {
  if (!node.visible || !node.editable || node.locked) return false;
  if (node.type === "text" || node.type === "cta" || node.type === "proof") return Boolean(node.text?.trim());
  if (node.type === "shape") return node.role !== "safe-zone";
  return false;
}

function nodeToCanvasLayer(node: PdpLayerNode, canvas: PdpLayeredDocumentV2["canvas"]): CanvasLayer | null {
  if (node.type === "shape") {
    return nodeToShapeLayer(node, canvas);
  }
  if (node.type === "text" || node.type === "cta" || node.type === "proof") {
    return nodeToTextOverlay(node, canvas);
  }
  return null;
}

function nodeToTextOverlay(node: PdpLayerNode, canvas: PdpLayeredDocumentV2["canvas"]): TextOverlay {
  const bounds = boundsToPixels(node.bounds, canvas);
  const fill = node.fills?.find((candidate) => candidate.color);
  const text = node.text?.trim() || "";
  const language = containsKorean(text) ? "ko" : "en";

  return {
    id: node.id,
    kind: "text",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    text,
    language,
    translations: {
      ko: text,
      en: text
    },
    fontSize: node.textStyle?.fontSize ?? 18,
    color: node.textStyle?.color ?? "#102532",
    backgroundColor: fill?.color ?? "#102532",
    backgroundEnabled: Boolean(fill?.color),
    backgroundOpacity: fill?.opacity ?? 0.86,
    backgroundRadius: node.cornerRadius ?? 18,
    fontFamily: normalizeFontFamily(node.textStyle?.fontFamily),
    fontWeight: node.textStyle?.fontWeight ?? "700",
    textAlign: node.textStyle?.align ?? "left",
    lineHeight: node.textStyle?.lineHeight ?? 1.2,
    shadowEnabled: false,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowBlur: 10,
    shadowOffsetY: 2
  };
}

function nodeToShapeLayer(node: PdpLayerNode, canvas: PdpLayeredDocumentV2["canvas"]): ShapeLayer {
  const bounds = boundsToPixels(node.bounds, canvas);
  const fill = node.fills?.find((candidate) => candidate.color);

  return {
    id: node.id,
    kind: "shape",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fillColor: fill?.color ?? "#102532",
    fillOpacity: fill?.opacity ?? 1,
    borderRadius: node.cornerRadius ?? 0
  };
}

function boundsToPixels(bounds: PdpLayerBounds, canvas: PdpLayeredDocumentV2["canvas"]) {
  if (bounds.unit === "percent") {
    return {
      x: Math.round((bounds.x / 100) * canvas.width),
      y: Math.round((bounds.y / 100) * canvas.height),
      width: Math.round((bounds.width / 100) * canvas.width),
      height: Math.round((bounds.height / 100) * canvas.height)
    };
  }

  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  };
}

function dedupeCanvasLayers(layers: CanvasLayer[]) {
  const byId = new Map<string, CanvasLayer>();
  for (const layer of layers) {
    byId.set(layer.id, layer);
  }
  return Array.from(byId.values());
}

function normalizeFontFamily(fontFamily: string | undefined) {
  return fontFamily ? `'${fontFamily.replace(/['"]/g, "").split(",")[0]}', sans-serif` : "'Pretendard', sans-serif";
}

function containsKorean(text: string) {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text);
}
