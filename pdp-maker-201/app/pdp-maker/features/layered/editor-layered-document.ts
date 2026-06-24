"use client";

import type {
  AspectRatio,
  GeneratedResult,
  PdpLayerNode,
  PdpLayerTextStyle,
  PdpLayeredDocumentV2,
  SectionBlueprint
} from "@runacademy/shared";
import {
  buildEditableSafeZoneNode,
  createLayeredDocumentV2FromBlueprint,
  dataUrlMimeType,
  generatedAssetId,
  getCanvasHeight,
  hasImageAsset,
  mergeImageAssets,
  buildProductPlacementNode,
  primaryProductAssetId
} from "../../../../lib/pdp-layered-document";
import type { CanvasLayer, ShapeLayer, TextOverlay } from "../../pdp-drafts";

const EDITOR_CANVAS_WIDTH = 460;
const FIGMA_FRAME_GAP = 80;

export type FigmaPluginPayload = {
  version: 1;
  sourceDocumentId: string;
  sourceTitle: string;
  createdAt: string;
  canvas: PdpLayeredDocumentV2["canvas"];
  importHints: {
    coordinateSpace: "frame-local-children";
    frameLayout: "vertical-stack";
    frameGap: number;
    frameWidth: number;
    frameHeight: number;
    totalHeight: number;
    imageAssetStrategy: "data-url-fill";
  };
  summary: {
    frameCount: number;
    nodeCount: number;
    editableNodeCount: number;
    hiddenNodeCount: number;
    lockedNodeCount: number;
    assetCount: number;
    generatedAssetCount: number;
    productAssetCount: number;
  };
  validation: {
    status: "ready" | "warning";
    warnings: string[];
    missingAssetRefs: string[];
  };
  assets: PdpLayeredDocumentV2["assets"];
  frames: FigmaExportNode[];
};

export type FigmaExportNode = {
  id: string;
  name: string;
  figmaType: "FRAME" | "GROUP" | "RECTANGLE" | "TEXT";
  sourceType: PdpLayerNode["type"];
  sourceSectionId?: string;
  sectionIndex?: number;
  visible: boolean;
  locked: boolean;
  bounds: PdpLayerNode["bounds"];
  text?: string;
  textStyle?: PdpLayerTextStyle;
  fills?: PdpLayerNode["fills"];
  cornerRadius?: number;
  opacity?: number;
  role?: string;
  assetId?: string;
  imageFit?: PdpLayerNode["imageFit"];
  children?: FigmaExportNode[];
};

export function buildEditorLayeredDocumentV2(input: {
  initialResult: GeneratedResult;
  sections: SectionBlueprint[];
  overlaysBySection: Record<number, CanvasLayer[]>;
  aspectRatio: AspectRatio;
  existingDocument?: PdpLayeredDocumentV2 | null;
}): PdpLayeredDocumentV2 {
  const blueprint = {
    ...input.initialResult.blueprint,
    sections: input.sections
  };
  const baseDocument = createLayeredDocumentV2FromBlueprint({
    title: input.initialResult.productBrief?.productName || "PDP layered document",
    blueprint,
    originalImage: input.initialResult.originalImage,
    referenceImages: input.initialResult.referenceImages,
    aspectRatio: input.aspectRatio,
    existingDocument: input.existingDocument ?? input.initialResult.layeredDocumentV2 ?? null
  });
  const canvas = {
    ...baseDocument.canvas,
    width: EDITOR_CANVAS_WIDTH,
    height: getCanvasHeight(input.aspectRatio),
    aspectRatio: input.aspectRatio
  };
  const generatedAssets = input.sections
    .filter((section) => section.generatedImage)
    .map((section, index) => ({
      id: generatedAssetId(section.section_id || `S${index + 1}`),
      name: `${section.section_id || `S${index + 1}`} generated background`,
      mimeType: dataUrlMimeType(section.generatedImage || ""),
      dataUrl: section.generatedImage || "",
      sourceRole: "generated" as const,
      sectionId: section.section_id
    }));

  const imageAssets = mergeImageAssets([...(baseDocument.assets.images ?? []), ...generatedAssets]);
  const hasProductSourceAsset = hasImageAsset(imageAssets, primaryProductAssetId());

  return {
    ...baseDocument,
    updatedAt: new Date().toISOString(),
    canvas,
    assets: {
      images: imageAssets
    },
    sections: input.sections.map((section, index) => {
      const sectionId = section.section_id || `S${index + 1}`;
      const frameNodeId = `${sectionId}-frame`;
      const children: PdpLayerNode[] = [];
      if (section.generatedImage) {
        children.push({
          id: `${sectionId}-background-image`,
          name: "Generated background",
          type: "image",
          visible: true,
          locked: false,
          editable: false,
          role: "background",
          zIndex: 0,
          bounds: fullBounds(canvas),
          assetId: generatedAssetId(sectionId),
          imageFit: "cover"
        });
      }
      if (hasProductSourceAsset) {
        children.push(buildProductPlacementNode(section, canvas, 2));
      }
      children.push(buildEditableSafeZoneNode(section, canvas, 3));
      children.push(...(input.overlaysBySection[index] ?? []).map((layer, layerIndex) => canvasLayerToNode(layer, sectionId, layerIndex + 10)));

      return {
        id: `${sectionId}-section`,
        sectionId,
        name: section.section_name || sectionId,
        frameNodeId,
        nodes: [
          {
            id: frameNodeId,
            name: section.section_name || sectionId,
            type: "frame",
            visible: true,
            locked: false,
            editable: true,
            role: section.layout_template || "section",
            zIndex: index,
            bounds: fullBounds(canvas),
            children
          }
        ]
      };
    })
  };
}

export function exportFigmaDocument(document: PdpLayeredDocumentV2): FigmaPluginPayload {
  const frameCount = document.sections.reduce((count, section) => count + section.nodes.filter((node) => node.type === "frame").length, 0);
  const allNodes = document.sections.flatMap((section) => section.nodes.flatMap(flattenNode));
  const validation = validateFigmaPayload(document, allNodes);

  return {
    version: 1,
    sourceDocumentId: document.documentId,
    sourceTitle: document.title,
    createdAt: new Date().toISOString(),
    canvas: document.canvas,
    importHints: {
      coordinateSpace: "frame-local-children",
      frameLayout: "vertical-stack",
      frameGap: FIGMA_FRAME_GAP,
      frameWidth: document.canvas.width,
      frameHeight: document.canvas.height,
      totalHeight: Math.max(0, document.sections.length * document.canvas.height + Math.max(0, document.sections.length - 1) * FIGMA_FRAME_GAP),
      imageAssetStrategy: "data-url-fill"
    },
    summary: {
      frameCount,
      nodeCount: allNodes.length,
      editableNodeCount: allNodes.filter((node) => node.editable).length,
      hiddenNodeCount: allNodes.filter((node) => !node.visible).length,
      lockedNodeCount: allNodes.filter((node) => node.locked).length,
      assetCount: document.assets.images.length,
      generatedAssetCount: document.assets.images.filter((asset) => asset.sourceRole === "generated").length,
      productAssetCount: document.assets.images.filter((asset) => asset.sourceRole === "product").length
    },
    validation,
    assets: document.assets,
    frames: document.sections.flatMap((section, sectionIndex) =>
      section.nodes
        .slice()
        .sort(sortByZIndex)
        .map((node) =>
          nodeToFigmaNode(node, {
            sourceSectionId: section.sectionId,
            sectionIndex,
            frameOffsetY: sectionIndex * (document.canvas.height + FIGMA_FRAME_GAP),
            isTopLevelFrame: true
          })
        )
    )
  };
}

function canvasLayerToNode(layer: CanvasLayer, sectionId: string, zIndex: number): PdpLayerNode {
  if (isShapeLayer(layer)) {
    return shapeLayerToNode(layer, sectionId, zIndex);
  }
  return textOverlayToNode(layer, sectionId, zIndex);
}

function textOverlayToNode(layer: TextOverlay, sectionId: string, zIndex: number): PdpLayerNode {
  return {
    id: layer.id,
    name: layerLabel(layer.text, "Text layer"),
    type: inferTextNodeType(layer),
    visible: true,
    locked: false,
    editable: true,
    role: inferTextRole(layer),
    zIndex,
    bounds: {
      x: Number(layer.x) || 0,
      y: Number(layer.y) || 0,
      width: toNumericSize(layer.width, 240),
      height: toNumericSize(layer.height, 96),
      unit: "px"
    },
    text: layer.text,
    fills: layer.backgroundEnabled ? [{ color: layer.backgroundColor, opacity: layer.backgroundOpacity }] : undefined,
    cornerRadius: layer.backgroundEnabled ? layer.backgroundRadius : undefined,
    textStyle: {
      fontFamily: layer.fontFamily.replace(/['"]/g, "").split(",")[0] || "Pretendard",
      fontSize: layer.fontSize,
      fontWeight: layer.fontWeight,
      lineHeight: layer.lineHeight,
      color: layer.color,
      align: layer.textAlign
    }
  };
}

function shapeLayerToNode(layer: ShapeLayer, sectionId: string, zIndex: number): PdpLayerNode {
  return {
    id: layer.id,
    name: `${sectionId} shape`,
    type: "shape",
    visible: true,
    locked: false,
    editable: true,
    zIndex,
    bounds: {
      x: Number(layer.x) || 0,
      y: Number(layer.y) || 0,
      width: toNumericSize(layer.width, 240),
      height: toNumericSize(layer.height, 96),
      unit: "px"
    },
    fills: [{ color: layer.fillColor, opacity: layer.fillOpacity }],
    cornerRadius: layer.borderRadius
  };
}

function nodeToFigmaNode(
  node: PdpLayerNode,
  context: {
    sourceSectionId?: string;
    sectionIndex?: number;
    frameOffsetY: number;
    isTopLevelFrame: boolean;
  }
): FigmaExportNode {
  return {
    id: node.id,
    name: node.name,
    figmaType: nodeTypeToFigmaType(node.type),
    sourceType: node.type,
    sourceSectionId: context.sourceSectionId,
    sectionIndex: context.sectionIndex,
    visible: node.visible,
    locked: node.locked,
    bounds: context.isTopLevelFrame ? offsetTopLevelFrameBounds(node.bounds, context.frameOffsetY) : node.bounds,
    text: node.text,
    textStyle: node.textStyle,
    fills: node.fills,
    cornerRadius: node.cornerRadius,
    opacity: node.opacity,
    role: node.role,
    assetId: node.assetId,
    imageFit: node.imageFit,
    children: node.children
      ?.slice()
      .sort(sortByZIndex)
      .map((child) =>
        nodeToFigmaNode(child, {
          ...context,
          isTopLevelFrame: false
        })
      )
  };
}

function validateFigmaPayload(document: PdpLayeredDocumentV2, allNodes: PdpLayerNode[]): FigmaPluginPayload["validation"] {
  const assetIds = new Set(document.assets.images.map((asset) => asset.id));
  const warnings: string[] = [];
  const missingAssetRefs: string[] = [];

  for (const section of document.sections) {
    if (!section.nodes.some((node) => node.type === "frame")) {
      warnings.push(`${section.sectionId}: FRAME node가 없습니다.`);
    }
  }

  for (const node of allNodes) {
    const refs = [node.assetId, ...(node.fills ?? []).map((fill) => fill.imageAssetId)].filter((assetId): assetId is string => Boolean(assetId));
    if ((node.type === "image" || node.type === "product") && !refs.length) {
      warnings.push(`${node.id}: image asset 참조가 없습니다.`);
    }
    for (const ref of refs) {
      if (!assetIds.has(ref)) {
        missingAssetRefs.push(`${node.id}:${ref}`);
      }
    }
  }

  if (missingAssetRefs.length) {
    warnings.push(`누락된 image asset 참조 ${missingAssetRefs.length}건이 있습니다.`);
  }

  return {
    status: warnings.length ? "warning" : "ready",
    warnings,
    missingAssetRefs
  };
}

function flattenNode(node: PdpLayerNode): PdpLayerNode[] {
  return [node, ...(node.children ?? []).flatMap(flattenNode)];
}

function offsetTopLevelFrameBounds(bounds: PdpLayerNode["bounds"], frameOffsetY: number): PdpLayerNode["bounds"] {
  if (bounds.unit !== "px") {
    return bounds;
  }

  return {
    ...bounds,
    y: bounds.y + frameOffsetY
  };
}

function sortByZIndex(left: PdpLayerNode, right: PdpLayerNode) {
  return left.zIndex - right.zIndex;
}

function nodeTypeToFigmaType(type: PdpLayerNode["type"]): FigmaExportNode["figmaType"] {
  if (type === "frame") return "FRAME";
  if (type === "group") return "GROUP";
  if (type === "text") return "TEXT";
  return "RECTANGLE";
}

function fullBounds(canvas: PdpLayeredDocumentV2["canvas"]) {
  return {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    unit: "px" as const
  };
}

function inferTextNodeType(layer: TextOverlay): PdpLayerNode["type"] {
  const text = layer.text.toLowerCase();
  if (/cta|구매|도입|신청|확인|보기|시작/.test(text)) return "cta";
  if (/후기|리뷰|인증|근거|증빙|평점/.test(text)) return "proof";
  return "text";
}

function inferTextRole(layer: TextOverlay) {
  const text = layer.text.trim();
  if (text.length <= 24 && layer.fontSize >= 24) return "headline";
  if (/구매|도입|신청|확인|보기|시작/.test(text)) return "cta";
  return "body";
}

function layerLabel(text: string, fallback: string) {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 40) : fallback;
}

function toNumericSize(value: number | string, fallback: number) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isShapeLayer(layer: CanvasLayer): layer is ShapeLayer {
  return layer.kind === "shape";
}
