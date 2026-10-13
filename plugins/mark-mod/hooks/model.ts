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

export const SEVERITY_WARN_PERCENT = 60

export const SEVERITY_DANGER_PERCENT = 85

const PERCENT_FULL = 100

const MS_PER_SECOND = 1000

const SECONDS_PER_MINUTE = 60

const MINUTES_PER_HOUR = 60

const HOURS_PER_DAY = 24

const SHORT_MINUTES_WITH_SECONDS = 10

const THOUSAND = 1000

const MILLION = 1_000_000

const BILLION = 1_000_000_000

const ONE_DECIMAL_BELOW = 10

const TWO_DECIMALS_BELOW = 10

const CENT = 0.01

const EIGHTHS_PER_CELL = 8

const PARTIAL_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

const FULL_BLOCK = '█'

const EMPTY_BLOCK = '░'

const BLANK_CELL = ' '

const ASKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

const ACTIVE_AGENT_STATUSES = new Set<DashAgentStatus>(['pending', 'running', 'waiting'])

// Agent loops are drawn from $.agent.list(); the same loops also appear in
// background_tasks, so counting them there would show each agent twice.
const AGENT_TASK_KINDS = new Set(['subagent', 'teammate'])

const TASK_ID_PATTERN = /<task-id>([^<]+)<\/task-id>/

export const CONTEXT_METER_KEY = 'context'

export const FIVE_HOUR_LIMIT = 'five_hour'

export const SEVEN_DAY_LIMIT = 'seven_day'

const LIMIT_LABELS = new Map([
  [FIVE_HOUR_LIMIT, '5시간'],
  [SEVEN_DAY_LIMIT, '주간'],
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

export type RateLimitReading = { kind: string; percentUsed: number; resetsAt?: string }

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

export function emptyCounts(): DashCounts {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

export function emptyTokens(): DashTokens {
  return { main: emptyCounts(), agents: emptyCounts() }
}

export function addUsage(counts: DashCounts, usage: UsageCounts): DashCounts {
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

export function sumCounts(counts: DashCounts): number {
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

export function parseTaskNotificationId(text: string): string | null {
  const match = TASK_ID_PATTERN.exec(text)

  return match?.[1]?.trim() ?? null
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

export function tasksFromReading(
  readings: readonly TaskReading[],
  previous: readonly DashTask[],
  now: number,
): DashTask[] {
  const startedAt = new Map(previous.map(task => [task.id, task.startedAt]))
  const tasks: DashTask[] = []

  for (const reading of readings) {
    if (AGENT_TASK_KINDS.has(reading.type)) {
      continue
    }

    tasks.push({
      id: reading.id,
      kind: reading.type,
      label: reading.command ?? reading.description,
      startedAt: startedAt.get(reading.id) ?? now,
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

export function withTask(tasks: readonly DashTask[], task: DashTask): DashTask[] {
  return tasks.some(one => one.id === task.id) ? [...tasks] : [...tasks, task]
}

export function withoutTask(tasks: readonly DashTask[], id: string): DashTask[] {
  return tasks.filter(task => task.id !== id)
}

export function severityOf(usedPercent: number): Severity {
  if (usedPercent >= SEVERITY_DANGER_PERCENT) {
    return 'danger'
  }

  return usedPercent >= SEVERITY_WARN_PERCENT ? 'warn' : 'ok'
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
  if (count < THOUSAND) {
    return String(count)
  }

  if (count < MILLION) {
    const thousands = count / THOUSAND

    return `${trimZeros(thousands.toFixed(thousands < ONE_DECIMAL_BELOW ? 1 : 0))}k`
  }

  if (count < BILLION) {
    const millions = count / MILLION

    return `${trimZeros(millions.toFixed(millions < TWO_DECIMALS_BELOW ? 2 : 1))}M`
  }

  return `${trimZeros((count / BILLION).toFixed(2))}B`
}

export function formatCost(usd: number): string {
  return usd > 0 && usd < CENT ? '<$0.01' : `$${usd.toFixed(2)}`
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / MS_PER_SECOND))

  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)

  if (minutes < SHORT_MINUTES_WITH_SECONDS) {
    return `${minutes}m${String(seconds % SECONDS_PER_MINUTE).padStart(2, '0')}s`
  }

  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / MINUTES_PER_HOUR)

  if (hours < HOURS_PER_DAY) {
    return `${hours}h${String(minutes % MINUTES_PER_HOUR).padStart(2, '0')}m`
  }

  return `${Math.floor(hours / HOURS_PER_DAY)}d${hours % HOURS_PER_DAY}h`
}

// The stored clock is coarse while idle, so seconds there would be invented.
function formatAgo(ms: number): string {
  const minutes = Math.floor(ms / (MS_PER_SECOND * SECONDS_PER_MINUTE))

  if (minutes < 1) {
    return '방금'
  }

  return minutes < MINUTES_PER_HOUR ? `${minutes}m 전` : `${formatDuration(ms)} 전`
}

function contextMeter(usage: DashUsage | null): MeterView {
  const usedPercent = usage?.contextPercent ?? null
  const windowText = usage === null ? '—' : formatTokens(usage.contextWindow)
  const tokensText = usage === null || usage.contextTokens === null ? '—' : formatTokens(usage.contextTokens)
  const leftPercent = usedPercent === null ? null : PERCENT_FULL - usedPercent

  return {
    key: CONTEXT_METER_KEY,
    label: '컨텍스트',
    isAvailable: true,
    leftPercent,
    severity: usedPercent === null ? 'ok' : severityOf(usedPercent),
    valueText: leftPercent === null ? '측정 전' : `${leftPercent}% 남음`,
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
      valueText: hasResponse ? '정보 없음' : '측정 전',
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
      valueText: '리셋됨',
      noteText: '다음 응답에 갱신',
    }
  }

  const leftPercent = Math.max(0, PERCENT_FULL - limit.percentUsed)

  return {
    key: kind,
    label,
    isAvailable: true,
    leftPercent,
    severity: severityOf(limit.percentUsed),
    valueText: `${Math.floor(leftPercent)}% 남음`,
    noteText: limit.resetsAt === null ? '' : `${formatDuration(limit.resetsAt - now)} 후 리셋`,
  }
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

  return hasResponse ? '응답에 한도 정보가 없습니다. API 키로 쓰는 중이면 정상입니다.' : null
}

function tokenView(tokens: DashTokens, costUsd: number | null): TokenView {
  const all = addUsage(tokens.main, {
    input_tokens: tokens.agents.input,
    output_tokens: tokens.agents.output,
    cache_read_input_tokens: tokens.agents.cacheRead,
    cache_creation_input_tokens: tokens.agents.cacheWrite,
  })

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
  pending: '시작 중',
  running: '실행 중',
  waiting: '대기',
  idle: '유휴',
  completed: '완료',
  failed: '실패',
  killed: '중지됨',
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
    description: task.label,
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
    return '생각 중'
  }

  return calls.length === 1 ? `${first.tool} 실행 중` : `${first.tool} 외 ${calls.length - 1}개 실행 중`
}

const TURN_END_TITLES: Record<DashTurnEnd['reason'], { phase: Phase; title: string }> = {
  answer: { phase: 'done', title: '전체 완료' },
  aborted: { phase: 'interrupted', title: '중단됨' },
  refusal: { phase: 'error', title: '응답 거부됨' },
  error: { phase: 'error', title: '오류로 종료' },
}

type WorkerCounts = Pick<DashView, 'activeSubagents' | 'activeTeammates' | 'tasks'>

function waitingTitle(workers: WorkerCounts): string | null {
  const groups = [
    { name: '서브에이전트', count: workers.activeSubagents },
    { name: '팀메이트', count: workers.activeTeammates },
    { name: '백그라운드', count: workers.tasks.length },
  ]

  const names: string[] = []

  for (const group of groups) {
    if (group.count > 0) {
      names.push(group.name)
    }
  }

  return names.length === 0 ? null : `${names.join('·')} 대기`
}

function headlineOf(snapshot: DashSnapshot, workers: WorkerCounts): Headline {
  const now = snapshot.live.now
  const ask = snapshot.asks[0]

  if (ask !== undefined) {
    return {
      phase: 'needs-input',
      title: '입력 필요',
      detail: ask.tool === 'ExitPlanMode' ? '계획 승인을 기다립니다' : '질문에 답해 주세요',
      elapsedText: formatDuration(now - ask.startedAt),
    }
  }

  if (snapshot.isWorking) {
    return {
      phase: 'working',
      title: '응답 중',
      detail: callsDetail(snapshot.turn?.calls ?? []),
      elapsedText: snapshot.turn === null ? '' : formatDuration(now - snapshot.turn.startedAt),
    }
  }

  const waiting = waitingTitle(workers)

  if (waiting !== null) {
    return {
      phase: 'waiting',
      title: waiting,
      detail: '',
      elapsedText: snapshot.lastTurn === null ? '' : formatDuration(now - snapshot.lastTurn.endedAt),
    }
  }

  if (snapshot.lastTurn === null) {
    return { phase: 'ready', title: '대기 중', detail: '', elapsedText: '' }
  }

  const end = TURN_END_TITLES[snapshot.lastTurn.reason]

  return {
    phase: end.phase,
    title: end.title,
    detail: `${formatAgo(now - snapshot.lastTurn.endedAt)} · ${formatDuration(snapshot.lastTurn.durationMs)} 소요`,
    elapsedText: '',
  }
}

export function buildView(snapshot: DashSnapshot): DashView {
  const now = snapshot.live.now
  const agents = snapshot.live.agents.map(agent => agentView(agent, now))
  const subagents = agents.filter(agent => agent.kind === 'subagent')
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
    listError: snapshot.live.listError,
  }
}
