import { describe, expect, test } from 'claude-code/testing'

import type { DashCall, DashLive, DashTask, DashTurnEnd } from '../types'
import {
  activityOf,
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
  modelDetailText,
  modelFamily,
  modelName,
  newTurn,
  paneListingArgv,
  paneRosterFromText,
  rosterPath,
  tasksStillRead,
  usageFromReading,
  withAgentActivity,
  withAgentCallEnded,
  withAgentContext,
  withAnsweredModel,
  withEdit,
  withKnownLimits,
  withRequest,
  withSpawn,
  withSpawnModel,
  withoutAgentEntries,
} from '../hooks/model'
import type { DashSnapshot, ToolArgs } from '../hooks/model'

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
    agentWork: {},
    mainModel: null,
    compactions: 0,
    ...overrides,
  }
}

const RUNNING_TURN = newTurn('t1', NOW - 72_000)

const NO_ARGS: ToolArgs = { path: null, command: null, description: null, url: null, skill: null }

function call(id: string, tool: string, activity: string, startedAt: number): DashCall {
  return { id, tool, startedAt, activity }
}

function turnEnd(reason: DashTurnEnd['reason'], endedAt: number, editedFiles: number, subagentsStarted: number): DashTurnEnd {
  return { reason, endedAt, durationMs: 192_000, editedFiles, subagentsStarted }
}

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

  test('durations shorten as they grow, a space between the units', () => {
    expect(formatDuration(-5)).toBe('0s')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(72_000)).toBe('1m 12s')
    expect(formatDuration(245_000)).toBe('4m 05s')
    expect(formatDuration(12 * 60_000)).toBe('12m')
    expect(formatDuration((2 * 60 + 14) * 60_000)).toBe('2h 14m')
    expect(formatDuration((2 * 60 + 5) * 60_000)).toBe('2h 05m')
    expect(formatDuration((3 * 24 + 4) * 3_600_000)).toBe('3d 4h')
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
    expect(buildView(snapshot({ tokens })).tokens).toMatchObject({ hasTokens: true, totalText: '20', mainText: '10', agentsText: '10' })
  })

  test('cost shows once something was spent, never as $0.00', () => {
    const usage = { contextTokens: null, contextWindow: 200_000, contextPercent: null, limits: [], costUsd: 0 }

    expect(buildView(snapshot({})).tokens).toMatchObject({ hasTokens: false, costText: null })
    expect(buildView(snapshot({ usage })).tokens.costText).toBeNull()
    expect(buildView(snapshot({ usage: { ...usage, costUsd: 0.19 } })).tokens.costText).toBe('$0.19')
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
    expect(modelFamily('claude-haiku-4-5@20251001')).toBe('haiku')
    expect(modelFamily('haiku')).toBe('haiku')
    expect(modelFamily('opus[1m]')).toBe('opus')
    expect(modelFamily('gpt-x')).toBe('gpt-x')
  })

  test('a model reads by the name a person knows it by, whichever provider wrote the id', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(modelName('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(modelName('claude-haiku-4-5@20251001')).toBe('Haiku 4.5')
    expect(modelName('us.anthropic.claude-sonnet-5-5-v1:0')).toBe('Sonnet 5.5')
    expect(modelName('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('Sonnet 3.5')
    expect(modelName('haiku')).toBe('haiku')
    expect(modelName('gpt-x')).toBe('gpt-x')
  })

  test('effort is a level or an integer budget, and reads as one', () => {
    expect(effortLabel('low')).toBe('low')
    expect(effortLabel(16_000)).toBe('16k')
    expect(effortLabel(undefined)).toBeNull()
    expect(modelDetailText({ model: 'claude-haiku-5-5', effort: 'medium' })).toBe('Haiku 5.5, medium effort')
    expect(modelDetailText({ model: 'claude-haiku-5-5', effort: '16k' })).toBe('Haiku 5.5, 16k thinking budget')
    expect(modelDetailText({ model: 'claude-haiku-5-5', effort: null })).toBe('Haiku 5.5')
    expect(modelDetailText(null)).toBe('')
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

    expect(withoutAgentEntries(models, ['a'])).toEqual({ b: { model: 'm', effort: null } })
    expect(withoutAgentEntries(models, ['c'])).toBe(models)
  })

  test('a worker row carries its agent\'s model, effort, last activity and context', () => {
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
        agentWork: { a: { activity: 'reading model.ts', callId: 'c1', contextTokens: 48_000 } },
      }),
    )

    expect(view.subagents.map(worker => worker.modelText)).toEqual(['haiku, low effort', ''])
    expect(view.subagents[0]).toMatchObject({
      modelFamily: 'haiku',
      modelDetailText: 'Haiku 5.5, low effort',
      activityText: 'reading model.ts',
      contextText: '48k context',
    })
    expect(view.subagents[1]).toMatchObject({ activityText: '', contextText: '' })
    expect(view.teammates[0]?.modelText).toBe('opus')
  })

  test('the session\'s own model reads in full, and is absent until a request names one', () => {
    expect(buildView(snapshot({ mainModel: { model: 'claude-opus-5-5[1m]', effort: 'high' } })).modelText).toBe('Opus 5.5, high effort')
    expect(buildView(snapshot({})).modelText).toBeNull()
  })
})

describe('agent work', () => {
  const usage = { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 7_000 }

  test('only the call that set an agent\'s activity clears it', () => {
    const working = withAgentActivity({}, 'a', 'c1', 'editing view.tsx')

    expect(withAgentCallEnded(working, 'a', 'c2')).toBe(working)
    expect(withAgentCallEnded(working, 'b', 'c1')).toBe(working)
    expect(withAgentCallEnded(working, 'a', 'c1')).toEqual({ a: { activity: null, callId: null, contextTokens: null } })
  })

  test('context is the latest response\'s input side, and an unchanged one is no write', () => {
    const measured = withAgentContext({}, 'a', usage)

    expect(measured.a?.contextTokens).toBe(48_000)
    expect(withAgentContext(measured, 'a', { ...usage, output_tokens: 9 })).toBe(measured)
  })

  test('a new activity keeps the context already measured', () => {
    const measured = withAgentContext({}, 'a', usage)

    expect(withAgentActivity(measured, 'a', 'c1', 'reading a.ts').a).toEqual({ activity: 'reading a.ts', callId: 'c1', contextTokens: 48_000 })
  })
})

describe('activity', () => {
  test('a file tool names its verb and the file', () => {
    expect(activityOf('Read', { ...NO_ARGS, path: '/w/plugins/view.tsx' })).toBe('reading view.tsx')
    expect(activityOf('Edit', { ...NO_ARGS, path: '/w/view.tsx' })).toBe('editing view.tsx')
    expect(activityOf('Write', { ...NO_ARGS, path: 'notes.md' })).toBe('writing notes.md')
    expect(activityOf('NotebookEdit', { ...NO_ARGS, path: '/w/a.ipynb' })).toBe('editing a.ipynb')
    expect(activityOf('Edit', { ...NO_ARGS, path: 'C:\\Users\\me\\proj\\view.tsx' })).toBe('editing view.tsx')
    expect(activityOf('Read', NO_ARGS)).toBe('using Read')
  })

  test('a short plain command is shown as it is; anything else by its description', () => {
    expect(activityOf('Bash', { ...NO_ARGS, command: 'npm test', description: 'Run the test suite.' })).toBe('running npm test')
    expect(activityOf('Bash', { ...NO_ARGS, command: 'npm ci && npm test', description: 'Install and run the tests.' })).toBe(
      'install and run the tests',
    )
    expect(activityOf('Bash', { ...NO_ARGS, command: 'git log --oneline --graph --decorate -20', description: 'Show history' })).toBe(
      'show history',
    )
    expect(activityOf('Bash', { ...NO_ARGS, command: 'npm ci | tee log', description: 'NPM install' })).toBe('NPM install')
    expect(activityOf('Bash', { ...NO_ARGS, command: 'cd /repo\nnpm test', description: 'Build and run the tests' })).toBe(
      'build and run the tests',
    )
  })

  test('a command without a description falls back to its first line, then to plain words', () => {
    expect(activityOf('Bash', { ...NO_ARGS, command: 'for f in *; do\n  echo $f\ndone' })).toBe('running for f in *; do')
    expect(activityOf('Bash', NO_ARGS)).toBe('running a command')
  })

  test('other tools read by what they reach', () => {
    expect(activityOf('WebFetch', { ...NO_ARGS, url: 'https://docs.example.com/a?b=1' })).toBe('fetching docs.example.com')
    expect(activityOf('WebFetch', { ...NO_ARGS, url: 'https://ghp_abc123@github.com/org/repo' })).toBe('fetching github.com')
    expect(activityOf('WebFetch', { ...NO_ARGS, url: 'https://user:pw@host.example/x' })).toBe('fetching host.example')
    expect(activityOf('WebFetch', { ...NO_ARGS, url: 'not a url' })).toBe('using WebFetch')
    expect(activityOf('Skill', { ...NO_ARGS, skill: 'verify' })).toBe('using the verify skill')
    expect(activityOf('mcp__claude_ai_Gmail__send_message', NO_ARGS)).toBe('using claude_ai_Gmail')
    expect(activityOf('WebSearch', NO_ARGS)).toBe('searching the web')
    expect(activityOf('Agent', NO_ARGS)).toBe('running a subagent')
    expect(activityOf('LSP', NO_ARGS)).toBe('using LSP')
  })

  test('a long activity is kept short', () => {
    const activity = activityOf('Bash', { ...NO_ARGS, command: 'a && b', description: 'x'.repeat(200) })

    expect(cellWidth(activity)).toBeLessThanOrEqual(80)
    expect(activity.endsWith('…')).toBe(true)
  })
})

describe('reply receipt', () => {
  test('a file edited twice counts once', () => {
    const turn = withEdit(withEdit(withEdit(RUNNING_TURN, undefined, '/a'), undefined, '/a'), undefined, '/b')

    expect(turn?.editedPaths).toEqual(['/a', '/b'])
    expect(withEdit(null, undefined, '/a')).toBeNull()
  })

  test('an agent this turn started counts its edits; one from an earlier turn does not', () => {
    const started = withSpawn(RUNNING_TURN, 'a1', undefined, true)

    expect(withEdit(started, 'a1', '/c')?.editedPaths).toEqual(['/c'])
    expect(withEdit(started, 'old', '/d')).toBe(started)
  })

  test('subagents count once each, nested ones included; teammates, workflow agents and strangers not', () => {
    const one = withSpawn(RUNNING_TURN, 'a1', undefined, true)
    const nested = withSpawn(one, 'a2', 'a1', true)

    expect(nested?.agentIds).toEqual(['a1', 'a2'])
    expect(withSpawn(nested, 'a2', 'a1', true)).toBe(nested)
    expect(withSpawn(nested, 'a3', 'stranger', true)).toBe(nested)
    expect(withSpawn(nested, 'mate@team', undefined, false)).toBe(nested)
    expect(withSpawn(null, 'a1', undefined, true)).toBeNull()
  })
})

describe('headline', () => {
  test('a question to the person outranks everything', () => {
    const view = buildView(
      snapshot({
        isWorking: true,
        turn: RUNNING_TURN,
        asks: [call('q', 'AskUserQuestion', 'asking you a question', NOW - 5_000)],
      }),
    )

    expect(view.headline).toEqual({ phase: 'needs-input', title: 'Needs your answer', detail: ['waiting 5s'] })
  })

  test('plan approval reads as its own wait', () => {
    const view = buildView(snapshot({ asks: [call('p', 'ExitPlanMode', 'presenting a plan', NOW)] }))

    expect(view.headline.title).toBe('Needs your plan approval')
  })

  test('a running turn names what its tools are doing, and nothing between them', () => {
    const calls = [call('1', 'Bash', 'running npm test', NOW), call('2', 'Read', 'reading model.ts', NOW)]

    expect(buildView(snapshot({ isWorking: true, turn: RUNNING_TURN })).headline).toEqual({
      phase: 'working',
      title: 'Working',
      detail: [],
    })
    expect(buildView(snapshot({ isWorking: true, turn: { ...RUNNING_TURN, calls: calls.slice(0, 1) } })).headline.detail).toEqual([
      'running npm test',
    ])
    expect(buildView(snapshot({ isWorking: true, turn: { ...RUNNING_TURN, calls } })).headline.detail).toEqual([
      'running npm test and 1 more',
    ])
  })

  test('the engine saying a turn runs is enough, even with no turn record', () => {
    expect(buildView(snapshot({ isWorking: true })).headline.phase).toBe('working')
  })

  test('an idle main loop counts what it waits on, in the engine\'s own words', () => {
    const live: DashLive = {
      now: NOW,
      agents: [
        { id: 'a', label: 'Explore', description: 'x', status: 'running', isTeammate: false, isNested: false, firstSeenAt: NOW },
        { id: 'b', label: 'scout', description: 'y', status: 'idle', isTeammate: true, isNested: false, firstSeenAt: NOW },
      ],
      listError: null,
    }

    const tasks: DashTask[] = [{ id: 'sh', kind: 'shell', description: 'npm test', startedAt: NOW, endsBy: null }]

    expect(buildView(snapshot({ live })).headline.title).toBe('Waiting on 1 subagent')
    expect(buildView(snapshot({ live, tasks })).headline.title).toBe('Waiting on 1 subagent and 1 shell')
    expect(buildView(snapshot({ tasks })).headline).toEqual({ phase: 'waiting', title: 'Waiting on 1 shell', detail: [] })
  })

  test('every kind of work joins one list', () => {
    const agent = { label: 'Explore', description: 'x', status: 'running', isTeammate: false, isNested: false, firstSeenAt: NOW } as const

    const live: DashLive = {
      now: NOW,
      agents: [
        { ...agent, id: 'a' },
        { ...agent, id: 'b' },
        { ...agent, id: 'c', isTeammate: true },
      ],
      listError: null,
    }

    const tasks: DashTask[] = [
      { id: 'm', kind: 'monitor', description: 'watch CI', startedAt: NOW, endsBy: null },
      { id: 'w', kind: 'workflow', description: 'sweep', startedAt: NOW, endsBy: null },
      { id: 'o', kind: 'other', description: 'odd', startedAt: NOW, endsBy: null },
    ]

    expect(buildView(snapshot({ live, tasks })).headline.title).toBe(
      'Waiting on 2 subagents, 1 teammate, 1 monitor, 1 workflow and 1 background task',
    )
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

  test('how the last turn ended decides the resting state, and what it did follows', () => {
    const ended = (reason: DashTurnEnd['reason']) => buildView(snapshot({ lastTurn: turnEnd(reason, NOW - 120_000, 3, 1) }))

    expect(ended('answer').headline).toEqual({ phase: 'done', title: 'Done', detail: ['2m ago', 'edited 3 files', 'used 1 subagent'] })
    expect(ended('answer').lastReplyText).toBe('2m ago, took 3m 12s, edited 3 files, used 1 subagent')
    expect(ended('aborted').headline.title).toBe('Interrupted')
    expect(ended('error').headline).toMatchObject({ phase: 'error', title: 'Ended with an error' })
    expect(ended('refusal').headline.title).toBe('Refused')
    expect(buildView(snapshot({})).headline.title).toBe('Ready')
    expect(buildView(snapshot({})).lastReplyText).toBeNull()
  })

  test('a reply that changed nothing says only when it ended', () => {
    const view = buildView(snapshot({ lastTurn: turnEnd('answer', NOW - 120_000, 1, 0) }))

    expect(view.headline.detail).toEqual(['2m ago', 'edited 1 file'])
    expect(buildView(snapshot({ lastTurn: turnEnd('answer', NOW - 120_000, 0, 0) })).headline.detail).toEqual(['2m ago'])
  })

  test('a recent end reads as just now, never as invented seconds', () => {
    expect(buildView(snapshot({ lastTurn: turnEnd('answer', NOW - 14_000, 0, 0) })).headline.detail).toEqual(['just now'])
    expect(buildView(snapshot({ lastTurn: turnEnd('answer', NOW - 276_000, 0, 0) })).headline.detail).toEqual(['4m ago'])
    expect(buildView(snapshot({ lastTurn: turnEnd('answer', NOW - 8_040_000, 0, 0) })).headline.detail).toEqual(['2h 14m ago'])
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

    expect(context).toMatchObject({ leftPercent: 54, valueText: '54% left', noteText: '92k of 200k used', severity: 'ok', isMeasured: true })
    expect(fiveHour).toMatchObject({ label: '5-hour', leftPercent: 76.5, valueText: '76% left', noteText: 'resets in 2h 14m' })
    expect(weekly).toMatchObject({ label: 'Weekly', valueText: 'reset', leftPercent: null, isMeasured: true })
  })

  test('nearly spent limits turn to warning and danger', () => {
    const hot = { ...usage, limits: [{ kind: 'five_hour', percentUsed: 70, resetsAt: null }, { kind: 'seven_day', percentUsed: 90, resetsAt: null }] }
    const [, fiveHour, weekly] = buildView(snapshot({ usage: hot, hasResponse: true })).meters

    expect(fiveHour?.severity).toBe('warn')
    expect(weekly?.severity).toBe('danger')
  })

  test('no reading before the first response, no data after it', () => {
    const empty = { ...usage, limits: [] }

    expect(buildView(snapshot({ usage: empty })).meters[1]).toMatchObject({
      valueText: 'not measured yet',
      isAvailable: true,
      isMeasured: false,
    })

    const after = buildView(snapshot({ usage: empty, hasResponse: true }))

    expect(after.meters[1]).toMatchObject({ valueText: 'no data', isAvailable: false })
    expect(after.limitsNote).not.toBeNull()
  })

  test('context reads as room left, unmeasured context as not yet measured', () => {
    expect(buildView(snapshot({})).meters[0]).toMatchObject({ valueText: 'not measured yet', leftPercent: null, isMeasured: false, noteText: '' })
    expect(buildView(snapshot({ usage: { ...usage, contextTokens: null, contextPercent: null } })).meters[0]?.noteText).toBe('200k window')
  })

  test('the context note counts compactions once there are any', () => {
    const noteWith = (compactions: number) => buildView(snapshot({ usage, compactions })).meters[0]?.noteText

    expect(noteWith(1)).toBe('92k of 200k used, compacted once')
    expect(noteWith(2)).toBe('92k of 200k used, compacted twice')
    expect(noteWith(5)).toBe('92k of 200k used, compacted 5 times')
    expect(buildView(snapshot({ compactions: 1 })).meters[0]?.noteText).toBe('compacted once')
  })

  test('a reading without windows keeps the last known ones', () => {
    const next = withKnownLimits(usage, { ...usage, limits: [], costUsd: null })

    expect(next.limits).toEqual(limits)
    expect(next.costUsd).toBeNull()
    expect(withKnownLimits(null, { ...usage, limits: [] }).limits).toEqual([])
  })

  test('a window spent faster than it resets warns before the percentage would', () => {
    const fiveHour = { kind: 'five_hour', percentUsed: 47, resetsAt: NOW + 199 * 60_000 }
    const early = { kind: 'five_hour', percentUsed: 30, resetsAt: NOW + (5 * 60 - 10) * 60_000 }
    const steady = { kind: 'seven_day', percentUsed: 10, resetsAt: NOW + 5 * 86_400_000 }

    expect(Math.round((exhaustsBeforeReset(fiveHour, NOW) ?? 0) / 60_000)).toBe(114)
    expect(exhaustsBeforeReset(early, NOW)).toBeNull()
    expect(exhaustsBeforeReset(steady, NOW)).toBeNull()

    const [, meter] = buildView(snapshot({ usage: { ...usage, limits: [fiveHour] }, hasResponse: true })).meters

    expect(meter).toMatchObject({ severity: 'warn', noteText: 'runs out in 1h 53m at this pace' })
  })

  test('display width counts Hangul as two cells', () => {
    expect(cellWidth('5시간 47%')).toBe(9)
    expect(clipCells('서브에이전트 작업', 9)).toBe('서브에이…')
    expect(clipCells('short', 9)).toBe('short')
  })

  test('an extra window the API reports is kept for the pane, under a readable name', () => {
    const extra = {
      ...usage,
      limits: [...limits, { kind: 'spend_limit', percentUsed: 10, resetsAt: null }, { kind: 'seven_day_opus', percentUsed: 4, resetsAt: null }],
    }

    const { meters } = buildView(snapshot({ usage: extra }))

    expect(meters.map(meter => meter.key)).toEqual(['context', 'five_hour', 'seven_day', 'spend_limit', 'seven_day_opus'])
    expect(meters.map(meter => meter.label).slice(3)).toEqual(['Spend limit', 'Seven day opus'])
  })
})
