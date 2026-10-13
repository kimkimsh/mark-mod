import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallInput } from 'claude-code'

import type { DashCall, DashCounts, DashLive, DashTask, DashTokens } from '../types'
import {
  addTokens,
  agentsFromReading,
  buildView,
  emptyTokens,
  isAgentActive,
  isAskingTool,
  isTokensEmpty,
  parseTaskNotificationId,
  tasksFromReading,
  usageFromReading,
  withKnownLimits,
  withTask,
  withoutTask,
} from './model'
import type { DashSnapshot, TaskReading, UsageCounts } from './model'
import { bandTree, paneTree } from './view'

const PANE_ID = 'mark-mod'

const PANE_TITLE = '세션 현황'

const COMMAND = 'dash'

const TICK_MS = 1000

// While nothing runs the stored clock moves in coarse steps, so an idle
// session costs one state write per step instead of one per tick.
const IDLE_CLOCK_STEP_MS = 30_000

const LIVE_WRITE_ATTEMPTS = 3

const STORE_KEY = 'sessions'

const STORE_SESSIONS_KEPT = 30

// Every $.state reference spells its plugin and key as literals: the
// validator reads them from source and refuses a computed one.
const turnAtom = atom({ plugin: 'mark-mod', key: 'turn' } as const, null)

const asksAtom = atom({ plugin: 'mark-mod', key: 'asks' } as const, [])

const tasksAtom = atom({ plugin: 'mark-mod', key: 'tasks' } as const, [])

const tokensAtom = atom({ plugin: 'mark-mod', key: 'tokens' } as const, emptyTokens())

const hasResponseAtom = atom({ plugin: 'mark-mod', key: 'hasResponse' } as const, false)

const lastTurnAtom = atom({ plugin: 'mark-mod', key: 'lastTurn' } as const, null)

const usageAtom = atom({ plugin: 'mark-mod', key: 'usage' } as const, null)

const liveAtom = atom({ plugin: 'mark-mod', key: 'live' } as const, { now: 0, agents: [], listError: null })

const liveRef = { plugin: 'mark-mod', key: 'live' } as const

type SavedSession = { tokens: DashTokens; savedAt: number }

type SavedSessions = Record<string, SavedSession>

const COUNT_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite']

function isCounts(value: unknown): value is DashCounts {
  return (
    value instanceof Object &&
    COUNT_FIELDS.every(field => Number.isFinite(Object.getOwnPropertyDescriptor(value, field)?.value))
  )
}

function isSavedSession(value: unknown): value is SavedSession {
  if (!(value instanceof Object)) {
    return false
  }

  const tokens = Object.getOwnPropertyDescriptor(value, 'tokens')?.value

  return (
    Number.isFinite(Object.getOwnPropertyDescriptor(value, 'savedAt')?.value) &&
    tokens instanceof Object &&
    isCounts(Object.getOwnPropertyDescriptor(tokens, 'main')?.value) &&
    isCounts(Object.getOwnPropertyDescriptor(tokens, 'agents')?.value)
  )
}

// $.store outlives this code: a value an older version wrote is dropped
// rather than trusted.
function isSavedSessions(value: unknown): value is SavedSessions {
  return value instanceof Object && !Array.isArray(value) && Object.values(value).every(isSavedSession)
}

async function loadSessions($: EngineInterface): Promise<SavedSessions> {
  const stored = await $.store.get(STORE_KEY)

  return isSavedSessions(stored) ? stored : {}
}

async function saveTokens($: EngineInterface, sessionId: string): Promise<void> {
  const tokens = await read($, tokensAtom)

  if (isTokensEmpty(tokens)) {
    return
  }

  const sessions = await loadSessions($)

  const kept = Object.entries(sessions)
    .filter(([id]) => id !== sessionId)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, STORE_SESSIONS_KEPT - 1)

  const next: SavedSessions = Object.fromEntries(kept)
  next[sessionId] = { tokens, savedAt: await $.clock.now() }
  await $.store.set(STORE_KEY, next)
}

async function seedTokens($: EngineInterface): Promise<void> {
  if (!isTokensEmpty(await read($, tokensAtom))) {
    return
  }

  const saved = (await loadSessions($))[await $.session.id()]

  if (saved !== undefined) {
    await update($, tokensAtom, current => (isTokensEmpty(current) ? saved.tokens : current))
  }
}

async function isAnythingRunning($: EngineInterface, live: DashLive): Promise<boolean> {
  return (
    live.agents.some(agent => isAgentActive(agent.status)) ||
    (await read($, turnAtom)) !== null ||
    (await read($, asksAtom)).length > 0 ||
    (await read($, tasksAtom)).length > 0
  )
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function refreshLive($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  let listed: Awaited<ReturnType<EngineInterface['agent']['list']>> | null = null
  let listError: string | null = null

  try {
    listed = await $.agent.list()
  } catch (error) {
    // Degrade to the last list and say so on screen; the next tick asks again.
    listError = errorText(error)
  }

  for (let attempt = 0; attempt < LIVE_WRITE_ATTEMPTS; attempt += 1) {
    const held = await $.state.get(liveRef)
    const previous = held.value ?? liveAtom.initial
    const agents = listed === null ? previous.agents : agentsFromReading(listed, previous.agents, now)
    const draft: DashLive = { now, agents, listError }
    const clock = (await isAnythingRunning($, draft)) ? now : now - (now % IDLE_CLOCK_STEP_MS)
    const next: DashLive = { now: clock, agents, listError }

    if (JSON.stringify(next) === JSON.stringify(previous)) {
      return
    }

    const written = await $.state.set(liveRef, next, { ifVersion: held.version })

    if (written.isSet) {
      return
    }
  }
}

let refreshInFlight: Promise<void> | null = null

let isRefreshQueued = false

async function drainRefreshes($: EngineInterface): Promise<void> {
  do {
    isRefreshQueued = false
    await refreshLive($)
  } while (isRefreshQueued)
}

// One pull at a time: the ticker and the event hooks both ask, and a slow
// $.agent.list() answered after a newer one must not overwrite it.
function requestRefresh($: EngineInterface): Promise<void> {
  if (refreshInFlight !== null) {
    isRefreshQueued = true

    return refreshInFlight
  }

  refreshInFlight = drainRefreshes($).finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

async function addCall($: EngineInterface, e: ToolCallInput): Promise<DashCall> {
  const call: DashCall = { id: e.tool_use_id, tool: e.tool, startedAt: await $.clock.now() }

  if (isAskingTool(e.tool)) {
    await update($, asksAtom, asks => [...asks, call])
  }

  if (e.agentId === undefined) {
    await update($, turnAtom, turn => (turn === null ? turn : { ...turn, calls: [...turn.calls, call] }))
  }

  return call
}

async function removeCall($: EngineInterface, call: DashCall, isMainLoop: boolean): Promise<void> {
  if (isAskingTool(call.tool)) {
    await update($, asksAtom, asks => asks.filter(ask => ask.id !== call.id))
  }

  if (isMainLoop) {
    await update($, turnAtom, turn =>
      turn === null ? turn : { ...turn, calls: turn.calls.filter(one => one.id !== call.id) },
    )
  }
}

async function addTask($: EngineInterface, id: string, kind: string, label: string): Promise<void> {
  const task: DashTask = { id, kind, label, startedAt: await $.clock.now() }
  await update($, tasksAtom, tasks => withTask(tasks, task))
}

async function addStepUsage($: EngineInterface, usage: UsageCounts, isMainLoop: boolean): Promise<void> {
  await update($, tokensAtom, tokens => addTokens(tokens, usage, isMainLoop))

  if (!(await read($, hasResponseAtom))) {
    await update($, hasResponseAtom, () => true)
  }
}

async function reconcileTasks($: EngineInterface, readings: readonly TaskReading[] | undefined): Promise<void> {
  // An absent list means this build reports none, not that nothing runs.
  if (readings === undefined) {
    return
  }

  const now = await $.clock.now()
  await update($, tasksAtom, tasks => tasksFromReading(readings, tasks, now))
}

async function snapshotOf($: EngineInterface, isWorking: boolean | null): Promise<DashSnapshot> {
  const turn = await read($, turnAtom)

  return {
    isWorking: isWorking ?? turn !== null,
    turn,
    asks: await read($, asksAtom),
    tasks: await read($, tasksAtom),
    tokens: await read($, tokensAtom),
    hasResponse: await read($, hasResponseAtom),
    lastTurn: await read($, lastTurnAtom),
    usage: await read($, usageAtom),
    live: await read($, liveAtom),
  }
}

async function togglePane($: EngineInterface): Promise<string | null> {
  const panes = await $.ui.panes()

  if (panes.some(pane => pane.id === PANE_ID)) {
    await $.ui.close({ id: PANE_ID })

    return null
  }

  const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE })

  return opened.isPlaced ? null : opened.reason
}

async function resetConversation($: EngineInterface): Promise<void> {
  await update($, tokensAtom, () => emptyTokens())
  await update($, turnAtom, () => null)
  await update($, asksAtom, () => [])
  await update($, lastTurnAtom, () => null)
  await update($, hasResponseAtom, () => false)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: '세션 현황 패널을 열거나 닫습니다' })
    $.clock.every(TICK_MS, () => {
      void requestRefresh($)
    })
    await requestRefresh($)
    await seedTokens($)
    const usage = await $.session.usage()
    await update($, usageAtom, previous => withKnownLimits(previous, usageFromReading(usage)))

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await saveTokens($, e.sessionId)

    if (e.reason === 'clear') {
      await resetConversation($)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, usageAtom, previous => withKnownLimits(previous, usageFromReading(e)))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const startedAt = await $.clock.now()
    await update($, turnAtom, () => ({ turnId: e.turnId, startedAt, calls: [] }))
    await requestRefresh($)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)

    if (step.usage !== null) {
      await addStepUsage($, step.usage, e.agentId === undefined)
    }

    return step
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const endedAt = await $.clock.now()
      await update($, turnAtom, () => null)
      await update($, asksAtom, () => [])
      await update($, lastTurnAtom, () => ({ reason: e.reason, endedAt, durationMs: e.durationMs }))
    }

    await saveTokens($, await $.session.id())

    await requestRefresh($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const call = await addCall($, e)

    try {
      return await next(e)
    } finally {
      await removeCall($, call, e.agentId === undefined)
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true && ran.result.backgroundTaskId !== undefined) {
      await addTask($, ran.result.backgroundTaskId, 'shell', e.description ?? e.command)
    }

    return ran
  })

  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true) {
      await addTask($, ran.result.taskId, 'monitor', e.description)
    }

    return ran
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true) {
      await addTask($, ran.result.taskId, 'workflow', ran.result.workflowName ?? e.name ?? 'workflow')
    }

    return ran
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true && 'taskId' in ran.result && ran.result.status === 'remote_launched') {
      await addTask($, ran.result.taskId, 'remote', e.description)
    }

    await requestRefresh($)

    return ran
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true) {
      const stopped = ran.result.task_id
      await update($, tasksAtom, tasks => withoutTask(tasks, stopped))
    }

    await requestRefresh($)

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)

    if (e.origin.kind === 'task-notification') {
      const id = parseTaskNotificationId(e.text)

      if (id !== null) {
        await update($, tasksAtom, tasks => withoutTask(tasks, id))
      }

      await requestRefresh($)
    }

    return entered
  })

  on('classic.Stop', async ($, e, next) => {
    await reconcileTasks($, e.background_tasks)

    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await reconcileTasks($, e.background_tasks)
    await requestRefresh($)

    return next(e)
  })

  on('classic.SubagentStart', async ($, e, next) => {
    await requestRefresh($)

    return next(e)
  })

  on('classic.TeammateIdle', async ($, e, next) => {
    await requestRefresh($)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const waiting = await togglePane($)

    return waiting === null ? {} : { text: `세션 현황 패널이 자리를 기다립니다: ${waiting}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const kit = $.ui.resolve(e)
    const { Button } = kit
    const view = buildView(await snapshotOf($, e.props.isWorking))

    const trailing = (
      <Button
        key="dash"
        plain
        dimColor
        label="/dash"
        onPress={() => {
          void togglePane($)
        }}
      />
    )

    return bandTree(kit, view, e.props.bodyColumns, e.props.maxRows, trailing)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const view = buildView(await snapshotOf($, null))

    return paneTree($.ui.resolve(e), view, e.props.bodyColumns)
  })
}
