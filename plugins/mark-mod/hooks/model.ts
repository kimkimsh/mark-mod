import type {
  DashAgent,
  DashAgentStatus,
  DashCall,
  DashCounts,
  DashLimit,
  DashLive,
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

const NO_READING = '—'

const NOT_MEASURED = 'not measured yet'

export const SUBAGENTS_LABEL = 'subagents'

export const TEAMMATES_LABEL = 'teammates'

export const BACKGROUND_LABEL = 'background'

export const RUNNING_TEXT = 'running'

const ACTIVE_AGENT_STATUSES = new Set<DashAgentStatus>(['pending', 'running', 'waiting'])

const SUBAGENT_TASK_KIND = 'subagent'

const NOTIFICATION_PATTERN = /<task-notification>([\s\S]*?)<\/task-notification>/g

const TASK_ID_PATTERN = /<task-id>([^<]+)<\/task-id>/

const TASK_STATUS_PATTERN = /<status>([^<]+)<\/status>/

// Words a notification ends a task with; any other word (a monitor's event,
// a progress note) leaves the task running until the Stop snapshot says.
const ENDED_TASK_STATUSES = new Set(['completed', 'failed', 'killed'])

export const CONTEXT_METER_KEY = 'context'

const FIVE_HOUR_LIMIT = 'five_hour'

const SEVEN_DAY_LIMIT = 'seven_day'

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
])

export const BAND_LIMIT_KINDS = [FIVE_HOUR_LIMIT, SEVEN_DAY_LIMIT]

export type Severity = 'ok' | 'warn' | 'danger'

export type Phase = 'needs-input' | 'working' | 'waiting' | 'done' | 'interrupted' | 'error' | 'ready'

export type Headline = { phase: Phase; title: string; detail: string; elapsedText: string }

export type MeterView = {
  key: string
  label: string
  isAvailable: boolean
  leftPercent: number | null
  severity: Severity
  valueText: string
  noteText: string
}

export type WorkerKind = 'subagent' | 'teammate' | 'task'

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
}

export type TokenView = {
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

type AgentReading = {
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

export function isAskingTool(tool: string): boolean {
  return ASKING_TOOLS.has(tool)
}

// One prompt may carry several notifications when tasks end together.
export function endedTaskIds(text: string): string[] {
  const ids: string[] = []

  for (const notification of text.matchAll(NOTIFICATION_PATTERN)) {
    const body = notification[1] ?? ''
    const id = TASK_ID_PATTERN.exec(body)?.[1]?.trim()
    const status = TASK_STATUS_PATTERN.exec(body)?.[1]?.trim()

    if (id !== undefined && status !== undefined && ENDED_TASK_STATUSES.has(status)) {
      ids.push(id)
    }
  }

  return ids
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

// Agent loops are drawn from $.agent.list(); the same loops also appear in
// background_tasks, so an entry naming a listed agent would show it twice.
export function tasksFromReading(
  readings: readonly TaskReading[],
  previous: readonly DashTask[],
  agentIds: ReadonlySet<string>,
  now: number,
): DashTask[] {
  const known = new Map(previous.map(task => [task.id, task]))
  const tasks: DashTask[] = []

  for (const reading of readings) {
    if (reading.type === SUBAGENT_TASK_KIND || agentIds.has(reading.id)) {
      continue
    }

    // A row keeps the name it was first drawn with.
    const seen = known.get(reading.id)

    tasks.push({
      id: reading.id,
      kind: reading.type,
      description: seen?.description ?? (reading.description === '' ? (reading.command ?? reading.type) : reading.description),
      startedAt: seen?.startedAt ?? now,
    })
  }

  return tasks
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

function severityOf(usedPercent: number): Severity {
  if (usedPercent >= SEVERITY_DANGER_PERCENT) {
    return 'danger'
  }

  return usedPercent >= SEVERITY_WARN_PERCENT ? 'warn' : 'ok'
}

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, warn: 1, danger: 2 }

function worseOf(a: Severity, b: Severity): Severity {
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
    return `${minutes}m${twoDigits(seconds % SECONDS_PER_MINUTE)}s`
  }

  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / MINUTES_PER_HOUR)

  if (hours < HOURS_PER_DAY) {
    return `${hours}h${twoDigits(minutes % MINUTES_PER_HOUR)}m`
  }

  return `${Math.floor(hours / HOURS_PER_DAY)}d${hours % HOURS_PER_DAY}h`
}

// The stored clock is coarse while idle, so seconds there would be invented.
function formatAgo(ms: number): string {
  const minutes = Math.floor(ms / (MS_PER_SECOND * SECONDS_PER_MINUTE))

  if (minutes < 1) {
    return 'just now'
  }

  return minutes < MINUTES_PER_HOUR ? `${minutes}m ago` : `${formatDuration(ms)} ago`
}

function contextMeter(usage: DashUsage | null): MeterView {
  const usedPercent = usage?.contextPercent ?? null
  const windowText = usage === null ? NO_READING : formatTokens(usage.contextWindow)
  const tokensText = usage === null || usage.contextTokens === null ? NO_READING : formatTokens(usage.contextTokens)
  const leftPercent = usedPercent === null ? null : Math.max(0, PERCENT_FULL - usedPercent)

  return {
    key: CONTEXT_METER_KEY,
    label: 'Context',
    isAvailable: true,
    leftPercent,
    severity: usedPercent === null ? 'ok' : severityOf(usedPercent),
    valueText: leftPercent === null ? NOT_MEASURED : `${Math.floor(leftPercent)}% left`,
    noteText: `${tokensText} / ${windowText}`,
  }
}

function limitMeter(kind: string, limit: DashLimit | undefined, now: number, hasResponse: boolean): MeterView {
  const label = LIMIT_LABELS.get(kind) ?? kind

  if (limit === undefined) {
    return {
      key: kind,
      label,
      isAvailable: !hasResponse,
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

function meterViews(usage: DashUsage | null, now: number, hasResponse: boolean): MeterView[] {
  const limits = usage?.limits ?? []
  const meters = [contextMeter(usage)]
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

function tokenView(tokens: DashTokens, costUsd: number | null): TokenView {
  const all = mergeCounts(tokens.main, tokens.agents)

  return {
    totalText: formatTokens(sumCounts(all)),
    costText: costUsd === null ? null : formatCost(costUsd),
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

function agentView(agent: DashAgent, now: number): WorkerView {
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
  }
}

function callsDetail(calls: readonly DashCall[]): string {
  const first = calls[0]

  if (first === undefined) {
    return 'thinking'
  }

  return calls.length === 1 ? `${first.tool} ${RUNNING_TEXT}` : `${first.tool} +${calls.length - 1} ${RUNNING_TEXT}`
}

const TURN_END_TITLES: Record<DashTurnEnd['reason'], { phase: Phase; title: string }> = {
  answer: { phase: 'done', title: 'All done' },
  aborted: { phase: 'interrupted', title: 'Interrupted' },
  refusal: { phase: 'error', title: 'Refused' },
  error: { phase: 'error', title: 'Ended with an error' },
}

type WorkerCounts = Pick<DashView, 'activeSubagents' | 'activeTeammates' | 'tasks'>

function waitingTitle(workers: WorkerCounts): string | null {
  const groups = [
    { name: SUBAGENTS_LABEL, count: workers.activeSubagents },
    { name: TEAMMATES_LABEL, count: workers.activeTeammates },
    { name: BACKGROUND_LABEL, count: workers.tasks.length },
  ]

  const names: string[] = []

  for (const group of groups) {
    if (group.count > 0) {
      names.push(group.name)
    }
  }

  return names.length === 0 ? null : `Waiting on ${names.join(', ')}`
}

function headlineOf(snapshot: DashSnapshot, workers: WorkerCounts): Headline {
  const now = snapshot.live.now
  const ask = snapshot.asks[0]

  if (ask !== undefined) {
    return {
      phase: 'needs-input',
      title: 'Needs you',
      detail: ask.tool === PLAN_APPROVAL_TOOL ? 'plan approval' : 'question',
      elapsedText: formatDuration(now - ask.startedAt),
    }
  }

  if (snapshot.isWorking) {
    return {
      phase: 'working',
      title: 'Working',
      detail: callsDetail(snapshot.turn?.calls ?? []),
      elapsedText: '',
    }
  }

  const waiting = waitingTitle(workers)

  if (waiting !== null) {
    return {
      phase: 'waiting',
      title: waiting,
      detail: '',
      elapsedText: '',
    }
  }

  if (snapshot.lastTurn === null) {
    return { phase: 'ready', title: 'Ready', detail: '', elapsedText: '' }
  }

  const end = TURN_END_TITLES[snapshot.lastTurn.reason]

  return {
    phase: end.phase,
    title: end.title,
    detail: `${formatAgo(now - snapshot.lastTurn.endedAt)} · took ${formatDuration(snapshot.lastTurn.durationMs)}`,
    elapsedText: '',
  }
}

function activeFirst(a: WorkerView, b: WorkerView): number {
  return Number(b.isActive) - Number(a.isActive)
}

export function buildView(snapshot: DashSnapshot): DashView {
  const now = snapshot.live.now
  const agents = snapshot.live.agents.map(agent => agentView(agent, now))
  const subagents = agents.filter(agent => agent.kind === 'subagent').sort(activeFirst)
  const teammates = agents.filter(agent => agent.kind === 'teammate')
  const tasks = snapshot.tasks.map(task => taskView(task, now))

  const workers = {
    activeSubagents: subagents.filter(agent => agent.isActive).length,
    activeTeammates: teammates.filter(agent => agent.isActive).length,
    tasks,
  }

  return {
    headline: headlineOf(snapshot, workers),
    meters: meterViews(snapshot.usage, now, snapshot.hasResponse),
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
