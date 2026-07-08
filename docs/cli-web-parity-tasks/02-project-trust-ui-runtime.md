# 02. /trust UI와 런타임 reload 연동

## 메타데이터

- 우선순위: P0
- 선행 작업: 01
- 이유: API만으로는 사용자가 project-local 리소스가 보이지 않는 이유를 알 수 없으므로 slash command와 세션 진입 UX에서 trust 결정을 내려야 한다.

## 목적

`/trust`를 pi-web에서 실제 UI command로 전환하고, 현재 cwd의 trust 상태와 감지된 project-local 리소스를 보여준다. 사용자는 현재 폴더 trust, 상위 폴더 trust, deny, clear 결정을 저장할 수 있어야 한다.

## 배경/문제

CLI에서는 신뢰되지 않은 프로젝트에서 project-local `.pi` 리소스가 감지되면 사용자에게 trust 여부를 묻는다. pi-web은 현재 `/trust`를 unsupported로 처리하므로 사용자는 “왜 CLI에서는 보이는 command/skill이 web에서는 안 보이는지”를 알기 어렵다. 또한 trust decision을 저장할 UI가 없어 CLI로 돌아가야 한다.

## 범위

- `lib/slash-command-registry.ts`의 `/trust`를 `client-ui`로 전환
- `SlashUiAction`에 `openProjectTrust` 추가
- `hooks/useAgentSession.ts`에서 `/trust` 입력 시 ProjectTrust UI action emit
- 세션 cwd 진입, new session, resume/fork 후 trust 상태 재조회
- untrusted project-local 리소스 경고 banner 또는 modal
- trust 저장 후 reload/restart 안내와 실행 경로 제공

## 구현 순서

1. `SlashUiAction`과 AppShell modal state에 ProjectTrust modal을 추가한다.
2. `/trust` handler를 unsupported notice에서 UI action으로 바꾼다.
3. selected cwd, new session cwd, opened session cwd 변경 시 trust state를 lazy fetch한다.
4. ProjectTrust modal에 상태, 리소스 inventory, 위험 설명, 저장 action을 표시한다.
5. 저장 성공 후 현재 runtime에 반영 가능한 경우 `/reload`를 제안하거나 실행한다.
6. running/compacting 중에는 reload를 막고 “현재 응답 완료 후 반영” 안내를 표시한다.
7. trust 상태가 바뀐 뒤 slash command/tools/skills 목록을 refresh한다.

## 관련 파일

- `lib/slash-command-registry.ts`
- `hooks/useAgentSession.ts`
- `components/AppShell.tsx`
- `components/ProjectTrustModal.tsx` 신규
- `app/api/project-trust/route.ts`
- `lib/rpc-manager.ts`

## 검증

- `/trust` 입력 시 현재 cwd의 trust 상태와 감지된 project-local 리소스가 표시된다.
- trust 승인 후 `/reload` 또는 새 session에서 project extension/skill command가 slash palette에 나타난다.
- deny 상태에서는 project-local extension이 로드되지 않는다는 안내가 유지된다.
- 기존 session open, new session, resume/fork 후 cwd가 바뀌면 trust 상태가 다시 조회된다.
- unknown extension slash command pass-through가 회귀하지 않는다.
- `node_modules/.bin/tsc --noEmit`와 `npm run lint`를 통과한다.

## 리스크/주의사항

- trust 저장과 현재 runtime reload는 다른 일이다. UI에서 “저장됨”과 “현재 session에 반영됨”을 분리해야 한다.
- project-local extension이 이미 로드된 뒤 deny를 저장하는 경우 현재 runtime을 어떻게 처리할지 명확해야 한다.
- browser modal이 trust prompt 역할을 하므로 문구가 보안 경고로 충분히 강해야 한다.

## 완료 기준

`/trust`가 unsupported notice가 아니라 ProjectTrust UI를 열고, 사용자가 trust decision을 저장하며, 저장 후 반영 경로를 명확히 이해할 수 있다.
