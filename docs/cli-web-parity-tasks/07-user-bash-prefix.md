# 07. !cmd / !!cmd 사용자 bash UX

## 메타데이터

- 우선순위: P1
- 선행 작업: 02
- 이유: CLI 사용자가 자주 쓰는 “명령 실행 후 결과를 모델에게 전달” 루프가 pi-web에 없으면 생산성 격차가 크다.

## 목적

ChatInput에서 `!cmd`와 `!!cmd` prefix를 감지해 현재 session cwd에서 shell command를 실행한다. `!` 결과는 다음 모델 컨텍스트에 포함하고, `!!` 결과는 화면과 session history에는 남기되 모델 컨텍스트에서는 제외한다.

## 배경/문제

CLI에서는 `!npm test` 후 “고쳐줘”를 입력하면 test output이 다음 모델 컨텍스트에 포함된다. `!!npm test`는 결과를 사용자만 보고 모델에는 보내지 않는다. pi-web에서는 이 shortcut이 없어 사용자가 외부 terminal을 열고 복사해야 한다.

## 범위

- `!cmd` / `!!cmd` parser 추가
- `/api/agent/[id]` generic command 경로에 `user_bash`, `abort_bash` 추가
- `AgentSession.executeBash()`, `recordBashResult()`, `abortBash()` 연결
- `extensionRunner.emitUserBash()` hook을 CLI 순서와 맞춰 호출
- `BashExecutionMessage` 타입과 timeline renderer 추가
- output chunk SSE 또는 최소 완료 후 execution block 표시
- command, cwd, exitCode, duration, truncated, cancelled, excludeFromContext 표시

## 구현 순서

1. ChatInput submit 전에 `!`/`!!` prefix를 인식한다.
2. image attachment, empty command, streaming 중 실행 정책을 정한다.
3. `rpc-manager.ts`에 user bash command를 추가하고 pi SDK API를 연결한다.
4. `user_bash` extension hook이 실행되는지 확인한다.
5. bash 실행 결과를 session history에 기록하고 UI에 표시한다.
6. `!!`의 `excludeFromContext`가 다음 prompt context에서 제외되는지 검증한다.
7. 실행 중 abort UI를 추가한다.

## 관련 파일

- `components/ChatInput.tsx`
- `hooks/useAgentSession.ts`
- `lib/rpc-manager.ts`
- `lib/pi-types.ts`
- `components/MessageView.tsx`
- `lib/types.ts`
- pi docs: `docs/usage.md`, `docs/rpc.md`, `docs/extensions.md`

## 검증

- `!pwd` 실행 결과가 화면에 표시되고 후속 프롬프트 컨텍스트에 포함된다.
- `!!pwd` 실행 결과가 화면에만 표시되고 모델 컨텍스트에는 포함되지 않는다.
- 실패 exit code와 stderr가 보존된다.
- `!sleep 30` 실행 중 취소가 가능하고 UI가 running 상태에 갇히지 않는다.
- 큰 출력에서 `truncated`와 `fullOutputPath`가 표시된다.
- `user_bash` hook을 가진 extension의 `result`와 `operations` 경로가 CLI와 유사하게 동작한다.
- `node_modules/.bin/tsc --noEmit`와 `npm run lint`를 통과한다.

## 리스크/주의사항

- 사용자 bash는 모델 tool call bash와 다르다. role과 context 포함 시점이 다르므로 UI에서 구분해야 한다.
- streaming 중 실행을 허용하면 queue/running state가 복잡해진다. MVP에서는 막는 편이 안전할 수 있다.
- shell command는 민감정보를 출력할 수 있으므로 `!!` semantics가 중요하다.

## 완료 기준

`!cmd`와 `!!cmd`가 일반 prompt로 전송되지 않고 user bash 실행으로 처리되며, context 포함/제외 의미론이 session history에 올바르게 기록된다.
