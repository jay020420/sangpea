# PDP Maker Refactor TODO

## In Progress

- [x] 현재 `pdp-maker-201` 구조, API 경계, 드래프트 저장 방식을 확인한다.

## Immediate Changes

- [x] 이미지 생성 provider 인터페이스를 도입하고 OpenAI Codex OAuth 구현을 분리한다.
- [x] 공유 타입에 provider 교체 가능성, 편집 가능한 레이어, PDP 실무 품질 평가 기준을 추가한다.
- [x] `PdpMakerClient.tsx`에서 업로드, 리디자인, Knowledge, Draft UI를 feature 컴포넌트로 분리한다.
- [x] 상세페이지 흐름을 "Generate First, Edit Many"가 드러나도록 문구와 상태 모델을 조정한다.

## Follow-up Architecture

- [x] PSD/Figma 내보내기 또는 계층형 문서 모델을 설계한다.
- [x] Figma 우선 `PdpLayeredDocumentV2`와 plugin-ready JSON payload export를 구현한다.
- [x] ComfyUI provider 없이도 생성 결과를 `background`, `product source reference`, `safe zone`, `text`, `CTA`, `shape` layer 노드로 분리 저장한다.
- [x] 계층형 문서의 node/asset 참조 상태를 요약하고 에디터에서 확인 가능하게 한다.
- [x] `PdpLayeredDocumentV2`만 남은 draft에서도 편집 overlay를 복구하는 migration helper를 추가한다.
- [x] Figma payload에 section frame 세로 배치, import hint, validation summary를 포함한다.
- [x] 운영 검수를 위한 layer tree preview와 base64 제외 export manifest를 추가한다.
- [x] 제품 데이터, 경쟁사 상세페이지, 후기, 카테고리 특성을 Knowledge 소스로 수집하는 ingestion 플로우를 추가한다.
- [x] 구조 생성 후 편집 진입이 저장 완료에 막히지 않도록 즉시 전환과 저장 상태 표시를 보강한다.
- [x] 생성 이미지가 텍스트/CTA를 픽셀로 굽지 않도록 background plate 프롬프트와 품질 게이트를 강화한다.
- [x] 업로드/생성 UI를 3단계 Workflow 중심으로 재정리하고 장문 안내를 줄인다.
- [x] 생성 결과 실패 원인 보고서를 작성한다.
- [ ] 대용량 이미지/히스토리 저장을 위한 IndexedDB blob 분리 또는 서버 저장소를 검토한다.
- [ ] OCR 또는 비전 기반 새 텍스트 검출 게이트를 추가한다.
- [ ] ComfyUI provider 및 실제 product/background segmentation 파이프라인은 layer 문서 안정화 후 별도 단계로 진행한다.

## Verification

- [x] `pnpm typecheck`를 실행한다.
- [x] 가능한 경우 `pnpm build`를 실행한다.
