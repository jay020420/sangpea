import type { AspectRatio, GeneratedResult, PdpEditableLayer, PdpLayoutTemplate, SectionBlueprint } from "@runacademy/shared";
import { createLayeredDocumentV2FromBlueprint } from "../../../../lib/pdp-layered-document";
import type { RedesignProject, RedesignSection, RedesignSectionRevision } from "./types";
import { REDESIGN_SECTION_TOTAL } from "./types";

export function mergeRedesignProjects(baseProject: RedesignProject | null | undefined, incoming: RedesignProject): RedesignProject {
  if (!baseProject) {
    return {
      ...incoming,
      sections: sortSections(incoming.sections.map((section) => ({ ...section, revisions: ensureSectionRevisions(section) })))
    };
  }

  const byId = new Map<string, RedesignSection>();
  for (const section of baseProject.sections) byId.set(section.section_id || section.id, section);
  for (const section of incoming.sections) {
    const existing = byId.get(section.section_id || section.id);
    byId.set(section.section_id || section.id, {
      ...existing,
      ...section,
      revisions: mergeRevisions(existing, section)
    });
  }

  const sections = sortSections(Array.from(byId.values()));
  const generatedCount = sections.filter((section) => section.imageUrl).length;
  const hasIncomingFailures = Boolean(incoming.failedSections?.length);
  const warning = hasIncomingFailures
    ? incoming.warning || `${incoming.failedSections?.length ?? 0}개 섹션 생성에 실패했습니다. 누락 섹션을 이어 생성하세요.`
    : generatedCount >= REDESIGN_SECTION_TOTAL
      ? ""
      : baseProject.warning
        ? "일부 섹션이 아직 생성되지 않았습니다. 누락 섹션을 이어 생성하세요."
        : "";

  return {
    ...baseProject,
    ...incoming,
    id: baseProject.id,
    title: baseProject.title || incoming.title,
    createdAt: baseProject.createdAt,
    originalImage: baseProject.originalImage || incoming.originalImage,
    referenceImages: baseProject.referenceImages?.length ? baseProject.referenceImages : incoming.referenceImages,
    sections,
    count: generatedCount,
    status: hasIncomingFailures ? "부분완료" : generatedCount >= REDESIGN_SECTION_TOTAL ? "완료" : incoming.status,
    warning,
    failedSections: incoming.failedSections || []
  };
}

export function mergeRevisions(existing: RedesignSection | undefined, incoming: RedesignSection) {
  const revisions = ensureSectionRevisions(existing);
  if (!incoming.imageUrl) return revisions;
  if (revisions.some((revision) => revision.imageUrl === incoming.imageUrl)) return revisions;
  return [
    ...revisions,
    {
      id: `revision-${Date.now()}-${incoming.section_id}`,
      imageUrl: incoming.imageUrl,
      label: revisions.length ? `생성 ${revisions.length + 1}` : "초안",
      createdAt: new Date().toISOString(),
      providerProof: incoming.providerProof
    }
  ];
}

export function ensureSectionRevisions(section?: RedesignSection | null): RedesignSectionRevision[] {
  const revisions = section?.revisions?.filter((revision) => revision.imageUrl) ?? [];
  if (!section?.imageUrl) return revisions;
  if (revisions.some((revision) => revision.imageUrl === section.imageUrl)) return revisions;
  return [
    {
      id: `revision-original-${section.section_id}`,
      imageUrl: section.imageUrl,
      label: "초안",
      createdAt: new Date().toISOString(),
      providerProof: section.providerProof
    },
    ...revisions
  ];
}

export function redesignProjectToResult(project: RedesignProject): GeneratedResult {
  const sections = sortSections(project.sections)
    .filter((section) => section.imageUrl)
    .map((section, index) => redesignSectionToBlueprint(section, index, project.ratio));
  const blueprint: GeneratedResult["blueprint"] = {
    executiveSummary:
      typeof project.analysis === "object" && project.analysis && "diagnostic_summary" in project.analysis
        ? String((project.analysis as { diagnostic_summary?: string }).diagnostic_summary || "기존 상세페이지를 리디자인했습니다.")
        : "기존 상세페이지를 리디자인했습니다.",
    scorecard: [
      {
        category: "리디자인",
        score: project.status,
        reason: project.warning || `${sections.length}개 섹션을 편집기로 넘길 수 있습니다.`
      }
    ],
    blueprintList: sections.map((section) => `${section.section_id} ${section.section_name}`),
    sections
  };

  return {
    originalImage: project.originalImage,
    referenceImages: project.referenceImages,
    sourceMode: "redesign",
    providerProof: project.providerProof,
    layeredDocument: {
      version: 1,
      format: "pdp-layered-document",
      sections: sections.map((section) => ({
        sectionId: section.section_id,
        backgroundImageId: section.image_id,
        layers: section.editableLayers ?? []
      }))
    },
    layeredDocumentV2: createLayeredDocumentV2FromBlueprint({
      title: project.title,
      blueprint,
      originalImage: project.originalImage,
      referenceImages: project.referenceImages,
      aspectRatio: project.ratio
    }),
    blueprint
  };
}

function redesignSectionToBlueprint(section: RedesignSection, index: number, aspectRatio: AspectRatio): SectionBlueprint {
  const layoutTemplate = layoutTemplateForSectionNumber(sectionNumber(section.section_id || section.id) || index + 1);
  const sectionId = section.section_id || `S${index + 1}`;
  return {
    section_id: sectionId,
    section_name: section.name || `섹션 ${index + 1}`,
    layout_template: layoutTemplate,
    goal: section.purpose || "구매전환을 위한 리디자인 섹션",
    headline: section.headline || section.name || `섹션 ${index + 1}`,
    headline_en: section.headline || section.name || `Section ${index + 1}`,
    subheadline: section.subheadline || section.purpose || "",
    subheadline_en: section.subheadline || section.purpose || "",
    bullets: section.bullets?.length ? section.bullets : [section.source || "원본 정보 보존", "한국형 모바일 가독성", "구매 불안 해소"],
    bullets_en: section.bullets?.length ? section.bullets : [section.source || "Preserve source facts", "Mobile readability", "Reduce purchase anxiety"],
    trust_or_objection_line: section.trust || "원본에서 확인 가능한 정보만 사용",
    trust_or_objection_line_en: section.trust || "Use only verifiable source information.",
    CTA: section.cta || "자세히 보기",
    CTA_en: section.cta || "Learn more",
    layout_notes: `${aspectRatio} 리디자인 섹션`,
    compliance_notes: "확인되지 않은 효능, 기능, 가격, 공식 로고는 사용하지 않습니다. 리뷰, 인증, 수치형 신뢰 문구는 마케팅 카피로 사용할 수 있습니다.",
    image_id: section.image_id || `redesign_${index + 1}`,
    purpose: section.purpose || "상세페이지 리디자인",
    prompt_ko: section.promptText || section.prompt,
    prompt_en: section.promptText || section.prompt,
    negative_prompt: "fake product functions, fake logos, fake pricing, unreadable dense text",
    style_guide: "Korean mobile commerce PDP, trustworthy, conversion-focused",
    reference_usage: "기존 상세페이지 이미지를 제품 사실과 시각 기준으로 사용",
    editableLayers: buildDefaultEditableLayers(sectionId, layoutTemplate),
    generatedImage: section.imageUrl,
    imageQualityReport: section.imageQualityReport,
    providerProof: section.providerProof
  };
}

export function sortSections(sections: RedesignSection[]) {
  return sections.slice().sort((left, right) => sectionNumber(left.section_id || left.id) - sectionNumber(right.section_id || right.id));
}

export function sectionNumber(sectionId: string) {
  const value = Number(String(sectionId || "").replace(/\D/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function layoutTemplateForSectionNumber(value: number): PdpLayoutTemplate {
  const templates: PdpLayoutTemplate[] = ["hero", "problem", "benefit", "proof", "spec", "demo", "use-case", "faq-cta"];
  return templates[Math.max(0, Math.min(templates.length - 1, value - 1))] ?? "benefit";
}

function buildDefaultEditableLayers(sectionId: string, layoutTemplate: PdpLayoutTemplate): PdpEditableLayer[] {
  const isHero = layoutTemplate === "hero";
  const isFaq = layoutTemplate === "faq-cta";
  return [
    {
      id: `${sectionId}-background`,
      kind: "background",
      name: "Background artwork",
      sectionId,
      editable: false,
      zIndex: 0,
      bounds: { x: 0, y: 0, width: 100, height: 100, unit: "percent" }
    },
    {
      id: `${sectionId}-product`,
      kind: "product",
      name: "Product or software visual",
      sectionId,
      editable: false,
      zIndex: 10,
      bounds: { x: isHero ? 12 : 10, y: isHero ? 26 : 20, width: isHero ? 76 : 80, height: isFaq ? 34 : 48, unit: "percent" }
    },
    {
      id: `${sectionId}-headline`,
      kind: "text",
      name: "Headline text",
      sectionId,
      editable: true,
      role: "headline",
      zIndex: 20,
      bounds: { x: 8, y: isHero ? 8 : 7, width: 84, height: 14, unit: "percent" }
    },
    {
      id: `${sectionId}-support-copy`,
      kind: "text",
      name: "Support copy and bullets",
      sectionId,
      editable: true,
      role: "body",
      zIndex: 21,
      bounds: { x: 8, y: isHero ? 70 : 68, width: 84, height: isFaq ? 17 : 20, unit: "percent" }
    },
    {
      id: `${sectionId}-cta`,
      kind: "cta",
      name: "CTA button",
      sectionId,
      editable: true,
      role: "cta",
      zIndex: 22,
      bounds: { x: 24, y: 90, width: 52, height: 7, unit: "percent" }
    }
  ];
}
