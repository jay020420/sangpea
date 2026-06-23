# PDP Maker Refactor TODO

## In Progress

- [x] 현재 `pdp-maker-201` 구조, API 경계, 드래프트 저장 방식을 확인한다.

## Immediate Changes

- [x] 이미지 생성 provider 인터페이스를 도입하고 OpenAI Codex OAuth 구현을 분리한다.
- [x] 공유 타입에 provider 교체 가능성, 편집 가능한 레이어, PDP 실무 품질 평가 기준을 추가한다.
- [x] `PdpMakerClient.tsx`에서 업로드, 리디자인, Knowledge, Draft UI를 feature 컴포넌트로 분리한다.
- [x] 상세페이지 흐름을 "Generate First, Edit Many"가 드러나도록 문구와 상태 모델을 조정한다.

## Follow-up Architecture

- [ ] PSD/Figma 내보내기 또는 계층형 문서 모델을 설계한다.
- [x] 제품 데이터, 경쟁사 상세페이지, 후기, 카테고리 특성을 Knowledge 소스로 수집하는 ingestion 플로우를 추가한다.
- [ ] 대용량 이미지/히스토리 저장을 위한 IndexedDB blob 분리 또는 서버 저장소를 검토한다.

## Verification

- [x] `pnpm typecheck`를 실행한다.
- [x] 가능한 경우 `pnpm build`를 실행한다.
