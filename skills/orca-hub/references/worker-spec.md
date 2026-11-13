# Worker spec

Every worker gets one file: `<hub>/specs/<item-id>.md` = the task part below + the full `<hub>/protocol.md`. Pass it with `--spec-file`. Workers do not see your conversation, the dashboard, or earlier workers' chats: everything they need is in this file or in repo paths it names.

Korean strings in this file are examples for a Korean-speaking developer: write the same meaning in the developer's language ([SKILL.md](../SKILL.md), "Language").

## protocol.md (write once per hub, append to every spec)

Fill the `<…>` slots from the repo (`package.json` scripts, `AGENTS.md`/`CLAUDE.md`, PR template) and from the developer's answers. Keep it in English; it is agent-to-agent text. Everything that differs per item (base branch, parent SHA, size budget) lives in the task part, never here.

After the block, append the walkthrough template (the `js` block in [walkthrough.md](walkthrough.md), "What the worker hands you") under the heading `## Walkthrough template`: rule 6 points to it.

```markdown
## Hub protocol (from the hub, on behalf of <developer name>)

1. ONE PR. This worktree carries exactly the PR in "Scope", within the size budget in your task (counting hand-written code and tests, not lockfiles, generated files, snapshots). Over the budget: stop and `ask` the hub with a split proposal (which part stays here, which parts follow).
2. HANDOFF. When the hub approves a split, commit only this PR's part. Stage everything that remains and write it as one patch, `git diff --cached --binary HEAD > <hub>/handoff/<next-branch-slug>.patch` (`/` in the branch name becomes `-`) (new files included), then `git reset --hard HEAD`. Name the patch in worker_done. The next worker applies it with `git apply --3way <patch>`, keeps its own part, and hands the rest on the same way.
3. WORKTREE. Do not create other worktrees and do not delete this one; the hub cleans up after this PR merges or is closed.
4. TDD IS REQUIRED. For each behaviour in "Evidence required": write its test first, run it, and see it fail for the expected reason (an assertion about the missing behaviour, not an import or compile error), then write only the code that makes it pass. A bug fix starts with a test that reproduces the bug. Production code that no failing test asked for is not accepted. Record every red: test name and the failing assertion line, from a run made before the code existed. Recovery, not an option: if you find production code that was written before its test, set it aside (`git stash push <files>`), run the test and record the red, restore it (`git stash pop`), and name those files in your next `red` status and in the PR body ("recovered: code written before its test in <files>"). Before the PR, run the failure injections in your task (break the implementation on purpose), confirm the named tests go red, restore, and record the result. A task marked "mechanical" adds no behaviour: its evidence is the existing suite green before and after, unchanged. A task marked "schema" (additive migration only): its tests assert the constraints the migration adds (a unique key rejects a duplicate, a default fills in) and fail before the migration is applied; also record that the migration applies cleanly on a database at main's schema. A task marked "docs": the repo's doc checks pass.
5. VERIFICATION IS REQUIRED. Run <exact commands, e.g. pnpm check && pnpm typecheck && pnpm test> in this worktree on the final head, before every push. All pass. Report the summary lines (test counts, coverage, exit codes) from that run, never from memory or from an earlier head. Never skip, focus (.only), delete, or weaken a test, lower a coverage threshold, or use `--no-verify` to get green. A check you cannot make pass is `--outcome failed` (rule 10), not a guess.
6. REVIEW AND WALKTHROUGH, THEN PUSH / PR. MERGE — never, and never `--admin`. Commit message style: <repo convention>. <AI attribution rule, e.g. no Co-Authored-By or "Generated with" lines>.
   a. When rule 5 passes, commit locally and do NOT push yet. Write `<hub>/walkthroughs/<item-id>-w<n>.js` (n = 1, then +1 each round) in the shape of "Walkthrough template" at the end of this protocol: purpose and intent with the spec lines quoted, the structure map of the modules you touched, the execution flow step by step with `file:line` and the 3-12 lines that do it, how it was built and why, spec line → test → red evidence, risks and unverified scope, changed files. It is data for an HTML page <the developer> reads to understand this PR: plain sentences, at most 2 lines each. Every `file:line` and `code` must match the committed head. Run `node <hub>/walkcheck.cjs <that file> . origin/<base>` from your worktree and fix every line it prints until it prints `ok`. The hub writes `review` and adds to `qa`: whenever you write a walkthrough file again, load it first and keep both as they are.
   b. `orca orchestration ask --question "<item-id>: ready for review: <path>. Head <sha>."`, then end your turn. An independent reviewer reads your commits and the walkthrough; once it passes, the hub walks <the developer> through it (at medium and high the hub approves it itself: rule 13). The walkthrough file is outside your worktree; if writing it needs a permission prompt, send `--phase approval` (rule 7) first.
   c. The reply starts with one of:
      `REVIEW: <blocking findings>` (from the reviewer) → for each finding: write a test that fails because of it, then fix it (rules 4-5), or answer why the finding is wrong. Commit, write the walkthrough again at the new head (same round number: <the developer> has not seen it), and ask again as in b, adding "finding → commit" for each finding.
      `APPROVED` (it may add a rebase to do first: rule 9, then re-verify) → go to d.
      `QUESTION: <q>` → append `{ q, a, refs: ["file:line"] }` to the walkthrough's `qa`, then `ask "<item-id>: walkthrough answered: <path>"` and end your turn. After `APPROVED` the hub sends questions with `send` instead: append the answer the same way, then `orca orchestration send --type status --subject "<item-id>: walkthrough answered" --body "<path>"` and keep working.
      `FIX-DOC: <list>` → fix only the walkthrough file (same round number), then ask again as in b. After `APPROVED` it comes by `send`: fix the round, run walkcheck, and send worker_done again naming the round.
      `CHANGES: <list>` (from <the developer>) → make each change test-first (rules 4-5), commit, write the next round with `changes` filled and the previous round's `qa` copied, and ask again as in b.
      Never push or open the PR on any other reply.
   `PARKED` in any message from the hub, at any time and in any phase, means the same: stop, do not push, send worker_done `--outcome failed` with "parked by the hub".
   d. `git push -u origin HEAD`; `gh pr create --base <the base branch in your task's Base section> --assignee <github login>` with a body in <PR language>: what/why, item id, the walkthrough's `purpose` and `flow` written as Markdown with `file:line`, base SHA, files, red evidence (rule 4), failure injections and their result, verification summary (rule 5), unverified scope, risk marking (migrations, money, concurrency, permissions, personal data); a stacked PR says "Stacked on #<n>; the hub retargets it to main after #<n> merges". Then `gh pr checks <n> --watch`; fix and push (`git push`) until green. A CI fix changes approved code: do f.
   e. OPEN PR. If your PR is already open and the hub asks for a walkthrough of it, do a-c at the PR's head. `APPROVED` then means: push the commits you made since that round started with `git push` (REVIEW or CHANGES fixes; none is fine), wait for green CI (`gh pr checks <n> --watch`), and send worker_done `--outcome succeeded` with "follow-up: walkthrough" and the head SHA.
   f. AFTER APPROVAL. Whenever lines of this PR change after `APPROVED` (a CI fix, a conflict you resolved in a rebase, a review fix), write the next walkthrough round at the pushed head, with `afterApproval: true`, the previous round's `qa` copied, and `changes` listing each change (`what`, `why`, `file`, `line`; a change that removed a file or its last lines gives `removed: true` and no `line`), run walkcheck until `ok`, and name the round in your worker_done. <The developer> reads it before approving the merge. While the reviewer asks for fixes to that round, write it again under the same number (rule 11); a change after it passed review is the next round. Your lines changed when this hash differs from the one you compute right after `APPROVED`, before anything else, and keep (`git -c core.quotePath=false diff --no-ext-diff --no-color --no-renames --src-prefix=a/ --dst-prefix=b/ origin/<base>...HEAD | grep -E '^(diff --git|[+-]|Binary files|old mode|new mode)' | git hash-object --stdin`, after `git fetch origin`); a rebase that leaves it equal needs no new round.
7. STATUS at each checkpoint, then keep working:
   `orca orchestration send --type status --phase <red|green|verified|pr-open|ci-green> --subject "<item-id>: <phase>" --body "SUMMARY: <one sentence>
<2-4 lines: done, next, blockers>"`
   The SUMMARY line goes on the item's dashboard card as it is, so <the developer> reads it with no other context: one plain sentence in <the developer's language> saying what this PR does so far, in terms of the outcome ("야간 시간대를 판정하는 함수를 만들었고 시험 6건이 통과합니다"), with no protocol word, hash, or file path. Your worker_done body starts with one too.
   `red` carries the red evidence; `verified` carries the verification summary; `pr-open` carries the PR URL.
   <Keep this sentence only when the developer approves permission prompts in worker terminals (standing choice); otherwise delete it:> At low, right before `git push` and `gh pr create`, send `--phase approval` with the command you are about to run: <the developer> approves those prompts in your terminal and needs to know you are waiting.
8. DECISIONS. Product or planning questions (limits, prices, wording, flows, who sees what) and contract conflicts with other owners: do not guess. `orca orchestration ask --question "<item-id>: <background 2-3 lines; options with impact; your recommendation; what is blocked>"`, then end your turn; Orca wakes you with the answer. Work on unaffected parts first. Technical choices the repo's rules answer are yours; say which rule you followed in the PR body.
9. REBASE. (Its worker_done body starts with a `SUMMARY:` line, rule 7.) When the hub tells you a parent PR merged, it sends the parent's old head SHA; use that SHA, not one from this spec: `git fetch origin && git rebase --onto <new base> <old parent head> <branch>`. When the hub tells you main moved under a PR based on main (behind or conflicting): `git fetch origin && git rebase origin/main`. Either way: re-verify (rule 5). With a PR open: `git push --force-with-lease`, wait for green CI (`gh pr checks <n> --watch`, fixing as in 6d), then send worker_done `--outcome succeeded` with "follow-up: rebase", the new head SHA, the files where you resolved conflicts ("none" if clean), the verification summary from the new head, and the walkthrough round at that head (rule 6f: the approved round when your lines did not change). Red evidence and failure injections are not repeated for a rebase. No PR yet: do not push (rule 6 still holds); if you already wrote a walkthrough, update its head and any `file:line` that moved, in place, and run walkcheck.
10. DONE. When CI is green, send the worker_done command from your Orca preamble with `--outcome succeeded` and a body with: the `SUMMARY:` line (rule 7) first, PR URL, branch, base SHA, head SHA, files + line counts, red evidence per behaviour, failure injections and their result, verification summary from the final head, unverified scope, open questions, the walkthrough round at this head (the approved round when no line changed after `APPROVED`; else the new round you wrote for the changes: rule 6f), machine quirks you hit with their workaround, and the suggested scope + base branch for the next PR in this lane. The hub sends back a report that lacks any of these. A check you cannot make pass is `--outcome failed` with the command and the last 30 lines of output.
11. REVIEW AFTER THE PR. (Its worker_done body starts with a `SUMMARY:` line, rule 7.) When lines change after `APPROVED`, the independent reviewer reads them again, and the hub sends you any blocking findings. For each one: write a test that fails because of it, then fix it (rules 4-5), or answer why the finding is wrong. Push, wait for green CI, write the after-approval round again at the new head (rule 6f, same round number), and send worker_done again with "follow-up: review fixes" and "finding → commit" for each finding.
12. The hub keeps the dashboard, and Orca shows your current activity on it. Do not create or edit it.
13. AUTONOMY: <low | medium | high>. At low nothing here changes. At medium and high, `APPROVED` may arrive right after the review passes, with no wait for <the developer>, and these run without a prompt: exactly `git push -u origin HEAD` (the first push), `git push` (later pushes), and `git push --force-with-lease` (after a rebase), so push with exactly these; `gh pr create …`; `rm` of relative paths. Every other push form asks <the developer> (`-f`, `--force`, and `+<ref>` are refused), and so does `rm` of a path with `/` first, `..`, `~`, or `$`. Everything else, including TDD evidence, the walkthrough, and the report, is unchanged. The hub may change the level with a message `AUTONOMY: <level>`.
```

## Task part (one per worker)

Every slot is required. Write "none" rather than dropping a slot: an empty slot is a question the worker will guess at.

```markdown
# Task: <repo> — <item-id>: <outcome sentence from the plan>

Owner: <developer>. You implement on their behalf.

## Base
Worktree created from `<base ref>` (<sha>). Branch: `<branch>` (`git branch -m <branch>` if Orca named it otherwise). PR base: `<main | parent branch>`. Record origin/main SHA.
<If stacked:> Stacked on PR #<n> (`<parent-branch>`). Do not merge or retarget it yourself; the hub sends rebase instructions (protocol rule 9).
<If continuing a split:> Start with `git apply --3way <hub>/handoff/<branch-slug>.patch`.

## Spec
<the lines of <hub>/spec.md this PR implements, copied word for word: its completion criteria, test scenarios, and the decided policies they rely on>.

## Scope (this PR only)
Outcome: <the one sentence a reviewer verifies>.
Size budget: <≤ 15 files / 300 lines, or the agreed exception and why>. Kind: <behaviour | mechanical | schema | docs>. Risk: <classes, or "none">.
<files / modules to create or change>. Contracts to implement exactly: <doc paths + sections>.
Product answers to record: <docs items only: the spec.md lines → the product doc and section they go into; "none" in code items (the hub's docs PRs record product answers)>.
Open product decisions: <question → which part of this PR depends on it; ask the hub (rule 8) when you reach that part, or "none">.
Not in this PR: <what neighbours own or later PRs do>.

## Evidence required
<the behaviours the tests must show, one per line; each one gets a red before its code (rule 4)>. Failure injections that must go red: <2-3 concrete ones>.

## Rules
<repo docs to read first; files owned by others that must not change, and where drafts for them go>.

## Environment
<machine quirks earlier workers hit, each with its workaround>. "none" for the first worker.

<protocol.md appended here>
```
