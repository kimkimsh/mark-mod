import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallInput } from 'claude-code'

import type { DashAgent, DashCall, DashCounts, DashTask, DashTokens, DashUsage } from '../types'
import {
  addTokens,
  agentsFromReading,
  buildView,
  emptyTokens,
  endedTaskIds,
  isAgentActive,
  isAskingTool,
  isTokensEmpty,
  tasksFromReading,
  usageFromReading,
  withKnownLimits,
  withTask,
  withoutConversation,
  withoutTask,
  withoutTasks,
} from './model'
import type { DashSnapshot, TaskReading, UsageCounts, UsageReading } from './model'
import { bandTree, paneTree } from './view'

const PANE_ID = 'mark-mod'

const PANE_TITLE = 'Session'

const COMMAND = 'dash'

const TICK_MS = 1000

// While nothing runs the stored clock moves in coarse steps, so an idle
// session costs one state write per step instead of one per tick.
const IDLE_CLOCK_STEP_MS = 30_000

// One $.store key per session: concurrent Claude processes share the store,
// and a single map rewritten by each of them would lose the others' saves.
const STORE_PREFIX = 'tokens:'

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

type SavedSession = { tokens: DashTokens; savedAt: number }

// The last usage written, kept outside $.state: after a /clear the session's
// values start empty, and the rate-limit windows, which are the account's,
// would read "not measured" until the next response.
let lastUsage: DashUsage | null = null

async function writeUsage($: EngineInterface, reading: UsageReading): Promise<void> {
  const usage = await update($, usageAtom, previous => withKnownLimits(previous ?? lastUsage, usageFromReading(reading)))
  lastUsage = usage
}

const COUNT_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite']

function isCounts(value: unknown): value is DashCounts {
  return (
    value instanceof Object &&
    COUNT_FIELDS.every(field => Number.isFinite(Object.getOwnPropertyDescriptor(value, field)?.value))
  )
}

// $.store outlives this code: an entry another version wrote is dropped
// rather than trusted.
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

async function pruneSessions($: EngineInterface): Promise<void> {
  const keys = (await $.store.keys()).filter(key => key.startsWith(STORE_PREFIX))

  if (keys.length <= STORE_SESSIONS_KEPT) {
    return
  }

  const dated: { key: string; savedAt: number }[] = []

  for (const key of keys) {
    const saved = await $.store.get(key)
    dated.push({ key, savedAt: isSavedSession(saved) ? saved.savedAt : 0 })
  }

  dated.sort((a, b) => b.savedAt - a.savedAt)

  for (const stale of dated.slice(STORE_SESSIONS_KEPT)) {
    await $.store.delete(stale.key)
  }
}

async function saveTokens($: EngineInterface, sessionId: string): Promise<void> {
  const tokens = await read($, tokensAtom)

  if (isTokensEmpty(tokens)) {
    return
  }

  await $.store.set(STORE_PREFIX + sessionId, { tokens, savedAt: await $.clock.now() })
  await pruneSessions($)
}

let saveChain: Promise<void> = Promise.resolve()

// Saves run one after another, so a slower earlier save can never land after
// a later one and leave a smaller total in the store.
function queueSave($: EngineInterface, sessionId: string): Promise<void> {
  const save = saveChain.then(() => saveTokens($, sessionId))
  saveChain = save.catch(() => undefined)

  return save
}

async function seedTokens($: EngineInterface, sessionId: string): Promise<void> {
  if (!isTokensEmpty(await read($, tokensAtom))) {
    return
  }

  const saved = await $.store.get(STORE_PREFIX + sessionId)

  if (isSavedSession(saved)) {
    await update($, tokensAtom, current => (isTokensEmpty(current) ? saved.tokens : current))
  }
}

async function isAnythingRunning($: EngineInterface, agents: readonly DashAgent[]): Promise<boolean> {
  return (
    agents.some(agent => isAgentActive(agent.status)) ||
    (await read($, turnAtom)) !== null ||
    (await read($, asksAtom)).length > 0 ||
    (await read($, tasksAtom)).length > 0
  )
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

// The only writer of `live`; requestRefresh keeps it to one run at a time.
async function refreshLive($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  let listed: Awaited<ReturnType<EngineInterface['agent']['list']>> | null = null
  let listError: string | null = null

  try {
    listed = await $.agent.list()
  } catch (cause) {
    // Degrade to the last list and say so on screen; the next tick asks again.
    listError = errorText(cause)
  }

  const previous = await read($, liveAtom)
  const agents = listed === null ? previous.agents : agentsFromReading(listed, previous.agents, now)
  const clock = (await isAnythingRunning($, agents)) ? now : now - (now % IDLE_CLOCK_STEP_MS)
  const next = { now: clock, agents, listError }

  if (JSON.stringify(next) !== JSON.stringify(previous)) {
    await update($, liveAtom, () => next)
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
// $.agent.list() answered after a newer one must not overwrite it. Hooks
// never await this, so a slow list cannot hold up a turn.
function requestRefresh($: EngineInterface): void {
  if (refreshInFlight !== null) {
    isRefreshQueued = true

    return
  }

  refreshInFlight = drainRefreshes($).finally(() => {
    refreshInFlight = null
  })
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

function isAnswered<R extends { deny?: string; isError?: true }>(
  ran: R,
): ran is Exclude<R, { deny: string } | { isError: true }> {
  return ran.deny === undefined && ran.isError !== true
}

async function addTask($: EngineInterface, id: string, kind: string, description: string): Promise<void> {
  const task: DashTask = { id, kind, description, startedAt: await $.clock.now() }
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
  const agentIds = new Set((await read($, liveAtom)).agents.map(agent => agent.id))
  await update($, tasksAtom, tasks => tasksFromReading(readings, tasks, agentIds, now))
}

// What the turn record says; the band replaces isWorking with the engine's
// own AbovePrompt prop.
async function snapshotOf($: EngineInterface): Promise<DashSnapshot> {
  const [turn, asks, tasks, tokens, hasResponse, lastTurn, usage, live] = await Promise.all([
    read($, turnAtom),
    read($, asksAtom),
    read($, tasksAtom),
    read($, tokensAtom),
    read($, hasResponseAtom),
    read($, lastTurnAtom),
    read($, usageAtom),
    read($, liveAtom),
  ])

  return { isWorking: turn !== null, turn, asks, tasks, tokens, hasResponse, lastTurn, usage, live }
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

// Rate-limit windows are the account's and stay; everything that belongs to
// the conversation starts over.
async function resetConversation($: EngineInterface): Promise<void> {
  await update($, tokensAtom, () => emptyTokens())
  await update($, turnAtom, () => null)
  await update($, asksAtom, () => [])
  await update($, lastTurnAtom, () => null)
  await update($, hasResponseAtom, () => false)
  await update($, usageAtom, usage => (usage === null ? usage : withoutConversation(usage)))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'Open or close the session dashboard pane' })
    await refreshLive($)
    $.clock.every(TICK_MS, () => {
      requestRefresh($)
    })
    await seedTokens($, await $.session.id())
    await writeUsage($, await $.session.usage())

    return next(e)
  })

  // /clear and an in-process /resume end one conversation and go on under
  // another id, with no session.start: the ending one is saved and cleared
  // here, and classic.SessionStart loads the next.
  on('session.end', async ($, e, next) => {
    await queueSave($, e.sessionId)

    if (e.reason === 'clear' || e.reason === 'resume') {
      await resetConversation($)
    }

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    await seedTokens($, e.session_id)
    await update($, usageAtom, usage => usage ?? (lastUsage === null ? null : withoutConversation(lastUsage)))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await writeUsage($, e)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const startedAt = await $.clock.now()
    await update($, turnAtom, () => ({ turnId: e.turnId, startedAt, calls: [] }))
    requestRefresh($)

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

    void queueSave($, await $.session.id())
    requestRefresh($)

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

    if (isAnswered(ran) && ran.result.backgroundTaskId !== undefined) {
      await addTask($, ran.result.backgroundTaskId, 'shell', e.description ?? e.command)
    }

    return ran
  })

  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const ran = await next(e)

    if (isAnswered(ran)) {
      await addTask($, ran.result.taskId, 'monitor', e.description)
    }

    return ran
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const ran = await next(e)

    if (isAnswered(ran)) {
      await addTask($, ran.result.taskId, 'workflow', ran.result.workflowName ?? e.name ?? 'workflow')
    }

    return ran
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)

    if (isAnswered(ran) && 'taskId' in ran.result && ran.result.status === 'remote_launched') {
      await addTask($, ran.result.taskId, 'remote', e.description)
    }

    requestRefresh($)

    return ran
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)

    if (isAnswered(ran)) {
      const stopped = ran.result.task_id
      await update($, tasksAtom, tasks => withoutTask(tasks, stopped))
    }

    requestRefresh($)

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)

    if (e.origin.kind === 'task-notification') {
      const ended = endedTaskIds(e.text)
      await update($, tasksAtom, tasks => withoutTasks(tasks, ended))
      requestRefresh($)
    }

    return entered
  })

  on('classic.Stop', async ($, e, next) => {
    await reconcileTasks($, e.background_tasks)

    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await reconcileTasks($, e.background_tasks)
    requestRefresh($)

    return next(e)
  })

  on('classic.SubagentStart', ($, e, next) => {
    requestRefresh($)

    return next(e)
  })

  on('classic.TeammateIdle', ($, e, next) => {
    requestRefresh($)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const waiting = await togglePane($)

    return waiting === null ? {} : { text: `The session pane is waiting for room: ${waiting}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const kit = $.ui.resolve(e)
    const { Button } = kit
    // The engine knows whether a main turn runs; the turn record may have
    // missed its end.
    const view = buildView({ ...(await snapshotOf($)), isWorking: e.props.isWorking })

    const trailing = (
      <Button
        key={COMMAND}
        plain
        dimColor
        label={`/${COMMAND}`}
        onPress={() => {
          void togglePane($)
        }}
      />
    )

    return bandTree(kit, view, e.props.bodyColumns, e.props.maxRows, trailing)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const view = buildView(await snapshotOf($))

    return paneTree($.ui.resolve(e), view, e.props.bodyColumns)
  })
}
