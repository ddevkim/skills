# Cleaning up, parking, and closing

Read this when an item's PR merged (after its children have their rebase instructions), when the developer parks or drops an item, when you restart an item with a new worker, and when the last item merged. Touch only worktrees recorded in `state.js` `workers`: the repo's other worktrees belong to someone else.

Korean strings in this file are examples for a Korean-speaking developer: write the same meaning in the developer's language ([SKILL.md](../SKILL.md), "Language").

## Cleaning up an item

1. **Session.** `orca orchestration worker-release --dispatch <id>` once it has settled: a worker started in a new worktree stays open until released (`already_released` is fine). `orca orchestration worker-stop --dispatch <id>` if it is still working. Neither removes the worktree.
2. **Allow list.** `node <skill folder>/scripts/allow.cjs remove <path>`, then `node <skill folder>/scripts/allow.cjs check <path>`: it must exit 0. If it prints `left:` lines, stop and tell the developer what is left ([SKILL.md](../SKILL.md), "Autonomy levels").
3. **Uncommitted work.** If `git -C <path> status --porcelain` prints anything, save it first, leaving out the allow list files: `git -C <path> add -A -- . ':!.claude/settings.local.json' ':!.codex/rules/orca-hub.rules' && git -C <path> diff --cached --binary HEAD > <hub>/handoff/<branch-slug>-leftover.patch`, check that the patch is not empty, and name it in the log. When it changes tracked files, tell the developer at the next checkpoint: it may be work that belongs in a PR. Ignored files (build output, local env copies) are not saved.
4. **Worktree.** `orca worktree rm --worktree path:<path> --json`. Add `--force` only after step 3 saved the changes. Add `--run-hooks` when `orca repo list --json` shows a non-empty `hookSettings.scripts.archive` for the repo: that hook is the repo's own teardown for one worktree (containers, ports). If it fails (`worktree_archive_hook_failed`), the worktree stays: log it and tell the developer; do not add `--allow-failed-archive-hook` yourself.
5. **Branches, merged PRs only.** `orca worktree rm` keeps the local branch. If `gh pr view <n> --json state,headRefOid` says `MERGED` and `git -C <repo path> rev-parse <branch>` equals that `headRefOid`, run `git -C <repo path> branch -D <branch>` (`-D` because a squash merge leaves the branch looking unmerged; `<repo path>` from `orca repo list --json`). Delete the remote branch with `git -C <repo path> push origin --delete <branch>` once `gh pr list --base <branch> --state open` is empty and no worker builds on it; for the bottom of a stack that is right after its last child was retargeted ([merging.md](merging.md), "Merging the bottom of a stack"). A parked, dropped, or failed item keeps both branches: they hold its only copy.
6. **state.js.** Keep the worker row with `tone: "done"` and a `state` saying it is cleaned up ("정리 완료").

## Parking or dropping an item

"나중에", "다음에" (later), or unclear which: **park** (it can be undone; say you parked it). "버려", "안 해" (drop it): **drop**. The same intent in any language counts.

1. **No PR yet** (still coding, in `review`, or in `walk`): `reply --id <askId>` (or `send`) `PARKED`. The worker stops without pushing and answers with `worker_done` failed, "parked by the hub". Nothing was pushed, so the branch lives only in the worktree: save it before cleanup with `git -C <path> bundle create <hub>/handoff/<branch-slug>.bundle origin/<base>..HEAD` and name the bundle in the decision below.
2. **PR open, parked**: `gh pr ready <n> --undo` (if the repo has no drafts, leave it open) and a PR comment with the reason. **PR open, dropped**: `gh pr close <n> --comment "<reason>"`.
3. Either way: clean it up keeping both branches (above), move it to an on-hold lane ("보류") with `countsAsPr: false`, status `todo`, an `ext` giving the reason and that the branches are kept ("<reason> 때문에 보류했습니다. 브랜치는 남겨 두었습니다"), and record an `answered` decision with the PR or bundle and the kept branch. Decisions that only it needed become `answered`, deferred with it ("보류로 미룸"). Items that build on it: ask the developer whether they wait or go too.

## Closing the hub

When the last item merged, or when the developer closes the hub early (park or drop each open item first, as above):

1. For every `workers` row, clean it up again if `orca orchestration worker-list --run <runId> --json` shows its terminal not `released` or `orca worktree list --repo id:<repoId> --json` still lists its path. Then run `allow.cjs check` on every worker path that still exists: any `left:` line fails the close, so tell the developer what it printed and do not set `closed`.
2. Delete the remote branch of every merged item that `git -C <repo path> ls-remote --heads origin <branch>` still shows.
3. Set `closed: true` (the sync writes once more and exits). With `hubWorktree` set, first read every other hub folder's `state.js` (`<root>/_hub/*/state.js` without `closed: true`): if another open hub records the same `hubWorktree`, leave the parent's name and comment as they are, since that hub still shows under it, and say so in `log`. Otherwise give the parent back by the first rule that applies:
   1. `hubWorktreeOldNameMode` is not "" and `hubWorktreeOldName` is not "" (the name is known): `orca worktree set --worktree path:<hubWorktree> --display-name "<hubWorktreeOldName>" --comment "" --read`. A mode other than `fixed` comes back as a fixed name, since no command returns a workspace to its automatic name (`--display-name ""` is accepted and changes nothing): tell the developer.
   2. Otherwise, if the parent still carries the hub's name: ask the developer which name to give back (an upgraded hub lost it), then the same command with their answer.
   3. Otherwise the hub renamed nothing: `--comment "" --read` only.

   A parent that is the hub's own workspace keeps the hub's name only if the developer asks for that. No `--workspace-status`: the hub never set the parent's board status. Never remove the parent workspace.
4. Final report per item: PR link, merge SHA, evidence, review rounds, walkthrough link and the changes after its approval, follow-ups (non-blocking findings, overruled findings, deferred contract steps); then kept branches, bundles, and leftover patches. The hub folder and the dashboard tab stay as the record.
