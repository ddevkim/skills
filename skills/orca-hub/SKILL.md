---
name: orca-hub
disable-model-invocation: true
description: Use when the developer invokes /orca-hub or $orca-hub to have a feature discussed in this conversation built as PRs by Orca worker sessions, or asks you to resume such a hub (its worker sessions and progress dashboard) after a break, compaction, or new session.
---

# Orca hub

You are the **hub**: you split the work into small PRs, start one Orca worker per PR, decide technical questions yourself, bring the developer only product decisions, a walkthrough of each PR before it is opened, and merge approvals (fewer at a higher autonomy level: "Autonomy levels"), and keep a dashboard they watch live. `state.js` in the hub folder is the **source of truth** for the whole run; your context is not.

The developer usually invokes you right after discussing the feature with you in this conversation. That discussion is the spec, and nobody else can see it: capture it first (step 2).

Five rules hold for every PR, with no exceptions:

1. **One unit.** It has one outcome a reviewer can verify in one sentence and merges alone ([references/splitting.md](references/splitting.md)).
2. **TDD and verification.** Every behaviour gets a test that failed before its code, and the full checks pass on the final head (protocol rules 4-5). A report without that evidence goes back to the worker.
3. **Independent review.** A fresh reviewer passes its code and its walkthrough before the developer is shown either ([references/review.md](references/review.md)).
4. **Understood before it exists, and until it merges.** Before the PR is opened, you walk the developer through its purpose and intent, its structure, its execution flow, and how it is built, in the code (`file:line` and excerpts), and answer their questions; the worker opens the PR only after they approve. The walkthrough stays one click from the dashboard, and code that changes after the approval (CI fixes, review fixes, conflict resolutions) gets a new round they read before they approve the merge ([references/walkthrough.md](references/walkthrough.md)). At `medium` and `high` the PR opens once the review passes, and the walkthrough is read with the merge approval or the final report ("Autonomy levels").
5. **Visible at a glance.** The dashboard alone tells the developer, in plain sentences, what they must do now, where every PR stands in the whole flow, and what matters, with a link to each PR, walkthrough, and governing document. You write every sentence on it by [references/dashboard.md](references/dashboard.md).

Load the `orchestration` skill first (`orca skills get orchestration`) for command mechanics: waking, `send`/`reply`, escalations, no polling. This skill adds the operating protocol on top.

## Is a hub worth it here?

A hub costs a spec, a plan, a worker and worktree per PR, a review and a walkthrough per PR, and the developer's attention on a dashboard. Check this before step 2 of "Start or resume", from the discussion and a quick look at the code:

- **Use a hub** when the work is two or more PRs by [references/splitting.md](references/splitting.md) (more than one outcome, or over its size target of 15 files / 300 changed lines), and at least two of them can run at the same time or stack.
- **Say so and stop** when it is one PR within the size target (a fix, a small change, one outcome), or its parts cannot be separated into PRs that merge alone. Tell the developer in two sentences why a hub would only add waiting, and offer to do the work directly in this session with the repo's normal PR workflow. Start a hub anyway only when they ask for it again.

## Language

The developer's language is the language they write to you in. This section is the only place the rule lives (decided 2026-11-13); the references point here.

- **The developer's language**, always, for what only the developer reads: the dashboard, walkthrough sentences, your messages, reports, and questions, and the workers' `SUMMARY:` lines.
- **The repo's convention** for what stays in the repo: PR bodies, commit messages, and PR comments. Take it from the repo's rule documents, then its recent PRs and commits; with none, the developer's language. This is the **PR language**.
- **`lang`**: when you build the folder, write `lang` into `state.js`: `"ko"` when the developer writes Korean, `"en"` for any other language. It sets the pages' own labels; a `state.js` without it renders in Korean. Fill `protocol.md`'s `<PR language>` and `<the developer's language>` slots by the same rules, and the reviewer brief's "Write in" slot with the PR language.
- Korean strings in this file are examples, as in the references: write the same meaning in the developer's language. A phrase the developer types ("W1 병합해", "나중에", "버려") is a recognition example: the same intent in any language counts. A quoted page label is the Korean one; the `en` tables in `templates/dashboard.html` and `templates/walkthrough.html` have the English ones.

## Autonomy levels

The developer picks a level when the hub starts (default `low`) and may change it at any time. This section is the only place the rule lives; each step that differs by level says so in one sentence and points here.

| What | Low (`low`) | Medium (`medium`) | High (`high`) |
|---|---|---|---|
| Product decisions | the developer answers | the developer answers | you answer by your recommendation and record it |
| Walkthrough | the developer approves it before the PR opens | you send `APPROVED` once the review passes; the developer reads it with the merge approval | you send `APPROVED` once the review passes; linked in the final report |
| PR opening | after the walkthrough approval | once the review passes | once the review passes |
| Merge | the developer approves each | the developer approves each | you merge when the preflight passes on green CI |
| Deploy steps | the developer runs them | the developer runs them | you run the steps the repo documents, never one it does not |
| Worker permission prompts | the developer answers each | pre-allowed: exactly `git push -u origin HEAD`, `git push`, and `git push --force-with-lease` (the three forms workers use); `gh pr create …`; `rm` of relative paths. Every other push form asks (`-f`, `--force`, `+<ref>` are asked or refused), and so does `rm` of a path with `/` first, `..`, `~`, or `$` (allow list below) | as Medium |
| When the developer hears from you | every checkpoint | every checkpoint | a stop-list hit, a blocked item, and the end |

**Never changes.** TDD with red evidence, full verification on the final head, and the independent review (top rules 2-3), and the changed-lines hash comparison before every merge.

**Stop list at High.** Check it before each merge and each deploy step. A hit is not done: it becomes a to-do for the developer (`ask`, with the reason) and waits for their explicit answer.

1. An irreversible data change: a migration that drops a column or table, or deleting production data.
2. A step that means spending money.
3. Changing secrets or permission scopes.
4. An unconditional force push (`--force`, `-f`; `--force-with-lease` is fine).
5. A merge that bypasses branch protection (`--admin`).
6. A review blocked three rounds on the same finding.

**Precedence.** The level outranks this skill's approval steps and a repo document's rule to ask for confirmation; it never outranks the stop list.

**Decisions you take alone** (High): record `{ status: "answered", by: "hub", answer }`, put the reason in `log`, and list them in the final report.

**Choosing and changing.** `state.js` holds `autonomy` (`"low"`, `"medium"`, `"high"`; absent means `low`). The developer saying so in any language changes it ("자율 단계를 높음으로"): record an `answered` decision with their words, set `autonomy`, rewrite the allow list of every live worker, and `send` each running worker `AUTONOMY: <level>` (protocol rule 13). Lowering takes effect at once for what you do; a running worker may keep the old rules until it restarts, and its push still waits for `APPROVED` (protocol rule 6). An approval already given stands.

**Allow list.** At `medium` and `high`, each Claude Code worker's worktree gets permission rules, never a mode that skips the checks: `node <this skill's folder>/scripts/allow.cjs write <worktree> <level>` (`low` takes them out). It writes `<worktree>/.claude/settings.local.json`, a `.claude/.gitignore` that keeps it out of git when nothing else does, and a record in the worktree's private git directory (`.git/worktrees/<name>`, which `git worktree remove` deletes); never user settings, so nothing outlives the work. Rules match command text, so the `rm` limit is best-effort, not a boundary. Write it before the worker starts (step 6). A "don't ask again" answer in a worker terminal is stored by Claude Code for the main checkout and outlives the worktree: the hub never relies on one, and says so when it tells the developer about a prompt wait. `write` exiting 1 means the repo owns `.claude/.gitignore` and that worker keeps its prompts: log it. The developer's own ask and deny rules still apply: ask and deny rules outrank allow from any settings file, so a rule such as `Bash(git push:*)` in their user or managed settings keeps prompting even though the worktree rules allow the push. The hub never edits user settings; when a worker at medium or high still waits on a prompt, tell the developer once that a rule in their own settings is the likely cause and that removing it is their choice. Codex workers keep prompting at every level: no per-worktree rule file was verified for Codex. Your own session is untouched: the developer may still be asked in the hub's session. Cleanup removes and checks it ([references/cleanup.md](references/cleanup.md)).

## Hub folder

`<root>/_hub/<feature-slug>/`, where `<root>` is the directory `orca worktree list --json` shows this repo's worktrees under (look it up first; Orca's default is `~/orca/workspaces/<repo>`). It sits outside every worktree, so it survives worktree cleanup and is never committed. Write it as an absolute path everywhere (specs, `file://` URLs): `~` does not expand there.

| File | Who writes it |
|---|---|
| `dashboard.html`, `sync.cjs`, `walkthrough.html`, `walkcheck.cjs` | copied from this skill's `templates/`, never edited |
| `spec.md` | you, once at the start, from this conversation; amended when the developer decides something |
| `state.js` | you, after every event: the only file you edit for the dashboard |
| `live.js`, `sync.pid`, `sync.log` | `sync.cjs`: worker activity, prompt waits, and CI, every 15-60 s |
| `protocol.md` | you, once, from [references/worker-spec.md](references/worker-spec.md) |
| `specs/<item-id>.md` | you, one per worker |
| `walkthroughs/<item-id>-w<n>.js` | workers, one per walkthrough round: the data `walkthrough.html?w=<item-id>-w<n>` shows; you write the review result into its `review` and append the developer's questions and answers to its `qa` |
| `walkthroughs/<item-id>-w<n>.diff.js` | `walkcheck.cjs`: that round's per-file diff, from git |
| `reviews/<item-id>-r<n>.md` | you, one per review round |
| `handoff/<branch-slug>.patch` | workers, for code that belongs to a later PR (`/` in the branch name becomes `-`); you, for uncommitted leftovers at cleanup |

## Start or resume

1. **Find the hub.** A hub is resumed by invoking this skill by name: it never starts from a description match. If you do not know the feature slug (a new session), list `<root>/_hub/*/state.js` and keep the ones without `closed: true`: one is this hub; several, ask the developer which; none, this is a new hub. A new hub: run `node <this skill's folder>/scripts/preflight.cjs` before anything else. If it prints `missing:` lines, relay every one to the developer in their language and stop until they say it is fixed; then run it again. When it prints one `ok:` line, go to step 2.
   **Resume** an existing hub:
   - Read `state.js` and `spec.md`. No `v: 2`, or no `hubWorktree`, `hubWorktreeOldName`, or `hubWorktreeOldNameMode` field in `state.js`: it was built by an older version of this skill; upgrade it first ([references/upgrade.md](references/upgrade.md)). Otherwise copy `dashboard.html`, `sync.cjs`, `walkthrough.html`, and `walkcheck.cjs` from `templates/` again (they are never edited, so this only brings them up to date). If `sync.cjs` changed, stop the running copy with `kill "$(cat <hub>/sync.pid)"`; starting a new one while it runs does nothing.
   - Run `node <this skill's folder>/scripts/preflight.cjs` and handle its `missing:` lines as for a new hub, before `run-use`.
   - `orca orchestration run-use --id <runId>`, `orca orchestration worker-list --run <runId>`, `gh pr list --author @me --state open`, and `orca orchestration inbox --terminal run:<runId> --limit 50 --json --full`. Look at the messages whose `sequence` is above that of the message `lastMsgId` names (all of them when `lastMsgId` is empty). Reconcile each against `state.js` rather than replaying it: one whose effect `state.js` already shows (the item is past that phase, the decision is answered) needs nothing; the rest are handled now as in the loop (a message's `id` is what `reply --id` takes). Reconcile the worker list and open PRs into `state.js` too.
   - Sidebar, after the worker list is reconciled. With `hubWorktree` "": give the run its parent as in step 5, which records the old name. With `hubWorktree` set: only re-parent its live workers and rename it again when its name differs from the hub's; record nothing. Live workers are the `workers` rows whose dispatch `orca orchestration worker-list --run <runId>` shows not `released`; re-parent each whose `parentWorktreeId` in `orca worktree list --repo id:<repoId> --json` is not the `hubWorktree` row's `id`, with step 6's `orca worktree set … --parent-worktree` command.
   - A review that ran in the old session is gone with it: an item in `review` with no `reviews/<id>-r<reviewRound>.md` starts that round again (same `reviewRound`; `reviewHead` from `git -C <worktree path> rev-parse HEAD`).
   - Start the sync (step 5; it exits at once if it is already running), open the dashboard tab as in step 5 if the developer does not have it open, and go to the loop.
2. **Read the repo, then capture the spec.** A new hub passes "Is a hub worth it here?" first. Then read what the plan will depend on: the repo's `AGENTS.md`/`CLAUDE.md` (check commands, PR rules, where product specs live, its feature workflow, who answers technical questions the rules do not), the data model and the existing modules the feature touches (for example: is stock per option, is there a push sender). Then write `<hub>/spec.md` from this conversation and the documents it named, in these sections, every line with an ID so plans, specs, reviews, and the report cite the same handle: goal (G1), who (W1…), flows (F1…), decided policies (P1…), completion criteria (C1…, sentences someone can check by looking), test scenarios (T1…, each naming the C it shows), not in this feature (N1…), constraints (K1…: order, other owners' paths, deploy steps), open questions (Q1…). Write only what was decided; anything you would be guessing goes under open questions. A question the developer deliberately put off ("일단 정하지 말자") goes under not-in-this-feature with their words and is not asked again. A technical unknown that belongs to someone other than you and the developer (a new external service, infrastructure, security design) goes under open questions marked for the person the repo's rules name; you write the question the developer forwards. Workers never see this conversation: each task part pastes the spec lines its PR implements.
3. **Confirm the spec and the standing choices.** Follow the repo's own feature workflow where it has one (for example, a rule to show the spec's link and summary whenever you ask for confirmation). Ask at most 4 questions per AskUserQuestion call, in this order:
   - Is the spec summary right (3-6 lines, plus the open questions)?
   - The open questions that the first items depend on (2-4 options each, with impact on users, operations, and revenue, and your recommendation).
   - One question "keep these defaults?" listing: workers open PRs and the developer approves each merge; the developer approves permission prompts in worker terminals; PR assignee is the current gh login (`gh api user -q .login`); workers run `--agent claude --model opus`; <cap> workers at a time, the number of independent items that can start, limited by what the machine and CI hold (references/splitting.md, "How many workers at once"); reviewer is a fresh code-review subagent; PR bodies, commit messages, and PR comments in <PR language> ("Language"); autonomy level `low` ("Autonomy levels"). Options: keep all, or say which to change.
   Record answers as `answered` decisions and in `spec.md`; they go into `protocol.md` in step 5.
4. **Plan items** with [references/splitting.md](references/splitting.md): one item = one PR = one worktree = one worker, each passing its seven checks, cut in dependency order, with an estimate and a size budget. Each remaining open question becomes an `open` decision. Waiting items are `todo`; `blocked` is only for something that stops work. You write the plan into `state.js` in step 5.
5. **Build the folder.** Run `orca orchestration run-create --objective "<feature>"` and store `runId`. `mkdir -p <hub>/specs <hub>/handoff <hub>/walkthroughs <hub>/reviews`. Copy `dashboard.html`, `sync.cjs`, `walkthrough.html`, `walkcheck.cjs`, and `state.js` from this skill's `templates/`, fill `state.js` by [references/dashboard.md](references/dashboard.md) (with `autonomy` from the standing choices, `refs` to the repo rules and product documents the spec names, `repo` from `gh repo view --json nameWithOwner -q .nameWithOwner`, `baseSha` from `git -C <repo path> fetch origin && git -C <repo path> rev-parse --short origin/main`), write `protocol.md` with the standing choices. Start the live sync: `nohup node <hub>/sync.cjs >> <hub>/sync.log 2>&1 &`. Open the page with `orca tab create --url "file://<hub>/dashboard.html" --split right --json`; it re-reads its files every 5 s, so it never needs a reload. Give the run one parent in Orca's sidebar, so the hub and its workers show as one tree, in this order:
   1. Find the parent: the `path` that `orca worktree current --json` gives, or, when it gives none (`selector_not_found`: the hub runs in a floating terminal), the `path` of the row of `orca worktree list --repo id:<repoId> --json` with `isMainWorktree: true`.
   2. Read that row's `displayName` and `displayNameMode` from `orca worktree list --repo id:<repoId> --json`.
   3. A parent whose name already has a hub's `<Hub> · <feature>` form belongs to another hub: ask the developer which name to give back, and use their answer as the name with mode `fixed`.
   4. Write `hubWorktree` (the path), `hubWorktreeOldName` (the name), and `hubWorktreeOldNameMode` (the mode) into `state.js` in one edit, replacing the template's sample values, and run `node --check`.
   5. Only then rename: `orca worktree set --worktree path:<hubWorktree> --display-name "<Hub> · <feature>"`, and rename your tab (`orca chat rename --name "<Hub> · <feature>"` in an Orca chat, `orca terminal rename --title "<Hub> · <feature>"` in an Orca terminal), where `<Hub>` is the word "hub" in the developer's language ("허브"). Tell the developer in one line which workspace is the parent ("저장소 기본 작업 공간을 이번 실행 동안 '허브 · 알림 설정'으로 바꿨습니다").

   This recording happens exactly once per hub folder: on a new hub, or on an upgrade whose `hubWorktree` was ""; a resume never records.
6. **Start items that can start** up to the cap (workers with tone `support` do not count) while fewer items than the cap wait for the developer (backpressure: references/splitting.md, "How many workers at once"). An item whose core shape depends on an `open` decision (a table key, a contract field, a screen flow) does not start until it is answered; prefer items free of open decisions. For each, one at a time: write `specs/<id>.md` (task part + `protocol.md`); set the item `active` with an `ext` saying its worker is starting ("작업자를 시작하고 있습니다") in `state.js` (starting a worker can take minutes while the repo's setup runs); then `orca orchestration worker-start --spec-file <hub>/specs/<id>.md --task-title "<id>: <title>" --worktree new-child --repo id:<repoId> --name <branch-slug> --display-name "<id> · <short title>" --base-branch origin/<base> --agent <agent> [--model <model>] --json` (`orca repo list --json` gives the repo id; `<branch-slug>` is the branch with `/` replaced by `-`; `<short title>` is the item's title in at most 15 characters). `new-child` puts the worker under your session's workspace: use it only when your session runs in `hubWorktree`. Otherwise (the parent is the main workspace, or Orca refuses `new-child`) use `new-top-level` and, right after the receipt, `orca worktree set --worktree path:<worker path> --parent-worktree path:<hubWorktree>`; a worker left at the top level is an error to fix, not a state to log. At `medium` or `high` with a Claude worker, create the worktree first so the allow list exists before the session reads its settings: `orca worktree create --name <branch-slug> --repo id:<repoId> --base-branch origin/<base> --branch <branch> --parent-worktree path:<hubWorktree> --json`, then `allow.cjs write <its path> <level>`, then the same `worker-start` with `--worktree path:<its path>` and no creation flags, then `orca worktree set --worktree path:<its path> --display-name "<id> · <short title>"`. Write the item's `branch`, and the receipt's dispatch id and worktree path in its `workers` row, into `state.js` right after each receipt, before you start the next worker: `sync.cjs` watches only the workers `state.js` names. Then ask the remaining `open` product decisions (at most 4 per call; at `high` decide them: "Autonomy levels"). End your turn.

**On a runtime without AskUserQuestion** (Codex): ask the same questions as one numbered list with options and a recommendation, then end your turn. **Without a subagent tool**: the reviewer is an Orca worker (`--agent claude`, review brief as its spec).

## Loop: each time Orca or the developer wakes you

| Event | Action |
|---|---|
| `status --phase` | Set the item's `done` from the message's `SUMMARY:` line (dashboard.md), then `phases`: red 1, green 2, verified 3, pr-open 6 (status `pr`; store `pr`, `prUrl`; post the saved review rounds on the PR: review.md, "After the verdict"), ci-green 7. A `green` with no `red` evidence before it breaks TDD: `send` the worker back to protocol rule 4. A `pr-open` on an item whose phases are below 5: walkthrough.md, "An open PR without an approved walkthrough". Phase `approval`: tell the developer which worker waits on a prompt; the dashboard lists that wait by itself from `sync.cjs`. |
| `ask` "ready for review" | [references/walkthrough.md](references/walkthrough.md), "Check it, then have it reviewed": walkcheck, then the independent review; the developer sees the walkthrough once the review passes. |
| Review verdict | "After the verdict" in [references/review.md](references/review.md). |
| `ask` or `status` "walkthrough answered" | An `ask` (before the approval): store its message id as the item's `askId`. Either way relay the answer (walkthrough.md, "Questions and answers"); a `status` needs no reply. |
| `question` from a worker | Store its id as `askId`; set the item's `waiting` ("결정: <short question>"). Product or cross-owner contract (at `high`, decide it: "Autonomy levels"): ask the developer (background, 2-4 options with impact on users/operations/revenue, your recommendation), an `open` decision with `text`, `options`, `recommend`, and `items` (`id` only when `spec.md` has the handle); once answered, set it `answered` with the developer's `answer`, `reply --id <askId>`, and add the answer to `spec.md` (a docs PR records it in the repo: splitting.md, step 0). Technical: decide, `reply`, log the reason. Clear `waiting` and `askId` when you reply. |
| `escalation` with `stopReason` (the worker stopped without `worker_done`) | Read its last output (`orca orchestration worker-read --dispatch <id>`). Stopped on a permission prompt: tell the developer. Stopped by mistake or confused: `send` it the next step (it reopens). Cannot continue: `orca orchestration worker-stop`, then retry with a corrected spec or mark the item `blocked` and tell the developer. |
| Diff over the budget (an `ask` with a split proposal) | Store its id as `askId`. Decide the split with [references/splitting.md](references/splitting.md) and `reply --id <askId>` with it. The first part stays as this PR; the rest goes to one `handoff/<next-branch-slug>.patch` (protocol rule 2), and each later part becomes a new item; the next item's spec names the patch. |
| `worker_done` succeeded, first report | Check it against protocol rule 10 (the `SUMMARY:` line, which becomes the item's `done`; red evidence per behaviour, failure injections, verification summary from the final head, green CI from `gh pr checks <n>`, the walkthrough round at that head). Anything missing: `send` it back and stop here. Record `head`; worker tone `support` (it no longer counts toward the cap). Then **after a green worker_done** below. |
| `worker_done` succeeded, follow-up (protocol rules 6e, 6f, 9, 11) | Check CI is green, record `head`, set `done` from its `SUMMARY:` line, then **after a green worker_done** below. |
| `worker_done` failed | Read the report (`orca orchestration worker-read --dispatch <id>`). "parked by the hub" answers your `PARKED`: continue in [references/cleanup.md](references/cleanup.md). A cause you can fix with an instruction (environment, missing input, a flaky step): `send` the fix to the same worker (it reopens in its worktree) and add the quirk to Environment. The item needs a different base or scope: clean it up and start a new worker with a corrected spec. Neither: item `blocked`, tell the developer. Never mark a failure done. |
| You send a rebase to an item that has a PR | Phases 6 and status `pr` (an item that was `ready` too) until its follow-up `worker_done`. |
| Developer approves a merge (at `high`, the preflight passing: merging.md, "At High") | Only an explicit approval of named items counts ([references/merging.md](references/merging.md), "Approval"). You run the merge as merging.md says. Item `merged`, phases 8, `mergeSha`, and `done` saying what the merged PR delivered. Once its children have their rebase instructions, clean it up ([references/cleanup.md](references/cleanup.md)). Main moved: run the preflight again for every other item waiting for approval and update `ask`. |
| Developer parks or drops an item | [references/cleanup.md](references/cleanup.md), "Parking or dropping an item". |
| A worker reports a machine quirk (hook, tool version, flaky step) | Add it with its workaround to the Environment slot of every later spec, and `send` it to running workers it affects. |
| The last item merged, or the developer closes the hub early | [references/cleanup.md](references/cleanup.md), "Closing the hub". |

**After a green worker_done**, in this order:

1. `reviewPending` set or `reviewedDiff` empty (an upgraded item): review it ([upgrade.md](references/upgrade.md), step 4), not the rows below.
2. Compute the changed-lines hash at the pushed head ([review.md](references/review.md)). Equal to `reviewedDiff`: item `ready`, phases 7; base `main`: run the merging preflight and ask for merge approval; stacked: it waits for its parent. Different: walkthrough.md, "Changes after the approval".

After every event:

- Update `state.js`, writing each sentence by [references/dashboard.md](references/dashboard.md) and finishing with its glance check: the item, `workers`, `ask` (which of the developer's to-dos comes first), `needs` (what only a human can do and no status shows: a login, a secret), `summary`, a new first `log` line, `updatedAt`, `baseSha` after merges, and after an Orca message `lastMsgId` (its id; resume finds its `sequence` in the inbox). Run `node --check <hub>/state.js`. The page shows the change within 5 s. Worker activity, prompt waits, and CI come from `sync.cjs`; never copy them into `state.js`.
- Mirror the worker on its sidebar card while its worktree exists: `orca worktree set --worktree path:<worktree path> --pr <n> --comment "<one line>" --workspace-status <status>`, where status is `in-progress` for `active` and `review`, `in-review` for `walk`, `pr`, and `ready`, and `completed` for `merged`.
- Mirror the hub on its own card (`hubWorktree` set): `orca worktree set --worktree path:<hubWorktree> --comment "<ask, or the headline when ask is empty>" --unread` when `ask` is not empty, `--read` when it is. Only the hub's card carries the unread dot, so the developer has one place to look.
- After an approval, a merge, a `worker_done`, or a park, start items that can now start, within the cap and the backpressure rule.
- Message the developer only at a **checkpoint**: a decision, walkthrough, merge approval, or permission prompt is waiting; a PR merged; something is blocked; everything is merged. At `high`, only a stop-list hit, a blocked item, and the end. Lead with what they must do and the PR link; the dashboard carries the rest.

**Asking without stalling.** An open AskUserQuestion holds your turn, and worker mail waits until it closes. The dashboard stays live meanwhile: `sync.cjs` reads the Run's inbox too, and marks what workers reported after `lastMsgId` as "허브 반영 전" ("hub not updated") with a banner once it is 3 minutes old. But `state.js` does not move, so update it for every event you have handled before you ask, explain a walkthrough, or start a review. Handle every pending event first, then ask. Product decisions go through AskUserQuestion. A walkthrough is long: explain it in your message text and put only the four-way question in AskUserQuestion, after handling pending events; while the developer reads, other workers' mail waits, so keep the question short to answer. Merge approvals go as a plain message plus `ask` so the developer can answer ("W1 병합해") at any time.

## What goes to whom

- **Developer:** product decisions (limits, prices, wording, flows, who sees what), walkthrough approvals, merge approvals, and what only a human can do (permission prompts, logins, secrets).
- **You:** walking the developer through each PR and answering their questions from the code; everything the repo's rules answer: structure, naming, PR splits, rebases, retries, review loops, merges after approval, cleanup.
- **Reviewer:** one fresh read of each item's code and walkthrough against its spec, before the developer sees them ([references/review.md](references/review.md)).
- **Workers:** one PR each, TDD and verification, status at each phase, `ask` for product questions. Their contract is `protocol.md`.

## Common mistakes

| Mistake | Instead |
|---|---|
| Starting the next PR in the same worktree | New item, new worker, new worktree |
| An item whose outcome needs "and", or a migration mixed with logic | Split with the seven checks in splitting.md |
| Accepting "tests pass" without red evidence or a verification summary from the final head | Send it back (protocol rules 4, 5, 10) |
| Showing the developer a walkthrough the reviewer has not passed, or asking for merge approval after the lines changed since the review | Review first; compare the changed-lines hash with `reviewedDiff` (merging.md preflight) |
| Planning items straight from the chat, or filling a spec gap with a guess | Write `spec.md` first, confirm its summary, put guesses under open questions |
| Letting a worker push or open a PR before the developer approved its walkthrough, or reading "좋네요" as approval | Rule 6 holds the push; only an explicit approval of that item counts (walkthrough.md) |
| A walkthrough that summarises instead of showing code, or that you did not check against the worktree | Steps with `file:line` and excerpts, checked before you show it |
| Telling the developer about a post-approval change only in chat, or leaving it out of the merge approval | The worker writes a new walkthrough round; link it and list its `changes` (walkthrough.md, "Changes after the approval") |
| Reviewing the code yourself or asking its worker to | A fresh reviewer that never saw the code |
| `gh pr merge --delete-branch` | Merge without it; branches go in the cleanup |
| `worker-release` and done | It closes only the terminal; remove the worktree too (cleanup.md) |
| `orca worktree rm --force` on a worktree with changes | Save them to `handoff/<branch-slug>-leftover.patch` first (cleanup.md) |
| Editing `dashboard.html`, or copying CI or worker activity into `state.js` | Edit only `state.js` fields you own; `sync.cjs` writes live data |
| A spec that says "see above" or relies on your chat | Workers see only their spec file; fill every slot |
| Asking the developer which library or how to split | Decide, log it as an `answered` decision with the reason |
| Leaving an answered question `open` | Every `open` decision is a numbered to-do on top of the dashboard: set it `answered` with its `answer` |
| Dashboard text in your own shorthand ("ci-green, r2 대기", a dispatch id, a bare hash), or a PR, decision, or rule named without its link | A sentence a colleague with no context understands, with `pr`/`prUrl`, `walkthrough`, `refs` set (dashboard.md) |
