# 03. CLI /settings용 런타임 설정 데이터 계층

## 메타데이터

- 우선순위: P0
- 선행 작업: 01
- 이유: UI를 만들기 전에 `settings.json`을 안전하게 읽고 쓰는 계층이 필요하다.

## 목적

CLI `/settings`에서 다루는 핵심 runtime settings를 pi-web에서도 안전하게 조회·수정할 수 있는 서버 데이터 계층과 API를 만든다. pi-web 자체 app settings인 `web-settings.json`과 Pi runtime settings를 섞지 않는다.

## 배경/문제

현재 pi-web의 `SettingsModal`은 주로 web display name을 다룬다. CLI `/settings`가 다루는 thinking, compaction, retry, message delivery, transport, `defaultProjectTrust` 같은 runtime 설정은 별도 UI/API가 없다. 설정 UI를 만들기 전에 먼저 global/project/effective 값을 안정적으로 읽고 쓸 수 있어야 한다.

## 범위

- `~/.pi/agent/settings.json` 읽기/쓰기 helper
- 프로젝트 `<cwd>/.pi/settings.json` 읽기/쓰기 helper
- effective value 계산: default, global, trusted project override
- 설정별 metadata 제공: key, label, allowed values, scope, default, 적용 방식
- `GET /api/runtime-settings?cwd=...`
- `PATCH /api/runtime-settings`
- 최소 P0 설정: `defaultThinkingLevel`, `steeringMode`, `followUpMode`, `transport`, `compaction.*`, `retry.*`, `defaultProjectTrust`

## 구현 순서

1. `SettingsManager` public getter/setter 목록을 정리한다.
2. `RuntimeSettingDescriptor` 타입을 만든다.
3. global/project/effective 값을 반환하는 helper를 작성한다.
4. project scope는 trust API 결과를 확인한 뒤에만 읽기/쓰기한다.
5. `GET /api/runtime-settings`를 구현한다.
6. `PATCH /api/runtime-settings`를 구현하고 allowed value validation을 추가한다.
7. reset/delete semantics를 설계하고 unknown field 보존 테스트를 추가한다.

## 관련 파일

- `app/api/runtime-settings/route.ts` 신규
- `lib/runtime-settings.ts` 신규
- `components/SettingsModal.tsx`
- `app/api/app-settings/route.ts`
- `lib/app-settings.ts`
- pi core docs: `docs/settings.md`

## 검증

- 기존 `web-settings.json` displayName 설정이 손상되지 않는다.
- `settings.json`의 unknown fields가 보존된다.
- global/project override와 reset 결과가 올바르게 계산된다.
- untrusted project의 project settings가 effective value에 섞이지 않고 project write가 거절된다.
- `defaultProjectTrust` 변경 결과가 trust API fallback에 반영된다.
- `node_modules/.bin/tsc --noEmit`와 `npm run lint`를 통과한다.

## 리스크/주의사항

- nested object merge 규칙은 CLI와 같아야 한다.
- 일부 설정은 변경해도 active runtime에 즉시 반영되지 않는다. API metadata로 적용 시점을 반환해야 한다.
- project settings를 읽는 것 자체도 trust 정책과 맞아야 한다.

## 완료 기준

runtime settings API가 global/project/default effective value와 적용 metadata를 반환하고, 검증된 업데이트만 안전하게 저장한다.
