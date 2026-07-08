# 10. /tree 고급 기능: label, filter, fold, search

## 메타데이터

- 우선순위: P2
- 선행 작업: 05
- 이유: 긴 세션에서 CLI처럼 체크포인트와 branch를 찾으려면 기본 selector를 넘어 label/bookmark와 filter/fold 기능이 필요하다.

## 목적

`/tree` modal과 `BranchNavigator`에 label, filter, fold/unfold, search, page navigation을 추가해 긴 세션 탐색성을 높인다.

## 배경/문제

CLI `/tree`는 단순 branch selector가 아니라 session tree navigator다. filter modes, labels/bookmarks, fold/unfold, label timestamp, branch summary를 제공한다. pi-web에는 기본 tree selector와 summarize checkbox가 있지만 CLI의 긴 세션 탐색 기능은 부족하다.

## 범위

- label/bookmark 표시, 추가, 수정, 삭제
- label을 session JSONL에 영속 저장
- filter modes: default, no-tools, user-only, labeled-only, all
- search, fold/unfold, page navigation
- label timestamp 표시 toggle
- abandoned branch summary 옵션 유지 및 개선
- shared tree utility로 modal과 BranchNavigator 표시 규칙 통일

## 구현 순서

1. pi core `SessionManager`의 label API와 tree output을 확인한다.
2. label read/write API를 `rpc-manager.ts` 또는 session API에 추가한다.
3. tree flatten/render utility를 modal과 BranchNavigator가 공유하도록 분리한다.
4. filter mode state와 UI를 추가한다.
5. fold/unfold state와 keyboard action을 추가한다.
6. label edit modal 또는 inline input을 추가한다.
7. label timestamp toggle을 추가한다.
8. 대형 session에서 iterative traversal 성능을 확인한다.

## 관련 파일

- `components/BranchNavigator.tsx`
- `components/SessionCommandModals.tsx`
- `hooks/useAgentSession.ts`
- `lib/rpc-manager.ts`
- `lib/types.ts`
- `app/api/sessions/[id]/tree/route.ts`
- `lib/session-reader.ts`

## 검증

- label 추가/수정/삭제가 session reload와 browser refresh 후에도 보존된다.
- 각 filter mode가 toolResult, user, labeled entry를 올바르게 포함/제외한다.
- label, message text, tool name, entry id 검색이 동작한다.
- fold/unfold와 PageUp/PageDown/Home/End가 긴 세션에서 성능 문제 없이 동작한다.
- branch 선택 후 `navigate_tree`와 summary 옵션이 기존처럼 동작한다.
- `BranchNavigator`에서 label 표시와 search/filter/fold가 modal과 일관된다.
- `node_modules/.bin/tsc --noEmit`를 통과한다.

## 리스크/주의사항

- label 삭제는 기존 entry를 제거하는 것이 아니라 clear label entry를 append해야 한다.
- filter 후 connector를 기존 tree 기준으로 유지하면 시각적으로 깨질 수 있다.
- 대형 linear session에서 recursion을 사용하면 call stack overflow가 날 수 있다.

## 완료 기준

`/tree` modal과 BranchNavigator가 label, filter, fold, search를 지원하고, 대형 세션에서도 stack overflow 없이 동작한다.
