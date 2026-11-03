import { useEffect, useMemo, useRef, useState } from 'react'
import { ROLES, type FriendProfile, type Pool, type PoolEntry } from '../../../shared/dataTypes'
import type { AccountStats, Role } from '../../../shared/types'
import { selectActiveProfile, useApp } from '../store/useApp'
import { mergePools, type ImportMode, type SharedProfile } from '../../../shared/poolShare'
import { ROLE_LABEL, ROLE_SHORT } from '../lib/format'
import { btn, btnDanger, btnGold, input } from '../lib/ui'
import { ChampionIcon, Stars, useChampionName } from './Icons'
import { ChampionPicker } from './ChampionPicker'
import { ImportDialog } from './ImportDialog'
import { ShareDialog } from './ShareDialog'

interface FormState {
  id?: string
  nickname: string
  riotId: string
  notes: string
  mainRoles: Role[]
  pool: Pool
}

const emptyPool = (): Pool => ({ TOP: [], JUNGLE: [], MIDDLE: [], BOTTOM: [], UTILITY: [] })
const emptyForm = (): FormState => ({ nickname: '', riotId: '', notes: '', mainRoles: [], pool: emptyPool() })
const toForm = (p: FriendProfile): FormState => ({
  id: p.id,
  nickname: p.nickname,
  riotId: p.riotId ?? '',
  notes: p.notes ?? '',
  mainRoles: [...p.mainRoles],
  pool: structuredClone(p.pool)
})

const COMFORT_LABEL = ['', 'Inseguro', 'Treinando', 'Confortável', 'Muito bom', 'Main']

function PoolRow({
  entry,
  onComfort,
  onNotes,
  onRemove
}: {
  entry: PoolEntry
  onComfort: (n: number) => void
  onNotes: (text: string) => void
  onRemove: () => void
}) {
  const name = useChampionName(entry.championId)
  const [showNotes, setShowNotes] = useState(false)
  const notesOpen = showNotes || !!entry.notes
  return (
    <li className="rise rounded-xl border border-line bg-panel/70 px-2.5 py-2 transition-colors hover:border-mist/30">
      <div className="flex items-center gap-3">
        <ChampionIcon id={entry.championId} size={38} />
        <span className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{name}</span>
        <Stars value={entry.comfort} onChange={onComfort} label={`Conforto com ${name}`} />
        {!notesOpen && (
          <button
            type="button"
            title="Adicionar anotação"
            className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-raised hover:text-snow"
            onClick={() => setShowNotes(true)}
            aria-label={`Adicionar anotação sobre ${name}`}
          >
            <span aria-hidden="true">✎</span>
          </button>
        )}
        <button
          type="button"
          title="Tirar da Pool"
          className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-enemy/15 hover:text-enemy"
          onClick={onRemove}
          aria-label={`Remover ${name} da Pool`}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {notesOpen && (
        <input
          className={`${input} mt-1.5 py-1 text-xs`}
          placeholder="Anotação (ex.: usar Flash + Ignite)"
          aria-label={`Anotação sobre ${name}`}
          value={entry.notes ?? ''}
          maxLength={500}
          autoFocus={showNotes && !entry.notes}
          onChange={(e) => onNotes(e.target.value)}
        />
      )}
    </li>
  )
}

const TIER_PT: Record<string, string> = {
  IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante'
}

function AccountStatsLine() {
  const [stats, setStats] = useState<AccountStats | null>(null)
  useEffect(() => {
    let off = false
    void window.api.getAccountStats().then((s) => !off && setStats(s)).catch(() => undefined)
    return () => {
      off = true
    }
  }, [])
  if (!stats) return null
  const games = (stats.wins ?? 0) + (stats.losses ?? 0)
  const wr = games > 0 && stats.wins !== null ? Math.round((stats.wins / games) * 100) : null
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-mist" aria-label="Nível e elo da conta">
      {stats.level !== null && <span className="rounded-full bg-panel px-2 py-0.5">Nível {stats.level}</span>}
      <span className="rounded-full bg-panel px-2 py-0.5">
        {stats.tier ? `${TIER_PT[stats.tier] ?? stats.tier}${stats.division ? ' ' + stats.division : ''}${stats.lp !== null ? ` · ${stats.lp} PdL` : ''}` : 'Sem classificação Solo/Duo'}
      </span>
      {wr !== null && <span className="rounded-full bg-panel px-2 py-0.5">{games} partidas · {wr}% vitórias</span>}
    </span>
  )
}


/** Conta detectada no cliente: uma linha só, com o jeito de ligar a conta ao perfil. */
function AccountLine({
  account,
  linkedId,
  formId,
  riotId,
  onFill,
  onClaim
}: {
  account: { gameName: string; tagLine: string }
  linkedId: string | null
  formId: string | undefined
  riotId: string
  onFill: (riotId: string) => void
  onClaim: () => Promise<void>
}) {
  const full = account.tagLine ? `${account.gameName}#${account.tagLine}` : account.gameName
  const isThis = formId !== undefined && linkedId === formId
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
      <span className="text-mist">
        Conta no cliente: <span className="font-medium text-snow">{full}</span>
      </span>
      <AccountStatsLine />
      {isThis ? (
        <span className="rounded-full bg-ally/15 px-2 py-0.5 text-xs font-medium text-ally">Este perfil é você</span>
      ) : formId ? (
        <button type="button" className={btn} onClick={() => void onClaim()}>
          Esta conta é este perfil
        </button>
      ) : riotId.trim() === '' ? (
        <button type="button" className={btn} onClick={() => onFill(full)}>
          Usar minha conta neste perfil
        </button>
      ) : null}
    </div>
  )
}

function Panel({ title, hint, children, className = '' }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col rounded-2xl border border-line/70 bg-panel/40 p-3 ${className}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        {hint && <p className="text-xs text-mist">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export function PoolScreen() {
  const profiles = useApp((s) => s.profiles)
  const active = useApp(selectActiveProfile)
  const catalog = useApp((s) => s.catalog)
  const catalogError = useApp((s) => s.catalogError)
  const loadCatalog = useApp((s) => s.loadCatalog)
  const saveProfile = useApp((s) => s.saveProfile)
  const deleteProfile = useApp((s) => s.deleteProfile)
  const identity = useApp((s) => s.identity)
  const claimProfile = useApp((s) => s.claimProfile)
  const setPoolDirty = useApp((s) => s.setPoolDirty)

  const [form, setForm] = useState<FormState>(() => (active ? toForm(active) : emptyForm()))
  const baseline = useRef<string>(JSON.stringify(active ? toForm(active) : emptyForm()))
  const [role, setRole] = useState<Role>('MIDDLE')
  const [shareOpen, setShareOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** null = automático: aberto para perfil novo, fechado para perfil que já existe */
  const [detailsOpen, setDetailsOpen] = useState<boolean | null>(null)

  const dirty = JSON.stringify(form) !== baseline.current
  const showDetails = detailsOpen ?? !form.id

  // Avisa a navegação (cabeçalho) quando há alterações a perder.
  useEffect(() => {
    setPoolDirty(dirty)
  }, [dirty, setPoolDirty])
  useEffect(() => () => setPoolDirty(false), [setPoolDirty])

  const load = (next: FormState): void => {
    setNotice(null)
    setForm(next)
    baseline.current = JSON.stringify(next)
    setError(null)
    setConfirmDelete(false)
    setDetailsOpen(null)
  }

  const discardOk = (): boolean => !dirty || window.confirm('Descartar as alterações não salvas deste perfil?')

  function select(p: FriendProfile | null): void {
    if (!discardOk()) return
    load(p ? toForm(p) : emptyForm())
  }

  const patchRole = (r: Role, fn: (list: PoolEntry[]) => PoolEntry[]): void =>
    setForm((f) => ({ ...f, pool: { ...f.pool, [r]: fn(f.pool[r]) } }))

  const inPool = useMemo(() => new Set(form.pool[role].map((e) => e.championId)), [form.pool, role])
  const total = ROLES.reduce((n, r) => n + form.pool[r].length, 0)

  const shareProfile = useMemo(
    () => ({ nickname: form.nickname, riotId: form.riotId, notes: form.notes, mainRoles: form.mainRoles, pool: form.pool }),
    [form]
  )

  function applyImport(mode: ImportMode, shared: SharedProfile): void {
    if (mode === 'new') {
      if (!discardOk()) return
      const next: FormState = {
        nickname: shared.nickname,
        riotId: shared.riotId ?? '',
        notes: shared.notes ?? '',
        mainRoles: shared.mainRoles,
        pool: shared.pool
      }
      setForm(next)
      baseline.current = JSON.stringify(emptyForm()) // ainda não existe: conta como alteração a salvar
      setError(null)
      setConfirmDelete(false)
      setDetailsOpen(null)
    } else {
      setForm((f) => ({ ...f, pool: mergePools(f.pool, shared.pool, mode) }))
    }
    setNotice(
      mode === 'new'
        ? `Pool de ${shared.nickname} carregada como perfil novo. Clique em “Salvar perfil” para guardar.`
        : 'Pool importada. Revise e clique em “Salvar perfil” para guardar.'
    )
    setImportOpen(false)
  }

  async function save(): Promise<void> {
    if (!form.nickname.trim()) {
      setDetailsOpen(true)
      setError('Dê um apelido ao perfil antes de salvar.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await saveProfile({
        id: form.id,
        nickname: form.nickname,
        riotId: form.riotId,
        notes: form.notes,
        mainRoles: form.mainRoles,
        pool: form.pool
      })
      load(toForm(saved))
      setNotice(null)
    } catch {
      setError('Não foi possível salvar o perfil. Tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    if (!form.id) return
    await deleteProfile(form.id)
    const next = useApp.getState().profiles[0]
    load(next ? toForm(next) : emptyForm())
  }

  const summary = [form.riotId || null, form.mainRoles.length ? form.mainRoles.map((r) => ROLE_SHORT[r]).join(' · ') : null, `${total} ${total === 1 ? 'campeão' : 'campeões'}`]
    .filter(Boolean)
    .join(' · ')

  return (
    <section aria-label="Perfis e Pools" className="flex h-full min-h-0 flex-col gap-3 max-[1000px]:overflow-y-auto">
      {shareOpen && <ShareDialog profile={shareProfile} onClose={() => setShareOpen(false)} />}
      {importOpen && (
        <ImportDialog target={form.id ? { nickname: form.nickname, pool: form.pool } : null} onApply={applyImport} onClose={() => setImportOpen(false)} />
      )}

      {/* Perfis */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line/70 bg-panel/70 p-1" role="group" aria-label="Perfis cadastrados">
          {profiles.map((p) => {
            const mine = identity?.profileId === p.id
            const selected = form.id === p.id
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={selected}
                onClick={() => select(p)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1 font-display text-base font-semibold ${selected ? 'bg-raised text-gold' : 'text-mist hover:text-snow'}`}
              >
                {p.nickname}
                {mine && <span className="rounded-full bg-ally/15 px-1.5 text-[11px] font-medium text-ally">você</span>}
              </button>
            )
          })}
          <button
            type="button"
            aria-pressed={!form.id}
            onClick={() => select(null)}
            className={`rounded-lg px-3 py-1 font-display text-base font-semibold ${!form.id ? 'bg-raised text-gold' : 'text-mist hover:text-snow'}`}
          >
            + Novo perfil
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className={btn} onClick={() => setImportOpen(true)}>
            Importar de um amigo
          </button>
          <button
            type="button"
            className={btn}
            disabled={!form.nickname.trim()}
            title={form.nickname.trim() ? undefined : 'Dê um apelido ao perfil primeiro'}
            onClick={() => setShareOpen(true)}
          >
            Compartilhar esta Pool
          </button>
        </div>
      </div>

      {/* Dados do perfil (recolhidos enquanto não precisa mexer) */}
      <div className="rounded-2xl border border-line/70 bg-panel/40 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm text-mist">
            <span className="font-display text-lg font-semibold text-snow">{form.nickname.trim() || 'Perfil novo'}</span>
            <span className="ml-2">{summary}</span>
          </p>
          <button type="button" className={btn} aria-expanded={showDetails} onClick={() => setDetailsOpen(!showDetails)}>
            {showDetails ? 'Recolher' : 'Editar dados do perfil'}
          </button>
        </div>
        {showDetails && (
          <div className="mt-3 flex flex-col gap-3 border-t border-line/60 pt-3">
            <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
              <div>
                <label htmlFor="nick" className="mb-1 block text-sm text-mist">
                  Apelido
                </label>
                <input id="nick" className={input} value={form.nickname} maxLength={40} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
              </div>
              <div>
                <label htmlFor="riot" className="mb-1 block text-sm text-mist">
                  ID da Riot (opcional)
                </label>
                <input id="riot" className={input} value={form.riotId} maxLength={40} placeholder="Nome#BR1" onChange={(e) => setForm({ ...form, riotId: e.target.value })} />
                <p className="mt-1 text-xs text-dim">Com o ID salvo, o app reconhece este jogador sozinho na seleção.</p>
              </div>
            </div>
            <div>
              <span id="mains-label" className="mb-1 block text-sm text-mist">
                Rotas que mais joga
              </span>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="mains-label">
                {ROLES.map((r) => {
                  const on = form.mainRoles.includes(r)
                  return (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setForm({ ...form, mainRoles: on ? form.mainRoles.filter((x) => x !== r) : [...form.mainRoles, r] })}
                      className={`rounded-lg border px-3 py-1 text-sm ${on ? 'border-gold/70 bg-gold/10 text-gold' : 'border-line text-mist hover:text-snow'}`}
                    >
                      {ROLE_LABEL[r]}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1 text-xs text-dim">Servem de palpite quando a fila não informa a rota.</p>
            </div>
            <div>
              <label htmlFor="notes" className="mb-1 block text-sm text-mist">
                Notas do perfil
              </label>
              <input id="notes" className={input} value={form.notes} maxLength={2000} placeholder="Ex.: prefere jogar de suporte quando o time não tem engage" onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {identity?.account && (
              <AccountLine
                account={identity.account}
                linkedId={identity.profileId}
                formId={form.id}
                riotId={form.riotId}
                onFill={(riotId) => setForm((f) => ({ ...f, riotId }))}
                onClaim={() => (form.id ? claimProfile(form.id) : Promise.resolve())}
              />
            )}
            {form.id && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
                {confirmDelete ? (
                  <>
                    <span className="text-sm text-enemy">Excluir {form.nickname} e a Pool dele?</span>
                    <button type="button" className={btnDanger} onClick={() => void remove()}>
                      Confirmar exclusão
                    </button>
                    <button type="button" className={btn} onClick={() => setConfirmDelete(false)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button type="button" className={btn} onClick={() => setConfirmDelete(true)}>
                    Excluir perfil
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rota */}
      <div className="flex flex-wrap gap-1 self-start rounded-xl border border-line/70 bg-panel/70 p-1" role="tablist" aria-label="Rota da Pool">
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={role === r}
            onClick={() => setRole(r)}
            className={`rounded-lg px-3 py-1 font-display text-base font-semibold ${role === r ? 'bg-raised text-gold' : 'text-mist hover:text-snow'}`}
          >
            {ROLE_LABEL[r]} <span className="text-sm font-normal text-dim">{form.pool[r].length}</span>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1.35fr_1fr] gap-4 max-[1000px]:flex-none max-[1000px]:grid-cols-1 max-[1000px]:[&>*]:min-h-[380px]">
        <Panel title="Campeões" hint="Clique para adicionar ou tirar da Pool">
          {catalogError && !catalog ? (
            <div className="border border-enemy/40 bg-enemy/10 p-3 text-sm">
              <p>{catalogError}</p>
              <button type="button" className={`${btn} mt-2`} onClick={() => void loadCatalog()}>
                Tentar de novo
              </button>
            </div>
          ) : !catalog ? (
            <p className="text-mist">Carregando campeões…</p>
          ) : (
            <ChampionPicker
              catalog={catalog}
              role={role}
              inPool={inPool}
              onToggle={(c) =>
                patchRole(role, (list) =>
                  inPool.has(c.id) ? list.filter((e) => e.championId !== c.id) : [...list, { championId: c.id, championKey: c.key, comfort: 3 }]
                )
              }
            />
          )}
        </Panel>

        <Panel title={`Pool de ${ROLE_LABEL[role]}`} hint="Estrelas = conforto. Quanto mais, mais o app sugere o campeão.">
          {form.pool[role].length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-4 text-mist">Nenhum campeão ainda. Clique nos ícones ao lado para adicionar.</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1" aria-label={`Pool de ${ROLE_LABEL[role]}`}>
              {[5, 4, 3, 2, 1].map((lvl) => {
                const group = form.pool[role].filter((e) => e.comfort === lvl)
                if (group.length === 0) return null
                return (
                  <section key={lvl}>
                    <h4 className={`mb-1 text-xs uppercase tracking-wider ${lvl >= 4 ? 'text-gold' : 'text-dim'}`}>
                      {COMFORT_LABEL[lvl]} · {group.length}
                    </h4>
                    <ul className="flex flex-col gap-1.5">
                      {group.map((e) => (
                        <PoolRow
                          key={e.championId}
                          entry={e}
                          onComfort={(n) => patchRole(role, (l) => l.map((x) => (x.championId === e.championId ? { ...x, comfort: n } : x)))}
                          onNotes={(t) => patchRole(role, (l) => l.map((x) => (x.championId === e.championId ? { ...x, notes: t } : x)))}
                          onRemove={() => patchRole(role, (l) => l.filter((x) => x.championId !== e.championId))}
                        />
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* Salvar */}
      <div className="flex min-h-[38px] shrink-0 flex-wrap items-center justify-end gap-3">
        {error && (
          <span role="alert" className="text-sm text-enemy">
            {error}
          </span>
        )}
        {notice && !error && (
          <span role="status" className="max-w-xl text-right text-sm text-ally">
            {notice}
          </span>
        )}
        {dirty && !error && !notice && <span className="text-sm text-mist">Alterações não salvas</span>}
        {dirty && form.id && (
          <button type="button" className={btn} onClick={() => load(JSON.parse(baseline.current) as FormState)}>
            Descartar
          </button>
        )}
        <button type="button" className={btnGold} disabled={saving || !dirty} onClick={() => void save()}>
          Salvar perfil
        </button>
      </div>
    </section>
  )
}
