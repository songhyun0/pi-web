# 08. /import JSONL 세션 가져오기

## 메타데이터

- 우선순위: P1
- 선행 작업: 00
- 이유: pi-web은 세션 브라우징이 강점이므로 CLI나 다른 머신에서 만든 JSONL 세션을 안전하게 가져올 수 있어야 한다.

## 목적

`/import`를 지원해 `.jsonl` 세션 파일을 업로드하거나 서버 경로로 지정하고, 검증된 세션 파일을 pi 세션 저장소에 복사한 뒤 sidebar에 표시하고 자동으로 연다.

## 배경/문제

CLI는 `/import <file>`로 session JSONL을 가져와 이어서 작업할 수 있다. pi-web은 세션 탐색 UI가 있음에도 import가 unsupported라서 외부 세션을 웹으로 가져오기 어렵다.

## 범위

- `/import` slash command를 `client-ui`로 전환
- upload 또는 server path 입력 UI 제공
- `POST /api/sessions/import` 추가
- JSONL session header 검증: `type`, `version`, `id`, `timestamp`, `cwd`, `parentSession`
- entry line JSON parse와 최소 필드 검증
- session id/path 충돌 시 copy/rename 정책
- import 후 sidebar/session cache refresh와 imported session open
- malformed JSONL, 너무 큰 파일, 권한 오류에 대한 오류 UX

## 구현 순서

1. import modal UX를 설계한다. upload와 server path 중 MVP 범위를 정한다.
2. JSONL validator를 만든다.
3. target cwd 선택/검증을 추가한다.
4. session id 충돌 처리 정책을 구현한다.
5. 안전한 write path를 계산해 session store에 저장한다.
6. `cacheSessionPath`와 sidebar refresh를 연결한다.
7. slash command `/import`를 modal open으로 연결한다.

## 관련 파일

- `lib/slash-command-registry.ts`
- `hooks/useAgentSession.ts`
- `components/AppShell.tsx`
- `app/api/sessions/import/route.ts` 신규
- `lib/session-reader.ts`
- `lib/session-file-references.ts`
- `app/api/sessions/route.ts`

## 검증

- 유효한 JSONL을 import하면 sidebar에 나타나고 자동으로 열린다.
- 동일 JSONL을 두 번 import해도 overwrite 없이 새 세션이 만들어진다.
- malformed JSONL은 line/detail 오류를 표시하고 기존 세션을 손상시키지 않는다.
- branch, model_change, compaction, tool call 표시가 유지된다.
- header `cwd`가 `/`인 악의적 JSONL이 file access allowlist를 넓히지 않는다.
- 허용 루트 밖 server path는 403으로 거절된다.
- `node_modules/.bin/tsc --noEmit`를 통과한다.

## 리스크/주의사항

- import 과정에서 extension이나 package를 실행하면 안 된다.
- 외부 JSONL의 cwd를 그대로 신뢰하면 파일 접근 범위가 넓어질 수 있다.
- parentSession 경로는 display metadata이므로 깨져 있어도 warning으로 처리한다.

## 완료 기준

`/import`가 실행 가능한 UI command가 되고, 검증된 JSONL만 안전한 target cwd로 가져와 기존 세션 렌더링 경로에서 열 수 있다.
