"use client";

import { FileText } from "lucide-react";
import type { RefObject } from "react";
import styles from "../../pdp-maker.module.css";

export type KnowledgeItem = {
  id: string;
  name: string;
  sourceKind?: "seed" | "product_data" | "competitor_pdp" | "review" | "category" | "general";
  tags?: string[];
  size: number;
  createdAt: string;
};

export function KnowledgePanel({
  inputRef,
  items,
  onFiles,
  onDelete
}: {
  inputRef: RefObject<HTMLInputElement>;
  items: KnowledgeItem[];
  onFiles: (files: FileList | null) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={styles.modelUsagePanel}>
      <div className={styles.modelUsageHeader}>
        <strong>로컬 RAG 지식파일</strong>
        <span>제품 데이터, 경쟁사 상세페이지, 후기, 카테고리 자료를 등록하면 생성 프롬프트에 반영합니다.</span>
      </div>
      <button className={styles.secondaryButton} onClick={() => inputRef.current?.click()} type="button">
        <FileText size={16} />
        지식파일 등록
      </button>
      <input className={styles.hiddenInput} multiple onChange={(event) => onFiles(event.target.files)} ref={inputRef} type="file" accept=".pdf,.txt,.md,text/*,application/pdf" />
      {items.length ? (
        <ul className={styles.emptyList}>
          {items.map((item) => (
            <li key={item.id}>
              {item.sourceKind ? `[${sourceKindLabel(item.sourceKind)}] ` : null}
              {item.name}
              <button className={styles.inlineButton} onClick={() => onDelete(item.id)} type="button">
                삭제
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function sourceKindLabel(kind: NonNullable<KnowledgeItem["sourceKind"]>) {
  switch (kind) {
    case "product_data":
      return "제품";
    case "competitor_pdp":
      return "경쟁사";
    case "review":
      return "후기";
    case "category":
      return "카테고리";
    case "seed":
      return "시드";
    default:
      return "일반";
  }
}
