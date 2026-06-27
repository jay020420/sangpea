# PDP Maker Production Readiness

작성일: 2026-06-27

## 현재 서비스 성격

이 앱은 사내용 PDP 제작 도구로 운영한다. 계정 생성, 외부 사용자 인증, 권한 분리는 현재 범위에서 제외한다. 서버는 Codex OAuth `auth.json`을 읽어 이미지/텍스트 생성을 실행하고, 초안과 생성 결과는 주로 브라우저 IndexedDB에 남긴다. 사내에서 안정적으로 쓰려면 저장소, 작업 제한, 실패 추적, 품질 게이트를 우선 보강해야 한다.

## 필수 환경

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm start
```

기본 확인 URL:

```text
GET /api/health
```

`/api/health`는 외부 모델을 호출하지 않고 다음만 확인한다.

- Codex OAuth 인증 파일 존재 여부
- Knowledge 저장소 통계
- 활성 image provider와 미구현 provider 목록
- production 환경에서 로컬 OAuth provider 사용 여부 경고

## 운영 전 반드시 정해야 할 것

- provider 인증: 사내 서버의 Codex OAuth 로그인 상태를 유지하고, 만료 시 재로그인 절차를 정한다.
- 사용량 제한: 사내 사용자의 동시 작업 수, 파일 크기, 재생성 횟수를 제한한다.
- 저장소: draft, 생성 이미지, export manifest, Knowledge 문서를 서버 저장소로 옮긴다.
- 작업 처리: 긴 생성 작업은 queue/job id 기반으로 분리하고, 실패 재시도/취소/상태 조회를 제공한다.
- 감사 로그: 요청 id, provider, 모델, latency, 실패 코드, 품질 점수를 남긴다.

## 이번에 적용한 하드닝

- JSON API 요청은 content-type과 최대 크기를 공통 helper에서 검증한다.
- 대용량 base64 요청은 413으로 거절한다.
- 리디자인 multipart 업로드는 `Content-Length` 기준 전체 요청 크기를 먼저 확인한다.
- 기본 보안 헤더를 Next 설정에 추가했다.
- `X-Powered-By` 헤더를 비활성화했다.
- 생성/분석 API에 프로세스 단위 동시 실행 제한과 IP 기준 rate limit을 추가했다.
- `GET /api/ops/status`에서 최근 작업, 제한/오류 횟수, 실행 중 작업 수를 확인할 수 있다.

## 남은 리스크

- `Content-Length`가 없는 multipart 스트림은 `formData()` 파싱 전에 완전한 streaming limit을 적용하지 못한다. 배포 플랫폼의 request body limit도 같이 설정해야 한다.
- 이미지 생성은 여전히 HTTP 요청 안에서 장시간 실행된다. 사내 사용자가 동시에 여러 작업을 돌리면 queue 분리가 필요하다.
- OCR/비전 기반 픽셀 텍스트 차단이 아직 없다. 유료 고객 전달 전에는 수동 검수를 유지해야 한다.
