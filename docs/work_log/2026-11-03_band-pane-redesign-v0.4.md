# 2026-11-03 — Band and pane redesign (v0.4.0): activity, reply summary, models, default-open pane

## Context

The request was a redesign of the mod: cleaner and easier to read at a glance,
more useful than claude-flightdeck (studied from a scratchpad clone, never run),
then a review, docs, commit, push and deploy. Two requests came in during the
work: open the dashboard pane by default with `/dash` to close and reopen it,
and bring every document (README included) up to date.

The band before this change named states but not what a tool was doing, said
nothing about what the last reply had done, spent its first row on tokens, and
let the terminal cut row 2 and row 3 mid-word on a narrow window. The pane had
no model, no per-agent activity and no compaction count.

## Files changed

- `plugins/mark-mod/types/index.d.ts` — `DashCall.activity`; `DashTurn.editedPaths`, `agentIds`; `DashTurnEnd.editedFiles`, `subagentsStarted`; new `DashAgentWork(s)`; state keys `mainTurn`, `openAsks`, `lastReply`, plus `agentWork`, `mainModel`, `compactions`, `paneClosed`.
- `plugins/mark-mod/hooks/model.ts` — `activityOf` (tool arguments to plain words), model and effort naming (`modelName`, `modelDetailText`, `modelFamily`, `effortLabel`), the reply summary (`withEdit`, `withSpawn`), per-agent work (`withAgentActivity`, `withAgentCallEnded`, `withAgentContext`, `withoutAgentEntries`), headline rewrite (`Headline {phase, title, detail[]}`), spaced durations (`4m 05s`).
- `plugins/mark-mod/hooks/view.tsx` — band: title never cut, detail clauses drop whole; row 2 `fittedMeters` drops whole healthy gauges past the narrowest layout; row 3 `workerFit` sheds model detail, then folds items into `+N more`. Pane: Model and Last reply rows, gauges with notes, Tokens split three ways, a second line per working agent.
- `plugins/mark-mod/hooks/register.tsx` — wiring for the above; `session.start` opens the pane when `isInteractive`; `togglePane` closes only a placed pane; `session.compact` counter; main model taken only from main-turn `turn.step`.
- `plugins/mark-mod/tests/model.test.ts`, `plugins/mark-mod/tests/dashboard.test.tsx` — rewritten for the new strings and rules; 104 tests.
- `README.md`, `docs/design.md` — rewritten for the new band, pane, data rules and layout.
- `plugins/mark-mod/.claude-plugin/plugin.json` — 0.4.0, new description. `.claude-plugin/marketplace.json` — same description.

## Why

- **Activity comes from the call's own arguments**, worded once when the call starts (`editing view.tsx`, `running npm test`). Between calls the band says only `Working`: the model may be thinking or writing and the engine does not say which, so naming either would be a guess.
- **The reply summary counts only that reply's work.** `agent.spawn` resolves once the agent has started, so its id is on the turn before its first edit lands; an agent from an earlier turn edits under an id the turn does not hold. Teammates join the session and are not counted.
- **The main model comes only from a `turn.step` whose `turnId` is the main turn on record.** The engine's own side requests on the main loop can use another model, and the Model row would then name it.
- **An agent's activity is cleared by call id**, not by "a call ended": with parallel calls, the first to end would otherwise wipe the one still running.
- **Compactions count after `next(e)` returns**, and not for an agent transcript, a precompute or a skip; the engine requires at least one message in a compaction result, which the test fixture now respects.
- **State keys were renamed** (`turn` → `mainTurn`, `asks` → `openAsks`, `lastTurn` → `lastReply`) because `$.state` outlives a hot reload: new code reading an old-form value under the same key would misread it.
- **Default-open pane:** the `session.start` open is unasked, so the engine holds it undrawn (`isPlaced: false`) on a terminal under 144 columns (110 for a pane the person opened before). A toggle that checked only presence in `ui.panes()` would "close" a pane the person cannot see; `togglePane` checks `isPlaced`, so `/dash` on an undrawn pane opens it (an asked open, placed at any width).
- **Whole gauges and whole items drop instead of the terminal cutting text.** Found live at a ~76-column band (row 3 cut `Sleep 45 sec…`) and by width arithmetic at 50 columns (three gauge values need 52 cells of 48). The second was already true before this change.
- **Tokens left the band** for the pane: a running total moves every request and pulled the eye from state, which is the band's job.

Fixed after the `/code-review xhigh` pass (15 findings, each checked against the code and the engine's `index.d.ts` before changing anything):

- **A closed pane reopened on reload.** `session.start` fires again on an enable, a worker respawn or a reload (`index.d.ts`, `'session.start'` doc). A `ui.close` hook now records `paneClosed` for every close except an unload (which never reaches the opener's hooks), and `session.start` respects it. It is the only writer of "closed", so the `/dash` test exercises it.
- **Extra limit windows took band room.** The `BAND_LIMIT_KINDS` filter had been dropped from `meterVisibleInBand`; a spend limit or per-model week cost the band its bars at 140 columns. Restored; those windows stay in the pane, whose label column now widens for names longer than 12 cells.
- **Agent records for ids no list names.** Workflow agents and engine forks write tool calls and steps under ids `$.agent.list()` never returns, so their `agentWork`/`agentModels` entries were never removed. Records are now made only for an id the list names or a spawn recorded; a workflow spawn records nothing.
- **Workflow agents counted as the reply's subagents.** `withSpawn` now takes `isReplyWork`, false for teammates and for spawns carrying `workflow`.
- **Smaller ones:** Agent activity reads `running a subagent` (a foreground call stays open for the subagent's whole run); a multi-line command reads by its description; URL userinfo (`https://token@host`) is skipped so a credential never reaches the band; Windows paths give the file name; `modelFamily` drops `[1m]` like `modelName`; right-hand band items give way so the title is never cut, and the phantom padding cell with no items is gone; `DashTurn.subagentsStarted` removed (always `agentIds.length`); `'\n'` and `'_'` named; one shared `CLAUSE_JOINER`; `alertMeter` uses `worseOf`; the pane's token split reads `agents` (it includes teammates and forks, not only subagents).
- **Not adopted:** using the engine's atom `shape` tag instead of the key renames. Every value whose form changed already moved to a new key, so nothing misreads after `/reload-plugins`, and the repo's `no-shape-in-symbol-names` lint rule refuses a `shape` key in `atom`'s options (it flags every identifier, object keys included). A generic `changeRecord(atom)` helper was tried and reverted: the engine's module scan refuses a `read` whose atom is a parameter (`HooksError: ... the state library's read takes a source the scan can read`).

## Verification

- `npm run check` (oxlint, `tsc -p plugins/mark-mod`, `claude plugin validate` for marketplace and plugin, `claude plugin test plugins/mark-mod`), final run after the review fixes: exit 0, `108 pass, 0 fail, Ran 108 tests across 2 files`. Validate's one warning, `ICON_MISSING`, predates this change.
- Review fixes, mutation-checked: each fix undone in turn (file copied aside, restored byte-identical with `cmp`) turns exactly its new test red — band limit filter, title room, `ui.close` hook, agent tracking, workflow spawn.
- One existing test was reordered: "the model that answered is what the row names" ran an agent's whole request before its spawn was recorded, which the engine does not do (`agent.spawn` resolves once the agent starts). Its subject, answered model over requested, is unchanged.
- Live run in tmux (140×45, haiku), captured to PNG through `ansi2html` and headless Chrome: pane opened at start and docked right; band read `◌ Waiting on 1 subagent and 1 shell   $0.10`; pane showed Model, Last reply, Context `117k of 1M used`, Weekly `resets in 6d 17h`, Tokens split, an Explore agent's second line `Haiku 5.5, low effort   44k context`; `/dash` closed the pane and the band went full width with bars; `/dash` reopened it. An earlier live `/compact` showed `1M window, compacted once`.
- Not verifiable here: truncation itself (the test kit never paints; widths are checked by cell arithmetic in tests), and Warp (only a Warp-like render of tmux output was checked).

## Follow-ups

- An agent a spawn recorded but the list never names (one that ends before the first pull) keeps its `agentModels` entry until `/clear`. One entry per such agent; forks and workflow agents no longer add any.
- Review items left as they are: `MeterView.isAvailable` overlaps `isMeasured` for limits.
- Claude Code's own agent panel also prints `Waiting for N background agents`, which duplicates the band's Waiting row; nothing the mod can change.
- The pane's label background colour comes from the engine, not the mod.
- This account has no five-hour reading, so the pane shows `5-hour no data` and the band hides it; the five-hour path was covered by tests only.
- No plugin icon (`ICON_MISSING`).
