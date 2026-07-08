# 09. /share private GitHub gist 공유

## 메타데이터

- 우선순위: P1
- 선행 작업: 08
- 이유: 외부 GitHub 권한과 민감정보 업로드 경고가 필요하므로 import/export 검증 기반 뒤에 구현한다.

## 목적

`/share`를 통해 현재 세션 HTML export를 GitHub private gist로 업로드하고 공유 링크를 제공한다. 업로드 전 민감정보 경고와 preview를 반드시 제공한다.

## 배경/문제

CLI `/share`는 session HTML을 private gist로 올려 공유 가능한 링크를 만든다. pi-web은 세션을 보기 좋게 렌더링하지만 공유 command가 unsupported라 협업이나 이슈 공유 단계에서 CLI로 돌아가야 한다.

## 범위

- `/share` slash command를 `client-ui`로 전환
- 기존 `/api/sessions/[id]/export` HTML 생성 로직을 공통 helper로 분리
- share preview API 추가
- private gist 생성 API 추가
- 1차 인증 방식은 로컬 `gh` CLI 사용
- share viewer URL, gist URL, 파일명, 크기, checksum 표시
- copy-to-clipboard 제공
- 인증 실패, `gh` 미설치, network/rate limit 실패를 retry 가능한 상태로 표시

## 구현 순서

1. export HTML 생성 helper를 분리한다.
2. share preview modal을 만든다.
3. 민감정보 경고와 확인 체크박스를 추가한다.
4. `gh` CLI 사용 가능 여부 API를 만든다.
5. private gist 생성 API를 구현한다.
6. 업로드 결과 링크와 copy action을 표시한다.
7. 실패 케이스별 복구 안내를 추가한다.

## 관련 파일

- `lib/slash-command-registry.ts`
- `hooks/useAgentSession.ts`
- `app/api/sessions/[id]/export/route.ts`
- `app/api/sessions/[id]/share/route.ts` 신규
- `components/AppShell.tsx`
- `lib/clipboard.ts`

## 검증

- `/share` 입력 시 업로드 전 경고와 preview가 표시된다.
- 확인 체크 전에는 gist 생성 버튼이 비활성화된다.
- GitHub CLI 로그인 환경에서 private gist가 생성되고 share URL과 gist URL이 표시된다.
- share URL copy가 동작하고 실패 시 수동 복사 경로가 있다.
- 인증 실패, `gh` 미설치, 네트워크 실패에서 token이 노출되지 않는다.
- export HTML이 기존 `/export` 다운로드 결과와 의미 있게 동일하다.
- `node_modules/.bin/tsc --noEmit`와 `npm run lint`를 통과한다.

## 리스크/주의사항

- private gist라도 세션 내용에는 secret이 포함될 수 있다. 사용자 확인을 강하게 요구한다.
- GitHub token은 응답·로그·client state에 절대 노출하지 않는다.
- public gist는 MVP에서 제외한다.

## 완료 기준

사용자가 명시적으로 민감정보 가능성을 확인한 뒤에만 private gist 업로드가 실행되고, 생성된 공유 링크를 안전하게 복사할 수 있다.
