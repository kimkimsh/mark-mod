import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { AgentInfo, AgentSpawnInput, On, RenderSurface, SessionMessage, SessionUsage, TurnStepInput } from 'claude-code'

const PLUGIN = 'mark-mod'

const PANE_ID = PLUGIN

const SESSION_ID = 'session-1'

const START = 1_800_000_000_000

const PANE_BODY_ROWS = 40

const SURFACES = ['terminal', 'desktop'] as const

type World = {
  clock: MockClock
  agents: AgentInfo[]
  isListBroken: boolean
  usage: SessionUsage
  openPanes: string[]
  // Open but undrawn, as an unasked open leaves a pane on a narrow terminal.
  undrawnPanes: Set<string>
  env: Map<string, string>
}

type StoredEntries = Parameters<typeof mock.store>[1]

function boot(on: On, sessionId: string, stored?: StoredEntries): World {
  const world: World = {
    clock: mock.clock(on, { now: START }),
    agents: [],
    isListBroken: false,
    usage: { startedAt: START, context: { window: 200_000 }, rateLimits: [] },
    openPanes: [],
    undrawnPanes: new Set(),
    env: new Map(),
  }

  mock.store(on, stored)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: sessionId }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('agent.list', () => {
    if (world.isListBroken) {
      throw new Error('list unavailable')
    }

    return { value: world.agents }
  })
  on('session.usage', () => ({ value: world.usage }))
  on('env.get', ($, e) => ({ value: world.env.get(e.name) }))
  on('ui.panes', () => ({
    value: world.openPanes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: !world.undrawnPanes.has(id) })),
  }))
  on('ui.open', ($, e) => {
    if (!world.openPanes.includes(e.id)) {
      world.openPanes.push(e.id)
    }

    world.undrawnPanes.delete(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    world.openPanes = world.openPanes.filter(id => id !== e.id)

    return { value: undefined }
  })

  return world
}

function savedTokens(input: number) {
  return {
    savedAt: START,
    tokens: {
      main: { input, output: 0, cacheRead: 0, cacheWrite: 0 },
      agents: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  }
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

async function band($: Engine, surface: RenderSurface, isWorking: boolean, columns: number, maxRows: number) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking,
      maxRows,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: maxRows },
      view: {},
    },
  })
}

// The kit reads what was drawn, never the surface's paint: rows run together
// and nothing is cut to width, so a test of layout checks what is chosen.
async function bandText($: Engine, isWorking: boolean, columns: number): Promise<string> {
  const ui = await band($, 'terminal', isWorking, columns, 5)
  const text = (await ui.find({ type: 'Box' }))?.text ?? ''
  await ui.unmount()

  return text
}

async function paneText($: Engine, columns: number): Promise<string> {
  const ui = await mountPane($, columns, PANE_BODY_ROWS, 'dock')

  const text = (await ui.find({ type: 'Box' }))?.text ?? ''
  await ui.unmount()

  return text
}

async function mountPane($: Engine, columns: number, bodyRows: number, placement: 'dock' | 'inline') {
  return $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    props: { title: 'Session', isFocused: false, bodyColumns: columns, placement, scroll: { offset: 0, bodyRows }, view: {} },
  })
}

// One card of the pane, by its key: session, usage, agents or activity.
async function paneCardText($: Engine, columns: number, key: string): Promise<string> {
  const ui = await mountPane($, columns, PANE_BODY_ROWS, 'dock')
  const text = (await ui.find({ key }))?.text ?? ''
  await ui.unmount()

  return text
}

// A hook of the test's that answers only once the test opens it.
type Gate = { wait: Promise<void>; open: () => void }

function gate(): Gate {
  let open: () => void = () => {}

  const wait = new Promise<void>(resolve => {
    open = resolve
  })

  return { wait, open }
}

// A call made inside an agent's loop; the kit's call types leave the
// engine-stamped agentId out, so it rides in by spread.
const IN_AGENT = { agentId: 'a1' }

// An agent started before the turn under test.
const IN_EARLIER_AGENT = { agentId: 'a0' }

const EXPLORE_SPAWN: AgentSpawnInput = {
  tool_use_id: 'ag-1',
  prompt: 'list files',
  description: 'list files',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
}

const EXPLORER = { id: 'a1', description: 'list files', type: 'Explore', status: 'running' } as const

const DONE = { stdout: '', stderr: '', interrupted: false }

// A compaction leaves at least one message: its summary.
const SUMMARY: SessionMessage[] = [{ role: 'user', text: 'summary', toolUses: [] }]

const HOME = '/home/u'

const ROSTER_PATH = `${HOME}/.claude/teams/session-1/config.json`

const LEAD_PID = 71463

// A teammate on a tmux pane of its own, as the list names it.
const PANE_TEAMMATE = {
  id: 'sleeper@session-1',
  teammateId: 'sleeper@session-1',
  name: 'sleeper',
  description: 'pane probe',
  type: 'teammate',
  status: 'running',
} as const

// The team's roster as 2.1.311 writes it.
const ROSTER = JSON.stringify({
  name: 'session-1',
  leadProcess: { pid: LEAD_PID },
  members: [
    { agentId: 'team-lead@session-1', name: 'team-lead', tmuxPaneId: 'leader', backendType: 'in-process' },
    { agentId: 'sleeper@session-1', name: 'sleeper', tmuxPaneId: '%5', backendType: 'tmux', isActive: true },
  ],
})

// What `tmux list-panes` answers; null when tmux cannot be run at all.
type Tmux = { listing: { exitCode: number; stdout: string } | null; argv: readonly string[] }

function fakeTmux(on: On, world: World, tmuxEnv: string | undefined): Tmux {
  const tmux: Tmux = { listing: { exitCode: 0, stdout: '%0 0\n%5 0\n' }, argv: [] }
  world.env.set('HOME', HOME)

  if (tmuxEnv !== undefined) {
    world.env.set('TMUX', tmuxEnv)
  }

  on('fs.read', ($, e) => {
    if (e.path !== ROSTER_PATH) {
      throw new Error(`ENOENT: ${e.path}`)
    }

    return { value: ROSTER }
  })
  on('process.run', ($, e) => {
    tmux.argv = e.argv

    if (tmux.listing === null) {
      throw new Error('spawn tmux ENOENT')
    }

    return { value: { ...tmux.listing, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return tmux
}

type RateLimitReading = SessionUsage['rateLimits'][number]

const FIVE_HOUR_READING: RateLimitReading = { kind: 'five_hour', percentUsed: 33, resetsAt: new Date(START + 2 * 3_600_000).toISOString() }

const WEEKLY_RESETS_AT = new Date(START + 6 * 86_400_000).toISOString()

// The stored clock moves in 30-second steps while nothing runs.
const RESET_SOON_MS = 30_000

const MEASURED: SessionUsage = {
  startedAt: START,
  context: { tokens: 92_100, window: 200_000, percent: 46 },
  rateLimits: [FIVE_HOUR_READING, { kind: 'seven_day', percentUsed: 13, resetsAt: WEEKLY_RESETS_AT }],
  cost: { usd: 3.41 },
}

const WEEKLY_NEARLY_SPENT: SessionUsage = {
  ...MEASURED,
  rateLimits: [FIVE_HOUR_READING, { kind: 'seven_day', percentUsed: 90, resetsAt: WEEKLY_RESETS_AT }],
}

// The engine's session.measure carries what $.session.usage() answers at
// that moment, so the world answers the same figures from then on.
async function measure($: Engine, world: World, usage: SessionUsage): Promise<void> {
  world.usage = usage
  await $.session.measure({
    context: usage.context,
    rateLimits: usage.rateLimits,
    cost: usage.cost ?? { usd: 0 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  await world.clock.settle()
}

async function runStep($: Engine, input: TurnStepInput): Promise<void> {
  const stream = $.turn.step(input)

  for await (const chunk of stream) {
    expect(chunk).toBeDefined()
  }
}

async function step($: Engine, agentId: string | undefined): Promise<void> {
  const input: TurnStepInput = { turnId: 'turn-1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }

  if (agentId !== undefined) {
    input.agentId = agentId
  }

  await runStep($, input)
}

describe('band', () => {
  test('a fresh session reads as ready; context says it is not measured, unread limits stay off', async ($, on) => {
    boot(on, SESSION_ID)
    await start($)

    for (const surface of SURFACES) {
      const ui = await band($, surface, false, 140, 5)
      const text = (await ui.find({ type: 'Box' }))?.text ?? ''

      expect(text).toContain('Ready')
      expect(text).toContain('Context not measured yet')
      expect(text).not.toContain('5-hour')
      expect(await ui.find({ type: 'Button', key: 'dash' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a measurement fills context, both limits and cost', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world, MEASURED)
    const text = await bandText($, false, 140)

    expect(text).toContain('54% left')
    expect(text).toContain('67% left')
    expect(text).toContain('resets in 2h 00m')
    expect(text).toContain('87% left')
    expect(text).toContain('$3.41')
  })

  test('after /clear the account\'s limits stay on screen, the conversation\'s figures do not', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('classic.SessionStart', () => ({}))
    await start($)
    await measure($, world, MEASURED)
    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    await $.classic.SessionStart({ source: 'clear', session_id: 'session-2' })
    const text = await bandText($, false, 140)

    expect(text).toContain('67% left')
    expect(text).not.toContain('$3.41')
    expect(text).toContain('Context not measured yet')
  })

  // The reset lies one idle-clock step ahead rather than hours: every second
  // the clock moves runs the one-second tick, and hours of them outlast the
  // test's time on a busy machine.
  test('a window whose reset time passed stops claiming its old reading', async ($, on) => {
    const world = boot(on, SESSION_ID)
    const resetsSoon = { ...FIVE_HOUR_READING, resetsAt: new Date(START + RESET_SOON_MS).toISOString() }
    await start($)
    await measure($, world, { ...MEASURED, rateLimits: [resetsSoon] })
    await world.clock.advance(RESET_SOON_MS + 1_000)

    expect(await bandText($, false, 140)).toContain('updates on next reply')
  })

  test('a compaction takes the old context reading down at once, and the next reading puts it back', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world, MEASURED)

    world.usage = { ...MEASURED, context: { window: 200_000 } }
    await world.clock.advance(1_000)
    const compacted = await bandText($, false, 140)

    expect(compacted).toContain('Context not measured yet')
    expect(compacted).toContain('67% left')

    world.usage = { ...MEASURED, context: { tokens: 20_000, window: 200_000, percent: 10 } }
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('90% left')
  })

  test('a running turn names nothing between tools, and a plan awaiting approval outranks it', async ($, on) => {
    const world = boot(on, SESSION_ID)
    const approval = gate()

    on('tool.call', { tool: 'ExitPlanMode' }, async () => {
      await approval.wait

      return { result: { plan: 'p', isAgent: false } }
    })
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await world.clock.advance(72_000)

    expect(await bandText($, true, 140)).toContain('● Working/dash')

    const asking = $.tool.call({ tool: 'ExitPlanMode', tool_use_id: 'plan-1' })
    await world.clock.advance(20_000)

    expect(await bandText($, true, 140)).toContain('Needs your plan approval  waiting 20s')

    approval.open()
    await asking
    await world.clock.settle()

    const text = await bandText($, true, 140)

    expect(text).toContain('Working')
    expect(text).not.toContain('Needs your')
  })

  test('a running turn names what its tool is doing, until the tool returns', async ($, on) => {
    const world = boot(on, SESSION_ID)
    const command = gate()

    on('tool.call', { tool: 'Bash' }, async () => {
      await command.wait

      return { result: DONE }
    })
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    const running = $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', description: 'Run the tests' })
    await world.clock.settle()

    expect(await bandText($, true, 140)).toContain('Working  running npm test')

    command.open()
    await running
    await world.clock.settle()

    expect(await bandText($, true, 140)).not.toContain('npm test')
  })

  test('the engine saying nothing runs beats a stale turn record', async ($, on) => {
    boot(on, SESSION_ID)
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })

    expect(await bandText($, false, 140)).not.toContain('Working')
  })

  test('how the turn ended is the resting state', async ($, on) => {
    boot(on, SESSION_ID)
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await $.turn.complete({ answer: '', durationMs: 5_000, isAborted: true, turnId: 'turn-1', reason: 'aborted' })

    expect(await bandText($, false, 140)).toContain('Interrupted')

    await $.turn.start({ text: 'go', turnId: 'turn-2' })
    await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId: 'turn-2', reason: 'answer' })
    const text = await bandText($, false, 140)

    expect(text).toContain('✓ Done  just now')
    expect(text).not.toContain('Interrupted')
  })

  test('the reply names the files it changed and the subagents it started, and nothing an older agent did', async ($, on) => {
    boot(on, SESSION_ID)
    on('tool.call', () => ({ result: DONE }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: '/w/d.txt', content: 'y' })
    await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/w/d.txt', old_string: 'y', new_string: 'z' })
    await $.agent.spawn(EXPLORE_SPAWN)
    await $.tool.call({ tool: 'Edit', tool_use_id: 'e2', file_path: '/w/c.txt', old_string: 'a', new_string: 'b', ...IN_AGENT })
    await $.tool.call({ tool: 'Edit', tool_use_id: 'e3', file_path: '/w/x.txt', old_string: 'a', new_string: 'b', ...IN_EARLIER_AGENT })
    await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/w/y.txt' })
    await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId: 'turn-1', reason: 'answer' })

    expect(await bandText($, false, 140)).toContain('Done  just now, edited 2 files, used 1 subagent')
  })

  test('a workflow\'s agents work for its run, not for the reply that started it', async ($, on) => {
    boot(on, SESSION_ID)
    on('tool.call', () => ({ result: DONE }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'wf-agent' }))
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await $.agent.spawn({ ...EXPLORE_SPAWN, workflow: { runId: 'wf_1', agentIndex: 1 } })
    await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/w/c.txt', old_string: 'a', new_string: 'b', agentId: 'wf-agent' })
    await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId: 'turn-1', reason: 'answer' })
    const text = await bandText($, false, 140)

    expect(text).toContain('Done  just now')
    expect(text).not.toContain('edited')
    expect(text).not.toContain('used')
  })

  test('an agent\'s turn neither restarts nor ends the main turn\'s record', async ($, on) => {
    boot(on, SESSION_ID)
    on('tool.call', () => ({ result: DONE }))
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/w/a.txt', old_string: 'a', new_string: 'b' })
    await $.turn.start({ text: 'look', turnId: 'turn-a', agentId: 'a1' })
    await $.turn.complete({ answer: 'x', durationMs: 2_000, isAborted: false, turnId: 'turn-a', reason: 'answer', agentId: 'a1' })
    await $.tool.call({ tool: 'Edit', tool_use_id: 'e2', file_path: '/w/b.txt', old_string: 'a', new_string: 'b' })
    await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 'turn-1', reason: 'answer' })

    expect(await bandText($, false, 140)).toContain('edited 2 files')
    expect(await paneText($, 90)).toContain('just now, took 1s, edited 2 files')
  })

  test('a subagent still running after the turn is what the session waits on', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.agents = [EXPLORER]
    await world.clock.advance(1_000)
    await world.clock.advance(42_000)
    const text = await bandText($, false, 140)

    expect(text).toContain('Waiting on 1 subagent')
    expect(text).toContain('Subagents   list files 42s')

    world.agents = [{ ...EXPLORER, status: 'completed' }]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('Waiting on')
  })

  test('a running agent names the model it was started on, then the effort its requests ask for', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
    on('turn.step', async function* (_$, e) {
      yield* []

      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    await start($)
    await $.agent.spawn(EXPLORE_SPAWN)
    world.agents = [EXPLORER]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('list files (haiku) 0s')

    await runStep($, { turnId: 'turn-a', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 1, agentId: 'a1' })
    await world.clock.advance(5_000)

    expect(await bandText($, false, 140)).toContain('list files (haiku, low effort) 5s')
    expect(await paneText($, 90)).toContain('Haiku 5.5, low effort')
  })

  test('the model that answered is what the row names, whatever the request asked for', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
    on('turn.step', async function* (_$, e) {
      yield* []

      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' },
      }
    })
    await start($)
    await $.agent.spawn(EXPLORE_SPAWN)
    await runStep($, { turnId: 'turn-a', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 1, agentId: 'a1' })
    world.agents = [EXPLORER]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('list files (sonnet, low effort)')
  })

  // A teammate's spawn result can land before the list first names it.
  test('an agent\'s model leaves with the agent, not before the list first names it', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
    await start($)
    await $.agent.spawn(EXPLORE_SPAWN)
    await world.clock.advance(1_000)
    world.agents = [EXPLORER]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('list files (haiku)')

    world.agents = []
    await world.clock.advance(1_000)
    world.agents = [EXPLORER]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('haiku')
  })

  test('teammates count as working only while they are not idle', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.agents = [
      { id: 't1', teammateId: 'scout@team', name: 'scout', description: 'scan', type: 'teammate', status: 'running' },
      { id: 't2', teammateId: 'critic@team', name: 'critic', description: 'review', type: 'teammate', status: 'idle' },
    ]
    await world.clock.advance(1_000)
    const text = await bandText($, false, 140)

    expect(text).toContain('Waiting on 1 teammate')
    expect(text).toContain('Teammates   scout')
    expect(text).not.toContain('critic')
    expect(await paneText($, 90)).toContain('1 working, 1 idle')
  })

  // A pane teammate's list status is the roster's last word, which a pane
  // that closes or dies leaves standing; inside tmux the engine splits the
  // person's own server.
  test('a teammate whose tmux pane is gone or dead is not working', async ($, on) => {
    const world = boot(on, SESSION_ID)
    const tmux = fakeTmux(on, world, '/tmp/tmux-1000/default,4242,0')
    await start($)
    world.agents = [PANE_TEAMMATE]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('Waiting on 1 teammate')
    expect(tmux.argv).toEqual(['tmux', '-S', '/tmp/tmux-1000/default', 'list-panes', '-a', '-F', '#{pane_id} #{pane_dead}'])

    tmux.listing = { exitCode: 0, stdout: '%0 0\n%5 1\n' }
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('Waiting on')

    tmux.listing = { exitCode: 0, stdout: '%0 0\n' }
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('Waiting on')
    expect(await paneText($, 90)).toContain('stopped')
  })

  // Outside tmux the engine runs a server of its own, named after the lead's
  // pid, and that server exits with its last pane.
  test('a teammate on the engine\'s own tmux server ends with that server', async ($, on) => {
    const world = boot(on, SESSION_ID)
    const tmux = fakeTmux(on, world, undefined)
    await start($)
    world.agents = [PANE_TEAMMATE]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('Waiting on 1 teammate')
    expect(tmux.argv).toEqual(['tmux', '-L', `claude-swarm-${LEAD_PID}`, 'list-panes', '-a', '-F', '#{pane_id} #{pane_dead}'])

    tmux.listing = { exitCode: 1, stdout: '' }
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('Waiting on')
  })

  test('where tmux cannot be asked, a pane teammate keeps the list\'s word', async ($, on) => {
    const world = boot(on, SESSION_ID)
    const tmux = fakeTmux(on, world, undefined)
    tmux.listing = null
    await start($)
    world.agents = [PANE_TEAMMATE]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('Waiting on 1 teammate')
  })

  test('a backgrounded command is tracked until its notification arrives', async ($, on) => {
    const world = boot(on, SESSION_ID)

    on('tool.call', () => ({
      result: { ...DONE, backgroundTaskId: 'bg-1' },
    }))
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await start($)
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', run_in_background: true })
    await world.clock.advance(1_000)
    const text = await bandText($, false, 140)

    expect(text).toContain('Waiting on 1 shell')
    expect(text).toContain('Background   npm test 1s')

    await $.prompt.submit({
      text: '<task-notification>\n<task-id>bg-1</task-id>\n<status>completed</status>\n</task-notification>',
      wait: false,
      origin: { kind: 'task-notification' },
    })

    expect(await bandText($, false, 140)).not.toContain('Background')
  })

  // No classic.* here, as where an organization manages Claude Code: an
  // agent's command notifies that agent, so nothing would ever take it down.
  test('a command an agent backgrounds is the agent\'s to wait on, not the session\'s', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('tool.call', { tool: 'Bash' }, () => ({
      result: { ...DONE, backgroundTaskId: 'bg-a' },
    }))
    on('tool.call', { tool: 'Monitor' }, () => ({ result: { taskId: 'mon-a', timeoutMs: 60_000, persistent: false } }))
    on('tool.call', { tool: 'Workflow' }, () => ({ result: { status: 'async_launched', taskId: 'wf-a', workflowName: 'sweep' } }))
    on('tool.call', { tool: 'Agent' }, () => ({
      result: { status: 'remote_launched', taskId: 'rm-a', sessionUrl: 'u', description: 'cloud', prompt: 'p', outputFile: 'o' },
    }))
    await start($)
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'sleep 8', run_in_background: true, ...IN_AGENT })
    await $.tool.call({ tool: 'Monitor', tool_use_id: 'm1', description: 'watch CI', timeout_ms: 60_000, ...IN_AGENT })
    await $.tool.call({ tool: 'Workflow', tool_use_id: 'w1', name: 'sweep', ...IN_AGENT })
    await $.tool.call({ tool: 'Agent', tool_use_id: 'r1', description: 'cloud', prompt: 'p', isolation: 'remote', ...IN_AGENT })
    world.agents = [{ id: 'a1', description: 'bg sleeper', type: 'general-purpose', status: 'waiting' }]
    await world.clock.advance(1_000)
    const text = await bandText($, false, 140)

    expect(text).toContain('Waiting on 1 subagent')
    expect(text).not.toContain('Background')
  })

  // As 2.1.311 sends it where classic.* runs: the snapshot lists every loop's
  // work, and no Stop follows the end of a teammate's command.
  test('the stop snapshot does not bring back what an agent backgrounds', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('classic.Stop', () => ({}))
    on('tool.call', () => ({
      result: { ...DONE, backgroundTaskId: 'b0ojyy9gl' },
    }))
    await start($)
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'sleep 25', run_in_background: true, ...IN_AGENT })
    const sleeper = { id: 'a1', teammateId: 'sleeper@session-1', name: 'sleeper', description: 'teammate probe', type: 'teammate' }
    world.agents = [{ ...sleeper, status: 'waiting' }]
    await world.clock.advance(1_000)
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'b0ojyy9gl', type: 'shell', status: 'running', description: 'sleep 25', command: 'sleep 25' }],
    })
    world.agents = [{ ...sleeper, status: 'idle' }]
    await world.clock.advance(1_000)
    const text = await bandText($, false, 140)

    expect(text).not.toContain('Background')
    expect(text).not.toContain('Waiting on')
  })

  // An agent's SubagentStop runs alongside the main loop, so its snapshot may
  // predate a command the main loop has just started.
  test('an agent\'s stop does not take down the main loop\'s work', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('classic.SubagentStop', () => ({}))
    on('tool.call', { tool: 'Bash' }, () => ({ result: { ...DONE, backgroundTaskId: 'bg-1' } }))
    await start($)
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', run_in_background: true })
    await $.classic.SubagentStop({
      stop_hook_active: false,
      agent_id: 'ab1bcf2bfc866fae9',
      agent_transcript_path: 't',
      agent_type: 'general-purpose',
      background_tasks: [],
    })
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('Waiting on 1 shell')
  })

  test('a command that ends with its caller\'s final response is never waited on', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('classic.Stop', () => ({}))
    on('tool.call', () => ({
      result: { ...DONE, backgroundTaskId: 'bg-1', backgroundEndsWithFinalResponse: true },
    }))
    await start($)
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', run_in_background: true })
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('Background')

    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'bg-1', type: 'shell', status: 'running', description: 'npm test', command: 'npm test' }],
    })

    expect(await bandText($, false, 140)).not.toContain('Background')
  })

  // A monitor's expiry notice carries no <status>; with no classic.* the
  // deadline its own result names is the only word that it ended.
  test('a monitor is gone once its deadline passes', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('tool.call', () => ({ result: { taskId: 'mon-1', timeoutMs: 5_000, persistent: false } }))
    await start($)
    await $.tool.call({ tool: 'Monitor', tool_use_id: 'm1', description: 'never ends', timeout_ms: 5_000 })
    await world.clock.advance(1_000)
    const text = await bandText($, false, 140)

    expect(text).toContain('Waiting on 1 monitor')
    expect(text).toContain('never ends')

    await world.clock.advance(5_000)

    expect(await bandText($, false, 140)).not.toContain('Background')
  })

  test('a notification that does not end its task leaves it running', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('tool.call', () => ({ result: { taskId: 'mon-1', timeoutMs: 0 } }))
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await start($)
    await $.tool.call({ tool: 'Monitor', tool_use_id: 'm1', description: 'watch CI', timeout_ms: 0 })
    await $.prompt.submit({
      text: '<task-notification><task-id>mon-1</task-id><status>event</status></task-notification>',
      wait: false,
      origin: { kind: 'task-notification' },
    })
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('watch CI')
  })

  test('the stop snapshot takes down what no longer runs, and adds nothing', async ($, on) => {
    boot(on, SESSION_ID)
    on('classic.Stop', () => ({}))
    on('tool.call', { tool: 'Monitor' }, () => ({ result: { taskId: 'm1', timeoutMs: 0, persistent: true } }))
    await start($)
    await $.tool.call({ tool: 'Monitor', tool_use_id: 'mt', description: 'watch CI', timeout_ms: 0 })
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [
        { id: 'm1', type: 'monitor', status: 'running', description: 'watch CI' },
        { id: 'a1', type: 'subagent', status: 'running', description: 'list files' },
        { id: 'sh', type: 'shell', status: 'running', description: 'Run tests', command: 'npm test' },
      ],
    })
    const text = await bandText($, false, 140)

    expect(text).toContain('Waiting on 1 monitor')
    expect(text).toContain('Background   watch CI')

    await $.classic.Stop({ stop_hook_active: false })

    expect(await bandText($, false, 140)).toContain('Waiting on 1 monitor')

    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })

    expect(await bandText($, false, 140)).not.toContain('Background')
  })

  // As 2.1.311 sends it: the teammate's task id is neither its list id nor
  // its teammateId, and stays "running" while the list says idle.
  test('a teammate in the stop snapshot is the agent list\'s, not background work', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('classic.Stop', () => ({}))
    await start($)
    world.agents = [
      { id: 'sleeper@session-1', teammateId: 'sleeper@session-1', name: 'sleeper', description: 'teammate probe', type: 'teammate', status: 'idle' },
    ]
    await world.clock.advance(1_000)
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'tnonmf77g', type: 'teammate', status: 'running', description: 'teammate probe' }],
    })

    expect(await bandText($, false, 140)).not.toContain('Background')
  })

  test('narrow bands drop the bars, short bands drop rows', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world, MEASURED)

    expect(await bandText($, false, 140)).toContain('█')
    expect(await bandText($, false, 60)).not.toContain('█')

    const ui = await band($, 'terminal', false, 140, 1)
    const text = (await ui.find({ type: 'Box' }))?.text ?? ''

    expect(text).toContain('Ready')
    expect(text).not.toContain('Context')
  })

  test('a survey keeps the band', async ($, on) => {
    boot(on, SESSION_ID)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box } = $.ui.resolve(e)

      return <Box key="survey" />
    })
    await start($)

    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: true, isWorking: false, maxRows: 5, bodyColumns: 140, scroll: { offset: 0, bodyRows: 5 }, view: {} },
    })

    expect(await ui.find({ type: 'Button', key: 'dash' })).toBeUndefined()
  })
})

describe('band layout', () => {
  test('values come first; reset notes, then bars, then whole healthy gauges give way to width', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world, MEASURED)

    const wide = await bandText($, false, 140)

    expect(wide).toContain('█')
    expect(wide).toContain('resets in 2h 00m')
    expect(wide).toContain('resets in 6d 0h')

    const medium = await bandText($, false, 74)

    expect(medium).not.toContain('█')
    expect(medium).toContain('resets in 2h 00m')
    expect(medium).not.toContain('resets in 6d 0h')
    expect(medium).toContain('87% left')

    const narrow = await bandText($, false, 50)

    expect(narrow).not.toContain('resets in')
    expect(narrow).toContain('54% left')
    expect(narrow).toContain('67% left')
    expect(narrow).not.toContain('87% left')
    expect(narrow).not.toContain('/dash')
  })

  test('a window other than 5-hour and Weekly is the pane\'s, and costs the band no bars', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world, {
      ...MEASURED,
      rateLimits: [...MEASURED.rateLimits, { kind: 'spend_limit', percentUsed: 20 }, { kind: 'seven_day_sonnet', percentUsed: 4 }],
    })
    const text = await bandText($, false, 140)

    expect(text).toContain('█')
    expect(text).not.toContain('Spend limit')
    expect(text).not.toContain('Seven day sonnet')
    expect(await paneText($, 90)).toContain('Seven day sonnet')
  })

  test('a gauge that needs attention outlasts a narrow band and a folded one', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world, WEEKLY_NEARLY_SPENT)

    const narrow = await bandText($, false, 50)

    expect(narrow).toContain('Weekly ⚠ 10% left')
    expect(narrow).not.toContain('67% left')

    const ui = await band($, 'terminal', false, 140, 1)
    const folded = (await ui.find({ type: 'Box' }))?.text ?? ''
    await ui.unmount()

    expect(folded).toContain('⚠ Weekly 10% left')
    expect(folded).not.toContain('Context')
  })

  test('workers that do not fit fold into a count instead of being cut', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.agents = [
      { ...EXPLORER, id: 'a1', description: 'Find callers of buildView today' },
      { ...EXPLORER, id: 'a2', description: 'Review the band layout code' },
      { ...EXPLORER, id: 'a3', description: 'Trace the refresh loop path' },
    ]
    await world.clock.advance(1_000)

    const wide = await bandText($, false, 140)

    expect(wide).toContain('Review the band')
    expect(wide).toContain('Trace the refresh')
    expect(wide).not.toContain('more')

    const narrow = await bandText($, false, 80)

    expect(narrow).toContain('Find callers of buildVi… 0s')
    expect(narrow).not.toContain('Review the band')
    expect(narrow).toContain('+2 more')
  })

  test('only idle teammates leave no worker row', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.agents = [
      { id: 't2', teammateId: 'critic@team', name: 'critic', description: 'review', type: 'teammate', status: 'idle' },
    ]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('Teammates')
  })

  test('a limit on pace to run out before its reset warns ahead of time', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world, {
      startedAt: START,
      context: { tokens: 10_000, window: 200_000, percent: 5 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 47, resetsAt: new Date(START + 199 * 60_000).toISOString() }],
    })

    expect(await bandText($, false, 140)).toContain('runs out in 1h 53m at this pace')
  })
})

describe('tokens', () => {
  test('every response counts once, main loop and agents apart', async ($, on) => {
    const world = boot(on, SESSION_ID)

    on('turn.step', async function* () {
      yield* []

      return {
        turnId: 'turn-1',
        index: 0,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn',
        usage: { input_tokens: 400, output_tokens: 600, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' },
      }
    })
    await start($)
    await step($, undefined)
    await step($, 'agent-1')
    await world.clock.settle()

    expect(await paneText($, 90)).toContain('2k   main 1k, agents 1k')
    expect(await bandText($, false, 140)).not.toContain('2k')
  })

  test('a resumed session continues its saved count; /clear starts over', async ($, on) => {
    const saved = { [`tokens:${SESSION_ID}`]: savedTokens(1_000_000) }

    boot(on, SESSION_ID, saved)
    await start($)

    expect(await paneText($, 90)).toContain('1M   main 1M, agents 0')

    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })

    expect(await paneText($, 90)).not.toContain('Tokens')
  })

  test('switching to another session in the same process loads that session\'s count', async ($, on) => {
    boot(on, SESSION_ID, { 'tokens:session-2': savedTokens(2_000_000) })
    on('classic.SessionStart', () => ({}))
    await start($)
    await $.session.end({ reason: 'resume', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    await $.classic.SessionStart({ source: 'resume', session_id: 'session-2' })

    expect(await paneText($, 90)).toContain('2M   main 2M')
  })

  test('a session saved on the way out is found again when it comes back', async ($, on) => {
    boot(on, SESSION_ID)
    on('classic.SessionStart', () => ({}))
    on('turn.step', async function* () {
      yield* []

      return {
        turnId: 'turn-1',
        index: 0,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' },
      }
    })
    await start($)
    await step($, undefined)
    await $.session.end({ reason: 'resume', sessionId: SESSION_ID, resume: { id: SESSION_ID } })

    expect(await paneText($, 90)).not.toContain('Tokens')

    await $.classic.SessionStart({ source: 'resume', session_id: SESSION_ID })

    expect(await paneText($, 90)).toContain('10   main 10, agents 0')
  })

  test('a store written by something else is ignored, not trusted', async ($, on) => {
    boot(on, SESSION_ID, { [`tokens:${SESSION_ID}`]: { tokens: 'lots' } })
    await start($)

    expect(await paneText($, 90)).not.toContain('Tokens')
  })
})

describe('pane', () => {
  test('the pane opens with the session; /dash closes it and opens it again', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)

    expect(world.openPanes).toEqual([PANE_ID])

    await $.command.run({ command: 'dash', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

    expect(world.openPanes).toEqual([])

    await $.command.run({ command: 'dash', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

    expect(world.openPanes).toEqual([PANE_ID])
  })

  test('a pane the person closed stays closed when the mod starts again in the same process', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await $.command.run({ command: 'dash', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await start($)

    expect(world.openPanes).toEqual([])

    await $.command.run({ command: 'dash', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await start($)

    expect(world.openPanes).toEqual([PANE_ID])
  })

  test('a run with nobody at the prompt opens no pane', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })

    expect(world.openPanes).toEqual([])
  })

  test('/dash draws a pane the session opened undrawn, rather than closing it', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.undrawnPanes.add(PANE_ID)
    await $.command.run({ command: 'dash', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 90 } })

    expect(world.openPanes).toEqual([PANE_ID])
    expect(world.undrawnPanes.has(PANE_ID)).toBe(false)

    await $.command.run({ command: 'dash', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 90 } })

    expect(world.openPanes).toEqual([])
  })

  test('the band button toggles the pane', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    const ui = await band($, 'terminal', false, 140, 5)
    await ui.press({ key: 'dash' })

    expect(world.openPanes).toEqual([])

    await ui.press({ key: 'dash' })

    expect(world.openPanes).toEqual([PANE_ID])
  })

  test('the pane itemises usage, cost and every worker, and leaves out empty groups', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('tool.call', { tool: 'Bash' }, () => ({ result: { ...DONE, backgroundTaskId: 'sh' } }))
    await start($)
    await measure($, world, MEASURED)
    world.agents = [EXPLORER, { id: 'a2', description: 'review', type: 'general-purpose', status: 'completed', parentId: 'a1' }]
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', description: 'Run tests', run_in_background: true })
    await world.clock.advance(1_000)

    const expected = [
      'Context',
      '92k of 200k used',
      '5-hour',
      'Weekly',
      'Cost',
      '$3.41',
      'Subagents  1 running, 1 done',
      'Explore',
      'list files',
      'Background  1 running',
      'shell',
      'Run tests',
    ]

    for (const surface of SURFACES) {
      for (const columns of [40, 90]) {
        const ui = await $.ui.mount({
          plugin: PLUGIN,
          surface,
          component: 'Pane',
          requestId: PANE_ID,
          props: {
            title: 'Session',
            isFocused: false,
            bodyColumns: columns,
            placement: 'dock',
            scroll: { offset: 0, bodyRows: 40 },
            view: {},
          },
        })

        const text = (await ui.find({ type: 'Box' }))?.text ?? ''

        for (const part of expected) {
          expect(text).toContain(part)
        }

        expect(text).not.toContain('Teammates')
        expect(text).not.toContain('Tokens')
        await ui.unmount()
      }
    }
  })

  test('the pane shows what a working subagent is doing and how full its context is', async ($, on) => {
    const world = boot(on, SESSION_ID)
    const reading = gate()

    on('tool.call', async () => {
      await reading.wait

      return { result: DONE }
    })
    on('turn.step', async function* (_$, e) {
      yield* []

      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn',
        usage: { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 7_000, model: e.model },
      }
    })
    await start($)
    world.agents = [EXPLORER]
    await world.clock.advance(1_000)
    await runStep($, { turnId: 'turn-a', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 1, agentId: 'a1' })
    const call = $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/w/model.ts', ...IN_AGENT })
    await world.clock.settle()

    expect(await paneText($, 90)).toContain('Haiku 5.5, low effort   reading model.ts   48k context')

    reading.open()
    await call
    await world.clock.settle()
    const after = await paneText($, 90)

    expect(after).toContain('Haiku 5.5, low effort   48k context')
    expect(await paneCardText($, 90, 'agents')).not.toContain('reading model.ts')
    expect(await paneCardText($, 90, 'activity')).toContain('Explore  reading model.ts')
  })

  test('the session\'s model comes from its main turn alone, and stays across /clear', async ($, on) => {
    boot(on, SESSION_ID)
    on('turn.step', async function* (_$, e) {
      yield* []

      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          model: e.model === 'opus' ? 'claude-opus-5-5' : e.model,
        },
      }
    })
    await start($)

    expect(await paneText($, 90)).not.toContain('Model')

    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await runStep($, { turnId: 'turn-1', index: 0, model: 'opus', effort: 'high', messageCount: 1 })

    expect(await paneText($, 90)).toContain('Opus 5.5, high effort')

    await runStep($, { turnId: 'turn-1', index: 1, model: 'opus', effort: 'high', messageCount: 3 })
    await runStep($, { turnId: 'side-1', index: 0, model: 'claude-haiku-5-5', messageCount: 1 })
    await runStep($, { turnId: 'turn-a', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 1, agentId: 'a1' })
    const pane = await paneText($, 90)

    expect(pane).toContain('Opus 5.5, high effort')
    expect(pane).not.toContain('Haiku')

    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })

    expect(await paneText($, 90)).toContain('Opus 5.5, high effort')
  })

  test('the context note counts the main conversation\'s compactions that ran, until /clear', async ($, on) => {
    boot(on, SESSION_ID)
    on('session.compact', ($, e) => (e.instructions === 'blocked' ? { skip: 'a hook blocked it' } : { messages: SUMMARY }))
    await start($)
    await $.session.compact({ trigger: 'manual', messages: SUMMARY })
    await $.session.compact({ trigger: 'precompute', messages: SUMMARY })
    await $.session.compact({ trigger: 'auto', messages: SUMMARY, agentId: 'a1' })
    await $.session.compact({ trigger: 'manual', messages: SUMMARY, instructions: 'blocked' })

    expect(await paneText($, 90)).toContain('200k window, compacted once')

    await $.session.compact({ trigger: 'auto', messages: SUMMARY })

    expect(await paneText($, 90)).toContain('compacted twice')

    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })

    expect(await paneText($, 90)).not.toContain('compacted')
  })

  test('the last reply\'s receipt survives an agent\'s turn', async ($, on) => {
    boot(on, SESSION_ID)
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 'turn-1', reason: 'answer' })
    await $.turn.start({ text: 'look', turnId: 'turn-a', agentId: 'a1' })
    await $.turn.complete({ answer: 'x', durationMs: 2_000, isAborted: false, turnId: 'turn-a', reason: 'answer', agentId: 'a1' })

    expect(await paneText($, 90)).toContain('just now, took 1s')
  })

  test('a failing agent list is shown, and the last list is kept', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.agents = [EXPLORER]
    await world.clock.advance(1_000)
    world.isListBroken = true
    await world.clock.advance(1_000)
    const text = await bandText($, false, 140)

    expect(text).toContain('⚠ can\'t read agent list')
    expect(text).toContain('Waiting on 1 subagent')
    expect(await paneText($, 90)).toContain('⚠ Can\'t read the agent list: ')

    // Too narrow for both: the title stays whole, the notice gives way.
    const narrow = await bandText($, false, 40)

    expect(narrow).toContain('Waiting on 1 subagent')
    expect(narrow).not.toContain('can\'t read agent list')
  })

  test('a loop no list names and no spawn recorded leaves nothing behind', async ($, on) => {
    const world = boot(on, SESSION_ID)
    const reading = gate()

    on('tool.call', async () => {
      await reading.wait

      return { result: DONE }
    })
    await start($)
    const call = $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/w/model.ts', ...IN_AGENT })
    await world.clock.settle()
    world.agents = [EXPLORER]
    await world.clock.advance(1_000)
    const text = await paneText($, 90)

    expect(text).toContain('list files')
    expect(text).not.toContain('reading model.ts')

    reading.open()
    await call
  })
})

// The activity card's text, rows run together: each entry's time, then who,
// then its outcome mark ("  " for a plain step) and text.
function activityText($: Engine): Promise<string> {
  return paneCardText($, 90, 'activity')
}

function earlierCount(text: string): number {
  return Number(/(\d+) earlier above/.exec(text)?.[1] ?? 0)
}

// Reads f<first>.ts onward, one logged call each.
async function readFiles($: Engine, first: number, count: number): Promise<void> {
  for (let index = first; index < first + count; index++) {
    await $.tool.call({ tool: 'Read', tool_use_id: `r${index}`, file_path: `/w/f${index}.ts` })
  }
}

async function cardOf(ui: Awaited<ReturnType<typeof mountPane>>, key: string): Promise<string> {
  return (await ui.find({ key }))?.text ?? ''
}

async function logCard($: Engine, bodyRows: number, placement: 'dock' | 'inline'): Promise<string> {
  const ui = await mountPane($, 90, bodyRows, placement)
  const text = await cardOf(ui, 'activity')
  await ui.unmount()

  return text
}

describe('activity log', () => {
  test('a reply logs the prompt, each call, a denied call and how it ended, in order', async ($, on) => {
    boot(on, SESSION_ID)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('tool.call', { tool: 'Bash' }, () => ({ deny: 'blocked by policy' }))
    on('tool.call', () => ({ result: DONE }))
    await start($)
    await $.prompt.submit({ text: 'fix the band colours\nand the pane', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/w/a.ts' })
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })
    await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/w/a.ts', old_string: 'a', new_string: 'b' })
    await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId: 'turn-1', reason: 'answer' })
    const text = await activityText($)

    const order = [
      'you  fix the band colours',
      'Claude  reading a.ts',
      'Claude  running npm test',
      'Claude■ denied: running npm test',
      'Claude  editing a.ts',
      'Claude✓ replied in 5s, edited 1 file',
    ].map(entry => text.indexOf(entry))

    expect(order.every(index => index >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(text).not.toContain('and the pane')
  })

  test('a notification is not the person\'s prompt', async ($, on) => {
    boot(on, SESSION_ID)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await start($)
    await $.prompt.submit({ text: 'scheduled check', wait: false, origin: { kind: 'scheduled-trigger' } })

    expect(await activityText($)).toContain('Nothing yet.')
  })

  test('agents and background tasks log their start and their end', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
    on('tool.call', () => ({ result: { ...DONE, backgroundTaskId: 'bg-1' } }))
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await start($)
    await $.agent.spawn(EXPLORE_SPAWN)
    world.agents = [EXPLORER]
    await world.clock.advance(1_000)
    world.agents = [{ ...EXPLORER, status: 'completed' }]
    await world.clock.advance(1_000)
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', run_in_background: true })
    await world.clock.advance(2_000)
    await $.prompt.submit({
      text: '<task-notification><task-id>bg-1</task-id><status>failed</status></task-notification>',
      wait: false,
      origin: { kind: 'task-notification' },
    })
    const text = await activityText($)

    expect(text).toContain('Explore  started: list files')
    expect(text).toContain('Explore✓ done in 1s: list files')
    expect(text).toContain('shell  started: npm test')
    expect(text).toContain('shell✕ failed after 2s: npm test')
  })

  test('/clear starts the log over', async ($, on) => {
    boot(on, SESSION_ID)
    on('tool.call', () => ({ result: DONE }))
    await start($)
    await readFiles($, 0, 2)

    expect(await activityText($)).toContain('reading f1.ts')

    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })

    expect(await activityText($)).toContain('Nothing yet.')
  })

  test('docked, the log takes the rows the other cards leave; inline it keeps to six', async ($, on) => {
    boot(on, SESSION_ID)
    on('tool.call', () => ({ result: DONE }))
    await start($)
    await readFiles($, 0, 40)

    const short = await logCard($, 30, 'dock')
    const tall = await logCard($, 40, 'dock')
    const above = await logCard($, 40, 'inline')

    expect(earlierCount(short) - earlierCount(tall)).toBe(10)
    expect(earlierCount(above)).toBe(40 - 6)
    expect(above).toContain('reading f39.ts')
  })

  test('scrolling back holds the log; scrolling to the end follows it again', async ($, on) => {
    boot(on, SESSION_ID)
    on('tool.call', () => ({ result: DONE }))
    await start($)
    await readFiles($, 0, 20)
    const ui = await mountPane($, 90, 18, 'dock')
    const scroll = { component: 'Pane', requestId: PANE_ID, offset: 0, bodyRows: 18, contentRows: 18, origin: { kind: 'person' } } as const

    await $.ui.scroll({ ...scroll, by: -3 })
    await readFiles($, 20, 1)
    const held = await cardOf(ui, 'activity')

    expect(held).toContain('4 newer below')
    expect(held).toContain('reading f16.ts')
    expect(held).not.toContain('reading f17.ts')
    expect(held).not.toContain('reading f20.ts')

    await $.ui.scroll({ ...scroll, by: 100 })
    const following = await cardOf(ui, 'activity')

    expect(following).not.toContain('newer below')
    expect(following).toContain('reading f20.ts')
    await ui.unmount()
  })

  test('a held log that shows the newest entry anyway follows again', async ($, on) => {
    boot(on, SESSION_ID)
    on('tool.call', () => ({ result: DONE }))
    await start($)
    await readFiles($, 0, 12)
    const short = await mountPane($, 90, 18, 'dock')
    await $.ui.scroll({ component: 'Pane', requestId: PANE_ID, offset: 0, bodyRows: 18, contentRows: 18, origin: { kind: 'person' }, by: -3 })
    await short.unmount()

    const tall = await mountPane($, 90, PANE_BODY_ROWS, 'dock')
    await readFiles($, 12, 30)
    const text = await cardOf(tall, 'activity')
    await tall.unmount()

    expect(text).not.toContain('newer below')
    expect(text).toContain('reading f41.ts')
  })

  test('a page key moves the log one window, not the body\'s rows', async ($, on) => {
    boot(on, SESSION_ID)
    on('tool.call', () => ({ result: DONE }))
    await start($)
    await readFiles($, 0, 40)
    const ui = await mountPane($, 90, 18, 'dock')
    await $.ui.scroll({ component: 'Pane', requestId: PANE_ID, offset: 0, bodyRows: 18, contentRows: 18, origin: { kind: 'person' }, by: -18 })
    const text = await cardOf(ui, 'activity')
    await ui.unmount()

    const shown = text.match(/reading f\d+\.ts/g)?.length ?? 0

    expect(Number(/(\d+) newer below/.exec(text)?.[1])).toBe(shown)
  })

  test('each surface scrolls by its own drawing', async ($, on) => {
    boot(on, SESSION_ID)
    on('tool.call', () => ({ result: DONE }))
    await start($)
    await readFiles($, 0, 40)

    const terminal = await mountPane($, 90, 18, 'dock')

    const desktop = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'desktop',
      component: 'Pane',
      requestId: PANE_ID,
      props: { title: 'Session', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: PANE_BODY_ROWS }, view: {} },
    })

    const wheel = { column: 10, row: 10 }
    await $.ui.scroll({ component: 'Pane', requestId: PANE_ID, offset: 0, bodyRows: 18, contentRows: 18, origin: { kind: 'person' }, by: -100, pointer: wheel })
    const text = await cardOf(terminal, 'activity')
    await terminal.unmount()
    await desktop.unmount()

    expect(text).toContain('reading f0.ts')
  })

  test('a call before the list names its agent goes under the name the team gave it', async ($, on) => {
    boot(on, SESSION_ID)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1', teammateId: 'scout-2@session-1' }))
    on('tool.call', () => ({ result: DONE }))
    await start($)
    await $.agent.spawn({ ...EXPLORE_SPAWN, name: 'scout', isTeammate: true })
    await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/w/a.ts', ...IN_AGENT })
    await $.agent.spawn({ ...EXPLORE_SPAWN, name: 'scout', isTeammate: true, resume: { agentId: 'a1' } })
    const text = await activityText($)

    expect(text).toContain('scout-2  started: list files')
    expect(text).toContain('scout-2  reading a.ts')
    expect(text).toContain('scout-2  resumed: list files')
  })

  test('an agent that ended before any pull saw it running still logs its end', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
    await start($)
    await $.agent.spawn(EXPLORE_SPAWN)
    world.agents = [{ ...EXPLORER, status: 'failed' }]
    await world.clock.advance(1_000)

    expect(await activityText($)).toContain('Explore✕ failed after')
  })

  test('a turned-down plan is declined, and a failed command failed', async ($, on) => {
    boot(on, SESSION_ID)
    on('tool.call', () => ({ isError: true, result: 'no', text: 'no' }))
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode', tool_use_id: 'plan-1' })
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })
    const text = await activityText($)

    expect(text).toContain('Claude■ declined: presenting a plan')
    expect(text).toContain('Claude✕ failed: running npm test')
  })

  test('a task the Stop snapshot took down ends by its notification, or at the next Stop', async ($, on) => {
    const world = boot(on, SESSION_ID)
    let taskId = 'bg-1'
    on('classic.Stop', () => ({}))
    on('tool.call', () => ({ result: { ...DONE, backgroundTaskId: taskId } }))
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await start($)
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', run_in_background: true })
    await world.clock.advance(2_000)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })

    expect(await bandText($, false, 140)).not.toContain('Background')
    expect(await activityText($)).not.toContain('npm test after')

    await $.prompt.submit({
      text: '<task-notification><task-id>bg-1</task-id><status>failed</status></task-notification>',
      wait: false,
      origin: { kind: 'task-notification' },
    })

    expect(await activityText($)).toContain('shell✕ failed after 2s: npm test')

    taskId = 'bg-2'
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'npm run lint', run_in_background: true })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    await world.clock.advance(1_000)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })

    expect(await activityText($)).toContain('shell  ended after 1s: npm run lint')
  })

  test('a dead pane\'s teammate ends once, even while tmux cannot be asked', async ($, on) => {
    const world = boot(on, SESSION_ID)
    const tmux = fakeTmux(on, world, undefined)
    await start($)
    world.agents = [PANE_TEAMMATE]
    await world.clock.advance(1_000)
    tmux.listing = { exitCode: 0, stdout: '%0 0\n%5 1\n' }
    await world.clock.advance(1_000)
    tmux.listing = null
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('Waiting on')

    tmux.listing = { exitCode: 0, stdout: '%0 0\n%5 1\n' }
    await world.clock.advance(1_000)

    expect((await activityText($)).match(/stopped after/g)?.length).toBe(1)
  })

  test('the pane\'s state is the engine\'s word once the band has it', async ($, on) => {
    boot(on, SESSION_ID)
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })

    expect(await paneCardText($, 90, 'session')).toContain('Working')

    const ui = await band($, 'terminal', false, 140, 5)

    expect(await paneCardText($, 90, 'session')).not.toContain('Working')
    await ui.unmount()
  })
})
