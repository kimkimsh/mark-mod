import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, ToolCallInput, ToolCallResult, UiScrollInput } from 'claude-code'

import type {
  DashAgent,
  DashAgentModel,
  DashAgentModels,
  DashAgentWorks,
  DashCall,
  DashCounts,
  DashLogTone,
  DashSpawns,
  DashTask,
  DashTokens,
  DashUsage,
} from '../types'
import {
  SESSION_ACTOR,
  activityOf,
  addTokens,
  agentActor,
  agentEndLines,
  agentsFromReading,
  buildView,
  callEndedText,
  callOutcomeTone,
  droppedTasks,
  editPathField,
  effortLabel,
  emptyTokens,
  endedTasks,
  isAgentActive,
  isAskingTool,
  isTaskOver,
  isTokensEmpty,
  livePaneIds,
  logWindow,
  newTurn,
  paneListingArgv,
  paneRosterFromText,
  promptLine,
  resumedText,
  rosterPath,
  rowBeforeMove,
  scrolledAnchor,
  spawnActor,
  spawnedName,
  startedText,
  taskActor,
  taskEndLine,
  tasksStillRead,
  turnEndLine,
  usageFromReading,
  withAgentActivity,
  withAgentCallEnded,
  withAgentContext,
  withAnsweredModel,
  withEdit,
  withKnownLimits,
  withLogLines,
  withRequest,
  withSpawn,
  withSpawnModel,
  withEndedPanes,
  withTask,
  withoutAgentEntries,
  withoutConversation,
  withoutTask,
  withoutTasks,
} from './model'
import type {
  AgentReading,
  CallOutcome,
  DashSnapshot,
  LogActor,
  LogLine,
  PaneCheck,
  PaneRoster,
  TaskReading,
  ToolArgs,
  UsageCounts,
  UsageReading,
} from './model'
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

// A Monitor result's timeoutMs when the monitor runs until stopped.
const PERSISTENT_MONITOR_TIMEOUT_MS = 0

// The tick waits on this, so a tmux that hangs cannot stall the band.
const TMUX_TIMEOUT_MS = 2_000

const DEFAULT_CONFIG_DIR = '.claude'

// Every $.state reference spells its plugin and key as literals: the
// validator reads them from source and refuses a computed one.
const turnAtom = atom({ plugin: 'mark-mod', key: 'mainTurn' } as const, null)

const asksAtom = atom({ plugin: 'mark-mod', key: 'openAsks' } as const, [])

const tasksAtom = atom({ plugin: 'mark-mod', key: 'tasks' } as const, [])

const tokensAtom = atom({ plugin: 'mark-mod', key: 'tokens' } as const, emptyTokens())

const hasResponseAtom = atom({ plugin: 'mark-mod', key: 'hasResponse' } as const, false)

const lastTurnAtom = atom({ plugin: 'mark-mod', key: 'lastReply' } as const, null)

const usageAtom = atom({ plugin: 'mark-mod', key: 'usage' } as const, null)

const liveAtom = atom({ plugin: 'mark-mod', key: 'live' } as const, { now: 0, agents: [], listError: null })

const agentModelsAtom = atom({ plugin: 'mark-mod', key: 'agentModels' } as const, {})

const agentWorkAtom = atom({ plugin: 'mark-mod', key: 'agentWork' } as const, {})

const mainModelAtom = atom({ plugin: 'mark-mod', key: 'mainModel' } as const, null)

const compactionsAtom = atom({ plugin: 'mark-mod', key: 'compactions' } as const, 0)

// Set when the person closes the pane, by /dash or the pane's own close; a
// later session.start (an enable, a worker respawn, a reload) then leaves it
// closed. A fresh process starts it false, so a new session opens the pane.
const paneClosedAtom = atom({ plugin: 'mark-mod', key: 'paneClosed' } as const, false)

const logAtom = atom({ plugin: 'mark-mod', key: 'activityLog' } as const, [])

const logAnchorAtom = atom({ plugin: 'mark-mod', key: 'logAnchor' } as const, null)

const spawnsAtom = atom({ plugin: 'mark-mod', key: 'spawns' } as const, {})

const endingTasksAtom = atom({ plugin: 'mark-mod', key: 'endingTasks' } as const, [])

const COMPACTED_TEXT = 'compacted the conversation'

// A pane drawing, for the scroll hook: its body's rows, the tree row its log
// starts at, how many entries the log shows, and the window offset it read.
type PaneLayout = { bodyRows: number; logTop: number; logRows: number; offset: number }

// One per surface the pane is drawn on, each its own size. `ui.scroll` names
// no surface, so a move is matched to a drawing by its body's rows.
const paneLayouts = new Map<RenderSurface, PaneLayout>()

// The engine's word on whether a main turn runs, as the band's props last
// carried it; null before the band is drawn. The pane has no such prop, and
// the turn record may have missed a turn's end.
let engineIsWorking: boolean | null = null

type SavedSession = { tokens: DashTokens; savedAt: number }

// The last usage written, kept outside $.state: after a /clear the session's
// values start empty, and the rate-limit windows, which are the account's,
// would read "not measured" until the next response.
let lastUsage: DashUsage | null = null

async function writeUsage($: EngineInterface, reading: UsageReading): Promise<void> {
  const previous = await read($, usageAtom)
  const usage = withKnownLimits(previous ?? lastUsage, usageFromReading(reading))
  lastUsage = usage

  if (JSON.stringify(usage) !== JSON.stringify(previous)) {
    await update($, usageAtom, () => usage)
  }
}

function fewestLogRows(): number | null {
  const rows = [...paneLayouts.values()].map(layout => layout.logRows)

  return rows.length === 0 ? null : Math.min(...rows)
}

// A held window that shows the newest entry anyway, as after the log card
// grew, follows again before more arrive; otherwise they would collect below
// a window the person never scrolled at its new size.
async function releaseShownAnchor($: EngineInterface): Promise<void> {
  const anchor = await read($, logAnchorAtom)
  const rows = fewestLogRows()

  if (anchor !== null && rows !== null && logWindow(await read($, logAtom), anchor, rows).newer === 0) {
    await update($, logAnchorAtom, () => null)
  }
}

async function appendLog($: EngineInterface, lines: readonly LogLine[]): Promise<void> {
  if (lines.length > 0) {
    await releaseShownAnchor($)
    await update($, logAtom, log => withLogLines(log, lines))
  }
}

async function logAs($: EngineInterface, actor: LogActor, text: string, tone: DashLogTone): Promise<void> {
  await appendLog($, [{ ...actor, at: await $.clock.now(), text, tone }])
}

// Removes tasks and logs each one that went, with the tone `toneOf` gives
// it. The list of those gone is taken from the update that wrote, so a task
// another hook removed meanwhile is not logged twice.
async function dropTasks(
  $: EngineInterface,
  remove: (tasks: DashTask[]) => DashTask[],
  toneOf: (task: DashTask) => DashLogTone,
): Promise<void> {
  const now = await $.clock.now()
  let dropped: DashTask[] = []

  await update($, tasksAtom, tasks => {
    const kept = remove(tasks)
    dropped = droppedTasks(tasks, kept)

    return kept
  })

  await appendLog(
    $,
    dropped.map(task => taskEndLine(task, toneOf(task), now)),
  )
}

// dropTasks for the tasks waiting on their notification.
async function dropEndingTasks(
  $: EngineInterface,
  remove: (tasks: DashTask[]) => DashTask[],
  toneOf: (task: DashTask) => DashLogTone,
): Promise<void> {
  const now = await $.clock.now()
  let dropped: DashTask[] = []

  await update($, endingTasksAtom, tasks => {
    const kept = remove(tasks)
    dropped = droppedTasks(tasks, kept)

    return kept
  })

  await appendLog(
    $,
    dropped.map(task => taskEndLine(task, toneOf(task), now)),
  )
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

// Where the engine keeps its teams: CLAUDE_CONFIG_DIR, or ~/.claude.
async function configDir($: EngineInterface): Promise<string | null> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')

  if (configured !== undefined && configured !== '') {
    return configured
  }

  const home = await $.env.get('HOME')

  return home === undefined ? null : `${home}/${DEFAULT_CONFIG_DIR}`
}

// A roster that cannot be read, as after the team is deleted, names no pane.
async function readRoster($: EngineInterface, path: string): Promise<PaneRoster> {
  try {
    return paneRosterFromText(await $.fs.read(path))
  } catch {
    return { leadPid: null, panes: new Map() }
  }
}

// null when tmux cannot be run, which says nothing about the panes. A server
// that is not running exits non-zero and has none: the engine's own exits
// with its last pane and leaves its socket file behind.
async function listPanes($: EngineInterface, argv: readonly string[]): Promise<string | null> {
  try {
    const ran = await $.process.run(argv, { timeoutMs: TMUX_TIMEOUT_MS })

    return ran.exitCode === 0 ? ran.stdout : ''
  } catch {
    return null
  }
}

// The working pane teammates whose pane is gone or dead, and those tmux could
// not be asked about; one roster read and one tmux call per team, and none
// while no pane teammate works.
async function checkPanes($: EngineInterface, agents: readonly AgentReading[]): Promise<PaneCheck> {
  const ended = new Set<string>()
  const unchecked = new Set<string>()
  const working = agents.flatMap(agent => (agent.teammateId !== undefined && isAgentActive(agent.status) ? [agent.teammateId] : []))

  if (working.length === 0) {
    return { ended, unchecked }
  }

  const dir = await configDir($)

  if (dir === null) {
    return { ended, unchecked }
  }

  const tmuxEnv = await $.env.get('TMUX')
  const rosters = new Map<string, string[]>()

  for (const teammateId of working) {
    const path = rosterPath(dir, teammateId)
    rosters.set(path, [...(rosters.get(path) ?? []), teammateId])
  }

  for (const [path, teammateIds] of rosters) {
    const roster = await readRoster($, path)
    const argv = paneListingArgv(tmuxEnv, roster.leadPid)

    const panes = teammateIds.flatMap(teammateId => {
      const paneId = roster.panes.get(teammateId)

      return paneId === undefined ? [] : [{ teammateId, paneId }]
    })

    if (argv === null || panes.length === 0) {
      continue
    }

    const listing = await listPanes($, argv)

    if (listing === null) {
      for (const pane of panes) {
        unchecked.add(pane.teammateId)
      }

      continue
    }

    const live = livePaneIds(listing)

    for (const pane of panes) {
      if (!live.has(pane.paneId)) {
        ended.add(pane.teammateId)
      }
    }
  }

  return { ended, unchecked }
}

// The only writer of `live`, of `usage` from the engine's reading, of a
// task's end by its deadline, and of an agent's leaving `agentModels` with
// the list; requestRefresh keeps it to one run at a time.
async function refreshLive($: EngineInterface): Promise<void> {
  const now = await $.clock.now()

  if ((await read($, tasksAtom)).some(task => isTaskOver(task, now))) {
    await dropTasks(
      $,
      tasks => tasks.filter(task => !isTaskOver(task, now)),
      () => 'plain',
    )
  }

  let listed: Awaited<ReturnType<EngineInterface['agent']['list']>> | null = null
  let listError: string | null = null

  try {
    listed = await $.agent.list()
  } catch (cause) {
    // Degrade to the last list and say so on screen; the next tick asks again.
    listError = errorText(cause)
  }

  const previous = await read($, liveAtom)
  const endedBefore = new Set(previous.agents.flatMap(agent => (agent.status === 'killed' ? [agent.id] : [])))
  const readings = listed === null ? null : withEndedPanes(listed, await checkPanes($, listed), endedBefore)
  const agents = readings === null ? previous.agents : agentsFromReading(readings, previous.agents, now)
  const spawned = new Set(Object.keys(await read($, spawnsAtom)))
  await appendLog($, agentEndLines(previous.agents, agents, spawned, now))

  // Only an agent the list named and no longer does: a teammate's model is
  // recorded at its spawn, which may come before the list names it.
  if (listed !== null) {
    const listedIds = new Set(listed.map(agent => agent.id))
    const gone = previous.agents.filter(agent => !listedIds.has(agent.id)).map(agent => agent.id)
    await changeAgentModels($, models => withoutAgentEntries(models, gone))
    await changeAgentWork($, work => withoutAgentEntries(work, gone))
    await changeSpawns($, spawns => withoutAgentEntries(spawns, gone))
  }

  const clock = (await isAnythingRunning($, agents)) ? now : now - (now % IDLE_CLOCK_STEP_MS)
  const next = { now: clock, agents, listError }

  if (JSON.stringify(next) !== JSON.stringify(previous)) {
    await update($, liveAtom, () => next)
  }

  // A compaction, manual or automatic, empties the context reading, and no
  // event this plugin is sure to receive says so: session.measure follows a
  // main-thread turn or a limit's move, and session.compact passes over a
  // plugin the person installed where an organization manages Claude Code.
  await writeUsage($, await $.session.usage())
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
// $.agent.list() answered after a newer one must not overwrite it. The
// promise settles once the pulls asked so far have run.
function sharedRefresh($: EngineInterface): Promise<void> {
  if (refreshInFlight !== null) {
    isRefreshQueued = true

    return refreshInFlight
  }

  refreshInFlight = drainRefreshes($).finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

// Event hooks never await a pull, so a slow list cannot hold up a turn.
function requestRefresh($: EngineInterface): void {
  void sharedRefresh($)
}

// A tool's arguments ride beside the envelope's own keys; only a string is
// worth wording an activity from.
function stringArg(e: ToolCallInput, name: string | null): string | null {
  const value: unknown = name === null ? undefined : Object.getOwnPropertyDescriptor(e, name)?.value

  return value === String(value) ? String(value) : null
}

function toolArgs(e: ToolCallInput): ToolArgs {
  return {
    path: stringArg(e, editPathField(e.tool)) ?? stringArg(e, 'file_path'),
    command: stringArg(e, 'command'),
    description: stringArg(e, 'description'),
    url: stringArg(e, 'url'),
    skill: stringArg(e, 'skill'),
  }
}

// The call, and who it is logged under (null: not logged).
type StartedCall = { call: DashCall; actor: LogActor | null }

async function addCall($: EngineInterface, e: ToolCallInput): Promise<StartedCall> {
  const call: DashCall = {
    id: e.tool_use_id,
    tool: e.tool,
    startedAt: await $.clock.now(),
    activity: activityOf(e.tool, toolArgs(e)),
  }

  if (isAskingTool(e.tool)) {
    await update($, asksAtom, asks => [...asks, call])
  }

  const { agentId } = e
  const isTracked = agentId === undefined || (await isTrackedAgent($, agentId))

  if (agentId === undefined) {
    await update($, turnAtom, turn => (turn === null ? turn : { ...turn, calls: [...turn.calls, call] }))
  } else if (isTracked) {
    await update($, agentWorkAtom, work => withAgentActivity(work, agentId, call.id, call.activity))
  }

  // The main conversation, or an agent the list names or a spawn recorded. A
  // workflow's agents and the engine's forks are not logged; their calls
  // would read as some agent's with no name.
  const actor = isTracked ? agentActor((await read($, liveAtom)).agents, await read($, spawnsAtom), agentId) : null

  if (actor !== null) {
    await appendLog($, [{ ...actor, at: call.startedAt, text: call.activity, tone: 'plain' }])
  }

  return { call, actor }
}

// An edit that went through: the reply's receipt counts the files it changed.
async function recordEdit($: EngineInterface, e: ToolCallInput): Promise<void> {
  const path = stringArg(e, editPathField(e.tool))

  if (path !== null) {
    await update($, turnAtom, turn => withEdit(turn, e.agentId, path))
  }
}

async function removeCall($: EngineInterface, call: DashCall, agentId: string | undefined): Promise<void> {
  if (isAskingTool(call.tool)) {
    await update($, asksAtom, asks => asks.filter(ask => ask.id !== call.id))
  }

  if (agentId === undefined) {
    await update($, turnAtom, turn =>
      turn === null ? turn : { ...turn, calls: turn.calls.filter(one => one.id !== call.id) },
    )
  } else {
    await changeAgentWork($, work => withAgentCallEnded(work, agentId, call.id))
  }
}

// isError covers a throw, an interrupt and an error answer alike; the
// dispatch's signal aborts on the person's interrupt, and an asking tool
// errs when the person turns it down.
function callOutcome(ran: ToolCallResult, call: DashCall, isAborted: boolean): CallOutcome {
  if (ran.deny !== undefined) {
    return 'denied'
  }

  if (isAborted) {
    return 'interrupted'
  }

  return isAskingTool(call.tool) ? 'declined' : 'failed'
}

function isAnswered<R extends { deny?: string; isError?: true }>(
  ran: R,
): ran is Exclude<R, { deny: string } | { isError: true }> {
  return ran.deny === undefined && ran.isError !== true
}

async function addTask(
  $: EngineInterface,
  id: string,
  kind: string,
  description: string,
  runsForMs: number | null,
): Promise<void> {
  const startedAt = await $.clock.now()
  const task: DashTask = { id, kind, description, startedAt, endsBy: runsForMs === null ? null : startedAt + runsForMs }
  await update($, tasksAtom, tasks => withTask(tasks, task))
  await logAs($, taskActor(task), startedText(description), 'plain')
}

async function addStepUsage($: EngineInterface, usage: UsageCounts, isMainLoop: boolean): Promise<void> {
  await update($, tokensAtom, tokens => addTokens(tokens, usage, isMainLoop))

  if (!(await read($, hasResponseAtom))) {
    await update($, hasResponseAtom, () => true)
  }
}

// tool.call and turn.step run per call and per request; a change that leaves
// the record as it is skips the write. One function per atom: the engine's
// module scan accepts only an atom named at the read or update itself.
async function changeAgentModels($: EngineInterface, change: (models: DashAgentModels) => DashAgentModels): Promise<void> {
  const models = await read($, agentModelsAtom)

  if (change(models) !== models) {
    await update($, agentModelsAtom, change)
  }
}

async function changeAgentWork($: EngineInterface, change: (work: DashAgentWorks) => DashAgentWorks): Promise<void> {
  const work = await read($, agentWorkAtom)

  if (change(work) !== work) {
    await update($, agentWorkAtom, change)
  }
}

async function changeSpawns($: EngineInterface, change: (spawns: DashSpawns) => DashSpawns): Promise<void> {
  const spawns = await read($, spawnsAtom)

  if (change(spawns) !== spawns) {
    await update($, spawnsAtom, change)
  }
}

// An agent the list names, or one a spawn recorded that it will name. A
// workflow's agents and the engine's forks (compaction, memory) carry ids no
// list names: an entry for one would never be taken down, so none is made.
async function isTrackedAgent($: EngineInterface, agentId: string): Promise<boolean> {
  if ((await read($, agentModelsAtom))[agentId] !== undefined) {
    return true
  }

  return (await read($, liveAtom)).agents.some(agent => agent.id === agentId)
}

// Only a step of the main turn on record names the session's model: a side
// request the engine makes on the main loop could run on another one.
async function isMainTurnStep($: EngineInterface, turnId: string): Promise<boolean> {
  return (await read($, turnAtom))?.turnId === turnId
}

async function changeMainModel($: EngineInterface, next: DashAgentModel): Promise<void> {
  const known = await read($, mainModelAtom)

  if (known === null || known.model !== next.model || known.effort !== next.effort) {
    await update($, mainModelAtom, () => next)
  }
}

async function reconcileTasks($: EngineInterface, readings: readonly TaskReading[] | undefined): Promise<void> {
  // An absent list means this build reports none, not that nothing runs.
  if (readings === undefined) {
    return
  }

  // A task the last Stop took down that no notification has ended since
  // ends here, with nothing to say how.
  await dropEndingTasks(
    $,
    () => [],
    () => 'plain',
  )

  // A task this snapshot no longer lists has ended, and its notification,
  // which says how, usually follows the turn: it waits for it.
  let dropped: DashTask[] = []

  await update($, tasksAtom, tasks => {
    const kept = tasksStillRead(tasks, readings)
    dropped = droppedTasks(tasks, kept)

    return kept
  })

  if (dropped.length > 0) {
    await update($, endingTasksAtom, ending => [...ending, ...dropped])
  }
}

// What the turn record says; the band replaces isWorking with the engine's
// own AbovePrompt prop.
async function snapshotOf($: EngineInterface): Promise<DashSnapshot> {
  const [
    turn,
    asks,
    tasks,
    tokens,
    hasResponse,
    lastTurn,
    usage,
    live,
    agentModels,
    agentWork,
    mainModel,
    compactions,
  ] = await Promise.all([
      read($, turnAtom),
      read($, asksAtom),
      read($, tasksAtom),
      read($, tokensAtom),
      read($, hasResponseAtom),
      read($, lastTurnAtom),
      read($, usageAtom),
      read($, liveAtom),
      read($, agentModelsAtom),
      read($, agentWorkAtom),
      read($, mainModelAtom),
      read($, compactionsAtom),
    ])

  return {
    isWorking: turn !== null,
    turn,
    asks,
    tasks,
    tokens,
    hasResponse,
    lastTurn,
    usage,
    live,
    agentModels,
    agentWork,
    mainModel,
    compactions,
  }
}

// A pane opened unasked on a narrow terminal is open but undrawn; to the
// person it is closed, so /dash draws it rather than closing it.
async function togglePane($: EngineInterface): Promise<string | null> {
  const panes = await $.ui.panes()

  if (panes.some(pane => pane.id === PANE_ID && pane.isPlaced)) {
    await $.ui.close({ id: PANE_ID })

    return null
  }

  const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
  await update($, paneClosedAtom, () => false)

  return opened.isPlaced ? null : opened.reason
}

// Rate-limit windows are the account's and stay, and so does the model the
// session runs on; everything that belongs to the conversation starts over.
async function resetConversation($: EngineInterface): Promise<void> {
  await update($, tokensAtom, () => emptyTokens())
  await update($, turnAtom, () => null)
  await update($, asksAtom, () => [])
  await update($, lastTurnAtom, () => null)
  await update($, hasResponseAtom, () => false)
  await update($, agentModelsAtom, () => ({}))
  await update($, agentWorkAtom, () => ({}))
  await update($, compactionsAtom, () => 0)
  await update($, logAtom, () => [])
  await update($, logAnchorAtom, () => null)
  await update($, spawnsAtom, () => ({}))
  await update($, usageAtom, usage => (usage === null ? usage : withoutConversation(usage)))
}

// The drawing a move is over: the one whose body has the move's rows.
function layoutOf(e: UiScrollInput): PaneLayout | undefined {
  return [...paneLayouts.values()].find(layout => layout.bodyRows === e.bodyRows)
}

// A tree that fits the body leaves the engine nothing to scroll, so every
// move is the log's. One taller than the body (a short terminal) scrolls as
// usual, except under the pointer over the log.
function isOverLog(e: UiScrollInput, layout: PaneLayout): boolean {
  if (e.contentRows <= e.bodyRows) {
    return true
  }

  return e.pointer !== undefined && rowBeforeMove(e, layout.offset) + e.pointer.row >= layout.logTop
}

// A key's move is sized for the body: a page key moves `bodyRows`, Home and
// End `contentRows`, which in a tree that fits are the same. Either moves the
// log one window; a wheel tick moves it its own rows.
function logRowsMoved(e: UiScrollInput, layout: PaneLayout): number {
  return e.pointer === undefined && Math.abs(e.by) >= e.bodyRows ? Math.sign(e.by) * layout.logRows : e.by
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'Open or close the session dashboard pane' })
    await sharedRefresh($)
    $.clock.every(TICK_MS, () => {
      requestRefresh($)
    })
    await seedTokens($, await $.session.id())

    // Open from the start for a person at the prompt, unless they closed it
    // earlier in this process. This open is unasked, so on a terminal too
    // narrow for one the engine holds the pane undrawn until /dash or a wider
    // window.
    if (e.isInteractive && !(await read($, paneClosedAtom))) {
      await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    }

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

  on('session.measure', ($, e, next) => {
    requestRefresh($)

    return next(e)
  })

  // Every agent's turn starts here too, but only the main loop's ends in the
  // turn.complete that clears the record.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const startedAt = await $.clock.now()
      await update($, turnAtom, () => newTurn(e.turnId, startedAt))
    }

    requestRefresh($)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const { agentId } = e

    const effort = effortLabel(e.effort)
    const isMainStep = agentId === undefined && (await isMainTurnStep($, e.turnId))

    // Recorded as the request starts, so a long first step already shows it.
    if (isMainStep) {
      await changeMainModel($, { model: (await read($, mainModelAtom))?.model ?? e.model, effort })
    } else if (agentId !== undefined && (await isTrackedAgent($, agentId))) {
      await changeAgentModels($, models => withRequest(models, agentId, e.model, effort))
    }

    const step = yield* next(e)
    const { usage } = step

    if (usage === null) {
      return step
    }

    await addStepUsage($, usage, agentId === undefined)

    // A hook beneath this one may have sent another model than e.model; the
    // response names the one that answered. Effort has no such answer.
    if (isMainStep) {
      await changeMainModel($, { model: usage.model, effort })
    } else if (agentId !== undefined && (await isTrackedAgent($, agentId))) {
      // Asked again: an agent's first request can start before its spawn is
      // recorded.
      await changeAgentModels($, models => withAnsweredModel(models, agentId, usage.model))
      await changeAgentWork($, work => withAgentContext(work, agentId, usage))
    }

    return step
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)

    const { agentId, model } = started

    // A workflow's agent never enters the list, so nothing is kept for it.
    if (agentId !== undefined && e.workflow === undefined) {
      const spawn = { name: spawnedName(e.name, e.subagentType, started.teammateId), isTeammate: started.teammateId !== undefined }
      await changeAgentModels($, models => withSpawnModel(models, agentId, model))
      await update($, turnAtom, turn => withSpawn(turn, agentId, e.parentAgentId, started.teammateId === undefined))
      await update($, spawnsAtom, spawns => ({ ...spawns, [agentId]: spawn }))
      const text = e.resume === undefined ? startedText(e.description) : resumedText(e.description)
      await logAs($, spawnActor(spawn.name, spawn.isTeammate), text, 'plain')
    }

    return started
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const endedAt = await $.clock.now()
      const turn = await read($, turnAtom)
      await update($, turnAtom, () => null)
      await update($, asksAtom, () => [])

      const end = {
        reason: e.reason,
        endedAt,
        durationMs: e.durationMs,
        editedFiles: turn?.editedPaths.length ?? 0,
        subagentsStarted: turn?.agentIds.length ?? 0,
      }

      await update($, lastTurnAtom, () => end)
      await appendLog($, [turnEndLine(end)])
    }

    void queueSave($, await $.session.id())
    requestRefresh($)

    return next(e)
  })

  // A call that went through is its start's entry alone; one that did not
  // adds how it ended.
  on('tool.call', async ($, e, next) => {
    const { call, actor } = await addCall($, e)

    try {
      const ran = await next(e)

      if (isAnswered(ran)) {
        await recordEdit($, e)
      } else if (actor !== null) {
        const outcome = callOutcome(ran, call, next.signal.aborted)
        await logAs($, actor, callEndedText(outcome, call.activity), callOutcomeTone(outcome))
      }

      return ran
    } finally {
      await removeCall($, call, e.agentId)
    }
  })

  // Background work is tracked only from the main loop, and only when its end
  // can reach it: an agent's task notifies that agent, never this session's
  // prompt.submit, and the agent's own status (waiting) already covers it.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)

    if (
      e.agentId === undefined &&
      isAnswered(ran) &&
      ran.result.backgroundTaskId !== undefined &&
      ran.result.backgroundEndsWithFinalResponse !== true
    ) {
      await addTask($, ran.result.backgroundTaskId, 'shell', e.description ?? e.command, null)
    }

    return ran
  })

  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const ran = await next(e)

    if (e.agentId === undefined && isAnswered(ran)) {
      // The engine kills a monitor at its deadline; the expiry notice says so
      // in prose, with no <status>.
      const isPersistent = ran.result.persistent === true || ran.result.timeoutMs === PERSISTENT_MONITOR_TIMEOUT_MS
      const runsForMs = isPersistent ? null : ran.result.timeoutMs
      await addTask($, ran.result.taskId, 'monitor', e.description, runsForMs)
    }

    return ran
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const ran = await next(e)

    if (e.agentId === undefined && isAnswered(ran)) {
      await addTask($, ran.result.taskId, 'workflow', ran.result.workflowName ?? e.name ?? 'workflow', null)
    }

    return ran
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)

    if (e.agentId === undefined && isAnswered(ran) && 'taskId' in ran.result && ran.result.status === 'remote_launched') {
      await addTask($, ran.result.taskId, 'remote', e.description, null)
    }

    requestRefresh($)

    return ran
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)

    if (isAnswered(ran)) {
      const stopped = ran.result.task_id
      await dropTasks(
        $,
        tasks => withoutTask(tasks, stopped),
        () => 'stopped',
      )
    }

    requestRefresh($)

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)

    if (e.origin.kind === 'task-notification') {
      const ended = new Map(endedTasks(e.text).map(task => [task.id, task.tone]))
      await dropTasks(
        $,
        tasks => withoutTasks(tasks, [...ended.keys()]),
        task => ended.get(task.id) ?? 'plain',
      )
      await dropEndingTasks(
        $,
        tasks => withoutTasks(tasks, [...ended.keys()]),
        task => ended.get(task.id) ?? 'plain',
      )
      requestRefresh($)
    }

    // The person's own words, typed here or sent from the Remote Control
    // bridge, once no hook dropped them.
    const line = promptLine(e.text, await $.clock.now())

    if ((e.origin.kind === 'composer' || e.origin.kind === 'bridge') && entered.drop === undefined && line !== null) {
      await appendLog($, [line])
    }

    return entered
  })

  // Only the main loop's Stop reconciles: it follows every tool.call of that
  // loop, while an agent's SubagentStop runs alongside it and may carry a
  // snapshot taken before a task the main loop just started.
  on('classic.Stop', async ($, e, next) => {
    await reconcileTasks($, e.background_tasks)

    return next(e)
  })

  on('classic.SubagentStop', ($, e, next) => {
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

  // Counted only once it ran: a skipped compaction leaves the conversation as
  // it was, and a precompute installs nothing. Where an organization manages
  // Claude Code this hook is not delivered, so the count stays at zero and
  // shows nothing rather than a false "never".
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)

    if (e.agentId === undefined && e.trigger !== 'precompute' && compacted.messages !== undefined) {
      await update($, compactionsAtom, count => count + 1)
      await logAs($, SESSION_ACTOR, COMPACTED_TEXT, 'plain')
    }

    return compacted
  })

  // Every close but an unload, which never reaches the opener's hooks: the
  // person's close mark or key, and /dash's own $.ui.close.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)

    if (e.id === PANE_ID) {
      await update($, paneClosedAtom, () => true)
    }

    return closed
  })

  on('command.run', { command: COMMAND }, async $ => {
    const waiting = await togglePane($)

    return waiting === null ? {} : { text: `The session pane is waiting for room: ${waiting}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The pane's state follows the engine's word too, drawn again once it moves.
    if (e.props.isWorking !== engineIsWorking) {
      engineIsWorking = e.props.isWorking
      $.ui.invalidate('ui.render')
    }

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
    const snapshot = await snapshotOf($)
    const view = buildView({ ...snapshot, isWorking: engineIsWorking ?? snapshot.isWorking })
    const log = { entries: await read($, logAtom), anchor: await read($, logAnchorAtom) }
    const { scroll } = e.props
    const frame = { columns: e.props.bodyColumns, bodyRows: scroll.bodyRows, isDocked: e.props.placement === 'dock' }
    const drawing = paneTree($.ui.resolve(e), view, log, frame)
    paneLayouts.set(e.surface, { bodyRows: scroll.bodyRows, logTop: drawing.logTop, logRows: drawing.logRows, offset: scroll.offset })

    return drawing.tree
  })

  // The log scrolls itself: the window over it moves by the person's rows,
  // and the engine's window over the body stays where it is.
  on('ui.scroll', { requestId: PANE_ID }, async ($, e, next) => {
    const layout = layoutOf(e)

    if (e.component !== 'Pane' || layout === undefined || !isOverLog(e, layout)) {
      return next(e)
    }

    const anchor = await read($, logAnchorAtom)
    const moved = scrolledAnchor(await read($, logAtom), anchor, layout.logRows, logRowsMoved(e, layout))

    if (moved !== anchor) {
      await update($, logAnchorAtom, () => moved)
    }

    return {}
  })
}
