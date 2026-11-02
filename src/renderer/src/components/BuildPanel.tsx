import { useEffect, useState } from 'react'
import type { Role } from '../../../shared/types'
import type { LoadoutParts, PartResult } from '../../../shared/loadout'
import type { BuildSituation, ChampionBuild, SpellInfo } from '../../../shared/dataTypes'
import { useApp } from '../store/useApp'
import { useFocus } from '../lib/useFocus'
import { ROLE_LABEL, ROLE_SHORT, splashUrl } from '../lib/format'
import { btnGold } from '../lib/ui'
import { ROLES } from '../../../shared/dataTypes'
import { ChampionIcon, useChampionName } from './Icons'
import { ItemRow, SituationalItem } from './BuildParts'
import { BuildOptionsView } from './BuildOptionsView'
import { ZERO_SELECTION, type BuildSelection } from '../../../shared/buildSelection'

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
function ImportPanel({ championId, role, build, forLocal, selection }: { championId: number; role: Role; build: ChampionBuild; forLocal: boolean; selection: BuildSelection }) {
  const lcuStatus = useApp((s) => s.lcuStatus)
  const inDraft = useApp((s) => s.draft !== null)
  const name = useChampionName(championId)
  const available: Record<keyof LoadoutParts, boolean> = {
    runes: !!(build.runes || build.options?.runes?.length),
    spells: !!(build.spells || build.options?.spells?.length),
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
        parts: { runes: picked.runes && available.runes, spells: picked.spells && available.spells, items: picked.items && available.items },
        selection
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
    <section aria-label="Importar para o cliente" className="rounded-2xl border border-gold/30 bg-gold/5 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="font-display text-lg font-semibold text-gold">Enviar para o LoL</h3>
        {(Object.keys(PART_LABEL) as (keyof LoadoutParts)[]).map((k) => (
          <label key={k} title={detail[k]} className={`flex items-center gap-1.5 text-sm ${available[k] ? '' : 'opacity-50'}`}>
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-gold)]"
              disabled={!available[k] || !!blocked}
              checked={available[k] && picked[k]}
              onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.checked }))}
            />
            {PART_LABEL[k]}
          </label>
        ))}
        <button type="button" className={`${btnGold} ml-auto`} disabled={!!blocked || busy || chosen.length === 0} onClick={() => void run()}>
          {busy ? 'Enviando…' : 'Importar para o cliente'}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-mist">
        {blocked ?? `Envia a opção marcada abaixo de ${name} (${ROLE_LABEL[role]}) para o seu cliente. Só acontece quando você clica; o app mexe apenas na página de runas e no conjunto de itens “Pedro.gg”.`}
      </p>
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
function SituationCard({ situation }: { situation: BuildSituation }) {
  const dmg = situation.enemyDamage
  if (!dmg || situation.enemiesKnown === 0) return null
  const ad = Math.round(dmg.physical * 100)
  const ap = 100 - ad
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
      {situation.variantCore && (
        <div className="mt-2">
          <ItemRow title="Construção que encaixa melhor nesta partida" ids={situation.variantCore} chain />
        </div>
      )}
    </section>
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
  const [selection, setSelection] = useState<BuildSelection>(ZERO_SELECTION)
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
            {focus.role && <ImportPanel championId={focus.championId} role={focus.role} build={build} forLocal={focus.forLocal} selection={selection} />}
            {situation && <SituationCard situation={situation} />}
            <BuildOptionsView build={build} spells={data.spells} highlightCore={situation?.variantCore} selection={selection} onSelect={setSelection} />
          </>
        )}
      </div>
    </section>
  )
}
