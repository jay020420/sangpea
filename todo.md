# PDP Maker Production TODO

Updated: 2026-06-27

## This Pass

- API JSON 요청에 크기 제한, content-type 검증, 일관된 400/413/415 오류 응답을 추가했다.
- 리디자인 multipart 업로드에 전체 요청 크기 헤더 검증을 추가했다.
- `/api/health` 운영 헬스체크를 추가했다.
- Next.js 기본 보안 헤더와 `X-Powered-By` 비활성화를 적용했다.
- 사내용 운영 전제로 계정 생성/권한 분리 요구사항은 제외했다.
- 생성/분석/리디자인 API에 프로세스 단위 동시 실행 제한, IP 기준 rate limit, 429/503 응답을 추가했다.
- 최근 작업 감사 로그와 `GET /api/ops/status` 내부 상태 조회 API를 추가했다.
- 환경 변수 검증을 추가해 `/api/config`, `/api/health`, `/api/ops/status`에서 모델/provider/내부 제한값 설정 오류를 확인할 수 있게 했다.
- 초안 저장을 브라우저 IndexedDB 단독에서 서버 `.data/drafts` 백업 병행 구조로 확장했다.
- 발견/해결: `pnpm typecheck`와 `pnpm build`를 병렬 실행하면 `.next/types` 재생성 경합으로 typecheck가 실패할 수 있다. 이 프로젝트 검증은 직렬 실행으로 진행한다.
- 발견/해결: 브라우저 스냅샷에서 API 상태가 auth 확인 전에도 `로그인 필요`로 보여 실제 실패처럼 보였다. 초기 표시를 `확인 중`으로 바꿔 실제 auth 실패와 구분했다.
- 발견/해결: Drafts 패널이 서버 백업 도입 후에도 `로컬 저장 초안`으로 표시됐다. 실제 동작에 맞게 `저장 초안`으로 수정했다.

## P0 Launch Blockers

- [x] 사내용 단일 도구 기준으로 생성/분석 API 전역 동시 실행 제한, IP 기준 rate limit, 429/503 응답을 적용한다.
- [x] 운영 로그와 감사 추적을 추가한다. 요청 id, provider, 모델, latency, 실패 코드, 생성 시도 횟수를 남긴다.
- [ ] 생성 작업을 HTTP 요청 하나에 묶지 말고 queue/job 모델로 분리한다. 긴 이미지 생성, 품질 검수, 재생성은 재시도 가능한 비동기 작업이어야 한다.
- [x] draft 저장을 브라우저 IndexedDB 중심에서 서버 저장소 병행 구조로 전환한다.
- [ ] 생성 이미지 원본 asset과 export asset을 서버 파일 저장소 또는 object storage에 분리 저장한다.
- [ ] OCR 또는 비전 기반 새 텍스트 검출 게이트를 추가해 이미지에 픽셀 텍스트가 굳어 들어가는 결과를 차단한다.
- [ ] 업로드 이미지와 Knowledge 문서에 보존 기간, 삭제, 개인정보/민감정보 처리 정책을 적용한다.

## P1 Production Hardening

- [x] 환경 변수 스키마를 추가해 `CODEX_TEXT_MODEL`, `CODEX_IMAGE_MODEL`, `IMAGE_PROVIDER`, 내부 제한값 설정 오류를 API에서 검출한다.
- [ ] API 라우트별 입력 스키마를 zod로 명시하고, service 내부 검증과 라우트 검증의 책임을 분리한다.
- [ ] Knowledge 저장소를 로컬 JSON 파일에서 DB 또는 object storage 기반 인덱스로 옮긴다.
- [ ] 이미지/문서 업로드에 바이러스 스캔 또는 최소한의 MIME/확장자/서명 검증 정책을 문서화하고 자동화한다.
- [ ] 생성 결과 품질 게이트의 통과/차단 사례를 fixture로 저장하고 회귀 테스트를 만든다.
- [ ] 프로덕션 빌드 산출물에 대해 `pnpm typecheck`, `pnpm build`, 핵심 API smoke test를 CI로 실행한다.

## P2 Service Polish

- [x] 관리자 화면 또는 운영 CLI 없이도 최근 작업, 실패 사유, provider 상태, 사용량을 `GET /api/ops/status`로 확인할 수 있게 한다.
- [ ] 고객 전달용 export manifest에 생성 provenance, 모델, 품질 점수, 수동 검수 상태를 포함한다.
- [ ] ComfyUI provider 및 실제 product/background segmentation 파이프라인은 layer 문서 안정화 후 별도 단계로 진행한다.
- [ ] 사내 배포 문서에 장애 대응 절차, 모델 접근 실패 대응, 비용 상한, rollback 절차를 추가한다.
