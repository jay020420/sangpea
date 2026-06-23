"use client";

import type { DragEvent } from "react";
import type { PreparedReferenceImageDraft } from "../../pdp-drafts";

export function preventFileDragDefault(event: DragEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}

export function filesFromDragEvent(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.files || []);
}

export async function normalizeFilesForUpload(files: File[], limit: number, options: { renderImages?: boolean } = {}) {
  const output: File[] = [];
  for (const file of files) {
    if (output.length >= limit) break;
    const remainingSlots = Math.max(0, limit - output.length);
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      output.push(...(await renderPdfToImages(file, remainingSlots)));
    } else if (file.type.startsWith("image/")) {
      if (options.renderImages) {
        output.push(...(await renderImageToReferenceFiles(file, remainingSlots)));
      } else {
        output.push(file);
      }
    }
  }
  return output.slice(0, limit);
}

export function ensurePrimaryReferenceImages(images: PreparedReferenceImageDraft[]) {
  if (!images.length) return images;
  if (images.some((image) => image.role === "primary")) return images;
  return images.map((image, index) => (index === 0 ? { ...image, role: "primary" as const } : image));
}

export async function extractKnowledgeText(file: File) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return extractPdfText(file);
  return file.text();
}

async function renderImageToReferenceFiles(file: File, limit: number) {
  if (limit <= 0) return [];
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(objectUrl);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) throw new Error("업로드 이미지를 읽지 못했습니다.");

    const isLongDetailPage = naturalHeight / naturalWidth > 2.2;
    const sliceCount = isLongDetailPage ? Math.min(limit, Math.ceil(naturalHeight / naturalWidth / 1.8)) : 1;
    const files: File[] = [];

    for (let index = 0; index < sliceCount; index += 1) {
      const sourceY = Math.floor((naturalHeight / sliceCount) * index);
      const sourceHeight = index === sliceCount - 1 ? naturalHeight - sourceY : Math.floor(naturalHeight / sliceCount);
      files.push(
        await cropImageToJpegFile({
          image,
          sourceX: 0,
          sourceY,
          sourceWidth: naturalWidth,
          sourceHeight,
          fileName: file.name,
          index
        })
      );
    }

    return files;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderPdfToImages(file: File, limit: number) {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: File[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, limit); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("PDF 페이지를 이미지로 변환하지 못했습니다."))), "image/jpeg", 0.88);
    });
    pages.push(new File([blob], `${file.name.replace(/\.pdf$/i, "")}-page-${pageNumber}.jpg`, { type: "image/jpeg" }));
  }
  return pages;
}

async function extractPdfText(file: File) {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 80); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    if (text.trim()) pages.push(`[${file.name} p.${pageNumber}] ${text}`);
    if (pages.join("\n").length > 120000) break;
  }
  return pages.join("\n");
}

function configurePdfWorker(pdfjs: typeof import("pdfjs-dist")) {
  const version = "version" in pdfjs && typeof pdfjs.version === "string" ? pdfjs.version : "5.6.205";
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지 파일을 브라우저에서 열 수 없습니다."));
    image.src = src;
  });
}

async function cropImageToJpegFile({
  image,
  sourceX,
  sourceY,
  sourceWidth,
  sourceHeight,
  fileName,
  index
}: {
  image: HTMLImageElement;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  fileName: string;
  index: number;
}) {
  const maxWidth = 1200;
  const maxHeight = 1800;
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("이미지 변환 캔버스를 만들지 못했습니다.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("이미지를 JPEG로 변환하지 못했습니다."));
    }, "image/jpeg", 0.88);
  });

  const safeName = fileName.replace(/\.[^.]+$/i, "");
  return new File([blob], `${safeName}-reference-${index + 1}.jpg`, { type: "image/jpeg" });
}
