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
}

type StoredEntries = Parameters<typeof mock.store>[1]

function boot(on: On, sessionId: string, stored?: StoredEntries): World {
  const world: World = {
    clock: mock.clock(on, { now: START }),
    agents: [],
    isListBroken: false,
    usage: { startedAt: START, context: { window: 200_000 }, rateLimits: [] },
    openPanes: [],
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

async function measure($: Engine, world: World): Promise<void> {
  await $.session.measure({
    context: { tokens: 92_100, window: 200_000, percent: 46 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 33, resetsAt: new Date(START + 2 * 3_600_000).toISOString() },
      { kind: 'seven_day', percentUsed: 13, resetsAt: new Date(START + 6 * 86_400_000).toISOString() },
    ],
    cost: { usd: 3.41 },
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

      expect(text).toContain('준비됨')
      expect(text).toContain('측정 전')
      expect(await ui.find({ type: 'Button', key: 'dash' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a measurement fills context, both limits and cost', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world)
    const text = await bandText($, false, 140)

    expect(text).toContain('54% 남음')
    expect(text).toContain('67% 남음')
    expect(text).toContain('2h00m 후 리셋')
    expect(text).toContain('87% 남음')
    expect(text).toContain('$3.41')
  })

  test('after /clear the account\'s limits stay on screen, the conversation\'s figures do not', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('classic.SessionStart', () => ({}))
    await start($)
    await measure($, world)
    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    await $.classic.SessionStart({ source: 'clear', session_id: 'session-2' })
    const text = await bandText($, false, 140)

    expect(text).toContain('67% 남음')
    expect(text).not.toContain('$3.41')
    expect(text).toContain('컨텍스트 측정 전')
  })

  test('a window whose reset time passed stops claiming its old reading', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world)
    await world.clock.advance(2 * 3_600_000 + 1_000)

    expect(await bandText($, false, 140)).toContain('리셋됨')
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

    expect(await bandText($, true, 140)).toContain('생각 중')

    const asking = $.tool.call({ tool: 'ExitPlanMode', tool_use_id: 'plan-1' })
    await world.clock.settle()
    const text = await bandText($, true, 140)

    expect(text).toContain('입력 필요')
    expect(text).toContain('계획 승인')

    release()
    await asking
    await world.clock.settle()

    expect(await bandText($, true, 140)).toContain('응답 중')
  })

  test('the engine saying nothing runs beats a stale turn record', async ($, on) => {
    boot(on, SESSION_ID)
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })

    expect(await bandText($, false, 140)).not.toContain('응답 중')
  })

  test('how the turn ended is the resting state', async ($, on) => {
    boot(on, SESSION_ID)
    await start($)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await $.turn.complete({ answer: '', durationMs: 5_000, isAborted: true, turnId: 'turn-1', reason: 'aborted' })

    expect(await bandText($, false, 140)).toContain('중단됨')

    await $.turn.start({ text: 'go', turnId: 'turn-2' })
    await $.turn.complete({ answer: 'ok', durationMs: 5_000, isAborted: false, turnId: 'turn-2', reason: 'answer' })

    expect(await bandText($, false, 140)).toContain('전체 완료')
  })

  test('a subagent still running after the turn is what the session waits on', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.agents = [{ id: 'a1', description: 'list files', type: 'Explore', status: 'running' }]
    await world.clock.advance(1_000)
    await world.clock.advance(42_000)
    const text = await bandText($, false, 140)

    expect(text).toContain('서브에이전트 대기')
    expect(text).toContain('Explore 42s')

    world.agents = [{ id: 'a1', description: 'list files', type: 'Explore', status: 'completed' }]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('서브에이전트 대기')
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

    expect(text).toContain('팀메이트 대기')
    expect(text).toContain('팀메이트 1/2')
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

    expect(await bandText($, false, 140)).toContain('백그라운드 대기')

    await $.prompt.submit({
      text: '<task-notification>\n<task-id>bg-1</task-id>\n<status>completed</status>\n</task-notification>',
      wait: false,
      origin: { kind: 'task-notification' },
    })

    expect(await bandText($, false, 140)).not.toContain('백그라운드')
  })

  test('a notification that does not end its task leaves it running', async ($, on) => {
    const world = boot(on, SESSION_ID)
    on('tool.call', () => ({ result: { taskId: 'mon-1', timeoutMs: 0, persistent: true } }))
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

  test('the stop snapshot is the truth about what still runs', async ($, on) => {
    boot(on, SESSION_ID)
    on('classic.Stop', () => ({}))
    await start($)
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [
        { id: 'm1', type: 'monitor', status: 'running', description: 'watch CI' },
        { id: 'a1', type: 'subagent', status: 'running', description: 'list files' },
      ],
    })
    const text = await bandText($, false, 140)

    expect(text).toContain('백그라운드 1')
    expect(text).toContain('watch CI')

    await $.classic.Stop({ stop_hook_active: false })

    expect(await bandText($, false, 140)).toContain('백그라운드 1')

    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })

    expect(await bandText($, false, 140)).not.toContain('백그라운드')
  })

  test('narrow bands drop the bars, short bands drop rows', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    await measure($, world)

    expect(await bandText($, false, 140)).toContain('█')
    expect(await bandText($, false, 60)).not.toContain('█')

    const ui = await band($, 'terminal', false, 140, 1)
    const text = (await ui.find({ type: 'Box' }))?.text ?? ''

    expect(text).toContain('준비됨')
    expect(text).not.toContain('컨텍스트')
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
    await measure($, world)

    const wide = await bandText($, false, 140)

    expect(wide).toContain('█')
    expect(wide).toContain('2h00m 후 리셋')
    expect(wide).toContain('6d0h 후 리셋')

    const medium = await bandText($, false, 74)

    expect(medium).not.toContain('█')
    expect(medium).toContain('2h00m 후 리셋')
    expect(medium).not.toContain('6d0h 후 리셋')
    expect(medium).toContain('87% 남음')

    const narrow = await bandText($, false, 50)

    expect(narrow).not.toContain('후 리셋')
    expect(narrow).toContain('87% 남음')
    expect(narrow).not.toContain('/dash')
  })

  test('only idle teammates leave no worker row', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.agents = [
      { id: 't2', teammateId: 'critic@team', name: 'critic', description: 'review', type: 'teammate', status: 'idle' },
    ]
    await world.clock.advance(1_000)

    expect(await bandText($, false, 140)).not.toContain('팀메이트')
  })

  test('a limit on pace to run out before its reset warns ahead of time', async ($, on) => {
    boot(on, SESSION_ID)
    await start($)
    await $.session.measure({
      context: { tokens: 10_000, window: 200_000, percent: 5 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 47, resetsAt: new Date(START + 199 * 60_000).toISOString() }],
      changed: ['rateLimits'],
    })

    expect(await bandText($, false, 140)).toContain('이 속도면 1h53m 후 소진')
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

    expect(await bandText($, false, 140)).toContain('토큰 2k')
  })

  test('a resumed session continues its saved count; /clear starts over', async ($, on) => {
    const saved = { [`tokens:${SESSION_ID}`]: savedTokens(1_000_000) }

    boot(on, SESSION_ID, saved)
    await start($)

    expect(await bandText($, false, 140)).toContain('토큰 1M')

    await $.session.end({ reason: 'clear', sessionId: SESSION_ID, resume: { id: SESSION_ID } })

    expect(await bandText($, false, 140)).toContain('토큰 0')
  })

  test('switching to another session in the same process loads that session\'s count', async ($, on) => {
    boot(on, SESSION_ID, { 'tokens:session-2': savedTokens(2_000_000) })
    on('classic.SessionStart', () => ({}))
    await start($)
    await $.session.end({ reason: 'resume', sessionId: SESSION_ID, resume: { id: SESSION_ID } })
    await $.classic.SessionStart({ source: 'resume', session_id: 'session-2' })

    expect(await bandText($, false, 140)).toContain('토큰 2M')
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

    expect(await bandText($, false, 140)).toContain('토큰 0')

    await $.classic.SessionStart({ source: 'resume', session_id: SESSION_ID })

    expect(await bandText($, false, 140)).toContain('토큰 10')
  })

  test('a store written by something else is ignored, not trusted', async ($, on) => {
    boot(on, SESSION_ID, { [`tokens:${SESSION_ID}`]: { tokens: 'lots' } })
    await start($)

    expect(await bandText($, false, 140)).toContain('토큰 0')
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
    on('classic.Stop', () => ({}))
    await start($)
    await measure($, world)
    world.agents = [
      { id: 'a1', description: 'list files', type: 'Explore', status: 'running' },
      { id: 'a2', description: 'review', type: 'general-purpose', status: 'completed', parentId: 'a1' },
    ]
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'sh', type: 'shell', status: 'running', description: 'Run tests', command: 'npm test' }],
    })
    await world.clock.advance(1_000)

    for (const surface of SURFACES) {
      for (const columns of [40, 90]) {
        const ui = await $.ui.mount({
          plugin: PLUGIN,
          surface,
          component: 'Pane',
          requestId: PANE_ID,
          props: {
            title: '세션 현황',
            isFocused: false,
            bodyColumns: columns,
            placement: 'dock',
            scroll: { offset: 0, bodyRows: 40 },
            view: {},
          },
        })

        const text = (await ui.find({ type: 'Box' }))?.text ?? ''

        for (const expected of ['사용량', '컨텍스트', '5시간', '주간', '토큰', '$3.41', 'Explore', '완료 1', 'Run tests', '팀메이트 없음']) {
          expect(text).toContain(expected)
        }

        await ui.unmount()
      }
    }
  })

  test('a failing agent list is shown, and the last list is kept', async ($, on) => {
    const world = boot(on, SESSION_ID)
    await start($)
    world.agents = [{ id: 'a1', description: 'list files', type: 'Explore', status: 'running' }]
    await world.clock.advance(1_000)
    world.isListBroken = true
    await world.clock.advance(1_000)
    const text = await bandText($, false, 140)

    expect(text).toContain('⚠ 갱신 실패')
    expect(text).toContain('서브에이전트 대기')
  })
})
