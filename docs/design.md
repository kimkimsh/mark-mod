# mark-mod — session status dashboard for Claude Code

## Goal

One glance at the terminal answers: *what is Claude doing right now, what is it
waiting on, and how much room is left?* A second look, at the pane, answers
the follow-ups: which model, what the last reply did, which agent is doing
what, where the tokens went, and, in its Activity log, what happened in what
order.

Shown at all times, above the prompt (the band), and in a pane that opens with
the session (`/dash` closes and reopens it):

| Item | Source (engine API, Claude Code 2.1.296+) |
|---|---|
| Current state | `turn.start` / `turn.complete` (main loop), in-flight `tool.call`s, AbovePrompt `props.isWorking` |
| What a tool is doing | the `tool.call` input's own arguments (`file_path`, `notebook_path`, `command`, `description`, `url`, `skill`), worded once as the call starts |
| What the last reply did | main-turn `tool.call`s of Edit, Write and NotebookEdit that went through (distinct paths); `agent.spawn` results, by `parentAgentId` |
| Context window fill | `$.session.usage()`, read on the 1 s tick and on each `session.measure` |
| Compactions | `session.compact` result, main loop only |
| 5-hour limit left | `rateLimits[kind=five_hour]` from the same reading |
| Weekly limit left | `rateLimits[kind=seven_day]` from the same reading |
| Session tokens | sum of `turn.step` result `usage` (main loop + every agent loop) |
| Session cost | `cost.usd` from the same reading |
| The session's model and effort | main-turn `turn.step`: `e.model` and `e.effort` as the request starts, `usage.model` once it answers |
| Subagents / teammates | `$.agent.list()` (teammates carry `teammateId`); a pane teammate's pane, by its team's roster and `tmux list-panes` |
| An agent's model and effort | `agent.spawn` result `model` (resolved at spawn); each `turn.step` in the agent's loop (`e.model`, `e.effort`, `usage.model`) |
| What an agent is doing, how full its context is | `tool.call` with that `agentId`; the input side of its latest `turn.step` `usage` |
| Background tasks | main-loop `tool.call` results (`backgroundTaskId`, `taskId`), task-notification prompts, taken down by `classic.Stop` `background_tasks` where it runs |
| Activity log | `prompt.submit` (origin `composer` or `bridge`, not dropped), `tool.call` start and a denied or failed result, `agent.spawn`, an agent's status leaving running in `$.agent.list()`, a background task's start and end, main-loop `turn.complete`, `session.compact` |

## States

Priority order; the first that holds is the headline. The title is a plain
sentence; what follows it (dim, or normal while something is live) are
clauses in order of importance, dropped whole from the end when the band is
narrow.

| State | Holds when | Example | Colour |
|---|---|---|---|
| Needs your answer / plan approval | `AskUserQuestion` or `ExitPlanMode` is in flight | `◆ Needs your answer  waiting 1m 20s` | warning (glyph and title) |
| Working | the main loop has a turn running | `● Working  editing view.tsx` | claude (glyph) |
| Waiting on … | main loop idle, but subagents running, teammates working, or background tasks in flight | `◌ Waiting on 2 subagents and 1 shell` | suggestion (glyph) |
| Done | nothing running, last turn answered | `✓ Done  4m ago, edited 3 files, used 2 subagents` | success (glyph) |
| Interrupted | nothing running, last turn aborted | `■ Interrupted  4m ago` | inactive |
| Ended with an error / Refused | nothing running, last turn ended by an API error or a refusal | `✕ Refused  4m ago` | error (glyph and title) |
| Ready | no turn yet this session | `○ Ready` | inactive |

Colour marks state only on the glyph, except where the state asks something of
the person or went wrong; a green title after every reply would be noise on a
band that is on screen all day.

Working names the first in-flight call's activity and counts the rest
(`running npm test and 2 more`). Between calls it names nothing: the model
may be thinking or writing, and the band cannot tell which.

The resting states leave out how long the reply took. The engine prints that
right above the band (`✻ Baked for 15s · done 1:10 AM`); the pane's Last reply
row has it.

Waiting counts each kind in the engine's own footer words: subagents,
teammates, shells, monitors, workflows, remote agents; any other task kind is
a background task.

Not detected: the permission dialog. The engine raises `classic.PermissionRequest`
when it opens but nothing when it closes, so after an approval the state could
not tell "dialog open" from "tool running". A state that lies during every long
approved command is worse than none; the dialog itself is on screen where the
band would be.

## Data rules (failure paths)

- **No reading is not zero.** Context and rate limits before the first
  response read "not measured yet", never `0%`. Rate limits still empty
  *after* a response read "no data" in the pane and leave the band (API-key
  sessions). The band shows a limit only once it has a reading; Context
  always, so the row does not shift when its reading comes and goes around a
  compaction.
- **Windows belong to the account.** A reading with no windows (the first one
  after `/clear`) keeps the last known windows; their `resetsAt` still retires
  them on time.
- **A reset window is not still full.** When `resetsAt` has passed, the last
  reading is stale: the meter reads "reset" until the next response refreshes it.
- **A compacted context is not still full.** A compaction (`/compact` or
  automatic) empties the engine's context reading until the next response; the
  tick picks that up within a second, so Context reads "not measured yet"
  instead of the fill from before the compaction.
- **A compaction counts once it ran.** `session.compact` is counted after
  `next(e)` returns: not for an agent's own transcript (`agentId` set), not for
  a `precompute` (it installs nothing), not for a skip (`{ skip }`), and not
  when a hook below throws. Where an organization manages Claude Code the hook
  is not delivered, so the count stays at zero and the note says nothing,
  rather than claiming the conversation was never compacted.
- **A reply's summary is that reply's own work.** An edit counts when Edit,
  Write or NotebookEdit went through (not denied, not an error) during the
  main turn, made by the main loop or by an agent that turn started; a path
  counts once however often it was edited. An agent belongs to the turn when
  `agent.spawn` resolved for it with no `parentAgentId`, or with the id of an
  agent already on the turn; `agent.spawn` resolves once the agent has
  started, so its id is on the turn before its first edit lands. A teammate
  joins the session rather than doing this reply's work, and a workflow's
  agent (`agent.spawn` with `workflow`) works for a run in the background;
  neither is counted. A background agent from an earlier turn edits under an
  id this turn does not hold, so its edits are not counted.
- **The session's model comes from the main turn.** Only a `turn.step` whose
  `turnId` is the main turn on record names it: the engine's side requests on
  the main loop may use another model. The answered `usage.model` replaces the
  alias a request named (`opus` → `claude-opus-5-5`), and a later request
  keeps the answered one until its own answer arrives. The model is the
  session's, so it survives `/clear`.
- **Model names are read from the id.** `claude-opus-5-5` reads "Opus 5.5",
  `claude-3-5-sonnet-20241022` "Sonnet 3.5", a Bedrock or Vertex id the same
  (`us.anthropic.claude-sonnet-5-5-v1:0`, `claude-haiku-4-5@20251001`); a
  bracketed context option (`[1m]`) is dropped. An alias or another
  provider's id is shown as it is. An effort is a level ("low effort") or an
  integer budget ("16k thinking budget").
- **An agent's activity is its latest call, until that call ends.** Each
  agent keeps the activity and id of the call its loop started last; only that
  call's end clears it, so with calls in parallel the first to end does not
  wipe the one still running. Its context size is the input side (input, cache
  read, cache write) of its latest response.
- **Only an agent the list names, or will name, gets a record.** Its model and
  work are kept for an id the list names or a spawn recorded; a workflow's
  agents and the engine's forks (compaction, memory) carry ids no list names,
  so a record for one could never be taken down, and none is made. A response
  checks again as it lands, since an agent's first request can start before
  its spawn is recorded.
- **`background_tasks` absent ≠ empty.** An older build leaves the field out;
  reconciliation then does nothing rather than clearing the list.
- **Agent list pull fails** → the previous list stays; the band shows
  "⚠ can't read agent list" (while there is room beside the title) and the
  pane the error text. The 1 s tick is the
  retry.
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
  roster that cannot be read leaves the list's word standing. A tmux that
  cannot be run says nothing either way: a teammate the last refresh showed
  stopped stays stopped, and one it did not keeps the list's word, so a
  failing tmux call neither revives a dead pane nor ends a live one.
- **Only the main loop's turn is the turn.** `turn.start` fires for every
  agent's turn as well, and only the main loop's `turn.complete` clears the
  turn record, so an agent's start or end never restarts or ends it.
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

## The pane opens with the session

`session.start` opens the pane when a person is at the prompt
(`isInteractive`); a `-p` run or the SDK opens none. That open is unasked, so
the engine places it only on a wide enough terminal (144 columns, or 110 for a
pane the person opened before and has not closed by hand since) and otherwise
keeps it open but undrawn (`isPlaced: false`) until the person opens it or
the window widens. `/dash` and the band's `/dash` button therefore close the
pane only while it is drawn; an undrawn pane is closed as far as the person
can see, so they open it, which as an asked open is placed at any width.

A close, by `/dash` or by the pane's own close mark or key, is remembered in
`$.state` from the `ui.close` hook, and `session.start` leaves a closed pane
closed. That matters because `session.start` fires again within one process
(an enable, a worker respawn, a reload), and reopening there would undo the
person's choice. A new process starts with the pane open. An unload never
reaches the opener's hooks, so it is never taken for the person's close.

## Activity log

A list in `$.state` (`activityLog`), one entry per event, newest last: time,
who (`you`, `Claude`, an agent's list name, a task's kind, `session`), text,
and a tone (plain, done, failed, stopped). It keeps the last 200 entries and
is conversation state, emptied with the rest at `/clear`.

What goes in, and what does not:

- The person's prompt, by its first line, only from the composer or the
  Remote Control bridge and only when no hook dropped it. A notification, a
  schedule or a peer's message is not the person's words.
- A call's start, worded as the band words it. A call that went through adds
  nothing more; one that did not adds how it ended, so a failure has a line
  of its own to stand out. `isError` covers a throw, an interrupt and an
  error answer alike, so the outcome is told apart by other means: a hook's
  deny is `denied`; a dispatch whose `next.signal` aborted (the person's
  interrupt) is `interrupted`; an asking tool (a question, a plan) that errs
  was turned down, `declined`; anything else `failed`. A permission dialog
  answered no is an error the hooks cannot tell from a tool's, so it reads
  `failed`.
- Calls of the main conversation and of agents the list names or a spawn
  recorded (`spawns`: the name and kind the spawn gave, the teammate's name
  as its team gave it, from `teammateId`). A workflow's agents and the
  engine's forks carry ids no list names; their calls would read as some
  agent's with no name, so they are left out.
- A spawn logs `started: …`, or `resumed: …` for one that carries `resume`
  (a subagent resumed, a teammate brought back from disk).
- An agent's end comes from the 1 s list pull, once: an agent the last pull
  had pending, running or waiting and this one names completed, failed or
  killed, or no longer names at all (`ended after`); and one a spawn
  recorded that this pull is the first to name, already ended.
- A task's end comes from wherever the task leaves the record (its
  notification's `<status>`, `TaskStop`, a monitor's deadline), each removal
  logging exactly the tasks that update removed. The Stop snapshot is the
  exception: a task it no longer lists has ended, but its notification,
  which says how, usually follows the turn, so the task waits in
  `endingTasks` for it; one still waiting at the next Stop ends there,
  `ended after`.

Times are the local wall clock (`Date`'s local fields, which follow the
machine's time zone in the hooks environment).

**Scrolling.** The engine scrolls a pane body taller than its rows; the log
needs its own window instead, so new entries can keep arriving while the
person reads older ones. Docked, the pane's tree is made exactly the body's
height (the log card takes the rows the other cards leave, never fewer than
4), so the engine has nothing to scroll and every `ui.scroll` is the log's:
the hook moves the log's window and returns `{}` without `next`. A wheel
tick moves it `e.by` rows. A scroll key's move is sized for the body (a page
key `bodyRows`, Home and End `contentRows`, the same rows in a tree that
fits), so a key move, one with no pointer, moves the log one window.

On a body too short for the cards (the tree overflows), only a wheel tick
over the log card is the log's; the rest scroll the body as usual. Which
tree row the pointer is over needs the window's first row as the move
starts: `e.offset` minus `e.by`, exact unless the clamp cut the move short,
since the offset the last drawing read misses the engine's own moves (an
end followed, a clamp) on the terminal.

The window holds its place by an anchor, the `seq` of its bottom entry
(`logAnchor`, null while it follows the newest), so entries arriving below
do not move what the person is reading. It follows again once scrolled back
to the end, or once its window shows the newest entry anyway (the log card
grew): the anchor is released before the next entry lands. Inline, the log
keeps to its last 6 entries.

The pane is drawn on every surface the session shows, each at its own size,
and `ui.scroll` names no surface: each drawing's rows are kept by surface,
and a move goes to the drawing whose body has its `bodyRows`.

The band reads no log, and the log is passed to the pane apart from the
view: a drawing that reads a value is drawn again on each write of it.

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

`$.state` survives a hot reload, so newer code can find a value an older
version wrote. A value whose form changes therefore moves to a new key (as
`mainTurn`, `openAsks` and `lastReply` did), under which the new code reads its
initial value instead of misreading the old one. The engine's own tag for
this, `AtomOptions`' `shape`, is not used: the repository's
`no-shape-in-symbol-names` lint rule refuses the identifier.

Token totals are also written to `$.store`, one key per session
(`tokens:<id>`, since concurrent Claude processes share the store), at every
loop's turn end and at session end; saves run one at a time so a later total
is never overwritten by an earlier one. `claude --resume` continues the count
(verified: a resumed session keeps its id). `/clear` and an in-process
`/resume` raise `session.end` and then `classic.SessionStart` with no
`session.start`: the ending session is saved and its conversation state
cleared (tokens, turn record, last reply, agents' models, work and spawn
names, compactions, the activity log and its scroll place, context and cost;
rate-limit windows and the session's model stay), and the next session's
saved total is loaded. The store keeps the 30 most recent sessions; an entry
that does not decode is dropped rather than trusted.

Tokens spent before the mod loaded in a session are not counted.

## Layout

Band (2–3 rows, width = `props.bodyColumns`, indented two cells to line up
with the engine's footer):

```
  ● Working  editing view.tsx                                                                          $0.19 /dash
  Context ███████░ 88% left   5-hour ████▌░░░ 45% left, runs out in 1h 35m at this pace   Weekly ███████▋ 96% left, resets in 6d 17h
  Subagents   Find callers of buildView (haiku, low effort) 40s     Background   npm test 20s
```

Every meter is a fuel gauge: the bar is what is **left**, the number beside it
is the same amount. A healthy bar is green on a quiet track, its words in the
normal colour and its note grey; warning at 40% left or when the
window is on pace to run out before its reset (linear projection, not before
15 min of a 5-hour window or 2 days of a week); error with a `⚠` at 15% left.

Width is spent by priority, measured in terminal cells (Hangul is two). Row 1:
the title is never cut; detail clauses drop whole from the end, and only a
live activity is clipped (dropping it would leave nothing); the right-hand
group drops `/dash` below 80 cells, then cost below 56, and gives way from the
end (`/dash`, cost, the list notice, the folded gauge) whenever it and the
title would overrun the row. Row 2 holds Context, 5-hour and Weekly; any
other window the API reports (a spend limit, a per-model week) is the pane's.
Values first;
then the 5-hour note, the weekly note, and 8-cell bars, which are decided by
width alone (110 cells) so a note that grows during the day never makes them
come and go; past the narrowest layout whole gauges go, healthy ones from the
right first, rather than the terminal cutting one mid-number. A band folded to
one row moves the worst gauge needing attention into row 1. Row 3 appears
only while something runs: subagents by their task, teammates by name, at most
four items (three below 120 cells); model detail gives way first (full, family,
none), then whole items fold into `+N more`, so no name or age is cut.

Pane: a column of rounded cards, every body row a single row that truncates
rather than wraps, so a card's height is its row count.

1. **State**: the band's title (and its detail while live), Model, Last
   reply. The border takes the state's colour unless the session is at rest
   (done, interrupted, ready). Whether a main turn runs is the engine's
   `isWorking`, which only the band's props carry: the band keeps the last
   value it drew and redraws the plugin's sites when it changes, and before
   the band is drawn the pane falls back to the turn record.
2. **Usage**: the gauges with their notes (16-cell bars, 10 below 64
   columns; the label column widens past its 12 cells for a longer limit
   name), Cost, Tokens (a bar in the gauges' column split between the main
   loop and every other loop, "agents", then the total and the two counts;
   then input and output, then cache read and cache write). The border takes
   the worst gauge's colour.
3. **Agents**: the Subagents, Teammates and Background groups, each left
   out when empty, the card with them. A working agent's row has a second
   line with its model and effort, latest activity and context size;
   finished subagents are counted in the group's heading (`1 running, 3
   done, 1 failed`).
4. **Activity**: a header (`N newer below` while held back, `N earlier
   above` otherwise), then time (seconds dropped below 48 cells), who, an
   outcome mark column, text.

Colour is by meaning and uses theme keys only, so the light and dark themes
both keep it readable: `claude` for the main conversation, `permission` for
subagents, `merged` for teammates, `planMode` for background tasks (on the
band's row 3, the pane's agent rows and the log alike); `success`,
`warning` and `error` for gauges and outcomes; `subtle` for quiet borders
and gauge tracks.

## Files

```
.claude-plugin/marketplace.json     marketplace for /plugin install
plugins/mark-mod/
  .claude-plugin/plugin.json
  hooks/hooks.json
  hooks/register.tsx                event wiring, state writes, render hooks
  hooks/model.ts                    pure: state machine, counts, wording, formatting
  hooks/view.tsx                    pure: band and pane trees, width priorities
  types/index.d.ts                  $.state contract
  tests/                            claude plugin test suites
```

The mod sits in `plugins/` so the repository root can hold lint tooling and
`node_modules` without either landing in an installed copy.
