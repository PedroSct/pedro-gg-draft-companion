import { useMemo } from 'react'
import { ROLE_PT, type Analysis, type Insight, type InsightLevel, type MatchReport, type PgParticipant, type PgSummary } from '../../../shared/postgame'
import { useApp } from '../store/useApp'
import { btn, btnGold, btnDanger } from '../lib/ui'
import { ChampionIcon, useChampionName } from './Icons'
import { CountUp, GrowBar, LineChart, Radar, ScoreRing, gradeColor } from './charts'

const QUEUE: Record<number, string> = {
  400: 'Normal',
  420: 'Ranqueada Solo/Duo',
  430: 'Normal às cegas',
  440: 'Ranqueada Flex',
  450: 'ARAM',
  490: 'Partida rápida',
  700: 'Clash',
  900: 'URF',
  1700: 'Arena',
  1900: 'URF'
}
const queueName = (q: number, mode: string): string => QUEUE[q] ?? (mode === 'ARAM' ? 'ARAM' : mode === 'CLASSIC' ? 'Clássico' : mode || 'Partida')

const fmtDuration = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
const fmtWhen = (ms: number | null): string => {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}
const sgn = (v: number | null, unit = ''): string => (v === null ? '–' : `${v > 0 ? '+' : ''}${Math.round(v)}${unit}`)
const tone = (v: number | null): string => (v === null || v === 0 ? 'text-mist' : v > 0 ? 'text-ally' : 'text-enemy')

// ---------------------------------------------------------------- lista de partidas

function HistoryRow({ item, active }: { item: PgSummary; active: boolean }) {
  const select = useApp((s) => s.selectPostGame)
  const name = useChampionName(item.championId)
  const win = item.win
  return (
    <li>
      <button
        type="button"
        onClick={() => void select(item.gameId)}
        aria-current={active ? 'true' : undefined}
        className={`group relative flex w-full items-center gap-3 overflow-hidden border px-3 py-2 text-left transition-all duration-200 hover:-translate-y-px hover:border-mist/50 ${
          active ? 'border-gold/60 bg-raised' : 'border-line bg-panel/70'
        }`}
      >
        <span className={`absolute inset-y-0 left-0 w-1 ${win === null ? 'bg-dim' : win ? 'bg-ally' : 'bg-enemy'}`} aria-hidden="true" />
        <ChampionIcon id={item.championId} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-lg font-semibold leading-tight">{name || 'Campeão'}</span>
          <span className="block truncate text-xs text-mist">
            {win === null ? '' : win ? 'Vitória' : 'Derrota'} · {item.kills}/{item.deaths}/{item.assists} · {fmtDuration(item.durationSec)}
          </span>
          <span className="block truncate text-[11px] text-dim">{fmtWhen(item.playedAt ?? item.savedAt)}</span>
        </span>
        <span className="num text-2xl font-semibold" style={{ color: gradeColor(item.grade) }} aria-label={`Conceito ${item.grade}`}>
          {item.grade}
        </span>
      </button>
    </li>
  )
}

function Sidebar() {
  const list = useApp((s) => s.postList)
  const selected = useApp((s) => s.postSelectedId)
  const busy = useApp((s) => s.postBusy)
  const msg = useApp((s) => s.postMessage)
  const fetchLatest = useApp((s) => s.fetchLatestPostGame)
  const status = useApp((s) => s.lcuStatus)
  return (
    <aside className="flex min-h-0 flex-col gap-3" aria-label="Partidas analisadas">
      <div>
        <button type="button" className={`${btnGold} w-full justify-center`} disabled={busy || status !== 'connected'} onClick={() => void fetchLatest()}>
          {busy ? 'Buscando a partida…' : 'Analisar última partida'}
        </button>
        {status !== 'connected' && <p className="mt-1.5 text-xs text-mist">Abra o League of Legends para buscar partidas.</p>}
        {msg && (
          <p role="status" className={`mt-1.5 text-xs ${msg.ok ? 'text-ally' : 'text-enemy'}`}>
            {msg.text}
          </p>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-mist">As partidas aparecem aqui sozinhas quando terminam.</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {list.map((it) => (
            <HistoryRow key={it.gameId} item={it} active={it.gameId === selected} />
          ))}
        </ul>
      )}
    </aside>
  )
}

// ---------------------------------------------------------------- detalhe

const LEVEL_STYLE: Record<InsightLevel, { border: string; text: string; icon: string }> = {
  good: { border: 'border-ally', text: 'text-ally', icon: '▲' },
  warn: { border: 'border-gold', text: 'text-gold', icon: '!' },
  bad: { border: 'border-enemy', text: 'text-enemy', icon: '▼' },
  info: { border: 'border-mist/50', text: 'text-mist', icon: 'i' }
}

function InsightCard({ insight, i }: { insight: Insight; i: number }) {
  const st = LEVEL_STYLE[insight.level]
  return (
    <li className={`rise border-l-2 bg-panel/80 px-3 py-2 ${st.border}`} style={{ ['--d' as string]: `${120 + i * 70}ms` }}>
      <div className={`flex items-center gap-2 font-display text-lg font-semibold leading-tight ${st.text}`}>
        <span aria-hidden="true" className="text-xs">
          {st.icon}
        </span>
        {insight.title}
      </div>
      <p className="text-sm text-mist">{insight.detail}</p>
    </li>
  )
}

function Panel({ title, children, className = '', delay = 0 }: { title: string; children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <section className={`rise border border-line bg-panel/70 p-4 backdrop-blur-sm ${className}`} style={{ ['--d' as string]: `${delay}ms` }}>
      <h3 className="mb-3 font-display text-lg font-semibold tracking-wide text-snow">{title}</h3>
      {children}
    </section>
  )
}

function Hero({ report, a }: { report: MatchReport; a: Analysis }) {
  const me = report.participants.find((p) => p.isMe)!
  const name = useChampionName(me.championId)
  const win = report.win
  return (
    <div className={`rise relative flex flex-wrap items-center gap-6 overflow-hidden border border-line bg-panel/80 p-5`}>
      <div className={`absolute inset-y-0 left-0 w-1.5 ${win ? 'bg-ally' : 'bg-enemy'}`} aria-hidden="true" />
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-20 blur-3xl"
        style={{ background: win ? 'var(--color-ally)' : 'var(--color-enemy)' }}
        aria-hidden="true"
      />
      <ChampionIcon id={me.championId} size={84} />
      <div className="min-w-0 flex-1">
        <div className={`font-display text-sm font-semibold uppercase tracking-[0.2em] ${win ? 'text-ally' : 'text-enemy'}`}>{win ? 'Vitória' : 'Derrota'}</div>
        <h2 className="font-display text-4xl font-semibold leading-tight">{name || 'Campeão'}</h2>
        <p className="text-sm text-mist">
          {a.role ? ROLE_PT[a.role] : 'Rota não identificada'} · {queueName(report.queueId, report.mode)} · {fmtDuration(report.durationSec)}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="num text-2xl font-semibold">{me.kills}</span>
            <span className="text-dim"> / </span>
            <span className="num text-2xl font-semibold text-enemy">{me.deaths}</span>
            <span className="text-dim"> / </span>
            <span className="num text-2xl font-semibold">{me.assists}</span>
            <span className="ml-1 text-mist">KDA</span>
          </span>
          <Stat label="CS/min" value={a.csPerMin} decimals={1} />
          <Stat label="Participação" value={Math.round(a.killParticipation * 100)} suffix="%" />
          <Stat label="Dano do time" value={Math.round(a.damageShare * 100)} suffix="%" />
        </div>
      </div>
      <ScoreRing score={a.score} grade={a.grade} />
    </div>
  )
}

function Stat({ label, value, decimals = 0, suffix = '' }: { label: string; value: number; decimals?: number; suffix?: string }) {
  return (
    <span>
      <CountUp value={value} decimals={decimals} suffix={suffix} className="text-2xl font-semibold" />
      <span className="ml-1 text-mist">{label}</span>
    </span>
  )
}

function Scoreboard({ report }: { report: MatchReport }) {
  const maxDmg = Math.max(1, ...report.participants.map((p) => p.damage))
  const teams = [100, 200].map((t) => report.participants.filter((p) => p.teamId === t))
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {teams.map((team, ti) => (
        <div key={ti}>
          <div className={`mb-1 text-xs font-semibold uppercase tracking-widest ${team[0]?.win ? 'text-ally' : 'text-enemy'}`}>
            {team[0]?.win ? 'Time vencedor' : 'Time derrotado'}
          </div>
          <ul className="flex flex-col gap-1">
            {team.map((p) => (
              <ScoreRow key={p.id} p={p} maxDmg={maxDmg} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function ScoreRow({ p, maxDmg }: { p: PgParticipant; maxDmg: number }) {
  const name = useChampionName(p.championId)
  return (
    <li className={`grid grid-cols-[36px_1fr_auto] items-center gap-2 px-2 py-1 ${p.isMe ? 'bg-gold/10 ring-1 ring-gold/40' : 'bg-deck/60'}`}>
      <ChampionIcon id={p.championId} size={32} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{p.isMe ? 'Você' : p.name || name}</span>
          <span className="truncate text-[11px] text-dim">{p.role ? ROLE_PT[p.role] : name}</span>
        </div>
        <GrowBar value={p.damage} max={maxDmg} color={p.win ? 'var(--color-ally)' : 'var(--color-enemy)'} label={`Dano ${p.damage}`} />
      </div>
      <div className="num text-right text-sm leading-tight">
        <div>
          {p.kills}/{p.deaths}/{p.assists}
        </div>
        <div className="text-xs text-mist">
          {p.cs + p.jungleCs} CS · {p.visionScore} vis
        </div>
      </div>
    </li>
  )
}

function Diffs({ a }: { a: Analysis }) {
  if (a.diffs.length === 0) return <p className="text-sm text-mist">Sem oponente de rota identificado ou sem timeline nesta partida.</p>
  return (
    <div className="grid grid-cols-3 gap-3">
      {a.diffs.map((d) => (
        <div key={d.minute} className="border border-line bg-deck/70 p-3 text-center">
          <div className="text-xs uppercase tracking-widest text-mist">{d.minute} min</div>
          <div className={`num text-2xl font-semibold ${tone(d.gold)}`}>{sgn(d.gold)}</div>
          <div className="text-[11px] text-dim">ouro</div>
          <div className="mt-1 flex justify-center gap-3 text-xs">
            <span className={tone(d.cs)}>CS {sgn(d.cs)}</span>
            <span className={tone(d.xp)}>XP {sgn(d.xp)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function Detail() {
  const detail = useApp((s) => s.postDetail)
  const del = useApp((s) => s.deletePostGame)
  const oppName = useChampionName(
    detail?.analysis.opponentId ? (detail.report.participants.find((p) => p.id === detail.analysis.opponentId)?.championId ?? 0) : 0
  )
  const swingMarkers = useMemo(() => (detail ? detail.analysis.swings.map((s) => ({ x: s.minute, label: '' })) : []), [detail])
  if (!detail) return null
  const { report, analysis: a } = detail
  const hasSeries = a.minutes.length >= 3
  const oppLabel = oppName ? `Oponente (${oppName})` : 'Oponente'

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 [&>*]:shrink-0" key={report.gameId}>
      <Hero report={report} a={a} />

      <div className="grid gap-4 xl:grid-cols-[minmax(300px,380px)_1fr]">
        <Panel title="Seu desempenho" delay={80}>
          <div className="flex justify-center">
            <Radar items={a.components.map((c) => ({ label: c.label, score: c.score }))} />
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {a.components.map((c) => (
              <li key={c.key}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{c.label}</span>
                  <span className="num text-mist">{c.score}</span>
                </div>
                <GrowBar value={c.score} color={c.score >= 70 ? 'var(--color-ally)' : c.score >= 45 ? 'var(--color-gold)' : 'var(--color-enemy)'} label={`${c.label} ${c.score}`} />
                <div className="text-[11px] text-dim">{c.note}</div>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="O que a partida mostrou" delay={140}>
            {a.insights.length === 0 ? (
              <p className="text-sm text-mist">Nada fora do comum nesta partida.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {a.insights.map((ins, i) => (
                  <InsightCard key={ins.title} insight={ins} i={i} />
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={`Contra o oponente de rota${a.opp ? '' : ''}`} delay={200}>
            <Diffs a={a} />
          </Panel>
        </div>
      </div>

      {hasSeries && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Farm (CS) por minuto" delay={240}>
            <LineChart
              xs={a.minutes}
              ariaLabel="CS por minuto, você contra o oponente de rota"
              markers={[{ x: 10, label: '10' }, { x: 15, label: '15' }]}
              series={[
                { name: 'Você', color: 'var(--color-ally)', values: a.me.cs },
                ...(a.opp ? [{ name: oppLabel, color: 'var(--color-enemy)', values: a.opp.cs, dashed: true }] : [])
              ]}
            />
          </Panel>
          <Panel title="Ouro por minuto" delay={280}>
            <LineChart
              xs={a.minutes}
              ariaLabel="Ouro por minuto, você contra o oponente de rota"
              format={(v) => `${(v / 1000).toFixed(1)}k`}
              series={[
                { name: 'Você', color: 'var(--color-gold)', values: a.me.gold },
                ...(a.opp ? [{ name: oppLabel, color: 'var(--color-enemy)', values: a.opp.gold, dashed: true }] : [])
              ]}
            />
          </Panel>
          <Panel title="Quem estava na frente (ouro dos times)" delay={320} className="xl:col-span-2">
            <LineChart
              xs={a.minutes}
              area
              width={1120}
              height={210}
              markers={swingMarkers}
              ariaLabel="Diferença de ouro entre o seu time e o inimigo"
              format={(v) => `${v > 0 ? '+' : ''}${(v / 1000).toFixed(1)}k`}
              series={[{ name: 'Seu time menos o inimigo', color: 'var(--color-ally)', values: a.teamGoldDiff }]}
            />
            {a.swings.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {a.swings.map((s) => (
                  <li key={s.minute} className="flex gap-2">
                    <span className="num text-gold">{s.minute} min</span>
                    <span className={s.delta > 0 ? 'text-ally' : 'text-enemy'}>{s.delta > 0 ? '▲' : '▼'}</span>
                    <span className="text-mist">{s.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {a.phases.length > 0 && (
          <Panel title="Abates e mortes por fase" delay={360}>
            <ul className="flex flex-col gap-3">
              {a.phases.map((ph) => (
                <li key={ph.label}>
                  <div className="mb-1 text-sm text-mist">{ph.label}</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <PhaseCell label="Abates" value={ph.kills} color="var(--color-ally)" />
                    <PhaseCell label="Mortes" value={ph.deaths} color="var(--color-enemy)" />
                    <PhaseCell label="Assist." value={ph.assists} color="var(--color-gold)" />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {a.objectives.length > 0 && (
          <Panel title="Objetivos" delay={400}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-dim">
                  <th className="pb-1 font-medium">Objetivo</th>
                  <th className="pb-1 text-center font-medium text-ally">Seu time</th>
                  <th className="pb-1 text-center font-medium text-enemy">Inimigo</th>
                  <th className="pb-1 text-center font-medium text-gold">Você</th>
                </tr>
              </thead>
              <tbody>
                {a.objectives.map((o) => (
                  <tr key={o.kind} className="border-t border-line/60">
                    <td className="py-1">{o.label}</td>
                    <td className="num text-center">{o.team}</td>
                    <td className="num text-center">{o.enemy}</td>
                    <td className="num text-center">{o.mine}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>

      <Panel title="Placar" delay={440}>
        <Scoreboard report={report} />
      </Panel>

      <div className="flex justify-end pb-2">
        <button type="button" className={btnDanger} onClick={() => void del(report.gameId)}>
          Remover do histórico
        </button>
      </div>
    </div>
  )
}

function PhaseCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="border border-line bg-deck/70 py-1.5">
      <div className="num text-2xl font-semibold leading-none" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] text-dim">{label}</div>
    </div>
  )
}

function Empty() {
  const busy = useApp((s) => s.postBusy)
  const fetchLatest = useApp((s) => s.fetchLatestPostGame)
  const status = useApp((s) => s.lcuStatus)
  const msg = useApp((s) => s.postMessage)
  return (
    <div className="grid h-full place-items-center">
      <div className="flex max-w-lg flex-col items-center text-center">
        <svg viewBox="0 0 120 70" className="mb-6 h-24 w-40" aria-hidden="true">
          <polyline points="4,60 30,44 52,50 78,22 100,30 116,8" fill="none" stroke="var(--color-ally)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="draw" />
          <circle cx="116" cy="8" r="4" fill="var(--color-gold)" />
        </svg>
        <h1 className="font-display text-3xl font-semibold">Sua primeira análise aparece aqui</h1>
        <p className="mt-2 text-mist">
          Quando uma partida terminar, o Pedro.gg lê o resultado no cliente do LoL e mostra como foi o seu farm, a rota, as mortes, os objetivos e a visão, minuto a minuto.
        </p>
        <button type="button" className={`${btn} mt-5`} disabled={busy || status !== 'connected'} onClick={() => void fetchLatest()}>
          {busy ? 'Buscando a partida…' : 'Analisar a última partida que joguei'}
        </button>
        {msg && (
          <p role="status" className={`mt-2 text-sm ${msg.ok ? 'text-ally' : 'text-enemy'}`}>
            {msg.text}
          </p>
        )}
        {status !== 'connected' && <p className="mt-2 text-xs text-dim">Abra o League of Legends para buscar partidas.</p>}
      </div>
    </div>
  )
}

export function PostGameScreen() {
  const list = useApp((s) => s.postList)
  const detail = useApp((s) => s.postDetail)
  if (list.length === 0) return <Empty />
  return (
    <div className="grid h-full grid-cols-[minmax(240px,300px)_1fr] gap-5">
      <Sidebar />
      {detail ? <Detail /> : <div className="grid place-items-center text-mist">Carregando a partida…</div>}
    </div>
  )
}
