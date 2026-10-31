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
        <ChampionIcon id={entry.championId} size={40} />
        <span className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{name}</span>
        <Stars value={entry.comfort} onChange={onComfort} label={`Conforto com ${name}`} />
        {!notesOpen && (
          <button type="button" className="text-xs text-dim hover:text-ink" onClick={() => setShowNotes(true)} aria-label={`Adicionar anotação sobre ${name}`}>
            + nota
          </button>
        )}
        <button type="button" className="text-xs text-dim hover:text-enemy" onClick={onRemove} aria-label={`Remover ${name} da Pool`}>
          Remover
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

function AccountBar({
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
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-ally/5 px-4 py-2 text-sm">
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
      {linkedId === null && <span className="text-xs text-gold">Sem um perfil vinculado, o app usa o perfil principal para você.</span>}
    </div>
  )
}

export function PoolEditor() {
  const close = useApp((s) => s.closePool)
  const profiles = useApp((s) => s.profiles)
  const active = useApp(selectActiveProfile)
  const catalog = useApp((s) => s.catalog)
  const catalogError = useApp((s) => s.catalogError)
  const loadCatalog = useApp((s) => s.loadCatalog)
  const saveProfile = useApp((s) => s.saveProfile)
  const deleteProfile = useApp((s) => s.deleteProfile)
  const identity = useApp((s) => s.identity)
  const claimProfile = useApp((s) => s.claimProfile)

  const [form, setForm] = useState<FormState>(() => (active ? toForm(active) : emptyForm()))
  const baseline = useRef<string>(JSON.stringify(active ? toForm(active) : emptyForm()))
  const [role, setRole] = useState<Role>('MIDDLE')
  const [shareOpen, setShareOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dirty = JSON.stringify(form) !== baseline.current

  // O ouvinte do Esc é registrado uma vez; ele chama sempre a versão mais nova de requestClose.
  const closeRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const load = (next: FormState): void => {
    setNotice(null)
    setForm(next)
    baseline.current = JSON.stringify(next)
    setError(null)
    setConfirmDelete(false)
  }

  const discardOk = (): boolean => !dirty || window.confirm('Descartar as alterações não salvas deste perfil?')

  function requestClose(): void {
    if (discardOk()) close()
  }
  closeRef.current = requestClose

  function select(p: FriendProfile | null): void {
    if (!discardOk()) return
    load(p ? toForm(p) : emptyForm())
  }

  const patchRole = (r: Role, fn: (list: PoolEntry[]) => PoolEntry[]): void =>
    setForm((f) => ({ ...f, pool: { ...f.pool, [r]: fn(f.pool[r]) } }))

  const inPool = useMemo(() => new Set(form.pool[role].map((e) => e.championId)), [form.pool, role])

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

  return (
    <div className="fixed inset-0 z-40 bg-night/92 p-5">
      {shareOpen && <ShareDialog profile={shareProfile} onClose={() => setShareOpen(false)} />}
      {importOpen && (
        <ImportDialog
          target={form.id ? { nickname: form.nickname, pool: form.pool } : null}
          onApply={applyImport}
          onClose={() => setImportOpen(false)}
        />
      )}
      <div role="dialog" aria-modal="true" aria-label="Perfis e Pools" className="mx-auto flex h-full max-w-[1240px] overflow-hidden rounded-2xl border border-line bg-deck shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]">
        {/* Perfis */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-night/40">
          <h2 className="px-4 pb-1 pt-4 font-display text-2xl font-semibold">Perfis</h2>
          <p className="px-4 pb-3 text-xs text-mist">Um perfil por jogador. Com o Riot ID salvo, o app reconhece o amigo sozinho na seleção.</p>
          <ul className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3" aria-label="Perfis cadastrados">
            {profiles.map((p) => {
              const mine = identity?.profileId === p.id
              const top = ROLES.flatMap((r) => p.pool[r])[0]
              const total = ROLES.reduce((n, r) => n + p.pool[r].length, 0)
              const selected = form.id === p.id
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => select(p)}
                    aria-current={selected}
                    className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                      selected ? 'border-gold/50 bg-raised' : 'border-transparent hover:bg-panel'
                    }`}
                  >
                    {top ? (
                      <ChampionIcon id={top.championId} size={40} />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-raised font-display text-lg text-dim" aria-hidden="true">
                        {p.nickname.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={`flex items-center gap-1.5 font-display text-lg font-semibold leading-tight ${selected ? 'text-gold' : 'text-snow'}`}>
                        <span className="truncate">{p.nickname}</span>
                        {mine && <span className="rounded-full bg-ally/15 px-1.5 text-[11px] font-medium text-ally">você</span>}
                      </span>
                      <span className="block truncate text-xs text-mist">
                        {p.riotId ?? 'sem Riot ID'} · {total} {total === 1 ? 'campeão' : 'campeões'}
                      </span>
                      {p.mainRoles.length > 0 && <span className="block truncate text-[11px] text-dim">{p.mainRoles.map((r) => ROLE_SHORT[r]).join(' · ')}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
            {profiles.length === 0 && <li className="rounded-xl border border-dashed border-line p-3 text-sm text-mist">Nenhum perfil ainda. Crie o seu e o de cada amigo.</li>}
          </ul>
          <div className="flex flex-col gap-2 border-t border-line p-3">
            <button type="button" className={`${btnGold} w-full justify-center`} onClick={() => select(null)}>
              Novo perfil
            </button>
            <button type="button" className={`${btn} w-full justify-center`} onClick={() => setImportOpen(true)}>
              Importar de um amigo
            </button>
            <button
              type="button"
              className={`${btn} w-full justify-center`}
              disabled={!form.nickname.trim()}
              title={form.nickname.trim() ? undefined : 'Dê um apelido ao perfil primeiro'}
              onClick={() => setShareOpen(true)}
            >
              Compartilhar esta Pool
            </button>
          </div>
        </aside>

        {/* Editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          {identity?.account && (
            <AccountBar
              account={identity.account}
              linkedId={identity.profileId}
              formId={form.id}
              riotId={form.riotId}
              onFill={(riotId) => setForm((f) => ({ ...f, riotId }))}
              onClaim={() => (form.id ? claimProfile(form.id) : Promise.resolve())}
            />
          )}
          <div className="grid shrink-0 grid-cols-[1fr_1fr_auto] items-end gap-x-3 gap-y-2 border-b border-line px-4 py-3">
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
            </div>
            <button type="button" className={btn} onClick={requestClose}>
              Fechar
            </button>
            <div className="col-span-2">
              <label htmlFor="notes" className="mb-1 block text-sm text-mist">
                Notas do perfil
              </label>
              <input id="notes" className={input} value={form.notes} maxLength={2000} placeholder="Ex.: prefere jogar de suporte quando o time não tem engage" onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex items-center gap-1.5" role="group" aria-label="Rotas principais">
              {ROLES.map((r) => {
                const on = form.mainRoles.includes(r)
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={on}
                    title={`${ROLE_LABEL[r]} é uma rota principal`}
                    onClick={() => setForm({ ...form, mainRoles: on ? form.mainRoles.filter((x) => x !== r) : [...form.mainRoles, r] })}
                    className={`rounded-sm border px-2 py-1 text-xs ${on ? 'border-gold/70 bg-gold/10 text-gold' : 'border-line text-mist hover:text-snow'}`}
                  >
                    {ROLE_LABEL[r]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Abas de rota */}
          <div className="flex shrink-0 gap-1 border-b border-line px-4 pt-3" role="tablist" aria-label="Rota da Pool">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={role === r}
                onClick={() => setRole(r)}
                className={`rounded-t-xl border-x border-t px-4 py-1.5 font-display text-lg transition-colors ${
                  role === r ? 'border-line bg-panel text-gold' : 'border-transparent text-mist hover:text-snow'
                }`}
              >
                {ROLE_LABEL[r]} <span className="text-sm text-dim">{form.pool[r].length}</span>
              </button>
            ))}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[1.35fr_1fr] gap-5 p-4">
            {/* Seletor de campeões */}
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
                    inPool.has(c.id)
                      ? list.filter((e) => e.championId !== c.id)
                      : [...list, { championId: c.id, championKey: c.key, comfort: 3 }]
                  )
                }
              />
            )}

            {/* Pool da rota */}
            <div className="flex min-h-0 flex-col">
              <h3 className="mb-1 text-sm text-mist">Pool de {ROLE_LABEL[role]}</h3>
              {form.pool[role].length === 0 ? (
                <p className="rounded-xl border border-dashed border-line p-4 text-mist">
                  Nenhum campeão ainda. Clique nos ícones ao lado para adicionar.
                </p>
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
            </div>
          </div>

          <footer className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3">
            {form.id &&
              (confirmDelete ? (
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
              ))}
            <div className="ml-auto flex items-center gap-3">
              {error && (
                <span role="alert" className="text-sm text-enemy">
                  {error}
                </span>
              )}
              {notice && !error && <span role="status" className="max-w-md text-right text-sm text-ally">{notice}</span>}
              {dirty && !error && !notice && <span className="text-sm text-mist">Alterações não salvas</span>}
              <button type="button" className={btnGold} disabled={saving || !dirty} onClick={() => void save()}>
                Salvar perfil
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
