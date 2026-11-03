import type {
  DashAgent,
  DashAgentModel,
  DashAgentModels,
  DashAgentStatus,
  DashAgentWork,
  DashAgentWorks,
  DashCall,
  DashCounts,
  DashLimit,
  DashLive,
  DashLogEntry,
  DashLogSource,
  DashLogTone,
  DashSpawns,
  DashTask,
  DashTokens,
  DashTurn,
  DashTurnEnd,
  DashUsage,
} from '../types'

const SEVERITY_WARN_PERCENT = 60

const SEVERITY_DANGER_PERCENT = 85

const PERCENT_FULL = 100

const MS_PER_SECOND = 1000

const SECONDS_PER_MINUTE = 60

const MINUTES_PER_HOUR = 60

const HOURS_PER_DAY = 24

const SHORT_MINUTES_WITH_SECONDS = 10

// Token totals scale through k, M and B; under ten of a unit they keep one
// more decimal so a count still moves visibly.
const TOKEN_UNITS = [
  { size: 1_000, suffix: 'k', decimals: 0 },
  { size: 1_000_000, suffix: 'M', decimals: 1 },
  { size: 1_000_000_000, suffix: 'B', decimals: 1 },
]

const TOKEN_UNIT_STEP = 1000

const MORE_DECIMALS_BELOW = 10

const CENT = 0.01

const EIGHTHS_PER_CELL = 8

const PARTIAL_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

const FULL_BLOCK = '█'

const EMPTY_BLOCK = '░'

const BLANK_CELL = ' '

const ELLIPSIS = '…'

const QUESTION_TOOL = 'AskUserQuestion'

const PLAN_APPROVAL_TOOL = 'ExitPlanMode'

const ASKING_TOOLS = new Set([QUESTION_TOOL, PLAN_APPROVAL_TOOL])

const NOT_MEASURED = 'not measured yet'

const RUNNING_TEXT = 'running'

const ACTIVE_AGENT_STATUSES = new Set<DashAgentStatus>(['pending', 'running', 'waiting'])

const MODEL_ID_PREFIX = 'claude-'

const MODEL_FAMILY_PATTERN = /^[a-z]+$/

// A version is the one- or two-digit segments of an id (`opus-5-5`); a
// date stamp (`20241022`) is longer and is not part of it.
const MODEL_VERSION_PATTERN = /^\d{1,2}$/

const MODEL_VERSION_JOINER = '.'

// Bracketed suffixes (`[1m]`) name a context option, not the model.
const MODEL_SUFFIX_PATTERN = /\[.*\]$/

export const CLAUSE_JOINER = ', '

const BUDGET_EFFORT_PATTERN = /^\d/

// Vertex writes the date after an `@` (`claude-haiku-4-5@20251001`).
const MODEL_SEGMENT_SEPARATOR = /[-@]/

const TEAMMATE_TEAM_SEPARATOR = '@'

const TEAMS_DIR = 'teams'

const ROSTER_FILE = 'config.json'

const PANE_BACKEND = 'tmux'

const TMUX = 'tmux'

const TMUX_SOCKET_PATH_FLAG = '-S'

const TMUX_SOCKET_NAME_FLAG = '-L'

// $TMUX is `<socket>,<server pid>,<session>`.
const TMUX_ENV_SEPARATOR = ','

// The server the engine starts for its teammates when it runs outside tmux.
const SWARM_SOCKET_PREFIX = 'claude-swarm-'

// The engine sets remain-on-exit failed on a teammate's pane, so a pane whose
// process failed stays listed, with pane_dead 1.
const PANE_LISTING_ARGS = ['list-panes', '-a', '-F', '#{pane_id} #{pane_dead}']

const PANE_FIELD_SEPARATOR = ' '

const PANE_DEAD_FLAG = '1'

const NOTIFICATION_PATTERN = /<task-notification>([\s\S]*?)<\/task-notification>/g

const TASK_ID_PATTERN = /<task-id>([^<]+)<\/task-id>/

const TASK_STATUS_PATTERN = /<status>([^<]+)<\/status>/

// Words a notification ends a task with, and the agent statuses that end an
// agent; any other word (a monitor's event, a progress note) leaves the task
// running until the Stop snapshot says.
const END_TONES = new Map<string, DashLogTone>([
  ['completed', 'done'],
  ['failed', 'failed'],
  ['killed', 'stopped'],
])

export const CONTEXT_METER_KEY = 'context'

const FIVE_HOUR_LIMIT = 'five_hour'

const SEVEN_DAY_LIMIT = 'seven_day'

// A Claude gateway's own window.
const SPEND_LIMIT = 'spend_limit'

const LIMIT_WINDOW_MS = new Map([
  [FIVE_HOUR_LIMIT, 5 * 60 * 60 * 1000],
  [SEVEN_DAY_LIMIT, 7 * 24 * 60 * 60 * 1000],
])

// A projection from the start of a window is mostly noise: the first
// quarter hour of a 5-hour window, and the first two days of a week, whose
// nights and idle days a straight line cannot see yet.
const PACE_MIN_ELAPSED_MS = new Map([
  [FIVE_HOUR_LIMIT, 15 * 60 * 1000],
  [SEVEN_DAY_LIMIT, 2 * 24 * 60 * 60 * 1000],
])

const LIMIT_LABELS = new Map([
  [FIVE_HOUR_LIMIT, '5-hour'],
  [SEVEN_DAY_LIMIT, 'Weekly'],
  [SPEND_LIMIT, 'Spend limit'],
])

export const BAND_LIMIT_KINDS = [FIVE_HOUR_LIMIT, SEVEN_DAY_LIMIT]

export type Severity = 'ok' | 'warn' | 'danger'

export type Phase = 'needs-input' | 'working' | 'waiting' | 'done' | 'interrupted' | 'error' | 'ready'

// detail: clauses in order of importance; a narrow band drops them from the
// end, whole, rather than cutting one mid-word.
export type Headline = { phase: Phase; title: string; detail: string[] }

// isMeasured: the gauge has a reading (or a passed reset) to show, rather
// than "not measured yet".
export type MeterView = {
  key: string
  label: string
  isAvailable: boolean
  isMeasured: boolean
  leftPercent: number | null
  severity: Severity
  valueText: string
  noteText: string
}

export type WorkerKind = 'subagent' | 'teammate' | 'task'

// modelText is the form the band puts in parentheses ("haiku, low effort"),
// modelFamily its shortest ("haiku"); modelDetailText the pane's
// ("Haiku 5.5, low effort").
export type WorkerView = {
  id: string
  kind: WorkerKind
  label: string
  description: string
  isActive: boolean
  isIdle: boolean
  statusText: string
  ageText: string
  isNested: boolean
  modelText: string
  modelFamily: string
  modelDetailText: string
  activityText: string
  contextText: string
}

// mainPercent: the main conversation's share of the total, null before any.
export type TokenView = {
  hasTokens: boolean
  mainPercent: number | null
  totalText: string
  costText: string | null
  inputText: string
  outputText: string
  cacheReadText: string
  cacheWriteText: string
  mainText: string
  agentsText: string
}

export type DashView = {
  headline: Headline
  modelText: string | null
  lastReplyText: string | null
  meters: MeterView[]
  limitsNote: string | null
  tokens: TokenView
  subagents: WorkerView[]
  teammates: WorkerView[]
  tasks: WorkerView[]
  activeSubagents: number
  activeTeammates: number
  idleTeammates: number
  doneSubagents: number
  failedSubagents: number
  listError: string | null
}

export type DashSnapshot = {
  isWorking: boolean
  turn: DashTurn | null
  asks: DashCall[]
  tasks: DashTask[]
  tokens: DashTokens
  hasResponse: boolean
  lastTurn: DashTurnEnd | null
  usage: DashUsage | null
  live: DashLive
  agentModels: DashAgentModels
  agentWork: DashAgentWorks
  mainModel: DashAgentModel | null
  compactions: number
}

export type UsageCounts = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

type RateLimitReading = { kind: string; percentUsed: number; resetsAt?: string }

export type UsageReading = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: readonly RateLimitReading[]
  cost?: { usd: number }
}

export type AgentReading = {
  id: string
  description: string
  type: string
  status: DashAgentStatus
  teammateId?: string
  parentId?: string
  name?: string
}

export type TaskReading = {
  id: string
  type: string
  description: string
  command?: string
}

function emptyCounts(): DashCounts {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

export function emptyTokens(): DashTokens {
  return { main: emptyCounts(), agents: emptyCounts() }
}

function addUsage(counts: DashCounts, usage: UsageCounts): DashCounts {
  return {
    input: counts.input + usage.input_tokens,
    output: counts.output + usage.output_tokens,
    cacheRead: counts.cacheRead + usage.cache_read_input_tokens,
    cacheWrite: counts.cacheWrite + usage.cache_creation_input_tokens,
  }
}

export function addTokens(tokens: DashTokens, usage: UsageCounts, isMainLoop: boolean): DashTokens {
  return isMainLoop
    ? { main: addUsage(tokens.main, usage), agents: tokens.agents }
    : { main: tokens.main, agents: addUsage(tokens.agents, usage) }
}

function mergeCounts(a: DashCounts, b: DashCounts): DashCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

function sumCounts(counts: DashCounts): number {
  return counts.input + counts.output + counts.cacheRead + counts.cacheWrite
}

export function isTokensEmpty(tokens: DashTokens): boolean {
  return sumCounts(tokens.main) + sumCounts(tokens.agents) === 0
}

export function isAgentActive(status: DashAgentStatus): boolean {
  return ACTIVE_AGENT_STATUSES.has(status)
}

export type PaneRoster = { leadPid: number | null; panes: Map<string, string> }

type PaneMember = { agentId: string; tmuxPaneId: string }

function isPaneMember(value: unknown): value is PaneMember {
  if (!(value instanceof Object)) {
    return false
  }

  const agentId = Object.getOwnPropertyDescriptor(value, 'agentId')?.value
  const paneId = Object.getOwnPropertyDescriptor(value, 'tmuxPaneId')?.value

  return (
    Object.getOwnPropertyDescriptor(value, 'backendType')?.value === PANE_BACKEND &&
    agentId === String(agentId) &&
    paneId === String(paneId)
  )
}

export function rosterPath(configDir: string, teammateId: string): string {
  const team = teammateId.slice(teammateId.lastIndexOf(TEAMMATE_TEAM_SEPARATOR) + 1)

  return `${configDir}/${TEAMS_DIR}/${team}/${ROSTER_FILE}`
}

// The engine's own record of a team, as 2.1.311 writes it: each member on a
// tmux pane by its address and pane id. A file of any other shape names no
// pane.
export function paneRosterFromText(text: string): PaneRoster {
  const roster: PaneRoster = { leadPid: null, panes: new Map() }
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return roster
  }

  if (!(parsed instanceof Object)) {
    return roster
  }

  const leadProcess = Object.getOwnPropertyDescriptor(parsed, 'leadProcess')?.value
  const pid = leadProcess instanceof Object ? Object.getOwnPropertyDescriptor(leadProcess, 'pid')?.value : undefined
  const members = Object.getOwnPropertyDescriptor(parsed, 'members')?.value
  roster.leadPid = Number.isFinite(pid) ? Number(pid) : null

  for (const member of Array.isArray(members) ? members : []) {
    if (isPaneMember(member)) {
      roster.panes.set(member.agentId, member.tmuxPaneId)
    }
  }

  return roster
}

// The engine splits the person's own tmux server when it runs inside one, and
// otherwise starts one of its own named after the lead's pid; null when that
// name is not known.
export function paneListingArgv(tmuxEnv: string | undefined, leadPid: number | null): string[] | null {
  if (tmuxEnv !== undefined && tmuxEnv !== '') {
    const socket = tmuxEnv.split(TMUX_ENV_SEPARATOR)[0] ?? tmuxEnv

    return [TMUX, TMUX_SOCKET_PATH_FLAG, socket, ...PANE_LISTING_ARGS]
  }

  return leadPid === null ? null : [TMUX, TMUX_SOCKET_NAME_FLAG, `${SWARM_SOCKET_PREFIX}${leadPid}`, ...PANE_LISTING_ARGS]
}

export function livePaneIds(listing: string): Set<string> {
  const live = new Set<string>()

  for (const line of listing.split('\n')) {
    const [paneId, dead] = line.split(PANE_FIELD_SEPARATOR)

    if (paneId !== undefined && paneId !== '' && dead !== PANE_DEAD_FLAG) {
      live.add(paneId)
    }
  }

  return live
}

// What the pane check found, by teammateId: panes gone or dead, and panes it
// could not look at (tmux did not run), which says nothing either way.
export type PaneCheck = { ended: ReadonlySet<string>; unchecked: ReadonlySet<string> }

// A pane teammate's list status is the last word it wrote in the roster, which
// a pane that closes or dies leaves standing. An unchecked pane keeps the end
// the last refresh gave it (`endedBefore`, by agent id), so a tmux call that
// fails does not bring a dead pane's teammate back to running.
export function withEndedPanes(
  agents: readonly AgentReading[],
  check: PaneCheck,
  endedBefore: ReadonlySet<string>,
): AgentReading[] {
  return agents.map(agent => {
    const { teammateId } = agent

    const isEnded =
      teammateId !== undefined &&
      (check.ended.has(teammateId) || (check.unchecked.has(teammateId) && endedBefore.has(agent.id)))

    return isEnded ? { ...agent, status: 'killed' } : agent
  })
}

export function isAskingTool(tool: string): boolean {
  return ASKING_TOOLS.has(tool)
}

// The arguments an activity is worded from; null where the call has none.
export type ToolArgs = {
  path: string | null
  command: string | null
  description: string | null
  url: string | null
  skill: string | null
}

// A path from a Windows session separates with `\`.
const PATH_SEPARATOR_PATTERN = /[\\/]/

// Userinfo before an `@` (`https://token@host/`) is skipped: it is not the
// host, and it may be a credential the band would put on screen.
const URL_HOST_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?([^/:?#@]+)/i

const LINE_BREAK = '\n'

// `mcp__<server>__<tool>`: the server is the part a person installed and knows.
const MCP_TOOL_PATTERN = /^mcp__(.+?)__/

// Stored activity text is kept short; rows clip it further to their width.
const ACTIVITY_MAX_CELLS = 80

// A command this short and plain says more than the model's description of it.
const PLAIN_COMMAND_MAX_CELLS = 24

const COMPOUND_COMMAND_PATTERN = /&&|\|\||[|;]/

const TRAILING_STOP_PATTERN = /\.$/

function baseName(path: string): string {
  return path.split(PATH_SEPARATOR_PATTERN).pop() || path
}

function firstLine(text: string): string {
  return text.trim().split(LINE_BREAK)[0] ?? ''
}

// "Run the tests" reads as "run the tests" after "Working"; an acronym
// ("NPM install") keeps its capitals.
function lowerFirst(text: string): string {
  const second = text.charAt(1)

  return second !== '' && second === second.toLowerCase() ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

function commandActivity(args: ToolArgs): string {
  const command = args.command === null ? '' : firstLine(args.command)
  const description = args.description === null ? '' : firstLine(args.description).replace(TRAILING_STOP_PATTERN, '')
  const isOneLine = args.command !== null && !args.command.trim().includes(LINE_BREAK)
  const isPlain = isOneLine && command !== '' && cellWidth(command) <= PLAIN_COMMAND_MAX_CELLS && !COMPOUND_COMMAND_PATTERN.test(command)

  if (isPlain || (description === '' && command !== '')) {
    return `running ${command}`
  }

  return description === '' ? 'running a command' : lowerFirst(description)
}

const FIXED_ACTIVITIES = new Map([
  ['WebSearch', 'searching the web'],
  ['Agent', 'running a subagent'],
  ['TodoWrite', 'updating the to-do list'],
  ['TaskCreate', 'updating the to-do list'],
  ['TaskUpdate', 'updating the to-do list'],
  ['Monitor', 'starting a monitor'],
  ['Workflow', 'starting a workflow'],
  [QUESTION_TOOL, 'asking you a question'],
  [PLAN_APPROVAL_TOOL, 'presenting a plan'],
])

const FILE_VERBS = new Map([
  ['Read', 'reading'],
  ['Edit', 'editing'],
  ['NotebookEdit', 'editing'],
  ['Write', 'writing'],
])

function wordedActivity(tool: string, args: ToolArgs): string {
  const fixed = FIXED_ACTIVITIES.get(tool)

  if (fixed !== undefined) {
    return fixed
  }

  const fileVerb = FILE_VERBS.get(tool)

  if (fileVerb !== undefined && args.path !== null) {
    return `${fileVerb} ${baseName(args.path)}`
  }

  if (tool === 'Bash') {
    return commandActivity(args)
  }

  const host = args.url === null ? undefined : URL_HOST_PATTERN.exec(args.url)?.[1]

  if (tool === 'WebFetch' && host !== undefined) {
    return `fetching ${host}`
  }

  if (tool === 'Skill' && args.skill !== null) {
    return `using the ${args.skill} skill`
  }

  const server = MCP_TOOL_PATTERN.exec(tool)?.[1]

  return `using ${server ?? tool}`
}

// What a tool call is doing, in the words a person would use.
export function activityOf(tool: string, args: ToolArgs): string {
  return clipCells(wordedActivity(tool, args), ACTIVITY_MAX_CELLS)
}

// "1 subagent", "3 subagents".
function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

// "a", "a and b", "a, b and c".
function joinedList(items: readonly string[]): string {
  if (items.length <= 1) {
    return items.join('')
  }

  return `${items.slice(0, -1).join(CLAUSE_JOINER)} and ${items[items.length - 1] ?? ''}`
}

export type EndedTask = { id: string; tone: DashLogTone }

// One prompt may carry several notifications when tasks end together.
export function endedTasks(text: string): EndedTask[] {
  const ended: EndedTask[] = []

  for (const notification of text.matchAll(NOTIFICATION_PATTERN)) {
    const body = notification[1] ?? ''
    const id = TASK_ID_PATTERN.exec(body)?.[1]?.trim()
    const tone = END_TONES.get(TASK_STATUS_PATTERN.exec(body)?.[1]?.trim() ?? '')

    if (id !== undefined && tone !== undefined) {
      ended.push({ id, tone })
    }
  }

  return ended
}

function parseResetTime(resetsAt: string | undefined): number | null {
  if (resetsAt === undefined) {
    return null
  }

  const parsed = Date.parse(resetsAt)

  return Number.isNaN(parsed) ? null : parsed
}

export function usageFromReading(reading: UsageReading): DashUsage {
  return {
    contextTokens: reading.context.tokens ?? null,
    contextWindow: reading.context.window,
    contextPercent: reading.context.percent ?? null,
    limits: reading.rateLimits.map(limit => ({
      kind: limit.kind,
      percentUsed: limit.percentUsed,
      resetsAt: parseResetTime(limit.resetsAt),
    })),
    costUsd: reading.cost?.usd ?? null,
  }
}

export function agentsFromReading(
  readings: readonly AgentReading[],
  previous: readonly DashAgent[],
  now: number,
): DashAgent[] {
  const seenAt = new Map(previous.map(agent => [agent.id, agent.firstSeenAt]))

  return readings.map(reading => ({
    id: reading.id,
    label: reading.name ?? reading.type,
    description: reading.description,
    status: reading.status,
    isTeammate: reading.teammateId !== undefined,
    isNested: reading.parentId !== undefined,
    firstSeenAt: seenAt.get(reading.id) ?? now,
  }))
}

// Returns the map itself when nothing changes, so a caller can skip the write.
function withAgentEntry(models: DashAgentModels, id: string, entry: DashAgentModel): DashAgentModels {
  const known = models[id]

  if (known !== undefined && known.model === entry.model && known.effort === entry.effort) {
    return models
  }

  return { ...models, [id]: entry }
}

export function withAnsweredModel(models: DashAgentModels, id: string, model: string): DashAgentModels {
  return withAgentEntry(models, id, { model, effort: models[id]?.effort ?? null })
}

// A spawn result and a request name a model only while none is known: the
// answered one replaces it, and a spawn result may land after the agent's
// first response.
export function withSpawnModel(models: DashAgentModels, id: string, model: string): DashAgentModels {
  return withAgentEntry(models, id, { model: models[id]?.model ?? model, effort: models[id]?.effort ?? null })
}

// A request with no effort runs a model without one, so its null replaces
// the effort an earlier request asked for.
export function withRequest(models: DashAgentModels, id: string, model: string, effort: string | null): DashAgentModels {
  return withAgentEntry(models, id, { model: models[id]?.model ?? model, effort })
}

// One entry per agent, by agent id (DashAgentModels, DashAgentWorks).
type ByAgent<T> = Record<string, T>

// Returns the record itself when none of the ids is in it, so a caller can
// skip the write.
export function withoutAgentEntries<T>(entries: ByAgent<T>, ids: readonly string[]) {
  if (!ids.some(id => entries[id] !== undefined)) {
    return entries
  }

  const kept: ByAgent<T> = {}

  for (const [id, entry] of Object.entries(entries)) {
    if (!ids.includes(id)) {
      kept[id] = entry
    }
  }

  return kept
}

function agentWorkOf(work: DashAgentWorks, id: string): DashAgentWork {
  return work[id] ?? { activity: null, callId: null, contextTokens: null }
}

export function withAgentActivity(work: DashAgentWorks, id: string, callId: string, activity: string): DashAgentWorks {
  return { ...work, [id]: { ...agentWorkOf(work, id), activity, callId } }
}

// Only the call that set the activity clears it: with calls in parallel, the
// one that ends first must not wipe the one still running.
export function withAgentCallEnded(work: DashAgentWorks, id: string, callId: string): DashAgentWorks {
  const known = work[id]

  return known === undefined || known.callId !== callId ? work : { ...work, [id]: { ...known, activity: null, callId: null } }
}

// The latest response's input side: how much the agent's context holds now.
export function withAgentContext(work: DashAgentWorks, id: string, usage: UsageCounts): DashAgentWorks {
  const known = agentWorkOf(work, id)
  const contextTokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens

  return known.contextTokens === contextTokens ? work : { ...work, [id]: { ...known, contextTokens } }
}

// The edit tools a reply receipt counts, by the argument that names the file.
const EDIT_PATH_FIELDS = new Map([
  ['Edit', 'file_path'],
  ['Write', 'file_path'],
  ['NotebookEdit', 'notebook_path'],
])

export function editPathField(tool: string): string | null {
  return EDIT_PATH_FIELDS.get(tool) ?? null
}

export function newTurn(turnId: string, startedAt: number): DashTurn {
  return { turnId, startedAt, calls: [], editedPaths: [], agentIds: [] }
}

// An edit counts toward the turn when the main loop made it or an agent the
// turn started did; a background agent from an earlier turn is not this
// reply's work.
export function withEdit(turn: DashTurn | null, agentId: string | undefined, path: string): DashTurn | null {
  if (turn === null || turn.editedPaths.includes(path)) {
    return turn
  }

  const isTurnsOwn = agentId === undefined || turn.agentIds.includes(agentId)

  return isTurnsOwn ? { ...turn, editedPaths: [...turn.editedPaths, path] } : turn
}

// An agent the main loop, or an agent of this turn, started. isReplyWork is
// false for a teammate, which joins the session, and for a workflow's agent,
// which works for a run in the background: neither is this reply's work.
export function withSpawn(turn: DashTurn | null, agentId: string, parentAgentId: string | undefined, isReplyWork: boolean): DashTurn | null {
  const isTurnsOwn = parentAgentId === undefined || turn?.agentIds.includes(parentAgentId) === true

  if (turn === null || !isReplyWork || !isTurnsOwn || turn.agentIds.includes(agentId)) {
    return turn
  }

  return { ...turn, agentIds: [...turn.agentIds, agentId] }
}

// A request's effort is a level or an integer budget.
export function effortLabel(effort: string | number | undefined): string | null {
  if (effort === undefined) {
    return null
  }

  return Number.isFinite(effort) ? formatTokens(Number(effort)) : String(effort)
}

// The family is what an Agent call picks a model by, so it is what a worker
// row names. Ids carry it among version and date segments, under a
// provider's prefix or not (`claude-haiku-5-5`, `claude-3-5-sonnet-20241022`,
// `us.anthropic.claude-opus-...`); anything else is shown as it is.
export function modelFamily(model: string): string {
  const bare = model.replace(MODEL_SUFFIX_PATTERN, '')
  const start = bare.indexOf(MODEL_ID_PREFIX)

  if (start < 0) {
    return bare
  }

  const segments = bare.slice(start + MODEL_ID_PREFIX.length).split(MODEL_SEGMENT_SEPARATOR)

  return segments.find(segment => MODEL_FAMILY_PATTERN.test(segment)) ?? bare
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// The name a person knows a model by: family and version from its id
// (`claude-opus-5-5` reads "Opus 5.5", `claude-3-5-sonnet-20241022`
// "Sonnet 3.5"); an alias or a foreign id is shown as it is.
export function modelName(model: string): string {
  const bare = model.replace(MODEL_SUFFIX_PATTERN, '')
  const start = bare.indexOf(MODEL_ID_PREFIX)

  if (start < 0) {
    return bare
  }

  const segments = bare.slice(start + MODEL_ID_PREFIX.length).split(MODEL_SEGMENT_SEPARATOR)
  const family = segments.find(segment => MODEL_FAMILY_PATTERN.test(segment))

  if (family === undefined) {
    return bare
  }

  const version = segments.filter(segment => MODEL_VERSION_PATTERN.test(segment)).join(MODEL_VERSION_JOINER)

  return version === '' ? capitalised(family) : `${capitalised(family)} ${version}`
}

// A level reads "low effort"; an integer budget ("16k") is thinking tokens.
function effortText(effort: string): string {
  return BUDGET_EFFORT_PATTERN.test(effort) ? `${effort} thinking budget` : `${effort} effort`
}

function shortModelText(model: DashAgentModel | undefined): string {
  if (model === undefined) {
    return ''
  }

  const family = modelFamily(model.model)

  return model.effort === null ? family : `${family}${CLAUSE_JOINER}${effortText(model.effort)}`
}

export function modelDetailText(model: DashAgentModel | null | undefined): string {
  if (model === null || model === undefined) {
    return ''
  }

  const name = modelName(model.model)

  return model.effort === null ? name : `${name}${CLAUSE_JOINER}${effortText(model.effort)}`
}

// background_tasks lists every loop's work in the session, agents' included,
// with no owner, and no Stop need follow the end of an agent's command; so it
// only takes down a task the main loop was seen starting, and adds none.
export function tasksStillRead(tasks: readonly DashTask[], readings: readonly TaskReading[]): DashTask[] {
  const listed = new Set(readings.map(reading => reading.id))

  return tasks.filter(task => listed.has(task.id))
}

// Rate-limit windows belong to the account, not the conversation: a reading
// that carries none (the first one after /clear) leaves the last known
// windows standing, and their resetsAt still retires them on time.
export function withKnownLimits(previous: DashUsage | null, next: DashUsage): DashUsage {
  return next.limits.length === 0 && previous !== null ? { ...next, limits: previous.limits } : next
}

// What survives the end of a conversation: the window size and the
// account's rate-limit windows.
export function withoutConversation(usage: DashUsage): DashUsage {
  return { ...usage, contextTokens: null, contextPercent: null, costUsd: null }
}

export function withTask(tasks: readonly DashTask[], task: DashTask): DashTask[] {
  return tasks.some(one => one.id === task.id) ? [...tasks] : [...tasks, task]
}

export function withoutTask(tasks: readonly DashTask[], id: string): DashTask[] {
  return tasks.filter(task => task.id !== id)
}

export function withoutTasks(tasks: readonly DashTask[], ids: readonly string[]): DashTask[] {
  return tasks.filter(task => !ids.includes(task.id))
}

export function isTaskOver(task: DashTask, now: number): boolean {
  return task.endsBy !== null && task.endsBy <= now
}

function severityOf(usedPercent: number): Severity {
  if (usedPercent >= SEVERITY_DANGER_PERCENT) {
    return 'danger'
  }

  return usedPercent >= SEVERITY_WARN_PERCENT ? 'warn' : 'ok'
}

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, warn: 1, danger: 2 }

export function worseOf(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

// Hangul, CJK and fullwidth forms take two terminal cells (task and agent
// descriptions can hold them); everything else this mod draws takes one.
function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    codePoint >= 0x20000
  )
}

export function cellWidth(text: string): number {
  let cells = 0

  for (const char of text) {
    cells += isWide(char.codePointAt(0) ?? 0) ? 2 : 1
  }

  return cells
}

export function clipCells(text: string, limit: number): string {
  if (cellWidth(text) <= limit) {
    return text
  }

  let clipped = ''

  for (const char of text) {
    if (cellWidth(clipped + char) > limit - 1) {
      break
    }

    clipped += char
  }

  return clipped + ELLIPSIS
}

export type BarCells = { fill: string; rest: string }

export function barCells(fillPercent: number | null, cells: number): BarCells {
  if (fillPercent === null) {
    return { fill: '', rest: BLANK_CELL.repeat(cells) }
  }

  const fraction = Math.min(Math.max(fillPercent, 0), PERCENT_FULL) / PERCENT_FULL
  const eighths = Math.round(fraction * cells * EIGHTHS_PER_CELL)
  const full = Math.floor(eighths / EIGHTHS_PER_CELL)
  const partial = PARTIAL_BLOCKS[eighths % EIGHTHS_PER_CELL] ?? ''
  const used = full + (partial === '' ? 0 : 1)

  return { fill: FULL_BLOCK.repeat(full) + partial, rest: EMPTY_BLOCK.repeat(cells - used) }
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

export function formatTokens(count: number): string {
  const [smallest] = TOKEN_UNITS

  if (smallest === undefined || count < smallest.size) {
    return String(count)
  }

  let text = ''

  // Smallest unit first, so a value that rounds up to the next unit's size
  // ("1000k") is written in that unit instead.
  for (const unit of TOKEN_UNITS) {
    const scaled = count / unit.size
    const rounded = scaled.toFixed(scaled < MORE_DECIMALS_BELOW ? unit.decimals + 1 : unit.decimals)
    text = trimZeros(rounded) + unit.suffix

    if (Number(rounded) < TOKEN_UNIT_STEP) {
      break
    }
  }

  return text
}

export function formatCost(usd: number): string {
  return usd > 0 && usd < CENT ? '<$0.01' : `$${usd.toFixed(2)}`
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / MS_PER_SECOND))

  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)

  if (minutes < SHORT_MINUTES_WITH_SECONDS) {
    return `${minutes}m ${twoDigits(seconds % SECONDS_PER_MINUTE)}s`
  }

  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / MINUTES_PER_HOUR)

  if (hours < HOURS_PER_DAY) {
    return `${hours}h ${twoDigits(minutes % MINUTES_PER_HOUR)}m`
  }

  return `${Math.floor(hours / HOURS_PER_DAY)}d ${hours % HOURS_PER_DAY}h`
}

// The stored clock is coarse while idle, so seconds there would be invented.
function formatAgo(ms: number): string {
  const minutes = Math.floor(ms / (MS_PER_SECOND * SECONDS_PER_MINUTE))

  if (minutes < 1) {
    return 'just now'
  }

  return minutes < MINUTES_PER_HOUR ? `${minutes}m ago` : `${formatDuration(ms)} ago`
}

const COMPACTION_TEXTS = ['', 'compacted once', 'compacted twice']

function compactionText(compactions: number): string {
  return COMPACTION_TEXTS[compactions] ?? `compacted ${compactions} times`
}

function contextNote(usage: DashUsage | null, compactions: number): string {
  const parts: string[] = []

  if (usage !== null) {
    const windowText = formatTokens(usage.contextWindow)
    parts.push(usage.contextTokens === null ? `${windowText} window` : `${formatTokens(usage.contextTokens)} of ${windowText} used`)
  }

  if (compactions > 0) {
    parts.push(compactionText(compactions))
  }

  return parts.join(CLAUSE_JOINER)
}

function contextMeter(usage: DashUsage | null, compactions: number): MeterView {
  const usedPercent = usage?.contextPercent ?? null
  const leftPercent = usedPercent === null ? null : Math.max(0, PERCENT_FULL - usedPercent)

  return {
    key: CONTEXT_METER_KEY,
    label: 'Context',
    isAvailable: true,
    isMeasured: leftPercent !== null,
    leftPercent,
    severity: usedPercent === null ? 'ok' : severityOf(usedPercent),
    valueText: leftPercent === null ? NOT_MEASURED : `${Math.floor(leftPercent)}% left`,
    noteText: contextNote(usage, compactions),
  }
}

const LIMIT_KIND_SEPARATOR = '_'

const LABEL_WORD_SEPARATOR = ' '

// A kind this mod has no name for reads as words: `seven_day_opus` is
// "Seven day opus".
function limitLabel(kind: string): string {
  return LIMIT_LABELS.get(kind) ?? capitalised(kind.split(LIMIT_KIND_SEPARATOR).join(LABEL_WORD_SEPARATOR))
}

function limitMeter(kind: string, limit: DashLimit | undefined, now: number, hasResponse: boolean): MeterView {
  const label = limitLabel(kind)

  if (limit === undefined) {
    return {
      key: kind,
      label,
      isAvailable: !hasResponse,
      isMeasured: false,
      leftPercent: null,
      severity: 'ok',
      valueText: hasResponse ? 'no data' : NOT_MEASURED,
      noteText: '',
    }
  }

  // A reading outlives its window: once resetsAt has passed, the stored
  // percentage describes the previous window until the next response.
  if (limit.resetsAt !== null && limit.resetsAt <= now) {
    return {
      key: kind,
      label,
      isAvailable: true,
      isMeasured: true,
      leftPercent: null,
      severity: 'ok',
      valueText: 'reset',
      noteText: 'updates on next reply',
    }
  }

  const leftPercent = Math.max(0, PERCENT_FULL - limit.percentUsed)
  const exhaustsIn = exhaustsBeforeReset(limit, now)
  const resetNote = limit.resetsAt === null ? '' : `resets in ${formatDuration(limit.resetsAt - now)}`

  return {
    key: kind,
    label,
    isAvailable: true,
    isMeasured: true,
    leftPercent,
    severity: exhaustsIn === null ? severityOf(limit.percentUsed) : worseOf(severityOf(limit.percentUsed), 'warn'),
    valueText: `${Math.floor(leftPercent)}% left`,
    noteText: exhaustsIn === null ? resetNote : `runs out in ${formatDuration(exhaustsIn)} at this pace`,
  }
}

// Linear projection of this window's use so far: the time until it runs
// out, when that comes before the reset; null when the pace is safe or the
// window is too young to judge.
export function exhaustsBeforeReset(limit: DashLimit, now: number): number | null {
  const windowMs = LIMIT_WINDOW_MS.get(limit.kind)
  const minElapsedMs = PACE_MIN_ELAPSED_MS.get(limit.kind)

  if (windowMs === undefined || minElapsedMs === undefined || limit.resetsAt === null || limit.percentUsed <= 0) {
    return null
  }

  const untilReset = limit.resetsAt - now
  const elapsed = windowMs - untilReset

  if (elapsed < minElapsedMs) {
    return null
  }

  const exhaustsIn = ((PERCENT_FULL - limit.percentUsed) * elapsed) / limit.percentUsed

  return exhaustsIn < untilReset ? exhaustsIn : null
}

function meterViews(usage: DashUsage | null, now: number, hasResponse: boolean, compactions: number): MeterView[] {
  const limits = usage?.limits ?? []
  const meters = [contextMeter(usage, compactions)]
  const kinds = [...BAND_LIMIT_KINDS]

  for (const limit of limits) {
    if (!kinds.includes(limit.kind)) {
      kinds.push(limit.kind)
    }
  }

  for (const kind of kinds) {
    meters.push(limitMeter(kind, limits.find(limit => limit.kind === kind), now, hasResponse))
  }

  return meters
}

function limitsNoteOf(usage: DashUsage | null, hasResponse: boolean): string | null {
  if ((usage?.limits.length ?? 0) > 0) {
    return null
  }

  return hasResponse ? 'Responses carry no rate-limit data; expected when using an API key.' : null
}

// No cost before anything was spent: "$0.00" on a fresh session says nothing.
function tokenView(tokens: DashTokens, costUsd: number | null): TokenView {
  const all = mergeCounts(tokens.main, tokens.agents)

  const total = sumCounts(all)

  return {
    hasTokens: total > 0,
    mainPercent: total === 0 ? null : (sumCounts(tokens.main) * PERCENT_FULL) / total,
    totalText: formatTokens(total),
    costText: costUsd === null || costUsd <= 0 ? null : formatCost(costUsd),
    inputText: formatTokens(all.input),
    outputText: formatTokens(all.output),
    cacheReadText: formatTokens(all.cacheRead),
    cacheWriteText: formatTokens(all.cacheWrite),
    mainText: formatTokens(sumCounts(tokens.main)),
    agentsText: formatTokens(sumCounts(tokens.agents)),
  }
}

const AGENT_STATUS_TEXT: Record<DashAgentStatus, string> = {
  pending: 'starting',
  running: RUNNING_TEXT,
  waiting: 'paused',
  idle: 'idle',
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
}

function agentView(agent: DashAgent, now: number, models: DashAgentModels, work: DashAgentWorks): WorkerView {
  const model = models[agent.id]
  const done = work[agent.id]
  const contextTokens = done?.contextTokens ?? null

  return {
    id: agent.id,
    kind: agent.isTeammate ? 'teammate' : 'subagent',
    label: agent.label,
    description: agent.description,
    isActive: isAgentActive(agent.status),
    isIdle: agent.status === 'idle',
    statusText: AGENT_STATUS_TEXT[agent.status],
    ageText: formatDuration(now - agent.firstSeenAt),
    isNested: agent.isNested,
    modelText: shortModelText(model),
    modelFamily: model === undefined ? '' : modelFamily(model.model),
    modelDetailText: modelDetailText(model),
    activityText: done?.activity ?? '',
    contextText: contextTokens === null ? '' : `${formatTokens(contextTokens)} context`,
  }
}

function taskView(task: DashTask, now: number): WorkerView {
  return {
    id: task.id,
    kind: 'task',
    label: task.kind,
    description: task.description,
    isActive: true,
    isIdle: false,
    statusText: AGENT_STATUS_TEXT.running,
    ageText: formatDuration(now - task.startedAt),
    isNested: false,
    modelText: '',
    modelFamily: '',
    modelDetailText: '',
    activityText: '',
    contextText: '',
  }
}

// Between tools the model may be thinking or writing; the band cannot tell,
// so it names nothing.
function callsDetail(calls: readonly DashCall[]): string[] {
  const first = calls[0]

  if (first === undefined) {
    return []
  }

  return calls.length === 1 ? [first.activity] : [`${first.activity} and ${calls.length - 1} more`]
}

const TURN_END_TITLES: Record<DashTurnEnd['reason'], { phase: Phase; title: string }> = {
  answer: { phase: 'done', title: 'Done' },
  aborted: { phase: 'interrupted', title: 'Interrupted' },
  refusal: { phase: 'error', title: 'Refused' },
  error: { phase: 'error', title: 'Ended with an error' },
}

type WorkerCounts = Pick<DashView, 'activeSubagents' | 'activeTeammates' | 'tasks'>

// A task's kind as the engine's own footer counts it ("1 shell").
const TASK_KIND_WORDS = new Map([
  ['shell', { singular: 'shell', plural: 'shells' }],
  ['monitor', { singular: 'monitor', plural: 'monitors' }],
  ['workflow', { singular: 'workflow', plural: 'workflows' }],
  ['remote', { singular: 'remote agent', plural: 'remote agents' }],
])

function waitingTitle(workers: WorkerCounts): string | null {
  const groups: string[] = []

  if (workers.activeSubagents > 0) {
    groups.push(counted(workers.activeSubagents, 'subagent', 'subagents'))
  }

  if (workers.activeTeammates > 0) {
    groups.push(counted(workers.activeTeammates, 'teammate', 'teammates'))
  }

  for (const [kind, words] of TASK_KIND_WORDS) {
    const count = workers.tasks.filter(task => task.label === kind).length

    if (count > 0) {
      groups.push(counted(count, words.singular, words.plural))
    }
  }

  const other = workers.tasks.filter(task => !TASK_KIND_WORDS.has(task.label)).length

  if (other > 0) {
    groups.push(counted(other, 'background task', 'background tasks'))
  }

  return groups.length === 0 ? null : `Waiting on ${joinedList(groups)}`
}

// What the last main turn did, most telling first. The engine prints how long
// it took right above the band, so the band leaves that to the pane.
function turnEndWork(end: DashTurnEnd): string[] {
  const parts: string[] = []

  if (end.editedFiles > 0) {
    parts.push(`edited ${counted(end.editedFiles, 'file', 'files')}`)
  }

  if (end.subagentsStarted > 0) {
    parts.push(`used ${counted(end.subagentsStarted, 'subagent', 'subagents')}`)
  }

  return parts
}

function lastReplyText(end: DashTurnEnd | null, now: number): string | null {
  if (end === null) {
    return null
  }

  return [formatAgo(now - end.endedAt), `took ${formatDuration(end.durationMs)}`, ...turnEndWork(end)].join(CLAUSE_JOINER)
}

function headlineOf(snapshot: DashSnapshot, workers: WorkerCounts): Headline {
  const now = snapshot.live.now
  const ask = snapshot.asks[0]

  if (ask !== undefined) {
    return {
      phase: 'needs-input',
      title: ask.tool === PLAN_APPROVAL_TOOL ? 'Needs your plan approval' : 'Needs your answer',
      detail: [`waiting ${formatDuration(now - ask.startedAt)}`],
    }
  }

  if (snapshot.isWorking) {
    return { phase: 'working', title: 'Working', detail: callsDetail(snapshot.turn?.calls ?? []) }
  }

  const waiting = waitingTitle(workers)

  if (waiting !== null) {
    return { phase: 'waiting', title: waiting, detail: [] }
  }

  if (snapshot.lastTurn === null) {
    return { phase: 'ready', title: 'Ready', detail: [] }
  }

  const end = TURN_END_TITLES[snapshot.lastTurn.reason]

  return { phase: end.phase, title: end.title, detail: [formatAgo(now - snapshot.lastTurn.endedAt), ...turnEndWork(snapshot.lastTurn)] }
}

// A conversation's log keeps its latest entries; older ones fall off the top.
const LOG_MAX_ENTRIES = 200

// Stored text is kept short; each row clips it further to its width.
const LOG_TEXT_MAX_CELLS = 120

const MAIN_LOG_NAME = 'Claude'

const YOU_LOG_NAME = 'you'

const SESSION_LOG_NAME = 'session'

// An agent the list has not named yet.
const UNNAMED_AGENT_LOG_NAME = 'agent'

const CLOCK_SEPARATOR = ':'

const END_WORDS: Record<DashLogTone, string> = {
  plain: 'ended after',
  done: 'done in',
  failed: 'failed after',
  stopped: 'stopped after',
}

const TURN_END_LOG: Record<DashTurnEnd['reason'], { tone: DashLogTone; word: string }> = {
  answer: { tone: 'done', word: 'replied in' },
  aborted: { tone: 'stopped', word: 'interrupted after' },
  refusal: { tone: 'failed', word: 'refused after' },
  error: { tone: 'failed', word: 'ended with an error after' },
}

export type LogActor = { source: DashLogSource; who: string }

export type LogLine = LogActor & { at: number; text: string; tone: DashLogTone }

export const MAIN_ACTOR: LogActor = { source: 'main', who: MAIN_LOG_NAME }

export const SESSION_ACTOR: LogActor = { source: 'session', who: SESSION_LOG_NAME }

// Returns the log itself when there is nothing to add, so a caller can skip
// the write.
export function withLogLines(log: DashLogEntry[], lines: readonly LogLine[]): DashLogEntry[] {
  if (lines.length === 0) {
    return log
  }

  const lastSeq = log[log.length - 1]?.seq ?? 0
  const added = lines.map((line, index) => ({ ...line, text: clipCells(line.text, LOG_TEXT_MAX_CELLS), seq: lastSeq + index + 1 }))

  return [...log, ...added].slice(-LOG_MAX_ENTRIES)
}

function agentSource(isTeammate: boolean): DashLogSource {
  return isTeammate ? 'teammate' : 'subagent'
}

// The main conversation for no agent id; an agent by the name the list
// gives it, or before the list names it, the name its spawn gave it.
export function agentActor(agents: readonly DashAgent[], spawns: DashSpawns, agentId: string | undefined): LogActor {
  if (agentId === undefined) {
    return MAIN_ACTOR
  }

  const agent = agents.find(one => one.id === agentId)

  if (agent !== undefined) {
    return { source: agentSource(agent.isTeammate), who: agent.label }
  }

  const spawn = spawns[agentId]

  return spawn === undefined ? { source: 'subagent', who: UNNAMED_AGENT_LOG_NAME } : spawnActor(spawn.name, spawn.isTeammate)
}

export function spawnActor(name: string, isTeammate: boolean): LogActor {
  return { source: agentSource(isTeammate), who: name }
}

// A teammate's address is `<name>@<team>`, and its name there is the one the
// team gave it: a name the team already had gets a suffix (`scout-2`).
const TEAMMATE_ADDRESS_SEPARATOR = '@'

export function spawnedName(name: string | undefined, subagentType: string, teammateId: string | undefined): string {
  const at = teammateId?.lastIndexOf(TEAMMATE_ADDRESS_SEPARATOR) ?? -1

  if (teammateId !== undefined && at > 0) {
    return teammateId.slice(0, at)
  }

  return name ?? subagentType
}

export function taskActor(task: DashTask): LogActor {
  return { source: 'task', who: task.kind }
}

export function startedText(description: string): string {
  return `started: ${description}`
}

// A subagent resumed, or a teammate brought back from disk.
export function resumedText(description: string): string {
  return `resumed: ${description}`
}

export function endedText(tone: DashLogTone, ms: number, description: string): string {
  return `${END_WORDS[tone]} ${formatDuration(ms)}: ${description}`
}

// How a call that did not go through ended: a hook refused it, the person
// interrupted it, the person turned down an asking tool (a question or a
// plan), or the tool reported an error.
export type CallOutcome = 'denied' | 'interrupted' | 'declined' | 'failed'

const CALL_OUTCOME_TONES: Record<CallOutcome, DashLogTone> = {
  denied: 'stopped',
  interrupted: 'stopped',
  declined: 'stopped',
  failed: 'failed',
}

export function callOutcomeTone(outcome: CallOutcome): DashLogTone {
  return CALL_OUTCOME_TONES[outcome]
}

export function callEndedText(outcome: CallOutcome, activity: string): string {
  return `${outcome}: ${activity}`
}

// The person's own prompt, by its first line; null for one with no text.
export function promptLine(text: string, at: number): LogLine | null {
  const line = firstLine(text)

  return line === '' ? null : { source: 'you', who: YOU_LOG_NAME, at, text: line, tone: 'plain' }
}

export function turnEndLine(end: DashTurnEnd): LogLine {
  const { tone, word } = TURN_END_LOG[end.reason]
  const clauses = [`${word} ${formatDuration(end.durationMs)}`, ...(end.reason === 'answer' ? turnEndWork(end) : [])]

  return { ...MAIN_ACTOR, at: end.endedAt, text: clauses.join(CLAUSE_JOINER), tone }
}

function agentEndLine(agent: DashAgent, tone: DashLogTone, now: number): LogLine {
  const text = endedText(tone, now - agent.firstSeenAt, agent.description)

  return { source: agentSource(agent.isTeammate), who: agent.label, at: now, text, tone }
}

// Each agent's end once: one the last list had active and this one names as
// ended, or no longer names at all; and one a spawn recorded (`spawned`)
// that this list is the first to name, already ended.
export function agentEndLines(
  previous: readonly DashAgent[],
  next: readonly DashAgent[],
  spawned: ReadonlySet<string>,
  now: number,
): LogLine[] {
  const before = new Map(previous.map(agent => [agent.id, agent]))
  const listed = new Set(next.map(agent => agent.id))

  const ended = next.flatMap(agent => {
    const tone = END_TONES.get(agent.status)
    const was = before.get(agent.id)
    const isEnding = was === undefined ? spawned.has(agent.id) : isAgentActive(was.status)

    return tone === undefined || !isEnding ? [] : [agentEndLine(agent, tone, now)]
  })

  const left = previous.flatMap(agent =>
    !listed.has(agent.id) && isAgentActive(agent.status) ? [agentEndLine(agent, 'plain', now)] : [],
  )

  return [...ended, ...left]
}

export function taskEndLine(task: DashTask, tone: DashLogTone, at: number): LogLine {
  return { ...taskActor(task), at, text: endedText(tone, at - task.startedAt, task.description), tone }
}

// The tasks in `before` that `after` no longer holds.
export function droppedTasks(before: readonly DashTask[], after: readonly DashTask[]): DashTask[] {
  const kept = new Set(after.map(task => task.id))

  return before.filter(task => !kept.has(task.id))
}

// Local wall-clock time of an entry.
export function clockText(at: number, hasSeconds: boolean): string {
  const date = new Date(at)
  const parts = [date.getHours(), date.getMinutes(), ...(hasSeconds ? [date.getSeconds()] : [])]

  return parts.map(twoDigits).join(CLOCK_SEPARATOR)
}

// newer and older: the entries below and above the window.
export type LogWindow = { entries: DashLogEntry[]; newer: number; older: number }

// The index of the window's last entry: the newest at or before the anchor,
// never so high in the log that the window would show fewer rows than it has.
function windowBottom(log: readonly DashLogEntry[], anchor: number | null, rows: number): number {
  const lowest = Math.min(rows, log.length) - 1

  if (anchor === null) {
    return log.length - 1
  }

  let bottom = -1

  for (const [index, entry] of log.entries()) {
    if (entry.seq <= anchor) {
      bottom = index
    }
  }

  return Math.max(lowest, bottom)
}

export function logWindow(log: readonly DashLogEntry[], anchor: number | null, rows: number): LogWindow {
  const bottom = windowBottom(log, anchor, rows)
  const top = Math.max(0, bottom - rows + 1)

  return { entries: log.slice(top, bottom + 1), newer: log.length - 1 - bottom, older: top }
}

// Where the anchor goes after the person scrolls `by` rows (negative toward
// older entries); null once the window reaches the newest, so it follows again.
export function scrolledAnchor(log: readonly DashLogEntry[], anchor: number | null, rows: number, by: number): number | null {
  const lowest = Math.min(rows, log.length) - 1
  const bottom = Math.min(log.length - 1, Math.max(lowest, windowBottom(log, anchor, rows) + by))

  return bottom >= log.length - 1 ? null : (log[bottom]?.seq ?? null)
}

// What `ui.scroll` tells of a move: the window's first row after it, the
// rows asked for, and the window's and tree's heights.
export type ScrollMove = { offset: number; by: number; bodyRows: number; contentRows: number }

// The window's first row as the move starts. `offset` is that row plus `by`,
// clamped to the tree, so it is exact unless the clamp cut the move short;
// then it started between the edge and `by` rows from it, and `lastRead`, the
// offset the last drawing read, picks the row within that span.
export function rowBeforeMove(move: ScrollMove, lastRead: number): number {
  const last = Math.max(0, move.contentRows - move.bodyRows)

  if (move.by < 0 && move.offset === 0) {
    return Math.min(Math.max(0, lastRead), Math.min(last, -move.by))
  }

  if (move.by > 0 && move.offset === last) {
    return Math.min(last, Math.max(lastRead, last - move.by, 0))
  }

  return move.offset - move.by
}

export type SplitCells = { first: string; second: string }

// One bar split in two by `firstPercent`, each part drawn in full blocks.
export function splitCells(firstPercent: number, cells: number): SplitCells {
  const first = Math.min(cells, Math.max(0, Math.round((firstPercent * cells) / PERCENT_FULL)))

  return { first: FULL_BLOCK.repeat(first), second: FULL_BLOCK.repeat(cells - first) }
}

function activeFirst(a: WorkerView, b: WorkerView): number {
  return Number(b.isActive) - Number(a.isActive)
}

export function buildView(snapshot: DashSnapshot): DashView {
  const now = snapshot.live.now
  const agents = snapshot.live.agents.map(agent => agentView(agent, now, snapshot.agentModels, snapshot.agentWork))
  const subagents = agents.filter(agent => agent.kind === 'subagent').sort(activeFirst)
  const teammates = agents.filter(agent => agent.kind === 'teammate')
  const tasks = snapshot.tasks.map(task => taskView(task, now))
  const mainModel = modelDetailText(snapshot.mainModel)

  const workers = {
    activeSubagents: subagents.filter(agent => agent.isActive).length,
    activeTeammates: teammates.filter(agent => agent.isActive).length,
    tasks,
  }

  return {
    headline: headlineOf(snapshot, workers),
    modelText: mainModel === '' ? null : mainModel,
    lastReplyText: lastReplyText(snapshot.lastTurn, now),
    meters: meterViews(snapshot.usage, now, snapshot.hasResponse, snapshot.compactions),
    limitsNote: limitsNoteOf(snapshot.usage, snapshot.hasResponse),
    tokens: tokenView(snapshot.tokens, snapshot.usage?.costUsd ?? null),
    subagents,
    teammates,
    tasks,
    activeSubagents: workers.activeSubagents,
    activeTeammates: workers.activeTeammates,
    idleTeammates: teammates.filter(agent => agent.isIdle).length,
    doneSubagents: snapshot.live.agents.filter(agent => !agent.isTeammate && agent.status === 'completed').length,
    failedSubagents: snapshot.live.agents.filter(
      agent => !agent.isTeammate && (agent.status === 'failed' || agent.status === 'killed'),
    ).length,
    listError: snapshot.live.listError,
  }
}
