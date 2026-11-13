# Dashboard: the whole run at a glance

Read this before you fill `state.js` the first time, and keep to it on every later edit. The reader is the developer coming back after an hour away, with none of your context. In five seconds, without asking you, they must know three things in this order: **what only they can do now**, **where every PR stands in the whole flow**, and **what matters that the cards do not show**. Then every claim on the page is one click from its source: the PR, the walkthrough, the task spec, the governing document.

`dashboard.html` is fixed and draws the layout. You control what it says through `state.js`, so the page is as clear as your sentences and as connected as your links.

Korean strings in this file are examples for a Korean-speaking developer: write the same meaning in the developer's language ([SKILL.md](../SKILL.md), "Language").

## What the page shows, and from which field

| On the page, top to bottom | Comes from | You write |
|---|---|---|
| Header line and headline (the developer's to-do count) | `title`, `owner`, counts | `title`: the feature's name in the developer's words |
| **To-do list**: one numbered row per thing only the developer can do, each with its link and how to answer | prompt waits (from `sync.cjs`), `needs`, open `decisions`, items in `walk`, `ready` items on `main`, `blocked` items | `ask`, `needs`, and each decision's `text`, `options`, `recommend`, `items` |
| **Stage strip**: how many PRs are in each stage, 대기 → 작업 중 → 독립 리뷰 → 워크스루 대기 → PR 열림·CI → 병합 준비됨 → 병합됨 (English: Waiting → Working → Review → Walkthrough waiting → PR open · CI → Ready to merge → Merged); each id jumps to its card | item `status` | nothing more: keep `status` true |
| What to know now | `summary` | at most 3 sentences |
| Governing documents | `spec.md`, `protocol.md`, `refs` | `refs` |
| **Flow**: lanes of cards with arrows; each card has its status, PR link, CI, walkthrough, task spec, what the PR does so far, and the worker's live activity | `lanes`, `live.js` (a worker's newest `SUMMARY:` line shows on its card within a sync cycle, until you handle that message; from then on your `done` shows, so a line you rewrote replaces the worker's) | item `title`, `done`, `ext`, `risk`, `after`, `waiting`, `pr`, `prUrl`, `walkthrough` |
| Checkpoint table: eight boxes per PR, linked to the walkthrough and the PR | `phases` | nothing more |
| What was decided; workers and the last 8 log lines | answered `decisions`, `workers`, `log` | `answer`, worker `state`, `log` |

## Sentences

Write every field the way you would say it to a colleague who was not here.

1. **A whole plain sentence, in the developer's language.** Subject, verb, ending. "N2 가 N1 위에 쌓여 있어서 N1 을 먼저 병합해야 합니다", not "N1 선행 필요". No clever or compressed phrasing.
2. **The page's own words for stages**: 시험 실패 확인, 구현 통과, 전체 검증, 독립 리뷰, 워크스루, PR 열림, CI 통과, 병합 (English: Test fails, Code passes, Full check, Review passed, Walkthrough OK, PR open, CI passed, Merged). Never the protocol's (`ci-green`, `worker_done`, `r2`, "phase 6"), a dispatch id, or a bare commit hash without what it is.
3. **Name the thing**: the item id, and the PR number once it exists ("N1 (#41)"). "그 PR", "위 작업" mean nothing on a page read alone.
4. **Say the consequence, not only the fact.** A wait says what it waits for and what starts after; a risk says what could break; a decision says what depends on the answer.
5. **Each fact once among what is current.** `ask` does not repeat the rows under it. `summary` does not repeat a card or a decision. Never copy what `sync.cjs` shows live: CI pass and fail counts, the worker's current command. `log` is history, so an event appears there as well as in the field it changed.
6. **Short enough to scan**: `title`, `ext`, a log line: one line (about 12 words). `ask`, a `summary` line, a decision's `text`: at most two.

| Field | Write | Good | Not |
|---|---|---|---|
| item `title` | the outcome, as a sentence someone can check | "알림 설정 표를 추가한다" | "DB 작업" |
| item `done` | what this PR does so far, one sentence in terms of the outcome; taken from the worker's `SUMMARY:` line at each status and rewritten when it breaks these rules; at the merge, what the PR delivered | "야간 시간대를 판정하는 함수를 만들었고 시험 6건이 통과합니다" | "green", "구현 완료" |
| item `ext` | why the item is where it is, or what it waits for | "N2 의 PR 이 열리면 시작합니다" | "N2 PR 뒤" |
| item `waiting` | "결정: <the question in five words>" | "결정: 야간 알림 기본값" | "ask 대기" |
| `ask` | which to-do comes first, and why; empty with no to-do or only one (the row already says it); never a to-do the list lacks (that is `needs`) | "N1 병합을 먼저 승인해 주세요. N2 가 그 위에 쌓여 있습니다." | a list of every to-do |
| decision `text` | the question, then what depends on it; `options` 2-4, `recommend` one of them, `items` waiting for it | "밤 10시부터 아침 8시까지는 알림을 기본으로 끌까요? N2 의 기본값이 이 답으로 정해집니다." | "야간 기본값 TBD" |
| decision `answer` | the developer's choice in their words | "기본으로 끈다" | "A" |
| `summary` | what changed the plan, what is riskier or later than planned, what the developer would be surprised to learn at the merge | "N3 는 예상보다 커서 둘로 나눴습니다. 뒤쪽은 N5 입니다." | progress the stage strip already shows |
| `log` line | "HH:MM · <item> <what happened>", newest first | "14:20 · N1 (#41) CI 가 통과해 병합 승인을 요청했습니다" | "14:20 N1 ci-green" |
| worker `state` | a status label of two to four words (it is drawn as a pill, the one field that is not a sentence); never CI | "병합 승인 대기" | "support", "CI 통과" |
| `needs` | what only a human can do and no status shows (a login, a secret): `text` what and where, `how` the way to do it; remove it when done | "스테이징 DB 비밀값을 N3 작업자 터미널에 넣어 주세요." | a decision, a walkthrough, a merge approval, or a prompt wait: the page lists those itself |

## Links: everything can be followed

- **PR**: set `pr` and `prUrl` in the same edit that records `pr-open`. A PR number without its URL is a dead end.
- **Walkthrough**: set `walkthrough` the moment the review passes (walkthrough.md); the card, the checkpoint table, and the to-do row all link to it.
- **Task spec**: the card links `specs/<id>.md` once the item has a `workers` row, so write that file before the row.
- **Governing documents**: `refs` holds what this run obeys beyond `spec.md` and `protocol.md`: the repo's `AGENTS.md`/`CLAUDE.md`, the product or design document the spec was written from, a ticket. `{ label, href }`, the label saying what the document is ("저장소 작업 규칙"), the href `https://…` (the file on GitHub: `https://github.com/<repo>/blob/main/<path>`) or a path inside the hub folder. Add one when a decision or a review finding cites a rule the list lacks.
- **Dependencies across lanes**: `after: ["N3"]` on the dependent item, so its card links to the one it waits for. Keep it true when an item is split or dropped.

## Glance check, after every edit

Read the page as the developer would (`state.js` top to bottom is enough once you know the page):

1. Is everything only the developer can do in the to-do list, and nothing else? An answered decision still `open`, or a blocked item without the reason in its `ext`, fails.
2. Does `ask` name the one to do first? Is it empty when the list is empty?
3. Can each card explain itself from `status` and `ext` alone, to someone who has not read your chat?
4. Is `summary` still true and still news? Drop a line once the developer has acted on it.
5. Does every PR, walkthrough, and cited rule have its link?
6. Any shorthand, protocol word, or fact said twice? Rewrite it.

## Design rules the pages hold

`dashboard.html` and `walkthrough.html` are never edited during a run. When this skill's templates are changed, or you build any other page for the developer, hold these, so every page of a hub reads the same way:

- **The first screen stands alone**: a header line saying what this is, for whom, and when; a headline that states the point; what the reader must do, once, with how to answer; then one visual of the whole.
- **Show it, then label it**: counts, a stage strip, a flow of cards, checkboxes, a diagram. Everything above the reference lists (what was decided, the log) is a visual with real data, linked to its source.
- **Colour means one thing each.** Red: the developer must act, or something is wrong. Amber: watch. Green: done or passed. Clay: in motion, or something to click. Nothing else is coloured.
- **Each number and each list once.** Detail the reader needs later sits one click away, never on the first screen.
- **No walls of text**: two lines per paragraph, about ten words per table cell, one label per thing. The only second line a thing gets is how to act on it.
- **Nothing breaks its box**: layouts that wrap, readable at 400 px and at 1440 px, in light and dark. A table wider than six columns (the checkpoint table) scrolls sideways inside its card.
