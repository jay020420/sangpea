"use client";

import { useState, type RefObject } from "react";
import { FileText, Upload } from "lucide-react";
import { filesFromDragEvent, preventFileDragDefault } from "./file-input";
import styles from "../../pdp-maker.module.css";

export function RedesignUpload({ inputRef, files, onFiles }: { inputRef: RefObject<HTMLInputElement>; files: File[]; onFiles: (files: File[]) => void }) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <>
      <button
        className={isDragging ? styles.dropzoneActive : styles.dropzone}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          preventFileDragDefault(event);
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          preventFileDragDefault(event);
          setIsDragging(false);
        }}
        onDragOver={preventFileDragDefault}
        onDrop={(event) => {
          preventFileDragDefault(event);
          setIsDragging(false);
          onFiles(filesFromDragEvent(event));
        }}
        type="button"
      >
        <span className={styles.dropzoneIcon}>
          <Upload size={24} />
        </span>
        <strong>기존 상세페이지 이미지 또는 PDF</strong>
        <p>클릭하거나 드래그 앤 드롭하세요. PDF는 브라우저에서 최대 6페이지까지 이미지로 변환해 참조로 사용합니다.</p>
        <span className={styles.dropzoneHint}>{files.length ? `${files.length}개 파일 선택됨` : "이미지, PDF"}</span>
      </button>
      <input
        accept="image/*,.pdf"
        className={styles.hiddenInput}
        multiple
        onChange={(event) => {
          onFiles(Array.from(event.target.files || []));
          event.currentTarget.value = "";
        }}
        ref={inputRef}
        type="file"
      />
      {files.length ? (
        <div className={styles.emptyStatePanel}>
          <FileText size={18} />
          <div>
            <strong>선택한 참조 파일</strong>
            <ul className={styles.emptyList}>
              {files.map((file) => (
                <li key={`${file.name}-${file.size}`}>{file.name}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
