# 00. CLI-Web 격차 해소 구현 순서 개요

## 목적

이 문서는 `docs/cli-web-gap-analysis.md`의 P0~P3 항목을 구현 가능한 작업 단위로 재정렬하고, 이후 문서가 따를 의존성·검증·회귀 기준을 고정한다.

## 구현 원칙

- 보안 게이트인 Project trust를 가장 먼저 닫는다.
- 런타임 설정 데이터 계층을 만든 뒤 UI를 연결한다.
- 확장 UI 호환성은 trust와 설정 기반이 준비된 뒤 확장한다.
- extension, prompt template, skill slash command pass-through는 전역 불변조건이다.
- 개발 중 `next build`는 실행하지 않는다.
- 완료 기준은 “UI가 보인다”가 아니라 CLI 의미론, 보안, 회귀 검증을 포함해야 한다.

## 구현 순서

| 번호 | 문서 | 우선순위 | 선행 작업 | 주제 |
|---:|---|---|---|---|
| 00 | `00-overview.md` | Meta | - | 전체 순서와 검증 원칙 |
| 01 | `01-project-trust-data-api.md` | P0 | 00 | Project trust 상태 조회·저장 API |
| 02 | `02-project-trust-ui-runtime.md` | P0 | 01 | `/trust` UI와 reload 연동 |
| 03 | `03-runtime-settings-data-layer.md` | P0 | 01 | CLI `/settings`용 런타임 설정 데이터 계층 |
| 04 | `04-settings-modal-parity.md` | P0 | 02, 03 | 진짜 `/settings` 허브와 runtime 설정 UI |
| 05 | `05-web-keybindings-hotkeys-editor.md` | P1 | 00 | Web keybinding registry, `/hotkeys`, 긴 프롬프트 편집기 |
| 06 | `06-extension-ui-compat-bridges.md` | P0 | 04, 05 | Extension TUI no-op 축소 |
| 07 | `07-user-bash-prefix.md` | P1 | 02 | `!cmd` / `!!cmd` 사용자 bash UX |
| 08 | `08-session-import.md` | P1 | 00 | `/import` JSONL 세션 가져오기 |
| 09 | `09-session-share-gist.md` | P1 | 08 | `/share` private GitHub gist 공유 |
| 10 | `10-tree-label-filter-fold.md` | P2 | 05 | `/tree` label, filter, fold, search |
| 11 | `11-session-launch-profiles.md` | P2 | 02, 04 | CLI run option 대응용 launch profile |
| 12 | `12-low-impact-slash-polish.md` | P3 | 00 | 낮은 영향 slash command polish |

## 관련 파일

- Slash command: `lib/slash-command-registry.ts`, `hooks/useAgentSession.ts`
- 세션 런타임: `lib/rpc-manager.ts`, `lib/pi-types.ts`, `lib/types.ts`
- 입력 UX: `components/ChatInput.tsx`, `components/SessionCommandModals.tsx`, `components/BranchNavigator.tsx`
- 설정/모델/플러그인: `components/SettingsModal.tsx`, `components/ModelsConfig.tsx`, `components/PluginsConfig.tsx`, `components/SkillsConfig.tsx`
- 확장 UI: `lib/extension-ui-bridge.ts`, `components/ExtensionUiHost.tsx`
- 세션 파일: `lib/session-reader.ts`, `lib/normalize.ts`, `app/api/sessions/*`
- 파일 접근과 worktree: `lib/file-access.ts`, `lib/worktree.ts`

## 공통 검증

- `node_modules/.bin/tsc --noEmit`
- `npm run lint`
- `npm run dev`로 slash command, API, modal, SSE 시나리오 수동 검증
- `next build` 실행 금지

## 공통 회귀 시나리오

- 알 수 없는 slash command가 계속 AgentSession으로 pass-through되는지 확인한다.
- `/compact`, `/name`, `/session`, `/copy`, `/reload`, `/export`, `/tree` 기존 동작을 확인한다.
- SSE reconnect, visibility/online reconciliation, late event 무시가 유지되는지 확인한다.
- fork 후 old wrapper가 오염되지 않는지 확인한다.
- no-tools 세션과 tool allow-list 동작이 회귀하지 않는지 확인한다.
- trust 전 project-local extension/package/skill이 실행되지 않는지 확인한다.
- API key, GitHub token, gist 관련 secret이 응답·로그·UI에 노출되지 않는지 확인한다.

## 완료 기준

모든 하위 문서가 위 표에 포함되어 있고, 번호가 00부터 12까지 빠짐없이 이어지며, P0 보안·런타임 작업이 P1/P2 편의 기능보다 앞선다. dependency cycle이 없고, 각 문서가 범위·구현 메모·검증 기준을 포함한다.
