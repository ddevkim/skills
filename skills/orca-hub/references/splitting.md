# Splitting work into PRs

Read this before you plan items, and again when a worker reports a diff over its budget. The repo's own PR rules (a `pr-workflow` skill, CONTRIBUTING, `AGENTS.md`) come first where they are stricter.

## One PR is one unit

A unit has **one outcome a reviewer can verify in one sentence** ("after this PR, an admin can adjust a user's points with a reason") and **merges alone**: main stays green and deployable, and the code already deployed keeps working on the new schema. Write that sentence as the item's `title`.

Check every candidate item. Split it when any answer is no:

1. Is its outcome one sentence without "and" joining two behaviours?
2. Can it merge alone, with main green and deployable?
3. Is its estimate within the size target (≤ 15 files / 300 changed lines, counting hand-written code and tests, not lockfiles, generated files, or snapshots)?
4. Does it touch at most one risky area: a migration, a money or stock write, permissions, personal data, an irreversible send to users or outside systems (push, email, webhook)? A risky change goes in its own small PR so the review can focus on it. A guard that belongs to the same write (the lock or idempotency key on a balance update) is the same area and stays with it.
5. Is it all behaviour or all mechanical? Moves, renames, and formatting go in their own PR with no behaviour change, so the reviewer can check "nothing else changed". Regenerated files (an API client, a schema client) go with the change that causes them and do not count toward the size.
6. Do its tests ship with it? Tests are never a later PR (TDD, protocol rule 4).
7. Does it leave users with nothing half-built? Entry points users see (screens, routes, menus, buttons) land after every item the flow behind them needs (for example, the apply button waits for the sending job), or stay hidden until then.

Estimate before you start a worker: list the files the task's Scope names and count. Split over-target items now. The handoff patch (protocol rule 2) is for surprises found mid-work, not for planning.

## Where to cut

Cut along the dependency order, so each PR builds on merged PRs or on one open PR:

0. **Product doc**: when the repo keeps product specs, a docs-only PR records `spec.md` there first (it has no code, so its evidence is the repo's doc checks). Answers that arrive later are collected in `spec.md` and recorded by one more docs-only PR before the last item, not inside code PRs, so parallel PRs never edit the same doc.
1. **Mechanical prep**: a move or rename the later PRs need (for example, a helper moved into a shared package).
2. **Schema expand**: additive migrations only (new tables, nullable or defaulted columns), alone in a PR.
3. **Domain logic** with its tests: services, rules, transactions. One risky area per PR.
4. **Contract**: API endpoints or events, with the regenerated client in the same PR. Generated files do not count toward the size.
5. **Screens**: the entry point last.
6. **Contract cleanup**: dropping old columns or code. It needs the earlier PRs *deployed*, not just merged. Keep it out of this run as a follow-up in the final report, unless the developer confirms the deploy during the run.

A rename of something stored is expand → switch → contract: add the new name (and backfill), move the readers and writers to it, then drop the old name later (step 6). A rename in code only (an ORM field mapped to the old column) is a mechanical PR.

Walk the user's flow end to end (data → logic → API → screen → operations) and check that every step has an item. A missing step (for example, the read API a screen needs) is a new item, not a surprise for a worker.

## Size exceptions

- **Mechanical PR**: may exceed the file target (a move touching 29 imports) when `git diff -M --stat` shows only renames and one-line import changes. Say "mechanical" in its Scope; its evidence is the existing suite green before and after.
- **Known small overage**: an item 1-3 files over the target that cannot be cut without breaking "merges alone" may go ahead. Write its budget and the reason in the spec.
- Over the hard cap (30 files / 600 lines of behaviour): always split.

## Stacking and running in parallel

- An item **can start** when everything it needs is merged, or when it has exactly one unmerged dependency whose PR has green CI; it then stacks on that PR's branch. (Status `ready` on the dashboard means something else: reviewed, approved, and green, waiting for the merge.)
- Keep stacks at most two deep (`main ← A ← B`). A third level waits until A merges, because each level multiplies rebases.
- An item with two unmerged dependencies waits.
- Two items that change the same file (a schema file, a shared transaction, a generated client, a route table) do not run at the same time unless one stacks on the other. Append-only registries (an error-code list, an index export) are fine in parallel; the second PR rebases.
- Among items that can start, start first the one that most other items wait for, then the riskiest (it needs the most review), then the smallest.

## How many workers at once

Speed comes first: run as many workers as there are items that can go in parallel without overlapping, because each independent lane that waits is time lost. Overlap, not the developer's reading pace, is what makes parallel work expensive: two workers touching the same files or the same flow pay for it in conflicts, rebases, and new review rounds.

- **The cap** (`workerCap`) is the number of items that can start now and are independent of each other (the rules above: no unmerged dependency beyond one green parent, no shared file, stacks at most two deep), limited only by what the machine and CI hold: workers whose checks run at the same time without timing out or queueing for long. Propose it with the standing choices (SKILL.md, step 3; estimate the independent items from the spec, and correct it after the plan in step 4 in your next message) and let the developer set it. Without an answer, use that number, at most 4.
- **Backpressure.** Count the items waiting for the developer: status `walk`, plus `ready` items on `main` (the 워크스루 승인 and 병합 승인 rows of the dashboard's to-do list). When that count reaches the cap, start no new worker; log "새 작업자 보류: 개발자 확인 대기 <n>건" once. Workers already running carry on. Start the next item when the count drops below the cap. Below that, waiting items never hold back an independent item.
- **Adjusting.** At a checkpoint message, propose a change, and change `workerCap` only when the developer agrees:
  - up when an independent item is held only by the cap and the machine and CI keep up (no check timing out, no long CI queue);
  - down when running items keep conflicting (two rebases in a row that resolved conflicts between them: they were not independent, so re-cut them), or when checks start timing out or queueing.

## Writing the plan into state.js

- A **lane** is a dependency chain: the dashboard draws an arrow between consecutive items, so each item in a lane waits for the one before it. Independent work goes in separate lanes.
- When one item feeds several, put it at the end of its own lane and list it in the dependent items' `after` (`after: ["N3"]`): the page links each dependent card to it.
- Each item: `id` (ASCII letters, digits, `-`, `_`: the walkthrough link and file names need it), `title` (the outcome sentence), `base`, `risk` (the risky area in the developer's words), `ext` (what it waits for, as one short sentence: [dashboard.md](dashboard.md)).
- Each item names the `spec.md` lines it implements (completion criteria, test scenarios). Every completion criterion belongs to some item; one that belongs to none is a missing item.
- `flowSummary`: the lanes in the order they unblock each other, for example "선행 병합 → 기반 레인 → 화면 레인". The page shows it after the 개발 흐름 heading.

## Example

Feature "찜하기" (save products to a wishlist), with a shared price formatter that has to move:

| Lane | Item | Outcome (title) | Base | Risk |
|---|---|---|---|---|
| 준비 | W0 | 가격 표시 함수를 공용 패키지로 옮긴다 (mechanical, 24 files) | main | |
| 기반 | W1 | 찜 목록 표를 추가한다 | main | 마이그레이션 |
| 기반 | W2 | 찜 추가·취소·목록 규칙을 서비스로 만든다 | W1's branch, stacked once W1 has green CI | 동시성 |
| 기반 | W3 | 찜 API 를 연다(클라이언트 재생성 포함) | W2's branch once W1 merged (two deep at most) | |
| 화면 | W4 | 상품 화면에 찜 버튼과 내 찜 목록 화면을 붙인다 | main after W3 and W0 merge | |

W0 and W1 start together (cap 2: two independent items can start; W2 waits for W1). W4 waits for two parents, so it waits for both to merge instead of stacking.
