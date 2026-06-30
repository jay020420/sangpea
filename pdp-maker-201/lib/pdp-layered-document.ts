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
import { getPdpCanvasHeight, PDP_EDITOR_CANVAS_WIDTH } from "./pdp-canvas-geometry";

type RatioBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutZoneConfig = {
  product: RatioBounds;
  headline: RatioBounds;
  subheadline: RatioBounds;
  bulletArea: RatioBounds;
  trust: RatioBounds;
  cta: RatioBounds;
};

type SectionLayerZones = {
  template: PdpLayoutTemplate;
  product: PdpLayerBounds;
  headline: PdpLayerBounds;
  subheadline: PdpLayerBounds;
  bulletArea: PdpLayerBounds;
  trust: PdpLayerBounds;
  cta: PdpLayerBounds;
};

type TemplatePalette = {
  background: string;
  panel: string;
  elevatedPanel: string;
  accent: string;
  heading: string;
  body: string;
  muted: string;
};

const DEFAULT_LAYOUT_TEMPLATE: PdpLayoutTemplate = "benefit";

const LAYOUT_ZONE_MAP: Record<PdpLayoutTemplate, LayoutZoneConfig> = {
  hero: {
    headline: { x: 0.08, y: 0.06, width: 0.84, height: 0.11 },
    subheadline: { x: 0.08, y: 0.18, width: 0.84, height: 0.09 },
    product: { x: 0.14, y: 0.29, width: 0.72, height: 0.3 },
    bulletArea: { x: 0.08, y: 0.64, width: 0.84, height: 0.14 },
    trust: { x: 0.08, y: 0.79, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 }
  },
  problem: {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.11 },
    subheadline: { x: 0.08, y: 0.17, width: 0.84, height: 0.09 },
    product: { x: 0.12, y: 0.31, width: 0.76, height: 0.24 },
    bulletArea: { x: 0.08, y: 0.58, width: 0.84, height: 0.16 },
    trust: { x: 0.08, y: 0.76, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 }
  },
  benefit: {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.16, width: 0.84, height: 0.08 },
    product: { x: 0.13, y: 0.25, width: 0.74, height: 0.27 },
    bulletArea: { x: 0.08, y: 0.56, width: 0.84, height: 0.18 },
    trust: { x: 0.08, y: 0.76, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 }
  },
  proof: {
    headline: { x: 0.08, y: 0.04, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.15, width: 0.84, height: 0.08 },
    product: { x: 0.14, y: 0.28, width: 0.72, height: 0.22 },
    bulletArea: { x: 0.08, y: 0.53, width: 0.84, height: 0.18 },
    trust: { x: 0.08, y: 0.73, width: 0.84, height: 0.09 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 }
  },
  spec: {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.15, width: 0.84, height: 0.08 },
    product: { x: 0.12, y: 0.22, width: 0.76, height: 0.26 },
    bulletArea: { x: 0.08, y: 0.51, width: 0.84, height: 0.22 },
    trust: { x: 0.08, y: 0.75, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 }
  },
  demo: {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.15, width: 0.84, height: 0.08 },
    product: { x: 0.1, y: 0.24, width: 0.8, height: 0.27 },
    bulletArea: { x: 0.08, y: 0.55, width: 0.84, height: 0.2 },
    trust: { x: 0.08, y: 0.77, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 }
  },
  "use-case": {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.15, width: 0.84, height: 0.08 },
    product: { x: 0.12, y: 0.25, width: 0.76, height: 0.25 },
    bulletArea: { x: 0.08, y: 0.53, width: 0.84, height: 0.2 },
    trust: { x: 0.08, y: 0.76, width: 0.84, height: 0.07 },
    cta: { x: 0.24, y: 0.89, width: 0.52, height: 0.06 }
  },
  "faq-cta": {
    headline: { x: 0.08, y: 0.05, width: 0.84, height: 0.1 },
    subheadline: { x: 0.08, y: 0.16, width: 0.84, height: 0.08 },
    product: { x: 0.16, y: 0.27, width: 0.68, height: 0.2 },
    bulletArea: { x: 0.08, y: 0.5, width: 0.84, height: 0.18 },
    trust: { x: 0.08, y: 0.7, width: 0.84, height: 0.08 },
    cta: { x: 0.18, y: 0.84, width: 0.64, height: 0.07 }
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
    width: PDP_EDITOR_CANVAS_WIDTH,
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
        name: `${section.section_id || `S${index + 1}`} generated visual asset`,
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
  return getPdpCanvasHeight(aspectRatio);
}

export function generatedAssetId(sectionId: string) {
  return `${sectionId || "section"}-generated-visual-asset`;
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
  const children: PdpLayerNode[] = buildTemplateStructureNodes(section, canvas);

  if (section.generatedImage) {
    children.push(buildGeneratedVisualAssetNode(section, canvas, 6));
  }

  if (!section.generatedImage && hasProductSourceAsset) {
    children.push(buildProductPlacementNode(section, canvas, 6));
  }
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
    templateId: section.design_template_id,
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

export function buildGeneratedVisualAssetNode(section: SectionBlueprint, canvas: PdpLayeredDocumentV2["canvas"], zIndex: number): PdpLayerNode {
  const sectionId = section.section_id || "section";
  const zones = getSectionLayerZones(section, canvas);
  return {
    id: `${sectionId}-generated-visual-asset`,
    name: "Generated visual asset",
    type: "image",
    visible: true,
    locked: false,
    editable: false,
    role: "visual-asset",
    zIndex,
    bounds: zones.product,
    assetId: generatedAssetId(sectionId),
    imageFit: "cover"
  };
}

export function buildTemplateStructureNodes(section: SectionBlueprint, canvas: PdpLayeredDocumentV2["canvas"]): PdpLayerNode[] {
  const sectionId = section.section_id || "section";
  const zones = getSectionLayerZones(section, canvas);
  const palette = getTemplatePalette(zones.template);
  const bulletCopies = section.bullets.map((bullet) => bullet.trim()).filter(Boolean).slice(0, 3);
  const nodes: PdpLayerNode[] = [
    shapeNode(`${sectionId}-document-background`, "Document background", "section-background", fullBounds(canvas), 0, palette.background, 1, 0, {
      locked: true,
      editable: false
    }),
    shapeNode(`${sectionId}-visual-asset-frame`, "Visual asset frame", "visual-frame", expandBounds(zones.product, canvas, 12), 1, palette.elevatedPanel, 0.74, 22, {
      locked: true,
      editable: false
    })
  ];

  for (const [index, _bullet] of bulletCopies.entries()) {
    nodes.push(
      shapeNode(
        `${sectionId}-copy-card-${index + 1}`,
        `Editable copy card ${index + 1}`,
        "copy-card",
        buildBulletBounds(zones.bulletArea, index, bulletCopies.length, zones.template),
        4 + index,
        palette.panel,
        zones.template === "hero" || zones.template === "demo" ? 0.62 : 0.9,
        14,
        {
          locked: true,
          editable: false
        }
      )
    );
  }

  if (section.trust_or_objection_line) {
    nodes.push(
      shapeNode(`${sectionId}-trust-surface`, "Trust copy surface", "proof-surface", zones.trust, 8, palette.panel, 0.82, 14, {
        locked: true,
        editable: false
      })
    );
  }

  return nodes;
}

function buildTextPlanningNodes(section: SectionBlueprint, canvas: PdpLayeredDocumentV2["canvas"]): PdpLayerNode[] {
  const textStyle = defaultTextStyles()[0];
  const sectionId = section.section_id || "section";
  const zones = getSectionLayerZones(section, canvas);
  const palette = getTemplatePalette(zones.template);
  const nodes: PdpLayerNode[] = [];
  if (section.headline) {
    nodes.push(
      textNode(
        `${sectionId}-planned-headline`,
        "Planned headline",
        "headline",
        section.headline,
        zones.headline,
        { ...textStyle, color: palette.heading },
        10
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
        { ...textStyle, fontSize: 18, fontWeight: "500", color: palette.muted },
        11
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
        { ...textStyle, fontSize: 16, fontWeight: "700", lineHeight: 1.24, color: palette.body },
        12 + index
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
        { ...textStyle, fontSize: 15, fontWeight: "700", lineHeight: 1.22, color: palette.body },
        16,
        {
          type: "proof"
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
      fills: [{ color: palette.accent, opacity: 1 }],
      cornerRadius: 22
    });
  }
  return nodes;
}

function shapeNode(
  id: string,
  name: string,
  role: string,
  bounds: PdpLayerBounds,
  zIndex: number,
  color: string,
  opacity: number,
  cornerRadius: number,
  overrides: Partial<Pick<PdpLayerNode, "locked" | "editable">> = {}
): PdpLayerNode {
  return {
    id,
    name,
    type: "shape",
    visible: true,
    locked: overrides.locked ?? false,
    editable: overrides.editable ?? true,
    role,
    zIndex,
    bounds,
    fills: [{ color, opacity }],
    cornerRadius
  };
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

function expandBounds(bounds: PdpLayerBounds, canvas: PdpLayeredDocumentV2["canvas"], amount: number): PdpLayerBounds {
  const x = Math.max(0, bounds.x - amount);
  const y = Math.max(0, bounds.y - amount);
  const right = Math.min(canvas.width, bounds.x + bounds.width + amount);
  const bottom = Math.min(canvas.height, bounds.y + bounds.height + amount);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
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

function getTemplatePalette(template: PdpLayoutTemplate): TemplatePalette {
  switch (template) {
    case "hero":
      return {
        background: "#07131d",
        panel: "#102532",
        elevatedPanel: "#0e2231",
        accent: "#2f8f86",
        heading: "#ffffff",
        body: "#f6fbff",
        muted: "#d8e6ea"
      };
    case "problem":
      return {
        background: "#f3f0e8",
        panel: "#ffffff",
        elevatedPanel: "#e6edf0",
        accent: "#c8474d",
        heading: "#17202a",
        body: "#21343f",
        muted: "#53646c"
      };
    case "proof":
    case "spec":
      return {
        background: "#f6f1e7",
        panel: "#fffaf0",
        elevatedPanel: "#ebe2d1",
        accent: "#425f70",
        heading: "#1b2830",
        body: "#263840",
        muted: "#5c6d74"
      };
    case "demo":
      return {
        background: "#08131c",
        panel: "#12283a",
        elevatedPanel: "#0f2130",
        accent: "#4cb7aa",
        heading: "#ffffff",
        body: "#eef8f7",
        muted: "#c8dbe0"
      };
    case "use-case":
      return {
        background: "#eef4f2",
        panel: "#ffffff",
        elevatedPanel: "#dce8e5",
        accent: "#2f8f86",
        heading: "#102532",
        body: "#1f3a43",
        muted: "#536a70"
      };
    case "faq-cta":
      return {
        background: "#f7f1e8",
        panel: "#ffffff",
        elevatedPanel: "#eadfcc",
        accent: "#102532",
        heading: "#16242c",
        body: "#263840",
        muted: "#5c6b70"
      };
    case "benefit":
    default:
      return {
        background: "#eef4f2",
        panel: "#ffffff",
        elevatedPanel: "#dce7e5",
        accent: "#2f8f86",
        heading: "#102532",
        body: "#1f3a43",
        muted: "#536a70"
      };
  }
}

function mergeColors(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right].filter(Boolean))).slice(0, 40);
}
