"use client";

import type { PdpLayerNode, PdpLayeredDocumentV2 } from "@runacademy/shared";
import type { FigmaPluginPayload } from "./editor-layered-document";
import type { LayeredDocumentSummary } from "./layered-document-summary";

export type LayerExportManifest = {
  version: 1;
  createdAt: string;
  sourceDocumentId: string;
  sourceTitle: string;
  format: PdpLayeredDocumentV2["format"];
  documentVersion: PdpLayeredDocumentV2["version"];
  health: {
    status: "ready" | "warning";
    warnings: string[];
  };
  canvas: PdpLayeredDocumentV2["canvas"];
  figma: {
    payloadVersion: FigmaPluginPayload["version"];
    importHints: FigmaPluginPayload["importHints"];
    validation: FigmaPluginPayload["validation"];
  };
  counts: LayeredDocumentSummary;
  assets: Array<{
    id: string;
    name: string;
    mimeType: string;
    sourceRole: string;
    sectionId?: string;
    byteEstimate: number;
  }>;
  sections: Array<{
    sectionId: string;
    name: string;
    templateId?: PdpLayeredDocumentV2["sections"][number]["templateId"];
    frameNodeId: string;
    nodes: ManifestNode[];
  }>;
};

type ManifestNode = {
  id: string;
  name: string;
  type: PdpLayerNode["type"];
  role?: string;
  visible: boolean;
  locked: boolean;
  editable: boolean;
  zIndex: number;
  bounds: PdpLayerNode["bounds"];
  assetId?: string;
  textPreview?: string;
  childCount: number;
  children?: ManifestNode[];
};

export function buildLayerExportManifest(input: {
  document: PdpLayeredDocumentV2;
  figmaPayload: FigmaPluginPayload;
  summary: LayeredDocumentSummary;
}): LayerExportManifest {
  const warnings = [...input.summary.warnings, ...input.figmaPayload.validation.warnings];

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceDocumentId: input.document.documentId,
    sourceTitle: input.document.title,
    format: input.document.format,
    documentVersion: input.document.version,
    health: {
      status: warnings.length ? "warning" : "ready",
      warnings
    },
    canvas: input.document.canvas,
    figma: {
      payloadVersion: input.figmaPayload.version,
      importHints: input.figmaPayload.importHints,
      validation: input.figmaPayload.validation
    },
    counts: input.summary,
    assets: input.document.assets.images.map((asset) => ({
      id: asset.id,
      name: asset.name,
      mimeType: asset.mimeType,
      sourceRole: asset.sourceRole,
      sectionId: asset.sectionId,
      byteEstimate: estimateDataUrlBytes(asset.dataUrl)
    })),
    sections: input.document.sections.map((section) => ({
      sectionId: section.sectionId,
      name: section.name,
      templateId: section.templateId,
      frameNodeId: section.frameNodeId,
      nodes: section.nodes.slice().sort(sortByZIndex).map(nodeToManifestNode)
    }))
  };
}

function nodeToManifestNode(node: PdpLayerNode): ManifestNode {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    role: node.role,
    visible: node.visible,
    locked: node.locked,
    editable: node.editable,
    zIndex: node.zIndex,
    bounds: node.bounds,
    assetId: node.assetId,
    textPreview: node.text ? node.text.trim().replace(/\s+/g, " ").slice(0, 80) : undefined,
    childCount: node.children?.length ?? 0,
    children: node.children?.slice().sort(sortByZIndex).map(nodeToManifestNode)
  };
}

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  return Math.max(0, Math.floor((base64.length * 3) / 4));
}

function sortByZIndex(left: PdpLayerNode, right: PdpLayerNode) {
  return left.zIndex - right.zIndex;
}
