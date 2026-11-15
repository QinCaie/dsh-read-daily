/**
 * dsh-read-daily —— 设置页「小喵鲸学习」
 * 自注册脚本；id 必须等于包名。
 *
 * 页面能改的东西：
 *   · 每天几点到几点之间读（时间窗，可加/删）
 *   · 每天最多几次、一次任务的有效期
 *   · 任务正文（一行一句，热改，保存后下一轮生效，不用重启 DSH）
 *   · 内容红线
 *   · 现在就来一次
 *   · 最近七天叫醒过几次（回顾）
 */
window.__ModuleLoader__.load({
  id: 'dsh-read-daily',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/read-daily'

    const CSS = `
[data-hd-page]{display:flex;flex-direction:column;gap:16px;padding:4px 2px 12px;max-width:720px;}
[data-hd-card]{border:1px solid rgba(127,127,127,.25);border-radius:10px;padding:12px 14px;}
[data-hd-card] > h4{margin:0 0 10px;font-size:13px;font-weight:600;opacity:.85;}
[data-hd-row]{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0;font-size:13px;}
[data-hd-row] input[type=number]{width:110px;}
[data-hd-row] input[type=text]{width:140px;}
[data-hd-note]{font-size:12px;opacity:.6;line-height:1.6;}
[data-hd-actions]{display:flex;gap:10px;flex-wrap:wrap;}
[data-hd-ok]{color:#3a9a55;font-size:12px;}
[data-hd-err]{color:#c0392b;font-size:12px;}
[data-hd-ta]{width:100%;min-height:150px;margin-top:8px;font-family:inherit;font-size:13px;line-height:1.7;padding:8px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;}
[data-hd-week]{display:flex;gap:14px;margin-top:12px;}
[data-hd-day]{display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11px;}
[data-hd-date]{opacity:.55;}
[data-hd-dot]{letter-spacing:2px;font-size:13px;color:#3a9a55;line-height:1;}
[data-hd-dot][data-zero]{color:rgba(127,127,127,.4);}
`

    const asJson = async (res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json() }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST', credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }))

    function Row({ label, hint, children }) {
      return h('div', { 'data-hd-row': '' },
        h('span', null, label, hint ? h('span', { 'data-hd-note': '' }, ' ' + hint) : null), children)
    }
    const Num = ({ value, onChange, min }) => h('input', {
      type: 'number', min: min ?? 0, value: value ?? 0, onChange: (e) => onChange(Number(e.target.value)),
    })
    const Box = ({ value, onChange }) => h('input', {
      type: 'checkbox', checked: !!value, onChange: (e) => onChange(e.target.checked),
    })
    const Text = ({ value, onChange, placeholder }) => h('input', {
      type: 'text', value: value ?? '', placeholder, onChange: (e) => onChange(e.target.value),
    })
    const Lines = ({ value, onChange, minHeight }) => h('textarea', {
      'data-hd-ta': '',
      style: minHeight ? { minHeight } : undefined,
      value: (value || []).join('\\n'),
      onChange: (e) => onChange(e.target.value.split('\\n').map((x) => x.replace(/\\s+$/, '')).filter((x) => x.length > 0)),
    })

    function Week({ history }) {
      const days = Array.from({ length: 7 }, (_, k) => {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - k)); return d
      })
      const countOf = (d) => (history || []).filter((t) => {
        const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime() === d.getTime()
      }).length
      return h('div', { 'data-hd-week': '' }, days.map((d, i) => {
        const c = countOf(d)
        return h('div', { key: i, 'data-hd-day': '' },
          h('span', { 'data-hd-date': '' }, `${d.getMonth() + 1}-${d.getDate()}`),
          h('span', { 'data-hd-dot': '', 'data-zero': c ? undefined : '' }, c ? '●'.repeat(Math.min(c, 5)) : '·'))
      }))
    }

    function Panel() {
      const [cfg, setCfg] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const load = async () => {
        try {
          const c = await jget('/config'); setCfg(c.config)
          const s = await jget('/status'); setStatus(s)
          setMsg(null)
        } catch (e) { setMsg({ err: String(e.message || e) }) }
      }
      React.useEffect(() => { load() }, [])

      const save = async () => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/config', cfg)
          setCfg(r.config)
          setMsg({ ok: '已保存，下一轮任务就用新的（不用重启）' })
          load()
        } catch (e) { setMsg({ err: String(e.message || e) }) }
        setBusy(false)
      }

      const act = async (p, label) => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost(p)
          setMsg(r.ok ? { ok: label + '：已叫醒她' } : { err: label + '失败：' + (r.error || '未知错误') })
          load()
        } catch (e) { setMsg({ err: String(e.message || e) }) }
        setBusy(false)
      }

      const setWin = (i, key, v) => {
        const wins = [...(cfg.windows || [])]
        wins[i] = { ...wins[i], [key]: v }
        setCfg({ ...cfg, windows: wins })
      }

      if (!cfg) return h('div', { 'data-hd-page': '' }, h('div', { 'data-hd-note': '' }, '加载中…'))

      const history = (status?.state?.history || []).map((x) => x.at)
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const todayN = history.filter((t) => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime() === today.getTime() }).length

      return h('div', { 'data-hd-page': '' },
        h('div', { 'data-hd-card': '' },
          h('h4', null, '状态'),
          status ? h('div', { 'data-hd-note': '' },
            todayN ? `今天已经叫醒她 ${todayN} 次` : '今天还没叫她读过',
            status.state?.nextAt ? `，下次 ${new Date(status.state.nextAt).toLocaleString('zh-CN')}` : '，暂无排期') : h('div', { 'data-hd-note': '' }, '…'),
          h(Week, { history }),
          h('div', { 'data-hd-actions': '', style: { marginTop: '10px' } },
            h('button', { disabled: busy, onClick: () => act('/now', '立刻读一次') }, '现在就来一次'),
            h('button', { disabled: busy, onClick: load }, '刷新'))),

        h('div', { 'data-hd-card': '' },
          h('h4', null, '什么时候读'),
          h(Row, { label: '启用' }, h(Box, { value: cfg.enabled, onChange: (v) => setCfg({ ...cfg, enabled: v }) })),
          h(Row, { label: '每天最多', hint: '在时间窗里随机挑这么多时刻' },
            h(Num, { value: cfg.dailyMax, min: 1, onChange: (v) => setCfg({ ...cfg, dailyMax: v }) })),
          h(Row, { label: '一次任务有效期（分钟）', hint: '超过就作废，避免第二天突然冒出来' },
            h(Num, { value: cfg.taskMinutes, min: 10, onChange: (v) => setCfg({ ...cfg, taskMinutes: v }) })),
          (cfg.windows || []).map((w, i) => h(Row, { key: i, label: `时间窗 ${i + 1}` },
            h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
              h(Text, { value: w.start, onChange: (v) => setWin(i, 'start', v), placeholder: '15:00' }),
              h('span', null, '→'),
              h(Text, { value: w.end, onChange: (v) => setWin(i, 'end', v), placeholder: '22:30' })))),
          h('div', { 'data-hd-actions': '' },
            h('button', { onClick: () => setCfg({ ...cfg, windows: [...(cfg.windows || []), { start: '20:00', end: '22:00' }] }) }, '加一个窗口'),
            (cfg.windows || []).length > 1
              ? h('button', { onClick: () => setCfg({ ...cfg, windows: cfg.windows.slice(0, -1) }) }, '删掉最后一个')
              : null)),

        h('div', { 'data-hd-card': '' },
          h('h4', null, '给她的话（任务正文）'),
          h('div', { 'data-hd-note': '' }, '一行一句。她会把这整段当成今天的任务；改完保存，下一轮生效，不用重启 DSH。'),
          h(Lines, {
            value: cfg.taskText,
            minHeight: '260px',
            onChange: (v) => setCfg({ ...cfg, taskText: v }),
          })),

        h('div', { 'data-hd-card': '' },
          h('h4', null, '规矩（附加在任务后面）'),
          h('div', { 'data-hd-note': '' }, '一行一条。'),
          h(Lines, { value: cfg.contentRules, onChange: (v) => setCfg({ ...cfg, contentRules: v }) })),

        h('div', { 'data-hd-actions': '' },
          h('button', { disabled: busy, onClick: save }, '保存'),
          h('button', { disabled: busy, onClick: load }, '放弃修改')),

        msg && msg.ok ? h('div', { 'data-hd-ok': '' }, msg.ok) : null,
        msg && msg.err ? h('div', { 'data-hd-err': '' }, msg.err) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-read-daily')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-read-daily: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'read-daily', order: 46, label: '小喵鲸学习' },
          () => h(Panel)))
      },
    }
  },
})
