# 06. Extension TUI no-op 축소: shortcut, autocomplete, editor, header/footer/theme

## 메타데이터

- 우선순위: P0
- 선행 작업: 04, 05
- 이유: CLI 확장이 웹에서 실질적으로 동작하려면 `ExtensionUiBridge`의 silent no-op API를 줄여야 한다.

## 목적

pi CLI 확장의 TUI API가 pi-web에서도 동작하거나 명확히 degraded 상태를 보고하게 만든다. `lib/extension-ui-bridge.ts`는 React를 import하지 않고 protocol event와 state만 emit해야 한다.

## 배경/문제

pi-web은 select/confirm/input/editor dialog, notify, status, widget, custom ANSI panel 일부를 지원한다. 하지만 `addAutocompleteProvider`, `setEditorComponent`, `setFooter`, `setHeader`, `setWorkingIndicator`, theme switching, `registerShortcut` 등 CLI extension 생태계에서 중요한 API가 no-op이거나 degraded 상태다. CLI에서 정상 동작하는 plugin이 web에서 조용히 무시되면 디버깅이 어렵다.

## 범위

- `pi.registerShortcut()`을 web keybinding registry와 연결
- `ctx.ui.addAutocompleteProvider()`를 ChatInput autocomplete source layer와 연결
- `ctx.ui.setHeader()`, `setFooter()`, `setWorkingMessage()`, `setWorkingVisible()`, `setWorkingIndicator()`를 Extension UI 영역에 표시
- `getEditorText()`, `setEditorText()`, `pasteToEditor()`, `setEditorComponent()`의 textarea adapter 제공
- theme API를 web theme/runtime settings와 가능한 범위에서 매핑
- extension별 supported/degraded/no-op compatibility report 제공

## 구현 순서

1. 현재 no-op API 목록을 `ExtensionUiBridge`에서 inventory로 정리한다.
2. `registerShortcut` 이벤트/상태를 keybinding registry에 전달한다.
3. ChatInput autocomplete provider chain을 설계하고 extension provider를 연결한다.
4. editor snapshot adapter를 만들어 `getEditorText`와 `setEditorText`를 실제 입력 상태와 동기화한다.
5. header/footer/working indicator 전용 extension UI region을 만든다.
6. theme API를 dark/light web theme에 우선 매핑한다.
7. unsupported/degraded 호출은 compatibility report와 warning event로 남긴다.
8. reload/fork/destroy 시 extension UI state cleanup을 검증한다.

## 관련 파일

- `lib/extension-ui-bridge.ts`
- `components/ExtensionUiHost.tsx`
- `components/ChatInput.tsx`
- `hooks/useAgentSession.ts`
- `lib/pi-types.ts`
- `components/AppShell.tsx`
- `docs/extension-ui-compatibility.md`

## 검증

- 샘플 extension으로 shortcut 등록과 실행이 동작한다.
- autocomplete 제안과 completion 적용이 동작한다.
- footer/header/status/widget/working indicator가 표시된다.
- `getEditorText()`가 최신 editor snapshot을 반환한다.
- `setEditorComponent()` 호출 시 degraded notice/report가 표시된다.
- custom ANSI panel, dialog, status, widget 기존 기능이 회귀하지 않는다.
- `setTheme("dark" | "light")`는 web theme에 반영되고 custom theme는 명확한 degraded/failure를 반환한다.
- `node_modules/.bin/tsc --noEmit`와 `npm run lint`를 통과한다.

## 리스크/주의사항

- 완전한 TUI terminal parity는 목표가 아니다. 지원/미지원 경계를 명확히 해야 한다.
- autocomplete provider는 async/stale response 문제를 만들기 쉽다. request id와 timeout이 필요하다.
- custom editor는 React textarea와 pi-tui component model 차이가 크므로 처음부터 완전 재현을 목표로 하지 않는다.

## 완료 기준

이번 범위의 extension UI API가 더 이상 조용히 no-op 되지 않고, 지원 여부가 state/report/UI에서 관찰 가능하다.
