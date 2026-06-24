import type {
  AspectRatio,
  LandingPageBlueprint,
  PdpLayerBounds,
  PdpLayerImageAsset,
  PdpLayerNode,
  PdpLayerTextStyle,
  PdpLayeredDocumentV2,
  PdpReferenceImage,
  SectionBlueprint
} from "./shared";

const DEFAULT_CANVAS_WIDTH = 460;

export function createLayeredDocumentV2FromBlueprint(input: {
  title: string;
  blueprint: LandingPageBlueprint;
  originalImage?: string;
  referenceImages?: PdpReferenceImage[];
  aspectRatio?: AspectRatio;
  existingDocument?: PdpLayeredDocumentV2 | null;
}): PdpLayeredDocumentV2 {
  const now = new Date().toISOString();
  const canvas = {
    width: DEFAULT_CANVAS_WIDTH,
    height: getCanvasHeight(input.aspectRatio),
    unit: "px" as const,
    aspectRatio: input.aspectRatio
  };
  const documentId = input.existingDocument?.documentId || `pdp-layered-${crypto.randomUUID()}`;
  const imageAssets = buildInitialImageAssets(input);
  const generatedAssets = input.blueprint.sections
    .filter((section) => section.generatedImage)
    .map((section, index) =>
      buildImageAsset({
        id: generatedAssetId(section.section_id),
        name: `${section.section_id || `S${index + 1}`} generated background`,
        dataUrl: section.generatedImage || "",
        sourceRole: "generated",
        sectionId: section.section_id
      })
    )
    .filter((asset): asset is PdpLayerImageAsset => Boolean(asset));
  const assets = mergeImageAssets([...(input.existingDocument?.assets.images ?? []), ...imageAssets, ...generatedAssets]);

  return {
    version: 2,
    format: "pdp-layered-document-v2",
    documentId,
    title: input.title,
    createdAt: input.existingDocument?.createdAt || now,
    updatedAt: now,
    canvas,
    assets: {
      images: assets
    },
    styles: {
      colors: mergeColors(input.existingDocument?.styles.colors ?? [], ["#ffffff", "#102532", "#4cb7aa", "#c8474d"]),
      textStyles: input.existingDocument?.styles.textStyles?.length ? input.existingDocument.styles.textStyles : defaultTextStyles()
    },
    exportTargets: {
      figma: {
        pluginPayloadVersion: 1
      }
    },
    sections: input.blueprint.sections.map((section, index) => buildSectionFrame(section, index, canvas, hasImageAsset(assets, primaryProductAssetId())))
  };
}

export function getCanvasHeight(aspectRatio: AspectRatio | undefined) {
  switch (aspectRatio) {
    case "1:1":
      return 460;
    case "4:3":
      return 345;
    case "16:9":
      return 259;
    case "3:4":
      return 613;
    case "9:16":
    default:
      return 818;
  }
}

export function generatedAssetId(sectionId: string) {
  return `${sectionId || "section"}-generated-background`;
}

export function primaryProductAssetId() {
  return "primary-product-source";
}

export function mergeImageAssets(assets: PdpLayerImageAsset[]) {
  const byId = new Map<string, PdpLayerImageAsset>();
  for (const asset of assets) {
    if (!asset.id || !asset.dataUrl) continue;
    byId.set(asset.id, asset);
  }
  return Array.from(byId.values());
}

export function hasImageAsset(assets: PdpLayerImageAsset[], assetId: string) {
  return assets.some((asset) => asset.id === assetId && Boolean(asset.dataUrl));
}

export function dataUrlMimeType(dataUrl: string) {
  return dataUrl.match(/^data:([^;]+);base64,/)?.[1] || "image/png";
}

function buildInitialImageAssets(input: {
  originalImage?: string;
  referenceImages?: PdpReferenceImage[];
}): PdpLayerImageAsset[] {
  const assets: PdpLayerImageAsset[] = [];
  const originalAsset = buildImageAsset({
    id: "original-image",
    name: "Original image",
    dataUrl: input.originalImage || "",
    sourceRole: "original"
  });
  if (originalAsset) assets.push(originalAsset);
  const originalProductAsset = buildImageAsset({
    id: primaryProductAssetId(),
    name: "Primary product source",
    dataUrl: input.originalImage || "",
    sourceRole: "product"
  });
  if (originalProductAsset) assets.push(originalProductAsset);

  for (const [index, reference] of (input.referenceImages ?? []).entries()) {
    const dataUrl = `data:${reference.mimeType};base64,${reference.base64}`;
    const isPrimaryProduct = reference.role === "primary";
    const asset = buildImageAsset({
      id: isPrimaryProduct ? primaryProductAssetId() : reference.id || `reference-${index + 1}`,
      name: reference.name || `Reference ${index + 1}`,
      dataUrl,
      sourceRole: isPrimaryProduct ? "product" : "reference"
    });
    if (asset) assets.push(asset);
  }
  return assets;
}

function buildImageAsset(input: {
  id: string;
  name: string;
  dataUrl: string;
  sourceRole: PdpLayerImageAsset["sourceRole"];
  sectionId?: string;
}): PdpLayerImageAsset | null {
  if (!input.dataUrl) return null;
  return {
    id: input.id,
    name: input.name,
    mimeType: dataUrlMimeType(input.dataUrl),
    dataUrl: input.dataUrl,
    sourceRole: input.sourceRole,
    sectionId: input.sectionId
  };
}

function buildSectionFrame(section: SectionBlueprint, index: number, canvas: PdpLayeredDocumentV2["canvas"], hasProductSourceAsset: boolean) {
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
    children.push(buildHiddenProductSourceNode(sectionId, canvas, 2));
  }
  children.push(buildEditableSafeZoneNode(section, canvas, 3));
  children.push(...buildTextPlanningNodes(section, canvas));

  const frame: PdpLayerNode = {
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
  };

  return {
    id: `${sectionId}-section`,
    sectionId,
    name: section.section_name || sectionId,
    frameNodeId,
    nodes: [frame]
  };
}

function buildHiddenProductSourceNode(sectionId: string, canvas: PdpLayeredDocumentV2["canvas"], zIndex: number): PdpLayerNode {
  return {
    id: `${sectionId}-product-source-reference`,
    name: "Locked product source reference",
    type: "product",
    visible: false,
    locked: true,
    editable: false,
    opacity: 1,
    role: "product-source-reference",
    zIndex,
    bounds: {
      x: Math.round(canvas.width * 0.16),
      y: Math.round(canvas.height * 0.2),
      width: Math.round(canvas.width * 0.68),
      height: Math.round(canvas.height * 0.42),
      unit: "px"
    },
    assetId: primaryProductAssetId(),
    imageFit: "contain"
  };
}

function buildEditableSafeZoneNode(section: SectionBlueprint, canvas: PdpLayeredDocumentV2["canvas"], zIndex: number): PdpLayerNode {
  const sectionId = section.section_id || "section";
  return {
    id: `${sectionId}-editable-safe-zone`,
    name: "Editable copy safe zone",
    type: "shape",
    visible: false,
    locked: true,
    editable: false,
    opacity: 0.18,
    role: "safe-zone",
    zIndex,
    bounds: {
      x: 28,
      y: Math.round(canvas.height * 0.64),
      width: canvas.width - 56,
      height: Math.round(canvas.height * 0.27),
      unit: "px"
    },
    fills: [{ color: "#4cb7aa", opacity: 0.18 }],
    cornerRadius: 20
  };
}

function buildTextPlanningNodes(section: SectionBlueprint, canvas: PdpLayeredDocumentV2["canvas"]): PdpLayerNode[] {
  const textStyle = defaultTextStyles()[0];
  const sectionId = section.section_id || "section";
  const nodes: PdpLayerNode[] = [];
  if (section.headline) {
    nodes.push(textNode(`${sectionId}-planned-headline`, "Planned headline", "headline", section.headline, { x: 36, y: 36, width: canvas.width - 72, height: 88, unit: "px" }, textStyle, 10));
  }
  if (section.subheadline) {
    nodes.push(textNode(`${sectionId}-planned-subheadline`, "Planned subheadline", "subheadline", section.subheadline, { x: 36, y: 130, width: canvas.width - 72, height: 88, unit: "px" }, { ...textStyle, fontSize: 18, fontWeight: "500" }, 11));
  }
  if (section.CTA) {
    nodes.push({
      ...textNode(`${sectionId}-planned-cta`, "Planned CTA", "cta", section.CTA, { x: 120, y: canvas.height - 72, width: canvas.width - 240, height: 44, unit: "px" }, { ...textStyle, fontSize: 18, align: "center" }, 12),
      type: "cta",
      fills: [{ color: "#102532", opacity: 1 }],
      cornerRadius: 22
    });
  }
  return nodes;
}

function textNode(
  id: string,
  name: string,
  role: string,
  text: string,
  bounds: PdpLayerBounds,
  textStyle: PdpLayerTextStyle,
  zIndex: number
): PdpLayerNode {
  return {
    id,
    name,
    type: "text",
    visible: true,
    locked: false,
    editable: true,
    role,
    zIndex,
    bounds,
    text,
    textStyle
  };
}

function fullBounds(canvas: PdpLayeredDocumentV2["canvas"]): PdpLayerBounds {
  return {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    unit: "px"
  };
}

function defaultTextStyles(): PdpLayerTextStyle[] {
  return [
    {
      fontFamily: "Pretendard",
      fontSize: 28,
      fontWeight: "800",
      lineHeight: 1.18,
      color: "#102532",
      align: "left"
    }
  ];
}

function mergeColors(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right].filter(Boolean))).slice(0, 40);
}
