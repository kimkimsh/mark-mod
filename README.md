# mark-mod

A Claude Code mod that keeps a live session dashboard above your prompt: what Claude is doing right now, what it is waiting on, and how much context and usage limit you have left.

This README is for a Claude Code user who wants to install the mod and read what it shows. Developers changing the mod should also read [Development](#development) and [docs/design.md](docs/design.md).

```
  ● Working  Bash running                                                    tokens 1.09M $0.14 /dash
  Context ████████▉░ 89% left   5-hour ████▌░░░░░ 45% left · runs out in 1h35m at this pace   Weekly ████████▎░ 82% left · resets in 6d5h
  subagents 1 · background 1   Explore 6s   Run sleep 40 6s
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

There is nothing to start: once installed, the band is drawn above the prompt in every session.

- **Open the detail pane:** type `/dash` (or click `/dash` at the right end of the band). Run it again to close the pane. In fullscreen mode the pane docks beside the conversation; otherwise it opens above the prompt.
- **Collapse the band:** click `[-]` at its right edge, or press `ctrl+x ctrl+a`.

## What the band shows

### Row 1: the current state

| Shows | Meaning |
|---|---|
| `◆ Needs you` | Claude asked you a question (AskUserQuestion) or wants a plan approved (ExitPlanMode). Shows how long it has waited. |
| `● Working` | A turn is running. Shows the tool in flight (`Bash running`, `Read +2 running`) or `thinking`. The elapsed time is already on Claude Code's own spinner. |
| `◌ Waiting on subagents` / `teammates` / `background` | Claude's turn has ended, but those are still running. Several at once read `Waiting on subagents, background`. |
| `✓ All done` | Nothing is running. Shows when the last turn ended and how long it took. |
| `■ Interrupted` | The last turn was interrupted (for example with Esc). |
| `✕ Ended with an error` / `Refused` | The last turn ended on an API error or a refusal. |
| `○ Ready` | No turn has run in this session yet. |

The right end shows the session's total tokens, its cost, and the `/dash` button. On a narrow terminal they drop out in this order: `/dash`, then cost, then tokens. If the list of agents cannot be read, `⚠ refresh failed` appears there.

### Row 2: what is left

Each bar is a fuel gauge: its length is the amount **left**, and the number beside it is the same amount.

- **Context**: how much of the model's context window is left.
- **5-hour** and **Weekly**: how much of your subscription usage limits is left, and when each resets.
- `runs out in 1h35m at this pace`: at the rate you have used this window so far, it will run out before it resets. This is a straight-line projection, and it is not made in the first 15 minutes of a 5-hour window or the first two days of a week.

Colours: grey while there is plenty left; yellow at 40% left or less, or when a limit is on pace to run out; red with a `⚠` at 15% left or less.

Other values you may see:

- `not measured yet`: no reply has arrived yet, so there is no reading. It never means 0%. Context also reads this right after a compaction (`/compact` or an automatic one), until the next reply measures the smaller conversation.
- `reset` · `updates on next reply`: the window's reset time has passed, so the old reading no longer applies.
- With an API key instead of a subscription, responses carry no limit data and the limit gauges are hidden.

On a narrow terminal the bars go first, then the weekly reset note, then the 5-hour one; the three numbers always stay.

### Row 3: what is running

Running subagents, teammates (`teammates 1/3 working` means one of three is working) and background tasks, each with how long it has run. The row disappears when nothing is running.

## The `/dash` pane

- **Usage**: context (tokens used / window size), the 5-hour and weekly limits, and any other limit the API reports.
- **Tokens**: the total and cost, split into input, output, cache read and cache write, and into the main conversation versus agents (subagents and teammates).
- **Subagents / Teammates / Background**: one row per running item with its age. Finished subagents fold into one line such as `done 3 · failed 1`.

## Good to know

- **Tokens** add up every API request made after the mod loaded, for the main conversation and all agents: input, output, cache read and cache write. Cache reads are counted because they are tokens the session used; since every request re-reads the cached conversation, the total grows quickly as a conversation gets long. `/dash` shows the breakdown.
- Reopening a session with `claude --resume`, or switching to another with `/resume`, continues that session's saved count. `/clear` starts a new session, so the count starts again from 0.
- An agent's or task's age counts from when the mod first saw it.
- **Permission prompts are not shown as a state.** Claude Code reports when a permission dialog opens but not when it closes, so after you approve a long command the band could not tell the dialog from the command running. The dialog itself appears where the band is.
- Teammates running in their own terminal pane (a tmux split) are counted, but their tokens are not visible to this session.

## Troubleshooting

- **No band:** check `claude --version` (2.1.296 or newer) and that `mark-mod` is enabled under `/plugin`. Start Claude Code with `claude --debug` to see, in the debug log, why a hook was skipped.
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
