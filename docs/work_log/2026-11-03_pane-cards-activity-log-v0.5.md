# 2026-11-03 — Pane cards, scrollable activity log, colour by meaning (v0.5.0)

## Context

After v0.4.0 the user compared the pane with claude-flightdeck's docked pane
(`ref/claude-flightdeck/docs/media/docked-pane.png`, scratchpad clone, never
run) and asked for the same kind of thing: a log in its own section that can
be scrolled, a more refined look, and colour that makes the pane easier to read
and understand. Commit, push and deploy follow the earlier "finish everything
and update all docs" request.

The reference's log only shows its last N lines; it does not scroll. The pane
before this change was one plain column with no borders and almost no colour,
and nothing recorded what had happened in what order.

## Files changed

- `plugins/mark-mod/types/index.d.ts` — `DashLogSource`, `DashLogTone`, `DashLogEntry`, `DashSpawn(s)`; state keys `activityLog`, `logAnchor`, `spawns`, `endingTasks`.
- `plugins/mark-mod/hooks/model.ts` — `endedTaskIds` becomes `endedTasks` (id and tone from `<status>`); log entry building (`withLogLines`, actors, `startedText`, `endedText`, `callEndedText`, `promptLine`, `turnEndLine`, `agentEndLines`, `taskEndLine`, `droppedTasks`); the log window (`logWindow`, `scrolledAnchor`); `clockText`; `splitCells`; `TokenView.mainPercent`.
- `plugins/mark-mod/hooks/view.tsx` — pane rebuilt as rounded cards (State, Usage, Agents, Activity); colour maps by meaning (`GAUGE_COLOR`, `TRACK_COLOR`, `WORKER_COLOR`, `SOURCE_COLOR`, `TONE_STYLE`); band bars and row-3 group titles take the same colours; Tokens gets a split bar; `paneTree` returns where the log sits (`PaneDrawing`).
- `plugins/mark-mod/hooks/register.tsx` — `logAtom`, `logAnchorAtom`; logging at prompt, call start, denied/failed call, agent spawn and end, task start and end, turn end, compaction; `/clear` empties both; a `ui.scroll` hook for the pane moves the log window.
- `plugins/mark-mod/tests/model.test.ts` — 10 activity-log tests; `endedTasks` test checks tones.
- `plugins/mark-mod/tests/dashboard.test.tsx` — 6 activity-log tests (order, what is left out, agents and tasks, `/clear`, docked and inline sizing, scroll hold and follow); pane test reads cards by key; reset-time test fixture changed (see Why).
- `README.md`, `docs/design.md` — pane section with a card mock, the Activity log, colours, scrolling, dock vs inline; design Goal table row, Activity log section, Persistence and Layout.
- `plugins/mark-mod/.claude-plugin/plugin.json` — 0.5.0, description names the activity log. `.claude-plugin/marketplace.json` — same description.

## Why

- **The log keeps its own window instead of letting the engine scroll the pane.** If the engine scrolls the whole body, every new entry either moves what the person is reading or the log cannot follow the newest. Docked, the tree is built to exactly the body's height (the log card takes the leftover rows, at least 4), so the engine never has anything to scroll and every `ui.scroll` belongs to the log; the hook returns `{}` without `next`. When the body is too short for the cards, only a wheel tick over the log card is taken (`isOverLog`), and the rest scroll the body.
- **The scroll place is a `seq` anchor, not an offset.** An offset from the bottom shifts by one with every new entry; the bottom entry's `seq` does not. `null` means "follow the newest", and scrolling back to the end returns to `null`. An anchor that fell off the 200-entry cap holds the oldest full window.
- **What is logged is what the person can act on or would ask about**: their own prompt (composer or bridge, not dropped; a notification or schedule is not their words), a call's start, a denied or failed call (a call that went through adds nothing, so a failure stands out), agents' and tasks' start and end with a tone, the reply's end, a compaction. A workflow's agents and engine forks carry ids no list names, so their calls are left out rather than shown under no name.
- **Each task removal logs exactly the tasks that update removed.** The dropped list is captured inside the `update` closure, because `update` retries on a version miss and only the last applied call is true.
- **Colour by meaning, theme keys only.** One colour per kind of worker, used on the band's row 3, the agent rows and the log alike, so the same colour means the same thing everywhere; outcome colours (`success`, `warning`, `error`) only for gauges and outcomes; `subtle` for quiet borders and tracks. No hex, so the light theme keeps working.
- **Card borders carry state only when it needs attention.** The State card's border takes the phase colour unless the session is at rest; the Usage card's border takes the worst gauge.
Fixed after the `/code-review xhigh` pass (15 findings; each checked against the code and `index.d.ts` before changing anything, and all 15 adopted):

- **A held log stopped following after its card grew.** The anchor was cleared only by a scroll reaching the end; with the card tall enough to show everything, the window looked like it was following, then held once more entries came. `appendLog` now releases an anchor whose window already shows the newest entry, before appending.
- **One module-wide `paneLayout` for every surface.** The pane is drawn on every attached surface (Remote Control), and `ui.scroll` names none. Drawings are now kept per surface, and a move goes to the one whose `bodyRows` match.
- **The pane's state came from the turn record**, which can miss a turn's end; only the band's props carry the engine's `isWorking`. The band keeps the value it drew and calls `$.ui.invalidate('ui.render')` when it changes; the pane uses it, falling back to the record before the band draws.
- **Missed agent ends**: an agent that ended before any pull saw it running, or that left the list while active. Both now log (`spawns` records what a spawn started).
- **A call before the list names its agent** was logged as a blue `agent`. It now uses the spawn's name and kind; a teammate's name comes from `teammateId` (`scout-2`, not the requested `scout`). A `resume` spawn logs `resumed: …`, not a second `started`.
- **Every non-answered call read `✕ failed`.** An interrupt now reads `■ interrupted` (the dispatch's `next.signal` aborted), an asking tool turned down `■ declined`. A permission dialog answered no is still `failed`: the hooks get it as the same `isError` as a tool error.
- **A task the Stop snapshot took down lost its tone.** Its notification usually comes after the turn. The task now waits in `endingTasks`; the notification logs how it ended, and one still waiting at the next Stop ends `ended after`.
- **A failing tmux call revived a dead pane's teammate**, and the next good call logged its end again. A pane tmux could not be asked about now keeps the end the last refresh gave it.
- **`session.start` ran `refreshLive` outside the one-at-a-time guard**, so two pulls could log the same end twice. It now awaits the shared refresh.
- **The overflow hit test used the offset the last drawing read**, which the engine's own clamps and end-follows do not update on the terminal. It now uses `e.offset - e.by`, exact unless the clamp cut the move short (`rowBeforeMove`).
- **The band read the log**, so it redrew on every log write. The log is no longer in `DashSnapshot`/`DashView`; only the pane reads it, passed to `paneTree` as `PaneLog`.
- **Smaller ones:** `addCall` works out tracking and the actor once and hands the actor to the end line; `CARD_CHROME_CELLS` is derived from padding and border; a key move (no pointer, at least `bodyRows`) moves the log one window instead of the body's rows.

- **Reset-time test fixture (test change, not asked for):** "a window whose reset time passed stops claiming its old reading" advanced the clock 2 hours, which runs the 1 s ticker 7200 times; at load average ~7 it hit the 5 s test timeout, and it timed out on a clean `main` worktree too, so the cause was the fixture, not this change. A 5 s reset failed because the idle clock is stored in 30 s steps (`IDLE_CLOCK_STEP_MS`), so the reset is now one step (30 s) ahead. The assertion is unchanged; the test now runs in ~0.25 s.

## Verification

- `npm run check` (oxlint, `tsc -p plugins/mark-mod`, `claude plugin validate`, `claude plugin test plugins/mark-mod`), final run after the review fixes: exit 0, `137 pass, 0 fail, Ran 137 tests across 2 files`. Validate's one warning, `ICON_MISSING`, predates this change.
- Review fixes, mutation-checked: each of 10 fixes undone in turn (files copied aside, restored byte-identical with `cmp`) turns exactly its new tests red (anchor release, per-surface layout, key paging, spawn names, teammate name, early agent end, declined, Stop-then-notification, unchecked pane, engine `isWorking`).
- Live after the review fixes (same tmux setup): the State card read `✓ Done` after a reply; Escape during a foreground `find /` logged `■ interrupted: search whole filesystem…` then `■ interrupted after 7s`; at 34 rows two wheel ticks over the log held it with `2 newer below`. A bare `sleep 30` was refused by the user's own PreToolUse hook and logged `✕ failed`, as an error result.
- Live in tmux (140×45, haiku, `claude --plugin-dir plugins/mark-mod`), captured to PNG: cards render and the Activity card fills the dock; local times correct; entries seen: the prompt, Claude's tool activities, `✕ failed: running false`, `Explore ✓ done in 4s…`, `shell ✓ done in 30s…`, `✓ replied in 9s, used 1 subagent`. Mouse wheel up (`\e[<64;100;30M`) held the log with `4 newer below`; wheel down followed again with `4 earlier above`. The reload message listed 19 hooks including `ui.scroll`.
- Not verified: inline (non-fullscreen) placement live, the light theme, Warp, a second surface (Remote Control) live, and the overflow path of `isOverLog` (a body too short for the cards) live. Not covered by a test: the shared refresh at `session.start`, the band no longer reading the log, and the interrupt outcome (verified live only).

## Follow-ups

- Live check of inline placement, the light theme, Warp and a Remote Control surface.
- The overflow pointer-hit path of `isOverLog` has no live run.
- A permission dialog answered no logs `failed`; telling it apart needs the engine to report the dialog's answer to hooks.
- `withSpawn` counts a `resume` spawn as one of the reply's subagents (v0.4 behaviour, not changed here).
