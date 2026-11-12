# Independent review

Every item passes an independent review before the developer is walked through it, so the developer reads code a second pair of eyes already passed and no PR opens on unreviewed code. Independent means a fresh context that did not write, plan, or split this code: never you, never the item's worker.

## When

- After a "ready for review" ask whose walkthrough passed walkcheck ([walkthrough.md](walkthrough.md), "Check it, then have it reviewed"). The code is still local: the reviewer reads the worker's worktree.
- Again whenever the item's own lines change afterwards: a developer's change request, or after the PR is open a CI fix, a conflict resolved during a rebase, a review fix. Compare the changed-lines hash (below) with the item's `reviewedDiff`.

At the start of each round set the item `review`, `reviewRound` + 1 (a round restarted after a resume keeps its number), `ext` "독립 리뷰 <n>회차를 진행하고 있습니다", and record the head you send to the reviewer as the item's `reviewHead` (`git -C <worktree path> rev-parse HEAD`).

## Changed-lines hash

One hash of the file names, the added and removed lines, and binary or mode changes, nothing else. A clean rebase keeps it, so a review and a walkthrough still hold; any edit to the item's own lines changes it. (`git patch-id` is not used: it also hashes nearby unchanged lines, so a clean rebase can change it.) Store all 40 characters.

```bash
# Fixed prefixes, no colour, no renames, unquoted paths: a user's git settings cannot change it. Run `git -C <dir> fetch origin` first.
git -c core.quotePath=false -C <dir> diff --no-ext-diff --no-color --no-renames --src-prefix=a/ --dst-prefix=b/ origin/<base>...<head> | grep -E '^(diff --git|[+-]|Binary files|old mode|new mode)' | git hash-object --stdin
```

- Before the push: `<dir>` is the worker's worktree and `<head>` is `HEAD`.
- After the push: `<head>` is `origin/<branch>`, from the worktree or the repo path, so the hash is of what GitHub will merge.
- `<base>` is the item's current base: its parent's branch while it is stacked, `main` once it is retargeted.

It sees file names and mode changes of binary files, not their content: a worker that edits a binary file again after a review names it in its report. `reviewedDiff` is the hash the reviewer last passed; `walkDiff` is the hash the developer approved in the walkthrough.

## Who

The reviewer the developer chose in the standing choices. Default: a subagent you start in the background with your agent tool, using a code-review agent type when the session has one (for example `code-reviewer`), else a general-purpose one. Alternative: an Orca worker of a different agent (`worker-start --agent codex`, the brief below as its spec, told not to change any file) when the developer wants a second model to look.

## Brief

Fill every slot. The reviewer sees nothing but this text.

```text
Review item <id> of <repo owner/name>: the commits in the worktree <path> (head <sha>) against origin/<base>.<PR open: It is PR <url>.> Read-only: do not commit, push, comment, approve, or edit files.
Read `git -C <path> diff origin/<base>...HEAD`, the changed files in that worktree, the task spec <hub>/specs/<id>.md (Spec, Outcome, Scope, Not in this PR, Evidence required), the walkthrough the developer will read <hub>/walkthroughs/<id>-w<n>.js, and these repo rules: <paths>.
<Round 2 or later: previous blocking findings: <list>. Since the last review: <fixes in commits <shas> | the developer's change request <list> | a rebase that resolved conflicts in <files>>. Check each finding is fixed, then review the whole diff again.>
<After the developer's approval: The developer approved walkthrough round <k>. Since then: <the new round's `changes`>.>
Check, in this order:
1. Spec fidelity: it delivers the Outcome and Scope, nothing from "Not in this PR", and records the product answers where Scope says.
2. Correctness: bugs, edge cases, error paths, transactions, concurrency.
3. Tests (TDD): every behaviour in "Evidence required" has a test that fails without this code; no skipped, focused (.only), deleted, or weakened tests; the repo's coverage rule holds. The walkthrough's `tests` and `injections` list the red evidence.
4. Risk: migrations safe for the code already deployed; money, permissions, personal data handled by the repo's rules; every risk listed in the walkthrough's `risks`.
5. Shape: within the size budget in the spec; no mechanical change mixed into behaviour.
6. Walkthrough: its purpose, map, flow, and design say what the code really does. Anything that would give the developer a wrong picture of the code is a blocking finding.
Answer with `VERDICT: PASS` or `VERDICT: CHANGES` on the first line, then one line per finding:
`[blocking|non-blocking] <file>:<line> — <what is wrong> — <why it matters> — <suggested fix>`.
PASS means no blocking finding. Write in <the PR body's language>.
```

## After the verdict

1. Save it as `<hub>/reviews/<id>-r<n>.md`. Once the PR exists, post each saved round on it: `gh pr comment <n> --body-file <that file>`, under a heading such as "독립 리뷰 <n>회차: 통과" or "독립 리뷰 <n>회차: 수정 요청" (rounds from before the PR are posted when it opens: SKILL.md, `pr-open`).
2. Write the verdict into the walkthrough's `review`, so the developer sees it on the page (step 6): in a `node - <<'RV'` heredoc as in the walkthrough template, load the file, set `review` to every round so far (`{ round, verdict, head, findings: [{ level, file, line, what, fix }] }`, `fix` saying how an earlier round's finding was resolved, from the worker's "finding → commit" or your overrule), write it back with `JSON.stringify`.
3. **PASS**: first check that the head still equals `reviewHead` (`git -C <path> rev-parse HEAD`); if it moved during the review, review again. Record `reviewedDiff` from the hash. Keep the non-blocking findings for the final report's follow-ups. Then:
   - No `walkDiff` yet (the developer has not approved this item's code): clear `reviewPending`; phases 4 if they are lower; check the page and set the item `walk` right away, then walk the developer through it ([walkthrough.md](walkthrough.md), "Show it to the developer").
   - `walkDiff` set: clear `reviewPending`, send the item's held `pendingRebase` if any (merging.md; clear it once sent), and set status and phases from what has happened: no PR yet → `active`, phases 5 (send the held `APPROVED` if the developer approved meanwhile); PR open without a green `worker_done` since → `pr`, phases 6; a green `worker_done` at this head → `ready`, phases 7, and for base `main` run the preflight in [merging.md](merging.md) and ask for merge approval with the new round's `changes` in the message (stacked: it waits for its parent).
4. **CHANGES**: give the blocking findings to the item's worker. Before the PR: `reply --id <askId>` with `REVIEW: <findings>` (protocol rule 6c). With the PR open: `send` them (`send` reopens a closed worker; protocol rule 11). Item `active`, `ext` "리뷰에서 나온 <k>건을 고치고 있습니다" (k = blocking findings). When the worker asks "ready for review" again, or sends its "follow-up: review fixes", check the walkthrough again and start the next round.
5. You may overrule a finding you judge wrong on technical grounds: log why, add it to the item's `overruled` ("<finding> — <why>"), write the reason into that finding's `fix`, and say it in a PR comment once the PR exists. The walkthrough page and the merge approval message show it, so the developer sees what you set aside. A finding that is really a product question goes to the developer.
6. When the third round is still blocked on the same finding, stop the loop. Decide it yourself if it is technical and log the reason, or ask the developer.
