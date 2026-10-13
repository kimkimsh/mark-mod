import { describe, expect, test } from 'claude-code/testing'

import type { DashLive, DashTask, DashTurn } from '../types'
import {
  addTokens,
  agentsFromReading,
  barCells,
  buildView,
  emptyTokens,
  formatCost,
  formatDuration,
  formatTokens,
  parseTaskNotificationId,
  tasksFromReading,
  usageFromReading,
  withKnownLimits,
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
  test('a notification names its task', () => {
    const text = '<task-notification>\n<task-id>bvcykn48s</task-id>\n<status>completed</status>'

    expect(parseTaskNotificationId(text)).toBe('bvcykn48s')
    expect(parseTaskNotificationId('plain prompt')).toBeNull()
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

  test('agent loops in background_tasks are left to the agent list', () => {
    const previous: DashTask[] = [{ id: 'sh', kind: 'shell', label: 'npm test', startedAt: 5 }]

    const tasks = tasksFromReading(
      [
        { id: 'sh', type: 'shell', description: 'Run tests', command: 'npm test' },
        { id: 'ag', type: 'subagent', description: 'list files' },
        { id: 'tm', type: 'teammate', description: 'scout' },
        { id: 'mo', type: 'monitor', description: 'watch CI' },
      ],
      previous,
      50,
    )

    expect(tasks).toEqual([
      { id: 'sh', kind: 'shell', label: 'npm test', startedAt: 5 },
      { id: 'mo', kind: 'monitor', label: 'watch CI', startedAt: 50 },
    ])
  })

  test('tokens split between the main loop and the agents', () => {
    const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }
    const tokens = addTokens(addTokens(emptyTokens(), usage, true), usage, false)

    expect(tokens.main).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })
    expect(tokens.agents).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })
    expect(buildView(snapshot({ tokens })).tokens.totalText).toBe('20')
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

    expect(view.headline).toEqual({ phase: 'needs-input', title: '입력 필요', detail: '질문에 답해 주세요', elapsedText: '5s' })
  })

  test('plan approval reads as its own wait', () => {
    const view = buildView(snapshot({ asks: [{ id: 'p', tool: 'ExitPlanMode', startedAt: NOW }] }))

    expect(view.headline.detail).toBe('계획 승인을 기다립니다')
  })

  test('a running turn names the tools in flight', () => {
    const calls = [
      { id: '1', tool: 'Bash', startedAt: NOW },
      { id: '2', tool: 'Read', startedAt: NOW },
    ]

    expect(buildView(snapshot({ isWorking: true, turn: RUNNING_TURN })).headline).toEqual({
      phase: 'working',
      title: '응답 중',
      detail: '생각 중',
      elapsedText: '1m12s',
    })
    expect(buildView(snapshot({ isWorking: true, turn: { ...RUNNING_TURN, calls } })).headline.detail).toBe(
      'Bash 외 1개 실행 중',
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

    const tasks: DashTask[] = [{ id: 'sh', kind: 'shell', label: 'npm test', startedAt: NOW }]

    expect(buildView(snapshot({ live })).headline.title).toBe('서브에이전트 대기')
    expect(buildView(snapshot({ live, tasks })).headline.title).toBe('서브에이전트·백그라운드 대기')
    expect(buildView(snapshot({ tasks })).headline.title).toBe('백그라운드 대기')
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

    expect(ended('answer')).toEqual({ phase: 'done', title: '전체 완료', detail: '2m 전 · 3m12s 소요', elapsedText: '' })
    expect(ended('aborted').title).toBe('중단됨')
    expect(ended('error').phase).toBe('error')
    expect(ended('refusal').title).toBe('응답 거부됨')
    expect(buildView(snapshot({})).headline.title).toBe('대기 중')
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

    expect(context).toMatchObject({ leftPercent: 54, valueText: '54% 남음', noteText: '92k / 200k', severity: 'ok' })
    expect(fiveHour).toMatchObject({ label: '5시간', leftPercent: 76.5, valueText: '76% 남음', noteText: '2h14m 후 리셋' })
    expect(weekly).toMatchObject({ label: '주간', valueText: '리셋됨', leftPercent: null })
  })

  test('nearly spent limits turn to warning and danger', () => {
    const hot = { ...usage, limits: [{ kind: 'five_hour', percentUsed: 70, resetsAt: null }, { kind: 'seven_day', percentUsed: 90, resetsAt: null }] }
    const [, fiveHour, weekly] = buildView(snapshot({ usage: hot, hasResponse: true })).meters

    expect(fiveHour?.severity).toBe('warn')
    expect(weekly?.severity).toBe('danger')
  })

  test('no reading before the first response, no data after it', () => {
    const empty = { ...usage, limits: [] }

    expect(buildView(snapshot({ usage: empty })).meters[1]).toMatchObject({ valueText: '측정 전', isAvailable: true })

    const after = buildView(snapshot({ usage: empty, hasResponse: true }))

    expect(after.meters[1]).toMatchObject({ valueText: '정보 없음', isAvailable: false })
    expect(after.limitsNote).not.toBeNull()
  })

  test('context reads as room left, unmeasured context as not yet measured', () => {
    expect(buildView(snapshot({})).meters[0]).toMatchObject({ valueText: '측정 전', leftPercent: null })
  })

  test('a reading without windows keeps the last known ones', () => {
    const next = withKnownLimits(usage, { ...usage, limits: [], costUsd: null })

    expect(next.limits).toEqual(limits)
    expect(next.costUsd).toBeNull()
    expect(withKnownLimits(null, { ...usage, limits: [] }).limits).toEqual([])
  })

  test('a recent end reads as just now, never as invented seconds', () => {
    const view = buildView(snapshot({ lastTurn: { reason: 'answer', endedAt: NOW - 14_000, durationMs: 3_000 } }))

    expect(view.headline.detail).toBe('방금 · 3s 소요')

    const later = buildView(snapshot({ lastTurn: { reason: 'answer', endedAt: NOW - 276_000, durationMs: 3_000 } }))

    expect(later.headline.detail).toBe('4m 전 · 3s 소요')
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
