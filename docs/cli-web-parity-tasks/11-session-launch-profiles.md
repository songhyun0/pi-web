# 11. CLI run options 대응용 Session launch profiles

## 메타데이터

- 우선순위: P2
- 선행 작업: 02, 04
- 이유: pi-web은 long-running workspace이므로 CLI 실행 옵션을 새 세션 시작 설정으로 대응하는 것이 현실적이다.

## 목적

새 세션을 시작할 때 도구, 리소스, system prompt, trust override, persistence를 지정하는 Launch profile을 제공한다. 기존 `none/default/full` tool preset UX는 유지한다.

## 배경/문제

CLI는 `--tools`, `--exclude-tools`, `--no-extensions`, `--no-context-files`, `--system-prompt`, `--approve` 등으로 이번 실행만 정밀 제어할 수 있다. pi-web은 새 세션을 만들 때 model/tool preset 정도만 제공한다. CLI flag를 1:1로 UI에 넣기보다는 “새 세션 시작 프로필”로 묶는 편이 웹 UX에 맞다.

## 범위

- new session modal 또는 화면에 Launch profile 섹션 추가
- tool 선택: preset, no-tools, no-builtin-tools, include tools, exclude tools
- resource toggles: extensions, skills, prompt templates, themes, context files
- system prompt: default, replace, append
- trust override: saved decision 사용, 이번 launch만 trust, 이번 launch만 distrust
- persistence: persisted 기본값, ephemeral/no-session 고급 옵션
- `launchProfile` schema와 validation helper 설계
- `/api/agent/new`와 `startRpcSession()`에 profile 전달

## 구현 순서

1. LaunchProfile 타입을 정의한다.
2. New session UI에 advanced profile section을 추가한다.
3. `/api/agent/new` request schema를 확장한다.
4. `startRpcSession()`에서 profile을 SDK option으로 변환한다.
5. tool/resource/system prompt/trust/persistence 옵션을 각각 연결한다.
6. profile이 lock되는 시점과 lazy session 생성 시점을 UI에 표시한다.
7. 기존 tool preset만 사용하는 경로가 회귀하지 않도록 default를 유지한다.

## 관련 파일

- `components/AppShell.tsx`
- `components/ChatWindow.tsx`
- `components/ChatInput.tsx`
- `app/api/agent/new/route.ts`
- `lib/rpc-manager.ts`
- `lib/tool-presets.ts`
- `lib/pi-types.ts`

## 검증

- 기본 새 세션 flow와 기존 tool preset UX가 회귀하지 않는다.
- no-tools profile에서 built-in tools가 비활성화된다.
- no-builtin-tools에서 builtin coding tools만 비활성화되고 extension/custom tool은 유지된다.
- no-extensions profile에서 extension command가 slash palette에 나타나지 않는다.
- no-skills/no-prompt-templates/no-context-files가 각각 반영된다.
- replace/append system prompt가 해당 session에만 반영된다.
- trustForLaunch와 distrustForLaunch가 trust store를 변경하지 않는다.
- ephemeral 선택 시 세션 파일이 생성되지 않고 손실 가능성이 UI에 표시된다.
- `node_modules/.bin/tsc --noEmit`와 `npm run lint`를 통과한다.

## 리스크/주의사항

- 모든 CLI mode를 web launch profile로 대응하려고 하면 범위가 커진다. `-p`, `--mode json`, `--mode rpc`는 비목표로 둔다.
- trust override는 saved decision을 바꾸면 안 된다.
- no-tools와 custom system prompt가 상호작용할 때 기존 forced empty system prompt 로직을 조심해야 한다.

## 완료 기준

Launch profile이 새 세션 생성 경로 전체를 통과해 SDK runtime 옵션으로 변환되고, CLI 고영향 run option을 web-native 방식으로 제어할 수 있다.
