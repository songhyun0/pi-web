# 05. Web keybinding registry, /hotkeys, external editor 기반

## 메타데이터

- 우선순위: P1
- 선행 작업: 00
- 이유: CLI shortcut 개인화와 extension `registerShortcut` 호환의 공통 기반이다.

## 목적

`~/.pi/agent/keybindings.json` 기반 shortcut registry를 pi-web에 도입하고, `/hotkeys`에서 실제 활성 shortcut과 conflict를 보여준다. CLI의 `Ctrl+G` external editor UX는 브라우저 제약을 고려해 우선 fullscreen prompt editor modal로 대체한다.

## 배경/문제

CLI는 `keybindings.json`과 `/hotkeys`로 현재 shortcut을 설명하고 바꿀 수 있다. pi-web은 ChatInput과 여러 modal에 직접 key handler가 흩어져 있고, CLI keybinding 설정을 그대로 반영하지 않는다. 이 상태에서는 extension `registerShortcut()` 브릿지도 붙이기 어렵다.

## 범위

- web keybinding registry 추가
- key parser/normalizer와 browser `KeyboardEvent` matcher 구현
- scope: global, chatInput, autocomplete, modal, tree, extension
- `ChatInput`, `BranchNavigator`, modal selector의 주요 handler를 action id 기반으로 정리
- `/hotkeys`를 `client-ui`로 전환하고 modal 추가
- Hotkeys modal에 action id, key, scope, source, owner, conflict/status 표시
- `app.editor.external` shortcut으로 fullscreen prompt editor modal 열기
- extension shortcut 연결을 위한 `owner`/`source` 타입 준비

## 구현 순서

1. CLI keybinding id와 web action id 매핑표를 만든다.
2. `lib/web-keybindings.ts`에 parser, normalizer, matcher를 구현한다.
3. `GET /api/keybindings` 또는 runtime settings API 확장으로 keybindings config를 읽는다.
4. ChatInput의 Enter, Shift+Enter, slash menu, `@` menu handler를 registry 기반으로 옮긴다.
5. modal selector와 tree navigation handler를 registry 기반으로 옮긴다.
6. `/hotkeys` slash command와 Hotkeys modal을 추가한다.
7. fullscreen prompt editor modal을 구현하고 `app.editor.external`에 연결한다.
8. extension shortcut bridge가 붙을 slot을 노출한다.

## 관련 파일

- `components/ChatInput.tsx`
- `components/SessionCommandModals.tsx`
- `components/BranchNavigator.tsx`
- `components/AppShell.tsx`
- `lib/slash-command-registry.ts`
- `hooks/useAgentSession.ts`
- `lib/extension-ui-bridge.ts`

## 검증

- 기본 ChatInput shortcut이 기존처럼 동작한다.
- `keybindings.json` 변경 후 reload/refresh로 web registry가 갱신된다.
- `/hotkeys`가 실제 등록된 action, source, owner, conflict를 표시한다.
- `Ctrl+G`가 긴 프롬프트 편집 modal을 열고 save/cancel/focus 동작이 정상이다.
- browser reserved shortcut이 active shortcut처럼 표시되지 않는다.
- tree/fork modal navigation이 keybinding override를 반영한다.
- `node_modules/.bin/tsc --noEmit`와 `npm run lint`를 통과한다.

## 리스크/주의사항

- 브라우저 예약 shortcut은 OS/브라우저별로 다르다. “지원되지 않음” 상태를 명시해야 한다.
- IME composition 중 shortcut을 가로채면 한글/중국어/일본어 입력이 깨질 수 있다.
- textarea native editing shortcut을 과하게 막으면 사용자 경험이 나빠진다.

## 완료 기준

pi-web 주요 keyboard handler가 공통 action id matcher를 사용하고, `/hotkeys`가 실제 web runtime shortcut 상태를 정확히 표시한다.
