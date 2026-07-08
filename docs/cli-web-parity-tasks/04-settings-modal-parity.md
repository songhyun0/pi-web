# 04. 진짜 /settings 허브와 runtime 설정 UI

## 메타데이터

- 우선순위: P0
- 선행 작업: 02, 03
- 이유: trust fallback, thinking, compaction, retry, message delivery, transport를 웹에서 바꿀 수 있어야 CLI와 동일한 런타임 제어가 가능하다.

## 목적

pi-web의 `/settings`를 모델 설정 진입점이 아니라 Pi runtime settings hub로 전환한다. 같은 모달 안에서 Pi runtime settings, pi-web app settings, Models/Auth 진입점을 명확히 분리한다.

## 배경/문제

CLI `/settings`는 runtime 동작을 바꾸는 중심 UI다. 반면 pi-web의 `/settings`는 현재 `openModelsConfig`에 가까우며, 별도 `SettingsModal`은 `web-settings.json` display name 중심이다. 사용자는 CLI 문서를 보고 설정을 기대하지만 web에서는 찾을 수 없다.

## 범위

- `SettingsModal`을 hub 구조로 개편
- `/settings` slash command를 `openSettings`로 연결
- `/model`, `/scoped-models`, `/login`, `/logout`은 기존 Models/Auth 흐름 유지
- Runtime 섹션에 thinking, steering/follow-up, transport, compaction, retry, `defaultProjectTrust` 제공
- Web app 섹션에 기존 displayName 설정 유지
- 각 설정에 즉시 적용, 다음 요청부터, `/reload` 필요, 새 session 필요 상태 표시
- 저장 실패 시 파일 경로와 오류 표시

## 구현 순서

1. `SlashUiAction`에 `openSettings`를 추가하고 AppShell state를 연결한다.
2. `SettingsModal`을 탭/섹션 구조로 바꾼다.
3. Runtime settings API를 연결해 global/project/effective 값을 표시한다.
4. 각 설정별 control을 추가한다.
5. 저장/초기화/reset 동작을 구현한다.
6. active session에 즉시 반영 가능한 setting은 `sendAgentCommand`로 반영한다.
7. reload/new session 필요 setting은 badge와 안내를 표시한다.
8. 기존 ModelsConfig, SkillsConfig, PluginsConfig로 이동하는 entry point를 제공한다.

## 관련 파일

- `components/SettingsModal.tsx`
- `components/AppShell.tsx`
- `hooks/useAgentSession.ts`
- `lib/slash-command-registry.ts`
- `app/api/runtime-settings/route.ts`
- `lib/rpc-manager.ts`

## 검증

- `/settings`가 runtime settings hub를 연다.
- `/model`은 기존 model flow를 유지한다.
- displayName 설정 UI가 계속 동작한다.
- `defaultProjectTrust` 변경 후 trust API fallback이 즉시 달라진다.
- compaction/retry/message delivery 설정 저장 후 active session 또는 reload/new session에서 반영된다.
- 저장 실패 시 partial success처럼 보이지 않고 파일 path와 오류가 표시된다.
- `node_modules/.bin/tsc --noEmit`와 `npm run lint`를 통과한다.

## 리스크/주의사항

- `SettingsModal`이 너무 커지면 유지보수가 어려우므로 runtime/app/integrations 섹션을 분리한다.
- model 선택과 default model 설정은 혼동하기 쉽다. “현재 session model”과 “새 session 기본값”을 구분한다.
- 브라우저 theme와 CLI theme는 완전 동일하지 않을 수 있다.

## 완료 기준

사용자가 `/settings`에서 P0 runtime settings를 조회·저장하고 적용 범위를 이해할 수 있으며, 기존 web app settings와 Models/Auth UX가 유지된다.
