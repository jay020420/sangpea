"use client";

import FilerobotImageEditor, { TABS, TOOLS } from "react-filerobot-image-editor";
import styles from "../../pdp-maker.module.css";

interface PdpImageAdjusterProps {
  imageSrc: string;
  sectionName: string;
  onApply: (imageDataUrl: string) => void;
  onClose: () => void;
}

interface FilerobotSavedImage {
  imageBase64?: string;
  imageCanvas?: HTMLCanvasElement;
  mimeType?: string;
}

export function PdpImageAdjuster({ imageSrc, sectionName, onApply, onClose }: PdpImageAdjusterProps) {
  const previewPixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

  return (
    <div className={styles.imageEditorOverlay} role="dialog" aria-modal="true" aria-label={`${sectionName} 이미지 보정`}>
      <div className={styles.imageEditorShell}>
        <div className={styles.imageEditorHeader}>
          <div>
            <span className={styles.optionMiniLabel}>Filerobot Image Editor</span>
            <strong>{sectionName} 시각 에셋 보정</strong>
          </div>
          <button className={styles.inlineButton} onClick={onClose} type="button">
            닫기
          </button>
        </div>
        <div className={styles.imageEditorBody}>
          <FilerobotImageEditor
            source={imageSrc}
            onBeforeSave={() => false}
            onSave={(savedImageData: FilerobotSavedImage) => {
              const dataUrl = getSavedImageDataUrl(savedImageData);
              if (dataUrl) {
                onApply(dataUrl);
              }
            }}
            onClose={onClose}
            annotationsCommon={{
              fill: "#102532",
              stroke: "#62e9c5",
              strokeWidth: 2
            }}
            defaultSavedImageName={`pdp-${sectionName || "section"}`}
            defaultSavedImageType="png"
            defaultSavedImageQuality={0.94}
            defaultTabId={TABS.ADJUST}
            defaultToolId={TOOLS.CROP}
            tabsIds={[TABS.ADJUST, TABS.FINETUNE, TABS.FILTERS, TABS.ANNOTATE, TABS.RESIZE]}
            savingPixelRatio={2}
            previewPixelRatio={previewPixelRatio}
            resetOnImageSourceChange
            closeAfterSave
            useBackendTranslations={false}
            avoidChangesNotSavedAlertOnLeave
          />
        </div>
      </div>
    </div>
  );
}

function getSavedImageDataUrl(savedImageData: FilerobotSavedImage) {
  if (savedImageData.imageBase64?.startsWith("data:")) {
    return savedImageData.imageBase64;
  }

  if (savedImageData.imageBase64) {
    return `data:${savedImageData.mimeType || "image/png"};base64,${savedImageData.imageBase64}`;
  }

  if (savedImageData.imageCanvas) {
    return savedImageData.imageCanvas.toDataURL(savedImageData.mimeType || "image/png", 0.94);
  }

  return "";
}
