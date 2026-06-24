"use client";

import type { ProductInputReadiness } from "./product-readiness";
import styles from "../../pdp-maker.module.css";

export function ProductInputReadinessPanel({ readiness }: { readiness: ProductInputReadiness }) {
  const statusLabel =
    readiness.status === "ready" ? "생성 준비 완료" : readiness.status === "blocked" ? "자료 보강 필요" : "검수 권장";
  const statusClass =
    readiness.status === "ready"
      ? styles.inputQualityReady
      : readiness.status === "blocked"
        ? styles.inputQualityBlocked
        : styles.inputQualityReview;

  return (
    <div className={styles.inputQualityPanel}>
      <div className={styles.inputQualityHeader}>
        <div>
          <span className={styles.panelLabel}>입력 품질 게이트</span>
          <strong>{statusLabel}</strong>
        </div>
        <span className={statusClass}>{readiness.score}점</span>
      </div>
      <p>{toCompactSentence(readiness.summary)}</p>
      {readiness.strengths.length ? (
        <div className={styles.inputQualityChips}>
          {readiness.strengths.slice(0, 4).map((strength) => (
            <span key={strength}>{strength}</span>
          ))}
        </div>
      ) : null}
      {readiness.actions.length ? (
        <div className={styles.inputQualityActions}>
          <strong>필수 보강</strong>
          {readiness.actions.slice(0, 2).map((action) => (
            <span key={action}>{action}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function toCompactSentence(value: string) {
  const compact = value.trim().replace(/\s+/g, " ");
  return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
}
