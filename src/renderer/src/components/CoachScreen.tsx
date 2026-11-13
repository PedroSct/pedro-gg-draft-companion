import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Role } from '../../../shared/types'
import type { Tier } from '../../../shared/dataTypes'
import { tagLabel, type CoachReport, type CoachSuggestion, type CoachTip } from '../../../shared/coach'
import { ROLE_TIPS } from '../../../shared/gamePlan'
import { summarizeProgress } from '../../../shared/progress'
import { selectActiveProfile, useApp } from '../store/useApp'
import { ROLE_LABEL, ROLE_SHORT } from '../lib/format'
import { btn, btnGold } from '../lib/ui'
import { ChampionIcon, useChampionName } from './Icons'
import { GamePlan } from './GamePlan'

const pct = (n: number): string => `${Math.round(n * 100)}%`

const TIER_STYLE: Record<Tier, string> = {
  S: 'bg-gold/20 text-gold border-gold/50',
  A: 'bg-ally/15 text-ally border-ally/40',
  B: 'bg-raised text-snow border-line',
  C: 'bg-raised text-mist border-line',
  D: 'bg-enemy/10 text-enemy border-enemy/40'
}

const TIP_LOOK: Record<CoachTip['level'], { bar: string; text: string }> = {
  good: { bar: 'bg-ally', text: 'text-ally' },
  warn: { bar: 'bg-gold', text: 'text-gold' },
  info: { bar: 'bg-mist/60', text: 'text-mist' }
}

const CONCENTRATION: Record<CoachReport['concentration'], { label: string; cls: string }> = {
  high: { label: 'Pool muito concentrada', cls: 'border-gold/60 bg-gold/10 text-gold' },
  medium: { label: 'Pool um pouco concentrada', cls: 'border-line bg-raised text-snow' },
  healthy: { label: 'Boa variedade', cls: 'border-ally/50 bg-ally/10 text-ally' }
}

function Card({ title, hint, children, className = '' }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`rounded-2xl border border-line bg-panel/70 p-4 ${className}`}>
      <header className="mb-3">
        <h3 className="font-display text-xl font-semibold text-snow">{title}</h3>
        {hint && <p className="text-xs text-mist">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

function ChampLine({ id, games, wins, share }: { id: number; games: number; wins: number; share: number }) {
  const name = useChampionName(id)
  const wr = games > 0 ? wins / games : 0
  return (
    <li className="flex items-center gap-3">
      <ChampionIcon id={id} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm text-snow">{name}</span>
          <span className="num text-xs text-mist">
            {games} {games === 1 ? 'partida' : 'partidas'} · <span className={wr >= 0.5 ? 'text-ally' : 'text-enemy'}>{pct(wr)}</span>
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${pct(share)} das partidas`}>
          <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.max(3, Math.round(share * 100))}%` }} />
        </div>
      </div>
    </li>
  )
}

function Difficulty({ value }: { value: number }) {
  const dots = Math.max(1, Math.round(value / 2))
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={`Dificuldade ${value} de 10`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-1.5 w-3 rounded-full ${i <= dots ? 'bg-gold' : 'bg-raised'}`} />
      ))}
    </span>
  )
}

function SuggestionCard({ s }: { s: CoachSuggestion }) {
  const name = useChampionName(s.championId)
  const owner = useApp(selectActiveProfile)
  const key = useApp((st) => st.champById.get(s.championId)?.key)
  const saveProfile = useApp((st) => st.saveProfile)
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState(false)
  const inPool = !!owner && owner.pool[s.role].some((e) => e.championId === s.championId)

  async function add(): Promise<void> {
    if (!owner || !key) return
    await saveProfile({ ...owner, pool: { ...owner.pool, [s.role]: [...owner.pool[s.role], { championId: s.championId, championKey: key, comfort: 1 }] } })
    setAdded(true)
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-deck/60 p-3.5">
      <div className="flex items-center gap-3">
        <ChampionIcon id={s.championId} size={52} />
        <div className="min-w-0 flex-1">
          <h4 className="truncate font-display text-2xl font-semibold leading-none text-snow">{name}</h4>
          <p className="mt-1 text-xs text-mist">
            {ROLE_LABEL[s.role]} · {pct(s.winrate)} de vitórias
          </p>
        </div>
        <span className={`grid h-7 w-7 place-items-center rounded-md border font-display text-sm font-bold ${TIER_STYLE[s.tier]}`} title={`Tier ${s.tier}`}>
          {s.tier}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {s.reasons.map((r) => (
          <li key={r} className="flex gap-2 text-sm text-mist">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
      {s.difficulty !== null && (
        <div className="flex items-center gap-2 text-xs text-dim">
          Dificuldade <Difficulty value={s.difficulty} />
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <button type="button" className={btn} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Esconder plano' : 'Como jogar'}
        </button>
        <button type="button" className={btnGold} disabled={!owner || !key || inPool || added} onClick={() => void add()} aria-label={`Adicionar ${name} à Pool`}>
          {inPool || added ? 'Na Pool' : 'Adicionar à Pool'}
        </button>
        {!owner && <span className="text-xs text-dim">Crie um perfil para adicionar.</span>}
      </div>
      {open && <GamePlan championId={s.championId} role={s.role} compact />}
    </li>
  )
}

function Tip({ t }: { t: CoachTip }) {
  const look = TIP_LOOK[t.level]
  return (
    <li className="flex items-start gap-3 rounded-xl border border-line bg-deck/60 p-3">
      <span aria-hidden="true" className={`mt-0.5 h-full min-h-10 w-1 shrink-0 self-stretch rounded-full ${look.bar}`} />
      {t.championId !== undefined && <ChampionIcon id={t.championId} size={36} />}
      <div className="min-w-0">
        <p className={`text-sm font-medium ${look.text}`}>{t.title}</p>
        <p className="mt-0.5 text-sm text-mist">{t.detail}</p>
      </div>
    </li>
  )
}

function Fundamentals({ role }: { role: Role }) {
  const moments: { id: 'early' | 'mid' | 'late'; label: string; levels: string }[] = [
    { id: 'early', label: 'Início', levels: 'níveis 1 a 5' },
    { id: 'mid', label: 'Meio', levels: 'níveis 6 a 11' },
    { id: 'late', label: 'Fim', levels: 'níveis 12 a 18' }
  ]
  return (
    <ol className="grid grid-cols-3 gap-3 max-[1100px]:grid-cols-1">
      {moments.map((m, i) => (
        <li key={m.id} className="rounded-xl border border-line bg-deck/60 p-3.5">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="num grid h-6 w-6 place-items-center rounded-full bg-raised text-xs font-semibold text-gold">
              {i + 1}
            </span>
            <h4 className="font-display text-lg font-semibold leading-none">{m.label}</h4>
            <span className="text-xs text-mist">{m.levels}</span>
          </div>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {ROLE_TIPS[role][m.id].map((t) => (
              <li key={t} className="flex gap-2 text-sm text-mist">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

type State = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; account: string | null; report: CoachReport }

/** Aba Treino: seu jeito de jogar, quão concentrada está a Pool, campeões novos para experimentar e o que melhorar. */
export function CoachScreen() {
  const lcu = useApp((s) => s.lcuStatus)
  const postList = useApp((s) => s.postList)
  const loadPostGames = useApp((s) => s.loadPostGames)
  const metaSample = useApp((s) => s.metaInfo?.isSample ?? false)
  const [state, setState] = useState<State>({ status: 'idle' })

  const analyze = useCallback(async (): Promise<void> => {
    setState({ status: 'loading' })
    try {
      const res = await window.api.analyzeCoach()
      setState(res.ok ? { status: 'ready', account: res.account, report: res.report } : { status: 'error', message: res.message })
    } catch {
      setState({ status: 'error', message: 'Não consegui ler a conta no cliente. Tente de novo.' })
    }
  }, [])

  useEffect(() => {
    void loadPostGames()
  }, [loadPostGames])
  useEffect(() => {
    if (lcu === 'connected') void analyze()
  }, [lcu, analyze])

  const progress = useMemo(() => summarizeProgress(postList), [postList])
  const growth: CoachTip[] = progress.observations.map((o) => ({ level: o.level, title: o.title, detail: o.detail }))

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1 [&>*]:shrink-0">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl font-semibold leading-none">Treino</h2>
          <p className="mt-1 text-sm text-mist">
            Lê as suas partidas recentes e a maestria (só leitura) para mostrar o seu jeito de jogar, avisar se a Pool está concentrada e sugerir campeões novos.
            {state.status === 'ready' && state.account ? ` Conta: ${state.account}.` : ''}
          </p>
        </div>
        <button type="button" className={btnGold} disabled={lcu !== 'connected' || state.status === 'loading'} onClick={() => void analyze()}>
          {state.status === 'loading' ? 'Analisando…' : 'Analisar de novo'}
        </button>
      </header>

      {lcu !== 'connected' && (
        <p role="status" className="rounded-xl border border-dashed border-line bg-panel/50 p-5 text-center text-mist">
          Abra o League of Legends e entre na sua conta: o Treino lê o histórico pelo cliente.
        </p>
      )}
      {state.status === 'error' && lcu === 'connected' && (
        <p role="alert" className="rounded-xl border border-enemy/40 bg-enemy/10 p-4 text-sm text-enemy">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && <Ready report={state.report} metaSample={metaSample} growth={growth} />}
      {state.status !== 'ready' && growth.length > 0 && (
        <Card title="O que melhorar (pelas suas partidas analisadas)">
          <ul className="flex flex-col gap-2">
            {growth.map((t) => (
              <Tip key={t.title} t={t} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function Ready({ report, metaSample, growth }: { report: CoachReport; metaSample: boolean; growth: CoachTip[] }) {
  const conc = CONCENTRATION[report.concentration]
  const tips = [...report.tips, ...growth]
  return (
    <>
      <Card title="Seu jeito de jogar" hint={report.gamesUsed > 0 ? `Baseado em ${report.gamesUsed} partidas recentes (normais e ranqueadas).` : undefined}>
        {report.gamesUsed === 0 ? (
          <p className="text-sm text-mist">Ainda não há partidas recentes para analisar. Jogue algumas e volte aqui.</p>
        ) : (
          <div className="grid grid-cols-2 gap-5 max-[1000px]:grid-cols-1">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-sm ${conc.cls}`}>{conc.label}</span>
                {report.level === 'new' && <span className="rounded-full border border-ally/40 bg-ally/10 px-3 py-1 text-sm text-ally">Começando ou voltando: sugestões mais fáceis</span>}
              </div>
              {report.style && (
                <div>
                  <p className="text-xs text-mist">Estilo</p>
                  <p className="text-sm text-snow">{report.style.label}</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {report.style.tags.map((t) => (
                      <li key={t.tag} className="rounded-md border border-line bg-raised px-2 py-0.5 text-xs text-mist">
                        {tagLabel(t.tag)} <span className="num text-snow">{pct(t.share)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {report.roles.length > 0 && (
                <div>
                  <p className="text-xs text-mist">Rotas mais jogadas</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {report.roles.slice(0, 3).map((r) => (
                      <li key={r.role} className="rounded-md border border-line bg-raised px-2 py-0.5 text-xs text-mist">
                        {ROLE_SHORT[r.role]} <span className="num text-snow">{pct(r.share)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs text-mist">Campeões mais jogados ({report.distinct} diferentes)</p>
              <ul className="flex flex-col gap-3">
                {report.top.map((l) => (
                  <ChampLine key={l.championId} id={l.championId} games={l.games} wins={l.wins} share={l.share} />
                ))}
              </ul>
            </div>
          </div>
        )}
      </Card>

      {tips.length > 0 && (
        <Card title="Dicas para você" hint="Cada dica diz o número que a gerou.">
          <ul className="flex flex-col gap-2">
            {tips.map((t) => (
              <Tip key={t.title} t={t} />
            ))}
          </ul>
        </Card>
      )}

      <Card title="Campeões para experimentar" hint="Parecidos com o seu estilo e fortes no meta. Adicione à Pool para o app passar a sugerir no draft.">
        {report.suggestions.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 max-[1100px]:grid-cols-1">
            {report.suggestions.map((s) => (
              <SuggestionCard key={`${s.championId}-${s.role}`} s={s} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-mist">
            {metaSample
              ? 'As sugestões precisam dos dados reais do meta (só há dados de amostra agora). Baixe os dados em Configurações > Dados.'
              : report.gamesUsed === 0
                ? 'As sugestões aparecem depois que houver partidas recentes para ler o seu estilo.'
                : 'Não encontrei campeões novos com amostra suficiente no meta para o seu estilo.'}
          </p>
        )}
      </Card>

      {report.mainRole && (
        <Card title={`Fundamentos de ${ROLE_LABEL[report.mainRole]}`} hint="Orientações gerais da rota que você mais joga, por momento da partida (não vêm dos dados de meta).">
          <Fundamentals role={report.mainRole} />
        </Card>
      )}
    </>
  )
}
