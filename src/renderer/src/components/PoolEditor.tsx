import { useEffect, useMemo, useRef, useState } from 'react'
import { ROLES, type FriendProfile, type Pool, type PoolEntry } from '../../../shared/dataTypes'
import type { Role } from '../../../shared/types'
import { selectActiveProfile, useApp } from '../store/useApp'
import { mergePools, type ImportMode, type SharedProfile } from '../../../shared/poolShare'
import { ROLE_LABEL } from '../lib/format'
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
  return (
    <li className="flex items-center gap-3 border border-line bg-panel/70 px-2.5 py-2">
      <ChampionIcon id={entry.championId} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className="truncate font-display text-lg font-semibold">{name}</span>
          <Stars value={entry.comfort} onChange={onComfort} label={`Conforto com ${name}`} />
        </div>
        <input
          className={`${input} mt-1 py-1 text-xs`}
          placeholder="Anotação (ex.: usar Flash + Ignite)"
          aria-label={`Anotação sobre ${name}`}
          value={entry.notes ?? ''}
          maxLength={500}
          onChange={(e) => onNotes(e.target.value)}
        />
      </div>
      <button type="button" className={btn} onClick={onRemove} aria-label={`Remover ${name} da Pool`}>
        Remover
      </button>
    </li>
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
    <div className="fixed inset-0 z-40 bg-night/90 p-5 backdrop-blur-sm">
      {shareOpen && <ShareDialog profile={shareProfile} onClose={() => setShareOpen(false)} />}
      {importOpen && (
        <ImportDialog
          target={form.id ? { nickname: form.nickname, pool: form.pool } : null}
          onApply={applyImport}
          onClose={() => setImportOpen(false)}
        />
      )}
      <div role="dialog" aria-modal="true" aria-label="Perfis e Pools" className="mx-auto flex h-full max-w-[1240px] border border-line bg-deck">
        {/* Perfis */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-line">
          <h2 className="border-b border-line px-4 py-3 font-display text-xl font-semibold">Perfis</h2>
          <ul className="flex-1 overflow-y-auto p-2" aria-label="Perfis cadastrados">
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => select(p)}
                  aria-current={form.id === p.id}
                  className={`w-full px-3 py-2 text-left font-display text-lg ${
                    form.id === p.id ? 'bg-raised text-gold' : 'text-snow hover:bg-panel'
                  }`}
                >
                  {p.nickname}
                </button>
              </li>
            ))}
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
                className={`border-x border-t px-4 py-1.5 font-display text-lg ${
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
                <p className="border border-dashed border-line p-4 text-mist">
                  Nenhum campeão ainda. Clique nos ícones ao lado para adicionar.
                </p>
              ) : (
                <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1" aria-label={`Pool de ${ROLE_LABEL[role]}`}>
                  {form.pool[role].map((e) => (
                    <PoolRow
                      key={e.championId}
                      entry={e}
                      onComfort={(n) => patchRole(role, (l) => l.map((x) => (x.championId === e.championId ? { ...x, comfort: n } : x)))}
                      onNotes={(t) => patchRole(role, (l) => l.map((x) => (x.championId === e.championId ? { ...x, notes: t } : x)))}
                      onRemove={() => patchRole(role, (l) => l.filter((x) => x.championId !== e.championId))}
                    />
                  ))}
                </ul>
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
