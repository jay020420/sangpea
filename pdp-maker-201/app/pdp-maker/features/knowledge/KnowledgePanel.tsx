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
        <strong>Knowledge</strong>
        <span>제품, 경쟁사, 후기, 카테고리 문서</span>
      </div>
      <button className={styles.secondaryButton} onClick={() => inputRef.current?.click()} type="button">
        <FileText size={16} />
        문서 등록
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
