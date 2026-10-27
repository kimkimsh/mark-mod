import { describe, expect, test } from 'claude-code/testing'

import type { DashLive, DashTask, DashTurn } from '../types'
import {
  addTokens,
  agentsFromReading,
  barCells,
  buildView,
  cellWidth,
  clipCells,
  effortLabel,
  exhaustsBeforeReset,
  emptyTokens,
  formatCost,
  formatDuration,
  formatTokens,
  endedTaskIds,
  livePaneIds,
  modelFamily,
  paneListingArgv,
  paneRosterFromText,
  rosterPath,
  tasksStillRead,
  usageFromReading,
  withAnsweredModel,
  withKnownLimits,
  withRequest,
  withSpawnModel,
  withoutAgentModels,
} from '../hooks/model'
import type { DashSnapshot } from '../hooks/model'

const NOW = 10_000_000

const IDLE_LIVE: DashLive = { now: NOW, agents: [], listError: null }

function snapshot(overrides: Partial<DashSnapshot>): DashSnapshot {
  return {
    isWorking: false,
    turn: null,
    asks: [],
    tasks: [],
    tokens: emptyTokens(),
    hasResponse: false,
    lastTurn: null,
    usage: null,
    live: IDLE_LIVE,
    agentModels: {},
    ...overrides,
  }
}

const RUNNING_TURN: DashTurn = { turnId: 't1', startedAt: NOW - 72_000, calls: [] }

describe('formatting', () => {
  test('token counts read at a glance', () => {
    expect(formatTokens(842)).toBe('842')
    expect(formatTokens(1_000)).toBe('1k')
    expect(formatTokens(12_345)).toBe('12k')
    expect(formatTokens(9_460)).toBe('9.5k')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_234_567)).toBe('1.23M')
    expect(formatTokens(12_340_000)).toBe('12.3M')
    expect(formatTokens(999_600)).toBe('1M')
    expect(formatTokens(999_960_000)).toBe('1B')
  })

  test('durations shorten as they grow', () => {
    expect(formatDuration(-5)).toBe('0s')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(72_000)).toBe('1m12s')
    expect(formatDuration(12 * 60_000)).toBe('12m')
    expect(formatDuration((2 * 60 + 14) * 60_000)).toBe('2h14m')
    expect(formatDuration((3 * 24 + 4) * 3_600_000)).toBe('3d4h')
  })

  test('cost below a cent is not shown as zero', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(0.004)).toBe('<$0.01')
    expect(formatCost(3.414)).toBe('$3.41')
  })

  test('bars fill in eighths and always span their cells', () => {
    expect(barCells(0, 10)).toEqual({ fill: '', rest: '░░░░░░░░░░' })
    expect(barCells(100, 4)).toEqual({ fill: '████', rest: '' })
    expect(barCells(45, 10)).toEqual({ fill: '████▌', rest: '░░░░░' })
    expect(barCells(250, 4)).toEqual({ fill: '████', rest: '' })
    expect(barCells(null, 3)).toEqual({ fill: '', rest: '   ' })
  })
})

describe('readings', () => {
  test('a notification names the tasks it ends, and only those', () => {
    const one = '<task-notification>\n<task-id>bvcykn48s</task-id>\n<status>completed</status>\n</task-notification>'
    const event = '<task-notification><task-id>mon-1</task-id><status>event</status></task-notification>'
    const failed = '<task-notification><task-id>sh-2</task-id><status>failed</status></task-notification>'

    expect(endedTaskIds(one)).toEqual(['bvcykn48s'])
    expect(endedTaskIds(`${one}\n${event}\n${failed}`)).toEqual(['bvcykn48s', 'sh-2'])
    expect(endedTaskIds('plain prompt')).toEqual([])
  })

  test('a missing reading stays missing, not zero', () => {
    const usage = usageFromReading({ context: { window: 200_000 }, rateLimits: [] })

    expect(usage.contextTokens).toBeNull()
    expect(usage.contextPercent).toBeNull()
    expect(usage.costUsd).toBeNull()
  })

  test('reset times are parsed, and an unparseable one is dropped', () => {
    const usage = usageFromReading({
      context: { window: 1 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 33, resetsAt: '2026-10-13T07:20:00.000Z' },
        { kind: 'seven_day', percentUsed: 13, resetsAt: 'soon' },
      ],
    })

    expect(usage.limits[0]?.resetsAt).toBe(Date.parse('2026-10-13T07:20:00.000Z'))
    expect(usage.limits[1]?.resetsAt).toBeNull()
  })

  test('agents keep the time they were first seen', () => {
    const first = agentsFromReading([{ id: 'a', description: 'd', type: 'Explore', status: 'running' }], [], 100)
    const again = agentsFromReading([{ id: 'a', description: 'd', type: 'Explore', status: 'completed' }], first, 900)

    expect(again[0]?.firstSeenAt).toBe(100)
    expect(again[0]?.status).toBe('completed')
  })

  test('the snapshot takes down a task it no longer lists, and adds none', () => {
    const previous: DashTask[] = [
      { id: 'sh', kind: 'shell', description: 'npm test', startedAt: 5, endsBy: null },
      { id: 'mo', kind: 'monitor', description: 'watch CI', startedAt: 7, endsBy: 60_007 },
    ]

    const tasks = tasksStillRead(previous, [
      { id: 'sh', type: 'shell', description: 'Run tests', command: 'npm test' },
      { id: 'ag', type: 'subagent', description: 'list files' },
      { id: 'tnonmf77g', type: 'teammate', description: 'teammate probe' },
      { id: 'b0ojyy9gl', type: 'shell', description: 'sleep 25', command: 'sleep 25' },
    ])

    expect(tasks).toEqual([{ id: 'sh', kind: 'shell', description: 'npm test', startedAt: 5, endsBy: null }])
  })

  test('tokens split between the main loop and the agents', () => {
    const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }
    const tokens = addTokens(addTokens(emptyTokens(), usage, true), usage, false)

    expect(tokens.main).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })
    expect(tokens.agents).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })
    expect(buildView(snapshot({ tokens })).tokens.totalText).toBe('20')
  })
})

describe('pane teammates', () => {
  test('a roster names the members on a tmux pane, and a file of another shape names none', () => {
    const roster = paneRosterFromText(
      JSON.stringify({
        leadProcess: { pid: 71463 },
        members: [
          { agentId: 'team-lead@s', tmuxPaneId: 'leader', backendType: 'in-process' },
          { agentId: 'sleeper@s', tmuxPaneId: '%0', backendType: 'tmux' },
          { agentId: 'odd@s', tmuxPaneId: 7, backendType: 'tmux' },
        ],
      }),
    )

    expect(roster.leadPid).toBe(71463)
    expect([...roster.panes]).toEqual([['sleeper@s', '%0']])
    expect(paneRosterFromText('{"members": [').panes.size).toBe(0)
    expect(paneRosterFromText('[]').leadPid).toBeNull()
  })

  test('the pane listing goes to the server the engine put its panes on', () => {
    expect(paneListingArgv('/tmp/tmux-1000/default,4242,0', 71463)?.slice(0, 3)).toEqual(['tmux', '-S', '/tmp/tmux-1000/default'])
    expect(paneListingArgv(undefined, 71463)?.slice(0, 3)).toEqual(['tmux', '-L', 'claude-swarm-71463'])
    expect(paneListingArgv('', null)).toBeNull()
    expect(rosterPath('/home/u/.claude', 'sleeper@session-1')).toBe('/home/u/.claude/teams/session-1/config.json')
  })

  test('a dead pane is not a live one', () => {
    expect([...livePaneIds('%0 0\n%5 1\n\n')]).toEqual(['%0'])
  })
})

describe('agent models', () => {
  test('a worker row names the model family, whatever the id around it', () => {
    expect(modelFamily('claude-haiku-5-5')).toBe('haiku')
    expect(modelFamily('claude-opus-5-5[1m]')).toBe('opus')
    expect(modelFamily('claude-3-5-sonnet-20241022')).toBe('sonnet')
    expect(modelFamily('us.anthropic.claude-sonnet-5-5-v1:0')).toBe('sonnet')
    expect(modelFamily('haiku')).toBe('haiku')
    expect(modelFamily('gpt-x')).toBe('gpt-x')
  })

  test('effort is a level or an integer budget', () => {
    expect(effortLabel('low')).toBe('low')
    expect(effortLabel(16_000)).toBe('16k')
    expect(effortLabel(undefined)).toBeNull()
  })

  test('the answered model replaces the one a request named, and keeps its effort', () => {
    const requested = withRequest({}, 'a', 'claude-haiku-5-5', 'low')
    const answered = withAnsweredModel(requested, 'a', 'claude-sonnet-5-5')

    expect(answered).toEqual({ a: { model: 'claude-sonnet-5-5', effort: 'low' } })
    expect(withAnsweredModel(answered, 'a', 'claude-sonnet-5-5')).toBe(answered)
  })

  test('a spawn or a request names a model only while none is known', () => {
    const answered = { a: { model: 'claude-sonnet-5-5', effort: 'low' } }

    expect(withSpawnModel(answered, 'a', 'claude-haiku-5-5')).toBe(answered)
    expect(withRequest(answered, 'a', 'claude-haiku-5-5', 'low')).toBe(answered)
    expect(withSpawnModel({}, 'a', 'claude-haiku-5-5')).toEqual({ a: { model: 'claude-haiku-5-5', effort: null } })
  })

  test('a spawn result after the first request keeps its effort', () => {
    const requested = withRequest({}, 'a', 'claude-haiku-5-5', 'medium')

    expect(withSpawnModel(requested, 'a', 'claude-haiku-5-5')).toBe(requested)
  })

  test('a request with no effort clears the effort an earlier one asked for', () => {
    const requested = withRequest({}, 'a', 'claude-haiku-5-5', 'high')

    expect(withRequest(requested, 'a', 'claude-haiku-5-5', null)).toEqual({ a: { model: 'claude-haiku-5-5', effort: null } })
  })

  test('an agent that left the list leaves the map', () => {
    const models = { a: { model: 'm', effort: null }, b: { model: 'm', effort: null } }

    expect(withoutAgentModels(models, ['a'])).toEqual({ b: { model: 'm', effort: null } })
    expect(withoutAgentModels(models, ['c'])).toBe(models)
  })

  test('a worker row carries its agent\'s model and effort', () => {
    const live: DashLive = {
      now: NOW,
      agents: [
        { id: 'a', label: 'Explore', description: 'x', status: 'running', isTeammate: false, isNested: false, firstSeenAt: NOW },
        { id: 'b', label: 'scout', description: 'y', status: 'running', isTeammate: true, isNested: false, firstSeenAt: NOW },
        { id: 'c', label: 'Plan', description: 'z', status: 'running', isTeammate: false, isNested: false, firstSeenAt: NOW },
      ],
      listError: null,
    }

    const view = buildView(
      snapshot({
        live,
        agentModels: {
          a: { model: 'claude-haiku-5-5', effort: 'low' },
          b: { model: 'claude-opus-5-5', effort: null },
        },
      }),
    )

    expect(view.subagents.map(worker => worker.modelText)).toEqual(['haiku·low', ''])
    expect(view.teammates[0]?.modelText).toBe('opus')
  })
})

describe('headline', () => {
  test('a question to the person outranks everything', () => {
    const view = buildView(
      snapshot({
        isWorking: true,
        turn: RUNNING_TURN,
        asks: [{ id: 'q', tool: 'AskUserQuestion', startedAt: NOW - 5_000 }],
      }),
    )

    expect(view.headline).toEqual({ phase: 'needs-input', title: 'Needs you', detail: 'question', elapsedText: '5s' })
  })

  test('plan approval reads as its own wait', () => {
    const view = buildView(snapshot({ asks: [{ id: 'p', tool: 'ExitPlanMode', startedAt: NOW }] }))

    expect(view.headline.detail).toBe('plan approval')
  })

  test('a running turn names the tools in flight', () => {
    const calls = [
      { id: '1', tool: 'Bash', startedAt: NOW },
      { id: '2', tool: 'Read', startedAt: NOW },
    ]

    expect(buildView(snapshot({ isWorking: true, turn: RUNNING_TURN })).headline).toEqual({
      phase: 'working',
      title: 'Working',
      detail: 'thinking',
      elapsedText: '',
    })
    expect(buildView(snapshot({ isWorking: true, turn: { ...RUNNING_TURN, calls } })).headline.detail).toBe(
      'Bash +1 running',
    )
  })

  test('the engine saying a turn runs is enough, even with no turn record', () => {
    expect(buildView(snapshot({ isWorking: true })).headline.phase).toBe('working')
  })

  test('an idle main loop waits on whatever still runs', () => {
    const live: DashLive = {
      now: NOW,
      agents: [
        { id: 'a', label: 'Explore', description: 'x', status: 'running', isTeammate: false, isNested: false, firstSeenAt: NOW },
        { id: 'b', label: 'scout', description: 'y', status: 'idle', isTeammate: true, isNested: false, firstSeenAt: NOW },
      ],
      listError: null,
    }

    const tasks: DashTask[] = [{ id: 'sh', kind: 'shell', description: 'npm test', startedAt: NOW, endsBy: null }]

    expect(buildView(snapshot({ live })).headline.title).toBe('Waiting on subagents')
    expect(buildView(snapshot({ live, tasks })).headline.title).toBe('Waiting on subagents, background')
    expect(buildView(snapshot({ tasks })).headline.title).toBe('Waiting on background')
  })

  test('an idle teammate is not something to wait on', () => {
    const live: DashLive = {
      now: NOW,
      agents: [{ id: 'b', label: 'scout', description: 'y', status: 'idle', isTeammate: true, isNested: false, firstSeenAt: NOW }],
      listError: null,
    }

    const view = buildView(snapshot({ live }))

    expect(view.headline.phase).toBe('ready')
    expect(view.idleTeammates).toBe(1)
  })

  test('how the last turn ended decides the resting state', () => {
    const ended = (reason: 'answer' | 'aborted' | 'refusal' | 'error') =>
      buildView(snapshot({ lastTurn: { reason, endedAt: NOW - 120_000, durationMs: 192_000 } })).headline

    expect(ended('answer')).toEqual({ phase: 'done', title: 'All done', detail: '2m ago · took 3m12s', elapsedText: '' })
    expect(ended('aborted').title).toBe('Interrupted')
    expect(ended('error').phase).toBe('error')
    expect(ended('refusal').title).toBe('Refused')
    expect(buildView(snapshot({})).headline.title).toBe('Ready')
  })
})

describe('meters', () => {
  const limits = [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: NOW + (2 * 60 + 14) * 60_000 },
    { kind: 'seven_day', percentUsed: 91, resetsAt: NOW - 1 },
  ]

  const usage = { contextTokens: 92_100, contextWindow: 200_000, contextPercent: 46, limits, costUsd: 3.41 }

  test('limits say what is left and when it resets', () => {
    const [context, fiveHour, weekly] = buildView(snapshot({ usage, hasResponse: true })).meters

    expect(context).toMatchObject({ leftPercent: 54, valueText: '54% left', noteText: '92k / 200k', severity: 'ok' })
    expect(fiveHour).toMatchObject({ label: '5-hour', leftPercent: 76.5, valueText: '76% left', noteText: 'resets in 2h14m' })
    expect(weekly).toMatchObject({ label: 'Weekly', valueText: 'reset', leftPercent: null })
  })

  test('nearly spent limits turn to warning and danger', () => {
    const hot = { ...usage, limits: [{ kind: 'five_hour', percentUsed: 70, resetsAt: null }, { kind: 'seven_day', percentUsed: 90, resetsAt: null }] }
    const [, fiveHour, weekly] = buildView(snapshot({ usage: hot, hasResponse: true })).meters

    expect(fiveHour?.severity).toBe('warn')
    expect(weekly?.severity).toBe('danger')
  })

  test('no reading before the first response, no data after it', () => {
    const empty = { ...usage, limits: [] }

    expect(buildView(snapshot({ usage: empty })).meters[1]).toMatchObject({ valueText: 'not measured yet', isAvailable: true })

    const after = buildView(snapshot({ usage: empty, hasResponse: true }))

    expect(after.meters[1]).toMatchObject({ valueText: 'no data', isAvailable: false })
    expect(after.limitsNote).not.toBeNull()
  })

  test('context reads as room left, unmeasured context as not yet measured', () => {
    expect(buildView(snapshot({})).meters[0]).toMatchObject({ valueText: 'not measured yet', leftPercent: null })
  })

  test('a reading without windows keeps the last known ones', () => {
    const next = withKnownLimits(usage, { ...usage, limits: [], costUsd: null })

    expect(next.limits).toEqual(limits)
    expect(next.costUsd).toBeNull()
    expect(withKnownLimits(null, { ...usage, limits: [] }).limits).toEqual([])
  })

  test('a recent end reads as just now, never as invented seconds', () => {
    const view = buildView(snapshot({ lastTurn: { reason: 'answer', endedAt: NOW - 14_000, durationMs: 3_000 } }))

    expect(view.headline.detail).toBe('just now · took 3s')

    const later = buildView(snapshot({ lastTurn: { reason: 'answer', endedAt: NOW - 276_000, durationMs: 3_000 } }))

    expect(later.headline.detail).toBe('4m ago · took 3s')
  })

  test('a window spent faster than it resets warns before the percentage would', () => {
    const fiveHour = { kind: 'five_hour', percentUsed: 47, resetsAt: NOW + 199 * 60_000 }
    const early = { kind: 'five_hour', percentUsed: 30, resetsAt: NOW + (5 * 60 - 10) * 60_000 }
    const steady = { kind: 'seven_day', percentUsed: 10, resetsAt: NOW + 5 * 86_400_000 }

    expect(Math.round((exhaustsBeforeReset(fiveHour, NOW) ?? 0) / 60_000)).toBe(114)
    expect(exhaustsBeforeReset(early, NOW)).toBeNull()
    expect(exhaustsBeforeReset(steady, NOW)).toBeNull()

    const [, meter] = buildView(snapshot({ usage: { ...usage, limits: [fiveHour] }, hasResponse: true })).meters

    expect(meter).toMatchObject({ severity: 'warn', noteText: 'runs out in 1h53m at this pace' })
  })

  test('display width counts Hangul as two cells', () => {
    expect(cellWidth('5시간 47%')).toBe(9)
    expect(clipCells('서브에이전트 작업', 9)).toBe('서브에이…')
    expect(clipCells('short', 9)).toBe('short')
  })

  test('an extra window the API reports is kept for the pane', () => {
    const extra = { ...usage, limits: [...limits, { kind: 'spend_limit', percentUsed: 10, resetsAt: null }] }

    expect(buildView(snapshot({ usage: extra })).meters.map(meter => meter.key)).toEqual([
      'context',
      'five_hour',
      'seven_day',
      'spend_limit',
    ])
  })
})
