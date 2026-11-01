import { useEffect, useState } from 'react'
import type { Role } from '../../../shared/types'
import type { LoadoutParts, PartResult } from '../../../shared/loadout'
import type { BuildSituation, ChampionBuild, SkillKey, SpellInfo } from '../../../shared/dataTypes'
import { useApp } from '../store/useApp'
import { useFocus } from '../lib/useFocus'
import { ROLE_LABEL, ROLE_SHORT, splashUrl } from '../lib/format'
import { btnGold } from '../lib/ui'
import { ROLES } from '../../../shared/dataTypes'
import { ChampionIcon, ItemIcon, SafeImg, useChampionName } from './Icons'
import { RunesView, SpellsView } from './LoadoutView'

const SKILLS: SkillKey[] = ['Q', 'W', 'E', 'R']

function SpellIcon({ spell, slot }: { spell: SpellInfo | undefined; slot: SkillKey }) {
  const letter = (
    <div className="chamfer-sm num grid h-10 w-10 shrink-0 place-items-center bg-raised text-lg text-mist" aria-hidden="true">
      {slot}
    </div>
  )
  if (!spell) return letter
  return (
    <div className="relative shrink-0" title={`${slot}: ${spell.name}`}>
      <SafeImg
        src={spell.iconUrl}
        alt={spell.name}
        className="chamfer-sm h-10 w-10 bg-raised object-cover"
        fallback={letter}
      />
      <span className="num absolute -bottom-1 -right-1 bg-night px-1 text-xs leading-4 text-gold">{slot}</span>
    </div>
  )
}

export function SkillOrder({ build, spells }: { build: ChampionBuild; spells: SpellInfo[] }) {
  const { priority, levels } = build.skillOrder
  const bySlot = (k: SkillKey): SpellInfo | undefined => spells.find((s) => s.slot === k)

  return (
    <div>
      <h3 className="mb-2 text-sm text-mist">Ordem das habilidades</h3>
      <div className="flex items-center gap-2" role="img" aria-label={priority.join(' > ')}>
        {priority.map((k, i) => (
          <div key={k} className="flex items-center gap-2" aria-hidden="true">
            {i > 0 && <span className="text-dim">&gt;</span>}
            <SpellIcon spell={bySlot(k)} slot={k} />
          </div>
        ))}
      </div>

      {levels && levels.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-center" aria-label="Habilidade a evoluir em cada nível">
            <thead>
              <tr>
                <th className="w-5" />
                {levels.map((_, i) => (
                  <th key={i} scope="col" className="num h-4 w-[18px] text-[11px] font-normal text-dim">
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SKILLS.map((k) => (
                <tr key={k}>
                  <th scope="row" className="num pr-1 text-left text-sm font-semibold text-mist">
                    {k}
                  </th>
                  {levels.map((l, i) => (
                    <td
                      key={i}
                      className={`num h-[18px] w-[18px] text-[11px] ${
                        l === k ? (k === 'R' ? 'bg-gold text-night' : 'bg-ally/80 text-night') : 'bg-raised/60'
                      }`}
                    >
                      {l === k ? i + 1 : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function ItemRow({ title, ids, chain = false }: { title: string; ids: number[]; chain?: boolean }) {
  if (!ids.length) return null
  return (
    <div>
      <h4 className="mb-1.5 text-xs text-mist">{title}</h4>
      <div className="flex flex-wrap items-center gap-1.5">
        {ids.map((id, i) => (
          <div key={`${id}-${i}`} className="flex items-center gap-1.5">
            {chain && i > 0 && <span className="text-dim" aria-hidden="true">›</span>}
            <ItemIcon id={id} size={42} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function SituationalItem({ id, when }: { id: number; when: string }) {
  const name = useApp((s) => s.catalog?.items[String(id)]?.name ?? `Item ${id}`)
  return (
    <li className="flex items-center gap-3">
      <ItemIcon id={id} size={34} />
      <span className="min-w-0 text-sm">
        <span className="block truncate">{name}</span>
        <span className="block truncate text-xs text-mist">{when}</span>
      </span>
    </li>
  )
}

const SPELL_NAME: Record<number, string> = {
  1: 'Limpar',
  3: 'Exaustão',
  4: 'Flash',
  6: 'Fantasma',
  7: 'Curar',
  11: 'Golpear',
  12: 'Teleporte',
  13: 'Clareza',
  14: 'Ignição',
  21: 'Barreira',
  32: 'Marca'
}

const PART_LABEL: Record<keyof LoadoutParts, string> = { runes: 'Runas', spells: 'Feitiços', items: 'Itens' }

/** "Importar para o cliente": só por clique, só desta partida, e só o que a pessoa marcar. */
function ImportPanel({ championId, role, build, forLocal }: { championId: number; role: Role; build: ChampionBuild; forLocal: boolean }) {
  const lcuStatus = useApp((s) => s.lcuStatus)
  const inDraft = useApp((s) => s.draft !== null)
  const name = useChampionName(championId)
  const available: Record<keyof LoadoutParts, boolean> = {
    runes: !!build.runes,
    spells: !!build.spells,
    items: build.items.core.length + build.items.starting.length + build.items.boots.length > 0
  }
  const [picked, setPicked] = useState<LoadoutParts>({ runes: true, spells: true, items: true })
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Partial<Record<keyof LoadoutParts, PartResult>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setResults(null)
    setError(null)
  }, [championId, role])

  const parts = (Object.keys(PART_LABEL) as (keyof LoadoutParts)[]).filter((k) => available[k])
  const chosen = parts.filter((k) => picked[k])
  const blocked = !forLocal
    ? 'Importar vale só para o seu próprio campeão: cada pessoa importa no cliente dela.'
    : lcuStatus !== 'connected'
      ? 'Abra o cliente do LoL para importar.'
      : parts.length === 0
        ? 'Os dados de meta não têm runas, feitiços nem itens para este campeão. Atualize os dados em Configurações.'
        : null

  async function run(): Promise<void> {
    setBusy(true)
    setResults(null)
    setError(null)
    try {
      const res = await window.api.applyLoadout({
        championId,
        role,
        parts: { runes: picked.runes && available.runes, spells: picked.spells && available.spells, items: picked.items && available.items }
      })
      if (res.ok) setResults(res.parts)
      else setError(res.message)
    } catch {
      setError('Não consegui importar. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  const detail: Record<keyof LoadoutParts, string> = {
    runes: build.runes ? 'Cria ou atualiza a página “Pedro.gg” e a deixa ativa' : 'sem dados',
    spells: build.spells ? `${build.spells.map((id) => SPELL_NAME[id] ?? `#${id}`).join(' + ')}${inDraft ? '' : ' (só durante a seleção)'}` : 'sem dados',
    items: 'Salva o conjunto “Pedro.gg” (aparece na loja)'
  }

  return (
    <section aria-label="Importar para o cliente" className="rounded-2xl border border-gold/25 bg-gold/5 p-4">
      <h3 className="font-display text-lg font-semibold text-gold">Importar para o cliente</h3>
      <p className="mt-0.5 text-xs text-mist">Só acontece quando você clicar, e só para esta partida: {name}, {ROLE_LABEL[role]}. Nada é alterado sem o seu pedido.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {(Object.keys(PART_LABEL) as (keyof LoadoutParts)[]).map((k) => (
          <li key={k}>
            <label className={`flex items-start gap-2.5 text-sm ${available[k] ? '' : 'opacity-50'}`}>
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]"
                disabled={!available[k] || !!blocked}
                checked={available[k] && picked[k]}
                onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.checked }))}
              />
              <span>
                <span className="font-medium">{PART_LABEL[k]}</span>
                <span className="block text-xs text-mist">{detail[k]}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={btnGold} disabled={!!blocked || busy || chosen.length === 0} onClick={() => void run()}>
          {busy ? 'Importando…' : 'Importar para o cliente'}
        </button>
        {blocked && <span className="text-xs text-mist">{blocked}</span>}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-enemy">
          {error}
        </p>
      )}
      {results && (
        <ul className="mt-2 flex flex-col gap-1" role="status">
          {(Object.keys(results) as (keyof LoadoutParts)[]).map((k) => (
            <li key={k} className={`text-sm ${results[k]?.ok ? 'text-ally' : 'text-enemy'}`}>
              {PART_LABEL[k]}: {results[k]?.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type Status = 'loading' | 'ready' | 'error'

const FOCUS_TEXT: Record<NonNullable<BuildSituation['focus']>, string> = {
  armor: 'O time inimigo causa quase só dano físico: priorize armadura.',
  'magic-resist': 'O time inimigo causa quase só dano mágico: priorize resistência mágica.',
  penetration: 'O time inimigo tem vários tanques: priorize penetração.'
}
const REASON_TEXT = { armor: 'armadura', 'magic-resist': 'resistência mágica', penetration: 'penetração' } as const

/** "Para esta partida": o que muda na build por causa do time inimigo (só aparece com inimigos conhecidos). */
function SituationCard({ situation, build }: { situation: BuildSituation; build: ChampionBuild }) {
  const dmg = situation.enemyDamage
  if (!dmg || situation.enemiesKnown === 0) return null
  const ad = Math.round(dmg.physical * 100)
  const ap = 100 - ad
  const variant = situation.variantIndex !== null ? build.variants?.[situation.variantIndex] : undefined
  return (
    <section aria-label="Para esta partida" className="rounded-xl border border-ally/25 bg-ally/5 p-3">
      <h3 className="font-display text-base font-semibold text-ally">Para esta partida</h3>
      <div className="mt-2" role="img" aria-label={`Dano inimigo: ${ad}% físico, ${ap}% mágico`}>
        <div className="flex h-2 overflow-hidden rounded-full bg-raised">
          <span className="bg-gold" style={{ width: `${ad}%` }} />
          <span className="bg-ally" style={{ width: `${ap}%` }} />
        </div>
        <p className="mt-1 flex justify-between text-xs text-mist">
          <span>{ad}% físico</span>
          <span>{ap}% mágico</span>
        </p>
      </div>
      <p className="mt-2 text-sm">
        {situation.focus ? FOCUS_TEXT[situation.focus] : 'Dano inimigo equilibrado: siga a build padrão.'}
        {situation.enemiesKnown < 5 && <span className="text-mist"> ({situation.enemiesKnown} de 5 inimigos conhecidos)</span>}
      </p>
      {situation.picks.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {situation.picks.map((p) => (
            <SituationalItem key={p.itemId} id={p.itemId} when={`Boa aqui: ${REASON_TEXT[p.reason]}`} />
          ))}
        </ul>
      )}
      {situation.focus && situation.picks.length === 0 && (
        <p className="mt-1 text-xs text-mist">Os dados deste campeão não trazem um item de {REASON_TEXT[situation.focus]} entre os mais comprados.</p>
      )}
      {variant && (
        <div className="mt-2">
          <ItemRow title="Construção que encaixa melhor nesta partida" ids={variant.core} chain />
        </div>
      )}
    </section>
  )
}

function VariantsView({ build, highlight }: { build: ChampionBuild; highlight: number | null }) {
  const variants = build.variants
  if (!variants || variants.length < 2) return null
  return (
    <div>
      <h4 className="mb-1.5 text-xs text-mist">Outras construções frequentes nas vitórias</h4>
      <ul className="flex flex-col gap-2">
        {variants.map((v, i) => (
          <li key={v.core.join('-')} className="flex flex-wrap items-center gap-2">
            <span className="num w-10 text-sm text-mist">{Math.round(v.share * 100)}%</span>
            <div className="flex items-center gap-1">
              {v.core.map((id, k) => (
                <div key={`${id}-${k}`} className="flex items-center gap-1">
                  {k > 0 && <span className="text-dim" aria-hidden="true">›</span>}
                  <ItemIcon id={id} size={32} />
                </div>
              ))}
            </div>
            {i === highlight && <span className="rounded-full bg-ally/15 px-2 py-0.5 text-xs text-ally">encaixa melhor agora</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function BuildPanel() {
  const focus = useFocus()
  const champ = useApp((s) => (focus ? s.champById.get(focus.championId) : undefined))
  const name = useChampionName(focus?.championId ?? 0)
  const setRoleOverride = useApp((s) => s.setRoleOverride)
  const [data, setData] = useState<{ build: ChampionBuild | null; spells: SpellInfo[] }>({ build: null, spells: [] })
  const [status, setStatus] = useState<Status>('loading')
  const [situation, setSituation] = useState<BuildSituation | null>(null)
  // Muda quando um inimigo é escolhido, trocado ou travado: refaz os ajustes da build.
  const enemySignature = useApp((s) => (s.draft ? s.draft.enemies.map((e) => `${e.championId}${e.status}`).join(',') : ''))

  const championId = focus?.championId
  const role = focus?.role
  const key = champ?.key

  useEffect(() => {
    if (championId === undefined) return
    let cancelled = false
    setStatus('loading')
    Promise.all([
      role ? window.api.getBuild({ championId, role }) : Promise.resolve(null),
      key ? window.api.getSpells(key).catch(() => [] as SpellInfo[]) : Promise.resolve([] as SpellInfo[])
    ])
      .then(([build, spells]) => {
        if (cancelled) return
        setData({ build, spells })
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [championId, role, key])

  useEffect(() => {
    if (championId === undefined || !role) {
      setSituation(null)
      return
    }
    let cancelled = false
    window.api
      .getBuildSituation({ championId, role })
      .then((s) => !cancelled && setSituation(s))
      .catch(() => !cancelled && setSituation(null))
    return () => {
      cancelled = true
    }
  }, [championId, role, enemySignature])

  if (!focus) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-panel/50 p-5 text-center text-mist">
        A build aparece aqui quando você passar o mouse em um campeão ou travar o pick.
      </div>
    )
  }

  const { build } = data
  const origin =
    focus.source === 'local' ? 'Seu campeão' : focus.source === 'preview' ? 'Opção selecionada' : 'Melhor pick da Pool'

  return (
    <section aria-label="Build" className="overflow-hidden rounded-2xl border border-line bg-panel/70 shadow-card">
      <header className="relative flex items-center gap-3 overflow-hidden border-b border-line px-4 py-3">
        {champ && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-cover bg-top opacity-25"
            style={{ backgroundImage: `url("${splashUrl(champ.key)}")` }}
          />
        )}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-panel via-panel/80 to-transparent" />
        <ChampionIcon id={focus.championId} size={52} className="relative" />
        <div className="relative min-w-0 flex-1">
          <h2 className="truncate font-display text-3xl font-semibold leading-none">{name}</h2>
          <p className="mt-1 text-xs text-mist">
            {origin}
            {focus.role ? `, ${ROLE_LABEL[focus.role]}` : ''}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-5 p-4">
        {status === 'loading' && <p className="text-mist">Carregando build…</p>}
        {status === 'error' && <p className="text-enemy">Não foi possível carregar a build deste campeão.</p>}

        {status === 'ready' && focus.role === null && (
          <div>
            <p className="mb-2 text-snow">Em qual rota você vai jogar com {name}?</p>
            <div className="flex gap-2">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="rounded-lg border border-line bg-panel px-2.5 py-1 text-sm text-mist hover:text-snow"
                  onClick={() => setRoleOverride(r)}
                >
                  {ROLE_SHORT[r]}
                </button>
              ))}
            </div>
          </div>
        )}

        {status === 'ready' && focus.role !== null && !build && (
          <p className="text-mist">
            O dataset de meta não tem build de {name} para {ROLE_LABEL[focus.role]}. Importe um dataset mais completo em
            Configurações.
          </p>
        )}

        {status === 'ready' && build && (
          <>
            {(build.runes || build.spells) && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm text-mist">Runas e feitiços</h3>
                {build.runes && <RunesView runes={build.runes} />}
                {build.spells && <SpellsView spells={build.spells} />}
              </div>
            )}
            {situation && <SituationCard situation={situation} build={build} />}
            <SkillOrder build={build} spells={data.spells} />
            <div className="flex flex-col gap-3">
              <h3 className="text-sm text-mist">Itens</h3>
              <ItemRow title="Inicial" ids={build.items.starting} />
              <ItemRow title="Botas" ids={build.items.boots} />
              <ItemRow title="Principais, na ordem de compra" ids={build.items.core} chain />
              <VariantsView build={build} highlight={situation?.variantIndex ?? null} />
              {build.items.situational.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-xs text-mist">Situacionais</h4>
                  <ul className="flex flex-col gap-2">
                    {build.items.situational.map((s) => (
                      <SituationalItem key={s.itemId} id={s.itemId} when={s.when} />
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {focus.role && <ImportPanel championId={focus.championId} role={focus.role} build={build} forLocal={focus.forLocal} />}
          </>
        )}
      </div>
    </section>
  )
}
