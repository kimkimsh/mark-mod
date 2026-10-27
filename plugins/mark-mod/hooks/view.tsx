import type { Color, Elements, RenderElement } from 'claude-code'

import {
  BACKGROUND_LABEL,
  BAND_LIMIT_KINDS,
  CONTEXT_METER_KEY,
  RUNNING_TEXT,
  SUBAGENTS_LABEL,
  TEAMMATES_LABEL,
  barCells,
  cellWidth,
  clipCells,
} from './model'
import type { DashView, MeterView, Phase, Severity, WorkerView } from './model'

export type Kit = Pick<Elements['mobile'], 'Box' | 'Text'>

// The engine's own footer rows start two cells in; the band lines up with
// them so it reads as part of the prompt area, not as a transcript row.
const BAND_INDENT = 2

const BAR_CELLS_WIDE = 10

const BAR_CELLS_NARROW = 6

const ITEM_GAP = '   '

const NOTE_SEPARATOR = ' · '

const WARNING_MARK = '⚠ '

const BAND_BUTTON_MIN_CELLS = 98

const BAND_COST_MIN_CELLS = 78

const BAND_TOKENS_MIN_CELLS = 50

const BAND_ROWS_FULL = 3

const BAND_ROWS_TWO = 2

const BAND_WORKER_ITEMS = 4

const BAND_WORKER_NAME_CELLS = 24

const PANE_BAR_CELLS_WIDE = 16

const PANE_BAR_CELLS_NARROW = 10

const PANE_COLUMNS_WIDE = 64

const PANE_LABEL_COLUMNS = 10

const PANE_WORKER_LABEL_COLUMNS = 16

const PANE_GLYPH_COLUMNS = 2

const PANE_AGE_COLUMNS = 7

const PHASE_STYLE: Record<Phase, { glyph: string; color: Color }> = {
  'needs-input': { glyph: '◆', color: 'warning' },
  working: { glyph: '●', color: 'claude' },
  waiting: { glyph: '◌', color: 'suggestion' },
  done: { glyph: '✓', color: 'success' },
  interrupted: { glyph: '■', color: 'inactive' },
  error: { glyph: '✕', color: 'error' },
  ready: { glyph: '○', color: 'inactive' },
}

// Healthy gauges stay grey: the band is on screen all day, and colour is kept
// for the moments that need attention.
const SEVERITY_COLOR: Record<Severity, Color> = {
  ok: 'inactive',
  warn: 'warning',
  danger: 'error',
}

type MeterLayout = { barCells: number; noteKeys: readonly string[] }

function meterVisibleInBand(meter: MeterView): boolean {
  return meter.isAvailable && (meter.key === CONTEXT_METER_KEY || BAND_LIMIT_KINDS.includes(meter.key))
}

function valueText(meter: MeterView): string {
  return meter.severity === 'danger' ? WARNING_MARK + meter.valueText : meter.valueText
}

function meterCells(meter: MeterView, layout: MeterLayout): number {
  const bar = layout.barCells > 0 && meter.leftPercent !== null ? layout.barCells + 1 : 0
  const note = layout.noteKeys.includes(meter.key) && meter.noteText !== '' ? cellWidth(NOTE_SEPARATOR + meter.noteText) : 0

  return cellWidth(meter.label) + 1 + bar + cellWidth(valueText(meter)) + note
}

function rowCells(meters: readonly MeterView[], layout: MeterLayout): number {
  let cells = 0

  for (const meter of meters) {
    cells += meterCells(meter, layout)
  }

  return cells + cellWidth(ITEM_GAP) * Math.max(0, meters.length - 1)
}

// Richest first. Values always show; the reset notes come next, the 5-hour
// one before the weekly one, and the bars are the first thing to go.
function bandLayouts(): MeterLayout[] {
  const [fiveHour, weekly] = BAND_LIMIT_KINDS
  const bothNotes = [fiveHour ?? '', weekly ?? '']

  return [
    { barCells: BAR_CELLS_WIDE, noteKeys: bothNotes },
    { barCells: BAR_CELLS_NARROW, noteKeys: bothNotes },
    { barCells: 0, noteKeys: bothNotes },
    { barCells: 0, noteKeys: [fiveHour ?? ''] },
    { barCells: 0, noteKeys: [] },
  ]
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

  if (meter.severity === 'ok' || meter.leftPercent === null) {
    return <Text>{meter.valueText}</Text>
  }

  return (
    <Text color={SEVERITY_COLOR[meter.severity]} bold={meter.severity === 'danger'}>
      {valueText(meter)}
    </Text>
  )
}

function bandMeters(kit: Kit, view: DashView, cells: number): RenderElement {
  const { Text } = kit
  const meters = view.meters.filter(meterVisibleInBand)
  const layouts = bandLayouts()
  const layout = layouts.find(one => rowCells(meters, one) <= cells) ?? layouts[layouts.length - 1]
  const showsBar = (meter: MeterView) => (layout?.barCells ?? 0) > 0 && meter.leftPercent !== null

  return (
    <Text wrap="truncate-end">
      {meters.map((meter, index) => (
        <Text key={meter.key}>
          {index === 0 ? '' : ITEM_GAP}
          <Text dimColor>{meter.label} </Text>
          {showsBar(meter) ? meterBar(kit, meter, layout?.barCells ?? 0) : null}
          {showsBar(meter) ? ' ' : ''}
          {meterValue(kit, meter)}
          {layout?.noteKeys.includes(meter.key) && meter.noteText !== '' ? (
            <Text color={meter.severity === 'ok' ? undefined : SEVERITY_COLOR[meter.severity]} dimColor={meter.severity === 'ok'}>
              {NOTE_SEPARATOR}
              {meter.noteText}
            </Text>
          ) : null}
        </Text>
      ))}
    </Text>
  )
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
    counts.push(`${SUBAGENTS_LABEL} ${view.activeSubagents}`)
  }

  if (view.activeTeammates > 0) {
    counts.push(`${TEAMMATES_LABEL} ${view.activeTeammates}/${view.teammates.length} working`)
  }

  if (view.tasks.length > 0) {
    counts.push(`${BACKGROUND_LABEL} ${view.tasks.length}`)
  }

  return counts.join(NOTE_SEPARATOR)
}

function workerName(worker: WorkerView): string {
  return clipCells(worker.kind === 'task' ? worker.description : worker.label, BAND_WORKER_NAME_CELLS)
}

function workerDetail(worker: WorkerView): string {
  return worker.modelText === '' ? worker.ageText : `${worker.modelText} ${worker.ageText}`
}

function bandWorkers(kit: Kit, view: DashView): RenderElement | null {
  const { Text } = kit
  const workers = activeWorkers(view)

  if (workers.length === 0) {
    return null
  }

  const shown = workers.slice(0, BAND_WORKER_ITEMS)
  const more = workers.length - shown.length

  return (
    <Text wrap="truncate-end">
      <Text color="suggestion">{workerCounts(view)}</Text>
      {shown.map(worker => (
        <Text key={worker.id}>
          {ITEM_GAP}
          {workerName(worker)} <Text dimColor>{workerDetail(worker)}</Text>
        </Text>
      ))}
      {more > 0 ? (
        <Text dimColor>
          {ITEM_GAP}+{more}
        </Text>
      ) : null}
    </Text>
  )
}

function bandStatus(kit: Kit, view: DashView, cells: number, trailing: RenderElement): RenderElement {
  const { Box, Text } = kit
  const { tokens } = view

  return (
    <Box flexDirection="row" flexShrink={0} gap={1} paddingLeft={1}>
      {view.listError === null ? null : <Text color="warning">{WARNING_MARK}refresh failed</Text>}
      {cells >= BAND_TOKENS_MIN_CELLS ? <Text dimColor>tokens {tokens.totalText}</Text> : null}
      {cells >= BAND_COST_MIN_CELLS && tokens.costText !== null ? <Text dimColor>{tokens.costText}</Text> : null}
      {cells >= BAND_BUTTON_MIN_CELLS ? trailing : null}
    </Box>
  )
}

export function bandTree(
  kit: Kit,
  view: DashView,
  columns: number,
  maxRows: number,
  trailing: RenderElement,
): RenderElement {
  const { Box } = kit
  const cells = columns - BAND_INDENT
  const workers = maxRows >= BAND_ROWS_FULL ? bandWorkers(kit, view) : null

  return (
    <Box flexDirection="column" width={columns} paddingLeft={BAND_INDENT}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>{headlineText(kit, view)}</Box>
        {bandStatus(kit, view, cells, trailing)}
      </Box>
      {maxRows >= BAND_ROWS_TWO ? bandMeters(kit, view, cells) : null}
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
        {meter.noteText === '' ? null : (
          <Text dimColor>
            {NOTE_SEPARATOR}
            {meter.noteText}
          </Text>
        )}
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
        <Text wrap="truncate-end">
          <Text dimColor={isDim}>{worker.modelText === '' ? null : `${worker.modelText} `}</Text>
          <Text dimColor>{worker.description}</Text>
        </Text>
      </Box>
      <Box width={PANE_AGE_COLUMNS} flexShrink={0} justifyContent="flex-end">
        <Text dimColor={isDim}>{worker.isActive ? worker.ageText : worker.statusText}</Text>
      </Box>
    </Box>
  )
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Group names are lower case for the band's running text; a pane heading
// starts with a capital.
function paneWorkers(
  kit: Kit,
  group: string,
  summary: string,
  workers: readonly WorkerView[],
  footer: string,
): RenderElement {
  const { Box, Text } = kit
  const title = sentenceCase(group)

  if (workers.length === 0 && footer === '') {
    return (
      <Box marginTop={1}>
        <Text>
          <Text bold>{title}</Text>
          <Text dimColor> none</Text>
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {paneSectionTitle(kit, title, summary)}
      {workers.map(worker => paneWorker(kit, worker))}
      {footer === '' ? null : <Text dimColor>{footer}</Text>}
    </Box>
  )
}

function finishedSummary(view: DashView): string {
  const parts: string[] = []

  if (view.doneSubagents > 0) {
    parts.push(`done ${view.doneSubagents}`)
  }

  if (view.failedSubagents > 0) {
    parts.push(`failed ${view.failedSubagents}`)
  }

  return parts.join(NOTE_SEPARATOR)
}

export function paneTree(kit: Kit, view: DashView, columns: number): RenderElement {
  const { Box, Text } = kit
  const { tokens } = view
  const cells = columns >= PANE_COLUMNS_WIDE ? PANE_BAR_CELLS_WIDE : PANE_BAR_CELLS_NARROW
  const runningSubagents = view.subagents.filter(worker => worker.isActive)
  const teammateSummary = view.teammates.length === 0 ? '' : `${view.activeTeammates} working · ${view.idleTeammates} idle`

  return (
    <Box flexDirection="column" width={columns}>
      {headlineText(kit, view)}
      {view.listError === null ? null : (
        <Text color="warning" wrap="truncate-end">
          {WARNING_MARK}Could not read the agent list: {view.listError}
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {paneSectionTitle(kit, 'Usage', '')}
        {view.meters.map(meter => paneMeter(kit, meter, cells))}
        {view.limitsNote === null ? null : <Text dimColor>{view.limitsNote}</Text>}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {paneSectionTitle(kit, 'Tokens', tokens.costText === null ? tokens.totalText : `${tokens.totalText} · ${tokens.costText}`)}
        <Text dimColor wrap="truncate-end">
          input {tokens.inputText} · output {tokens.outputText} · cache read {tokens.cacheReadText} · cache write {tokens.cacheWriteText}
        </Text>
        <Text dimColor wrap="truncate-end">
          main {tokens.mainText} · agents {tokens.agentsText}
        </Text>
      </Box>
      {paneWorkers(
        kit,
        SUBAGENTS_LABEL,
        runningSubagents.length === 0 ? '' : `${runningSubagents.length} ${RUNNING_TEXT}`,
        runningSubagents,
        finishedSummary(view),
      )}
      {paneWorkers(kit, TEAMMATES_LABEL, teammateSummary, view.teammates, '')}
      {paneWorkers(kit, BACKGROUND_LABEL, view.tasks.length === 0 ? '' : `${view.tasks.length} ${RUNNING_TEXT}`, view.tasks, '')}
    </Box>
  )
}
