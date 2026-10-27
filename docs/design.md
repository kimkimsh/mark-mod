# mark-mod — session status dashboard for Claude Code

## Goal

One glance at the terminal answers: *what is Claude doing right now, what is it
waiting on, and how much room is left?*

Shown at all times, above the prompt:

| Item | Source (engine API, Claude Code 2.1.296) |
|---|---|
| Current state | `turn.start` / `turn.complete` (main loop), in-flight `tool.call`s, AbovePrompt `props.isWorking` |
| Context window fill | `$.session.usage()`, read on the 1 s tick and on each `session.measure` |
| 5-hour limit left | `rateLimits[kind=five_hour]` from the same |
| Weekly limit left | `rateLimits[kind=seven_day]` from the same |
| Session tokens | sum of `turn.step` result `usage` (main loop + every subagent loop) |
| Session cost | `cost.usd` from the same push |
| Subagents / teammates | `$.agent.list()` (teammates carry `teammateId`); a pane teammate's pane, by its team's roster and `tmux list-panes` |
| An agent's model and effort | `agent.spawn` result `model` (resolved at spawn); each `turn.step` in the agent's loop (`e.model`, `e.effort`) |
| Background tasks | main-loop `tool.call` results (`backgroundTaskId`, `taskId`), task-notification prompts, taken down by `classic.Stop` `background_tasks` where it runs |

A pane (`/dash`) shows the same data itemised: every agent and task with its
age, token breakdown, and limit reset times.

## States

Priority order; the first that holds is the headline.

| State | Holds when | Colour |
|---|---|---|
| Needs you | `AskUserQuestion` (`question`) or `ExitPlanMode` (`plan approval`) is in flight; shows how long it has waited | warning |
| Working | the main loop has a turn running; shows the tool in flight (the engine's spinner already shows the elapsed time) | claude |
| Waiting on subagents / teammates / background | main loop idle, but subagents running, teammates working, or background tasks in flight (several may hold; the label names all that do, comma-separated) | suggestion |
| All done | nothing running, last turn answered | success |
| Interrupted | nothing running, last turn aborted | inactive |
| Ended with an error / Refused | nothing running, last turn ended by an API error or a refusal | error |
| Ready | no turn yet this session | inactive |

Not detected: the permission dialog. The engine raises `classic.PermissionRequest`
when it opens but nothing when it closes, so after an approval the state could
not tell "dialog open" from "tool running". A state that lies during every long
approved command is worse than none; the dialog itself is on screen where the
band would be.

## Data rules (failure paths)

- **No reading is not zero.** Context and rate limits before the first
  response read "not measured yet", never `0%`. Rate limits still empty
  *after* a response read "no data" in the pane and leave the band (API-key
  sessions).
- **Windows belong to the account.** A reading with no windows (the first one
  after `/clear`) keeps the last known windows; their `resetsAt` still retires
  them on time.
- **A reset window is not still full.** When `resetsAt` has passed, the last
  reading is stale: the meter reads "reset" until the next response refreshes it.
- **A compacted context is not still full.** A compaction (`/compact` or
  automatic) empties the engine's context reading until the next response; the
  tick picks that up within a second, so Context reads "not measured yet"
  instead of the fill from before the compaction.
- **`background_tasks` absent ≠ empty.** An older build leaves the field out;
  reconciliation then does nothing rather than clearing the list.
- **Agent list pull fails** → the previous list stays; the band shows
  "⚠ refresh failed" and the pane the error text. The 1 s tick is the retry.
- **One pull at a time.** The tick and the event hooks share a single-flight
  refresh, so a slow `$.agent.list()` cannot overwrite a newer one. Hooks never
  await it, so a slow list cannot hold up a turn.
- **A notification ends a task only by saying so.** A task-notification removes
  its task when its status is completed, failed or killed; any other word (a
  monitor's event) leaves it to the Stop snapshot. One prompt may carry several.
- **A monitor ends by its deadline too.** The engine kills a monitor when its
  `timeoutMs` runs out, and the expiry notice is an event with no `<status>`,
  so a monitor's task leaves once its start plus `timeoutMs` has passed (the
  1 s tick checks). A persistent monitor has no deadline.
- **The Stop snapshot only takes work down.** `background_tasks` lists every
  loop's work in the session (agents' commands, each teammate as an entry of
  its own) with no owner, and no Stop need follow the end of an agent's
  command; so a task the main loop was seen starting leaves when the main
  loop's `classic.Stop` no longer lists it, and an entry nothing was seen
  starting is never added. Work begun before the mod loaded is therefore not
  shown. `classic.SubagentStop` does not reconcile: it runs alongside the main
  loop, and its snapshot may predate a task the main loop has just started.
  The snapshot is not always there: where an organization manages Claude Code
  (a Team or Enterprise account), the engine's `cc-plugin-sec-default` skips
  every `classic.*` hook of a plugin the person installed, so a task leaves
  only by its notification, its deadline or a TaskStop.
- **Only work whose end reaches the main loop is tracked.** A command, monitor,
  workflow or remote agent an agent starts notifies that agent, never the main
  loop's `prompt.submit`; without the Stop snapshot nothing would ever take it
  down. The agent's own row covers it (`waiting` is on background work it
  owns, for a subagent and an in-process teammate alike). A command whose
  result says `backgroundEndsWithFinalResponse` dies with its caller's final
  response and sends no notification, so it is not tracked either.
- **A pane teammate's word outlives its pane.** Its list status is the last
  word it wrote in its team's roster, and a pane that closes or dies leaves
  `running` standing. While one works, each refresh reads the roster
  (`teams/<team>/config.json` under `CLAUDE_CONFIG_DIR` or `~/.claude`: the
  member's `backendType: "tmux"` and `tmuxPaneId`, and `leadProcess.pid`) and
  lists the panes of the tmux server the engine put it on: the person's own
  (`-S`, the socket `$TMUX` names first) when the engine runs inside tmux,
  otherwise its own (`-L claude-swarm-<lead pid>`), which exits with its last
  pane and leaves its socket file behind. A pane missing, or kept dead by the
  `remain-on-exit failed` the engine sets, shows the teammate as stopped; a
  roster that cannot be read, or a tmux that cannot be run, leaves the list's
  word standing.
- **Only the main loop's turn is the turn.** `turn.start` fires for every
  agent's turn as well, and only the main loop's `turn.complete` clears the
  turn record, so an agent's start is never recorded as the turn.
- **An agent's model is the one that answered; its effort is what its latest
  request asked for.** Until a response arrives the row names the model the
  spawn resolved or the first request named, whichever came first; each
  response of the agent's loop (`turn.step`) then names the model that
  answered, which a hook may have changed from the request. A request with no
  effort runs a model without one, so the row shows the model alone; so does
  a teammate in its own pane, whose requests this session never sees. An
  agent's entry leaves when the list stops naming it, not before the list
  first names it.
- **Stale main turn.** The band trusts the engine's `isWorking` over the turn
  record, so a missed `turn.complete` cannot pin "working" on screen.

## Liveness

A 1 s `$.clock.every` tick pulls `$.agent.list()`, `$.session.usage()` and the
clock. It writes only when something changed; while nothing runs the clock is
stored at 30 s resolution, so an idle session costs one write per 30 s, and
"ago" text is drawn in whole minutes ("just now", "4m ago") so it never shows
invented seconds.

Usage is pulled, not only pushed. `session.measure` fires after a main-thread
turn or when a limit moves, so on its own it leaves the context fill unchanged
for the length of a long turn, and nothing at all follows a compaction:
`session.compact` and the classic compact hooks pass over a plugin the person
installed where an organization manages Claude Code (the engine's
`cc-plugin-sec-default` takes them on a team account). `session.measure`
still asks for a refresh, so a turn's end shows at once.

Tokens come from the streaming `turn.step` result rather than `turn.complete`,
so a long main turn updates the total per request instead of once at its end.
Each request is counted once; `turn.complete` totals are never added.

## Persistence

`$.state` survives a hot reload. Token totals are also written to `$.store`,
one key per session (`tokens:<id>`, since concurrent Claude processes share the
store), at every loop's turn end and at session end; saves run one at a time
so a later total is never overwritten by an earlier one. `claude --resume`
continues the count (verified: a resumed session keeps its id). `/clear` and an
in-process `/resume` raise `session.end` and then `classic.SessionStart` with
no `session.start`: the ending session is saved and its conversation state
cleared (tokens, turn record, last result, context and cost; rate-limit
windows stay), and the next session's saved total is loaded. The store keeps
the 30 most recent sessions; an entry that does not decode is dropped rather
than trusted.

Tokens spent before the mod loaded in a session are not counted.

## Layout

Band (2–3 rows, width = `props.bodyColumns`, indented two cells to line up
with the engine's footer):

```
  ● Working  thinking                                                    tokens 1.09M $0.14 /dash
  Context ████████▉░ 89% left   5-hour ████▌░░░░░ 45% left · runs out in 1h35m at this pace   Weekly ████████▎░ 82% left · resets in 6d5h
  subagents 1 · background 1   Explore haiku·low 6s   Run sleep 40 6s
```

Every meter is a fuel gauge: the bar is what is **left**, the number beside it
is the same amount. Healthy gauges are grey; warning at 40% left or when the
window is on pace to run out before its reset (linear projection, not before
15 min of a 5-hour window or 2 days of a week); error with a `⚠` at 15% left.

Width is spent by priority, measured in terminal cells (Hangul is two): the
three values always; then the 5-hour reset note, the weekly reset note, and
the bars (10 cells, else 6). On row 1 the title is never cut; the right-hand
group drops `/dash`, then cost, then tokens. The third row appears only while
something runs.

Pane: the same three blocks expanded, one row per running agent/task; finished
subagents fold into one line (`done 3 · failed 1`); an empty group is one line.

## Files

```
.claude-plugin/marketplace.json     marketplace for /plugin install
plugins/mark-mod/
  .claude-plugin/plugin.json
  hooks/hooks.json
  hooks/register.tsx                event wiring, state writes, render hooks
  hooks/model.ts                    pure: state machine, counts, formatting
  hooks/view.tsx                    pure: band and pane trees
  types/index.d.ts                  $.state contract
  tests/                            claude plugin test suites
```

The mod sits in `plugins/` so the repository root can hold lint tooling and
`node_modules` without either landing in an installed copy.
