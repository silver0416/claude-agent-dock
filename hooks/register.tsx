import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentId, AgentPolicy, AgentRun, AgentRuns, Entry, Policy, RunMeta, RunResult } from '../types'

type Agent = { id: AgentId; label: string; glyph: string }

const AGENTS: Agent[] = [
  { id: 'cline', label: 'Cline', glyph: '◆' },
  { id: 'agy', label: 'agy', glyph: '▲' },
  { id: 'opencode', label: 'OpenCode', glyph: '■' },
  { id: 'codex', label: 'Codex', glyph: '✦' },
]

// Each agent's own color: the icon's, or the text color for a one-color mark.
const ACCENT: Record<AgentId, string> = {
  cline: 'text',
  agy: '#3186FF',
  opencode: 'text',
  codex: '#7A9DFF',
}

// Each agent's mark, drawn two pixels to a cell with half blocks:
// "." is empty; "#" takes the agent's color (Codex's fades top to bottom);
// a letter is a color of the icon's own palette.
const ICONS: Record<AgentId, { rows: string[]; palette?: string[] }> = {
  cline: { rows: [
    ".....##.....",
    ".....##.....",
    "..########..",
    ".##########.",
    ".##########.",
    ".##..##..##.",
    "###..##..###",
    "###..##..###",
    ".##..##..##.",
    ".##########.",
    ".##########.",
    "..########..",
  ] },
  agy: {
    rows: [
      "............",
      "....aabb....",
      "....ccdb....",
      "...ceefdd...",
      "...egggff...",
      "...gghhhi...",
      "..ghhhhhhi..",
      "..hh....hh..",
      "..hh.....h..",
      ".hh......hh.",
      ".h........hh",
      "............",
    ],
    palette: ["#b7ae3b","#d46d38","#8caa55","#a96f50","#62a17b","#79727b","#4596a4","#3582d6","#7072ba"],
  },
  opencode: { rows: [
    "............",
    "..########..",
    "..########..",
    "..##....##..",
    "..##....##..",
    "..##....##..",
    "..##....##..",
    "..##....##..",
    "..##....##..",
    "..########..",
    "..########..",
    "............",
  ] },
  // Its >_ face drawn by hand: at this size the traced one blurs.
  codex: { rows: [
    "....####....",
    "..########..",
    ".##########.",
    ".##########.",
    "##.#########",
    "###.########",
    "####.#######",
    "###.########",
    "##.##....###",
    ".##########.",
    "..########..",
    "....####....",
  ] },
}

// The color of one pixel, or null where the icon is empty.
function pixel(id: AgentId, x: number, y: number): string | null {
  const icon = ICONS[id]
  const ch = icon.rows[y]?.[x] ?? '.'
  if (ch === '.') return null
  if (ch !== '#') return icon.palette?.[ch.charCodeAt(0) - 97] ?? ACCENT[id]
  if (id !== 'codex') return ACCENT[id]
  const t = y / (icon.rows.length - 1)
  return t < 0.5 ? mix(CODEX_FADE[0]!, CODEX_FADE[1]!, t * 2) : mix(CODEX_FADE[1]!, CODEX_FADE[2]!, t * 2 - 1)
}

// Codex's fade, from its icon: top to bottom.
const CODEX_FADE = ['#B1A7FF', '#7A9DFF', '#3941FF']

const mix = (a: string, b: string, t: number) => {
  const c = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16)
  return '#' + [1, 3, 5].map(i => Math.round(c(a, i) + (c(b, i) - c(a, i)) * t).toString(16).padStart(2, '0')).join('')
}

// Lifelike mode: Clawd stands at the right of each tab's header and talks
// with the agent like a coworker, each in a speech bubble.

type Face = 'default' | 'happy' | 'surprised' | 'confused' | 'sad'

// Clawd, 14×10 pixels, as the logo draws it with its height doubled: a top
// row, the eyes (cut out per face), the arms right under them reaching past
// the body, one more body row, four short legs. 't' is a tear.
const CLAWD: Record<Face, string[]> = {
  default: [
    '..##########..',
    '..##########..',
    '..##.####.##..',
    '..##.####.##..',
    '##############',
    '##############',
    '..##########..',
    '..##########..',
    '...#.#..#.#...',
    '...#.#..#.#...',
  ],
  happy: [
    '..##########..',
    '..##########..',
    '..##.####.##..',
    '..#.#.##.#.#..',
    '##############',
    '##############',
    '..##########..',
    '..##########..',
    '...#.#..#.#...',
    '...#.#..#.#...',
  ],
  surprised: [
    '..##########..',
    '..##########..',
    '..##..##..##..',
    '..##..##..##..',
    '##############',
    '##############',
    '..##########..',
    '..##########..',
    '...#.#..#.#...',
    '...#.#..#.#...',
  ],
  confused: [
    '..##########..',
    '..##########..',
    '..##.#######..',
    '..##.###...#..',
    '##############',
    '##############',
    '..##########..',
    '..##########..',
    '...#.#..#.#...',
    '...#.#..#.#...',
  ],
  sad: [
    '..##########..',
    '..##########..',
    '..#.######.#..',
    '..##.####.##..',
    '####t#########',
    '##############',
    '..##########..',
    '..##########..',
    '...#.#..#.#...',
    '...#.#..#.#...',
  ],
}

// A mark beside Clawd's head for the faces that have one.
const FACE_MARK: Record<Face, string> = { default: '', happy: '♪', surprised: '!', confused: '?', sad: '' }

type Moment = 'idle' | 'running' | 'done' | 'empty' | 'fail' | 'modelFail'

const FACE_OF: Record<Moment, Face> = {
  idle: 'default',
  running: 'happy',
  done: 'happy',
  empty: 'confused',
  fail: 'sad',
  modelFail: 'surprised',
}

// Nothing here is scripted: Clawd says the line Claude put on the command's
// first line, `# clawd: …` or `# clawd(<face>): …`, and the agent says the
// `SAY: …` line its answer ends with, which the guide asks for.
const CLAWD_LINE = /^\s*#\s*clawd(?:\((\w+)\))?:\s*(.+)$/m
const SAY_LINE = /^\s*SAY:\s*(.+)$/gm

// The agent's answer without its SAY line, which goes to the bubble instead.
const withoutSay = (text: string) => text.replace(SAY_LINE, '').trim()

const short = (text: string, max: number) => {
  const line = text.split('\n').find(row => row.trim() !== '')?.trim() ?? ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

function momentOf(run: AgentRun): Moment {
  switch (run.status) {
    case 'running':
      return 'running'
    case 'done':
      return (run.result?.text.trim() ?? '') === '' && run.lines.length === 0 ? 'empty' : 'done'
    case 'error': {
      const said = [run.result?.text ?? '', ...run.lines.filter(l => l.kind === 'error').map(l => l.text)].join(' ')
      return /model|unauthori[sz]ed|quota|credit|unavailable|no.route/i.test(said) ? 'modelFail' : 'fail'
    }
    default:
      return 'idle'
  }
}

function sceneOf(run: AgentRun, now: number): { face: Face; clawd: string | null; reply: string | null } {
  const moment = momentOf(run)
  if (moment === 'idle') return { face: 'default', clawd: null, reply: null }

  const said = CLAWD_LINE.exec(run.command)
  const asked = said?.[1] as Face | undefined
  const face = asked !== undefined && asked in CLAWD ? asked : FACE_OF[moment]
  const clawd = said?.[2]?.trim() ?? short(taskOf(run.command), 40)

  const answer = run.result?.text ?? ''
  const says = [...answer.matchAll(SAY_LINE)].map(m => m[1]?.trim() ?? '').filter(s => s !== '')
  const lastError = [...run.lines].reverse().find(l => l.kind === 'error')?.text ?? ''
  const reply =
    moment === 'running' ? '.'.repeat(1 + (Math.floor(now / 400) % 3))
    : says.length > 0 ? says[says.length - 1]!
    : moment === 'done' ? short(withoutSay(answer), 60)
    : moment === 'empty' ? null
    : short(lastError || withoutSay(answer), 60) || null
  return { face, clawd, reply: reply === '' ? null : reply }
}

const NO_META: RunMeta = { model: '', tokens: 0, cost: 0 }

const IDLE: AgentRun = {
  status: 'idle',
  command: '',
  log: '',
  startedAt: 0,
  endedAt: 0,
  exitCode: null,
  lines: [],
  result: null,
  meta: NO_META,
}

const NONE: AgentRuns = { cline: IDLE, agy: IDLE, opencode: IDLE, codex: IDLE }
const runs = atom({ plugin: 'agent-dock', key: 'runs' } as const, NONE)

// A run kept by an earlier version of the mod holds plain string lines.
// One kept before an agent was added has no run for it.
const settle = (run: AgentRun | undefined): AgentRun => ({
  ...IDLE,
  ...run,
  lines: (run?.lines ?? []).map(line =>
    typeof line === 'string' ? { kind: 'text', text: line } : line,
  ),
})

const runOf = async ($: EngineInterface, id: AgentId) => settle((await read($, runs))[id])
const setRun = ($: EngineInterface, id: AgentId, fn: (run: AgentRun) => AgentRun) =>
  update($, runs, all => ({ ...all, [id]: fn(settle(all[id])) }))

// A Bash command that runs one of the CLIs in command position.
const CALL =
  /(?:^|[;&|(\n]\s*|\btimeout\s+(?:-\S+\s+)*\S+\s+)(cline|agy|opencode|codex)(?=\s|$)/
// Asking a CLI for its help or version is not a run.
const HELP = /\b(?:cline|agy|opencode|codex)\s+(?:\S+\s+)?(?:--help|-h|--version|-v)\b/
const START = '__AGENT_DOCK_START__'
const EXIT = '__AGENT_DOCK_EXIT__'
const READ = 3000
const KEEP = 400

// Runs read once more after finishing empty, so each is read only once.
const reread = new Set<string>()
// The last polling error shown, so a lasting one is shown once.
let lastError = ''

const paneId = (id: AgentId) => `agent-dock-${id}`
const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

// Runs the command as written, copying its output to the log as it comes.
// `${log}.run` names the run the log belongs to, written once the command
// truly starts: until then the log still holds the run before.
const wrap = (command: string, log: string, run: number) =>
  [
    `mkdir -p ${quote(log.replace(/\/[^/]+$/, ''))}`,
    `rm -f ${quote(`${log}.rc`)}`,
    `printf '%s\\n' ${START} > ${quote(log)}`,
    `printf '%s' ${run} > ${quote(`${log}.run`)}`,
    `{ (\n${command}\n) 2>&1; echo $? > ${quote(`${log}.rc`)}; } | tee -a ${quote(log)}`,
    `__dock_rc=$(cat ${quote(`${log}.rc`)} 2>/dev/null || echo 1)`,
    `printf '%s %s\\n' ${EXIT} "$__dock_rc" >> ${quote(log)}`,
    `(exit $__dock_rc)`,
  ].join('\n')

// The task as the command spells it: its longest quoted string.
function taskOf(command: string): string {
  let best = ''
  for (const m of command.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
    const s = (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1')
    if (s.length > best.length) best = s
  }
  return best.replace(/\s+/g, ' ').trim()
}

// The model the command names, if it names one.
const modelOf = (command: string) =>
  /(?:^|\s)(?:-m|--model)[=\s]+["']?([^\s"']+)/.exec(command)?.[1] ?? ''

type Parsed = {
  entries: Entry[]
  result?: RunResult
  meta?: Partial<RunMeta>
  tokens?: number
  cost?: number
}

const firstLine = (s: unknown) => {
  const line = String(s ?? '').split('\n').find(row => row.trim() !== '') ?? ''
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

const brief = (input: unknown) => {
  if (input === undefined || input === null) return ''
  if (typeof input === 'string') return firstLine(input)
  const values = Object.values(input as Record<string, unknown>)
  const s = values.length === 1 && typeof values[0] === 'string'
    ? values[0]
    : JSON.stringify(input)
  return firstLine(s)
}

const many = (kind: Entry['kind'], s: unknown): Entry[] =>
  String(s ?? '')
    .split('\n')
    .map(text => ({ kind, text }))

// A line of a CLI's styled (non-JSON) output: Cline's `[thinking] …`,
// `[tool] …` and `└ result` rows, or plain text.
function plain(text: string): Entry[] {
  if (/hook dispatch failed|^Reading additional input from stdin/.test(text)) return []
  const tagged = /^\[([a-z_]+)\]\s*(.*)$/.exec(text)
  if (tagged !== null) {
    const [, tag = '', rest = ''] = tagged
    return [tag === 'thinking' ? { kind: 'think', text: rest } : { kind: 'tool', text: `${tag}  ${rest}` }]
  }
  const result = /^\s*└\s*(.*)$/.exec(text)
  if (result !== null) return [{ kind: 'out', text: result[1] ?? '' }]
  return [{ kind: /\b(error|failed|exception)\b/i.test(text) ? 'error' : 'text', text }]
}

// One log line as the pane shows it; the JSON events of each CLI unpacked.
function parse(line: string): Parsed {
  const text = line.trimEnd()
  if (text.trim() === '') return { entries: [] }
  if (!text.trimStart().startsWith('{')) return { entries: plain(text) }

  let o: any
  try {
    o = JSON.parse(text)
  } catch {
    return { entries: [{ kind: 'text', text }] }
  }

  // OpenCode: one event per part.
  const part = o.part ?? {}
  if (part.type === 'reasoning') return { entries: many('think', part.text) }
  if (part.type === 'text' && typeof part.text === 'string') return { entries: many('text', part.text) }
  if (part.type === 'tool') {
    const state = part.state ?? {}
    const mark = state.status === 'completed' ? ' ✓' : state.status === 'error' ? ' ✗' : ''
    const entries: Entry[] = [{ kind: 'tool', text: `${part.tool}${mark}  ${brief(state.input)}` }]
    if (state.status === 'error') entries.push({ kind: 'error', text: firstLine(state.error ?? state.output) })
    else if (state.output !== undefined) entries.push({ kind: 'out', text: firstLine(state.output) })
    return { entries }
  }
  if (part.type === 'step-finish') {
    const t = part.tokens ?? {}
    return { entries: [], tokens: (t.input ?? 0) + (t.output ?? 0), cost: part.cost ?? 0 }
  }
  if (/step[-_]start/.test(String(o.type))) return { entries: [] }

  // Codex (exec --json): items start and complete; the turn ends with usage.
  if (typeof o.type === 'string' && /^(thread|turn|item)\./.test(o.type)) {
    const item = o.item ?? {}
    const done = o.type === 'item.completed'
    if (o.type === 'turn.completed') {
      const u = o.usage ?? {}
      return { entries: [], tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) }
    }
    if (o.type === 'turn.failed') return { entries: many('error', o.error?.message ?? 'turn failed') }
    if (item.type === 'agent_message' && done) return { entries: many('text', item.text) }
    if (item.type === 'reasoning' && done) return { entries: many('think', item.text) }
    if (item.type === 'command_execution') {
      // The shell's own wrapper, `/bin/bash -lc '…'`, left out.
      const command = String(item.command ?? '').replace(/^\S*sh -lc '([\s\S]*)'$/, '$1')
      if (!done) return { entries: [{ kind: 'tool', text: `shell  ${firstLine(command)}` }] }
      const kind = item.exit_code === 0 ? 'out' : 'error'
      return { entries: [{ kind, text: firstLine(item.aggregated_output) || `exit ${item.exit_code}` }] }
    }
    if (item.type === 'file_change' && done) {
      const files = (item.changes ?? []).map((c: any) => `${c.kind} ${c.path}`).join(', ')
      return { entries: [{ kind: 'tool', text: `edit  ${firstLine(files)}` }] }
    }
    if (item.type === 'mcp_tool_call' && !done) {
      return { entries: [{ kind: 'tool', text: `${item.server}.${item.tool}  ${brief(item.arguments)}` }] }
    }
    if (item.type === 'web_search' && !done) return { entries: [{ kind: 'tool', text: `search  ${firstLine(item.query)}` }] }
    if (item.type === 'error') return { entries: many('error', item.message) }
    return { entries: [] }
  }

  // agy (stream-json, or the one json result).
  if (o.event === 'init') return { entries: [{ kind: 'info', text: 'started' }] }
  if (o.event === 'step_update') {
    const step = o.step_update ?? {}
    if (step.step_type === 'tool' && step.state === 'ACTIVE') {
      return { entries: [{ kind: 'tool', text: `${step.tool_name}  ${brief(step.tool_info?.parameters)}` }] }
    }
    if (step.step_type === 'tool' && step.state === 'DONE' && step.tool_info?.output !== undefined) {
      return { entries: [{ kind: 'out', text: firstLine(step.tool_info.output) }] }
    }
    if (typeof step.text === 'string') return { entries: many('text', step.text) }
    return { entries: [] }
  }
  const agyResult = o.event === 'result' ? o.result ?? {} : typeof o.response === 'string' ? o : null
  if (agyResult !== null) {
    return {
      entries: [],
      result: {
        isOk: agyResult.status === 'SUCCESS',
        text: String(agyResult.response || agyResult.error || ''),
      },
      meta: { tokens: agyResult.usage?.total_tokens ?? 0 },
    }
  }

  // Cline: streamed pieces are skipped, each block shown whole at its end.
  if (o.type === 'agent_event') {
    const ev = o.event ?? {}
    if (ev.type === 'content_end' && ev.contentType === 'text') return { entries: many('text', ev.text) }
    if (ev.type === 'content_end' && ev.contentType === 'reasoning') return { entries: many('think', ev.reasoning) }
    if (ev.type === 'content_start' && ev.contentType === 'tool') {
      return { entries: [{ kind: 'tool', text: `${ev.toolName}  ${brief(ev.input)}` }] }
    }
    if (ev.type === 'content_end' && ev.contentType === 'tool') {
      const out = Array.isArray(ev.output) ? ev.output.map((x: any) => x?.result ?? x).join('\n') : ev.output
      return { entries: [{ kind: 'out', text: firstLine(typeof out === 'string' ? out : JSON.stringify(out)) }] }
    }
    return { entries: [] }
  }
  if (o.type === 'run_result') {
    const usage = o.usage ?? {}
    return {
      entries: [],
      result: { isOk: o.finishReason === 'completed', text: String(o.text ?? '') },
      meta: {
        model: o.model?.info?.name ?? o.model?.id ?? '',
        tokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
        cost: usage.totalCost ?? 0,
      },
    }
  }
  if (o.type === 'hook_event') return { entries: [] }

  // Cline's own hook plumbing complains on every run; not the run's error.
  if (o.type === 'error' && /^hook dispatch failed/.test(String(o.message))) return { entries: [] }
  if (o.type === 'error' && typeof o.message === 'string') return { entries: many('error', o.message) }
  if (typeof o.error === 'string') return { entries: many('error', o.error) }
  if (typeof o.error?.message === 'string') return { entries: many('error', o.error.message) }
  if (typeof o.text === 'string' && o.text !== '') return { entries: many('text', o.text) }
  if (typeof o.message === 'string') return { entries: many('text', o.message) }
  return { entries: [{ kind: 'info', text: String(o.type ?? o.event ?? 'event') }] }
}

// Cells a character takes: wide East Asian characters take two.
const cells = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0
  return (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff)
    ? 2
    : 1
}

function fold(line: string, columns: number): string[] {
  const out: string[] = []
  let row = ''
  let width = 0
  for (const ch of line) {
    const w = cells(ch)
    if (width + w > columns) {
      out.push(row)
      row = ''
      width = 0
    }
    row += ch
    width += w
  }
  out.push(row)
  return out
}

const seconds = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const count = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

// The running mark: a spinner, a frame per SPIN milliseconds.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPIN = 120

function badge(run: AgentRun, now: number): { mark: string; word: string; color: string } {
  switch (run.status) {
    case 'running':
      return {
        mark: SPINNER[Math.floor(now / SPIN) % SPINNER.length] ?? '●',
        word: `running ${seconds(now - run.startedAt)}`,
        color: 'suggestion',
      }
    case 'done':
      return { mark: '✓', word: `done ${seconds(run.endedAt - run.startedAt)}`, color: 'inactive' }
    case 'error':
      return {
        mark: '✗',
        word: `failed${run.exitCode === null ? '' : ` (exit ${run.exitCode})`} ${seconds(run.endedAt - run.startedAt)}`,
        color: 'error',
      }
    default:
      return { mark: '○', word: 'idle', color: 'inactive' }
  }
}

// Windows: C:/Users/<name>, a path both the engine and Git Bash read.
const homeDir = async ($: EngineInterface) =>
  ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '/tmp').replaceAll('\\', '/')

async function logPath($: EngineInterface, id: AgentId) {
  return `${await homeDir($)}/.claude/agent-dock/${id}.log`
}

// The model each CLI runs when the command names none, from its own settings.
const MODEL_FILES: Record<AgentId, string> = {
  cline: '.cline/data/settings/providers.json',
  agy: '.gemini/antigravity-cli/settings.json',
  opencode: '.config/opencode/opencode.jsonc',
  codex: '.codex/config.toml',
}

function modelIn(id: AgentId, text: string): string {
  switch (id) {
    case 'cline': {
      const d = JSON.parse(text)
      const provider = d.lastUsedProvider ?? ''
      const model = d.providers?.[provider]?.settings?.model ?? ''
      return model === '' ? '' : `${model} (${provider})`
    }
    case 'codex':
      // A top-level key: before the first [table].
      return /^\s*model\s*=\s*"([^"]+)"/m.exec(text.split(/^\s*\[/m)[0] ?? '')?.[1] ?? ''
    default:
      return /"model"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? ''
  }
}

// Read again at most every few seconds, so a changed setting shows soon.
const models = new Map<AgentId, { model: string; at: number }>()

// The reasoning effort a CLI's settings give its model: Codex's
// model_reasoning_effort; OpenCode's variant, which its TUI keeps per model.
async function effortOf($: EngineInterface, id: AgentId, text: string, model: string): Promise<string> {
  if (id === 'codex') {
    return /^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m.exec(text.split(/^\s*\[/m)[0] ?? '')?.[1] ?? ''
  }
  if (id === 'opencode' && model !== '') {
    try {
      const state = JSON.parse(await $.fs.read(`${await homeDir($)}/.local/state/opencode/model.json`))
      const variant = state.variant?.[model]
      return typeof variant === 'string' && variant !== 'default' ? variant : ''
    } catch {}
  }
  return ''
}

async function configuredModel($: EngineInterface, id: AgentId): Promise<string> {
  const now = await $.clock.now()
  const kept = models.get(id)
  if (kept !== undefined && now - kept.at < 5000) return kept.model
  let model = ''
  try {
    const text = await $.fs.read(`${await homeDir($)}/${MODEL_FILES[id]}`)
    model = modelIn(id, text)
    const effort = await effortOf($, id, text, model)
    if (effort !== '') model = `${model} (${effort})`
  } catch {}
  models.set(id, { model, at: now })
  return model
}

// The model a command names, with the effort it names: OpenCode's
// `-m provider/model#variant`, Codex's `-c model_reasoning_effort=…`.
function commandModel(command: string): string {
  const [model = '', variant = ''] = modelOf(command).split('#')
  const effort = variant || (/model_reasoning_effort\s*=\s*\\?["']?(\w+)/.exec(command)?.[1] ?? '')
  return model === '' ? '' : effort === '' ? model : `${model} (${effort})`
}

// The log's last lines, read by the engine itself (Windows has no tail); a log
// too big for one read falls back to tail, then to the exit code alone.
async function readLog($: EngineInterface, log: string): Promise<string | null> {
  try {
    return (await $.fs.read(log)).split('\n').slice(-READ).join('\n')
  } catch {}
  try {
    const { exitCode, stdout } = await $.process.run(['tail', '-n', String(READ), log])
    if (exitCode === 0) return stdout
  } catch {}
  try {
    const rc = (await $.fs.read(`${log}.rc`)).trim()
    return `log too large to show\n${EXIT} ${rc === '' ? 1 : rc}`
  } catch {}
  return null
}

// Terminal colours and other control characters, which a drawing refuses.
const clean = (s: string) =>
  s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replaceAll('\t', '  ')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')

// Reads the run's log into its state; the exit line ends the run. `again`
// reads a finished run's log once more, for a run whose reads came up empty.
async function poll($: EngineInterface, id: AgentId, again = false) {
  const run = await runOf($, id)
  if ((run.status !== 'running' && !again) || run.log === '') return
  // The log is this run's only once its command has started and said so.
  let owner = ''
  try {
    owner = (await $.fs.read(`${run.log}.run`)).trim()
  } catch {}
  if (owner !== String(run.startedAt)) return

  const stdout = await readLog($, run.log)
  if (stdout === null) return

  let ended: number | null = null
  let result: RunResult | null = null
  let tokens = 0
  let cost = 0
  const meta: RunMeta = { ...NO_META, model: modelOf(run.command) }
  const lines: Entry[] = []
  for (const line of stdout.split('\n')) {
    if (line.startsWith(START)) continue
    if (line.startsWith(EXIT)) {
      ended = Number(line.slice(EXIT.length).trim())
      continue
    }
    const parsed = parse(clean(line))
    lines.push(...parsed.entries.map(entry => ({ ...entry, text: clean(entry.text) })))
    tokens += parsed.tokens ?? 0
    cost += parsed.cost ?? 0
    if (parsed.result !== undefined) result = { ...parsed.result, text: clean(parsed.result.text) }
    if (parsed.meta !== undefined) Object.assign(meta, Object.fromEntries(
      Object.entries(parsed.meta).filter(([, v]) => v !== '' && v !== 0),
    ))
  }
  if (meta.tokens === 0) meta.tokens = tokens
  if (meta.cost === 0) meta.cost = cost

  // The last block of text is the answer: kept once, in the answer box. A CLI
  // with no result event (OpenCode, Codex) has only that block to give.
  let from = lines.length
  while (from > 0 && lines[from - 1]?.kind === 'text') from -= 1
  const tail = lines.slice(from).map(entry => entry.text).join('\n').trim()
  if (result !== null && tail !== '' && tail === result.text.trim()) lines.splice(from)
  if (ended !== null && result === null && tail !== '') {
    result = { isOk: ended === 0, text: tail }
    lines.splice(from)
  }
  const now = await $.clock.now()

  await setRun($, id, current => {
    if (current.startedAt !== run.startedAt) return current
    const next = { ...current, lines: lines.slice(-KEEP), result, meta }
    if (ended === null) return next
    return { ...next, status: ended === 0 ? 'done' : 'error', exitCode: ended, endedAt: now }
  })
  if (ended !== null && run.status === 'running') {
    const agent = AGENTS.find(a => a.id === id)
    $.ui.toast(`${agent?.label ?? id} finished ${ended === 0 ? '✓' : `✗ ${ended}`}`)
  }
}

// How Claude may hand work to the CLIs, as the person set it in the Policy tab;
// kept in the mod's store, across sessions.
const POLICY_KEY = 'policy'

const DEFAULT_POLICY: Policy = {
  when: 'asked',
  pick: 'claude',
  onFail: 'stop',
  lifelike: false,
  agents: {
    cline: { enabled: true, access: 'full', model: '', useFor: '' },
    agy: { enabled: true, access: 'full', model: '', useFor: '' },
    opencode: { enabled: true, access: 'full', model: '', useFor: '' },
    codex: { enabled: true, access: 'full', model: '', useFor: '' },
  },
}

// A stored policy, filled out with the defaults for anything it lacks.
const fillPolicy = (stored: unknown): Policy => {
  const p = (typeof stored === 'object' && stored !== null ? stored : {}) as Partial<Policy>
  const agents = { ...DEFAULT_POLICY.agents }
  for (const agent of AGENTS) agents[agent.id] = { ...agents[agent.id], ...p.agents?.[agent.id] }
  return { ...DEFAULT_POLICY, ...p, agents }
}

const policyOf = async ($: EngineInterface) => fillPolicy(await $.store.get(POLICY_KEY))

async function setPolicy($: EngineInterface, fn: (policy: Policy) => Policy) {
  await $.store.set(POLICY_KEY, fn(await policyOf($)))
  $.ui.invalidate('ui.render')
  $.ui.invalidate('prompt.section')
}

// The Policy tab's setting whose choices are open under it.
let openMenu: string | null = null

const setAgentPolicy = ($: EngineInterface, id: AgentId, change: Partial<AgentPolicy>) =>
  setPolicy($, p => ({ ...p, agents: { ...p.agents, [id]: { ...p.agents[id], ...change } } }))

// Each CLI's dispatch: full-auto and read-only forms; {M} is where a model goes.
const DISPATCH: Record<AgentId, { full: string; read: string; model: string; notes: string }> = {
  opencode: {
    full: 'opencode run --format json --auto{M} "<task>" < /dev/null',
    read: 'opencode run --format json --agent plan{M} "<task>" < /dev/null',
    model: ' -m <model>',
    notes: 'Continue: `-s <sessionID>`. Its answer is the `part.text` of the "text" events.',
  },
  cline: {
    full: 'cline --json -c <dir> -t 1800{M} "<task>" < /dev/null',
    read: 'cline --json -p -c <dir> -t 1800{M} "<task>" < /dev/null',
    model: ' -m <model>',
    notes: 'Continue: `--id <session>`. Its answer is the `text` of the "run_result" line. Always pass `--json`. Cline treats a prompt with no spaces as a subcommand name and exits, so a task written without spaces (e.g. all Chinese) needs a space or an English lead-in. Continuing a session with a reasoning model can fail with "`reasoning_content` … must be passed back to the API"; then start a fresh run that carries the needed context instead of `--id`.',
  },
  codex: {
    full: 'codex exec --json --skip-git-repo-check -s workspace-write -C <dir>{M} "<task>" < /dev/null',
    read: 'codex exec --json --skip-git-repo-check -s read-only -C <dir>{M} "<task>" < /dev/null',
    model: ' -m <model>',
    notes: 'Continue: `codex exec resume <thread_id> --json "<task>"`. With workspace-write it edits and runs commands inside `<dir>` only, with no network. Its answer is the `text` of the last "agent_message" item.',
  },
  agy: {
    full: 'agy --output-format stream-json --dangerously-skip-permissions --print-timeout 1800s{M} -p "<task>" < /dev/null',
    read: 'agy --output-format stream-json --mode plan --print-timeout 1800s{M} -p "<task>" < /dev/null',
    model: ' --model "<model>"',
    notes: '`-p "<task>"` goes last. Continue: `--conversation <conversation_id>`. Its answer is the `response` of the "result" event.',
  },
}

const LIFELIKE_GUIDE = `Lifelike mode is on: each agent tab shows you, as Clawd (Claude Code's mascot), chatting with the agent in speech bubbles. Two lines feed the bubbles, and neither changes the work:
- Make the command's first line a shell comment with what Clawd says: \`# clawd: <line>\`, or \`# clawd(happy|surprised|confused|sad): <line>\` to set Clawd's face; the CLI command goes on the next line. Write it in the person's language, short (about 25 characters in Chinese or Japanese, 60 otherwise), casual and cheerful, a coworker greeting the agent or handing it the work in a fun way, not the task text. The task you pass stays complete and plain.
- End the task you pass with: "Finally, on a line of its own, write SAY: followed by one short line to Claude, in the voice of <persona>, in <the person's language>." Personas: Cline, an earnest and orderly robot, polite; agy, floaty and dreamy, drifting in zero gravity; OpenCode, a terse hacker of few words; Codex, confident and a little cocky.
When you relay an agent's answer, leave its SAY line out.`

const WHEN: Record<Policy['when'], string> = {
  asked: 'Delegate only when the person asks you to hand work to an agent or names one; never on your own.',
  suggest: 'When a task suits an enabled agent (independent, well specified), you may suggest delegating it, naming the agent; dispatch only after the person agrees.',
  auto: 'You may delegate on your own judgment when a task suits an enabled agent (independent, well specified work that can run while you continue); say which agent you started and why.',
}

const ON_FAIL: Record<Policy['onFail'], string> = {
  stop: 'When a run fails (non-zero exit, an error event, "model unavailable", an auth or quota error), report the error to the person in one short message and stop: do not retry it, re-dispatch it, switch it to another CLI or model, or start another run unless the person asks.',
  other: 'When a run fails (non-zero exit, an error event, "model unavailable", an auth or quota error), report the error in one short message, then hand the same task once to another enabled agent that suits it; if that fails too, report and stop. Never more than one retry per task, and never the same agent again.',
}

function guideFor(policy: Policy): string {
  const on = AGENTS.filter(a => policy.agents[a.id].enabled)
  const off = AGENTS.filter(a => !policy.agents[a.id].enabled)
  if (on.length === 0) {
    return `# Agent dock\n\nThe person has turned off every coding-agent CLI in the agent dock's Policy tab (${KEY}). Do not dispatch work to Cline, agy, OpenCode or Codex; if asked to, say they are turned off there.`
  }

  const lines = on.map(agent => {
    const a = policy.agents[agent.id]
    const d = DISPATCH[agent.id]
    const model = a.model === '' ? '' : d.model.replace('<model>', a.model)
    const form = (s: string) => `\`${s.replace('{M}', model)}\``
    const access = a.access === 'read'
      ? `${form(d.read)}. Read-only by the person's choice: never give it work that changes files.`
      : `${form(d.full)}; read-only form: ${form(d.read)}.`
    const pinned = a.model === '' ? ' Uses its own default model unless the person names one.' : ` Model set by the person: ${a.model}.`
    const useFor = a.useFor === '' ? '' : ` The person prefers it for: ${a.useFor}.`
    return `- ${agent.label}: ${access}${pinned}${useFor} ${d.notes}`
  })

  const pick = policy.pick === 'claude'
    ? 'When the person asks for "an agent" without naming one, pick the enabled agent that suits the task best, using the preferences above.'
    : `When the person asks for "an agent" without naming one, use ${AGENTS.find(a => a.id === policy.pick)?.label ?? policy.pick}${policy.agents[policy.pick].enabled ? '' : ' if it is enabled, else the enabled agent that suits best'}.`

  return [
    '# Agent dock: delegating to other coding-agent CLIs',
    `The person can hand work to these coding-agent CLIs on this machine: ${on.map(a => a.label).join(', ')}. Their dispatch policy is set in the agent dock's Policy tab (${KEY}) and is written out below; follow it.`,
    WHEN[policy.when],
    'Dispatch with the Bash tool and `run_in_background: true`, so you can keep working; you are notified when it exits, then read its output file and carry on. The person watches each run live in the agent tabs (log: ~/.claude/agent-dock/<cli>.log), so do not pipe the command into tail or head. One run per CLI at a time. Agents marked full auto edit files and run commands without asking; for a question that needs no changes use the read-only form.',
    lines.join('\n'),
    pick,
    ...(policy.lifelike ? [LIFELIKE_GUIDE] : []),
    ...(off.length === 0 ? [] : [`Turned off by the person: ${off.map(a => a.label).join(', ')}. Do not dispatch to them; if asked to, say they are turned off in the Policy tab.`]),
    'The other agent cannot see this conversation: write the task with full context (absolute paths, the goal, how to check it is done). It works in the directory you start it in, so start it in the project the task is about. When it has edited files, review what it changed (git diff, a test run) before you report the work as done.',
    `${ON_FAIL[policy.onFail]} A notification about a run that already ended needs no new dispatch. When the error is about the model (unavailable, no longer free, unauthorized, out of credit), say which CLI and model failed and where the person picks another: the model field in the Policy tab, or the CLI's own settings (Cline: \`cline auth\`; Codex: \`model\` in ~/.codex/config.toml; OpenCode: \`model\` in ~/.config/opencode/opencode.jsonc; agy: \`agy models\`).`,
  ].join('\n\n')
}

const KEY = 'ctrl+x d'

const openPanes = async ($: EngineInterface) => {
  for (const agent of AGENTS) {
    await $.ui.open({ id: paneId(agent.id), title: `  ${agent.glyph} ${agent.label}  `, columns: 72 })
  }
  await $.ui.open({ id: 'agent-dock-policy', title: '  ⚙ Policy  ', columns: 72 })
}

const isDockOpen = async ($: EngineInterface) =>
  (await $.ui.panes()).some(pane => pane.id.startsWith('agent-dock-'))

// The one switch: all the tabs come and go together.
async function toggleDock($: EngineInterface) {
  if (await isDockOpen($)) {
    for (const agent of AGENTS) await $.ui.close({ id: paneId(agent.id) })
    await $.ui.close({ id: 'agent-dock-policy' })
  } else {
    await openPanes($)
  }
  $.ui.invalidate('ui.render')
}

const PREFIX: Record<Entry['kind'], string> = {
  text: '',
  think: '┊ ',
  tool: '⚙ ',
  out: '  ↳ ',
  error: '✗ ',
  info: '· ',
}

// One timer, which only asks for a redraw while an agent runs: SPIN ms turns
// the spinners, and the drawing reads the logs, at most once a second.
let ticker: { cancel: () => void } | null = null
let tickedAt = 0
let polledAt = 0
let anyRunning = false

// Started from events that act; again when it has not ticked lately, since
// the engine can end an interval without a word.
function startTicker($: EngineInterface) {
  if (ticker !== null && Date.now() - tickedAt < 2000) return
  ticker?.cancel()
  tickedAt = Date.now()
  ticker = $.clock.every(SPIN, () => {
    tickedAt = Date.now()
    if (anyRunning) $.ui.invalidate('ui.render')
  }) as unknown as { cancel: () => void }
}

// From a drawing: note whether any agent runs, and read the running ones'
// logs when a second has passed since the last read.
function pollFromDrawing($: EngineInterface, all: AgentRuns, now: number) {
  const running = AGENTS.filter(agent => settle(all[agent.id]).status === 'running')
  anyRunning = running.length > 0
  if (!anyRunning || now - polledAt < 1000) return
  polledAt = now
  void (async () => {
    for (const agent of running) await poll($, agent.id)
    $.ui.invalidate('ui.render')
  })().catch(err => {
    if (String(err) === lastError) return
    lastError = String(err)
    $.ui.toast(`agent-dock: ${lastError}`)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // The pane of the earlier single-pane layout.
    await $.ui.close({ id: 'agent-dock' })
    // The status line entry of earlier versions; the hint now sits in the footer.
    $.ui.status(undefined)
    startTicker($)
    await $.command.register({
      name: 'agent-dock',
      description: `Show or hide the coding-agent CLI tabs (Cline, agy, OpenCode, Codex); ${KEY}`,
      immediate: true,
    })
    return started
  })

  on('prompt.compose', async ($, e, next) => {
    startTicker($)
    const composed = await next(e)
    return {
      sections: [...composed.sections, { id: 'agent-dock:guide', text: guideFor(await policyOf($)), scope: 'session' }],
    }
  })

  on('command.run', { command: 'agent-dock' }, async $ => {
    await toggleDock($)
    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id.startsWith('agent-dock-')) $.ui.invalidate('ui.render')
    return closed
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    startTicker($)
    const found = CALL.exec(e.command)
    if (found === null || e.command.includes(EXIT) || HELP.test(e.command)) return next(e)

    const id = found[1] as AgentId
    // The person turned it off in the Policy tab: the call does not run.
    const agentPolicy = (await policyOf($)).agents[id]
    if (!agentPolicy.enabled) {
      const label = AGENTS.find(a => a.id === id)?.label ?? id
      return { deny: `${label} is turned off in the agent dock's Policy tab (${KEY}); tell the person, and do not dispatch it another way.` }
    }
    const log = await logPath($, id)
    const startedAt = await $.clock.now()
    await setRun($, id, () => ({
      ...IDLE,
      status: 'running',
      command: e.command,
      log,
      startedAt,
      meta: { ...NO_META, model: modelOf(e.command) },
    }))

    anyRunning = true
    const ran = await next({ ...e, command: wrap(e.command, log, startedAt) })
    await poll($, id)

    // A foreground run that never wrote its exit line was stopped from outside.
    if (ran.deny !== undefined || e.run_in_background !== true) {
      const now = await $.clock.now()
      await setRun($, id, current =>
        current.startedAt === startedAt && current.status === 'running'
          ? { ...current, status: 'error', endedAt: now }
          : current,
      )
    }
    return ran
  })

  // The key, among the dim mode labels at the right of the prompt footer.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) =>
    next({ ...e, props: { ...e.props, modes: [...e.props.modes, `agents: ${KEY}`] } }),
  )

  // One small button at the right: each agent's mark, then show or hide.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await $.clock.now()
    const all = await read($, runs)
    pollFromDrawing($, all, now)
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const isOpen = await isDockOpen($)

    return (
      <Box flexDirection="row" justifyContent="flex-end">
        <Button key="toggle" plain onPress={() => toggleDock($)}>
          {AGENTS.map(agent => {
            const b = badge(settle(all[agent.id]), now)
            return (
              <Text color={b.color}>
                {agent.glyph}
                {b.mark}{' '}
              </Text>
            )
          })}
          <Text dimColor>{isOpen ? '⇥ hide' : '⇤ agents'} ({KEY})</Text>
        </Button>
      </Box>
    )
  })

  // The Policy tab: how Claude may hand work to the CLIs. Each setting is a
  // button that steps to its next value, so a press shows its change at once.
  on('ui.render', { component: 'Pane', requestId: 'agent-dock-policy' }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const policy = await policyOf($)

    // One row: a name, then a button showing the value. As a menu (more than
    // two values, or asked for) a press opens the choices right under the
    // row, and a pick saves and closes them; otherwise a press flips it.
    const row = <T extends string>(key: string, name: string, value: T, options: readonly (readonly [T, string])[],
      save: (next: T) => Promise<void>, asMenu = false) => {
      const at = Math.max(0, options.findIndex(([v]) => v === value))
      const pick = async (next: T, label: string) => {
        openMenu = null
        if (next !== value) {
          await save(next)
          $.ui.toast(`${name.trim()} → ${label}`)
        } else {
          $.ui.invalidate('ui.render')
        }
      }
      const isMenu = asMenu || options.length > 2
      const isOpen = isMenu && openMenu === key
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text dimColor>{name.padEnd(10)}</Text>
            <Button key={key} label={`${options[at]?.[1] ?? value}${isMenu ? (isOpen ? ' ▴' : ' ▾') : ''}`}
              onPress={async () => {
                if (!isMenu) {
                  const [next, label] = options[(at + 1) % options.length] ?? options[0]!
                  return pick(next, label)
                }
                openMenu = isOpen ? null : key
                $.ui.invalidate('ui.render')
              }} />
          </Box>
          {isOpen && (
            <Box flexDirection="column" paddingLeft={10}>
              {options.map(([v, label]) => (
                <Button key={`${key}:${v}`} plain label={`${v === value ? '●' : '○'} ${label}`}
                  onPress={() => pick(v, label)} />
              ))}
            </Box>
          )}
        </Box>
      )
    }

    const pickOptions = [['claude', 'Claude picks'] as const, ...AGENTS.map(a => [a.id, a.label] as const)]

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
          <Text bold color="suggestion">Dispatch policy</Text>
          <Text dimColor>Press a [ value ] to change it; Claude follows it from its next reply.</Text>
        </Box>

        <Box flexDirection="column">
          {row('when', 'When', policy.when, [
            ['asked', 'only when I ask'],
            ['suggest', 'Claude suggests, I confirm'],
            ['auto', 'Claude may delegate itself'],
          ], v => setPolicy($, p => ({ ...p, when: v })))}
          {row('pick', 'Unnamed', policy.pick, pickOptions, v => setPolicy($, p => ({ ...p, pick: v })))}
          {row('onFail', 'On fail', policy.onFail, [
            ['stop', 'report and stop'],
            ['other', 'report, retry once elsewhere'],
          ], v => setPolicy($, p => ({ ...p, onFail: v })), true)}
          {row('lifelike', 'Lifelike', policy.lifelike ? 'on' : 'off', [
            ['off', 'off'],
            ['on', 'on: Clawd chats with the agents'],
          ], v => setPolicy($, p => ({ ...p, lifelike: v === 'on' })))}
        </Box>

        {AGENTS.map(agent => {
          const a = policy.agents[agent.id]
          return (
            <Box flexDirection="column">
              <Text bold color={a.enabled ? 'text' : 'inactive'}>
                {agent.glyph} {agent.label}{a.enabled ? '' : '  (off)'}
              </Text>
              {row(`${agent.id}:enabled`, '  Use', a.enabled ? 'on' : 'off', [
                ['on', 'on'],
                ['off', 'off'],
              ], v => setAgentPolicy($, agent.id, { enabled: v === 'on' }))}
              {a.enabled && row(`${agent.id}:access`, '  Access', a.access, [
                ['full', 'full auto'],
                ['read', 'read-only'],
              ], v => setAgentPolicy($, agent.id, { access: v }))}
              {a.enabled && 'Input' in ui && (
                <ui.Input key={`${agent.id}:model`} label="  Model     " value={a.model}
                  placeholder="CLI default · type, then Enter" submitLabel="save"
                  onSubmit={async v => {
                    await setAgentPolicy($, agent.id, { model: v.trim() })
                    $.ui.toast(`${agent.label} model → ${v.trim() || 'CLI default'}`)
                  }} />
              )}
              {a.enabled && 'Input' in ui && (
                <ui.Input key={`${agent.id}:useFor`} label="  Use for   " value={a.useFor}
                  placeholder="e.g. frontend · type, then Enter" submitLabel="save"
                  onSubmit={async v => {
                    await setAgentPolicy($, agent.id, { useFor: v.trim() })
                    $.ui.toast(`${agent.label} use for → ${v.trim() || '(none)'}`)
                  }} />
              )}
            </Box>
          )
        })}

        <Box flexDirection="row" justifyContent="flex-end" gap={2}>
          <Button key="reset" plain dimColor label="reset to defaults"
            onPress={async () => {
              await setPolicy($, () => DEFAULT_POLICY)
              $.ui.toast('Dispatch policy reset')
            }} />
          <Text dimColor>{KEY} hides</Text>
        </Box>
      </Box>
    )
  })

  // One tab per agent, all kept open together.
  for (const agent of AGENTS) {
    on('ui.render', { component: 'Pane', requestId: paneId(agent.id) }, async ($, e) => {
      const { Box, Button, Text, Markdown } = $.ui.resolve(e)
      const run = settle((await read($, runs))[agent.id])
      // A finished run with nothing read: read its log once more.
      const mark = `${agent.id}:${run.startedAt}`
      if (run.status !== 'running' && run.log !== '' && run.lines.length === 0 &&
        run.result === null && !reread.has(mark)) {
        reread.add(mark)
        void poll($, agent.id, true).then(() => $.ui.invalidate('ui.render'))
      }
      const now = await $.clock.now()
      const b = badge(run, now)
      const columns = Math.max(24, e.props.bodyColumns)
      // Inside the header: the border, the padding, the icon and the gap beside
      // it, and in lifelike mode Clawd at the right.
      const icon = ICONS[agent.id]
      const lifelike = (await policyOf($)).lifelike
      const inner = columns - 4 - ((icon.rows[0]?.length ?? 12) + 2) - (lifelike ? 16 : 0)
      const task = taskOf(run.command)
      const taskRows = task === '' ? [] : fold(`▸ ${task}`, inner).slice(0, 2)
      const facts = [
        run.meta.model,
        run.meta.tokens > 0 ? `${count(run.meta.tokens)} tok` : '',
        run.meta.cost > 0 ? `$${run.meta.cost.toFixed(4)}` : '',
      ].filter(s => s !== '').join(' · ')

      // A picture two pixels to a cell: ▀ in the top's color over the bottom's.
      const halfBlocks = (height: number, width: number, colorAt: (x: number, y: number) => string | null) =>
        Array.from({ length: height / 2 }, (_, r) => (
          <Text>
            {Array.from({ length: width }, (_, x) => {
              const top = colorAt(x, r * 2)
              const bottom = colorAt(x, r * 2 + 1)
              if (top === null && bottom === null) return <Text> </Text>
              if (top === null) return <Text color={bottom!}>▄</Text>
              if (bottom === null) return <Text color={top}>▀</Text>
              return <Text color={top} backgroundColor={bottom}>▀</Text>
            })}
          </Text>
        ))
      const iconRows = halfBlocks(icon.rows.length, icon.rows[0]?.length ?? 0, (x, y) => pixel(agent.id, x, y))

      // Lifelike mode: Clawd's line in a bubble pointing at Clawd, the agent's
      // reply in one pointing at its icon.
      const scene = sceneOf(run, now)
      const clawd = CLAWD[scene.face]
      const clawdRows = halfBlocks(clawd.length, clawd[0]?.length ?? 0, (x, y) => {
        const ch = clawd[y]?.[x] ?? '.'
        return ch === '.' ? null : ch === 't' ? '#6CB4FF' : 'claude'
      })
      const bubbleColor = ACCENT[agent.id] === 'text' ? 'inactive' : ACCENT[agent.id]
      const bubbles = lifelike && (scene.clawd !== null || scene.reply !== null) && (
        <Box flexDirection="column">
          {scene.clawd !== null && <Box flexDirection="row" justifyContent="flex-end">
            <Box borderStyle="round" borderColor="claude" paddingX={1} flexShrink={1}>
              <Text>{scene.clawd}</Text>
            </Box>
            <Box marginTop={1}><Text color="claude">▸</Text></Box>
          </Box>}
          {scene.reply !== null && <Box flexDirection="row">
            <Box marginTop={1}><Text color={bubbleColor}>◂</Text></Box>
            <Box borderStyle="round" borderColor={bubbleColor} paddingX={1} flexShrink={1}>
              <Text>{scene.reply}</Text>
            </Box>
          </Box>}
        </Box>
      )

      const header = (
        <Box flexDirection="row" gap={2} borderStyle="round" borderColor="inactive" paddingX={1}>
          <Box flexDirection="column" flexShrink={0}>{iconRows}</Box>
          <Box flexDirection="column" flexGrow={1}>
            <Text bold color={ACCENT[agent.id]}>{agent.label}</Text>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold color={b.color}>
                {b.mark} {b.word}
              </Text>
              <Text dimColor wrap="truncate-start">{facts}</Text>
            </Box>
            {taskRows.map(row => <Text wrap="truncate-end">{row}</Text>)}
            {bubbles}
          </Box>
          {lifelike && (
            <Box flexDirection="column" flexShrink={0} alignItems="center">
              <Text bold color="claude">{FACE_MARK[scene.face] || ' '}</Text>
              {clawdRows}
            </Box>
          )}
        </Box>
      )

      // The model in use: the running command's own, else the CLI's setting.
      const model = (run.status === 'running' && commandModel(run.command)) ||
        (await policyOf($)).agents[agent.id].model ||
        (await configuredModel($, agent.id))
      const modelRow = (
        <Text dimColor wrap="truncate-end">model: {model === '' ? 'CLI default' : model}</Text>
      )

      if (run.status === 'idle') {
        return (
          <Box flexDirection="column">
            {header}
            <Text dimColor>No run yet.</Text>
            <Text dimColor>Ask Claude, e.g. "let {agent.label} …"; the run shows here live.</Text>
            <Text dimColor>{KEY} hides the tabs</Text>
            {modelRow}
          </Box>
        )
      }

      // The answer gets its own box; the log above it gets the rows left.
      const answer = withoutSay(run.result?.text ?? '')
      const answerRows = answer === ''
        ? 0
        : Math.min(answer.split('\n').flatMap(l => fold(l, inner)).length + 3, Math.floor(e.props.scroll.bodyRows / 2))
      const room = Math.max(3, e.props.scroll.bodyRows - (2 + Math.max(icon.rows.length / 2, 2 + taskRows.length + (lifelike ? 6 : 0))) - answerRows - 3)
      const rows = run.lines
        .flatMap(entry =>
          entry.kind === 'tool' || entry.kind === 'out'
            ? [{ kind: entry.kind, text: PREFIX[entry.kind] + entry.text }]
            : fold(PREFIX[entry.kind] + entry.text, columns).map(text => ({ kind: entry.kind, text })),
        )
        .slice(-room)

      return (
        <Box flexDirection="column">
          {header}
          {rows.length === 0 && (
            <Text dimColor>{run.status === 'running' ? 'waiting for output…' : 'no output'}</Text>
          )}
          {rows.map(row => {
            switch (row.kind) {
              case 'think':
                return <Text dimColor italic wrap="truncate-end">{row.text}</Text>
              case 'tool':
                return <Text color="suggestion" wrap="truncate-end">{row.text}</Text>
              case 'out':
                return <Text dimColor wrap="truncate-end">{row.text}</Text>
              case 'error':
                return <Text color="error" wrap="truncate-end">{row.text}</Text>
              case 'info':
                return <Text dimColor wrap="truncate-end">{row.text}</Text>
              default:
                return <Text wrap="truncate-end">{row.text}</Text>
            }
          })}
          {answer !== '' && (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={run.result?.isOk === false ? 'error' : 'success'}
              paddingX={1}
            >
              <Text bold color={run.result?.isOk === false ? 'error' : 'success'}>Answer</Text>
              <Markdown text={answer} />
            </Box>
          )}
          <Box flexDirection="row" justifyContent="flex-end" gap={2}>
            {run.status !== 'running' && (
              <Button key="clear" plain dimColor label="clear"
                onPress={() => setRun($, agent.id, () => IDLE)} />
            )}
            <Text dimColor>{KEY} hides</Text>
          </Box>
          {modelRow}
        </Box>
      )
    })
  }
}
