import type {
  AspectRatio,
  LandingPageBlueprint,
  PdpLayerBounds,
  PdpLayerImageAsset,
  PdpLayerNode,
  PdpLayerTextStyle,
  PdpLayeredDocumentV2,
  PdpLayoutTemplate,
  PdpReferenceImage,
  SectionBlueprint
} from "./shared";

const DEFAULT_CANVAS_WIDTH = 460;

type RatioBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutZoneConfig = {
  product: RatioBounds;
  safeZone: RatioBounds;
  headline: RatioBounds;
  subheadline: RatioBounds;
  bulletArea: RatioBounds;
  trust: RatioBounds;
  cta: RatioBounds;
};

type SectionLayerZones = {
  template: PdpLayoutTemplate;
  product: PdpLayerBounds;
  safeZone: PdpLayerBounds;
  headline: PdpLayerBounds;
  subheadline: PdpLayerBounds;
  bulletArea: PdpLayerBounds;
  trust: PdpLayerBounds;
  cta: PdpLayerBounds;
};

const DEFAULT_LAYOUT_TEMPLATE: PdpLayoutTemplate = "benefit";

const LAYOUT_ZONE_MAP: Record<PdpLayoutTemplate, LayoutZoneConfig> = {
  hero: {
    headline: { x: 0.08, y: 0.06, width: 0.84, height: 0.11 },
    subheadline: { x: 0.08, y: 0.18, width: 0.84, height: 0.09 },
    product: { x: 0.14, y: 0.29, width: 0.72, height: 0.3 },
    bulletArea: { x: 0.08, y: 0.64, width: 0.84, height: 0.14 },
    trust: { x: 0.08, y: 0.79, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 },
    safeZone: { x: 0.06, y: 0.62, width: 0.88, height: 0.34 }
  },
  problem: {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.11 },
    subheadline: { x: 0.08, y: 0.17, width: 0.84, height: 0.09 },
    product: { x: 0.12, y: 0.31, width: 0.76, height: 0.24 },
    bulletArea: { x: 0.08, y: 0.58, width: 0.84, height: 0.16 },
    trust: { x: 0.08, y: 0.76, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 },
    safeZone: { x: 0.06, y: 0.56, width: 0.88, height: 0.34 }
  },
  benefit: {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.16, width: 0.84, height: 0.08 },
    product: { x: 0.13, y: 0.25, width: 0.74, height: 0.27 },
    bulletArea: { x: 0.08, y: 0.56, width: 0.84, height: 0.18 },
    trust: { x: 0.08, y: 0.76, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 },
    safeZone: { x: 0.06, y: 0.54, width: 0.88, height: 0.36 }
  },
  proof: {
    headline: { x: 0.08, y: 0.04, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.15, width: 0.84, height: 0.08 },
    product: { x: 0.14, y: 0.28, width: 0.72, height: 0.22 },
    bulletArea: { x: 0.08, y: 0.53, width: 0.84, height: 0.18 },
    trust: { x: 0.08, y: 0.73, width: 0.84, height: 0.09 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 },
    safeZone: { x: 0.06, y: 0.58, width: 0.88, height: 0.32 }
  },
  spec: {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.15, width: 0.84, height: 0.08 },
    product: { x: 0.12, y: 0.22, width: 0.76, height: 0.26 },
    bulletArea: { x: 0.08, y: 0.51, width: 0.84, height: 0.22 },
    trust: { x: 0.08, y: 0.75, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 },
    safeZone: { x: 0.06, y: 0.5, width: 0.88, height: 0.4 }
  },
  demo: {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.15, width: 0.84, height: 0.08 },
    product: { x: 0.1, y: 0.24, width: 0.8, height: 0.27 },
    bulletArea: { x: 0.08, y: 0.55, width: 0.84, height: 0.2 },
    trust: { x: 0.08, y: 0.77, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 },
    safeZone: { x: 0.06, y: 0.54, width: 0.88, height: 0.36 }
  },
  "use-case": {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.15, width: 0.84, height: 0.08 },
    product: { x: 0.12, y: 0.25, width: 0.76, height: 0.25 },
    bulletArea: { x: 0.08, y: 0.53, width: 0.84, height: 0.2 },
    trust: { x: 0.08, y: 0.76, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 },
    safeZone: { x: 0.06, y: 0.52, width: 0.88, height: 0.38 }
  },
  "faq-cta": {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.16, width: 0.84, height: 0.08 },
    product: { x: 0.16, y: 0.27, width: 0.68, height: 0.2 },
    bulletArea: { x: 0.08, y: 0.5, width: 0.84, height: 0.18 },
    trust: { x: 0.08, y: 0.7, width: 0.84, height: 0.08 },
    cta: { x: 0.18, y: 0.84, width: 0.64, height: 0.07 },
    safeZone: { x: 0.06, y: 0.7, width: 0.88, height: 0.26 }
  }
};

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
    children.push(buildProductPlacementNode(section, canvas, 2));
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

export function buildProductPlacementNode(section: SectionBlueprint, canvas: PdpLayeredDocumentV2["canvas"], zIndex: number): PdpLayerNode {
  const sectionId = section.section_id || "section";
  const zones = getSectionLayerZones(section, canvas);
  return {
    id: `${sectionId}-product-source-reference`,
    name: "Editable product placement",
    type: "product",
    visible: true,
    locked: false,
    editable: true,
    opacity: 1,
    role: "product",
    zIndex,
    bounds: zones.product,
    assetId: primaryProductAssetId(),
    imageFit: "contain"
  };
}

export function buildEditableSafeZoneNode(section: SectionBlueprint, canvas: PdpLayeredDocumentV2["canvas"], zIndex: number): PdpLayerNode {
  const sectionId = section.section_id || "section";
  const zones = getSectionLayerZones(section, canvas);
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
    bounds: zones.safeZone,
    fills: [{ color: "#4cb7aa", opacity: 0.18 }],
    cornerRadius: 20
  };
}

function buildTextPlanningNodes(section: SectionBlueprint, canvas: PdpLayeredDocumentV2["canvas"]): PdpLayerNode[] {
  const textStyle = defaultTextStyles()[0];
  const sectionId = section.section_id || "section";
  const zones = getSectionLayerZones(section, canvas);
  const nodes: PdpLayerNode[] = [];
  if (section.headline) {
    nodes.push(
      textNode(
        `${sectionId}-planned-headline`,
        "Planned headline",
        "headline",
        section.headline,
        zones.headline,
        { ...textStyle, color: "#ffffff" },
        10,
        {
          fills: [{ color: "#102532", opacity: 0.88 }],
          cornerRadius: 18
        }
      )
    );
  }
  if (section.subheadline) {
    nodes.push(
      textNode(
        `${sectionId}-planned-subheadline`,
        "Planned subheadline",
        "subheadline",
        section.subheadline,
        zones.subheadline,
        { ...textStyle, fontSize: 18, fontWeight: "500", color: "#ffffff" },
        11,
        {
          fills: [{ color: "#102532", opacity: 0.76 }],
          cornerRadius: 16
        }
      )
    );
  }
  const bulletCopies = section.bullets.map((bullet) => bullet.trim()).filter(Boolean).slice(0, 3);
  for (const [index, bullet] of bulletCopies.entries()) {
    nodes.push(
      textNode(
        `${sectionId}-planned-bullet-${index + 1}`,
        `Planned bullet ${index + 1}`,
        "bullet",
        bullet,
        buildBulletBounds(zones.bulletArea, index, bulletCopies.length, zones.template),
        { ...textStyle, fontSize: 16, fontWeight: "700", lineHeight: 1.24, color: "#102532" },
        12 + index,
        {
          fills: [{ color: "#ffffff", opacity: 0.86 }],
          cornerRadius: 14
        }
      )
    );
  }
  if (section.trust_or_objection_line) {
    nodes.push(
      textNode(
        `${sectionId}-planned-trust`,
        "Planned trust line",
        "trust",
        section.trust_or_objection_line,
        zones.trust,
        { ...textStyle, fontSize: 15, fontWeight: "700", lineHeight: 1.22, color: "#102532" },
        16,
        {
          type: "proof",
          fills: [{ color: "#ffffff", opacity: 0.88 }],
          cornerRadius: 14
        }
      )
    );
  }
  if (section.CTA) {
    nodes.push({
      ...textNode(
        `${sectionId}-planned-cta`,
        "Planned CTA",
        "cta",
        section.CTA,
        zones.cta,
        { ...textStyle, fontSize: 18, align: "center", color: "#ffffff" },
        18
      ),
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
  zIndex: number,
  overrides: Partial<Pick<PdpLayerNode, "type" | "fills" | "cornerRadius">> = {}
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
    textStyle,
    ...overrides
  };
}

export function getSectionLayerZones(section: SectionBlueprint, canvas: PdpLayeredDocumentV2["canvas"]): SectionLayerZones {
  const template = normalizeLayoutTemplate(section.layout_template);
  const config = LAYOUT_ZONE_MAP[template];
  return {
    template,
    product: boundsFromRatio(config.product, canvas),
    safeZone: boundsFromRatio(config.safeZone, canvas),
    headline: boundsFromRatio(config.headline, canvas),
    subheadline: boundsFromRatio(config.subheadline, canvas),
    bulletArea: boundsFromRatio(config.bulletArea, canvas),
    trust: boundsFromRatio(config.trust, canvas),
    cta: boundsFromRatio(config.cta, canvas)
  };
}

function normalizeLayoutTemplate(template: PdpLayoutTemplate | undefined): PdpLayoutTemplate {
  return template && template in LAYOUT_ZONE_MAP ? template : DEFAULT_LAYOUT_TEMPLATE;
}

function boundsFromRatio(bounds: RatioBounds, canvas: PdpLayeredDocumentV2["canvas"]): PdpLayerBounds {
  const x = Math.round(bounds.x * canvas.width);
  const y = Math.round(bounds.y * canvas.height);
  const maxWidth = Math.max(1, canvas.width - x);
  const maxHeight = Math.max(1, canvas.height - y);
  return {
    x,
    y,
    width: Math.max(1, Math.min(maxWidth, Math.round(bounds.width * canvas.width))),
    height: Math.max(1, Math.min(maxHeight, Math.round(bounds.height * canvas.height))),
    unit: "px"
  };
}

function buildBulletBounds(area: PdpLayerBounds, index: number, count: number, template: PdpLayoutTemplate): PdpLayerBounds {
  const safeCount = Math.max(1, count);
  const canUseColumns = safeCount > 1 && (template === "benefit" || template === "proof" || template === "use-case") && area.width >= 320;
  const gap = 10;

  if (canUseColumns) {
    const columns = Math.min(2, safeCount);
    const rows = Math.ceil(safeCount / columns);
    const columnWidth = Math.floor((area.width - gap * (columns - 1)) / columns);
    const rowHeight = Math.max(34, Math.floor((area.height - gap * (rows - 1)) / rows));
    return {
      x: area.x + (index % columns) * (columnWidth + gap),
      y: area.y + Math.floor(index / columns) * (rowHeight + gap),
      width: columnWidth,
      height: rowHeight,
      unit: "px"
    };
  }

  const rowHeight = Math.max(34, Math.floor((area.height - gap * (safeCount - 1)) / safeCount));
  return {
    x: area.x,
    y: area.y + index * (rowHeight + gap),
    width: area.width,
    height: rowHeight,
    unit: "px"
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
