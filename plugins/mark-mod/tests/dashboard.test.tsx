import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { AgentInfo, On, RenderSurface, SessionUsage, TurnStepInput } from 'claude-code'

const PLUGIN = 'mark-mod'

const PANE_ID = PLUGIN

const SESSION_ID = 'session-1'

const START = 1_800_000_000_000

const SURFACES = ['terminal', 'desktop'] as const

type World = {
  clock: MockClock
  agents: AgentInfo[]
  isListBroken: boolean
  usage: SessionUsage
  openPanes: string[]
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
    value: world.openPanes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.open', ($, e) => {
    world.openPanes.push(e.id)

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

async function bandText($: Engine, isWorking: boolean, columns: number): Promise<string> {
  const ui = await band($, 'terminal', isWorking, columns, 5)
  const text = (await ui.find({ type: 'Box' }))?.text ?? ''
  await ui.unmount()

  return text
}

async function paneText($: Engine, columns: number): Promise<string> {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    props: { title: 'Session', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })

  const text = (await ui.find({ type: 'Box' }))?.text ?? ''
  await ui.unmount()

  return text
}

// A call made inside an agent's loop; the kit's call types leave the
// engine-stamped agentId out, so it rides in by spread.
const IN_AGENT = { agentId: 'a1' }

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

const MEASURED: SessionUsage = {
  startedAt: START,
  context: { tokens: 92_100, window: 200_000, percent: 46 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 33, resetsAt: new Date(START + 2 * 3_600_000).toISOString() },
    { kind: 'seven_day', percentUsed: 13, resetsAt: new Date(START + 6 * 86_400_000).toISOString() },
  ],
  cost: { usd: 3.41 },
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

async function step($: Engine, agentId: string | undefined): Promise<void> {
  const input: TurnStepInput = { turnId: 'turn-1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }

  if (agentId !== undefined) {
    input.agentId = agentId
  }

  const stream = $.turn.step(input)

  for await (const chunk of stream) {
    expect(chunk).toBeDefined()
  }
}

describe('band', () => {
  test('a fresh session reads as ready, with limits not yet measured', async ($, on) => {
    boot(on, SESSION_ID)
    await start($)

    for (const surface of SURFACES) {
      const ui = await band($, surface, false, 140, 5)
      const text = (await ui.find({ type: 'Box' }))?.text ?? ''

      expect(text).toContain('Ready')
      expect(text).toContain('not measured yet')
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
    expect(text).toContain('resets in 2h00m')
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

  test('a window whose reset time passed stops claiming its old reading', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world, MEASURED)
    await world.clock.advance(2 * 3_600_000 + 1_000)

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

  test('a running turn shows the tool in flight, and a plan awaiting approval outranks it', async ($, on) => {
    const world = boot(on, SESSION_ID)
    let release: () => void = () => {}

    const held = new Promise<void>(resolve => {
      release = resolve
    })

    on('tool.call', { tool: 'ExitPlanMode' }, async () => {
      await held

      return { result: { plan: 'p', isAgent: false } }
    })
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await world.clock.advance(72_000)

    expect(await bandText($, true, 140)).toContain('thinking')

    const asking = $.tool.call({ tool: 'ExitPlanMode', tool_use_id: 'plan-1' })
    await world.clock.settle()
    const text = await bandText($, true, 140)

    expect(text).toContain('Needs you')
    expect(text).toContain('plan approval')

    release()
    await asking
    await world.clock.settle()

    expect(await bandText($, true, 140)).toContain('Working')
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

    expect(await bandText($, false, 140)).toContain('All done')
  })

  test('a subagent still running after the turn is what the session waits on', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.agents = [{ id: 'a1', description: 'list files', type: 'Explore', status: 'running' }]
    await world.clock.advance(1_000)
    await world.clock.advance(42_000)
    const text = await bandText($, false, 140)

    expect(text).toContain('Waiting on subagents')
    expect(text).toContain('Explore 42s')

    world.agents = [{ id: 'a1', description: 'list files', type: 'Explore', status: 'completed' }]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('Waiting on subagents')
  })

  test('a running agent names the model it was started on, then the effort its requests ask for', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
    on('turn.step', async function* (_$, e) {
      yield* []

      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    await start($)
    await $.agent.spawn({
      tool_use_id: 'ag-1',
      prompt: 'list files',
      description: 'list files',
      subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: true,
      fork: false,
    })
    world.agents = [{ id: 'a1', description: 'list files', type: 'Explore', status: 'running' }]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('Explore haiku 0s')

    const stream = $.turn.step({ turnId: 'turn-a', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 1, agentId: 'a1' })

    for await (const chunk of stream) {
      expect(chunk).toBeDefined()
    }

    await world.clock.advance(5_000)

    expect(await bandText($, false, 140)).toContain('Explore haiku·low 5s')

    expect(await paneText($, 90)).toContain('haiku·low list files')
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

    const stream = $.turn.step({ turnId: 'turn-a', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 1, agentId: 'a1' })

    for await (const chunk of stream) {
      expect(chunk).toBeDefined()
    }

    await $.agent.spawn({
      tool_use_id: 'ag-1',
      prompt: 'list files',
      description: 'list files',
      subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: true,
      fork: false,
    })
    world.agents = [{ id: 'a1', description: 'list files', type: 'Explore', status: 'running' }]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('Explore sonnet·low')
  })

  // A teammate's spawn result can land before the list first names it.
  test('an agent\'s model leaves with the agent, not before the list first names it', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
    await start($)
    await $.agent.spawn({
      tool_use_id: 'ag-1',
      prompt: 'list files',
      description: 'list files',
      subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: true,
      fork: false,
    })
    await world.clock.advance(1_000)
    const explorer = { id: 'a1', description: 'list files', type: 'Explore', status: 'running' } as const
    world.agents = [explorer]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('Explore haiku')

    world.agents = []
    await world.clock.advance(1_000)
    world.agents = [explorer]
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

    expect(text).toContain('Waiting on teammates')
    expect(text).toContain('teammates 1/2')
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

    expect(await bandText($, false, 140)).toContain('teammates 1/1 working')
    expect(tmux.argv).toEqual(['tmux', '-S', '/tmp/tmux-1000/default', 'list-panes', '-a', '-F', '#{pane_id} #{pane_dead}'])

    tmux.listing = { exitCode: 0, stdout: '%0 0\n%5 1\n' }
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('working')

    tmux.listing = { exitCode: 0, stdout: '%0 0\n' }
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('working')
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

    expect(await bandText($, false, 140)).toContain('teammates 1/1 working')
    expect(tmux.argv).toEqual(['tmux', '-L', `claude-swarm-${LEAD_PID}`, 'list-panes', '-a', '-F', '#{pane_id} #{pane_dead}'])

    tmux.listing = { exitCode: 1, stdout: '' }
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('working')
  })

  test('where tmux cannot be asked, a pane teammate keeps the list\'s word', async ($, on) => {
    const world = boot(on, SESSION_ID)
    const tmux = fakeTmux(on, world, undefined)
    tmux.listing = null
    await start($)
    world.agents = [PANE_TEAMMATE]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('teammates 1/1 working')
  })

  test('a backgrounded command is tracked until its notification arrives', async ($, on) => {
    const world = boot(on, SESSION_ID)

    on('tool.call', () => ({
      result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-1' },
    }))
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await start($)
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', run_in_background: true })
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('Waiting on background')

    await $.prompt.submit({
      text: '<task-notification>\n<task-id>bg-1</task-id>\n<status>completed</status>\n</task-notification>',
      wait: false,
      origin: { kind: 'task-notification' },
    })

    expect(await bandText($, false, 140)).not.toContain('background')
  })

  // No classic.* here, as where an organization manages Claude Code: an
  // agent's command notifies that agent, so nothing would ever take it down.
  test('a command an agent backgrounds is the agent\'s to wait on, not the session\'s', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('tool.call', { tool: 'Bash' }, () => ({
      result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-a' },
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

    expect(text).toContain('Waiting on subagents')
    expect(text).not.toContain('background')
  })

  // As 2.1.311 sends it where classic.* runs: the snapshot lists every loop's
  // work, and no Stop follows the end of a teammate's command.
  test('the stop snapshot does not bring back what an agent backgrounds', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('classic.Stop', () => ({}))
    on('tool.call', () => ({
      result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b0ojyy9gl' },
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

    expect(await bandText($, false, 140)).not.toContain('background')
  })

  // An agent's SubagentStop runs alongside the main loop, so its snapshot may
  // predate a command the main loop has just started.
  test('an agent\'s stop does not take down the main loop\'s work', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('classic.SubagentStop', () => ({}))
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-1' } }))
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

    expect(await bandText($, false, 140)).toContain('background 1')
  })

  test('a command that ends with its caller\'s final response is never waited on', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('classic.Stop', () => ({}))
    on('tool.call', () => ({
      result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-1', backgroundEndsWithFinalResponse: true },
    }))
    await start($)
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', run_in_background: true })
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('background')

    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'bg-1', type: 'shell', status: 'running', description: 'npm test', command: 'npm test' }],
    })

    expect(await bandText($, false, 140)).not.toContain('background')
  })

  // A monitor's expiry notice carries no <status>; with no classic.* the
  // deadline its own result names is the only word that it ended.
  test('a monitor is gone once its deadline passes', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('tool.call', () => ({ result: { taskId: 'mon-1', timeoutMs: 5_000, persistent: false } }))
    await start($)
    await $.tool.call({ tool: 'Monitor', tool_use_id: 'm1', description: 'never ends', timeout_ms: 5_000 })
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).toContain('never ends')

    await world.clock.advance(5_000)

    expect(await bandText($, false, 140)).not.toContain('background')
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

    expect(text).toContain('background 1')
    expect(text).toContain('watch CI')

    await $.classic.Stop({ stop_hook_active: false })

    expect(await bandText($, false, 140)).toContain('background 1')

    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })

    expect(await bandText($, false, 140)).not.toContain('background')
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

    expect(await bandText($, false, 140)).not.toContain('background')
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
  test('values come first; the weekly reset note and the bars give way to width', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world, MEASURED)

    const wide = await bandText($, false, 140)

    expect(wide).toContain('█')
    expect(wide).toContain('resets in 2h00m')
    expect(wide).toContain('resets in 6d0h')

    const medium = await bandText($, false, 74)

    expect(medium).not.toContain('█')
    expect(medium).toContain('resets in 2h00m')
    expect(medium).not.toContain('resets in 6d0h')
    expect(medium).toContain('87% left')

    const narrow = await bandText($, false, 50)

    expect(narrow).not.toContain('resets in')
    expect(narrow).toContain('87% left')
    expect(narrow).not.toContain('/dash')
  })

  test('only idle teammates leave no worker row', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.agents = [
      { id: 't2', teammateId: 'critic@team', name: 'critic', description: 'review', type: 'teammate', status: 'idle' },
    ]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('teammates')
  })

  test('a limit on pace to run out before its reset warns ahead of time', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world, {
      startedAt: START,
      context: { tokens: 10_000, window: 200_000, percent: 5 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 47, resetsAt: new Date(START + 199 * 60_000).toISOString() }],
    })

    expect(await bandText($, false, 140)).toContain('runs out in 1h53m at this pace')
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

    expect(await bandText($, false, 140)).toContain('tokens 2k')
  })

  test('a resumed session continues its saved count; /clear starts over', async ($, on) => {
    const saved = { [`tokens:${SESSION_ID}`]: savedTokens(1_000_000) }

    boot(on, SESSION_ID, saved)
    await start($)

    expect(await bandText($, false, 140)).toContain('tokens 1M')

    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })

    expect(await bandText($, false, 140)).toContain('tokens 0')
  })

  test('switching to another session in the same process loads that session\'s count', async ($, on) => {
    boot(on, SESSION_ID, { 'tokens:session-2': savedTokens(2_000_000) })
    on('classic.SessionStart', () => ({}))
    await start($)
    await $.session.end({ reason: 'resume', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    await $.classic.SessionStart({ source: 'resume', session_id: 'session-2' })

    expect(await bandText($, false, 140)).toContain('tokens 2M')
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

    expect(await bandText($, false, 140)).toContain('tokens 0')

    await $.classic.SessionStart({ source: 'resume', session_id: SESSION_ID })

    expect(await bandText($, false, 140)).toContain('tokens 10')
  })

  test('a store written by something else is ignored, not trusted', async ($, on) => {
    boot(on, SESSION_ID, { [`tokens:${SESSION_ID}`]: { tokens: 'lots' } })
    await start($)

    expect(await bandText($, false, 140)).toContain('tokens 0')
  })
})

describe('pane', () => {
  test('/dash opens the pane and closes it again', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await $.command.run({ command: 'dash', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

    expect(world.openPanes).toEqual([PANE_ID])

    await $.command.run({ command: 'dash', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

    expect(world.openPanes).toEqual([])
  })

  test('the band button toggles the pane', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    const ui = await band($, 'terminal', false, 140, 5)
    await ui.press({ key: 'dash' })

    expect(world.openPanes).toEqual([PANE_ID])
  })

  test('the pane itemises usage, tokens and every worker', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'sh' } }))
    await start($)
    await measure($, world, MEASURED)
    world.agents = [
      { id: 'a1', description: 'list files', type: 'Explore', status: 'running' },
      { id: 'a2', description: 'review', type: 'general-purpose', status: 'completed', parentId: 'a1' },
    ]
    await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test', description: 'Run tests', run_in_background: true })
    await world.clock.advance(1_000)

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

        for (const expected of ['Usage', 'Context', '5-hour', 'Weekly', 'Tokens', '$3.41', 'Explore', 'done 1', 'Run tests', 'Teammates none']) {
          expect(text).toContain(expected)
        }

        await ui.unmount()
      }
    }
  })

  test('a subagent\'s turn is not the main loop\'s', async ($, on) => {
    boot(on, SESSION_ID)
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 'turn-1', reason: 'answer' })
    await $.turn.start({ text: 'look', turnId: 'turn-a', agentId: 'a1' })
    const text = await paneText($, 90)

    expect(text).not.toContain('Working')
    expect(text).toContain('All done')
  })

  test('a failing agent list is shown, and the last list is kept', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.agents = [{ id: 'a1', description: 'list files', type: 'Explore', status: 'running' }]
    await world.clock.advance(1_000)
    world.isListBroken = true
    await world.clock.advance(1_000)
    const text = await bandText($, false, 140)

    expect(text).toContain('⚠ refresh failed')
    expect(text).toContain('Waiting on subagents')
  })
})
