"use client";

import type { PdpDesignTemplateId, PdpLayoutTemplate, SectionBlueprint } from "@runacademy/shared";

export type PdpDesignTemplate = {
  id: PdpDesignTemplateId;
  label: string;
  shortLabel: string;
  layoutTemplate: PdpLayoutTemplate;
  storyRole: NonNullable<SectionBlueprint["story_role"]>;
  description: string;
  canvasIntent: string;
  imagePromptHint: string;
  overlayLayoutHint: string;
};

export const PDP_DESIGN_TEMPLATES: PdpDesignTemplate[] = [
  {
    id: "hero-product-focus",
    label: "제품 중심 히어로",
    shortLabel: "Hero",
    layoutTemplate: "hero",
    storyRole: "hook",
    description: "첫 화면에서 제품/서비스 정체와 핵심 선택 이유를 크게 보여줍니다.",
    canvasIntent: "large product or screen, headline panel, trust cue, bottom CTA",
    imagePromptHint:
      "Generate only the source-faithful product, service screen, or use-scene visual asset. Do not create copy panels, headline space, CTA buttons, or finished section layout.",
    overlayLayoutHint:
      "상단 헤드라인, 이어지는 서브카피, 중앙 제품/화면, 하단 신뢰 문장과 CTA를 분리한다. 모든 문구는 편집기 레이어가 합성한다."
  },
  {
    id: "problem-checklist",
    label: "문제 체크리스트",
    shortLabel: "Problem",
    layoutTemplate: "problem",
    storyRole: "problem",
    description: "고객의 불편과 구매 전 의심을 체크카드 형태로 정리합니다.",
    canvasIntent: "problem cards, calm question area, product context",
    imagePromptHint:
      "Generate a restrained source-faithful product or user-context visual asset for the problem section. Do not create checklist cards, blank text surfaces, or readable labels.",
    overlayLayoutHint:
      "상단 문제 제기, 중단 체크리스트 2~3개, 하단 해소 문장을 둔다. 불안은 과장하지 않고 실제 자료 기준으로만 표현한다."
  },
  {
    id: "benefit-card-grid",
    label: "베네핏 카드 그리드",
    shortLabel: "Benefit",
    layoutTemplate: "benefit",
    storyRole: "benefit",
    description: "기능을 고객 이득으로 번역해 2~3개 카드로 보여줍니다.",
    canvasIntent: "two or three benefit cards, product detail, compact CTA",
    imagePromptHint:
      "Generate a crisp product/detail/screen visual asset that supports benefit copy. The app template will create benefit cards separately; do not draw card placeholders.",
    overlayLayoutHint:
      "헤드라인 아래 카드형 불릿을 배치한다. 각 카드는 짧은 제목 하나와 한 줄 설명이 들어갈 수 있게 비운다."
  },
  {
    id: "proof-spec-panel",
    label: "근거/스펙 패널",
    shortLabel: "Proof",
    layoutTemplate: "proof",
    storyRole: "proof",
    description: "구성, 스펙, 화면 일부, 증빙처럼 확인 가능한 정보를 패널화합니다.",
    canvasIntent: "proof area, spec rows, source-faithful detail crop",
    imagePromptHint:
      "Generate source-faithful proof, spec, or detail-crop imagery only. Do not invent badges, reviews, certifications, numbers, spec rows, or text placeholders.",
    overlayLayoutHint:
      "근거가 있는 항목만 표/행/카드로 둔다. 인증, 후기, 수치 문구는 자료가 있을 때만 편집기 텍스트로 넣는다."
  },
  {
    id: "demo-step-flow",
    label: "사용 흐름 3단계",
    shortLabel: "Demo",
    layoutTemplate: "demo",
    storyRole: "demo",
    description: "제품 사용법이나 SW 도입 흐름을 2~4단계로 보여줍니다.",
    canvasIntent: "step cards, workflow arrows, real screen/product anchor",
    imagePromptHint:
      "Generate a real product/screen workflow visual asset. The app template will add step cards and labels; do not draw blank workflow surfaces or fake UI text.",
    overlayLayoutHint:
      "단계 번호, 단계명, 짧은 설명을 각각 편집 가능한 텍스트 레이어로 둔다. 실제 화면에 없는 기능명은 만들지 않는다."
  },
  {
    id: "usecase-split-scene",
    label: "활용 상황 분할",
    shortLabel: "Use case",
    layoutTemplate: "use-case",
    storyRole: "usecase",
    description: "구매자가 자기 상황을 떠올릴 수 있게 장면과 카피를 나눕니다.",
    canvasIntent: "split scene, practical context, compact situation cards",
    imagePromptHint:
      "Generate a practical source-faithful use-case visual asset. Do not create split-copy cards, situation panels, or text slots.",
    overlayLayoutHint:
      "좌우 또는 상하 분할로 상황 카드와 제품/화면을 나눈다. 사람 모델은 필요할 때만 사용한다."
  },
  {
    id: "faq-final-cta",
    label: "FAQ와 최종 CTA",
    shortLabel: "FAQ CTA",
    layoutTemplate: "faq-cta",
    storyRole: "cta",
    description: "마지막 구매 저항을 짧게 해소하고 행동 버튼을 강조합니다.",
    canvasIntent: "FAQ cards, objection handling, strong bottom CTA",
    imagePromptHint:
      "Generate a calm source-faithful supporting visual asset for the final FAQ/CTA section. The app template supplies FAQ cards and CTA; do not draw CTA surfaces or words.",
    overlayLayoutHint:
      "질문형 카드와 하단 CTA를 크게 둔다. 배송, 가격, AS, 보안 조건은 확인된 자료가 있을 때만 확정한다."
  }
];

export function getDesignTemplateById(id: PdpDesignTemplateId | undefined) {
  return PDP_DESIGN_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function resolveSectionDesignTemplate(section: SectionBlueprint, sectionIndex: number) {
  const explicitTemplate = getDesignTemplateById(section.design_template_id);
  if (explicitTemplate) return explicitTemplate;

  const byLayout = PDP_DESIGN_TEMPLATES.find((template) => template.layoutTemplate === section.layout_template);
  if (byLayout) return byLayout;

  const text = [section.story_role, section.section_id, section.section_name, section.goal, section.purpose]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(hero|hook|첫|히어로)/.test(text) || sectionIndex === 0) return PDP_DESIGN_TEMPLATES[0];
  if (/(problem|pain|concern|문제|고민|불안)/.test(text) || sectionIndex === 1) return PDP_DESIGN_TEMPLATES[1];
  if (/(proof|trust|evidence|spec|근거|신뢰|스펙|증빙)/.test(text)) return PDP_DESIGN_TEMPLATES[3];
  if (/(demo|workflow|how|usage|step|사용|흐름|단계)/.test(text)) return PDP_DESIGN_TEMPLATES[4];
  if (/(use|case|situation|활용|상황)/.test(text)) return PDP_DESIGN_TEMPLATES[5];
  if (/(faq|cta|final|objection|질문|마지막|구매|문의)/.test(text) || sectionIndex >= 6) return PDP_DESIGN_TEMPLATES[6];
  return PDP_DESIGN_TEMPLATES[2];
}

export function applyDesignTemplateToSection(section: SectionBlueprint, template: PdpDesignTemplate): SectionBlueprint {
  const promptKo = ensureTemplatePromptHint(section.prompt_ko, template.overlayLayoutHint);
  const promptEn = ensureTemplatePromptHint(section.prompt_en, template.imagePromptHint);
  return {
    ...section,
    design_template_id: template.id,
    layout_template: template.layoutTemplate,
    story_role: template.storyRole,
    overlay_layout_hint: template.overlayLayoutHint,
    layout_notes: ensureTemplatePromptHint(section.layout_notes, template.canvasIntent),
    prompt_ko: promptKo,
    prompt_en: promptEn
  };
}

function ensureTemplatePromptHint(value: string | undefined, hint: string) {
  const base = value?.trim() ?? "";
  if (!hint || base.includes(hint)) return base;
  return [base, hint].filter(Boolean).join(" ");
}
