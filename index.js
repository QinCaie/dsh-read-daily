/**
 * dsh-read-daily —— 小喵鲸学习：每天最多 4 次提醒她去网上读点东西
 * ============================================================================
 * 用户定的三条规矩（原话）：
 *   ① 一天最多几次（现在是 4 次上限，可以不读）
 *   ② 读什么：让她根据她自己的记忆决定（日记以及手账），对什么感兴趣读什么
 *   ③ 要不要给我看：也让她自己决定，不想给我看的不告诉我，想分享的话主动找我聊天
 *
 * 插件只负责"到点叫醒 + 把这三条规矩告诉她"，
 * 具体读什么、写不写、要不要分享，全由她自己定 —— 这本身就是训练的一部分。
 *
 * 分工：
 *   插件    → 在时间窗里随机挑一个时刻、叫醒她、把任务注入她那一轮
 *   她的工具 → web_search / web_fetch（搜+读正文）、mcp__fish__remember（学到的东西进 READ 项目）、
 *             diary_write / diary_*（她自己的日记，**不装学习笔记**）、
 *             mcp__snowluma__qq_send_message（想分享时找他）
 * ============================================================================
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadHostDeps } from './lib/hostdeps.mjs'

let hostDeps = { z: null, defineTool: null }
try { hostDeps = await loadHostDeps() } catch (e) {
  console.log(`[read-daily] 取宿主依赖失败：${e?.message ?? e}`)
}
const defineTool = hostDeps.defineTool || ((o) => o)

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))

export const name = 'read-daily'
export const inject = ['tools', 'webServer', 'agents']

const DEFAULTS = {
  enabled: true,
  bridgeUrl: 'http://127.0.0.1:3100',
  consoleTokenFile: 'D:\\Ayu\\qq-bridge\\state\\console-token',
  targets: ['private:2463543687'],
  stateFile: 'D:\\Ayu\\qq-bridge\\state\\bili-humanism.json',

  // 每天在时间窗里随机排 dailyMax 个时刻，避免像闹钟一样固定
  windows: [{ start: '15:00', end: '22:30' }],
  dailyMax: 2,
  // 任务有效期（分钟）：超过这段时间就不再注入，避免第二天突然冒出来
  taskMinutes: 120,

  // 任务正文（可运行时通过 /api/read-daily/config 修改，改完下一轮生效，不用重启 DSH）
  // 教训：写得太软她会当成「那就不做」；但也不能逼她凑数——所以既写「现在就去」，
  // 也写「没想读的就跳过」。
  taskText: [
    '【去读点东西的时候到了】',
    '这是今天最多 4 次里的其中一次。',
    '如果你现在没什么想读的，直接跳过这一次，不用凑数、不用假装读了。',
    '',
    '想读的话：',
    '  翻翻自己的日记，想想最近在好奇什么、惦记什么；',
    '  然后用 mcp__web-search-safe__web_search 搜一搜，挑一个你真想看的。',
    '',
    '怎么读：',
    '  用 mcp__web-search-safe__web_fetch 打开链接读正文；',
    '  抓不到正文就换一个，别硬编内容。',
    '',
    '读完：',
    '  真学到东西，就写进长期记忆 —— mcp__fish__remember：',
    '    project="READ"、mem_type="fact"、tags=["学到的", "网上读的"]',
    '    一条只记一件事，用「原来以为…／现在知道…」写，别复述原文。',
    '    正文末尾附上你读的那篇的链接，并写明这是「原文说的」还是「我自己验证过」——',
    '    没有链接的记忆，过一个月就分不清是你的看法还是别人说的。',
    '  没学到什么就不用记，别硬凑。',
    '',
    '  注意：这不是日记。日记写你自己的事和心情；学到的东西进记忆库，别写进日记。',
    '',
    '要不要告诉他，也由你自己定：',
    '  不想说就不说；想分享就主动找他（私聊直接说，不用报备）。',
  ],

  // 附加规矩：拼在任务正文后面一起注入
  contentRules: [
    '挑什么看你自己的兴趣，不用管有没有用、有没有产出。',
    '不要挑：政治、社会新闻、灾难事故、医疗恐吓、擦边、骂战、扒人隐私这类。',
    '读不到正文就换一个，宁可空着也别脑补。',
    '学到的东西进 fish 记忆（project=READ），不写进日记 —— 日记是你自己的地方。',
    '要不要告诉他，你自己定：不想说就不说，想说就主动找他聊。',
  ],
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? deepMerge(base[k], v)
      : v
  }
  return out
}

const pad = (n) => String(n).padStart(2, '0')
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const minutesOf = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export function apply(ctx) {
  const log = (m) => console.log(`[read-daily] ${m}`)

  let cfg = deepMerge(DEFAULTS, {})
  const cfgFile = join(PLUGIN_DIR, 'config.json')
  const loadCfg = () => {
    try { if (existsSync(cfgFile)) cfg = deepMerge(DEFAULTS, JSON.parse(readFileSync(cfgFile, 'utf8'))) } catch {}
  }
  const saveCfg = (patch) => {
    const next = deepMerge(cfg, patch || {})
    try { writeFileSync(cfgFile, JSON.stringify(next, null, 2), 'utf8') } catch {}
    cfg = next
    return cfg
  }
  loadCfg()

  let st = { day: '', firedAt: 0, nextAt: 0, taskUntil: 0, history: [] }
  try { if (existsSync(cfg.stateFile)) st = { ...st, ...JSON.parse(readFileSync(cfg.stateFile, 'utf8')) } } catch {}
  const saveState = () => {
    try { mkdirSync(dirname(cfg.stateFile), { recursive: true }); writeFileSync(cfg.stateFile, JSON.stringify(st, null, 2), 'utf8') } catch {}
  }

  // 每天在时间窗里随机排 dailyMax 个时刻，到点各叫醒一次
  function planToday(now = Date.now(), already = 0) {
    const mins = []
    for (const w of Array.isArray(cfg.windows) ? cfg.windows : []) {
      const s = minutesOf(w.start)
      const e = minutesOf(w.end)
      if (s === null || e === null || s >= e) continue
      for (let m = s; m < e; m++) mins.push(m)
    }
    if (!mins.length) return []
    const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes()
    const future = mins.filter((m) => m > nowMin + 1)
    const pool = future.length ? future : mins
    const want = Math.max(0, Math.min(Number(cfg.dailyMax) || 1, pool.length) - already)
    if (!want) return []
    const picked = []
    let guard = 0
    while (picked.length < want && guard++ < pool.length * 20) {
      const m = pool[Math.floor(Math.random() * pool.length)]
      if (!picked.includes(m)) picked.push(m)
    }
    picked.sort((a, b) => a - b)
    const sod = new Date(now)
    sod.setHours(0, 0, 0, 0)
    return picked.map((m) => sod.getTime() + m * 60000)
  }

  function rollDay(now = Date.now()) {
    const today = dayKey()
    if (st.day !== today || !Array.isArray(st.slots) || !st.slots.length) {
      const already = (st.history || []).filter((h) => dayKey(new Date(h.at)) === today).length
      st.day = today
      st.slots = planToday(now, already)
    }
  }
  let timer = null
  function scheduleNext() {
    if (timer) { clearTimeout(timer); timer = null }
    if (!cfg.enabled) { st.nextAt = 0; saveState(); return }
    const now = Date.now()
    rollDay(now)
    const next = (Array.isArray(st.slots) ? st.slots : []).find((x) => x > now)
    if (!next) {
      // 今天的排期用完：定到明天 00:05 重新规划
      const t2 = new Date(now)
      t2.setHours(24, 5, 0, 0)
      st.nextAt = t2.getTime()
      saveState()
      timer = setTimeout(fire, Math.max(5000, st.nextAt - now))
      log(`今天的 ${(st.history || []).filter((h) => dayKey(new Date(h.at)) === dayKey()).length} 次读完，等明天`)
      return
    }
    st.nextAt = next
    saveState()
    const waitMs = Math.max(5000, next - now)
    log(`下次学习：${new Date(next).toLocaleString('zh-CN')}（${Math.round(waitMs / 60000)} 分钟后）`)
    timer = setTimeout(fire, waitMs)
  }
  async function fireWake(reason) {
    const target = (Array.isArray(cfg.targets) ? cfg.targets[0] : '')
    if (!target) return { ok: false, error: '没有配置 targets' }
    let token = ''
    try { token = readFileSync(cfg.consoleTokenFile, 'utf8').trim() } catch { return { ok: false, error: '读不到 console-token' } }
    const url = `${String(cfg.bridgeUrl).replace(/\/$/, '')}/api/socialV2/wake`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-console-token': token },
        body: JSON.stringify({ key: target, reason: reason || 'read-daily' }),
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      return { ok: true, target }
    } catch (e) { return { ok: false, error: e?.message ?? String(e) } }
  }

  async function fire() {
    timer = null
    try {
      loadCfg()
      if (!cfg.enabled) return
      const now = Date.now()
      rollDay(now)
      st.slots = (Array.isArray(st.slots) ? st.slots : []).filter((x) => x > now - 60000)
      if (!st.slots.length) { scheduleNext(); return }
      st.firedAt = now
      st.taskUntil = now + Number(cfg.taskMinutes ?? 120) * 60000
      st.history = [...(st.history || []).slice(-19), { at: now }]
      st.slots = st.slots.filter((x) => x > now + 1000)
      saveState()
      const todayN = (st.history || []).filter((h) => dayKey(new Date(h.at)) === dayKey()).length
      log(`到点了（今天第 ${todayN} 次），叫醒她去读点东西`)
      const r = await fireWake('read-daily')
      if (!r.ok) log(`唤醒失败：${r.error}`)
    } catch (e) {
      log(`出错：${e?.message ?? e}`)
    }
    scheduleNext()
  }
  // ── 任务文案 ────────────────────────────────────────────────
  // 用户的三条规矩：一天一次、读什么她定、要不要告诉他她定。
  // 教训（2026-10-22 实测）：写太软（"不是任务清单、别当打卡"）她会理解成"那就不做"，
  // 收到任务后只调 qq_wait_for_messages 就结束了。所以：
  //   · 读什么 → 保留她的自由
  //   · 做不做 → 明确"这一次现在就读"，并点名不要只等着
  // 文案本体在 DEFAULTS.taskText（可运行时改，不用重启）。
  const buildTask = () => [
    ...(Array.isArray(cfg.taskText) ? cfg.taskText : []),
    '',
    '规矩：',
    ...(Array.isArray(cfg.contentRules) ? cfg.contentRules : []).map((r) => `- ${r}`),
  ].join('\n')

  function attachInjection(agent) {
    const agentCtx = agent?.ctx
    if (!agentCtx?.on) return
    try {
      agentCtx.on('agent/pre-step', async (_p, next) => {
        const decision = await next()
        try {
          if (decision?.kind !== 'enter') return decision
          if (!st.taskUntil || Date.now() > st.taskUntil) return decision
          const h = agent?.session?.header ?? {}
          const isQq = /qq-bridge/i.test(String(h.cwd ?? '')) || /^qq-chat/.test(String(h.agentPreset ?? ''))
          if (!isQq) return decision
          st.taskUntil = 0
          saveState()
          const msg = Object.freeze({
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: buildTask() }],
            source: { kind: 'read-daily', form: 'notice', summary: '今天可以读点东西' },
          })
          log('任务已注入给她')
          return { ...decision, messages: [...decision.messages, msg] }
        } catch { return decision }
      }, { prepend: true })
    } catch {}
  }

  try {
    for (const a of ctx.agents?.list?.() ?? []) attachInjection(a)
    ctx.on('agent/created', (p) => { const a = p?.agent ?? p; if (a) attachInjection(a) })
  } catch (e) { log(`注入挂载失败：${e?.message ?? e}`) }

  scheduleNext()
  ctx.effect(() => () => { if (timer) clearTimeout(timer) }, 'read-daily: 调度器')

  // ── 工具 ───────────────────────────────────────────────────
  const textOutput = {
    schema: { type: 'object', properties: {}, additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
  }
  const tool = (spec) => ctx.tools.register(defineTool({ ...spec, output: textOutput }))

  tool({
    name: 'bili_read_status',
    description: '看"每天读点东西"的排期：今天读过没、下次几点。',
    parameters: {},
    async execute() {
      return {
        ok: true,
        enabled: cfg.enabled,
        windows: (cfg.windows || []).map((w) => `${w.start}–${w.end}`),
        todayFired: st.day === dayKey() && Boolean(st.firedAt),
        firedAt: st.firedAt ? new Date(st.firedAt).toLocaleString('zh-CN') : null,
        nextAt: st.nextAt ? new Date(st.nextAt).toLocaleString('zh-CN') : null,
        nextInMinutes: st.nextAt ? Math.max(0, Math.round((st.nextAt - Date.now()) / 60000)) : null,
      }
    },
  })

  tool({
    name: 'bili_read_now',
    description: '现在就来一次"读点东西"（立刻叫醒并注入任务，不等排期）。',
    parameters: {},
    async execute() {
      st.day = dayKey()
      st.firedAt = Date.now()
      st.taskUntil = Date.now() + Number(cfg.taskMinutes ?? 120) * 60000
      saveState()
      return fireWake('read-daily')
    },
  })

  // ── HTTP（给控制台/设置页用） ──────────────────────────────
  const sendJson = (res, code, body) => {
    try { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) } catch {}
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/read-daily',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      try {
        if (req.method === 'GET' && url.pathname === '/api/read-daily/config') {
          return sendJson(res, 200, { ok: true, config: cfg, defaults: DEFAULTS })
        }
        if (req.method === 'POST' && url.pathname === '/api/read-daily/config') {
          const chunks = []
          for await (const c of req) chunks.push(c)
          saveCfg(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
          scheduleNext()
          return sendJson(res, 200, { ok: true, config: cfg })
        }
        if (req.method === 'GET' && url.pathname === '/api/read-daily/status') {
          return sendJson(res, 200, { ok: true, state: st })
        }
        if (req.method === 'POST' && url.pathname === '/api/read-daily/now') {
          return sendJson(res, 200, await fireWake('read-daily'))
        }
        return sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (e) { return sendJson(res, 500, { ok: false, error: e?.message ?? String(e) }) }
    },
  }), 'read-daily: /api/read-daily 路由')

  log(`已挂载：时间窗 ${(cfg.windows || []).map((w) => `${w.start}-${w.end}`).join(' / ')}，每天 ${cfg.dailyMax} 次`)
}
