# MV3 안정성 고도화 플랜

## Phase 1: 테스트 기반 마련
- [x] 공유 유틸 함수 테스트 작성
- [x] 테스트 실행 스크립트 추가
- [x] 실패 테스트 확인

## Phase 2: 공유 유틸 및 로깅 정리
- [x] `VideoUtils` 공유 유틸 추가
- [x] `LoggerManager` 추가
- [x] 파일명, 차단 도메인, MIME/HLS 판별, yt-dlp 명령 생성 로직 분리

## Phase 3: 서비스워커 안정성 개선
- [x] MV3 서비스워커 전역 상태를 `chrome.storage.session`과 동기화
- [x] `Referer` 캡처에 `extraHeaders` 적용
- [x] DNR 동적 규칙 생성/삭제 관리 개선
- [x] DNR 적용 완료 후 offscreen 다운로드 시작

## Phase 4: 팝업 보안 및 UX 개선
- [x] 네트워크/페이지 유래 문자열의 `innerHTML` 직접 삽입 제거
- [x] 실제 referer 기반 yt-dlp 명령 복사 지원
- [x] 다운로드 상태 복원 로직 유지

## Phase 5: 검증 및 문서 반영
- [x] Node 문법 검사 통과
- [x] 테스트 통과
- [x] AGENTS.md 구현 내역 반영
