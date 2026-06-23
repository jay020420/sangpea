"use client";

import { FolderOpen, Trash2 } from "lucide-react";
import type { PdpDraftSummary } from "../../pdp-drafts";
import styles from "../../pdp-maker.module.css";

export function DraftPanel({ drafts, onOpen, onDelete }: { drafts: PdpDraftSummary[]; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <div className={styles.modelUsagePanel}>
      <div className={styles.modelUsageHeader}>
        <strong>저장된 초안</strong>
        <span>브라우저 IndexedDB에 저장됩니다.</span>
      </div>
      {drafts.length ? (
        <div className={styles.metaList}>
          {drafts.slice(0, 6).map((draft) => {
            const opensEditor = draft.sectionCount > 0 && draft.stageLabel === "편집 중";
            const modeLabel = draft.sourceMode === "redesign" ? "리디자인" : "새 PDP";
            const sectionLabel = draft.sectionCount ? `${draft.sectionCount}섹션` : "구조 생성 전";
            return (
              <div className={styles.metaItem} key={draft.id}>
                <strong>{draft.title}</strong>
                <span>
                  {modeLabel} · {draft.stageLabel} · {sectionLabel}
                </span>
                <button className={styles.inlineButton} onClick={() => onOpen(draft.id)} type="button">
                  <FolderOpen size={14} />
                  {opensEditor ? "편집 열기" : "설정 불러오기"}
                </button>
                <button className={styles.inlineDangerButton} onClick={() => onDelete(draft.id)} type="button">
                  <Trash2 size={14} />
                  삭제
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <span className={styles.dropzoneHint}>아직 저장된 초안이 없습니다.</span>
      )}
    </div>
  );
}
