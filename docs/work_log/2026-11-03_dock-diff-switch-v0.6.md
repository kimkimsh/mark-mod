# 2026-11-03 — A /diff switch between the dashboard and Claude Code's changes panel (v0.6.0)

## Context

The user asked for a button on the dashboard that switches to Claude Code's
own "changes" dashboard and back, because with the mod's pane in the dock that
panel could not be seen. Follows v0.5.0 (`2026-11-03_pane-cards-activity-log-v0.5.md`).

The changes dashboard is the engine's diff panel, toggled by `/diff`
("Toggle the diff panel showing uncommitted changes" in fullscreen). Research
in the 2.1.316 binary and live tmux runs found it comes in two shapes, picked
by the engine flag `tengu_quiet_dolphin` (cached `true` in `~/.claude.json`):

- a pane of a bundled plugin, a `Diff` tab beside the mod's `Session` tab in
  the same dock (seen once the cached flag was `true`);
- the older sidebar (`replTab: "diff"`), which takes the dock's place while
  shown and hides every plugin pane (seen in the first two runs of the day,
  before the flag value was cached).

## Files changed

- `plugins/mark-mod/hooks/register.tsx` — `DIFF_COMMAND`, `DIFF_WAITS_TEXT`, `DIFF_ALREADY_WAITS_TEXT`, `BEHIND_TEXT`; `diffWaitTurnId`; `runDiff` (runs `/diff` through `$.command.run`, toasts while a turn runs, skips a second press in the same turn, toasts a rejected run); `commandButton`, `diffButton`, `bandButtons`; `togglePane` raises a pane behind another tab instead of closing it, and raises a reopened pane that lands behind; `raisePane`, `isPaneShown`, `waitingText`; `pressDash` toasts the result or a rejection; band and pane render hooks pass the buttons.
- `plugins/mark-mod/hooks/view.tsx` — `BandButton`, `BandButtons` (`{ diff, dash }`); `bandTree` takes them instead of one `trailing` element; `/diff` has no width floor, `/dash` keeps 80 cells (`BAND_BUTTON_MIN_CELLS` renamed `BAND_DASH_MIN_CELLS`); `RIGHT_ITEM_GAP_CELLS` names the one-cell gap the band group and the State card button share and `itemsCells` counts; `DASH_LABEL` removed; `sessionCard` / `paneTree` take the State card's button.
- `plugins/mark-mod/tests/dashboard.test.tsx` — `DASH_RUN` at file scope, replacing four identical inline literals; world gains `behindPanes`, `isRaiseRefused`, `opensBehind`, `openWaitReason`, `closeError`, `diffRuns`, `diffError`, `toasts` and hooks for `command.run` `diff` and `ui.toast`; `ui.close` now clears the undrawn and behind sets and `ui.panes` reports an undrawn pane as not shown, as the engine does; 14 tests in `changes panel`; the "running turn names nothing between tools" expectation now reads `● Working/diff/dash`.
- `README.md` — band mock, Use bullets, right-end order, pane mock, new "Switching to the changes panel" section, a Troubleshooting entry.
- `docs/design.md` — Goal sentence, new "The changes panel" section (shapes, why the buttons do not guess, `/dash` raise, limits), Layout band order and State card.
- `plugins/mark-mod/.claude-plugin/plugin.json` — 0.6.0, description; `.claude-plugin/marketplace.json` — same description.

## Why

- **The buttons are `/diff` itself.** A plugin can open, show and list only its own panes. Probed live: the bundled diff plugin's `ui.open`/`ui.close` never reach this plugin's hooks, `$.ui.panes()` lists only the mod's pane, and under the sidebar shape the covered pane still reads `isShown: true`. Nothing tells the mod whether the changes panel is up, so a stateful "Changes"/"Dashboard" label would guess. `$.command.run({ command: 'diff' })` from a button press toggled the panel in both shapes.
- **The band carries the way back, at every width.** While the changes panel is in front, the mod's pane is hidden or behind a tab, but the band stays drawn in both shapes, so its `/diff` returns to the dashboard. The first version hid both buttons below 80 cells, and beside a dock the band's `bodyColumns` is the transcript column (about 72 at 140 terminal columns), so the way back vanished at ordinary widths whenever it was needed; the review caught it, the 170-column live run had not. `/diff` now has no floor; `/dash` keeps one.
- **One queued `/diff` per turn.** Each press queues one toggle, so two presses in a turn showed and hid the panel at its end. The guard is keyed by the turn record's `turnId`, not by the `$.command.run` promise: whether that promise settles if the person deletes the queued item is not documented, and a flag waiting on it could leave the button dead.
- **`/dash` raises instead of closing a pane behind a tab.** Before, `/dash` closed any placed pane, so pressing it from the `Diff` tab (the natural "back to my dashboard") closed a pane the person could not see. Only `$.ui.open` with `focus: true` raises; a plain open of an open id only retitles (probed). The surface can refuse the raise (a draft, a band element holding the keys, a dialog), so `togglePane` re-reads `isShown` and says which tab shows the pane.
- **Mid-turn presses toast.** `$.command.run` is "queued and run once the session is idle": probed, a press during a 25 s turn ran `/diff` only when the turn ended. Under the tab shape a typed `/diff` is queued the same way ("Press up to edit queued messages"). The toast keeps the press from looking dead.
- **No `$.command.list()` gate.** First version hid the buttons when `/diff` was not listed. Live, `session.start` saw 896 commands and no `diff`: the bundled plugin registers its `/diff` after, and the engine disables the core `/diff` (`Q7n()`) exactly when that plugin is enabled. `/diff` exists in both shapes, so the gate only hid a working button; it was removed, and a rejected run toasts the engine's reason.

## Verification

- `npm run check` (oxlint, `tsc -p plugins/mark-mod`, `claude plugin validate`, `claude plugin test plugins/mark-mod`): exit 0 after the last code change, lint and typecheck clean, validate passes with the existing `ICON_MISSING` warning, 151 pass, 0 fail (10.53 s).
- `/code-review xhigh` (a forked agent) reported 12 findings, no blocking bug. Fixed: the band losing `/diff` beside a dock, the double-queued toggle, a reopened pane landing behind `Diff`, the mid-turn toast relying on the band alone (`engineIsWorking ?? turn !== null`), `pressDash` without a catch, the raise dropping an `isPlaced: false` reason, the mock's close/undrawn asymmetry, `DASH_RUN` duplication, the unnamed gap. Left: the pane's `/diff` closing a `Diff` tab behind it (engine toggle; see Follow-ups) and splitting `commandButton` for the pane (it uses `.element` of a full item; harmless).
- Second mutation round on the review fixes (files copied aside, restored byte-identical with `cmp`): `/diff` back under the 80-cell floor fails "beside a dock the band keeps /diff"; the turn guard disabled fails "a second press in the same turn"; the toast keyed on the band alone fails "a pane press during a turn"; the reopen raise removed fails "/dash reopening a closed pane behind"; the raise ignoring `isPlaced` fails "a raise the surface cannot draw"; the `pressDash` catch removed fails "a band /dash the engine refuses". Each mutation failed exactly its own test.
- Mutation check (`register.tsx` copied aside, restored byte-identical with `cmp`): removing the raise branch fails the 3 `/dash` tests; forcing the old list gate on fails its test (gate since removed); dropping the mid-turn toast fails its test; dropping the rejection toast fails its test.
- Live, tmux 170×45, haiku, `claude --plugin-dir plugins/mark-mod` in a scratch git repo with one modified file, tab shape: the State card reads `○ Ready … /diff`, the band `/diff /dash [-]`; the pane's `/diff` showed the `Diff` tab in front ("Diff panel shown"); the band's `/dash` raised `Session` with `Diff` kept as a tab; the band's `/diff` with `Diff` behind closed it ("Diff panel hidden"), the next press showed it, the next brought `Session` back; a press during a 15 s turn toasted `/diff runs once Claude finishes this turn` and the engine showed `› Prompt from the mark-mod plugin`, and `Diff` opened when the turn ended; typed `/dash` with `Diff` in front raised `Session`.
- Live, after the review fixes, tmux 140×45 on 2.1.317 (Claude Code updated itself during the day), tab shape: beside the dock the band reads `○ Ready … /diff [-]` (`/dash` dropped, `/diff` kept, as designed); the pane's `/diff` twice answered "Resize your terminal to at least 110 columns to show the diff panel"; typed `/diff` answered "Diff panel shown"; the band's `/diff` then answered "Diff panel hidden" and returned to `Session`; the pane's `/diff` then answered "Diff panel shown". Cause, read in the bundled diff plugin's source and in `$.ui.open`'s doc (`index.d.ts:2522`): its `command.run` hook opens its pane with `$.ui.open`, an open is asked only with the person's command, prompt or press behind it, and a `$.command.run` from this plugin is a plugin's command, so the open is unasked and seats from 144 columns (110 once the person has opened it); a refused open (`isPlaced: false`, reason not `no-surface`) is mapped to the resize text. At 170 columns that floor was met, which is why the first live run did not show it.
- Not verified: the sidebar shape with the final code (the flag is cached `true`; earlier probes under the sidebar showed `$.command.run('diff')` showing and hiding it from a band button), Warp, inline placement, the refused-raise path live, a second surface.

## Follow-ups

- Under the sidebar shape `/dash` closes the covered pane, since the pane reads `isShown: true`; nothing in the API tells the mod the sidebar is up.
- With `Diff` open behind the dashboard, `/diff` from the band or the pane closes it first (the engine's own toggle); a "show Diff" call for another plugin's pane would need an engine API. Matching the result text "Diff panel hidden" and running again would work today but rests on engine prose; not done.
- A queued `/diff` cannot be withdrawn, so a tab click made while it waits is undone when the turn ends.
- Below 144 columns a button's `/diff` cannot open the panel until the person has typed `/diff` once, because an open caused by a plugin's `$.command.run` is unasked. Needs the engine to carry the press behind `$.command.run` into the command it runs, or a plugin call that opens another plugin's pane as asked. A mod-side option, not taken: put `/diff` in the composer for the person to send.
- Whether "110 for one once asked" outlives the session was not checked.
- A press during a turn waits for the turn; tab clicks are the only immediate switch.
