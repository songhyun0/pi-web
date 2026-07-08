# 01. Project trust 상태 조회·저장 API

## 메타데이터

- 우선순위: P0
- 선행 작업: 00
- 이유: 프로젝트 로컬 `.pi` 리소스와 package는 로컬 코드 실행으로 이어질 수 있으므로 웹에서 가장 먼저 trust 상태를 안전하게 조회·저장해야 한다.

## 목적

현재 cwd의 trust decision, 상위 폴더에서 상속된 decision, `defaultProjectTrust` fallback, trust가 필요한 project-local 리소스 inventory를 반환하는 API를 만든다. 또한 현재 폴더 trust, 상위 폴더 trust, deny, clear 동작을 CLI와 호환되는 trust store에 저장한다.

## 배경/문제

CLI의 trust는 “이 폴더를 열 수 있는가”가 아니라 “이 프로젝트 안의 `.pi/settings.json`, `.pi/extensions`, `.agents/skills`, project-local package를 로드하고 실행해도 되는가”를 결정하는 보안 게이트다. extension은 로컬 머신 권한으로 실행될 수 있으므로, 신뢰되지 않은 저장소의 project-local extension을 조용히 로드하면 위험하다.

pi-web은 currently SDK/`AgentSession`을 in-process로 띄우지만, 브라우저 UI에서 trust 상태를 설명하거나 저장하는 API가 없다. 따라서 project-local skill/extension이 왜 보이지 않는지 알기 어렵고, 반대로 global fallback이 `always`인 경우 사용자가 위험을 인지하기 어렵다.

## 범위

- `GET /api/project-trust?cwd=...` 추가
- `POST /api/project-trust` 추가
- `.pi/settings.json`, `.pi/extensions`, `.pi/skills`, `.agents/skills`, `.pi/prompts`, `.pi/themes`, project-local packages 존재 여부 inventory
- `ProjectTrustStore`, `SettingsManager`, `hasTrustRequiringProjectResources()` 등 pi SDK public API 우선 사용
- allowed root/cwd validation을 `lib/file-access.ts` 정책과 맞춤

## 구현 순서

1. pi core에서 Project trust 관련 public API를 확인한다.
2. public API가 있으면 thin wrapper를 만들고, 없으면 CLI trust store schema를 읽는 최소 helper를 만든다.
3. cwd validation과 allowed root guard를 먼저 적용한다.
4. project-local 리소스 inventory helper를 작성한다. 이 helper는 extension/package를 import하거나 실행하면 안 된다.
5. `GET /api/project-trust`를 추가해 saved/effective/fallback 상태를 반환한다.
6. `POST /api/project-trust`를 추가해 allow/deny/clear 및 parent allow를 저장한다.
7. 저장 응답에는 현재 runtime에 즉시 반영되는지, reload/new session이 필요한지 metadata를 포함한다.

## 관련 파일

- `app/api/project-trust/route.ts` 신규
- `lib/file-access.ts`
- `lib/rpc-manager.ts`
- `app/api/cwd/validate/route.ts`
- pi core docs: `docs/settings.md`, `docs/usage.md`

## 주요 응답 정보

- `cwd`
- `requiresTrust`
- `savedDecision`
- `defaultProjectTrust`
- `effective.trusted`
- `effective.source`
- `effective.promptRequired`
- `inventory`
- `actions`

## 검증

- trust decision이 없는 repo, trusted repo, denied repo, parent trusted repo fixture에서 API 응답을 비교한다.
- `.pi/extensions`와 `.agents/skills`가 있어도 조회 API가 코드를 실행하지 않는지 확인한다.
- 저장 후 `~/.pi/agent/trust.json` 또는 SDK store가 CLI와 호환되는지 CLI `/trust` 또는 session load로 교차 확인한다.
- allowed root 밖 cwd는 403으로 거절한다.
- `node_modules/.bin/tsc --noEmit`을 통과한다.

## 리스크/주의사항

- trust store schema를 직접 조작하면 upstream 변경에 깨질 수 있다. public API 사용을 우선한다.
- project-local package inventory 중 dependency install/update가 발생하면 안 된다.
- `defaultProjectTrust=always`는 saved trust가 아니므로 UI에서 구분해야 한다.

## 완료 기준

trust 상태 조회와 저장 API가 구현되고, project-local 리소스 inventory가 안전하게 반환되며, 저장 결과가 CLI와 호환된다.
