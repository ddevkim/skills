# Walkthrough: before the PR, and until the merge

Read this when a worker asks "ready for review", when a review passes, and whenever a PR's lines change after the developer approved them. No PR is opened until an independent reviewer has passed the code and the developer has understood and approved it. The developer owns the code that merges; the walkthrough is where they build their picture of each PR, so it stays reachable from the dashboard and stays true to the code until the merge. Every item gets one, mechanical ones included, whatever the standing choices say about merges.

## What the worker hands you

After its checks pass (protocol rule 5) the worker commits locally, does not push, writes `<hub>/walkthroughs/<item-id>-w<n>.js` in the shape below, runs `node <hub>/walkcheck.cjs` on it until it prints `ok`, sends `ask` "ready for review", and ends its turn. Its worktree holds exactly the commits that will be pushed.

The file is data for `<hub>/walkthrough.html`, a fixed page that holds the same design rules as the dashboard ([dashboard.md](dashboard.md), "Design rules the pages hold"), and whose sentences you and the worker write by that file's "Sentences": a header line, the outcome as the title, what the developer should do now, four numbers, then seven steps (목적과 의도 → 구조 → 실행 흐름 → 구현 방식 → 시험 → 위험과 리뷰 → 질의응답), one per screen with Back and Next. Step 1 also shows where the PR sits among the feature's items (from `state.js`), step 2 draws the `map`, step 3 shows each flow step's code with its real line numbers, step 4 shows each file's diff (from `<item-id>-w<n>.diff.js`, which walkcheck writes), and step 6 shows the independent review. The page re-reads its files every 5 s, so what you add appears while the developer reads. Never hand-write HTML for a walkthrough: write the data, and the page stays the same for every item and round.

```js
/* <hub>/walkthroughs/<item-id>-w<n>.js. The page runs this file as a script, so it must be plain data: exactly
   `window.HUB_WALK = <JSON>;`. Build the object in a script and write it with JSON.stringify (never by hand, never
   template literals). Feed the script on stdin through a quoted heredoc, so quotes in the text cannot break the shell:
     node - <<'WALK'
     const w = { item: "...", ... };
     require("fs").writeFileSync("<file>", "window.HUB_WALK = " + JSON.stringify(w, null, 1) + ";\n");
     WALK
   Every text is a plain Korean sentence a colleague would say, at most 2 lines; labels at most 10 words; no clever
   phrases. Every file:line and code matches the committed head: walkcheck.cjs compares them line by line. */
window.HUB_WALK = {
  item: "<item-id>", round: <n>, title: "<the outcome sentence>",
  owner: "<developer>", worker: "작업자 <item-id>", date: "<YYYY-MM-DD>",
  head: "<short sha, local>", base: "<base branch>", baseSha: "<short sha>", branch: "<branch>",
  kind: "<behaviour | mechanical | schema | docs>",
  changes: [ /* round 2 and later: each change since the previous round */
    { what: "<what changed, one sentence>", why: "<why>", file: "<repo path>", line: <n> } ], // a removal: removed: true, no line
  afterApproval: <true in a round written after the developer's APPROVED (protocol rule 6f), else false>,
  purpose: {
    why: "<why this PR exists, one sentence>",
    after: "<what users or operators can do after it that they could not before>",
    spec: [ { id: "C3", text: "<the spec line, word for word>" } ],       // every spec line it implements
    notHere: [ { item: "<item-id>", what: "<what that PR does instead>" } ]
  },
  map: { // the modules this PR touches and their direct neighbours, top layer first; the page draws it
    layers: [ "<layer names in the repo's own words, e.g. 화면, API, 서비스, 저장소>" ],
    nodes: [ { id: "<short ascii id>", label: "<what it is, a few words>", layer: "<one of layers>",
               file: "<repo path, optional for existing ones>", state: "<new | changed | existing>" } ],
    links: [ { from: "<node id>", to: "<node id>", label: "<what passes or why it calls, a few words>" } ]
  },
  flow: [ // the path one real request or event takes, entry point to stored result or response
    { title: "<what happens, one sentence>", file: "<repo path>", line: <first line>,
      code: "<the 3-12 lines that do it, verbatim>", note: "<optional: why it is written this way>" }
  ],
  edges: [ // each error or edge path the tests cover: duplicate, unauthorised, concurrent, retried
    { name: "<the case>", steps: [ { title: "<what happens>", file: "<repo path>", line: <n> } ] }
  ],
  design: [ { decision: "<what was chosen>", why: "<why>", rejected: "<the alternative and why not>", rule: "<repo doc path, optional>" } ],
  data: [ { table: "<table>", column: "<optional>", stores: "<what it now stores, in words>", safe: "<why safe for the code already deployed>" } ],
  tests: [ { spec: "C3", test: "<test name>", file: "<path>", line: <n>, asserts: "<what it asserts>", red: "<the failing assertion before the code>" } ],
  injections: [ { broke: "<what was broken on purpose>", red: ["<test names that went red>"] } ],
  verify: { command: "<exact commands>", summary: "<summary line from the final head>" },
  risks: [ { area: "<money | migration | permissions | personal data | concurrency | irreversible send>", guard: "<what guards it>" } ],
  unverified: [ "<what is not verified, and why>" ],
  followups: [ "<follow-up work>" ],
  files: [ /* one row per line of `git diff --numstat --no-renames origin/<base>...HEAD` (a moved file is two rows: removed
              and added); walkcheck compares with exactly that */
    { path: "<repo path>", added: <n>, removed: <n>, role: "<its role, a few words>" } ],
  qa: [ /* { q, a, refs: ["file:line"] }: the hub and the worker append here, newest last; a new round copies the previous round's */ ],
  review: [ /* the hub writes this, never the worker: { round, verdict, head, findings: [ { level, file, line, what, fix } ] } */ ]
};
/* Kind mechanical: flow is [] (the page says "동작 변화 없음") and map may be {}; design says what moved where and how to check nothing
   else changed (`git diff -M --stat`); tests is the suite before and after. Kind schema: flow is what each new table or
   column stores and who will write it. Kind docs: purpose and files only. Kinds behaviour and schema need map.nodes. */
```

## Check it, then have it reviewed

Store the ask's message id as `askId`. Then, read-only, in the worker's worktree:

- `git -C <path> fetch origin`, then `node <hub>/walkcheck.cjs <hub>/walkthroughs/<id>-w<n>.js <worktree path> origin/<base>` prints `ok`. It checks that the file is plain JSON data, the worktree is clean and at the walkthrough's `head`, every `file:line` exists at that head, every `code` excerpt equals the file line by line, the `map` names real files, layers, and nodes, and `files` equals `git diff --numstat --no-renames origin/<base>...HEAD` path by path (always `origin/<base>`, never a local branch that may be behind). Each problem it prints names the field and the `file:line`. On `ok` it writes the diff file the page shows.
- `purpose.spec` cites only spec lines from this item's task spec, word for word; `flow` is the path the `tests` exercise.

Anything off: reply `FIX-DOC: <walkcheck's lines and what to fix>`. Every reply in this file is `orca orchestration reply --id <askId> --body "<reply>"`; clear `askId` after each one (the worker's next ask brings a new id).

Clean: start the independent review ([review.md](review.md)). The developer sees the walkthrough only after the review passes, so the item's `walkthrough` (the dashboard's link) is set then, not now.

## Show it to the developer

As soon as the review passes ([review.md](review.md), "After the verdict"), open the page (`orca tab create --url "file://<hub>/walkthrough.html?w=<id>-w<n>#1" --json`) and read it as the developer would: the first screen says what this is and what to do; every heading and label is a plain sentence a colleague would say; no text runs past 2 lines; every flow step says what happens, not which function is called; the map shows each changed module once; nothing spills out of its box. Unclear text goes back as `FIX-DOC` (wording only: the worker changes no fact the reviewer checked; run walkcheck again when it returns).

Then, still right after the review, set the item's `walkthrough` to `<id>-w<n>` (the dashboard links it from now on, in every status), the item `walk` (the dashboard shows "워크스루 대기" in red), and its `workers` row state "워크스루 대기". The conversation follows, one item per message, oldest first when several wait:

1. Lead your message with the item id, the outcome sentence, and the page URL.
2. Walk the developer through the seven steps in order, naming the step they should look at ("3단계 실행 흐름의 3번 노드"): purpose and intent and where this PR sits, then the structure map, then the execution flow node by node with each `file:line`, then how it was built and why, then which tests prove which spec line, then the risks and what the reviewer found. Your message adds what the page cannot: how the pieces connect and why. Do not paste the page back into the chat.
3. Ask (AskUserQuestion, or a numbered list on a runtime without it): **PR 올려 (승인)** · **질문이 있다** · **고쳐야 할 곳이 있다** · **보류**.

## Questions and answers

The developer may ask as many questions as they need, in any order, before the approval and after it (the page stays open to them until the merge). For each:

- Answer from the code: read the worktree, cite `file:line`, quote the lines. Run a command or a single test in the worktree when that answers it better than reading (read-only: no edits, no commits).
- A question only the worker can answer (why it chose X over Y): reply `QUESTION: <question>`. Once the walkthrough is approved, `send` it instead: the worker appends its answer to `qa` and reports "walkthrough answered" as a status, with no reply owed. Relay the answer.
- Append each answer you gave yourself to `qa` (`{ q, a, refs }`; the worker appends its own): in a `node - <<'QA'` heredoc as in the template, load the file, push the entry, write it back with `JSON.stringify`. The open page shows it within 5 s, under 질의응답, so the record stays with the walkthrough.
- A question that turns out to be a product decision goes through the decision flow (SKILL.md, `question` row); one that reveals a defect becomes a change request.

After answering, ask the same four-way question again. Approval comes only from an explicit answer about this item ("PR 올려", "승인", choosing that option). "좋네요", silence, or approval of a different item is not approval: ask.

## The answer

An answer that arrives while `askId` is empty (you replied `QUESTION:` and the worker's "walkthrough answered" has not arrived): record it in the log and reply to that next ask.

- **Approved**: Compute the changed-lines hash ([review.md](review.md), "Changed-lines hash"): it must equal `reviewedDiff`; if it differs, the code moved after the review, so review again first. Record it as `walkDiff`, set `walkApproved` to `<id>-w<n>`, then reply (plus the item's `pendingRebase`, if a parent moved meanwhile: merging.md; clear the field once sent). No PR yet: reply `APPROVED: open the PR`; item `active`, phases 5, `ext` "워크스루 승인, PR 생성 중". PR already open: reply `APPROVED`; item `pr`, phases 6, and clear `walkPending` (its follow-up worker_done goes through SKILL.md, "After a green worker_done"). Log it with the head SHA. Without a PR the worker pushes and opens it (protocol rule 6d); the PR body carries the walkthrough's purpose and execution flow as Markdown (with `file:line`).
- **Changes**: reply `CHANGES: <each change, with file:line>`. Item `active`; phases 3 when no PR is open (an open PR keeps its phases: the changed code is verified and reviewed again either way). The worker changes the code test-first (rules 4-5), writes walkthrough round `n+1` with `changes` filled, and asks "ready for review" again; the changed code is reviewed again before you show the new round. Show only what changed, then ask again.
- **Parked**: reply `PARKED`, then [cleanup.md](cleanup.md), "Parking or dropping an item".

## Changes after the approval

The developer approved the code at `walkDiff`. Its lines can still change before the merge: a CI fix (protocol rule 6d), a conflict resolved in a rebase (rule 9), a fix for a late review finding (rule 11). The walkthrough follows the code, and each change reaches the developer before they approve the merge.

At every `worker_done` of an item that has a `walkDiff`, compute the changed-lines hash at the pushed head:

- **Equal to `reviewedDiff`**: nothing changed since the review and the approval (a clean rebase keeps the hash).
- **Different**: the report must name a new walkthrough round written at the pushed head, with `afterApproval: true` and every change in `changes` (`what`, `why`, `file`, `line`: protocol rule 6f). A report without it goes back to the worker. Check the round as in "Check it, then have it reviewed", sending `FIX-DOC` with `send` (there is no ask to reply to; the worker sends worker_done again) (its `review` and `qa` carry over: copy the previous round's `review` in when you write the new verdict), set `walkthrough` to it (the dashboard then marks the item "승인 뒤 변경"), and have the changed code reviewed again (item `review`, phases back to 6 until it passes); while that review asks for fixes, the worker rewrites the same round, and a change after that round passed review is the next round. `walkApproved` stays at the round the developer approved.

The merge approval message links the latest round and lists the `changes` of every round after `walkApproved` under "워크스루 승인 뒤 바뀐 코드" ([merging.md](merging.md), "Preflight before asking for approval"), so the developer approves the merged code, not only the code they first read. A change the developer wants explained gets the same treatment as a walkthrough question.

## An open PR without an approved walkthrough

Two cases reach here: an upgraded hub's open PRs (`walkPending: true`, [upgrade.md](upgrade.md)), and a worker that pushed before approval (a `pr-open` with no phase 5). The second breaks top rule 4: tell the developer and ask whether to walk through it now (recommended) or close the PR.

To walk through an open PR: set `walkPending: true`, and `send` the worker "<id>: write walkthrough round <n> for your open PR at its head and ask 'ready for review' (protocol rule 6e)". Note the item's previous status in the log line and follow this file from "Check it, then have it reviewed" (an item that also has `reviewPending` gets its review here). On approval: as in "The answer", "Approved" (PR already open). The worker answers with `worker_done` "follow-up: walkthrough" (protocol rule 6e). The dashboard does not list an item with `walkPending` or `reviewPending` for merge approval.
