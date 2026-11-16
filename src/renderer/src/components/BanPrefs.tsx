import { useMemo, useState } from 'react'
import { selectActiveProfile, useApp } from '../store/useApp'
import { normalize } from '../lib/format'
import { input } from '../lib/ui'
import { ChampionIcon, useChampionName } from './Icons'

function Chip({ id, onRemove }: { id: number; onRemove: () => void }) {
  const name = useChampionName(id)
  return (
    <li className="flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-1.5 text-sm">
      <ChampionIcon id={id} size={24} className="rounded-full" />
      <span>{name}</span>
      <button type="button" onClick={onRemove} aria-label={`Remover ${name}`} className="grid h-5 w-5 place-items-center rounded-full text-mist hover:bg-raised hover:text-snow">
        ×
      </button>
    </li>
  )
}

/** Escolhe alguns campeões digitando o nome (sem acento/maiúscula) e mostra os escolhidos como etiquetas. */
function ChampionChips({ label, hint, max, ids, onChange }: { label: string; hint: string; max: number; ids: number[]; onChange: (next: number[]) => void }) {
  const catalog = useApp((s) => s.catalog)
  const [q, setQ] = useState('')
  const inputId = `prefs-${label.replace(/\W+/g, '-').toLowerCase()}`
  const results = useMemo(() => {
    const n = normalize(q)
    if (!n || !catalog) return []
    return catalog.champions.filter((c) => !ids.includes(c.id) && (normalize(c.name).includes(n) || normalize(c.key).includes(n))).slice(0, 5)
  }, [q, catalog, ids])
  const full = ids.length >= max

  return (
    <div>
      <label htmlFor={inputId} className="block text-[15px] font-semibold text-snow">
        {label}
      </label>
      <p className="text-xs text-mist">{hint}</p>
      {ids.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={label}>
          {ids.map((id) => (
            <Chip key={id} id={id} onRemove={() => onChange(ids.filter((x) => x !== id))} />
          ))}
        </ul>
      )}
      {!full && (
        <>
          <input id={inputId} type="search" autoComplete="off" spellCheck={false} className={`${input} mt-1.5`} placeholder="Digite o nome do campeão" value={q} onChange={(e) => setQ(e.target.value)} />
          {results.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Resultados para ${label}`}>
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange([...ids, c.id])
                      setQ('')
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2.5 text-sm text-snow hover:border-gold/60"
                    aria-label={`Adicionar ${c.name}`}
                  >
                    <ChampionIcon id={c.id} size={24} className="rounded-full" />
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Antes da partida: quem você não gosta de enfrentar (2 ou 3) e quem você mais bane. Isso alimenta as sugestões de ban.
 * Fica salvo no seu perfil, só neste computador (não viaja no compartilhamento de Pool).
 */
export function BanPrefs() {
  const profile = useApp(selectActiveProfile)
  const saveProfile = useApp((s) => s.saveProfile)
  if (!profile) return null
  const avoid = profile.avoid ?? []
  const usual = profile.usualBans ?? []
  const pending = avoid.length === 0 && usual.length === 0
  const save = (patch: { avoid?: number[]; usualBans?: number[] }): void => void saveProfile({ ...profile, ...patch })

  return (
    <section aria-label="Seus bans" className="w-full max-w-lg text-left">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-dim">Preferências de ban</p>
      <h2 className={`mt-2 text-[15px] font-semibold ${pending ? 'text-gold' : ''}`}>{pending ? 'Antes da partida: seus bans' : 'Seus bans'}</h2>
      <p className="mt-0.5 text-sm text-mist">
        {pending ? 'Responda abaixo e as sugestões de ban passam a considerar o que você mais odeia enfrentar.' : 'As sugestões de ban consideram isto, além do meta e dos seus campeões.'}
      </p>
      <div className="mt-4 flex flex-col gap-5 border-t border-line pt-4">
        <ChampionChips label="Campeões que você não gosta de enfrentar" hint="Escolha 2 ou 3 (até 5)." max={5} ids={avoid} onChange={(next) => save({ avoid: next })} />
        <ChampionChips label="Campeões que você mais bane" hint="Até 3." max={3} ids={usual} onChange={(next) => save({ usualBans: next })} />
      </div>
    </section>
  )
}
