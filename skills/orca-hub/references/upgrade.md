# Upgrading a hub folder from an older version

Read this when you resume a hub whose `state.js` has no `v: 2`, or has `v: 2` but no `hubWorktree` field (then do only step 5 of the second part). A folder with no `sync.cjs` is the oldest layout: do both parts in order. A folder that has `sync.cjs` needs only the second part. Then go back to SKILL.md, "Start or resume".

Korean strings in this file are examples for a Korean-speaking developer: write the same meaning in the developer's language ([SKILL.md](../SKILL.md), "Language").

## From a folder with no sync.cjs

1. **state.js.**
   - Add `repo`, `closed: false`, and `lastMsgId: ""` (empty: on resume, reconcile every message the inbox shows against `state.js`); delete `pageId`. Rename an item's `merge` field to `mergeSha`.
   - `phases` in that layout counted six checkpoints. Map them to the eight of the next part's "old" numbers: red 1, green 2, verified 3 stay; old 4 (pr-open) becomes 5; old 5 (ci-green) becomes 6; old 6 (merged) becomes 8.
   - An item whose PR is open never had a walkthrough: set `walkPending: true`.
   - An `id` that carries a PR number (`"N1 #41"`, `"#30"`) keeps only a name (`"N1"`, `"P30"`), and the number goes to `pr` and `prUrl`. Give open PRs `base`.
   - Workers whose PR is open and who already sent `worker_done` get tone `support`.
2. **spec.md.** If there is none, write one from `state.js`, `protocol.md`, and the task specs, with IDs, and mark it as reconstructed ("재구성").

## To v: 2 (review before the walkthrough)

The older layout walked the developer through the code first and reviewed it after the PR opened. Now the review comes first, the walkthrough stays linked from the dashboard, and changes after the approval get a new walkthrough round.

1. **Templates.** Copy `dashboard.html`, `sync.cjs`, `walkthrough.html`, and `walkcheck.cjs` from this skill's `templates/` over the old ones (they are never edited, so nothing is lost; stop a running sync first: `kill "$(cat <hub>/sync.pid)"`). `mkdir -p <hub>/walkthroughs <hub>/reviews`. Older walkthrough files still open in the new page; a step whose data they lack says so.
2. **state.js.** Add `v: 2`. For each item:
   - `phases`, from the old order (… verified 3, walkthrough approved 4, pr-open 5, ci-green 6, reviewed 7, merged 8) to the new one (… verified 3, reviewed 4, walkthrough approved 5, pr-open 6, ci-green 7, merged 8): 0-3, 7, and 8 stay; old 4 becomes 5, old 5 becomes 6, old 6 becomes 7. An item moved this way (old 4, 5, or 6) passed the review's place without a review: set `reviewPending: true` (the dashboard marks the review box late and holds its merge approval).
   - An item whose walkthrough was approved: set `walkApproved` to its `walkthrough`.
   - `reviewedDiff` was made from `gh pr diff`; compute it again with the one hash command in [review.md](review.md), "Changed-lines hash", at the head the review passed (skip it when that head is gone: the next comparison then asks for a review). `walkDiff` keeps its value.
   - Delete `seenDiff`. An item with `sinceWalk` entries keeps them until it merges: list them in its merge approval message beside the walkthrough rounds' `changes`; no new entries are added.
   - Run `node --check state.js`.
3. **protocol.md.** Replace it with the new protocol block and the walkthrough template from [worker-spec.md](worker-spec.md), filled from the old file's slots. Running workers still hold their old spec: `send` each one the full text of the new `protocol.md` (the protocol block and the `## Walkthrough template` section) with "This replaces the Hub protocol section of your spec. Where they differ, this one holds." A worker that has not asked for its walkthrough yet now asks "ready for review" (rule 6b). Until a worker sends a status under the new protocol, its card shows your `done` for the item: write it from what `state.js` and the PR already say.
4. **Items in flight.**
   - `walk` with a walkthrough the developer has not approved: start its review now ([walkthrough.md](walkthrough.md), "Check it, then have it reviewed"); the item goes back to `review` and the developer sees it when the review passes.
   - `reviewPending`: `send` its worker "<id>: write walkthrough round <n+1> at your PR's head in the new template (protocol rule 6f), with `afterApproval: true` and `changes` from these entries: <its `sinceWalk`, or none>". When it arrives, check it with walkcheck, set the item's `walkthrough` to it, and review it at that head ([review.md](review.md), "After the verdict": the `walkDiff` branch clears `reviewPending`).
   - `walkPending`: its walkthrough comes before its merge approval ([walkthrough.md](walkthrough.md), "An open PR without an approved walkthrough").
5. **Sidebar.** Do SKILL.md step 5's last sentence (`hubWorktree`, the hub's name and tab). For each `workers` row whose tone is not `done`: `orca worktree set --worktree path:<path> --parent-worktree path:<hubWorktree> --display-name "<id> · <short title>"`, then mirror it as "After every event" says.
6. Start the sync and check the page once.
