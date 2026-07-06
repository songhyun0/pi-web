# Slash Command 구현 계획

## 배경

pi-web은 `InteractiveMode`가 아니라 SDK/`AgentSession`을 직접 구동한다. 따라서 pi 터미널 TUI에서 처리되는 built-in slash command는 웹에서 자동으로 실행되지 않는다.

현재 자동으로 동작하는 command는 다음 두 부류다.

1. **Extension command**: 예) `/fast`
   - extension이 `pi.registerCommand("fast", ...)`로 등록한다.
   - pi-web은 unknown slash command를 막지 않고 `AgentSession.prompt()`로 넘긴다.
   - `AgentSession.prompt()` 내부가 extension command를 실행한다.
2. **Prompt template / skill command**
   - `AgentSession.prompt()`가 `/template`, `/skill:name`을 확장한다.

반면 `/model`, `/settings`, `/export`, `/tree` 등 pi built-in command는 대부분 `InteractiveMode` 안에서 직접 처리되므로, pi-web에서 별도 adapter가 필요하다.

## 목표

1. pi-web에서 pi built-in slash command를 가능한 한 구현한다.
2. `/fast` 같은 extension/prompt/skill command 자동 실행을 보존한다.
3. 새 extension/prompt/skill command는 기존처럼 자동 반영한다.
4. 새 pi built-in command도 목록에는 자동 반영하고, 웹에서 실행 가능한 단순 command는 선언적 handler만 추가하면 처리되도록 만든다.
5. 모달/선택 UI가 필요한 command는 web UI action으로 분리한다.

## 비목표 / 한계

- pi core가 built-in command 실행 registry를 export하지 않는 한, **새로운 pi built-in command의 실행까지 완전 자동화할 수는 없다.**
- 새 built-in command를 자동 실행하려면 pi upstream에 `mode-independent builtin slash command registry`를 추가하는 작업이 별도로 필요하다.
- `/quit`처럼 브라우저 환경과 맞지 않는 command는 unsupported 또는 no-op으로 둔다.

## 현재 command 분류

| Command | 원본 pi 성격 | pi-web 처리 계획 | 우선순위 |
|---|---:|---|---:|
| `/compact [instructions]` | simple agent action | 이미 구현. registry 기반으로 이동 | P0 |
| `/name <name>` | simple session action | 이미 구현. registry 기반으로 이동 | P0 |
| `/session` | stats UI | 이미 구현. session stats panel 열기 | P0 |
| `/copy` | client clipboard | 이미 구현. registry 기반으로 이동 | P0 |
| `/reload` | simple agent action | `sendAgentCommand({ type: "reload" })`, commands/tools refresh | P0 |
| `/export [path]` | simple/session export | 기본은 HTML download. path 인자는 추후 server-side export 지원 | P1 |
| `/model [provider/model]` | model selector | 인자 있으면 direct set, 없으면 model picker modal | P1 |
| `/new` | session replacement | 현재 cwd로 새 세션 시작. AppShell action 필요 | P1 |
| `/clone` | session fork at current leaf | rpc `clone` 추가 또는 current leaf 기준 fork | P1 |
| `/tree` | branch navigator | BranchNavigator popup 열기/toggle | P1 |
| `/fork` | user-message selector | user message selector modal. 현재 per-message fork 재사용 | P2 |
| `/resume` | session selector | session selector modal 열기 | P2 |
| `/login [provider]` | auth UI | provider 있으면 login flow, 없으면 ModelsConfig/auth tab | P2 |
| `/logout [provider]` | auth UI | provider 있으면 logout API, 없으면 ModelsConfig/auth tab | P2 |
| `/settings` | TUI settings | web settings hub/modal 신규 작성 | P2 |
| `/scoped-models` | TUI model scope selector | ModelsConfig의 enabled models UI로 연결/신규 modal | P2 |
| `/hotkeys` | TUI help | web hotkeys modal 작성 | P3 |
| `/changelog` | TUI changelog | package CHANGELOG API + modal | P3 |
| `/trust` | project trust selector | ProjectTrustStore API + confirm UI | P3 |
| `/import` | session import | JSONL upload/path import flow 신규 작성 | P3 |
| `/share` | GitHub gist | 별도 auth/network 설계 필요. defer | P4 |
| `/quit` | terminal lifecycle | unsupported/no-op notice | P4 |

Hidden/debug-only TUI commands(`/debug`, `/arminsayshi`, `/dementedelves`)은 public `BUILTIN_SLASH_COMMANDS`에 없으므로 구현 대상에서 제외한다.

## 설계

### 1. Slash command registry 도입

새 파일 후보:

- `lib/slash-command-registry.ts`
- `lib/pi-builtin-slash-commands.ts` 또는 `lib/server/pi-builtin-slash-commands.ts`

공통 타입 예시:

```ts
export type SlashCommandSource = "builtin" | "extension" | "prompt" | "skill";

export type BuiltinSlashCommandMode =
  | "agent"       // AgentSession/RPC action으로 즉시 실행 가능
  | "client"      // clipboard, browser download 등 client-only
  | "client-ui"   // modal/panel/selector 필요
  | "passthrough" // AgentSession.prompt()로 넘김
  | "unsupported";

export interface WebBuiltinSlashCommand {
  name: string;
  description?: string;
  mode: BuiltinSlashCommandMode;
  interactive?: boolean;
  argHint?: string;
}
```

원칙:

- `ChatInput.tsx`의 하드코딩된 `BUILTIN_SLASH_COMMANDS`를 registry로 대체한다.
- `get_commands`에서 받은 extension/prompt/skill command와 registry command를 합쳐 palette를 구성한다.
- unknown slash command는 계속 `{ handled: false }`로 반환해서 `AgentSession.prompt()`로 pass-through한다.

### 2. pi built-in command 목록 자동 반영

pi package 내부에는 `dist/core/slash-commands.js`가 있지만 public export는 아니다. 그래도 서버에서는 `getPackageDir()` 기반으로 안전하게 읽을 수 있다.

계획:

1. server helper에서 pi package의 `dist/core/slash-commands.js`를 dynamic import 또는 파일 read로 읽는다.
2. 실패하면 local fallback list를 사용한다.
3. 웹에서 구현한 handler가 없는 built-in은 palette에 표시하되 `unsupported` notice를 낸다.

효과:

- handler/capability가 있는 built-in만 자동완성 목록에 보인다.
- 미구현 built-in은 직접 입력하면 안내 메시지는 표시할 수 있지만 palette에는 노출하지 않는다.

### 3. 선언적 simple handler

모달이 필요 없는 command는 switch문 대신 선언적으로 정의한다.

예시:

```ts
const SIMPLE_BUILTIN_HANDLERS = {
  reload: {
    buildCommand: () => ({ type: "reload" }),
    success: "Reloaded extensions, skills, prompts, and tools",
    after: ["commands", "tools", "session"],
  },
  compact: {
    buildCommand: (args) => ({ type: "compact", ...(args ? { customInstructions: args } : {}) }),
    success: "Compacted context",
    busyState: "compacting",
  },
};
```

이 구조를 만들면 단순 toggle/action은 registry에 한 줄 추가하는 방식으로 확장 가능하다.

### 4. client-ui command action bus

`useAgentSession`은 session state와 RPC만 알고, AppShell modal 상태는 모른다. 따라서 slash command가 AppShell UI를 열 수 있도록 callback/action bus를 추가한다.

후보 타입:

```ts
export type SlashUiAction =
  | { type: "openModelPicker"; query?: string }
  | { type: "openModelsConfig"; section?: "auth" | "models" | "scoped" }
  | { type: "openSessionStats" }
  | { type: "openBranchNavigator" }
  | { type: "openSessionSelector" }
  | { type: "openForkSelector" }
  | { type: "openSettings" }
  | { type: "newSession" }
  | { type: "exportSession" };
```

변경 위치:

- `hooks/useAgentSession.ts`
  - `UseAgentSessionOptions`에 `onSlashUiAction?: (action: SlashUiAction) => void | Promise<void>` 추가
  - `handleBuiltinSlashCommand`에서 UI command를 action으로 emit
- `components/ChatWindow.tsx`
  - AppShell로부터 action callback 전달
- `components/AppShell.tsx`
  - modal/panel state 변경, export/download, new session 등 실제 UI action 수행

### 5. RPC wrapper 기능 확장

`lib/rpc-manager.ts`에 pi RPC와 유사한 command를 더 노출한다.

추가 후보:

- `export_html`: `inner.exportToHtml(outputPath?)` 또는 기존 `/api/sessions/[id]/export` 경로와 통합
- `clone`: current leaf 기준 fork. pi RPC 구현은 `runtimeHost.fork(leafId, { position: "at" })`에 해당
- `cycle_model`: scoped/current model cycling
- `get_available_models`: `/model` autocomplete/direct matching용
- `cycle_thinking_level`: 단순 thinking cycle command를 추가할 경우 사용
- `switch_session`: `/resume` 구현 시 필요할 수 있음
- `new_session`: `/new` 구현 시 AppShell 방식과 비교 후 결정

`pi-types.ts`의 `AgentSessionLike`에도 필요한 메서드를 보강한다.

### 6. pass-through 보존

`ChatInput.handleSend()` 흐름은 유지한다.

1. 메시지가 `/`로 시작하면 `onBuiltinCommand(msg)` 호출
2. built-in handler가 처리했으면 input clear
3. `{ handled: false }`면 기존처럼 `onSend(msg)` 호출
4. `AgentSession.prompt(msg)`가 extension/prompt/skill command를 처리

이 규칙은 `/fast` 회귀 방지를 위한 핵심이다.

## 단계별 작업

### Phase 0 — 기반 정리(P0)

- [x] `lib/slash-command-registry.ts` 추가
- [x] 현재 4개 built-in command(`/compact`, `/name`, `/session`, `/copy`)를 registry/dispatcher 기반으로 이동
- [x] `ChatInput.tsx`의 local `BUILTIN_SLASH_COMMANDS` 제거 또는 registry import로 교체
- [x] unknown slash command pass-through 테스트(`/fast`, prompt template, `/skill:name`) — handler 미등록 command는 계속 `AgentSession.prompt()`로 전달

검증:

- `/fast`가 계속 동작
- `/compact`, `/name`, `/session`, `/copy` 기존 동작 유지
- `node_modules/.bin/tsc --noEmit`

### Phase 1 — simple built-in command(P0~P1)

- [x] `/reload` 구현
  - RPC: 기존 `reload` 사용
  - 후처리: slash commands/tools/session state refresh
- [x] `/export` 구현
  - 기본: `window.location.href = /api/sessions/[id]/export`
  - `path` 인자는 `export_session` RPC로 server-side `.html`/`.jsonl` export 지원
- [x] `/clone` 구현
  - `rpc-manager.ts`에 `clone` 추가
  - clone 후 새 session id를 `onSessionForked` callback으로 AppShell에 전달
- [x] `/model provider/model` direct set 구현
  - provider/model exact match
  - provider 생략 시 model id/name exact match가 1개면 set, 여러 개면 ambiguous error

검증:

- `/reload` 후 새 extension command가 palette에 나타남
- `/export`가 HTML 다운로드
- `/clone`이 독립 session 생성 후 sidebar/URL 갱신
- `/model openai/gpt-...`가 모델 변경

### Phase 2 — UI action command(P1~P2)

- [x] Slash UI action bus 추가
- [~] `/model` no-arg: 현재는 ModelsConfig를 열도록 연결. 전용 model picker modal은 후속 작업
- [x] `/tree`: CLI-style session tree selector modal. branch summary option 포함
- [x] `/new`: 현재 cwd 기준 새 세션 시작
- [~] `/resume`: 현재는 session sidebar open. 전용 session selector modal은 후속 작업
- [x] `/fork`: CLI-style user message selector modal. fork 후 선택한 메시지를 새 세션 입력창에 복원
- [~] `/login [provider]`, `/logout [provider]`
  - 현재는 ModelsConfig auth 영역으로 연결
  - provider arg 직접 login/logout 실행은 후속 작업

검증:

- slash command로 열린 modal이 키보드/마우스로 닫힘
- command 실행 후 input clear 정책이 일관적
- 실행 중 streaming 상태에서는 UI-only command와 queue command 정책 확인

### Phase 3 — settings/help/import/trust(P2~P3)

- [ ] `/settings`: web settings hub modal
  - ModelsConfig, SkillsConfig, PluginsConfig, theme/sound/tool/thinking 관련 entry point 제공
- [ ] `/scoped-models`: enabled models selector 또는 ModelsConfig 해당 section으로 이동
- [ ] `/hotkeys`: web hotkeys modal
- [ ] `/changelog`: package CHANGELOG read API + modal
- [ ] `/trust`: ProjectTrustStore 조회/저장 API + confirm UI
- [ ] `/import`: JSONL upload 또는 path input으로 session import/resume

검증:

- project trust 변경 후 resource reload 동작
- import된 session이 sidebar에 표시되고 열림
- settings 변경 후 hot reload/refresh가 필요한 항목 처리

### Phase 4 — unsupported/deferred command(P4)

- [ ] `/share`: GitHub gist auth/permission 모델 조사 후 별도 설계
- [ ] `/quit`: 브라우저 환경에서는 unsupported notice 또는 “close tab manually” 안내

## 새 command 자동 반영 전략

### Extension/prompt/skill command

이미 자동 반영된다. 유지해야 할 조건:

- `get_commands`는 extension/prompt/skill 목록을 계속 반환한다.
- `handleBuiltinSlashCommand`가 모르는 command를 막지 않는다.
- `AgentSession.prompt()`로 pass-through한다.

### pi built-in command

단기:

- `dist/core/slash-commands.js`를 읽되, pi-web handler가 있는 built-in만 palette에 표시한다.
- handler가 없으면 palette에는 숨기고, 직접 입력 시 “Not supported in pi-web yet” notice.
- handler가 단순 action이면 `SIMPLE_BUILTIN_HANDLERS`에 선언만 추가한다.

장기/upstream 제안:

- pi core에 built-in slash command registry를 추가한다.
- 각 command가 다음 metadata를 제공하게 한다.

```ts
interface BuiltinSlashCommandDescriptor {
  name: string;
  description?: string;
  args?: string;
  interactivity: "none" | "select" | "input" | "custom" | "terminal-only";
  run(ctx: BuiltinSlashCommandContext, args: string): Promise<BuiltinSlashCommandResult>;
}
```

- pi-web은 `interactivity: "none"` command를 자동 실행한다.
- `select`/`input`은 extension UI bridge와 같은 방식으로 modal 변환한다.
- `terminal-only`는 unsupported로 표시한다.

## 파일별 변경 요약

| 파일 | 변경 |
|---|---|
| `lib/slash-command-registry.ts` | web built-in metadata/handler registry 신규 |
| `lib/pi-builtin-slash-commands.ts` | pi package built-in 목록 loader 신규 |
| `components/ChatInput.tsx` | hardcoded built-in 목록 제거, registry 기반 palette |
| `hooks/useAgentSession.ts` | registry dispatcher, UI action callback, simple handlers |
| `components/ChatWindow.tsx` | `onSlashUiAction` 전달 |
| `components/AppShell.tsx` | slash UI action 처리: modals/export/new/tree 등 |
| `lib/rpc-manager.ts` | `clone`, `export_html`, `get_available_models` 등 RPC 확장 |
| `lib/pi-types.ts` | 필요한 `AgentSessionLike` 메서드 타입 보강 |
| `app/api/...` | changelog/import/trust 등 필요한 API 추가 |

## 테스트 계획

자동:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

주의: 개발 중 `next build`는 실행하지 않는다.

수동 테스트 매트릭스:

| 케이스 | 기대 결과 |
|---|---|
| `/fast` | extension command 실행, status/notice 표시 |
| `/compact summarize aggressively` | compaction 실행, 세션 reload |
| `/name test` | 세션 이름 변경 |
| `/session` | stats panel 열림 |
| `/copy` | 마지막 assistant 메시지 clipboard 복사 |
| `/reload` | extension/prompt/skill command 목록 갱신 |
| `/model provider/model` | 모델 변경 |
| `/model` | model picker open |
| `/export` | HTML export download |
| unknown `/some-extension-command` | built-in에서 막지 않고 AgentSession으로 전달 |
| unsupported built-in | 명확한 unsupported notice |
| streaming 중 slash command | extension command는 pi 정책대로 실행/queue, built-in UI command는 정책대로 차단 또는 허용 |

## 구현 시 주의사항

- built-in handler 실패가 extension pass-through를 막지 않도록 command 존재 여부를 명확히 구분한다.
- command palette에는 source group을 유지한다: Built-in / Extensions / Prompts / Skills.
- extension command와 built-in command 이름 충돌 시 pi TUI와 같은 정책을 따른다. built-in 우선, extension은 `invocationName` 기준으로 표시한다.
- 새 session/fork/clone은 `AgentSession.fork()` wrapper state mutation 문제를 다시 유발하지 않도록 `rpc-manager.ts`의 destroy/cache 정책을 따른다.
- manual compact, reload 등 긴 작업은 running state와 notice를 일관되게 업데이트한다.
- command 실행 후 input clear 여부는 `handled && !error` 기준을 유지하되, UI modal을 여는 command도 clear할지 UX 기준을 통일한다.
