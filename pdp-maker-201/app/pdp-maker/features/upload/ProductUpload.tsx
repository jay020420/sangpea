"use client";

import { useState, type RefObject } from "react";
import { FileImage, Trash2, Upload } from "lucide-react";
import type { ReferenceImageRole, ReferenceModelUsage } from "@runacademy/shared";
import type { PreparedImageDraft, PreparedReferenceImageDraft } from "../../pdp-drafts";
import { filesFromDragEvent, preventFileDragDefault } from "./file-input";
import styles from "../../pdp-maker.module.css";

export const MAX_PRODUCT_REFERENCE_UPLOADS = 20;

const REFERENCE_ROLE_OPTIONS: Array<{ value: ReferenceImageRole; label: string; description: string }> = [
  { value: "primary", label: "대표", description: "제품/SW 정체성을 판단하는 기준" },
  { value: "detail", label: "디테일", description: "스펙, 구성, 화면 일부, 사용법" },
  { value: "proof", label: "증빙", description: "후기, 인증, 리뷰, 근거 자료" },
  { value: "reference", label: "참조", description: "톤, 구도, 보조 맥락" }
];

export function ProductUpload({
  inputRef,
  modelInputRef,
  productImages,
  modelImage,
  modelImageUsage,
  onProductFiles,
  onReferenceRoleChange,
  removeProductImage,
  onModelImage,
  onModelImageUsage,
  removeModelImage
}: {
  inputRef: RefObject<HTMLInputElement>;
  modelInputRef: RefObject<HTMLInputElement>;
  productImages: PreparedReferenceImageDraft[];
  modelImage: PreparedImageDraft | null;
  modelImageUsage: ReferenceModelUsage | null;
  onProductFiles: (files: File[]) => void;
  onReferenceRoleChange: (imageId: string, role: ReferenceImageRole) => void;
  removeProductImage: (imageId: string) => void;
  onModelImage: (file: File) => void;
  onModelImageUsage: (usage: ReferenceModelUsage) => void;
  removeModelImage: () => void;
}) {
  const [isProductDragging, setIsProductDragging] = useState(false);
  const [isModelDragging, setIsModelDragging] = useState(false);
  const productDropzoneClass = isProductDragging ? styles.dropzoneActive : styles.dropzone;
  const modelDropzoneClass = `${isModelDragging ? styles.dropzoneActive : styles.dropzone} ${styles.dropzoneCompact}`;

  return (
    <>
      <button
        className={productDropzoneClass}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          preventFileDragDefault(event);
          setIsProductDragging(true);
        }}
        onDragLeave={(event) => {
          preventFileDragDefault(event);
          setIsProductDragging(false);
        }}
        onDragOver={preventFileDragDefault}
        onDrop={(event) => {
          preventFileDragDefault(event);
          setIsProductDragging(false);
          onProductFiles(filesFromDragEvent(event));
        }}
        type="button"
      >
        <span className={styles.dropzoneIcon}>
          <Upload size={24} />
        </span>
        <strong>제품/SW 자료 업로드</strong>
        <p>대표컷, 디테일, 증빙, 앱 화면 또는 PDF를 최대 20개까지 넣습니다.</p>
        <span className={styles.dropzoneHint}>{productImages.length ? `${productImages.length}/${MAX_PRODUCT_REFERENCE_UPLOADS}개 참조 자료 준비됨` : "JPG, PNG, WebP, PDF"}</span>
      </button>
      <input
        accept="image/*,.pdf"
        className={styles.hiddenInput}
        multiple
        onChange={(event) => {
          onProductFiles(Array.from(event.target.files || []));
          event.currentTarget.value = "";
        }}
        ref={inputRef}
        type="file"
      />
      {productImages.length ? (
        <div className={styles.referenceAssetList}>
          {productImages.map((image, index) => (
            <div className={styles.referenceAssetCard} key={image.id}>
              <div className={styles.referenceAssetThumb}>
                <img alt={image.fileName} src={image.previewUrl} />
              </div>
              <div className={styles.referenceAssetMeta}>
                <strong>{image.fileName}</strong>
                <span>{index === 0 ? "첫 번째 참조 이미지" : "추가 참조 이미지"}</span>
                <div className={styles.roleChipGrid}>
                  {REFERENCE_ROLE_OPTIONS.map((role) => (
                    <button
                      className={image.role === role.value ? styles.optionChipActive : styles.optionChip}
                      key={role.value}
                      onClick={() => onReferenceRoleChange(image.id, role.value)}
                      title={role.description}
                      type="button"
                    >
                      {role.label}
                    </button>
                  ))}
                </div>
              </div>
              <button className={styles.inlineDangerButton} onClick={() => removeProductImage(image.id)} type="button">
                <Trash2 size={14} />
                제거
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.optionalUploadBlock}>
        <div className={styles.optionalUploadHeader}>
          <div>
            <span className={styles.panelLabel}>선택 옵션</span>
            <h3 className={styles.optionalUploadTitle}>모델 이미지</h3>
            <p className={styles.optionalUploadDescription}>인물 일관성이 필요할 때만 사용합니다.</p>
          </div>
          {modelImage ? (
            <button className={styles.inlineButton} onClick={removeModelImage} type="button">
              <Trash2 size={14} />
              제거
            </button>
          ) : null}
        </div>
        <button
          className={modelDropzoneClass}
          onClick={() => modelInputRef.current?.click()}
          onDragEnter={(event) => {
            preventFileDragDefault(event);
            setIsModelDragging(true);
          }}
          onDragLeave={(event) => {
            preventFileDragDefault(event);
            setIsModelDragging(false);
          }}
          onDragOver={preventFileDragDefault}
          onDrop={(event) => {
            preventFileDragDefault(event);
            setIsModelDragging(false);
            const [file] = filesFromDragEvent(event);
            if (file) onModelImage(file);
          }}
          type="button"
        >
          <span className={styles.dropzoneIcon}>
            <FileImage size={20} />
          </span>
          <strong>모델 이미지 업로드</strong>
          <span className={styles.dropzoneHint}>{modelImage?.fileName || "선택 사항"}</span>
        </button>
        <input
          accept="image/*"
          className={styles.hiddenInput}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onModelImage(file);
            event.currentTarget.value = "";
          }}
          ref={modelInputRef}
          type="file"
        />
        {modelImage ? <ImagePreview image={modelImage} ratioLabel="참조 모델" /> : null}
        {modelImage ? (
          <div className={styles.modelUsageGrid}>
            <button className={modelImageUsage === "hero-only" ? styles.modelUsageCardActive : styles.modelUsageCard} onClick={() => onModelImageUsage("hero-only")} type="button">
              <strong>히어로만</strong>
              <span>첫 섹션에만 적용</span>
            </button>
            <button className={modelImageUsage === "all-sections" ? styles.modelUsageCardActive : styles.modelUsageCard} onClick={() => onModelImageUsage("all-sections")} type="button">
              <strong>전체 유지</strong>
              <span>같은 인물 유지</span>
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function ImagePreview({ image, ratioLabel }: { image: PreparedImageDraft; ratioLabel: string }) {
  return (
    <div className={styles.uploadPreviewCard}>
      <div className={styles.previewFrame}>
        <img alt={image.fileName} className={styles.selectedImage} src={image.previewUrl} />
      </div>
      <div className={styles.uploadMeta}>
        <strong>{image.fileName}</strong>
        <div className={styles.metaList}>
          <div className={styles.metaItem}>
            <span>유형</span>
            <strong>{ratioLabel}</strong>
          </div>
          <div className={styles.metaItem}>
            <span>포맷</span>
            <strong>JPEG</strong>
          </div>
          <div className={styles.metaItem}>
            <span>전송</span>
            <strong>960px</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
