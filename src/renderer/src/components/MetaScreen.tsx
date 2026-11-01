import { useEffect, useMemo, useState } from 'react'
import { ROLES, type MetaChampionDetail, type MetaMatchupRow, type MetaTierRow, type SpellInfo, type Tier } from '../../../shared/dataTypes'
import type { Role } from '../../../shared/types'
import { useApp } from '../store/useApp'
import { normalize, pct, ROLE_LABEL, signed, splashUrl } from '../lib/format'
import { input } from '../lib/ui'
import { ChampionIcon, useChampionName } from './Icons'
import { BuildOptionsView } from './BuildOptionsView'

const TIER_STYLE: Record<Tier, string> = {
  S: 'bg-gold/20 text-gold border-gold/50',
  A: 'bg-ally/15 text-ally border-ally/40',
  B: 'bg-raised text-snow border-line',
  C: 'bg-raised text-mist border-line',
  D: 'bg-enemy/10 text-enemy border-enemy/40'
}

function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`grid h-6 w-6 place-items-center rounded-md border font-display text-sm font-bold ${TIER_STYLE[tier]}`}>{tier}</span>
}

function Row({ row, selected, onSelect }: { row: MetaTierRow; selected: boolean; onSelect: () => void }) {
  const name = useChampionName(row.championId)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`grid w-full grid-cols-[28px_minmax(0,1fr)_64px_64px_56px] items-center gap-3 rounded-xl border px-2.5 py-1.5 text-left transition-colors hover:bg-raised ${
          selected ? 'border-gold/60 bg-raised' : 'border-line/70 bg-panel/60'
        }`}
      >
        <TierBadge tier={row.tier} />
        <span className="flex min-w-0 items-center gap-2.5">
          <ChampionIcon id={row.championId} size={34} />
          <span className="truncate font-display text-lg font-semibold">{name}</span>
          {row.hasBuild && <span className="rounded-full bg-ally/10 px-1.5 text-[10px] text-ally">build</span>}
        </span>
        <span className="num text-right text-base" title={row.lowSample ? 'Poucos jogos: o número ainda oscila' : undefined}>
          {pct(row.winrate)}
          {row.lowSample && <span className="text-gold">*</span>}
        </span>
        <span className="num text-right text-sm text-mist">{pct(row.presence)}</span>
        <span className="num text-right text-sm text-dim">{row.games.toLocaleString('pt-BR')}</span>
      </button>
    </li>
  )
}

function MatchupList({ title, rows, tone }: { title: string; rows: MetaMatchupRow[]; tone: 'good' | 'bad' }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs text-mist">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-dim">Sem confrontos suficientes.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <MatchupItem key={r.championId} row={r} tone={tone} />
          ))}
        </ul>
      )}
    </div>
  )
}

function MatchupItem({ row, tone }: { row: MetaMatchupRow; tone: 'good' | 'bad' }) {
  const name = useChampionName(row.championId)
  return (
    <li className="flex items-center gap-2 text-sm" title={`${row.games} partidas${row.anyLane ? ' (contra ele em qualquer rota)' : ''}`}>
      <ChampionIcon id={row.championId} size={26} />
      <span className="min-w-0 flex-1 truncate">
        {name}
        {row.anyLane && <span className="ml-1 text-[10px] text-dim">(qualquer rota)</span>}
      </span>
      <span className={`num ${tone === 'good' ? 'text-ally' : 'text-enemy'}`}>{pct(row.winrate)}</span>
    </li>
  )
}

function AllyItem({ id, delta }: { id: number; delta: number }) {
  const name = useChampionName(id)
  return (
    <li className="flex items-center gap-2 text-sm">
      <ChampionIcon id={id} size={26} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="num text-ally">{signed(delta)}</span>
    </li>
  )
}

function Detail({ championId, role }: { championId: number; role: Role }) {
  const champ = useApp((s) => s.champById.get(championId))
  const name = useChampionName(championId)
  const [detail, setDetail] = useState<MetaChampionDetail | null | undefined>(undefined)
  const [spells, setSpells] = useState<SpellInfo[]>([])

  useEffect(() => {
    let off = false
    setDetail(undefined)
    void window.api.getMetaDetail({ championId, role }).then((d) => !off && setDetail(d))
    return () => {
      off = true
    }
  }, [championId, role])

  const key = champ?.key
  useEffect(() => {
    let off = false
    setSpells([])
    if (key) void window.api.getSpells(key).then((s) => !off && setSpells(s)).catch(() => undefined)
    return () => {
      off = true
    }
  }, [key])

  const build = detail?.build ?? null
  return (
    <section aria-label={`Detalhes de ${name}`} className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel/70 shadow-card">
      <header className="relative flex shrink-0 items-center gap-3 overflow-hidden border-b border-line px-4 py-3">
        {champ && <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-cover bg-top opacity-25" style={{ backgroundImage: `url("${splashUrl(champ.key)}")` }} />}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-panel via-panel/80 to-transparent" />
        <ChampionIcon id={championId} size={52} className="relative" />
        <div className="relative min-w-0 flex-1">
          <h2 className="truncate font-display text-3xl font-semibold leading-none">{name}</h2>
          <p className="mt-1 text-xs text-mist">{ROLE_LABEL[role]}</p>
        </div>
        {detail && (
          <div className="relative flex items-center gap-4 text-right">
            <TierBadge tier={detail.tier} />
            <div>
              <div className="num text-2xl leading-none">{pct(detail.winrate)}</div>
              <div className="text-[11px] text-mist">{detail.games.toLocaleString('pt-BR')} partidas</div>
            </div>
          </div>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {detail === undefined && <p className="text-mist">Carregando…</p>}
        {detail === null && <p className="text-mist">Sem dados deste campeão nesta rota.</p>}
        {detail && (
          <>
            <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
              <MatchupList title="Vai melhor contra" rows={detail.best} tone="good" />
              <MatchupList title="Sofre contra" rows={detail.worst} tone="bad" />
              <div>
                <h4 className="mb-1.5 text-xs text-mist">Rende mais com</h4>
                {detail.allies.length === 0 ? (
                  <p className="text-xs text-dim">Sem dados de sinergia.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {detail.allies.map((a) => (
                      <AllyItem key={a.championId} id={a.championId} delta={a.delta} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {!build && <p className="text-mist">Ainda não há build de {name} em {ROLE_LABEL[role]} nos dados: foram poucas partidas com timeline ({detail.games} partidas no total). Uma coleta maior preenche isso.</p>}
            {build && <BuildOptionsView build={build} spells={spells} />}
          </>
        )}
      </div>
    </section>
  )
}

type SortKey = 'tier' | 'winrate' | 'presence' | 'games'
const TIER_ORDER: Tier[] = ['S', 'A', 'B', 'C', 'D']
const TIERS: Tier[] = ['S', 'A', 'B', 'C', 'D']

function sortRows(rows: MetaTierRow[], key: SortKey, dir: 'desc' | 'asc'): MetaTierRow[] {
  const sign = dir === 'desc' ? 1 : -1
  const value = (r: MetaTierRow): number =>
    key === 'tier' ? -TIER_ORDER.indexOf(r.tier) * 1000 + r.score : key === 'winrate' ? r.winrate : key === 'presence' ? r.presence : r.games
  return [...rows].sort((a, b) => sign * (value(b) - value(a)) || b.games - a.games || a.championId - b.championId)
}

function HeaderCell({ label, sortKey, current, dir, onSort, className = '' }: { label: string; sortKey: SortKey; current: SortKey; dir: 'desc' | 'asc'; onSort: (k: SortKey) => void; className?: string }) {
  const active = current === sortKey
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Ordenar por ${label}`}
      aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}
      className={`flex items-center gap-0.5 rounded px-1 text-[11px] hover:text-snow ${active ? 'text-gold' : 'text-dim'} ${className}`}
    >
      {label}
      <span aria-hidden="true">{active ? (dir === 'desc' ? '▾' : '▴') : ''}</span>
    </button>
  )
}

export function MetaScreen() {
  const metaInfo = useApp((s) => s.metaInfo)
  const champById = useApp((s) => s.champById)
  const [role, setRole] = useState<Role>('MIDDLE')
  const [rows, setRows] = useState<MetaTierRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'desc' | 'asc' }>({ key: 'tier', dir: 'desc' })
  const [tiers, setTiers] = useState<Tier[]>([])
  const [reliableOnly, setReliableOnly] = useState(false)

  useEffect(() => {
    let off = false
    setRows(null)
    void window.api.getMetaTiers(role).then((r) => {
      if (off) return
      setRows(r)
      setSelected((cur) => (cur !== null && r.some((x) => x.championId === cur) ? cur : (sortRows(r, 'tier', 'desc')[0]?.championId ?? null)))
    })
    return () => {
      off = true
    }
  }, [role, metaInfo])

  const shown = useMemo(() => {
    const q = normalize(query)
    const filtered = (rows ?? []).filter(
      (r) =>
        (!q || normalize(champById.get(r.championId)?.name ?? '').includes(q)) &&
        (tiers.length === 0 || tiers.includes(r.tier)) &&
        (!reliableOnly || !r.lowSample)
    )
    return sortRows(filtered, sort.key, sort.dir)
  }, [rows, query, champById, tiers, reliableOnly, sort])

  const onSort = (key: SortKey): void => setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  const toggleTier = (t: Tier): void => setTiers((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
  const filtersOn = tiers.length > 0 || reliableOnly || query !== ''

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line/70 bg-panel/70 p-1" role="tablist" aria-label="Rota do ranking">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={role === r}
              onClick={() => setRole(r)}
              className={`rounded-lg px-3 py-1 font-display text-base font-semibold ${role === r ? 'bg-raised text-gold' : 'text-mist hover:text-snow'}`}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <label htmlFor="meta-search" className="sr-only">
          Buscar campeão no ranking
        </label>
        <input id="meta-search" className={`${input} w-48 max-w-full`} placeholder="Buscar campeão" value={query} onChange={(e) => setQuery(e.target.value)} />
        {metaInfo && (
          <p className="ml-auto text-xs text-mist">
            {metaInfo.isSample ? 'Dados de amostra' : `Patch ${metaInfo.patch}`} · {metaInfo.champions} campeões
            {metaInfo.regions?.length ? ` · ${metaInfo.regions.join(', ')}` : ''}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Filtros do ranking">
        <div className="flex items-center gap-1.5" role="group" aria-label="Filtrar por tier">
          <span className="text-xs text-mist">Tier</span>
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tiers.includes(t)}
              onClick={() => toggleTier(t)}
              className={`grid h-6 w-6 place-items-center rounded-md border font-display text-sm font-bold ${tiers.includes(t) ? TIER_STYLE[t] : 'border-line text-dim hover:text-snow'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-mist">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={reliableOnly} onChange={(e) => setReliableOnly(e.target.checked)} />
          Só com amostra confiável
        </label>
        {filtersOn && (
          <button
            type="button"
            className="text-xs text-mist underline hover:text-snow"
            onClick={() => {
              setTiers([])
              setReliableOnly(false)
              setQuery('')
            }}
          >
            Limpar filtros
          </button>
        )}
        <span className="ml-auto text-xs text-dim">{rows ? `${shown.length} de ${rows.length}` : ''}</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] gap-4 max-[1000px]:grid-cols-1 max-[1000px]:grid-rows-[minmax(180px,40%)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col">
          <div className="grid grid-cols-[28px_minmax(0,1fr)_64px_64px_56px] gap-x-3 px-2.5 pb-1">
            <HeaderCell label="Tier" sortKey="tier" current={sort.key} dir={sort.dir} onSort={onSort} className="-ml-1" />
            <span className="text-[11px] text-dim">Campeão</span>
            <HeaderCell label="Vitórias" sortKey="winrate" current={sort.key} dir={sort.dir} onSort={onSort} className="justify-end" />
            <HeaderCell label="Presença" sortKey="presence" current={sort.key} dir={sort.dir} onSort={onSort} className="justify-end" />
            <HeaderCell label="Jogos" sortKey="games" current={sort.key} dir={sort.dir} onSort={onSort} className="justify-end" />
          </div>
          {rows === null ? (
            <p className="text-mist">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line p-4 text-mist">Os dados de meta não têm campeões para esta rota.</p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1" aria-label={`Ranking de ${ROLE_LABEL[role]}`}>
              {shown.map((r) => (
                <Row key={r.championId} row={r} selected={selected === r.championId} onSelect={() => setSelected(r.championId)} />
              ))}
              {shown.length === 0 && <li className="p-3 text-sm text-mist">Nenhum campeão com esses filtros.</li>}
            </ul>
          )}
        </div>
        {selected !== null ? <Detail championId={selected} role={role} /> : <div className="rounded-2xl border border-dashed border-line" />}
      </div>
    </div>
  )
}
