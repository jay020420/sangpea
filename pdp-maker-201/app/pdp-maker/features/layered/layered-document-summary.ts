"use client";

import type { PdpLayerNode, PdpLayerNodeType, PdpLayeredDocumentV2 } from "@runacademy/shared";

export type LayeredDocumentSectionSummary = {
  sectionId: string;
  name: string;
  frameNodeId: string;
  totalNodes: number;
  editableNodes: number;
  visibleNodes: number;
  lockedNodes: number;
  textNodes: number;
  ctaNodes: number;
  shapeNodes: number;
  imageNodes: number;
  productNodes: number;
};

export type LayeredDocumentSummary = {
  sectionCount: number;
  frameCount: number;
  totalNodes: number;
  editableNodes: number;
  visibleNodes: number;
  lockedNodes: number;
  assetCount: number;
  generatedAssetCount: number;
  productAssetCount: number;
  backgroundNodeCount: number;
  productReferenceNodeCount: number;
  editableCopyNodeCount: number;
  warnings: string[];
  sections: LayeredDocumentSectionSummary[];
};

export type LayerTreePreviewItem = {
  id: string;
  name: string;
  type: PdpLayerNode["type"];
  role?: string;
  depth: number;
  visible: boolean;
  locked: boolean;
  editable: boolean;
  assetId?: string;
  childCount: number;
};

const EMPTY_COUNTS: Record<PdpLayerNodeType, number> = {
  frame: 0,
  group: 0,
  image: 0,
  text: 0,
  shape: 0,
  cta: 0,
  proof: 0,
  product: 0
};

export function summarizeLayeredDocument(document: PdpLayeredDocumentV2): LayeredDocumentSummary {
  const assetIds = new Set(document.assets.images.map((asset) => asset.id).filter(Boolean));
  const warnings: string[] = [];
  const sections = document.sections.map((section) => {
    const nodes = section.nodes.flatMap(flattenNode);
    const counts = countNodesByType(nodes);
    const frameCount = counts.frame;

    if (!frameCount) {
      warnings.push(`${section.sectionId}: frame node가 없습니다.`);
    }

    for (const node of nodes) {
      for (const assetId of getNodeImageAssetIds(node)) {
        if (!assetIds.has(assetId)) {
          warnings.push(`${section.sectionId}: ${node.name} layer가 없는 asset을 참조합니다.`);
        }
      }
      if (requiresImageAsset(node) && !getNodeImageAssetIds(node).length) {
        warnings.push(`${section.sectionId}: ${node.name} layer에 assetId가 없습니다.`);
      }
    }

    return {
      sectionId: section.sectionId,
      name: section.name,
      frameNodeId: section.frameNodeId,
      totalNodes: nodes.length,
      editableNodes: nodes.filter((node) => node.editable).length,
      visibleNodes: nodes.filter((node) => node.visible).length,
      lockedNodes: nodes.filter((node) => node.locked).length,
      textNodes: counts.text + counts.proof,
      ctaNodes: counts.cta,
      shapeNodes: counts.shape,
      imageNodes: counts.image,
      productNodes: counts.product
    };
  });
  const allNodes = document.sections.flatMap((section) => section.nodes.flatMap(flattenNode));
  const allCounts = countNodesByType(allNodes);
  const backgroundNodeCount = allNodes.filter((node) => node.role === "background").length;
  const productReferenceNodeCount = allNodes.filter((node) => node.role === "product-source-reference").length;
  const editableCopyNodeCount = allNodes.filter((node) => node.editable && (node.type === "text" || node.type === "cta" || node.type === "proof")).length;

  if (!document.sections.length) {
    warnings.push("문서에 section이 없습니다.");
  }
  if (!document.assets.images.length) {
    warnings.push("이미지 asset이 없습니다.");
  }

  return {
    sectionCount: document.sections.length,
    frameCount: allCounts.frame,
    totalNodes: allNodes.length,
    editableNodes: allNodes.filter((node) => node.editable).length,
    visibleNodes: allNodes.filter((node) => node.visible).length,
    lockedNodes: allNodes.filter((node) => node.locked).length,
    assetCount: document.assets.images.length,
    generatedAssetCount: document.assets.images.filter((asset) => asset.sourceRole === "generated").length,
    productAssetCount: document.assets.images.filter((asset) => asset.sourceRole === "product").length,
    backgroundNodeCount,
    productReferenceNodeCount,
    editableCopyNodeCount,
    warnings,
    sections
  };
}

export function buildLayerTreePreview(input: {
  document: PdpLayeredDocumentV2;
  sectionId?: string;
  sectionIndex?: number;
  maxItems?: number;
}): LayerTreePreviewItem[] {
  const section =
    (input.sectionId ? input.document.sections.find((candidate) => candidate.sectionId === input.sectionId) : null) ??
    input.document.sections[input.sectionIndex ?? 0];

  if (!section) {
    return [];
  }

  return section.nodes
    .slice()
    .sort(sortByZIndex)
    .flatMap((node) => flattenNodeForPreview(node, 0))
    .slice(0, input.maxItems ?? 18);
}

function flattenNode(node: PdpLayerNode): PdpLayerNode[] {
  return [node, ...(node.children ?? []).flatMap(flattenNode)];
}

function flattenNodeForPreview(node: PdpLayerNode, depth: number): LayerTreePreviewItem[] {
  return [
    {
      id: node.id,
      name: node.name,
      type: node.type,
      role: node.role,
      depth,
      visible: node.visible,
      locked: node.locked,
      editable: node.editable,
      assetId: node.assetId,
      childCount: node.children?.length ?? 0
    },
    ...(node.children ?? []).slice().sort(sortByZIndex).flatMap((child) => flattenNodeForPreview(child, depth + 1))
  ];
}

function countNodesByType(nodes: PdpLayerNode[]) {
  return nodes.reduce<Record<PdpLayerNodeType, number>>(
    (counts, node) => {
      counts[node.type] += 1;
      return counts;
    },
    { ...EMPTY_COUNTS }
  );
}

function requiresImageAsset(node: PdpLayerNode) {
  return node.type === "image" || node.type === "product" || Boolean(node.fills?.some((fill) => fill.imageAssetId));
}

function getNodeImageAssetIds(node: PdpLayerNode) {
  return [node.assetId, ...(node.fills ?? []).map((fill) => fill.imageAssetId)].filter((assetId): assetId is string => Boolean(assetId));
}

function sortByZIndex(left: PdpLayerNode, right: PdpLayerNode) {
  return left.zIndex - right.zIndex;
}
