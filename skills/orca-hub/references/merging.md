# Merging: preflight, stacked PRs, CI that will not start

Read this before you ask the developer to approve a merge, and again before you run the merge. The hub runs every merge; workers never do. No merge uses `--delete-branch`: the branch is still checked out in the worker's worktree, so gh's local delete fails and can skip the remote delete. Branches go in the cleanup ([cleanup.md](cleanup.md)).

Korean strings in this file are examples for a Korean-speaking developer: write the same meaning in the developer's language ([SKILL.md](../SKILL.md), "Language").

## Preflight before asking for approval

Ask for approval only for an item that is `ready` (green CI on code the reviewer passed; `walkApproved` is set, by the developer at `low` and by you at `medium` and `high`, and anything changed since is listed in this message), whose PR's base is `main`, and that has no `walkPending` or `reviewPending` (those come first: [walkthrough.md](walkthrough.md)), and only with these facts in the same message:

```bash
gh pr view <n> --json url,baseRefName,headRefOid,mergeStateStatus,reviewDecision,statusCheckRollup
gh repo view --json deleteBranchOnMerge,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed
git -C <repo path> fetch origin
<the changed-lines hash at origin/<head-branch>, review.md>          # must equal the item's reviewedDiff
git -C <repo path> merge-tree --write-tree origin/main origin/<head-branch>   # exit 0 = no conflict
```

- Hash differs from `reviewedDiff`: the PR's own lines changed after the review. It gets a new walkthrough round and a review first ([walkthrough.md](walkthrough.md), "Changes after the approval").
- `mergeStateStatus: BEHIND`: say so. After approval, run `gh pr update-branch <n>`, wait for green CI, and compute the hash again: unchanged, merge with the new head without asking again; changed (the update touched the PR's own lines), treat it as a change after the approval and ask again.
- `merge-tree` exits non-zero: name the conflicting files and send the rebase to the PR's worker.
- `reviewDecision` is not `APPROVED` while the repo requires review: name the reviewer to ask. A force-push after an approval dismisses it; say it needs approval again ("재승인 필요").
- A required check shown as `CANCELLED` blocks the merge even when another run of the same check passed (CI ran twice and one run was cancelled). Re-run it: `gh run rerun <run-id>`.
- `deleteBranchOnMerge: true`: GitHub deletes the head branch at merge time no matter which flags you pass, so the stack steps below cannot keep it. Tell the developer before the first stacked merge and offer to have the setting turned off while the stack exists. If it stays on, check every child right after the merge with `gh pr view <child> --json state,baseRefName`; a child that closed is rebased as in step 3 and reopened as a new PR from the same branch (`gh pr create --base main`), with the new number in `state.js` and on its sidebar card.

The approval message leads with the PR link and the walkthrough link (`file://<hub>/walkthrough.html?w=<item's walkthrough>`), then lists under a heading for code changed after the walkthrough approval ("워크스루 승인 뒤 바뀐 코드") the `changes` of every walkthrough round after `walkApproved` (CI fixes, conflict resolutions, review fixes, each with its `file:line`: [walkthrough.md](walkthrough.md), "Changes after the approval"; "none" ("없음") when `walkthrough` equals `walkApproved`), any `sinceWalk` entries an upgraded item still carries, and every `overruled` finding with your reason. The dashboard lists the item under "병합 승인" ("Merge") by itself once it is `ready` on `main`.

## Approval

Only an explicit approval that names the items counts: "W1 병합해", choosing W1 in a question, or "다 병합해" (merge all) in answer to a message that listed the items; the same intent in any language counts. "다 병합해" covers exactly the items listed in the approval message it answers, never an item that became ready after it. "좋네요", silence, or approval given before the preflight facts were shown is not approval: ask. An item whose hash changed after the approval (an `update-branch` that touched its own lines, a new review fix), or that gained a walkthrough round the approval message did not list, needs a new approval.

## At High

At `high` ([SKILL.md](../SKILL.md), "Autonomy levels") check the stop list first: a hit becomes a to-do with its reason, and nothing below runs for that item. Otherwise the preflight passing on green CI is the approval: merge as below without asking, log it, then run the deploy steps the repo documents (its rule documents or a deploy document the spec names), checking the stop list before each; never invent a step. The developer reads about it in the final report.

## Merge method

Use the method the repo's PR rules name. Otherwise `--squash` when `squashMergeAllowed` is true, else `--merge` when `mergeCommitAllowed` is true, else `--rebase`. Write it below as `--<method>`. The stack recipe below works with any of them, because each child rebases only its own commits onto the recorded old parent head.

## Merging a PR with nothing stacked on it

`gh pr list --base <its branch> --state open` is empty and no active worker builds on its branch: `gh pr merge <n> --<method> --match-head-commit <approved head>`. Record `mergeSha` from `gh pr view <n> --json mergeCommit -q .mergeCommit.oid`, then clean up the item.

## Merging the bottom of a stack

A PR whose base is another PR's branch is **stacked**. If the parent's branch is deleted at merge time, GitHub closes every PR based on it, and a closed PR cannot change its base: it can only be replaced by a new PR from the same branch. So the parent's branch stays until its children are retargeted.

For a stack `main ← A ← B ← C`, plus `A ← D` where D's worker has not opened a PR yet:

1. Record the head SHA of every branch built on A, directly or not, with or without a PR: `old-A`, `old-B`, `old-C`, `old-D`.
2. `gh pr merge A --<method> --match-head-commit <old-A>`.
3. A squash or rebase merge gives A's commits new hashes, so a plain rebase would replay them as duplicates. Each child rebases only its own commits. Send each worker its command, with the SHA you recorded:
   - Direct child with a PR (B): `git fetch origin && git rebase --onto origin/main <old-A> <B-branch>`, re-verify, `git push --force-with-lease`; then you run `gh pr edit <B> --base main` and set B's `base` to `main` in `state.js`.
   - Grandchild (C), after B's force-push lands: `git rebase --onto origin/<B-branch> <old-B> <C-branch>`, force-with-lease push. Its PR base stays `<B-branch>`.
   - Direct child without a PR yet (D): the same rebase as B, re-verify, and no push (protocol rule 9); its task's PR base becomes `main`, and it opens the PR only after its walkthrough is approved (protocol rule 6).
   - Any child in `review` or `walk`, with or without a PR: hold its command, because a rebase would move the head under the reviewer or the developer. Write the full command with its SHAs into the item's `pendingRebase` now, so it survives a compaction, and send it with your `APPROVED` reply, or with the PASS verdict of a review after the approval ([review.md](review.md), "After the verdict").
   A worker that already closed reopens when you `send` to it.
4. Clean up A once its children have their instructions ([cleanup.md](cleanup.md); its step 5 deletes A's remote branch once no open PR is based on it).
5. Set each rebased child that has a PR to phases 6 and status `pr` until its follow-up `worker_done`. A rebase that resolved conflicts may have changed the child's own lines: its hash (against its new base) then differs from `reviewedDiff`, and it gets a new walkthrough round and a review ([walkthrough.md](walkthrough.md), "Changes after the approval"). Then run the preflight for B before asking to merge it.

When a parent gains commits before it merges (review fixes, `update-branch`), its children rebase the same way onto the parent's new head: `git rebase --onto origin/<parent-branch> <parent's previous head> <child-branch>`. A child without a PR does not push (protocol rule 9).

## CI did not start after a force-push

When `gh pr checks <n>` shows nothing for the new head a few minutes after a force-push or base change, close and reopen the PR (`gh pr close <n> && gh pr reopen <n>`). That triggers the `pull_request` workflows for the current head.
