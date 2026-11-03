import type { Color, Elements, RenderElement } from 'claude-code'

import type { DashLogEntry, DashLogSource, DashLogTone } from '../types'
import {
  BAND_LIMIT_KINDS,
  CLAUSE_JOINER,
  CONTEXT_METER_KEY,
  barCells,
  cellWidth,
  clipCells,
  clockText,
  logWindow,
  splitCells,
  worseOf,
} from './model'
import type { DashView, MeterView, Phase, Severity, WorkerKind, WorkerView } from './model'

export type Kit = Pick<Elements['mobile'], 'Box' | 'Text'>

// The engine's own footer rows start two cells in; the band lines up with
// them so it reads as part of the prompt area, not as a transcript row.
const BAND_INDENT = 2

const BAND_BAR_CELLS = 8

// Bars are decided by width alone, so a note that grows during the day
// (a reset time, a pace warning) never makes them come and go.
const BAND_BARS_MIN_CELLS = 110

const ITEM_GAP = '   '

const GROUP_GAP = '     '

const HEADLINE_GAP = '  '

const WARNING_MARK = '⚠ '

const LIST_ERROR_TEXT = "can't read agent list"

const BAND_DASH_MIN_CELLS = 80

// Before each item at a row's right end: after the row's text, then between items.
const RIGHT_ITEM_GAP_CELLS = 1

const BAND_COST_MIN_CELLS = 56

const BAND_ROWS_TWO = 2

const BAND_ROWS_FULL = 3

const BAND_WORKER_ITEMS_WIDE = 4

const BAND_WORKER_ITEMS_NARROW = 3

const BAND_WORKER_ITEMS_WIDE_MIN_CELLS = 120

const BAND_WORKER_NAME_CELLS = 24

const PANE_BAR_CELLS_WIDE = 16

const PANE_BAR_CELLS_NARROW = 10

const PANE_COLUMNS_WIDE = 64

const PANE_LABEL_COLUMNS = 12

// Between a pane label and its value, when a label (a limit's name the API
// made up) is longer than the usual column.
const PANE_LABEL_GAP = 2

const PANE_GLYPH_COLUMNS = 2

const PANE_WORKER_LABEL_COLUMNS = 16

const PANE_AGE_COLUMNS = 8

const NESTED_MARK = '↳ '

const PHASE_STYLE: Record<Phase, { glyph: string; color: Color }> = {
  'needs-input': { glyph: '◆', color: 'warning' },
  working: { glyph: '●', color: 'claude' },
  waiting: { glyph: '◌', color: 'suggestion' },
  done: { glyph: '✓', color: 'success' },
  interrupted: { glyph: '■', color: 'inactive' },
  error: { glyph: '✕', color: 'error' },
  ready: { glyph: '○', color: 'inactive' },
}

// The glyph always carries the state's colour; the title does only when the
// state asks something of the person or went wrong. The band is on screen all
// day, and a green "Done" after every reply would be noise.
const LOUD_PHASES = new Set<Phase>(['needs-input', 'error'])

// A resting state's detail is history; a live one's is what is happening now.
const LIVE_PHASES = new Set<Phase>(['needs-input', 'working'])

// Nothing runs and nothing went wrong: the pane's state card keeps a quiet
// border. Every other state, waiting on background work included, borders
// the card in its own colour.
const RESTING_PHASES = new Set<Phase>(['done', 'interrupted', 'ready'])

// Text beside a gauge stays grey while healthy: colour in words is kept for
// the moments that need attention.
const SEVERITY_COLOR: Record<Severity, Color> = {
  ok: 'inactive',
  warn: 'warning',
  danger: 'error',
}

// A gauge's fill reads as a fuel gauge: green while there is plenty left.
const GAUGE_COLOR: Record<Severity, Color> = {
  ok: 'success',
  warn: 'warning',
  danger: 'error',
}

const TRACK_COLOR: Color = 'subtle'

// One hue per kind of worker, the same on the band, the pane's agent rows and
// the activity log, so a name's colour says what it is. Theme keys, so both
// the light and the dark theme keep them readable.
const WORKER_COLOR: Record<WorkerKind, Color> = {
  subagent: 'permission',
  teammate: 'merged',
  task: 'planMode',
}

const MAIN_COLOR: Color = 'claude'

const SOURCE_COLOR: Record<DashLogSource, Color> = {
  you: 'text',
  main: MAIN_COLOR,
  subagent: WORKER_COLOR.subagent,
  teammate: WORKER_COLOR.teammate,
  task: WORKER_COLOR.task,
  session: 'inactive',
}

// Outcomes carry a mark in a column of their own, so a failure stands out in
// a scrolling list; a plain step leaves the column blank.
const TONE_STYLE: Record<DashLogTone, { mark: string; color: Color | undefined }> = {
  plain: { mark: '  ', color: undefined },
  done: { mark: '✓ ', color: 'success' },
  failed: { mark: '✕ ', color: 'error' },
  stopped: { mark: '■ ', color: 'warning' },
}

type MeterLayout = { barCells: number; noteKeys: readonly string[] }

function valueText(meter: MeterView): string {
  return meter.severity === 'danger' ? WARNING_MARK + meter.valueText : meter.valueText
}

// Context always, so the row does not shift when its reading comes and goes
// around a compaction; 5-hour and Weekly once they have a reading. Any other
// window the API reports is the pane's.
function meterVisibleInBand(meter: MeterView): boolean {
  return meter.isAvailable && (meter.key === CONTEXT_METER_KEY || (meter.isMeasured && BAND_LIMIT_KINDS.includes(meter.key)))
}

function showsBar(meter: MeterView, layout: MeterLayout): boolean {
  return layout.barCells > 0 && meter.leftPercent !== null
}

function meterCells(meter: MeterView, layout: MeterLayout): number {
  const bar = showsBar(meter, layout) ? layout.barCells + 1 : 0
  const note = layout.noteKeys.includes(meter.key) && meter.noteText !== '' ? cellWidth(CLAUSE_JOINER + meter.noteText) : 0

  return cellWidth(meter.label) + 1 + bar + cellWidth(valueText(meter)) + note
}

function rowCells(meters: readonly MeterView[], layout: MeterLayout): number {
  let cells = 0

  for (const meter of meters) {
    cells += meterCells(meter, layout)
  }

  return cells + cellWidth(ITEM_GAP) * Math.max(0, meters.length - 1)
}

// Richest first. Values always show; the reset notes go before anything else,
// the weekly one first.
function bandLayouts(cells: number): MeterLayout[] {
  const [fiveHour, weekly] = BAND_LIMIT_KINDS
  const noteSets = [[fiveHour ?? '', weekly ?? ''], [fiveHour ?? ''], []]
  const layouts: MeterLayout[] = []

  if (cells >= BAND_BARS_MIN_CELLS) {
    for (const noteKeys of noteSets) {
      layouts.push({ barCells: BAND_BAR_CELLS, noteKeys })
    }
  }

  for (const noteKeys of noteSets) {
    layouts.push({ barCells: 0, noteKeys })
  }

  return layouts
}

function meterBar(kit: Kit, meter: MeterView, cells: number): RenderElement {
  const { Text } = kit
  const { fill, rest } = barCells(meter.leftPercent, cells)

  return (
    <Text>
      <Text color={GAUGE_COLOR[meter.severity]}>{fill}</Text>
      <Text color={TRACK_COLOR}>{rest}</Text>
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

function meterNote(kit: Kit, meter: MeterView, joiner: string): RenderElement {
  const { Text } = kit
  const isQuiet = meter.severity === 'ok'

  return (
    <Text color={isQuiet ? undefined : SEVERITY_COLOR[meter.severity]} dimColor={isQuiet}>
      {joiner}
      {meter.noteText}
    </Text>
  )
}

// Past the narrowest layout whole gauges go, healthy ones from the end first,
// rather than the terminal cutting the last one mid-number.
function fittedMeters(meters: readonly MeterView[], layout: MeterLayout, cells: number): MeterView[] {
  const kept = [...meters]

  while (kept.length > 1 && rowCells(kept, layout) > cells) {
    const healthy = kept.map(meter => meter.severity === 'ok').lastIndexOf(true)
    kept.splice(healthy < 0 ? kept.length - 1 : healthy, 1)
  }

  return kept
}

function bandMeters(kit: Kit, view: DashView, cells: number): RenderElement | null {
  const { Text } = kit
  const visible = view.meters.filter(meterVisibleInBand)
  const layouts = bandLayouts(cells)
  const layout = layouts.find(one => rowCells(visible, one) <= cells) ?? layouts[layouts.length - 1]

  if (visible.length === 0 || layout === undefined) {
    return null
  }

  const meters = fittedMeters(visible, layout, cells)

  return (
    <Text wrap="truncate-end">
      {meters.map((meter, index) => (
        <Text key={meter.key}>
          {index === 0 ? '' : ITEM_GAP}
          <Text dimColor>{meter.label} </Text>
          {showsBar(meter, layout) ? meterBar(kit, meter, layout.barCells) : null}
          {showsBar(meter, layout) ? ' ' : ''}
          {meterValue(kit, meter)}
          {layout.noteKeys.includes(meter.key) && meter.noteText !== '' ? meterNote(kit, meter, CLAUSE_JOINER) : null}
        </Text>
      ))}
    </Text>
  )
}

// The worst gauge that needs attention, for a band folded to one row.
function alertMeter(view: DashView): MeterView | null {
  let worst: MeterView | null = null

  for (const meter of view.meters) {
    const current = worst?.severity ?? 'ok'

    if (meter.leftPercent !== null && worseOf(current, meter.severity) !== current) {
      worst = meter
    }
  }

  return worst
}

// Whole clauses, as many as fit; only a live activity (one clause, a file name
// or a command) is cut to fit, since dropping it would leave nothing.
function fittedDetail(clauses: readonly string[], budget: number, canClip: boolean): string {
  for (let count = clauses.length; count > 0; count--) {
    const text = clauses.slice(0, count).join(CLAUSE_JOINER)

    if (cellWidth(text) <= budget) {
      return text
    }
  }

  const [first] = clauses

  return canClip && first !== undefined && budget > 1 ? clipCells(first, budget) : ''
}

function headlineText(kit: Kit, view: DashView, detailBudget: number): RenderElement {
  const { Text } = kit
  const { phase, title, detail } = view.headline
  const style = PHASE_STYLE[phase]
  const fitted = fittedDetail(detail, detailBudget - cellWidth(HEADLINE_GAP), LIVE_PHASES.has(phase))

  return (
    <Text wrap="truncate-end">
      <Text color={style.color}>{style.glyph} </Text>
      <Text color={LOUD_PHASES.has(phase) ? style.color : undefined} bold>
        {title}
      </Text>
      {fitted === '' ? null : <Text dimColor={!LIVE_PHASES.has(phase)}>{HEADLINE_GAP + fitted}</Text>}
    </Text>
  )
}

function headlineCells(view: DashView): number {
  return cellWidth(`${PHASE_STYLE[view.headline.phase].glyph} ${view.headline.title}`)
}

type RightItem = { key: string; text: string; element: RenderElement }

// A button the register draws, since it owns the press; the view only places
// it and counts its label's cells.
export type BandButton = RightItem

// The band stays drawn while the changes panel covers the pane or hides it
// behind a tab, so its /diff is the way back and is kept at any width it fits;
// /dash gives way on a narrow band.
export type BandButtons = { diff: BandButton; dash: BandButton }

function rightItems(kit: Kit, view: DashView, cells: number, maxRows: number, buttons: BandButtons): RightItem[] {
  const { Text } = kit
  const items: RightItem[] = []
  const alert = maxRows < BAND_ROWS_TWO ? alertMeter(view) : null

  if (alert !== null) {
    const text = `${WARNING_MARK}${alert.label} ${alert.valueText}`
    items.push({ key: 'alert', text, element: <Text key="alert" color={SEVERITY_COLOR[alert.severity]}>{text}</Text> })
  }

  if (view.listError !== null) {
    const text = WARNING_MARK + LIST_ERROR_TEXT
    items.push({ key: 'list', text, element: <Text key="list" color="warning">{text}</Text> })
  }

  if (cells >= BAND_COST_MIN_CELLS && view.tokens.costText !== null) {
    const text = view.tokens.costText
    items.push({ key: 'cost', text, element: <Text key="cost" dimColor>{text}</Text> })
  }

  items.push(buttons.diff)

  if (cells >= BAND_DASH_MIN_CELLS) {
    items.push(buttons.dash)
  }

  return items
}

// One gap before each item: the group's left padding, then the gaps.
function itemsCells(items: readonly RightItem[]): number {
  let cells = items.length * RIGHT_ITEM_GAP_CELLS

  for (const item of items) {
    cells += cellWidth(item.text)
  }

  return cells
}

// The title is never cut: right-hand items give way from the end (/dash,
// /diff, then the cost) while title and items overrun the row.
function fittedItems(items: readonly RightItem[], cells: number): RightItem[] {
  const kept = [...items]

  while (kept.length > 0 && itemsCells(kept) > cells) {
    kept.pop()
  }

  return kept
}

function workerName(worker: WorkerView): string {
  const name = worker.kind === 'teammate' || worker.description === '' ? worker.label : worker.description

  return clipCells(name, BAND_WORKER_NAME_CELLS)
}

// How much of an agent's model the band names: all of it, the family alone,
// or nothing, as width allows; the pane always has all of it.
type ModelDetail = 'full' | 'family' | 'none'

const MODEL_DETAILS: readonly ModelDetail[] = ['full', 'family', 'none']

function workerModel(worker: WorkerView, detail: ModelDetail): string {
  const text = detail === 'full' ? worker.modelText : detail === 'family' ? worker.modelFamily : ''

  return text === '' ? '' : ` (${text})`
}

function workerItemText(worker: WorkerView, detail: ModelDetail): string {
  return `${workerName(worker)}${workerModel(worker, detail)} ${worker.ageText}`
}

type WorkerGroup = { kind: WorkerKind; title: string; workers: WorkerView[] }

function activeGroups(view: DashView): WorkerGroup[] {
  const groups: WorkerGroup[] = [
    { kind: 'subagent', title: 'Subagents', workers: view.subagents.filter(worker => worker.isActive) },
    { kind: 'teammate', title: 'Teammates', workers: view.teammates.filter(worker => worker.isActive) },
    { kind: 'task', title: 'Background', workers: view.tasks },
  ]

  return groups.filter(group => group.workers.length > 0)
}

// The first `limit` workers across the groups, in group order.
function shownGroups(groups: readonly WorkerGroup[], limit: number): WorkerGroup[] {
  const shown: WorkerGroup[] = []
  let left = limit

  for (const group of groups) {
    if (left <= 0) {
      break
    }

    shown.push({ ...group, workers: group.workers.slice(0, left) })
    left -= group.workers.length
  }

  return shown
}

function workersCells(groups: readonly WorkerGroup[], detail: ModelDetail): number {
  let cells = 0

  for (const [index, group] of groups.entries()) {
    cells += (index === 0 ? 0 : cellWidth(GROUP_GAP)) + cellWidth(group.title)

    for (const worker of group.workers) {
      cells += cellWidth(ITEM_GAP) + cellWidth(workerItemText(worker, detail))
    }
  }

  return cells
}

function moreText(more: number): string {
  return `+${more} more`
}

type WorkerFit = { shown: WorkerGroup[]; detail: ModelDetail; more: number }

// Model detail gives way first, then whole items fold into "+N more", so the
// terminal never cuts a name or an age; one item always shows.
function workerFit(groups: readonly WorkerGroup[], total: number, limit: number, cells: number): WorkerFit {
  for (let count = Math.min(total, limit); count >= 1; count--) {
    const shown = shownGroups(groups, count)
    const more = total - count
    const moreCells = more > 0 ? cellWidth(ITEM_GAP + moreText(more)) : 0
    const detail = MODEL_DETAILS.find(one => workersCells(shown, one) + moreCells <= cells)

    if (detail !== undefined) {
      return { shown, detail, more }
    }
  }

  return { shown: shownGroups(groups, 1), detail: 'none', more: total - 1 }
}

function bandWorkers(kit: Kit, view: DashView, cells: number): RenderElement | null {
  const { Text } = kit
  const groups = activeGroups(view)

  if (groups.length === 0) {
    return null
  }

  const total = groups.reduce((sum, group) => sum + group.workers.length, 0)
  const limit = cells >= BAND_WORKER_ITEMS_WIDE_MIN_CELLS ? BAND_WORKER_ITEMS_WIDE : BAND_WORKER_ITEMS_NARROW
  const { shown, detail, more } = workerFit(groups, total, limit, cells)

  return (
    <Text wrap="truncate-end">
      {shown.map((group, index) => (
        <Text key={group.title}>
          {index === 0 ? '' : GROUP_GAP}
          <Text color={WORKER_COLOR[group.kind]}>{group.title}</Text>
          {group.workers.map(worker => (
            <Text key={worker.id}>
              {ITEM_GAP}
              {workerName(worker)}
              <Text dimColor>
                {workerModel(worker, detail)} {worker.ageText}
              </Text>
            </Text>
          ))}
        </Text>
      ))}
      {more > 0 ? (
        <Text dimColor>
          {ITEM_GAP}
          {moreText(more)}
        </Text>
      ) : null}
    </Text>
  )
}

export function bandTree(
  kit: Kit,
  view: DashView,
  columns: number,
  maxRows: number,
  buttons: BandButtons,
): RenderElement {
  const { Box } = kit
  const cells = columns - BAND_INDENT
  const right = fittedItems(rightItems(kit, view, cells, maxRows, buttons), cells - headlineCells(view))
  const detailBudget = cells - headlineCells(view) - itemsCells(right)

  return (
    <Box flexDirection="column" width={columns} paddingLeft={BAND_INDENT}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>{headlineText(kit, view, detailBudget)}</Box>
        {right.length === 0 ? null : (
          <Box flexDirection="row" flexShrink={0} gap={RIGHT_ITEM_GAP_CELLS} paddingLeft={RIGHT_ITEM_GAP_CELLS}>
            {right.map(item => item.element)}
          </Box>
        )}
      </Box>
      {maxRows >= BAND_ROWS_TWO ? bandMeters(kit, view, cells) : null}
      {maxRows >= BAND_ROWS_FULL ? bandWorkers(kit, view, cells) : null}
    </Box>
  )
}


const CARD_BORDER_STYLE = 'round'

// A card's top and bottom border.
const CARD_FRAME_ROWS = 2

const CARD_PADDING = 1

const CARD_BORDER_CELLS = 1

// A card's border and padding, both sides.
const CARD_CHROME_CELLS = 2 * (CARD_BORDER_CELLS + CARD_PADDING)

// Cards at rest, and the usage card while every gauge is healthy.
const QUIET_BORDER_COLOR: Color = 'subtle'

const LOG_TITLE = 'Activity'

const LOG_HEADER_ROWS = 1

// Docked, the log takes the rows the other cards leave, but never fewer.
const LOG_MIN_ROWS = 4

// Inline, the pane sits above the prompt and grows with its tree.
const LOG_INLINE_ROWS = 6

const LOG_WHO_COLUMNS = 10

const LOG_TIME_GAP = 2

// Under this many cells across a card, times drop their seconds.
const LOG_SECONDS_MIN_CELLS = 48

const LOG_EMPTY_TEXT = 'Nothing yet.'

// Each body row is a single row: everything in a card truncates rather than
// wraps, so a card's height is its row count and the log can be sized to the
// rows the others leave.
type Card = { element: RenderElement; rows: number }

// Where and how the pane is drawn: its body's cells and rows, and whether it
// is docked beside the transcript (a fixed height to fill) or inline above
// the prompt (a frame that fits the tree).
export type PaneFrame = { columns: number; bodyRows: number; isDocked: boolean }

// The activity log and where its window is held (null: at the newest). Kept
// out of DashView: the band never shows it, and a drawing that reads a value
// is drawn again on each write of it.
export type PaneLog = { entries: readonly DashLogEntry[]; anchor: number | null }

// logTop: the tree row the activity card starts at; logRows: how many
// entries its window shows.
export type PaneDrawing = { tree: RenderElement; logTop: number; logRows: number }

function card(kit: Kit, key: string, border: Color, body: RenderElement[], height: number | null): Card {
  const { Box } = kit
  const rows = height ?? body.length + CARD_FRAME_ROWS

  return {
    rows,
    element: (
      <Box
        key={key}
        flexDirection="column"
        flexShrink={0}
        borderStyle={CARD_BORDER_STYLE}
        borderColor={border}
        paddingX={CARD_PADDING}
        height={height ?? undefined}
      >
        {body}
      </Box>
    ),
  }
}

function paneRow(kit: Kit, labelColumns: number, key: string, label: string, value: RenderElement): RenderElement {
  const { Box, Text } = kit

  return (
    <Box key={key} flexDirection="row">
      <Box width={labelColumns} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {value}
      </Box>
    </Box>
  )
}

// The state in the band's words; the detail only while it says what is
// happening now, since a resting state's history is the Last reply row.
function sessionCard(kit: Kit, view: DashView, labelColumns: number, button: RenderElement): Card {
  const { Box, Text } = kit
  const { phase, title, detail } = view.headline
  const style = PHASE_STYLE[phase]
  const isLive = LIVE_PHASES.has(phase)

  const body = [
    <Box key="state" flexDirection="row" justifyContent="space-between">
      <Box flexShrink={1}>
        <Text wrap="truncate-end">
          <Text color={style.color} bold>
            {style.glyph} {title}
          </Text>
          {isLive && detail.length > 0 ? HEADLINE_GAP + detail.join(CLAUSE_JOINER) : ''}
        </Text>
      </Box>
      <Box flexShrink={0} paddingLeft={RIGHT_ITEM_GAP_CELLS}>
        {button}
      </Box>
    </Box>,
  ]

  if (view.modelText !== null) {
    body.push(paneRow(kit, labelColumns, 'model', 'Model', <Text wrap="truncate-end">{view.modelText}</Text>))
  }

  if (view.lastReplyText !== null) {
    body.push(paneRow(kit, labelColumns, 'reply', 'Last reply', <Text wrap="truncate-end">{view.lastReplyText}</Text>))
  }

  return card(kit, 'session', RESTING_PHASES.has(phase) ? QUIET_BORDER_COLOR : style.color, body, null)
}

function paneMeter(kit: Kit, labelColumns: number, meter: MeterView, cells: number): RenderElement {
  const { Text } = kit

  return paneRow(
    kit,
    labelColumns,
    meter.key,
    meter.label,
    <Text wrap="truncate-end">
      {meter.leftPercent === null ? null : meterBar(kit, meter, cells)}
      {meter.leftPercent === null ? '' : ' '}
      {meterValue(kit, meter)}
      {meter.noteText === '' ? null : meterNote(kit, meter, ITEM_GAP)}
    </Text>,
  )
}

// The bar sits in the gauges' column: the main conversation's share in its
// colour, the agents' in theirs, with the legend in the same two colours.
function tokensRow(kit: Kit, view: DashView, labelColumns: number, cells: number): RenderElement {
  const { Text } = kit
  const { tokens } = view
  const split = tokens.mainPercent === null ? null : splitCells(tokens.mainPercent, cells)

  return paneRow(
    kit,
    labelColumns,
    'tokens',
    'Tokens',
    <Text wrap="truncate-end">
      {split === null ? null : (
        <Text>
          <Text color={MAIN_COLOR}>{split.first}</Text>
          <Text color={WORKER_COLOR.subagent}>{split.second}</Text>{' '}
        </Text>
      )}
      {tokens.totalText}
      {ITEM_GAP}
      <Text color={MAIN_COLOR}>main</Text>
      <Text dimColor>
        {' '}
        {tokens.mainText}
        {CLAUSE_JOINER}
      </Text>
      <Text color={WORKER_COLOR.subagent}>agents</Text>
      <Text dimColor> {tokens.agentsText}</Text>
    </Text>,
  )
}

// The border takes the worst gauge's colour, so a limit running low shows on
// the card's edge too.
function usageCard(kit: Kit, view: DashView, labelColumns: number, cells: number): Card {
  const { Text } = kit
  const { tokens } = view
  const body = view.meters.map(meter => paneMeter(kit, labelColumns, meter, cells))
  let worst: Severity = 'ok'

  for (const meter of view.meters) {
    worst = meter.leftPercent === null ? worst : worseOf(worst, meter.severity)
  }

  if (view.limitsNote !== null) {
    body.push(
      <Text key="limits" dimColor wrap="truncate-end">
        {view.limitsNote}
      </Text>,
    )
  }

  if (tokens.costText !== null) {
    body.push(paneRow(kit, labelColumns, 'cost', 'Cost', <Text>{tokens.costText}</Text>))
  }

  if (tokens.hasTokens) {
    body.push(tokensRow(kit, view, labelColumns, cells))
    body.push(
      paneRow(
        kit,
        labelColumns,
        'sent',
        '',
        <Text dimColor wrap="truncate-end">
          input {tokens.inputText}
          {CLAUSE_JOINER}output {tokens.outputText}
        </Text>,
      ),
    )
    body.push(
      paneRow(
        kit,
        labelColumns,
        'cache',
        '',
        <Text dimColor wrap="truncate-end">
          cache read {tokens.cacheReadText}
          {CLAUSE_JOINER}cache write {tokens.cacheWriteText}
        </Text>,
      ),
    )
  }

  return card(kit, 'usage', worst === 'ok' ? QUIET_BORDER_COLOR : GAUGE_COLOR[worst], body, null)
}

function workerGlyph(kit: Kit, worker: WorkerView): RenderElement {
  const { Text } = kit

  if (worker.isActive) {
    return <Text color={WORKER_COLOR[worker.kind]}>●</Text>
  }

  return worker.isIdle ? <Text color="inactive">◦</Text> : <Text dimColor>✓</Text>
}

// Line one says which worker and for how long; line two, for a working agent,
// what it runs on, what it did last and how full its context is.
function workerRows(kit: Kit, worker: WorkerView): RenderElement[] {
  const { Box, Text } = kit
  const isDim = !worker.isActive
  const details = [worker.modelDetailText, worker.activityText, worker.contextText].filter(text => text !== '')

  const rows = [
    <Box key={worker.id} flexDirection="row">
      <Box width={PANE_GLYPH_COLUMNS} flexShrink={0}>
        {workerGlyph(kit, worker)}
      </Box>
      <Box width={PANE_WORKER_LABEL_COLUMNS} flexShrink={0}>
        <Text color={isDim ? undefined : WORKER_COLOR[worker.kind]} dimColor={isDim} wrap="truncate-end">
          {worker.isNested ? NESTED_MARK : ''}
          {worker.label}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor={isDim} wrap="truncate-end">
          {worker.description}
        </Text>
      </Box>
      <Box width={PANE_AGE_COLUMNS} flexShrink={0} justifyContent="flex-end">
        <Text dimColor>{worker.isActive ? worker.ageText : worker.statusText}</Text>
      </Box>
    </Box>,
  ]

  if (worker.isActive && details.length > 0) {
    rows.push(
      <Box key={`${worker.id}:detail`} flexDirection="row" paddingLeft={PANE_GLYPH_COLUMNS + PANE_WORKER_LABEL_COLUMNS}>
        <Text dimColor wrap="truncate-end">
          {details.join(ITEM_GAP)}
        </Text>
      </Box>,
    )
  }

  return rows
}

function subagentSummary(view: DashView): string {
  const parts: string[] = []

  if (view.activeSubagents > 0) {
    parts.push(`${view.activeSubagents} running`)
  }

  if (view.doneSubagents > 0) {
    parts.push(`${view.doneSubagents} done`)
  }

  if (view.failedSubagents > 0) {
    parts.push(`${view.failedSubagents} failed`)
  }

  return parts.join(CLAUSE_JOINER)
}

function teammateSummary(view: DashView): string {
  if (view.teammates.length === 0) {
    return ''
  }

  return `${view.activeTeammates} working${CLAUSE_JOINER}${view.idleTeammates} idle`
}

type PaneGroup = WorkerGroup & { summary: string }

// A group with nothing in it is left out, and the card with it when all are.
function agentsCard(kit: Kit, view: DashView): Card | null {
  const { Text } = kit

  const groups: PaneGroup[] = [
    {
      kind: 'subagent',
      title: 'Subagents',
      summary: subagentSummary(view),
      workers: view.subagents.filter(worker => worker.isActive),
    },
    { kind: 'teammate', title: 'Teammates', summary: teammateSummary(view), workers: view.teammates },
    {
      kind: 'task',
      title: 'Background',
      summary: view.tasks.length === 0 ? '' : `${view.tasks.length} running`,
      workers: view.tasks,
    },
  ]

  const body = groups
    .filter(group => group.workers.length > 0 || group.summary !== '')
    .flatMap(group => [
      <Text key={group.title} wrap="truncate-end">
        <Text color={WORKER_COLOR[group.kind]} bold>
          {group.title}
        </Text>
        {group.summary === '' ? null : <Text dimColor>{HEADLINE_GAP + group.summary}</Text>}
      </Text>,
      ...group.workers.flatMap(worker => workerRows(kit, worker)),
    ])

  return body.length === 0 ? null : card(kit, 'agents', QUIET_BORDER_COLOR, body, null)
}

function logEntryRow(kit: Kit, entry: DashLogEntry, hasSeconds: boolean): RenderElement {
  const { Box, Text } = kit
  const tone = TONE_STYLE[entry.tone]
  const time = clockText(entry.at, hasSeconds)

  return (
    <Box key={String(entry.seq)} flexDirection="row">
      <Box width={cellWidth(time) + LOG_TIME_GAP} flexShrink={0}>
        <Text dimColor>{time}</Text>
      </Box>
      <Box width={LOG_WHO_COLUMNS} flexShrink={0}>
        <Text color={SOURCE_COLOR[entry.source]} bold={entry.source === 'you'} wrap="truncate-end">
          {entry.who}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">
          <Text color={tone.color}>{tone.mark}</Text>
          <Text color={entry.tone === 'failed' ? tone.color : undefined}>{entry.text}</Text>
        </Text>
      </Box>
    </Box>
  )
}

// What lies outside the window: newer entries below say the log is held
// back; earlier ones above say there is more to scroll to.
function logNote(kit: Kit, newer: number, older: number): RenderElement | null {
  const { Text } = kit

  if (newer > 0) {
    return <Text color="suggestion">{newer} newer below</Text>
  }

  return older > 0 ? <Text dimColor>{older} earlier above</Text> : null
}

function activityCard(kit: Kit, log: PaneLog, frame: PaneFrame, logRows: number): Card {
  const { Box, Text } = kit
  const window = logWindow(log.entries, log.anchor, logRows)
  const hasSeconds = frame.columns - CARD_CHROME_CELLS >= LOG_SECONDS_MIN_CELLS

  const body = [
    <Box key="title" flexDirection="row" justifyContent="space-between">
      <Text bold>{LOG_TITLE}</Text>
      {logNote(kit, window.newer, window.older)}
    </Box>,
    ...(window.entries.length === 0
      ? [
          <Text key="empty" dimColor>
            {LOG_EMPTY_TEXT}
          </Text>,
        ]
      : window.entries.map(entry => logEntryRow(kit, entry, hasSeconds))),
  ]

  const height = frame.isDocked ? logRows + LOG_HEADER_ROWS + CARD_FRAME_ROWS : null

  return card(kit, 'activity', QUIET_BORDER_COLOR, body, height)
}

// The usual column, or wider when a limit's name needs it.
function paneLabelColumns(view: DashView): number {
  let columns = PANE_LABEL_COLUMNS

  for (const meter of view.meters) {
    columns = Math.max(columns, cellWidth(meter.label) + PANE_LABEL_GAP)
  }

  return columns
}

// Docked, the tree is exactly the body's height when it can be, so the
// engine has nothing to scroll and every wheel tick is the log's.
function logRowsFor(frame: PaneFrame, rowsAbove: number): number {
  if (!frame.isDocked) {
    return LOG_INLINE_ROWS
  }

  return Math.max(LOG_MIN_ROWS, frame.bodyRows - rowsAbove - LOG_HEADER_ROWS - CARD_FRAME_ROWS)
}

// stateButton: drawn at the right end of the State card's first row.
export function paneTree(kit: Kit, view: DashView, log: PaneLog, frame: PaneFrame, stateButton: RenderElement): PaneDrawing {
  const { Box, Text } = kit
  const cells = frame.columns >= PANE_COLUMNS_WIDE ? PANE_BAR_CELLS_WIDE : PANE_BAR_CELLS_NARROW
  const labelColumns = paneLabelColumns(view)

  const notice =
    view.listError === null ? null : (
      <Text key="list" color="warning" wrap="truncate-end">
        {WARNING_MARK}Can't read the agent list: {view.listError}
      </Text>
    )

  const cards = [sessionCard(kit, view, labelColumns, stateButton), usageCard(kit, view, labelColumns, cells), agentsCard(kit, view)].filter(
    (one): one is Card => one !== null,
  )

  let rowsAbove = notice === null ? 0 : 1

  for (const one of cards) {
    rowsAbove += one.rows
  }

  const logRows = logRowsFor(frame, rowsAbove)

  return {
    tree: (
      <Box flexDirection="column" width={frame.columns}>
        {notice}
        {cards.map(one => one.element)}
        {activityCard(kit, log, frame, logRows).element}
      </Box>
    ),
    logTop: rowsAbove,
    logRows,
  }
}
