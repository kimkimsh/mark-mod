# mark-mod — session status dashboard for Claude Code

## Goal

One glance at the terminal answers: *what is Claude doing right now, what is it
waiting on, and how much room is left?*

Shown at all times, above the prompt:

| Item | Source (engine API, Claude Code 2.1.296) |
|---|---|
| Current state | `turn.start` / `turn.complete` (main loop), in-flight `tool.call`s, AbovePrompt `props.isWorking` |
| Context window fill | `session.measure` push, seeded by `$.session.usage()` |
| 5-hour limit left | `rateLimits[kind=five_hour]` from the same |
| Weekly limit left | `rateLimits[kind=seven_day]` from the same |
| Session tokens | sum of `turn.step` result `usage` (main loop + every subagent loop) |
| Session cost | `cost.usd` from the same push |
| Subagents / teammates | `$.agent.list()` (teammates carry `teammateId`) |
| Background tasks | `tool.call` results (`backgroundTaskId`, `taskId`), task-notification prompts, reconciled on `classic.Stop` / `classic.SubagentStop` `background_tasks` |

A pane (`/dash`) shows the same data itemised: every agent and task with its
age, token breakdown, and limit reset times.

## States

Priority order; the first that holds is the headline.

| State | Holds when | Colour |
|---|---|---|
| 입력 필요 (needs you) | `AskUserQuestion` or `ExitPlanMode` is in flight | warning |
| 응답 중 (working) | the main loop has a turn running | claude |
| 서브에이전트 / 팀메이트 / 백그라운드 대기 | main loop idle, but subagents running, teammates working, or background tasks in flight (several may hold; the label names all that do) | suggestion |
| 전체 완료 (all done) | nothing running, last turn answered | success |
| 중단됨 (interrupted) | nothing running, last turn aborted | inactive |
| 오류 (error) | nothing running, last turn ended by an API error or a refusal | error |
| 대기 중 (ready) | no turn yet this session | inactive |

Not detected: the permission dialog. The engine raises `classic.PermissionRequest`
when it opens but nothing when it closes, so after an approval the state could
not tell "dialog open" from "tool running". A state that lies during every long
approved command is worse than none; the dialog itself is on screen where the
band would be.

## Data rules (failure paths)

- **No reading is not zero.** Context and rate limits before the first
  response read "측정 전", never `0%`. Rate limits still empty *after* a
  response read "정보 없음" in the pane and leave the band (API-key sessions).
- **Windows belong to the account.** A reading with no windows (the first one
  after `/clear`) keeps the last known windows; their `resetsAt` still retires
  them on time.
- **A reset window is not still full.** When `resetsAt` has passed, the last
  reading is stale: the meter reads "리셋됨" until the next response refreshes it.
- **`background_tasks` absent ≠ empty.** An older build leaves the field out;
  reconciliation then does nothing rather than clearing the list.
- **Agent list pull fails** → the previous list stays and the pane and band
  show a warning mark with the error text. The 1 s tick is the retry.
- **One pull at a time.** The tick and the event hooks share a single-flight
  refresh, so a slow `$.agent.list()` cannot overwrite a newer one.
- **Stale main turn.** The band trusts the engine's `isWorking` over the turn
  record, so a missed `turn.complete` cannot pin "working" on screen.

## Liveness

A 1 s `$.clock.every` tick pulls `$.agent.list()` and the clock. It writes only
when something changed; while nothing runs the clock is stored at 30 s
resolution, so an idle session costs one write per 30 s, and "ago" text is
drawn in whole minutes ("방금", "4m 전") so it never shows invented seconds.

Usage needs no polling: `session.measure` fires after every response.

Tokens come from the streaming `turn.step` result rather than `turn.complete`,
so a long main turn updates the total per request instead of once at its end.
Each request is counted once; `turn.complete` totals are never added.

## Persistence

`$.state` survives a hot reload. Token totals are also written to `$.store`
(key `sessions`, one entry per session id) at every loop's turn end and at
session end, so `claude --resume` continues the count (verified: a resumed
session keeps its id). The store keeps the 30 most recent sessions, and an
entry that does not decode is dropped rather than trusted. `/clear` starts a
new session: tokens, turn record and last result reset.

Tokens spent before the mod loaded in a session are not counted.

## Layout

Band (2–3 rows, width = `props.bodyColumns`):

```
● 응답 중  Bash 실행 중 · 1m12s                         토큰 1.23M · $3.41  /dash
컨텍스트 ███▌░░░░░░ 46%   5시간 ██▍░░░░░░░ 77% 남음 · 2h14m   주간 █▎░░░░░░░░ 88% 남음 · 3d4h
서브에이전트 2 · 팀메이트 1/3 · 백그라운드 1   Explore 42s · general-purpose 1m03s · npm test 5m
```

Every meter is a fuel gauge: the bar is what is **left**, the number beside it
is the same amount, and the colour turns warning at 40% left and error at 15%
left. Narrower bands shrink the bars, then drop them, then drop the reset
notes; the third row appears only while something runs.

Pane: the same three blocks expanded, one row per agent/task.

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
