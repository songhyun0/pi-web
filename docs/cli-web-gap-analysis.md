# pi CLI와 pi-web 기능 차이 분석

작성 기준: 현재 `repos/pi-web` 코드와 `@earendil-works/pi-coding-agent` 문서/SDK 기준.

이 문서는 **pi CLI에는 있지만 pi-web에는 없거나 구현 방식이 다른 기능** 중, 사용자 영향이 큰 항목을 정리한다. 단순히 “없음”만 나열하지 않고, 각 기능이 CLI에서 정확히 무엇을 하는지, pi-web에서는 현재 어떻게 보이는지, 왜 중요한지, 구현 시 어떤 방향이 현실적인지까지 설명한다.

## 요약

| 우선순위 | 항목 | pi-web 현재 상태 | 핵심 영향 |
|---|---|---|---|
| P0 | Project trust / `/trust` | slash command unsupported | 프로젝트 로컬 설정/확장/스킬을 안전하게 로드할지 결정하는 보안·기능 게이트가 웹 UI에 없음 |
| P0 | `/settings` parity | web app display name 설정 중심. CLI 설정 대부분 미노출 | thinking, theme, message delivery, transport, compaction, retry 등 핵심 런타임 설정을 웹에서 조정하기 어려움 |
| P0 | Extension TUI 완전 호환 | compatibility bridge 일부 구현, 여러 API no-op | CLI 플러그인/확장이 웹에서 제한적으로만 동작 |
| P1 | `!cmd` / `!!cmd` user bash | 입력 UX 없음 | CLI의 빠른 셸 실행 및 결과 컨텍스트 주입 워크플로우 부재 |
| P1 | `/import`, `/share` | unsupported | 세션 이동/공유/협업 UX 차이 |
| P1 | keybindings, `/hotkeys`, external editor | 대부분 미지원 | 파워유저 생산성·접근성·개인화 차이 |
| P2 | `/tree` 고급 기능 | 기본 branch selector는 있음 | labels, filter modes, fold/unfold 등 CLI tree workflow와 차이 |
| P2 | CLI 실행 옵션/모드 | 웹 UI에 대부분 대응 없음 | 자동화·일회성 실행·정밀 리소스 로딩은 CLI에 의존 |
| P3 | `/changelog`, `/quit` | unsupported | 낮은 영향. 안내 수준이면 충분 |

## 1. Project trust / `/trust` (P0)

### CLI에서 trust가 의미하는 것

`trust`는 단순히 “이 폴더를 파일 탐색기로 열 수 있는가”가 아니다. pi에서 trust는 **프로젝트 로컬 리소스를 로드하고 실행해도 되는지**를 결정하는 보안 게이트다.

프로젝트 안에는 다음처럼 사용자/모델 실행에 영향을 주는 파일이 있을 수 있다.

- `.pi/settings.json`
  - 프로젝트별 모델, 도구, 패키지, 리소스 경로 등을 바꿀 수 있다.
- `.pi/extensions/`
  - TypeScript extension이 로드될 수 있다.
  - extension은 임의 코드 실행 권한을 가진다.
- `.pi/skills/`, `.agents/skills/`
  - 프로젝트별 skill이 로드될 수 있다.
- `.pi/prompts/`, `.pi/themes/`
  - 프로젝트별 prompt template, theme이 로드될 수 있다.
- project-local pi packages
  - package 설치/로드 과정에서 extension, skill, prompt, theme이 추가될 수 있다.

CLI interactive mode에서는 신뢰 결정이 없는 프로젝트를 열 때, pi가 사용자에게 “이 프로젝트의 로컬 리소스를 trust할지” 묻는다. 사용자가 trust하면 해당 프로젝트의 `.pi` 리소스와 project-local extension/package를 사용할 수 있다.

신뢰 결정은 보통 `~/.pi/agent/trust.json`에 저장된다. `/trust` command는 현재 프로젝트 또는 상위 폴더에 대한 trust 결정을 저장해서, 다음 세션부터 다시 묻지 않게 하는 역할을 한다.

### 왜 보안 기능인가

project-local extension은 일반 npm 패키지나 스크립트처럼 **로컬 머신 권한으로 실행될 수 있다**. 예를 들어 악성 저장소가 `.pi/extensions/malicious.ts`를 포함하고 있다면, 이를 자동으로 로드하는 것은 위험하다.

그래서 CLI는 다음 원칙을 둔다.

1. 사용자/global extension은 먼저 로드할 수 있다.
2. 프로젝트 로컬 extension/settings/packages는 trust가 확인된 뒤에만 로드한다.
3. trust decision이 없으면 interactive CLI에서는 묻는다.
4. non-interactive mode에서는 묻지 못하므로 `defaultProjectTrust` 설정 또는 `--approve` / `--no-approve` 플래그를 따른다.

### pi-web 현재 상태

pi-web에는 `/trust` built-in command가 registry에는 있지만 `unsupported`로 표시된다.

관련 파일:

- `lib/slash-command-registry.ts`
  - `trust`가 `mode: "unsupported"`로 등록되어 있음.
- `hooks/useAgentSession.ts`
  - `/trust` 입력 시 “Project trust changes are not implemented...” 안내.
- `README.md`, `AGENTS.md`
  - pi-web은 SDK/`AgentSession`을 in-process로 생성해서 구동한다.

즉, pi-web은 현재 브라우저에서 “이 프로젝트를 trust할까요?”라는 CLI와 같은 명시적 UX를 제공하지 않는다.

### 사용자에게 생기는 문제

#### 1. 프로젝트 extension/skill이 왜 안 뜨는지 알기 어렵다

어떤 저장소에 `.pi/extensions/`나 `.agents/skills/`가 있는데 trust decision이 없고 `defaultProjectTrust`가 `ask` 또는 `never`라면, 해당 리소스가 로드되지 않을 수 있다. CLI에서는 prompt가 뜨지만, web에서는 사용자가 원인을 알기 어렵다.

예상 증상:

- CLI에서는 `/my-command`가 보이는데 pi-web에서는 slash palette에 안 보임.
- CLI에서는 project skill이 자동 로드되는데 pi-web에서는 skill 목록에 없음.
- project `.pi/settings.json`에 지정한 모델/패키지 설정이 web session에 반영되지 않음.

#### 2. 반대로 너무 넓게 trust될 위험도 있다

전역 설정 `defaultProjectTrust`가 `always`라면, web에서도 프로젝트 로컬 리소스가 사용자 확인 없이 로드될 수 있다. CLI는 처음 접근 시 사용자가 의식적으로 확인하는 UX가 있지만, web은 그 맥락이 약하다.

#### 3. `/trust`로 저장/변경할 수 없다

CLI에서는 `/trust`로 현재 프로젝트와 상위 폴더에 대한 trust decision을 저장할 수 있다. pi-web에서는 이 decision을 브라우저에서 저장하거나 변경하는 UI가 없다.

### pi-web에 필요한 기능

우선순위 높은 구현은 다음이다.

1. **trust 상태 조회 API**
   - 현재 cwd가 trusted인지, saved decision이 있는지, fallback이 `ask/always/never` 중 무엇인지 보여준다.
2. **trust decision 저장 API**
   - CLI `/trust`와 동일하게 `~/.pi/agent/trust.json`을 갱신한다.
   - “이 폴더만 trust”와 “상위 폴더까지 trust” 선택이 필요하다.
3. **web UI 경고/확인 모달**
   - 프로젝트에 `.pi/settings.json`, `.pi/extensions`, `.agents/skills` 등이 있고 trust decision이 없으면 명확히 알려준다.
4. **reload 연동**
   - trust decision을 저장한 뒤에는 현재 runtime에 자동 반영할지, 아니면 CLI처럼 “restart/reload 필요”라고 안내할지 결정해야 한다.
5. **session cwd 변경 대응**
   - `/resume` 또는 기존 session open으로 cwd가 바뀌는 경우도 trust 상태를 다시 확인해야 한다.

## 2. `/settings` parity (P0)

### CLI에서 `/settings`가 하는 일

CLI `/settings`는 단순 앱 설정이 아니라, pi runtime 동작을 바꾸는 주요 설정 허브다. 대표적으로 다음을 다룬다.

- thinking level 기본값
- theme
- message delivery
  - steeringMode
  - followUpMode
- provider transport
  - sse, websocket, auto 등
- auto-compaction 설정
- retry 설정
- project trust fallback
  - `defaultProjectTrust`: ask, always, never
- editor/display 관련 설정
- scoped models / model cycling과 연결되는 설정

### pi-web 현재 상태

pi-web에는 `SettingsModal`이 있지만, 현재 주요 내용은 `~/.pi/agent/web-settings.json`에 저장되는 pi-web 자체 display name 설정이다.

관련 파일:

- `components/SettingsModal.tsx`
- `app/api/app-settings/route.ts`
- `lib/app-settings.ts`

반면 CLI의 핵심 설정은 `~/.pi/agent/settings.json` 및 `.pi/settings.json`에 저장된다. pi-web의 `/settings` slash command도 현재 `openModelsConfig` 쪽으로 연결되어 있어, CLI `/settings`와 의미가 다르다.

관련 파일:

- `hooks/useAgentSession.ts`
  - `case "settings"`가 `openModelsConfig`로 연결됨.

### 사용자에게 생기는 문제

- CLI에서 조절 가능한 compaction/retry/message delivery를 web에서는 찾기 어렵다.
- Enter/Alt+Enter 큐 처리 방식과 settings의 관계가 명확하지 않다.
- `defaultProjectTrust`를 web에서 바꿀 수 없어 trust 문제 해결 경로가 없다.
- transport 관련 문제가 생겨도 web에서 설정 변경이 어렵다.

### pi-web에 필요한 기능

1. CLI settings와 web settings를 UI에서 구분한다.
   - 예: “Pi runtime settings” vs “pi-web app settings”
2. `SettingsManager` 기반으로 `settings.json`을 읽고 쓴다.
3. 최소 P0 설정부터 노출한다.
   - `defaultThinkingLevel`
   - `compaction.enabled`
   - `steeringMode`
   - `followUpMode`
   - `transport`
   - `defaultProjectTrust`
   - `retry.enabled`
4. 설정 변경 후 현재 session runtime에 즉시 반영 가능한 항목과 reload/restart가 필요한 항목을 구분한다.

## 3. Extension TUI 완전 호환 (P0)

### CLI에서 extension UI가 가능한 것

pi CLI extension은 `ctx.ui`를 통해 매우 많은 TUI 확장을 할 수 있다.

예시:

- `ctx.ui.select`, `confirm`, `input`, `editor`
- `ctx.ui.custom()`으로 복잡한 TUI 컴포넌트 표시
- `ctx.ui.setWidget()`으로 editor 위/아래에 위젯 표시
- `ctx.ui.setStatus()`로 footer status 표시
- `ctx.ui.setFooter()` / `setHeader()`로 footer/header 교체
- `ctx.ui.setEditorComponent()`로 vim mode 같은 custom editor 적용
- `ctx.ui.addAutocompleteProvider()`로 `#123`, `$env` 같은 커스텀 autocomplete 추가
- `pi.registerShortcut()`으로 extension 전용 shortcut 등록
- `ctx.ui.setTheme()`, `getAllThemes()` 등 theme 제어

### pi-web 현재 상태

pi-web에는 `ExtensionUiBridge`가 있어 RPC-style extension UI 일부를 브라우저에서 렌더링한다.

지원되는 것:

- select/confirm/input/editor dialog
- notify
- status
- widget 일부
- custom UI를 ANSI-aware monospace line panel로 렌더링

하지만 다음은 no-op 또는 제한적이다.

- `addAutocompleteProvider()` no-op
- `setEditorComponent()` no-op
- `setFooter()` no-op
- `setHeader()` no-op
- `setWorkingIndicator()` no-op
- `getEditorText()` 빈 문자열 반환
- theme switching 미지원
- `registerShortcut()` 브라우저 shortcut registry 없음
- 복잡한 terminal/TUI overlay, focus, mouse, alternate screen 등은 degrade

관련 파일:

- `lib/extension-ui-bridge.ts`
- `components/ExtensionUiHost.tsx`
- `docs/extension-ui-compatibility.md`

### 사용자에게 생기는 문제

CLI에서 잘 동작하는 extension이 pi-web에서는 다음처럼 보일 수 있다.

- slash command는 보이지만 UI가 제대로 안 뜸.
- plan mode extension의 shortcut이 동작하지 않음.
- custom editor extension이 무시됨.
- autocomplete extension이 동작하지 않음.
- footer/status 기반 extension이 일부 정보만 보임.
- theme 관련 extension이 실패함.

### pi-web에 필요한 기능

1. Extension shortcut registry
   - `pi.registerShortcut()`을 web key handler와 연결.
2. Autocomplete provider bridge
   - ChatInput의 `/` 및 `@` autocomplete 위에 extension provider를 layer로 추가.
3. Custom editor bridge
   - `setEditorComponent()`를 React input/editor와 연결할 수 있는 추상화 필요.
4. Header/footer/status parity
   - CLI footer 전체 교체는 어렵더라도 “extension footer region”부터 제공 가능.
5. Theme API bridge
   - web theme와 pi theme API 간 매핑.
6. Compatibility report
   - extension별로 “지원됨 / degrade / no-op”을 UI에 표시하면 디버깅이 쉬워진다.

## 4. `!cmd` / `!!cmd` user bash (P1)

### CLI에서의 기능

CLI editor에서 다음처럼 입력할 수 있다.

- `!ls -la`
  - shell command를 실행한다.
  - 출력이 다음 LLM 컨텍스트에 포함된다.
- `!!ls -la`
  - shell command를 실행한다.
  - 출력은 화면에는 보지만 LLM 컨텍스트에는 넣지 않는다.

extension은 `user_bash` event를 통해 이 동작을 가로채거나 SSH/컨테이너/샌드박스로 우회할 수 있다.

### pi-web 현재 상태

ChatInput에는 `!` / `!!`를 shell command로 처리하는 UX가 없다. 서버 쪽 `rpc-manager.ts`에도 user-facing `bash` command route가 연결되어 있지 않다.

관련 파일:

- `components/ChatInput.tsx`
- `lib/rpc-manager.ts`

### 사용자에게 생기는 문제

CLI에서 자주 쓰는 “명령 실행 → 결과를 모델에게 보여주기” 루프가 느려진다.

예:

```text
!npm test
테스트 실패 원인 고쳐줘
```

CLI에서는 `npm test` 출력이 자동으로 다음 프롬프트에 들어가지만, pi-web에서는 사용자가 별도로 터미널에서 실행하고 복사해야 한다.

### 구현 방향

1. ChatInput에서 `!` / `!!` prefix를 감지한다.
2. AgentSession/RPC의 `bash` command와 동일한 의미로 서버에 전달한다.
3. 결과를 chat timeline에 `bashExecution` 또는 별도 web event로 표시한다.
4. `!!`는 `excludeFromContext` semantics를 유지한다.
5. extension의 `user_bash` hook도 가능한 한 동일하게 타도록 SDK API를 확인해야 한다.

## 5. `/import`, `/share` (P1)

### CLI에서의 기능

- `/import <file>`
  - JSONL session을 import하고 resume한다.
- `/share`
  - 현재 session을 private GitHub gist로 업로드하고 shareable HTML link를 만든다.
- `/export [file]`
  - HTML 또는 JSONL export.

### pi-web 현재 상태

`/export`는 일부 구현되어 있다. HTML 다운로드와 path 지정 export가 가능하다.

하지만 다음은 unsupported다.

- `/import`
- `/share`

관련 파일:

- `lib/slash-command-registry.ts`
- `hooks/useAgentSession.ts`
- `docs/slash-commands-plan.md`

### 사용자에게 생기는 문제

- 다른 머신/CLI에서 만든 session JSONL을 web으로 가져오기 어렵다.
- 협업이나 이슈 공유용 링크를 만들려면 CLI로 돌아가야 한다.
- session browser 중심인 pi-web의 장점이 세션 이동/공유에서 끊긴다.

### 구현 방향

#### `/import`

- 파일 업로드 또는 서버 path 입력을 지원한다.
- JSONL header/session id/cwd/version validation이 필요하다.
- import 후 session index/sidebar refresh.
- 같은 session id 충돌 시 rename/copy 정책 필요.

#### `/share`

- GitHub auth 방식 결정 필요.
  - `gh` CLI 사용
  - GitHub token 입력
  - 기존 pi CLI helper 재사용
- 업로드 전 민감정보 경고 필요.
- export HTML 생성 후 gist upload.

## 6. keybindings, `/hotkeys`, external editor (P1)

### CLI에서의 기능

CLI는 `~/.pi/agent/keybindings.json`으로 키맵을 바꿀 수 있다. `/hotkeys`는 현재 적용된 shortcut 목록을 보여준다.

대표 shortcut:

- Ctrl+L: model selector
- Ctrl+P / Shift+Ctrl+P: scoped model cycle
- Shift+Tab: thinking level cycle
- Ctrl+O: tool output collapse/expand
- Ctrl+T: thinking block collapse/expand
- Alt+Enter: follow-up queue
- Alt+Up: queued message recall
- Ctrl+G: external editor
- Escape twice: `/tree`

### pi-web 현재 상태

ChatInput에는 기본적인 Enter, Shift+Enter, slash autocomplete, `@` file autocomplete, paste image는 있다. 그러나 CLI keybindings manager와 `keybindings.json` 설정을 web UI가 그대로 반영하지는 않는다.

외부 에디터 Ctrl+G도 브라우저 환경에서는 구현되어 있지 않다.

### 사용자에게 생기는 문제

- CLI에서 손에 익은 shortcut이 web에서 다르게 동작한다.
- keybindings 문서를 보고 설정해도 web에는 적용되지 않을 수 있다.
- 긴 프롬프트 작성 시 external editor를 못 써서 불편하다.
- extension이 등록한 shortcut도 동작하지 않는다.

### 구현 방향

1. web keybinding registry를 만든다.
2. CLI `keybindings.json`을 읽어 web action으로 매핑한다.
3. 브라우저와 충돌하는 shortcut은 별도 fallback을 제공한다.
4. `/hotkeys` modal을 추가해 web에서 실제 동작하는 shortcut만 보여준다.
5. external editor는 브라우저 제약이 있으므로 다음 중 하나를 선택한다.
   - server-side temp file + configured editor spawn
   - textarea full-screen editor modal
   - system editor 연동은 명시적 opt-in으로 제한

## 7. `/tree` 고급 기능 (P2)

### CLI에서의 기능

CLI `/tree`는 단순 branch list가 아니라 session tree를 다루는 고급 navigator다.

주요 기능:

- search
- fold/unfold
- branch segment jump
- page up/down
- filter modes
  - default
  - no-tools
  - user-only
  - labeled-only
  - all
- Shift+L label edit
- Shift+T label timestamp toggle
- 선택 시 abandoned branch summary 생성 여부 선택

label은 session entry에 bookmark를 붙이는 기능이다. extension API에서도 `pi.setLabel(entryId, label)`을 제공한다.

### pi-web 현재 상태

pi-web에는 다음 두 종류가 있다.

- 상단/inline `BranchNavigator`
- slash `/tree`용 `SessionTreeSelectorModal`

기본 tree 선택과 summarize checkbox는 있다. 그러나 CLI의 filter modes, label edit, label timestamp, fold/unfold, page navigation은 충분히 구현되어 있지 않다.

관련 파일:

- `components/BranchNavigator.tsx`
- `components/SessionCommandModals.tsx`
- `hooks/useAgentSession.ts`

### 사용자에게 생기는 문제

긴 세션에서 CLI처럼 빠르게 특정 체크포인트를 찾기 어렵다. 특히 label/bookmark를 많이 쓰는 사용자에게 차이가 크다.

### 구현 방향

1. session label 표시 및 편집 API 추가.
2. tree filter mode 구현.
3. fold/unfold state 추가.
4. label timestamp 표시 옵션 추가.
5. CLI keybindings와 가능한 범위에서 동일하게 맞춘다.

## 8. CLI 실행 옵션/모드 (P2)

### CLI에서의 기능

CLI는 interactive 외에도 다양한 실행 모드를 제공한다.

- `-p`, `--print`
  - 한 번 실행하고 결과 출력 후 종료.
- `--mode json`
  - 이벤트를 JSONL로 출력.
- `--mode rpc`
  - 외부 프로세스/IDE 통합용 RPC.
- piped stdin
  - `cat README.md | pi -p "Summarize"`
- `@file` initial arguments
  - `pi @code.ts "review"`
- session 옵션
  - `--continue`, `--resume`, `--session`, `--fork`, `--session-dir`, `--no-session`, `--name`
- resource 옵션
  - `-e`, `--extension`, `--no-extensions`, `--skill`, `--no-skills`, `--prompt-template`, `--no-prompt-templates`, `--theme`, `--no-themes`, `--no-context-files`
- tool 옵션
  - `--tools`, `--exclude-tools`, `--no-builtin-tools`, `--no-tools`
- prompt 옵션
  - `--system-prompt`, `--append-system-prompt`
- trust 옵션
  - `--approve`, `--no-approve`

### pi-web 현재 상태

pi-web은 long-running local web workspace다. 따라서 CLI의 one-shot 실행 옵션과 1:1로 대응하지 않는다.

현재 web에서 일부 대응되는 것:

- 새 session 시작
- session browse/resume
- fork/clone 일부
- model 선택
- tool preset none/default/full
- skill/plugin/model config 일부

하지만 CLI 옵션처럼 세밀하게 “이번 session만 extension X를 로드”, “이번 run만 context files disable”, “이번 run만 system prompt override” 같은 기능은 없다.

### 사용자에게 생기는 문제

정밀한 실험이나 자동화는 CLI로 돌아가야 한다.

예:

```bash
pi --no-extensions -e ./debug-extension.ts --tools read,grep,find -p "Audit this repo"
```

이런 실행을 pi-web UI에서 재현하기 어렵다.

### 구현 방향

모든 CLI flag를 web에 넣기보다는 “session launch profile” 개념이 적합하다.

- 모델/provider/thinking
- active tools
- context files on/off
- extensions on/off 또는 explicit extension
- skills/prompts/themes on/off
- custom system prompt / append prompt
- trust override
- session persistence 여부

## 9. `/changelog`, `/quit` (P3)

### CLI에서의 기능

- `/changelog`: pi version history 표시.
- `/quit`: CLI process 종료.

### pi-web 현재 상태

둘 다 unsupported다.

### 영향

낮다. `/quit`은 브라우저 환경에서는 “탭을 닫으세요” 안내가 자연스럽다. `/changelog`는 package CHANGELOG 또는 release notes를 읽어 modal로 보여주면 충분하다.

## 구현 방식이 CLI와 다른 핵심 구조

### 1. InteractiveMode가 아니라 SDK/AgentSession 직접 구동

CLI built-in slash command는 `InteractiveMode` TUI 내부에서 직접 처리된다. pi-web은 Next.js server 안에서 `AgentSession`을 생성하고, 브라우저는 HTTP/SSE로 상태를 받는다.

결과적으로 `/model`, `/settings`, `/tree` 같은 built-in command는 pi-web에서 자동으로 실행되지 않는다. web adapter가 별도로 필요하다.

관련 파일:

- `lib/rpc-manager.ts`
- `hooks/useAgentSession.ts`
- `docs/slash-commands-plan.md`

### 2. 세션 탐색과 실행 runtime이 분리됨

pi-web은 session browsing 시 JSONL 파일을 직접 읽는다. 사용자가 메시지를 보내면 그때 `AgentSessionWrapper`를 만들거나 기존 wrapper를 재사용한다.

장점:

- 많은 세션을 빠르게 탐색 가능.
- 브라우저 refresh 후 running session에 재연결 가능.

주의점:

- session file parser와 live AgentSession state가 어긋나지 않도록 reconciliation이 필요하다.
- fork/clone 후 wrapper state mutation 문제가 있어 pi-web은 destroy/cache 정책을 별도로 둔다.

### 3. slash command 처리 경로가 분리됨

pi-web은 built-in slash command와 extension/prompt/skill command를 다르게 처리한다.

- built-in command
  - web registry/handler에서 처리.
- extension command
  - unknown slash command로 pass-through.
  - `AgentSession.prompt()` 내부에서 extension command로 실행.
- prompt template / skill command
  - `AgentSession.prompt()`에서 확장.

이 때문에 built-in command parity는 web에서 계속 별도 구현이 필요하다.

### 4. tool 선택 UX가 preset 중심

CLI는 `--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`로 세밀하게 제어한다. pi-web은 `none/default/full` preset 중심이다.

pi-web은 extension/package tool이 사라지지 않게 별도 로직으로 extension tools를 보존한다. 이 부분은 CLI와 내부 구현이 다르지만, 사용자 입장에서는 “설치한 extension tool이 web에서도 보이게 하려는” 보정이다.

관련 파일:

- `lib/tool-presets.ts`
- `lib/rpc-manager.ts`

## 추천 작업 순서

1. **Trust 상태 UI/API + `/trust` 구현**
   - 기능 문제와 보안 문제를 동시에 해결한다.
2. **진짜 `/settings` 구현**
   - CLI settings와 web app settings를 분리하고, runtime 설정을 조정할 수 있게 한다.
3. **Extension UI no-op 줄이기**
   - shortcut, autocomplete provider, custom editor, footer/header 순서.
4. **`!` / `!!` user bash 구현**
   - CLI 사용자의 체감 생산성 차이를 크게 줄인다.
5. **`/import` 구현 후 `/share` 구현**
   - 세션 중심 web UI의 완성도를 높인다.
6. **`/tree` label/filter/fold parity**
   - 긴 세션 사용자에게 중요하다.
7. **`/hotkeys`, `/changelog` 등 polish**
   - 사용성 마감 단계.
