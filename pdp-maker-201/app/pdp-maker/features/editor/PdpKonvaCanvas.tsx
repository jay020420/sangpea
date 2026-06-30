"use client";

import type { CSSProperties, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text, Transformer } from "react-konva";
import type { PdpLayerBounds, PdpLayerNode, PdpLayeredDocumentV2 } from "@runacademy/shared";
import type { CanvasLayer, ShapeLayer, TextOverlay } from "../../pdp-drafts";
import {
  findTopCanvasLayerAtPoint,
  isShapeLayer,
  isTextLayer,
  MIN_LAYER_SIZE,
  MIN_TEXT_SIZE,
  toNumericSize
} from "./canvas-layer-geometry";

interface PdpKonvaCanvasProps {
  imageSrc?: string;
  imageAlt: string;
  layers: CanvasLayer[];
  layeredDocument?: PdpLayeredDocumentV2;
  sectionId?: string;
  sectionIndex?: number;
  selectedLayerId: string | null;
  editingLayerId: string | null;
  canvasWidth: number;
  fallbackCanvasHeight: number;
  backgroundFill?: string;
  onSelectLayer: (layerId: string | null) => void;
  onStartTextEdit: (layerId: string) => void;
  onStopTextEdit: () => void;
  onChangeLayer: (layerId: string, updates: Partial<CanvasLayer>) => void;
  onChangeText: (layerId: string, text: string) => void;
}

export const PdpKonvaCanvas = forwardRef<HTMLDivElement, PdpKonvaCanvasProps>(function PdpKonvaCanvas(
  {
    imageSrc,
    imageAlt,
    layers,
    layeredDocument,
    sectionId,
    sectionIndex,
    selectedLayerId,
    editingLayerId,
    canvasWidth,
    fallbackCanvasHeight,
    backgroundFill = "#f6f2ea",
    onSelectLayer,
    onStartTextEdit,
    onStopTextEdit,
    onChangeLayer,
    onChangeText
  },
  ref
) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerNodeRefs = useRef<Record<string, Konva.Node | null>>({});
  const sortedLayers = useMemo(
    () => layers.filter((layer) => isShapeLayer(layer) || isTextLayer(layer)),
    [layers]
  );
  const shapeLayers = useMemo(() => sortedLayers.filter(isShapeLayer), [sortedLayers]);
  const textLayers = useMemo(() => sortedLayers.filter(isTextLayer), [sortedLayers]);
  const selectedLayer = sortedLayers.find((layer) => layer.id === selectedLayerId) ?? null;
  const editingTextLayer =
    selectedLayer && isTextLayer(selectedLayer) && selectedLayer.id === editingLayerId ? selectedLayer : null;
  const hasGeneratedVisualAsset = useMemo(
    () =>
      hasDocumentGeneratedVisualAsset({
        document: layeredDocument,
        sectionId,
        sectionIndex
      }),
    [layeredDocument, sectionId, sectionIndex]
  );
  const shouldDrawFullCanvasImage = Boolean(imageSrc && !hasGeneratedVisualAsset);
  const canvasHeight = useMemo(() => {
    if (!shouldDrawFullCanvasImage || !image?.naturalWidth || !image.naturalHeight) return fallbackCanvasHeight;
    return Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * canvasWidth));
  }, [canvasWidth, fallbackCanvasHeight, image?.naturalHeight, image?.naturalWidth, shouldDrawFullCanvasImage]);
  const documentShapeLayers = useMemo(
    () =>
      getDocumentShapeLayers({
        document: layeredDocument,
        sectionId,
        sectionIndex,
        canvasWidth,
        canvasHeight
      }),
    [canvasHeight, canvasWidth, layeredDocument, sectionId, sectionIndex]
  );
  const documentImageLayers = useMemo(
    () =>
      getDocumentImageLayers({
        document: layeredDocument,
        sectionId,
        sectionIndex,
        canvasWidth,
        canvasHeight,
        skipGeneratedBackground: shouldDrawFullCanvasImage
      }),
    [canvasHeight, canvasWidth, layeredDocument, sectionId, sectionIndex, shouldDrawFullCanvasImage]
  );

  useEffect(() => {
    let isCancelled = false;

    if (!imageSrc) {
      setImage(null);
      return () => {
        isCancelled = true;
      };
    }

    const nextImage = new window.Image();
    nextImage.crossOrigin = "anonymous";
    nextImage.onload = () => {
      if (!isCancelled) {
        setImage(nextImage);
      }
    };
    nextImage.onerror = () => {
      if (!isCancelled) {
        setImage(null);
      }
    };
    nextImage.src = imageSrc;

    return () => {
      isCancelled = true;
    };
  }, [imageSrc]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    const node = selectedLayerId ? layerNodeRefs.current[selectedLayerId] : null;
    if (node) {
      transformer.nodes([node]);
      transformer.getLayer()?.batchDraw();
    } else {
      transformer.nodes([]);
    }
  }, [selectedLayerId, sortedLayers]);

  const getLayerAtClientPoint = (clientX: number, clientY: number, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return findTopCanvasLayerAtPoint(sortedLayers, x, y);
  };

  const handleCanvasMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLTextAreaElement) return;

    const targetLayer = getLayerAtClientPoint(event.clientX, event.clientY, event.currentTarget);
    if (targetLayer) {
      onSelectLayer(targetLayer.id);
      return;
    }

    onSelectLayer(null);
    onStopTextEdit();
  };

  const handleCanvasDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLTextAreaElement) return;

    const targetLayer = getLayerAtClientPoint(event.clientX, event.clientY, event.currentTarget);
    if (!targetLayer) return;

    onSelectLayer(targetLayer.id);
    if (isTextLayer(targetLayer)) {
      onStartTextEdit(targetLayer.id);
    }
  };

  const handleCanvasTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLTextAreaElement) return;

    const touch = event.touches[0];
    if (!touch) return;

    const targetLayer = getLayerAtClientPoint(touch.clientX, touch.clientY, event.currentTarget);
    if (targetLayer) {
      onSelectLayer(targetLayer.id);
      return;
    }

    onSelectLayer(null);
    onStopTextEdit();
  };

  const stopCanvasClickPropagation = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      aria-label={imageAlt}
      onClick={stopCanvasClickPropagation}
      onDoubleClick={handleCanvasDoubleClick}
      onMouseDown={handleCanvasMouseDown}
      onTouchStart={handleCanvasTouchStart}
      ref={ref}
      style={{
        position: "relative",
        width: canvasWidth,
        height: canvasHeight
      }}
    >
      <Stage
        height={canvasHeight}
        width={canvasWidth}
      >
        <Layer>
          {shouldDrawFullCanvasImage && image ? (
            <KonvaImage
              height={canvasHeight}
              image={image}
              listening
              name="background-image"
              width={canvasWidth}
              x={0}
              y={0}
            />
          ) : (
            <Rect fill={backgroundFill} height={canvasHeight} name="template-background" width={canvasWidth} />
          )}

          {documentShapeLayers.map((documentLayer) => (
            <DocumentShapeNode key={documentLayer.id} layer={documentLayer} />
          ))}

          {shapeLayers.map((layer) => (
            <EditableShape
              canvasHeight={canvasHeight}
              canvasWidth={canvasWidth}
              key={layer.id}
              layer={layer}
              onChangeLayer={onChangeLayer}
              onSelectLayer={onSelectLayer}
              ref={(node) => {
                layerNodeRefs.current[layer.id] = node;
              }}
              selected={selectedLayerId === layer.id}
            />
          ))}

          {documentImageLayers.map((documentLayer) => (
            <DocumentImageNode key={documentLayer.id} layer={documentLayer} />
          ))}

          {textLayers.map((layer) => (
            <EditableText
              canvasHeight={canvasHeight}
              canvasWidth={canvasWidth}
              editing={editingLayerId === layer.id}
              key={layer.id}
              layer={layer}
              onChangeLayer={onChangeLayer}
              onSelectLayer={onSelectLayer}
              onStartTextEdit={onStartTextEdit}
              ref={(node) => {
                layerNodeRefs.current[layer.id] = node;
              }}
              selected={selectedLayerId === layer.id}
            />
          ))}

          <Transformer
            anchorFill="#62e9c5"
            anchorSize={8}
            borderDash={[6, 4]}
            borderStroke="#62e9c5"
            boundBoxFunc={(oldBox, newBox) => {
              if (Math.abs(newBox.width) < MIN_LAYER_SIZE || Math.abs(newBox.height) < MIN_LAYER_SIZE) {
                return oldBox;
              }
              return newBox;
            }}
            enabledAnchors={[
              "top-left",
              "top-center",
              "top-right",
              "middle-left",
              "middle-right",
              "bottom-left",
              "bottom-center",
              "bottom-right"
            ]}
            flipEnabled={false}
            ref={transformerRef}
            rotateEnabled={false}
          />
        </Layer>
      </Stage>

      {editingTextLayer ? (
        <textarea
          autoFocus
          onBlur={onStopTextEdit}
          onChange={(event) => onChangeText(editingTextLayer.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onStopTextEdit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onStopTextEdit();
            }
          }}
          style={buildTextareaStyle(editingTextLayer)}
          value={editingTextLayer.text}
        />
      ) : null}
    </div>
  );
});

type DocumentImageRenderLayer = {
  id: string;
  name: string;
  src: string;
  fit: NonNullable<PdpLayerNode["imageFit"]>;
  opacity: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type DocumentShapeRenderLayer = {
  id: string;
  fill: string;
  opacity: number;
  cornerRadius: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

function DocumentShapeNode({ layer }: { layer: DocumentShapeRenderLayer }) {
  return (
    <Rect
      cornerRadius={layer.cornerRadius}
      fill={layer.fill}
      height={layer.bounds.height}
      listening={false}
      opacity={layer.opacity}
      width={layer.bounds.width}
      x={layer.bounds.x}
      y={layer.bounds.y}
    />
  );
}

function DocumentImageNode({ layer }: { layer: DocumentImageRenderLayer }) {
  const image = useLoadedImage(layer.src);
  const geometry = useMemo(() => getImageRenderGeometry(image, layer.bounds, layer.fit), [image, layer.bounds, layer.fit]);

  if (!image || !geometry) {
    return (
      <Rect
        cornerRadius={layer.fit === "contain" ? 18 : 0}
        fill="rgba(255, 255, 255, 0.42)"
        height={layer.bounds.height}
        listening={false}
        opacity={Math.min(0.72, layer.opacity)}
        stroke="rgba(16, 37, 50, 0.12)"
        strokeWidth={1}
        width={layer.bounds.width}
        x={layer.bounds.x}
        y={layer.bounds.y}
      />
    );
  }

  return (
    <KonvaImage
      cropHeight={geometry.crop?.height}
      cropWidth={geometry.crop?.width}
      cropX={geometry.crop?.x}
      cropY={geometry.crop?.y}
      height={geometry.height}
      image={image}
      listening={false}
      name={layer.name}
      opacity={layer.opacity}
      width={geometry.width}
      x={geometry.x}
      y={geometry.y}
    />
  );
}

function useLoadedImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    let isCancelled = false;
    if (!src) {
      setImage(null);
      return () => {
        isCancelled = true;
      };
    }

    const nextImage = new window.Image();
    nextImage.crossOrigin = "anonymous";
    nextImage.onload = () => {
      if (!isCancelled) setImage(nextImage);
    };
    nextImage.onerror = () => {
      if (!isCancelled) setImage(null);
    };
    nextImage.src = src;

    return () => {
      isCancelled = true;
    };
  }, [src]);

  return image;
}

function hasDocumentGeneratedVisualAsset(input: {
  document?: PdpLayeredDocumentV2;
  sectionId?: string;
  sectionIndex?: number;
}) {
  const section = resolveDocumentSection(input);
  if (!section) return false;
  return section.nodes
    .flatMap(flattenLayerNode)
    .some((node) => node.visible && (node.type === "image" || node.type === "product") && node.role === "visual-asset");
}

function getDocumentShapeLayers(input: {
  document?: PdpLayeredDocumentV2;
  sectionId?: string;
  sectionIndex?: number;
  canvasWidth: number;
  canvasHeight: number;
}): DocumentShapeRenderLayer[] {
  const document = input.document;
  const section = resolveDocumentSection(input);
  if (!document || !section) return [];

  return section.nodes
    .flatMap(flattenLayerNode)
    .filter((node) => node.visible && node.type === "shape" && (!node.editable || node.locked))
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((node) => {
      const fill = node.fills?.find((candidate) => candidate.color);
      if (!fill?.color) return null;
      return {
        id: node.id,
        fill: fill.color,
        opacity: fill.opacity ?? node.opacity ?? 1,
        cornerRadius: node.cornerRadius ?? 0,
        bounds: boundsToCanvasPixels(node.bounds, document.canvas, input.canvasWidth, input.canvasHeight)
      } satisfies DocumentShapeRenderLayer;
    })
    .filter((layer): layer is DocumentShapeRenderLayer => Boolean(layer));
}

function getDocumentImageLayers(input: {
  document?: PdpLayeredDocumentV2;
  sectionId?: string;
  sectionIndex?: number;
  canvasWidth: number;
  canvasHeight: number;
  skipGeneratedBackground: boolean;
}): DocumentImageRenderLayer[] {
  const document = input.document;
  const section = resolveDocumentSection(input);
  if (!document || !section) return [];

  const assetById = new Map(document.assets.images.map((asset) => [asset.id, asset]));
  return section.nodes
    .flatMap(flattenLayerNode)
    .filter((node) => node.visible && (node.type === "image" || node.type === "product"))
    .filter((node) => !(input.skipGeneratedBackground && node.role === "background"))
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((node) => {
      const asset = node.assetId ? assetById.get(node.assetId) : null;
      if (!asset?.dataUrl) return null;
      return {
        id: node.id,
        name: node.name,
        src: asset.dataUrl,
        fit: node.imageFit ?? (node.role === "background" ? "cover" : "contain"),
        opacity: node.opacity ?? 1,
        bounds: boundsToCanvasPixels(node.bounds, document.canvas, input.canvasWidth, input.canvasHeight)
      } satisfies DocumentImageRenderLayer;
    })
    .filter((layer): layer is DocumentImageRenderLayer => Boolean(layer));
}

function resolveDocumentSection(input: {
  document?: PdpLayeredDocumentV2;
  sectionId?: string;
  sectionIndex?: number;
}) {
  const document = input.document;
  if (!document?.sections.length) return null;
  return (
    (input.sectionId ? document.sections.find((candidate) => candidate.sectionId === input.sectionId) : null) ??
    document.sections[input.sectionIndex ?? 0] ??
    null
  );
}

function flattenLayerNode(node: PdpLayerNode): PdpLayerNode[] {
  return [node, ...(node.children ?? []).flatMap(flattenLayerNode)];
}

function boundsToCanvasPixels(
  bounds: PdpLayerBounds,
  sourceCanvas: PdpLayeredDocumentV2["canvas"],
  canvasWidth: number,
  canvasHeight: number
) {
  if (bounds.unit === "percent") {
    return {
      x: Math.round((bounds.x / 100) * canvasWidth),
      y: Math.round((bounds.y / 100) * canvasHeight),
      width: Math.round((bounds.width / 100) * canvasWidth),
      height: Math.round((bounds.height / 100) * canvasHeight)
    };
  }

  const scaleX = canvasWidth / Math.max(1, sourceCanvas.width);
  const scaleY = canvasHeight / Math.max(1, sourceCanvas.height);
  return {
    x: Math.round(bounds.x * scaleX),
    y: Math.round(bounds.y * scaleY),
    width: Math.max(1, Math.round(bounds.width * scaleX)),
    height: Math.max(1, Math.round(bounds.height * scaleY))
  };
}

function getImageRenderGeometry(
  image: HTMLImageElement | null,
  bounds: DocumentImageRenderLayer["bounds"],
  fit: NonNullable<PdpLayerNode["imageFit"]> = "cover"
) {
  if (!image?.naturalWidth || !image.naturalHeight) return null;
  if (fit === "fill") {
    return {
      ...bounds,
      crop: undefined
    };
  }

  const imageRatio = image.naturalWidth / image.naturalHeight;
  const boundsRatio = bounds.width / bounds.height;

  if (fit === "contain") {
    const width = imageRatio > boundsRatio ? bounds.width : Math.round(bounds.height * imageRatio);
    const height = imageRatio > boundsRatio ? Math.round(bounds.width / imageRatio) : bounds.height;
    return {
      x: bounds.x + Math.round((bounds.width - width) / 2),
      y: bounds.y + Math.round((bounds.height - height) / 2),
      width,
      height,
      crop: undefined
    };
  }

  const cropWidth = imageRatio > boundsRatio ? Math.round(image.naturalHeight * boundsRatio) : image.naturalWidth;
  const cropHeight = imageRatio > boundsRatio ? image.naturalHeight : Math.round(image.naturalWidth / boundsRatio);
  return {
    ...bounds,
    crop: {
      x: Math.max(0, Math.round((image.naturalWidth - cropWidth) / 2)),
      y: Math.max(0, Math.round((image.naturalHeight - cropHeight) / 2)),
      width: cropWidth,
      height: cropHeight
    }
  };
}

const EditableShape = forwardRef<Konva.Rect, {
  canvasHeight: number;
  canvasWidth: number;
  layer: ShapeLayer;
  selected: boolean;
  onSelectLayer: (layerId: string) => void;
  onChangeLayer: (layerId: string, updates: Partial<CanvasLayer>) => void;
}>(function EditableShape({ canvasHeight, canvasWidth, layer, selected, onSelectLayer, onChangeLayer }, ref) {
  const width = toNumericSize(layer.width, 260);
  const height = toNumericSize(layer.height, 120);

  return (
    <Rect
      cornerRadius={layer.borderRadius}
      draggable
      dragBoundFunc={(position) => clampLayerPosition(position, width, height, canvasWidth, canvasHeight)}
      fill={layer.fillColor}
      height={height}
      opacity={layer.fillOpacity}
      onClick={(event) => {
        event.cancelBubble = true;
        onSelectLayer(layer.id);
      }}
      onDragEnd={(event) => {
        onChangeLayer(layer.id, {
          x: Math.round(event.target.x()),
          y: Math.round(event.target.y())
        });
      }}
      onTap={(event) => {
        event.cancelBubble = true;
        onSelectLayer(layer.id);
      }}
      onTransformEnd={(event) => {
        const node = event.target;
        const nextWidth = Math.max(MIN_LAYER_SIZE, Math.round(width * node.scaleX()));
        const nextHeight = Math.max(MIN_LAYER_SIZE, Math.round(height * node.scaleY()));
        node.scaleX(1);
        node.scaleY(1);
        onChangeLayer(layer.id, clampLayerBounds({
          x: Math.round(node.x()),
          y: Math.round(node.y()),
          width: nextWidth,
          height: nextHeight
        }, canvasWidth, canvasHeight));
      }}
      ref={ref}
      shadowBlur={selected ? 18 : 0}
      shadowColor="rgba(0,0,0,0.32)"
      shadowOpacity={selected ? 0.5 : 0}
      width={width}
      x={layer.x}
      y={layer.y}
    />
  );
});

const EditableText = forwardRef<Konva.Group, {
  canvasHeight: number;
  canvasWidth: number;
  editing: boolean;
  layer: TextOverlay;
  selected: boolean;
  onSelectLayer: (layerId: string) => void;
  onStartTextEdit: (layerId: string) => void;
  onChangeLayer: (layerId: string, updates: Partial<CanvasLayer>) => void;
}>(function EditableText(
  { canvasHeight, canvasWidth, editing, layer, selected, onSelectLayer, onStartTextEdit, onChangeLayer },
  ref
) {
  const width = toNumericSize(layer.width, 320);
  const height = toNumericSize(layer.height, 96);
  const padding = getOverlayPadding(layer.fontSize);
  const fontFamily = normalizeFontFamily(layer.fontFamily);

  return (
    <Group
      draggable={!editing}
      dragBoundFunc={(position) => clampLayerPosition(position, width, height, canvasWidth, canvasHeight)}
      height={height}
      onClick={(event) => {
        event.cancelBubble = true;
        onSelectLayer(layer.id);
      }}
      onDblClick={(event) => {
        event.cancelBubble = true;
        onSelectLayer(layer.id);
        onStartTextEdit(layer.id);
      }}
      onDblTap={(event) => {
        event.cancelBubble = true;
        onSelectLayer(layer.id);
        onStartTextEdit(layer.id);
      }}
      onDragEnd={(event) => {
        onChangeLayer(layer.id, {
          x: Math.round(event.target.x()),
          y: Math.round(event.target.y())
        });
      }}
      onTap={(event) => {
        event.cancelBubble = true;
        onSelectLayer(layer.id);
      }}
      onTransformEnd={(event) => {
        const node = event.target;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const nextWidth = Math.max(MIN_TEXT_SIZE, Math.round(width * scaleX));
        const nextHeight = Math.max(MIN_TEXT_SIZE, Math.round(height * scaleY));
        const fontScale = Math.max(Math.abs(scaleX), Math.abs(scaleY));
        node.scaleX(1);
        node.scaleY(1);
        onChangeLayer(layer.id, {
          ...clampLayerBounds({
            x: Math.round(node.x()),
            y: Math.round(node.y()),
            width: nextWidth,
            height: nextHeight
          }, canvasWidth, canvasHeight),
          fontSize: clampValue(Math.round(layer.fontSize * fontScale), 10, 180)
        });
      }}
      ref={ref}
      width={width}
      x={layer.x}
      y={layer.y}
    >
      <Rect
        fill="rgba(255, 255, 255, 0.001)"
        height={height}
        width={width}
      />
      {layer.backgroundEnabled ? (
        <Rect
          cornerRadius={layer.backgroundRadius}
          fill={layer.backgroundColor}
          height={height}
          opacity={layer.backgroundOpacity}
          width={width}
        />
      ) : null}
      <Text
        align={layer.textAlign}
        fill={layer.color}
        fontFamily={fontFamily}
        fontSize={layer.fontSize}
        fontStyle={fontWeightToKonvaStyle(layer.fontWeight)}
        height={Math.max(1, height - padding.vertical * 2)}
        lineHeight={layer.lineHeight}
        listening={false}
        opacity={editing ? 0.32 : 1}
        padding={0}
        shadowBlur={layer.shadowEnabled ? layer.shadowBlur : 0}
        shadowColor={layer.shadowColor}
        shadowOffsetY={layer.shadowEnabled ? layer.shadowOffsetY : 0}
        shadowOpacity={layer.shadowEnabled ? layer.shadowOpacity : 0}
        text={layer.text}
        verticalAlign="middle"
        width={Math.max(1, width - padding.horizontal * 2)}
        wrap="word"
        x={padding.horizontal}
        y={padding.vertical}
      />
      {selected ? (
        <Rect
          cornerRadius={Math.max(10, layer.backgroundRadius)}
          dash={[6, 4]}
          height={height}
          listening={false}
          stroke="#62e9c5"
          strokeWidth={1.5}
          width={width}
        />
      ) : null}
    </Group>
  );
});

function buildTextareaStyle(layer: TextOverlay): CSSProperties {
  const padding = getOverlayPadding(layer.fontSize);
  const width = toNumericSize(layer.width, 320);
  const height = toNumericSize(layer.height, 96);

  return {
    position: "absolute",
    left: layer.x,
    top: layer.y,
    width,
    height,
    boxSizing: "border-box",
    border: "1.5px solid rgba(98, 233, 197, 0.95)",
    borderRadius: layer.backgroundEnabled ? layer.backgroundRadius : 12,
    padding: `${padding.vertical}px ${padding.horizontal}px`,
    resize: "none",
    outline: "none",
    overflow: "hidden",
    background: layer.backgroundEnabled ? toRgba(layer.backgroundColor, Math.max(layer.backgroundOpacity, 0.88)) : "rgba(255, 255, 255, 0.94)",
    color: layer.color,
    fontFamily: layer.fontFamily,
    fontSize: layer.fontSize,
    fontWeight: layer.fontWeight,
    lineHeight: layer.lineHeight,
    textAlign: layer.textAlign,
    boxShadow: "0 0 0 9999px rgba(6, 14, 20, 0.08), 0 20px 44px rgba(0, 0, 0, 0.28)",
    zIndex: 3
  };
}

function clampLayerPosition(
  position: { x: number; y: number },
  width: number,
  height: number,
  canvasWidth: number,
  canvasHeight: number
) {
  return {
    x: clampValue(Math.round(position.x), 0, Math.max(0, canvasWidth - width)),
    y: clampValue(Math.round(position.y), 0, Math.max(0, canvasHeight - height))
  };
}

function clampLayerBounds(
  bounds: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number
) {
  const width = clampValue(bounds.width, MIN_LAYER_SIZE, canvasWidth);
  const height = clampValue(bounds.height, MIN_LAYER_SIZE, canvasHeight);
  return {
    width,
    height,
    x: clampValue(bounds.x, 0, Math.max(0, canvasWidth - width)),
    y: clampValue(bounds.y, 0, Math.max(0, canvasHeight - height))
  };
}

function getOverlayPadding(fontSize: number) {
  return {
    horizontal: Math.max(10, Math.round(fontSize * 0.32)),
    vertical: Math.max(8, Math.round(fontSize * 0.18))
  };
}

function fontWeightToKonvaStyle(fontWeight: string) {
  const numericWeight = Number(fontWeight);
  return Number.isFinite(numericWeight) && numericWeight >= 700 ? "bold" : "normal";
}

function normalizeFontFamily(fontFamily: string) {
  return fontFamily.replace(/['"]/g, "").split(",")[0] || "Pretendard";
}

function toRgba(hex: string, opacity: number) {
  const normalized = hex.trim();
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
    return normalized;
  }

  const value = normalized.slice(1);
  const expanded = value.length === 3 ? value.split("").map((char) => `${char}${char}`).join("") : value;
  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clampValue(opacity, 0, 1)})`;
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
