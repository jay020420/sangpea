"use client";

import { AlertCircle, CheckCircle2, FileImage, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { RedesignProject, RedesignSection } from "./types";
import { REDESIGN_SECTION_TOTAL } from "./types";
import styles from "../../pdp-maker.module.css";

export function RedesignProjectPanel({
  project,
  projects,
  rolloutRequest,
  setRolloutRequest,
  editRequests,
  editTargets,
  editingSectionId,
  isOpeningEditor,
  onEditRequestChange,
  onEditTargetChange,
  onEditSection,
  onGenerateMissing,
  onOpenEditor,
  onActivateProject
}: {
  project: RedesignProject;
  projects: RedesignProject[];
  rolloutRequest: string;
  setRolloutRequest: (value: string) => void;
  editRequests: Record<string, string>;
  editTargets: Record<string, string>;
  editingSectionId: string | null;
  isOpeningEditor: boolean;
  onEditRequestChange: (sectionId: string, value: string) => void;
  onEditTargetChange: (sectionId: string, value: string) => void;
  onEditSection: (sectionId: string) => void;
  onGenerateMissing: () => void;
  onOpenEditor: () => void;
  onActivateProject: (project: RedesignProject) => void;
}) {
  const generatedCount = project.sections.filter((section) => section.imageUrl).length;
  const missingCount = Math.max(0, REDESIGN_SECTION_TOTAL - generatedCount);
  const blockedSections = project.sections.filter((section) => section.imageUrl && getRedesignSectionQualityStatus(section) === "blocked");
  const reviewSections = project.sections.filter((section) => section.imageUrl && getRedesignSectionQualityStatus(section) === "needs_review");
  const readySections = project.sections.filter((section) => section.imageUrl && getRedesignSectionQualityStatus(section) === "ready");
  const qualityLabel = blockedSections.length
    ? `납품 차단 ${blockedSections.length}개`
    : generatedCount
      ? `납품 가능 ${readySections.length}/${generatedCount}`
      : "품질 대기";

  return (
    <div className={styles.redesignProjectPanel}>
      <div className={styles.redesignProjectHeader}>
        <div>
          <span className={styles.panelLabel}>Redesign Project</span>
          <h3>{project.title}</h3>
          <p>
            {generatedCount}개 생성됨 · {qualityLabel} · {project.channel} · {project.modelLabel}
          </p>
        </div>
        <span className={project.status === "완료" ? styles.successPill : styles.warningPill}>{project.status}</span>
      </div>

      {blockedSections.length ? (
        <div className={styles.inlineWarning}>
          <AlertCircle size={16} />
          품질 게이트에서 차단된 섹션이 있습니다. {blockedSections.map((section) => section.name).slice(0, 3).join(", ")} 섹션을 수정하거나 다시 생성하세요.
        </div>
      ) : reviewSections.length ? (
        <div className={styles.inlineWarning}>
          <AlertCircle size={16} />
          {reviewSections.length}개 섹션은 고객 제공 전 수동 검수가 필요합니다.
        </div>
      ) : null}

      {project.warning ? (
        <div className={styles.inlineWarning}>
          <AlertCircle size={16} />
          {project.warning}
        </div>
      ) : null}

      <div className={styles.rolloutPanel}>
        <label className={styles.fieldLabel} htmlFor="rolloutRequest">
          히어로 검토 후 요청
        </label>
        <textarea
          className={styles.textarea}
          id="rolloutRequest"
          onChange={(event) => setRolloutRequest(event.target.value)}
          placeholder="예: 첫 장은 제품이 잘 보이지만 카피가 강합니다. 나머지는 후기/근거/배송 불안을 더 신뢰감 있게 풀어주세요."
          rows={4}
          value={rolloutRequest}
        />
        <div className={styles.inlineActionRow}>
          <button className={styles.secondaryButton} disabled={!missingCount} onClick={onGenerateMissing} type="button">
            <Sparkles size={16} />
            {missingCount ? `나머지/누락 ${missingCount}장 생성` : "8장 생성 완료"}
          </button>
          <button className={styles.primaryButtonCompact} disabled={!generatedCount || isOpeningEditor} onClick={onOpenEditor} type="button">
            {isOpeningEditor ? <Loader2 className={styles.spinIcon} size={16} /> : <CheckCircle2 size={16} />}
            {isOpeningEditor ? "편집기 여는 중" : "편집기로 넘기기"}
          </button>
        </div>
      </div>

      <div className={styles.redesignSectionGrid}>
        {project.sections.map((section, index) => (
          <div className={styles.redesignSectionCard} key={section.section_id || section.id}>
            <div className={styles.redesignThumb}>{section.imageUrl ? <img alt={section.name} src={section.imageUrl} /> : <PlaceholderThumb index={index} />}</div>
            <div className={styles.redesignSectionCopy}>
              <strong>{section.name}</strong>
              <p>{section.purpose}</p>
              {section.imageQualityReport ? (
                <span className={getRedesignQualityPillClass(section)}>
                  {getRedesignQualityLabel(section)} · {section.imageQualityReport.score}점
                </span>
              ) : section.imageUrl ? (
                <span className={styles.warningPill}>검수 필요</span>
              ) : null}
              {section.providerProof ? <span className={styles.providerProofPill}>{section.providerProof.model} · fallback off</span> : null}
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor={`edit-target-${section.section_id}`}>
                수정 대상 레이어
              </label>
              <select
                className={styles.select}
                id={`edit-target-${section.section_id}`}
                onChange={(event) => onEditTargetChange(section.section_id, event.target.value)}
                value={editTargets[section.section_id] || "section"}
              >
                {buildRedesignEditTargetOptions(section).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label className={styles.fieldLabel} htmlFor={`edit-${section.section_id}`}>
                섹션 수정 요청
              </label>
              <textarea
                className={styles.textarea}
                id={`edit-${section.section_id}`}
                onChange={(event) => onEditRequestChange(section.section_id, event.target.value)}
                placeholder="예: 헤드라인을 줄이고 제품 컷을 더 크게, 배송/교환 불안 해소 문구 추가"
                rows={3}
                value={editRequests[section.section_id] || ""}
              />
            </div>
            <button className={styles.secondaryButton} disabled={!section.imageUrl || editingSectionId === section.section_id} onClick={() => onEditSection(section.section_id)} type="button">
              {editingSectionId === section.section_id ? <Loader2 className={styles.spinIcon} size={16} /> : <RefreshCw size={16} />}
              이 섹션 수정
            </button>
          </div>
        ))}
      </div>

      {projects.length > 1 ? (
        <div className={styles.redesignProjectList}>
          <span className={styles.fieldLabel}>최근 리디자인 프로젝트</span>
          <div className={styles.inlineActionRow}>
            {projects.slice(0, 5).map((candidate) => (
              <button className={candidate.id === project.id ? styles.toneButtonActive : styles.toneButton} key={candidate.id} onClick={() => onActivateProject(candidate)} type="button">
                {candidate.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildRedesignEditTargetOptions(section: RedesignSection) {
  const sectionId = section.section_id || section.id;
  const options = [
    { value: "section", label: "전체 섹션" },
    { value: `${sectionId}-product-source-reference`, label: "제품/화면 영역" }
  ];
  if (section.headline) options.push({ value: `${sectionId}-planned-headline`, label: "헤드라인" });
  if (section.subheadline) options.push({ value: `${sectionId}-planned-subheadline`, label: "서브헤드라인" });
  for (const [index, bullet] of (section.bullets ?? []).entries()) {
    if (bullet.trim()) options.push({ value: `${sectionId}-planned-bullet-${index + 1}`, label: `불릿 ${index + 1}` });
  }
  if (section.trust) options.push({ value: `${sectionId}-planned-trust`, label: "신뢰/반박 문구" });
  if (section.cta) options.push({ value: `${sectionId}-planned-cta`, label: "CTA" });
  return options;
}

function PlaceholderThumb({ index }: { index: number }) {
  return (
    <div className={styles.placeholderThumb}>
      <FileImage size={20} />
      <span>S{index + 1}</span>
    </div>
  );
}

function getRedesignSectionQualityStatus(section: RedesignSection) {
  if (!section.imageUrl) return "needs_review";
  return section.imageQualityReport?.status ?? "needs_review";
}

function getRedesignQualityLabel(section: RedesignSection) {
  const status = getRedesignSectionQualityStatus(section);
  if (status === "ready") return "납품 가능";
  if (status === "blocked") return "납품 차단";
  return "검수 필요";
}

function getRedesignQualityPillClass(section: RedesignSection) {
  const status = getRedesignSectionQualityStatus(section);
  if (status === "ready") return styles.successPill;
  if (status === "blocked") return styles.warningPill;
  return styles.providerProofPill;
}
