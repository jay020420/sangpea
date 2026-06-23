"use client";

import type { ReferenceModelUsage } from "@runacademy/shared";
import type { PreparedImageDraft, PreparedReferenceImageDraft } from "../../pdp-drafts";

export type ProductInputReadiness = {
  score: number;
  status: "ready" | "needs_review" | "blocked";
  summary: string;
  strengths: string[];
  issues: string[];
  actions: string[];
};

export function buildProductInputReadiness(input: {
  productImages: PreparedReferenceImageDraft[];
  productDescription: string;
  additionalInfo: string;
  desiredTone: string;
  modelImage: PreparedImageDraft | null;
  modelImageUsage: ReferenceModelUsage | null;
}): ProductInputReadiness {
  const issues: string[] = [];
  const actions: string[] = [];
  const strengths: string[] = [];
  let score = 100;

  const description = normalizeReadinessText(input.productDescription);
  const direction = normalizeReadinessText(input.additionalInfo);
  const combined = `${description} ${direction} ${input.productImages.map((image) => image.fileName).join(" ")}`.toLowerCase();
  const isSoftware = /(sw|saas|software|app|앱|소프트웨어|웹서비스|대시보드|ui|ux|obs|브라우저|프로그램|위젯|서비스)/i.test(combined);
  const hasPrimary = input.productImages.some((image) => image.role === "primary");
  const hasDetail = input.productImages.some((image) => image.role === "detail");
  const hasProof = input.productImages.some((image) => image.role === "proof");
  const hasReference = input.productImages.some((image) => image.role === "reference");

  if (!input.productImages.length) {
    score -= 45;
    issues.push("대표 제품/SW 자료가 없습니다.");
    actions.push("대표 제품컷이나 실제 SW 화면을 1장 이상 업로드하세요.");
  } else {
    strengths.push(`${input.productImages.length}개 참조 자료 업로드`);
  }

  if (input.productImages.length && !hasPrimary) {
    score -= 12;
    issues.push("대표 기준 이미지가 지정되지 않았습니다.");
    actions.push("가장 중요한 제품컷 또는 실제 화면을 대표 자료로 지정하세요.");
  } else if (hasPrimary) {
    strengths.push("대표 자료 지정");
  }

  if (isSoftware && input.productImages.length < 2) {
    score -= 10;
    issues.push("SW/SaaS는 실제 화면 근거가 더 필요합니다.");
    actions.push("대시보드, 설정, 결과 화면처럼 실제 사용 흐름을 보여주는 화면을 2장 이상 넣으세요.");
  }

  if (!hasDetail && !hasProof) {
    score -= 14;
    issues.push("디테일/증빙 자료가 부족합니다.");
    actions.push(isSoftware ? "설정 화면, 상태 화면, 결과 화면 중 하나를 디테일 자료로 추가하세요." : "스펙, 구성품, 사용 장면, 인증/후기 등 확인 자료를 추가하세요.");
  } else {
    strengths.push(hasProof ? "증빙 자료 포함" : "디테일 자료 포함");
  }

  if (description.length < 80) {
    score -= 26;
    issues.push("상품 설명이 짧아 카피와 스토리 근거가 약합니다.");
    actions.push("상품명, 대상 고객, 핵심 기능 3개, 사용 상황, 구매/도입 이유를 5문장 이상으로 적으세요.");
  } else if (description.length < 160) {
    score -= 10;
    issues.push("상품 설명이 유료 납품용으로는 다소 짧습니다.");
    actions.push("가격/도입 이유, AS/지원 범위, 절대 만들면 안 되는 주장을 추가하세요.");
  } else {
    strengths.push("상품 사실 정보 충분");
  }

  if (!/(대상|타깃|고객|사용자|구매자|판매자|스트리머|운영자|담당자|브랜드|팀|사장|셀러)/.test(description)) {
    score -= 8;
    issues.push("대상 고객이 명확하지 않습니다.");
    actions.push("누가 쓰는지 한 문장으로 명시하세요. 예: 치지직 스트리머, 육아 중인 부모, 스마트스토어 셀러.");
  }

  if (!/(기능|장점|특징|연동|자동|지원|구성|소재|성분|화면|대시보드|배송|교환|as|요금|가격|보안|권한)/i.test(description)) {
    score -= 10;
    issues.push("핵심 기능/장점 근거가 부족합니다.");
    actions.push("기능을 나열하지 말고 고객이 얻는 변화까지 함께 적으세요.");
  }

  if (!/(사용|상황|문제|고민|불편|운영|방송|도입|구매|설치|관리|확인|비교|전환)/.test(description)) {
    score -= 8;
    issues.push("사용 상황 또는 고객 문제가 약합니다.");
    actions.push("고객이 어떤 상황에서 왜 필요로 하는지 실제 사용 맥락을 추가하세요.");
  }

  if (!/(금지|하지 말|과장|허위|없는|효능|효과|의학|보장|주의|기능|연동|지원|가격|요금|공식|로고)/.test(`${description} ${direction}`)) {
    score -= 6;
    issues.push("금지 기능/주의 표현이 없어 기능 과장 위험이 있습니다.");
    actions.push("없는 기능, 연동, 지원 범위, 효능, 가격, 공식 로고처럼 만들면 안 되는 내용을 명시하세요.");
  } else {
    strengths.push("금지 기능/주의 표현 입력");
  }

  if (input.modelImage && !input.modelImageUsage) {
    score -= 20;
    issues.push("모델 이미지를 업로드했지만 사용 범위가 정해지지 않았습니다.");
    actions.push("모델 이미지를 히어로에만 쓸지, 모든 섹션에 쓸지 선택하세요.");
  }

  if (direction.length >= 20 || input.desiredTone) {
    strengths.push("제작 방향 입력");
  } else {
    score -= 4;
    actions.push("원하는 톤, 첫 화면 우선순위, 강조/제외할 메시지를 제작 방향에 적으세요.");
  }

  if (hasReference) {
    strengths.push("톤/구도 참조 포함");
  }

  const finalScore = clampReadinessScore(score);
  const status = !input.productImages.length || (input.modelImage && !input.modelImageUsage) || finalScore < 55 ? "blocked" : finalScore < 80 ? "needs_review" : "ready";

  return {
    score: finalScore,
    status,
    summary:
      status === "ready"
        ? "유료 초안 생성을 시작할 수 있을 만큼 상품 사실과 참조 자료가 준비됐습니다."
        : status === "blocked"
          ? "현재 자료로 생성하면 품질 게이트에서 막힐 가능성이 높습니다. 생성 전 필수 정보를 보강하세요."
          : "생성은 가능하지만 결과 품질을 높이려면 몇 가지 자료를 더 보강하는 편이 좋습니다.",
    strengths: uniqueReadinessItems(strengths),
    issues: uniqueReadinessItems(issues),
    actions: uniqueReadinessItems(actions)
  };
}

function normalizeReadinessText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function uniqueReadinessItems(items: string[]) {
  return Array.from(new Set(items.filter(Boolean))).slice(0, 8);
}

function clampReadinessScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
