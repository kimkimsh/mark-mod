import type { Color, Elements, RenderElement } from 'claude-code'

import { BAND_LIMIT_KINDS, CONTEXT_METER_KEY, barCells } from './model'
import type { DashView, MeterView, Phase, Severity, WorkerView } from './model'

export type Kit = Pick<Elements['mobile'], 'Box' | 'Text'>

const BAR_CELLS_WIDE = 10

const BAR_CELLS_MEDIUM = 6

const BAND_COLUMNS_WIDE = 118

const BAND_COLUMNS_MEDIUM = 92

const BAND_COLUMNS_NARROW = 64

const BAND_ROWS_FULL = 3

const BAND_ROWS_TWO = 2

const BAND_WORKER_ITEMS = 4

const BAND_TASK_LABEL_CHARS = 28

const PANE_BAR_CELLS_WIDE = 16

const PANE_BAR_CELLS_NARROW = 10

const PANE_COLUMNS_WIDE = 64

const PANE_LABEL_COLUMNS = 10

const PANE_WORKER_LABEL_COLUMNS = 16

const PANE_GLYPH_COLUMNS = 2

const PANE_AGE_COLUMNS = 7

const ELLIPSIS = '…'

const BAND_ITEM_GAP = '   '

const PHASE_STYLE: Record<Phase, { glyph: string; color: Color }> = {
  'needs-input': { glyph: '◆', color: 'warning' },
  working: { glyph: '●', color: 'claude' },
  waiting: { glyph: '◌', color: 'suggestion' },
  done: { glyph: '✓', color: 'success' },
  interrupted: { glyph: '■', color: 'inactive' },
  error: { glyph: '✕', color: 'error' },
  ready: { glyph: '○', color: 'inactive' },
}

const SEVERITY_COLOR: Record<Severity, Color> = {
  ok: 'success',
  warn: 'warning',
  danger: 'error',
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit - 1) + ELLIPSIS
}

function meterVisibleInBand(meter: MeterView): boolean {
  return meter.isAvailable && (meter.key === CONTEXT_METER_KEY || BAND_LIMIT_KINDS.includes(meter.key))
}

function headlineText(kit: Kit, view: DashView): RenderElement {
  const { Text } = kit
  const style = PHASE_STYLE[view.headline.phase]
  const { title, detail, elapsedText } = view.headline

  return (
    <Text wrap="truncate-end">
      <Text color={style.color} bold>
        {style.glyph} {title}
      </Text>
      {detail === '' ? null : `  ${detail}`}
      {elapsedText === '' ? null : <Text dimColor> · {elapsedText}</Text>}
    </Text>
  )
}

function meterBar(kit: Kit, meter: MeterView, cells: number): RenderElement {
  const { Text } = kit
  const { fill, rest } = barCells(meter.leftPercent, cells)

  return (
    <Text>
      <Text color={SEVERITY_COLOR[meter.severity]}>{fill}</Text>
      <Text dimColor>{rest}</Text>
    </Text>
  )
}

function meterValue(kit: Kit, meter: MeterView): RenderElement {
  const { Text } = kit
  const isAlarming = meter.leftPercent !== null && meter.severity !== 'ok'

  return isAlarming ? <Text color={SEVERITY_COLOR[meter.severity]}>{meter.valueText}</Text> : <Text>{meter.valueText}</Text>
}

function bandMeters(kit: Kit, view: DashView, columns: number): RenderElement {
  const { Text } = kit
  const cells = columns >= BAND_COLUMNS_WIDE ? BAR_CELLS_WIDE : columns >= BAND_COLUMNS_MEDIUM ? BAR_CELLS_MEDIUM : 0
  const showsNotes = columns >= BAND_COLUMNS_NARROW
  const parts: RenderElement[] = []

  for (const meter of view.meters) {
    if (!meterVisibleInBand(meter)) {
      continue
    }

    const showsNote = showsNotes && meter.key !== CONTEXT_METER_KEY && meter.noteText !== ''

    parts.push(
      <Text key={meter.key}>
        {parts.length === 0 ? '' : BAND_ITEM_GAP}
        <Text dimColor>{meter.label} </Text>
        {cells > 0 && meter.leftPercent !== null ? meterBar(kit, meter, cells) : null}
        {cells > 0 && meter.leftPercent !== null ? ' ' : ''}
        {meterValue(kit, meter)}
        {showsNote ? <Text dimColor> · {meter.noteText}</Text> : null}
      </Text>,
    )
  }

  return <Text wrap="truncate-end">{parts}</Text>
}

function activeWorkers(view: DashView): WorkerView[] {
  const workers: WorkerView[] = []

  for (const worker of [...view.subagents, ...view.teammates, ...view.tasks]) {
    if (worker.isActive) {
      workers.push(worker)
    }
  }

  return workers
}

function workerCounts(view: DashView): string {
  const counts: string[] = []

  if (view.activeSubagents > 0) {
    counts.push(`서브에이전트 ${view.activeSubagents}`)
  }

  if (view.activeTeammates > 0 || view.idleTeammates > 0) {
    counts.push(`팀메이트 ${view.activeTeammates}/${view.activeTeammates + view.idleTeammates}`)
  }

  if (view.tasks.length > 0) {
    counts.push(`백그라운드 ${view.tasks.length}`)
  }

  return counts.join(' · ')
}

function workerName(worker: WorkerView): string {
  return worker.kind === 'task' ? clip(worker.description, BAND_TASK_LABEL_CHARS) : worker.label
}

function bandWorkers(kit: Kit, view: DashView): RenderElement | null {
  const { Text } = kit
  const workers = activeWorkers(view)

  if (workers.length === 0 && view.idleTeammates === 0) {
    return null
  }

  const shown = workers.slice(0, BAND_WORKER_ITEMS)
  const more = workers.length - shown.length

  return (
    <Text wrap="truncate-end">
      <Text color="suggestion">{workerCounts(view)}</Text>
      {shown.map(worker => (
        <Text key={worker.id}>
          {BAND_ITEM_GAP}
          {workerName(worker)} <Text dimColor>{worker.ageText}</Text>
        </Text>
      ))}
      {more > 0 ? <Text dimColor>{BAND_ITEM_GAP}+{more}</Text> : null}
    </Text>
  )
}

export function bandTree(
  kit: Kit,
  view: DashView,
  columns: number,
  maxRows: number,
  trailing: RenderElement,
): RenderElement {
  const { Box, Text } = kit
  const { tokens } = view
  const workers = maxRows >= BAND_ROWS_FULL ? bandWorkers(kit, view) : null

  return (
    <Box flexDirection="column" width={columns}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>{headlineText(kit, view)}</Box>
        <Box flexDirection="row" flexShrink={0} gap={1} paddingLeft={1}>
          {view.listError === null ? null : <Text color="warning">⚠</Text>}
          <Text dimColor>
            토큰 {tokens.totalText}
            {tokens.costText === null ? '' : ` · ${tokens.costText}`}
          </Text>
          {trailing}
        </Box>
      </Box>
      {maxRows >= BAND_ROWS_TWO ? bandMeters(kit, view, columns) : null}
      {workers}
    </Box>
  )
}

function paneSectionTitle(kit: Kit, title: string, summary: string): RenderElement {
  const { Text } = kit

  return (
    <Text>
      <Text bold>{title}</Text>
      {summary === '' ? null : <Text dimColor> {summary}</Text>}
    </Text>
  )
}

function paneMeter(kit: Kit, meter: MeterView, cells: number): RenderElement {
  const { Box, Text } = kit

  return (
    <Box key={meter.key} flexDirection="row">
      <Box width={PANE_LABEL_COLUMNS} flexShrink={0}>
        <Text dimColor>{meter.label}</Text>
      </Box>
      <Text wrap="truncate-end">
        {meterBar(kit, meter, cells)} {meterValue(kit, meter)}
        {meter.noteText === '' ? null : <Text dimColor> · {meter.noteText}</Text>}
      </Text>
    </Box>
  )
}

function workerGlyph(kit: Kit, worker: WorkerView): RenderElement {
  const { Text } = kit

  if (worker.isActive) {
    return <Text color="claude">●</Text>
  }

  return worker.isIdle ? <Text color="inactive">◦</Text> : <Text dimColor>✓</Text>
}

function paneWorker(kit: Kit, worker: WorkerView): RenderElement {
  const { Box, Text } = kit
  const isDim = !worker.isActive

  return (
    <Box key={worker.id} flexDirection="row">
      <Box width={PANE_GLYPH_COLUMNS} flexShrink={0}>
        {workerGlyph(kit, worker)}
      </Box>
      <Box width={PANE_WORKER_LABEL_COLUMNS} flexShrink={0}>
        <Text dimColor={isDim} wrap="truncate-end">
          {worker.isNested ? '↳ ' : ''}
          {worker.label}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {worker.description}
        </Text>
      </Box>
      <Box width={PANE_AGE_COLUMNS} flexShrink={0} justifyContent="flex-end">
        <Text dimColor={isDim}>{worker.isActive ? worker.ageText : worker.statusText}</Text>
      </Box>
    </Box>
  )
}

function paneWorkers(kit: Kit, title: string, summary: string, workers: readonly WorkerView[]): RenderElement {
  const { Box, Text } = kit

  return (
    <Box flexDirection="column" marginTop={1}>
      {paneSectionTitle(kit, title, summary)}
      {workers.length === 0 ? <Text dimColor>  없음</Text> : workers.map(worker => paneWorker(kit, worker))}
    </Box>
  )
}

export function paneTree(kit: Kit, view: DashView, columns: number): RenderElement {
  const { Box, Text } = kit
  const { tokens } = view
  const cells = columns >= PANE_COLUMNS_WIDE ? PANE_BAR_CELLS_WIDE : PANE_BAR_CELLS_NARROW
  const teammateSummary = view.teammates.length === 0 ? '' : `${view.activeTeammates} 작업 중 · ${view.idleTeammates} 유휴`

  return (
    <Box flexDirection="column" width={columns}>
      {headlineText(kit, view)}
      {view.listError === null ? null : (
        <Text color="warning" wrap="truncate-end">
          ⚠ 에이전트 목록을 읽지 못했습니다: {view.listError}
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {paneSectionTitle(kit, '사용량', '')}
        {view.meters.map(meter => paneMeter(kit, meter, cells))}
        {view.limitsNote === null ? null : <Text dimColor>{view.limitsNote}</Text>}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {paneSectionTitle(kit, '토큰', tokens.costText === null ? tokens.totalText : `${tokens.totalText} · ${tokens.costText}`)}
        <Text dimColor wrap="truncate-end">
          입력 {tokens.inputText} · 출력 {tokens.outputText} · 캐시 읽기 {tokens.cacheReadText} · 캐시 쓰기 {tokens.cacheWriteText}
        </Text>
        <Text dimColor wrap="truncate-end">
          메인 {tokens.mainText} · 서브에이전트 {tokens.agentsText}
        </Text>
      </Box>
      {paneWorkers(kit, '서브에이전트', view.activeSubagents === 0 ? '' : `${view.activeSubagents} 실행 중`, view.subagents)}
      {paneWorkers(kit, '팀메이트', teammateSummary, view.teammates)}
      {paneWorkers(kit, '백그라운드', view.tasks.length === 0 ? '' : `${view.tasks.length} 실행 중`, view.tasks)}
    </Box>
  )
}
