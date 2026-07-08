# 12. 낮은 영향 slash command polish: /changelog, /quit, unsupported 안내

## 메타데이터

- 우선순위: P3
- 선행 작업: 00
- 이유: 핵심 parity 이후 남는 낮은 영향 command 차이를 정리해 사용자가 unsupported 상태를 고장으로 오해하지 않게 한다.

## 목적

`/changelog`, `/quit`, unsupported built-in notice, slash palette 표시 상태를 정리한다. 기능 가치보다 정확한 안내와 실제 동작 상태 일치가 중요하다.

## 배경/문제

CLI built-in slash command 목록에는 `/changelog`, `/quit`도 포함된다. pi-web에서는 브라우저 환경상 `/quit`이 직접 대응되기 어렵고, `/changelog`도 현재 unsupported다. 낮은 영향이지만 palette나 직접 입력 시 안내가 부정확하면 사용자가 기능 고장으로 이해할 수 있다.

## 범위

- `/changelog`를 modal UI command로 구현
- package version과 CHANGELOG 또는 release fallback 표시
- `/quit`은 브라우저 환경 안내 command로 처리
- running session을 abort/destroy/disconnect하지 않음
- unsupported built-in command notice를 중앙화
- 각 command 안내에 대체 UI, CLI 사용 경로, 후속 작업 상태 포함
- `docs/slash-commands-plan.md`와 새 task docs 상태 동기화

## 구현 순서

1. unsupported command message helper를 중앙화한다.
2. `/changelog` registry mode를 `client-ui`로 전환한다.
3. package version/changelog read API를 추가한다.
4. Changelog modal을 구현한다.
5. `/quit`은 browser limitation 안내 command로 구현한다.
6. slash palette에서 supported/unsupported 표시 정책을 정리한다.
7. docs 상태를 업데이트한다.

## 관련 파일

- `lib/slash-command-registry.ts`
- `hooks/useAgentSession.ts`
- `components/AppShell.tsx`
- `docs/slash-commands-plan.md`
- `next.config.ts`

## 검증

- `/changelog` modal이 현재 설치 package version과 changelog 또는 release fallback을 표시한다.
- `/quit` 입력 시 안전한 브라우저 환경 안내가 표시되고 running session이 중단되지 않는다.
- `/share`, `/import`, `/trust` 등 unsupported built-in을 직접 입력하면 대체 경로가 포함된 안내가 표시된다.
- `/some-extension-command` 같은 unknown command는 pass-through된다.
- slash palette의 지원/미지원 상태가 실제 동작과 일치한다.
- 기존 `/compact`, `/name`, `/session`, `/copy`, `/reload`, `/export`가 회귀하지 않는다.
- `node_modules/.bin/tsc --noEmit`와 `npm run lint`를 통과한다.

## 리스크/주의사항

- `/quit`에서 `window.close()`를 시도하면 브라우저 정책상 실패하고 UX가 나빠진다.
- changelog 파일 경로를 사용자 입력으로 받으면 file read 취약점이 생긴다. package 내부 고정 후보만 읽는다.
- unsupported command를 palette에 보일지 숨길지 정책이 흔들리면 사용자 혼란이 생긴다.

## 완료 기준

낮은 영향 built-in slash command의 웹 동작과 안내가 정리되고, unsupported 상태가 사용자에게 명확히 설명되며, extension/prompt/skill pass-through가 유지된다.
