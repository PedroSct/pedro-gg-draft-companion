import { useEffect, useMemo, useState } from 'react'
import type { GroupAnalysis, GroupPair, GroupSlotSuggestion } from '../../../shared/dataTypes'
import type { DraftPlayer, Role } from '../../../shared/types'
import { useApp } from '../store/useApp'
import { pct, ROLE_SHORT, signed } from '../lib/format'
import { ChampionIcon, useChampionName } from './Icons'
import { TierBadge } from './TierBadge'

const MODE_NAME: Record<number, string> = { 2: 'Duo', 3: 'Trio', 4: 'Squad', 5: 'Time fechado' }
const VERDICT: Record<NonNullable<GroupAnalysis['label']>, { text: string; cls: string }> = {
  forte: { text: 'Combinação forte', cls: 'border-good/50 text-good' },
  boa: { text: 'Boa combinação', cls: 'border-good/50 text-good' },
  neutra: { text: 'Combinação neutra', cls: 'border-line text-mist' },
  fraca: { text: 'Combinação fraca', cls: 'border-enemy/50 text-enemy' }
}

function Chip({ player, role, pressed, locked, onToggle }: { player: DraftPlayer; role: Role | null; pressed: boolean; locked: boolean; onToggle: () => void }) {
  const name = useChampionName(player.championId)
  const label = locked ? 'Você' : role ? ROLE_SHORT[role] : 'Aliado'
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={locked}
      onClick={onToggle}
      title={locked ? 'Você sempre faz parte do grupo' : `${pressed ? 'Tirar do' : 'Colocar no'} grupo${name ? ` (${name})` : ''}`}
      className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm ${pressed ? 'border-gold/60 bg-raised text-snow' : 'border-line text-mist hover:text-snow'} ${locked ? 'cursor-default' : ''}`}
    >
      {player.championId > 0 ? (
        <ChampionIcon id={player.championId} size={24} className="rounded-full" />
      ) : (
        <span className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-line text-xs text-dim" aria-hidden="true">
          ?
        </span>
      )}
      {label}
    </button>
  )
}

function PairRow({ pair }: { pair: GroupPair }) {
  const nameA = useChampionName(pair.aId)
  const nameB = useChampionName(pair.bId)
  const r = pair.row
  return (
    <li
      aria-label={`${nameA} com ${nameB}`}
      className="grid grid-cols-[28px_minmax(0,1fr)_64px_68px_52px] items-center gap-3 border-b border-line py-2 text-sm"
      title={r ? `${r.games.toLocaleString('pt-BR')} partidas juntos${r.rare ? ' (amostra pequena)' : ''}` : 'Poucas partidas dos dois juntos nos dados'}
    >
      {r ? <TierBadge tier={r.tier} /> : <span className="grid h-6 w-6 place-items-center rounded-md border border-line text-dim">–</span>}
      <span className="flex min-w-0 items-center gap-2">
        <ChampionIcon id={pair.aId} size={28} />
        <ChampionIcon id={pair.bId} size={28} />
        <span className="min-w-0 truncate">
          <span className="font-medium">{nameA}</span> <span className="text-dim">{ROLE_SHORT[pair.aRole]}</span> + <span className="font-medium">{nameB}</span>{' '}
          <span className="text-dim">{ROLE_SHORT[pair.bRole]}</span>
          {pair.tentative && <span className="ml-1.5 rounded-full border border-line px-1.5 text-[10px] text-dim">marcado</span>}
        </span>
      </span>
      {r ? (
        <>
          <span className="num text-right">
            {pct(r.winrate)}
            {r.rare && <span className="text-gold">*</span>}
          </span>
          <span className={`num text-right ${r.synergy >= 0.5 ? 'text-good' : r.synergy <= -0.5 ? 'text-enemy' : 'text-mist'}`}>{signed(r.synergy)} pp</span>
          <span className="num text-right text-dim">{r.games.toLocaleString('pt-BR')}</span>
        </>
      ) : (
        <span className="col-span-3 text-right text-xs text-dim">sem dados</span>
      )}
    </li>
  )
}

function Candidate({ pick, rank }: { pick: GroupSlotSuggestion['picks'][number]; rank: number }) {
  const name = useChampionName(pick.championId)
  return (
    <li className="flex items-center gap-3 border-b border-line py-2 text-sm" aria-label={`Sugestão ${rank}: ${name}`}>
      <span className="num w-4 text-center text-dim">{rank}</span>
      <ChampionIcon id={pick.championId} size={32} />
      <span className="w-28 shrink-0 truncate font-medium">{name}</span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-0.5 text-xs text-mist">
        {pick.with.map((w) => (
          <WithItem key={w.championId} id={w.championId} winrate={w.winrate} games={w.games} />
        ))}
        {pick.covered < pick.total && <span className="text-dim">sem dado com {pick.total - pick.covered}</span>}
      </span>
      <span className={`num text-right ${pick.score >= 0.5 ? 'text-good' : pick.score <= -0.5 ? 'text-enemy' : 'text-mist'}`} title="Nota média dos combos com o grupo (pontos acima de 50%)">
        {signed(pick.score)}
      </span>
    </li>
  )
}

function WithItem({ id, winrate, games }: { id: number; winrate: number; games: number }) {
  const name = useChampionName(id)
  return (
    <span title={`${games.toLocaleString('pt-BR')} partidas juntos`}>
      com {name} <span className="num text-snow">{pct(winrate)}</span>
    </span>
  )
}

function SlotSuggestions({ slot }: { slot: GroupSlotSuggestion }) {
  return (
    <div>
      <h4 className="mb-1 border-b border-line pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-dim">Quem encaixa no {ROLE_SHORT[slot.role]}</h4>
      {slot.picks.length === 0 ? (
        <p className="pt-2 text-xs text-dim">Sem dados suficientes de combos para esta vaga.</p>
      ) : (
        <ol className="flex flex-col" aria-label={`Sugestões para ${ROLE_SHORT[slot.role]}`}>
          {slot.picks.map((p, i) => (
            <Candidate key={p.championId} pick={p} rank={i + 1} />
          ))}
        </ol>
      )}
    </div>
  )
}

/** Papel de cada aliado no draft: o da fila, o escolhido à mão ou o do seu campeão. */
function useRoles(): (p: DraftPlayer) => Role | null {
  const draft = useApp((s) => s.draft)
  const friendRoles = useApp((s) => s.friendRoles)
  const roleOverride = useApp((s) => s.roleOverride)
  const recRole = useApp((s) => s.recommendation?.role ?? null)
  const lastRole = useApp((s) => s.lastPick?.role ?? null)
  return (p) => p.role ?? (p.cellId === draft?.localPlayerCellId ? (draft.localRole ?? roleOverride ?? recRole ?? lastRole) : (friendRoles[p.cellId] ?? null))
}

/** Modo Grupo: duo, trio, squad ou time fechado. Marque quem joga com você e veja todas as relações e quem encaixa nas vagas abertas. */
export function GroupPanel() {
  const draft = useApp((s) => s.draft)
  const groupCells = useApp((s) => s.groupCells)
  const toggle = useApp((s) => s.toggleGroupCell)
  const setGroup = useApp((s) => s.setGroupCells)
  const roleOf = useRoles()
  const [analysis, setAnalysis] = useState<GroupAnalysis | null>(null)

  const allies = draft?.allies ?? []
  const localCell = draft?.localPlayerCellId ?? -1
  const inGroup = useMemo(() => new Set([localCell, ...groupCells]), [localCell, groupCells])
  const others = allies.filter((a) => a.cellId !== localCell)
  const me = allies.find((a) => a.cellId === localCell)

  const members = allies
    .filter((a) => inGroup.has(a.cellId))
    .flatMap((a) => {
      const role = roleOf(a)
      return role ? [{ cellId: a.cellId, role, championId: a.championId, tentative: a.championId > 0 && a.status !== 'locked' }] : []
    })
  const withoutRole = allies.filter((a) => inGroup.has(a.cellId) && !roleOf(a)).length
  const unavailable = draft
    ? [...draft.allies, ...draft.enemies]
        .map((p) => p.championId)
        .concat(draft.bans.allies, draft.bans.enemies)
        .filter((id) => id > 0)
    : []
  const key = JSON.stringify([members, unavailable])
  const active = groupCells.length > 0

  useEffect(() => {
    if (!active) {
      setAnalysis(null)
      return
    }
    let off = false
    void window.api.analyzeGroup({ members, unavailable }).then((a) => !off && setAnalysis(a))
    return () => {
      off = true
    }
    // key resume members e unavailable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active])

  if (!draft || !me) return null
  const size = inGroup.size
  const mode = MODE_NAME[size] ?? null
  const verdict = analysis?.label ? VERDICT[analysis.label] : null
  const nameOf = (id: number): string => useApp.getState().champById.get(id)?.name ?? `Campeão ${id}`

  return (
    <section aria-label="Modo Grupo" className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-[15px] font-semibold">Grupo</h3>
        {mode && <span className="rounded-full border border-gold/50 px-2 py-0.5 text-xs text-gold">{mode}</span>}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quem joga com você">
          <Chip player={me} role={roleOf(me)} pressed locked onToggle={() => undefined} />
          {others.map((p) => (
            <Chip key={p.cellId} player={p} role={roleOf(p)} pressed={groupCells.includes(p.cellId)} locked={false} onToggle={() => toggle(p.cellId)} />
          ))}
        </div>
        <span className="ml-auto flex items-center gap-3 text-xs">
          <button type="button" className="text-mist underline hover:text-snow" onClick={() => setGroup(others.map((p) => p.cellId))}>
            Time fechado
          </button>
          {active && (
            <button type="button" className="text-mist underline hover:text-snow" onClick={() => setGroup([])}>
              Jogar solo
            </button>
          )}
        </span>
      </div>

      {!active ? (
        <p className="mt-2 text-xs text-dim">Joga com amigos? Marque quem é do seu grupo (duo, trio, squad ou time fechado) para ver todas as relações e combos.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-5">
          {withoutRole > 0 && <p className="text-xs text-gold">Defina a rota de {withoutRole === 1 ? 'um membro' : `${withoutRole} membros`} do grupo (na lista de aliados) para entrar na análise.</p>}
          {analysis === null ? (
            <p className="text-sm text-mist">Analisando…</p>
          ) : analysis.pairs.length === 0 && analysis.suggestions.length === 0 ? (
            <p className="text-sm text-mist">Ainda não há campeões suficientes escolhidos (ou os dados de meta são de amostra) para mostrar combos.</p>
          ) : (
            <>
              {verdict && analysis.score !== null && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${verdict.cls}`}>{verdict.text}</span>
                  <span className="num text-mist" title="Média da nota dos combos do grupo, em pontos acima de 50%">
                    {signed(analysis.score)}
                  </span>
                  {analysis.best && (
                    <span className="text-mist">
                      Melhor:{' '}
                      <span className="text-snow">
                        {nameOf(analysis.best.aId)} + {nameOf(analysis.best.bId)}
                      </span>
                    </span>
                  )}
                  {analysis.weakest && (
                    <span className="text-mist">
                      Ponto fraco:{' '}
                      <span className="text-enemy">
                        {nameOf(analysis.weakest.aId)} + {nameOf(analysis.weakest.bId)}
                      </span>
                    </span>
                  )}
                </div>
              )}
              {analysis.pairs.length > 0 && (
                <div>
                  <h4 className="mb-1 grid grid-cols-[28px_minmax(0,1fr)_64px_68px_52px] gap-x-3 border-b border-line pb-2 text-[11px] font-normal uppercase tracking-[0.08em] text-dim">
                    <span className="col-span-2 font-semibold">Relações do grupo</span>
                    <span className="text-right normal-case tracking-normal">Vitórias</span>
                    <span className="text-right normal-case tracking-normal">Sinergia</span>
                    <span className="text-right normal-case tracking-normal">Jogos</span>
                  </h4>
                  <ul aria-label="Relações do grupo">
                    {analysis.pairs.map((p) => (
                      <PairRow key={`${p.aCell}-${p.bCell}`} pair={p} />
                    ))}
                  </ul>
                </div>
              )}
              {analysis.suggestions.map((s) => (
                <SlotSuggestions key={s.cellId} slot={s} />
              ))}
            </>
          )}
        </div>
      )}
    </section>
  )
}
