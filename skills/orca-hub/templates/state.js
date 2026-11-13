/* Hub dashboard state. The hub edits ONLY this file; dashboard.html re-reads it every 5 s, and sync.cjs reads it
   to know which workers and PRs to watch (it writes their live activity and CI to live.js, never here).
   After each edit run `node --check state.js`: a syntax error makes the page keep its last good screen with a warning.
   The renderer ignores fields it does not know, so hub bookkeeping can live here too. */
window.HUB_STATE = {
  title: "알림 설정",
  owner: "이개발",
  updatedAt: "2026-11-09 14:20",
  baseSha: "a1b2c3d",
  workerCap: 2,
  flowSummary: "기반 레인 → 화면 레인",   // optional: shown after the 개발 흐름 heading
  repo: "acme/app",          // GitHub owner/name: sync.cjs runs `gh pr view --repo` with it
  runId: "run_xxxxxxxx",     // bookkeeping for resume
  hubWorktree: "/Users/me/orca/workspaces/app/hub-notify",  // the hub session's Orca workspace ("" outside one): workers are its children
  hubWorktreeOldName: "",    // the parent's display name before the hub renamed it ("" when the hub renamed nothing): restored at close
  hubWorktreeOldNameMode: "", // the parent's displayNameMode before the rename ("" when the hub renamed nothing)
  lastMsgId: "",             // id of the last Orca message handled: resume handles the inbox messages after it
  v: 2,                      // layout version: review before walkthrough. A state.js without it is upgraded first (references/upgrade.md)
  autonomy: "low",          // "low" | "medium" | "high": what the hub leaves to the developer (SKILL.md); absent or unknown = "low"
  lang: "ko",                // "ko" or "en": the page's own labels; the hub's sentences follow SKILL.md, "Language"
  closed: false,             // true after the final sweep: sync.cjs exits, the page shows the run as finished
  // Every sentence in this file is read by the developer: write it by references/dashboard.md.
  // ask: one sentence saying which of the developer's to-dos comes first and why. Empty with no to-do or only one.
  //   The page lists the to-dos under it by itself: open decisions, walkthroughs, merge approvals, prompt waits, blocked items.
  ask: "N1 병합을 먼저 승인해 주세요. N2 가 그 위에 쌓여 있습니다.",
  // needs: what only a human can do and no status shows (a login, a secret). Each becomes a to-do row. Usually empty.
  needs: [],   // e.g. [{ text: "스테이징 DB 비밀값을 N3 작업자 터미널에 넣어 주세요.", how: "Orca 사이드바에서 N3 를 엽니다." }]
  // summary: at most 3 sentences the developer should know now and the cards do not show. Replace them; do not pile them up.
  summary: [
    "N1 마이그레이션은 표를 추가만 해서 배포 순서를 따로 맞출 필요가 없습니다.",
    "N3 와 N4 는 N2 의 PR 이 열린 뒤에 시작합니다."
  ],
  // refs: the documents this run follows, beyond spec.md and protocol.md (the page links those itself).
  //   href: https, or a path inside the hub folder. At most 6.
  refs: [
    { label: "저장소 작업 규칙", href: "https://github.com/acme/app/blob/main/AGENTS.md" },
    { label: "알림 기획서", href: "https://github.com/acme/app/blob/main/docs/notify.md" }
  ],
  workers: [
    // tone: active (item work up to its worker_done, counts toward workerCap) | support (PR open after worker_done: waits for merge,
    //       or is reopened for a rebase or review fixes; does not count) | done (cleaned up; keep the row, the final sweep reads its path)
    { lane: "기반", item: "N2", worktree: "app-notify-n2-rules", state: "구현 중", tone: "active",
      dispatch: "ctx_xxxxxxxx", path: "/Users/me/orca/workspaces/app/app-notify-n2-rules" },  // dispatch, path: sync.cjs and cleanup use them
    { lane: "기반", item: "N1", worktree: "app-notify-n1-table", state: "병합 승인 대기", tone: "support",
      dispatch: "ctx_yyyyyyyy", path: "/Users/me/orca/workspaces/app/app-notify-n1-table" }
  ],
  lanes: [
    // A lane is a dependency chain: the page draws an arrow from each item to the next.
    // countsAsPr: true for lanes whose items are the owner's PRs (the headline, the stage strip and the checkpoint table count only these).
    { name: "선행 (다른 담당·병합 완료)", countsAsPr: false, items: [
      { id: "P30", title: "사용자 설정 표 정리", status: "merged", phases: 8, pr: 30, prUrl: "https://github.com/acme/app/pull/30" }
    ]},
    { name: "기반 레인", countsAsPr: true, items: [
      // id: ASCII letters, digits, - and _ only. title: the one-sentence outcome from the plan.
      // status: todo (waiting, normal) | active (worker coding, fixing review findings, or opening the PR)
      //         | review (independent review running) | walk (walkthrough waiting for the developer)
      //         | pr (PR open, CI running) | ready (CI green on the reviewed and approved code: on main it waits for merge approval)
      //         | merged | blocked (something stops the work)
      // phases: checkpoints reached, 0-8 (red, green, verified, reviewed, walkthrough approved, pr-open, ci-green, merged)
      // done: what this PR does so far, one sentence (from the worker's SUMMARY line; at the merge, what the PR delivered).
      // base, pr, prUrl (https only, rendered as a link), risk: rendered. ext: one short sentence on why the item is where it is.
      // after: ids of items in other lanes that must finish first (rendered as links to their cards).
      // waiting: set while the item's worker waits on the hub or the developer ("결정: <short question>");
      //   rendered as a pill, and the page then does not mark the worker as stopped. Remove it when answered.
      // walkthrough: the latest walkthrough round, "<id>-w<n>". The card and the checkpoint row link to it in every status.
      // walkApproved: the round the developer approved. A later `walkthrough` renders "승인 뒤 변경" until the merge.
      // walkPending / reviewPending: true for an upgraded hub's item that passed that checkpoint's place without it
      //   (rendered: the box late, no merge approval).
      // repo: only when the item's PR lives in another repo than the hub's (sync.cjs looks it up there).
      // Bookkeeping (not rendered): askId (id of the worker's pending ask or question: reply --id), reviewRound, reviewHead (head sent
      //   to the reviewer), reviewedDiff (changed-lines hash the reviewer passed), walkDiff (changed-lines hash the developer approved),
      //   overruled (["finding — why"]), pendingRebase (a rebase command held until the walkthrough is answered), branch, head, mergeSha.
      { id: "N1", title: "알림 설정 표를 추가한다", status: "ready", phases: 7, done: "사용자마다 야간 알림 여부를 저장하는 표를 추가했고 시험 4건이 통과합니다.", base: "main", risk: ["마이그레이션"],
        branch: "feat/notify-n1-table", pr: 41, prUrl: "https://github.com/acme/app/pull/41", head: "d4e5f6a",
        reviewRound: 1, reviewHead: "d4e5f6a", reviewedDiff: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c", walkDiff: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c", ext: "승인하면 허브가 병합합니다",
        walkthrough: "N1-w1", walkApproved: "N1-w1" },
      { id: "N2", title: "알림 규칙을 서비스로 만든다", status: "active", phases: 2, done: "야간 시간대를 판정하는 함수를 만들었고 시험 6건이 통과합니다.", base: "feat/notify-n1-table",
        branch: "feat/notify-n2-rules", waiting: "결정: 야간 알림 기본값", ext: "N1 위에 쌓아 작업합니다" },
      { id: "N3", title: "알림 설정 API 를 연다", status: "todo", phases: 0, ext: "N2 의 PR 이 열리면 시작합니다" }
    ]},
    { name: "화면 레인", countsAsPr: true, items: [
      { id: "N4", title: "알림 설정 화면을 붙인다", status: "todo", phases: 0, after: ["N3"], ext: "N3 가 병합되면 시작합니다" }
    ]}
  ],
  decisions: [
    // status: open (the developer must answer: shown in the to-do list on top) | watching (the hub is checking) | answered
    // id: the spec.md handle. text: the question as you would ask a colleague, then what depends on it.
    // options (2-4) and recommend (one of them): rendered under an open decision. items: ids waiting for the answer.
    // answer: the developer's choice, once answered. by: "hub" marks one the hub decided alone (listed apart), e.g.
    // { id: "P3", by: "hub", status: "answered", text: "알림 문구는 짧게 쓸까요?", answer: "짧게 쓴다" }
    { id: "Q1", status: "open", text: "밤 10시부터 아침 8시까지는 알림을 기본으로 끌까요? N2 의 기본값과 N4 의 안내 문구가 이 답으로 정해집니다.",
      options: ["기본으로 끈다", "기본으로 켠다"], recommend: "기본으로 끈다", items: ["N2", "N4"] },
    { id: "P2", status: "answered", text: "병합은 누가 하나요?", answer: "개발자가 승인하면 허브가 병합한다" }
  ],
  // Newest first. The page shows the first 8; keep about 30 entries.
  log: [
    "14:20 · N1 (#41) 의 CI 가 통과해 병합 승인을 요청했습니다",
    "14:05 · N2 가 시험 6건이 실패하는 것을 확인하고 구현을 시작했습니다",
    "13:55 · 개발자가 N1 워크스루를 승인해 PR #41 을 열었습니다",
    "13:40 · N1 이 독립 리뷰 1회차를 통과해 워크스루를 설명했습니다",
    "13:30 · N1 과 N2 의 작업자를 시작했습니다"
  ]
};
