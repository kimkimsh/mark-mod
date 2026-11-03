# mark-mod

A Claude Code mod that shows what your session is doing while you work: a short band above the prompt, and a dashboard pane beside the conversation. The band answers three questions at a glance: what Claude is doing right now, what it is still waiting on, and how much context and usage limit you have left. The pane has the details.

This README is for a Claude Code user who wants to install the mod and read what it shows. Developers changing the mod should also read [Development](#development) and [docs/design.md](docs/design.md).

```
  ● Working  editing view.tsx                                                                          $0.19 /dash
  Context ███████░ 88% left   5-hour ████▌░░░ 45% left, runs out in 1h 35m at this pace   Weekly ███████▋ 96% left, resets in 6d 17h
  Subagents   Find callers of buildView (haiku, low effort) 40s     Background   npm test 20s
```

## Install

You need Claude Code **2.1.296 or newer** (the mod uses its function-hooks API). Check with:

```
claude --version
```

Then, at the Claude Code prompt in a terminal session, run:

```
/plugin install mark-mod --marketplace kimkimsh/mark-mod
```

1. Claude Code asks whether to add the marketplace `github:kimkimsh/mark-mod`. Answer `y`.
2. Pick the install scope. The default, **user**, makes the mod load in every project; press Enter to accept it.
3. You should see `Installed mark-mod. Plugin is now active.` The band appears above the prompt right away in that session, and in every session you start afterwards.

The same install from a shell, without opening a session:

```
claude plugin marketplace add kimkimsh/mark-mod
claude plugin install mark-mod@mark-mod
```

A session that was already running when you installed from the shell picks the mod up after `/reload-plugins`.

## Use

There is nothing to start. Once the mod is installed:

- **The band** is drawn above the prompt in every session.
- **The dashboard pane** opens by itself when a session starts. In fullscreen mode it docks beside the conversation; otherwise it sits above the prompt.
- **Close or reopen the pane:** type `/dash`, or click `/dash` at the right end of the band. Each use switches it. A pane you closed stays closed until you open it again, even when the mod reloads; a new Claude Code session opens it again.
- **Narrow terminal:** a pane nobody asked for needs room, so on a narrow terminal Claude Code keeps the session's pane back until you type `/dash` or widen the window. `/dash` always opens it, at any width.
- **Collapse the band:** click `[-]` at its right edge, or press `ctrl+x ctrl+a`.

Runs with nobody at the prompt (`claude -p`, the SDK) open no pane.

## What the band shows

### Row 1: the current state

| Shows | Meaning |
|---|---|
| `◆ Needs your answer  waiting 1m 20s` | Claude asked you a question and is waiting for your answer. |
| `◆ Needs your plan approval  waiting 20s` | Claude is waiting for you to approve a plan. |
| `● Working  editing view.tsx` | A reply is being written. The words after `Working` say what the tool in use is doing: `reading model.ts`, `running npm test`, `fetching docs.example.com`, `using the verify skill`. With several tools at once: `running npm test and 2 more`. Between tools it shows `Working` alone. |
| `◌ Waiting on 2 subagents and 1 shell` | Claude's reply has ended, but work it started is still running. Counts use Claude Code's own words: subagents, teammates, shells, monitors, workflows, remote agents. |
| `✓ Done  4m ago, edited 3 files, used 2 subagents` | Nothing is running. Says when the last reply ended and what it did. |
| `■ Interrupted  4m ago` | The last reply was interrupted (for example with Esc). |
| `✕ Ended with an error` / `✕ Refused` | The last reply ended on an API error or a refusal. |
| `○ Ready` | No reply has run in this session yet. |

How long a reply took is not repeated here: Claude Code already prints it just above the band (`✻ Baked for 15s`). The pane has it.

The right end shows the session's cost (hidden until there is one) and the `/dash` button. On a narrow terminal `/dash` goes first, then the cost. If the list of agents cannot be read, `⚠ can't read agent list` appears there. Whatever is at the right end gives way before the state's title would be cut.

### Row 2: what is left

Each bar is a fuel gauge: its length is the amount **left**, and the number beside it is the same amount.

- **Context**: how much of the model's context window is left.
- **5-hour** and **Weekly**: how much of your subscription usage limits is left, and when each resets.
- `runs out in 1h 35m at this pace`: at the rate you have used this window so far, it will run out before it resets. This is a straight-line projection, and it is not made in the first 15 minutes of a 5-hour window or the first two days of a week.

Colours: the bar is green while there is plenty left. Bar and number turn yellow at 40% left or less, or when a limit is on pace to run out, and red with a `⚠` at 15% left or less.

Other values you may see:

- `Context not measured yet`: no reply has arrived yet, so there is no reading. It never means 0%. Context also reads this right after a compaction (`/compact` or an automatic one), until the next reply measures the smaller conversation.
- A limit with no reading yet is left off the band. The pane lists it as `not measured yet`.
- `reset, updates on next reply`: the window's reset time has passed, so the old reading no longer applies.
- With an API key instead of a subscription, responses carry no limit data: the band shows no limit gauges, and the pane says why.

When the terminal is too narrow for everything, the row gives way in this order: the weekly reset note, the 5-hour note, the bars (they need a band about 110 columns wide), and finally whole gauges, healthy ones from the right first. A gauge in yellow or red stays longest. When the band is folded to one row, a gauge in yellow or red moves up to row 1 (`⚠ Weekly 10% left`).

### Row 3: what is running

Running subagents, working teammates and background tasks, each with how long it has run. The group names are coloured by kind, the same colours the pane uses:

```
  Subagents   Find callers of buildView (haiku, low effort) 40s     Background   npm test 20s
```

A subagent is named by the task it was given; a teammate by its name. In brackets is the model family it runs on and the reasoning effort it asked for. On a narrow terminal the effort goes first, then the model, then whole items fold into `+2 more`. The row disappears when nothing is running.

## The dashboard pane

The pane is a column of cards. The first three show where the session stands; the last, **Activity**, is a running log of what happened, and fills whatever height is left.

```
╭──────────────────────────────────────────────────────────╮
│ ● Working  reading model.ts                              │
│ Model       Haiku 5.5, medium effort                     │
│ Last reply  4m ago, took 3s, edited 2 files              │
╰──────────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────────╮
│ Context     ████████▊░ 88% left   117k of 1M used        │
│ 5-hour      █████▍░░░░ 55% left   resets in 2h 14m       │
│ Weekly      █████████▎ 92% left   resets in 6d 16h       │
│ Cost        $0.21                                        │
│ Tokens      ████████▉█ 1.34M   main 945k, agents 393k    │
│             input 32, output 4.4k                        │
│             cache read 1.07M, cache write 267k           │
╰──────────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────────╮
│ Subagents  1 running, 3 done                             │
│ ● Explore         Find callers of buildView          40s │
│                   Haiku 5.5, low effort   reading model… │
│ Background  1 running                                    │
│ ● shell           Sleep 30 seconds in background     25s │
╰──────────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────────╮
│ Activity                                 3 earlier above │
│ 02:44:03  you         Do these in order: 1) run python3… │
│ 02:44:07  shell       started: Sleep 30 seconds in back… │
│ 02:44:08  Explore     started: Find callers of buildView │
│ 02:44:09  Claude      reading model.ts                   │
│ 02:44:11  Claude    ✕ failed: running false              │
│ 02:44:12  Explore   ✓ done in 4s: Find callers of build… │
│ 02:44:12  Claude    ✓ replied in 9s, used 1 subagent     │
╰──────────────────────────────────────────────────────────╯
```

- **State card**: the band's state, then the model and effort the main conversation runs on, and what the last reply did. Its border takes the state's colour while something runs or needs you, and turns grey at rest.
- **Usage card**: the gauges in full, with how many tokens the context holds and how many times the conversation was compacted; then cost and tokens. The tokens bar splits the total into the main conversation (orange) and its agents (blue), the same colours as the words after it. The card's border turns yellow or red with the worst gauge.
- **Agents card**: one row per running subagent, teammate or background task with its age. A working agent has a second line: its model and effort, what it is doing now, and how full its context is. Finished subagents are counted in the heading (`3 done`). The card is left out while there are none.
- **Activity card**: one line per event, newest at the bottom, each with the time it happened and who it was about.

### The Activity log

| Line | When |
|---|---|
| `you` and the first line of your prompt | you send a prompt (from the terminal or Remote Control) |
| `Claude` and what a tool is doing | the main conversation starts a tool call |
| an agent's name and what its tool is doing | a subagent or teammate starts a tool call |
| `started: …`, `resumed: …` | a subagent, teammate or background task starts; a subagent resumes or a teammate is brought back |
| `✓ done in 40s: …`, `✕ failed after 2s: …`, `■ stopped after 1m: …` | an agent or background task ends (`ended after …` when nothing said how) |
| `✕ failed: …` | a tool call reports an error |
| `■ interrupted: …`, `■ declined: …`, `■ denied: …` | you interrupt a tool call, turn down a question or a plan, or a hook refuses a call |
| `✓ replied in 9s, edited 2 files` | a reply ends (`■ interrupted after …`, `✕ ended with an error after …` when it did not) |
| `session` `compacted the conversation` | a compaction ran |

Names are coloured by who they are about: you in bold, Claude in orange, subagents in blue, teammates in purple, background tasks in teal. Outcomes carry a mark in their own column, so a failure stands out while you scroll.

A background task's line says how it ended once its notification arrives, which can be after the reply that started it has finished. A permission prompt you answer with no reads as `failed`, because Claude Code reports it the same way as a tool error.

**Scrolling:** turn the mouse wheel over the pane. The log moves back through older lines and stays there while new ones arrive; its header then says `3 newer below`. Scroll back to the bottom, or let the log grow tall enough to show the newest line, and it follows new lines again. With the pane focused, Page Up and Page Down move it one screen of lines. The log keeps the last 200 lines, and `/clear` starts it over.

Docked beside the conversation (fullscreen), the pane fills the window's height and the log takes the rows the other cards leave. Above the prompt (not fullscreen), the log shows its last six lines.

## Good to know

- **What a reply "did":** `edited 3 files` counts the different files changed by Edit, Write or NotebookEdit during that reply, by the main conversation or by subagents that reply started. A file edited twice counts once. `used 2 subagents` counts the subagents that reply started, including ones they started themselves. Teammates are not counted, because they join the session rather than doing one reply's work; neither are a workflow's agents, which work for the workflow running in the background. A subagent left running in the background after an earlier reply does not add to a later one.
- **Times** in the Activity log are your computer's local time.
- **Tokens** add up every API request made after the mod loaded, for the main conversation and all agents: input, output, cache read and cache write. Cache reads are counted because they are tokens the session used; since every request re-reads the cached conversation, the total grows quickly as a conversation gets long.
- Reopening a session with `claude --resume`, or switching to another with `/resume`, continues that session's saved count. `/clear` starts a new session, so the count, the last reply, the compaction count and the Activity log start again; the model and the limit gauges stay.
- An agent's or task's age counts from when the mod first saw it.
- **Background** is work the main conversation started while the mod was loaded. A command or monitor that a subagent or teammate starts shows on that agent's row instead, as waiting, because only that agent hears when it ends.
- **Compactions** are counted only where Claude Code tells the mod about them. Where an organization manages Claude Code (a Team or Enterprise account), it does not, and the pane says nothing about compactions rather than a wrong number.
- **Permission prompts are not shown as a state.** Claude Code reports when a permission dialog opens but not when it closes, so after you approve a long command the band could not tell the dialog from the command running. The dialog itself appears where the band is.
- Teammates running in their own terminal pane (a tmux split) are counted, but their tokens are not visible to this session, and their row shows the model without an effort. A teammate whose pane is closed or has died shows as stopped: while one works, the mod asks tmux about its pane once a second.

## Troubleshooting

- **No band:** check `claude --version` (2.1.296 or newer) and that `mark-mod` is enabled under `/plugin`. Start Claude Code with `claude --debug` to see, in the debug log, why a hook was skipped.
- **No pane at start:** the terminal is narrower than Claude Code allows for a pane nobody asked for. Type `/dash`.
- **Update:** `claude plugin update mark-mod@mark-mod`, then `/reload-plugins` in any open session.
- **Uninstall:** `/plugin uninstall mark-mod`.

## Development

The mod lives in `plugins/mark-mod/`; the repository root holds the marketplace file and the lint tooling.

```
npm install                                  # oxlint and the vendored anti-slop rules
claude --plugin-dir plugins/mark-mod         # a session with this folder loaded; saving a file reloads it
npm run check                                # oxlint, tsc, claude plugin validate, claude plugin test
```

`tsc` needs the type declarations that Claude Code writes into `plugins/mark-mod/.claude-plugin/types/` the first time it loads the mod from a folder. On a fresh clone, start the `claude --plugin-dir` session once before `npm run typecheck`.

Design and data rules: [docs/design.md](docs/design.md).

## License

[MIT](LICENSE)
