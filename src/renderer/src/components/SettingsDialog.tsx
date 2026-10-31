import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../store/useApp'
import { DEFAULT_META_URL } from '../../../shared/config'
import { btn, btnGold, input } from '../lib/ui'

const STATUS_TEXT = {
  searching: 'Procurando o League of Legends. Abra o cliente e entre na sua conta.',
  connected: 'Conectado ao cliente do League of Legends.',
  disconnected: 'O cliente foi fechado. O app volta a conectar assim que você abrir o LoL.'
} as const

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

function formatDate(iso: string): string | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : dateFmt.format(d)
}

type Message = { ok: boolean; text: string } | null

type TabId = 'general' | 'match' | 'data' | 'app'
const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'general', label: 'Geral', hint: 'Cliente, conta e aparência' },
  { id: 'match', label: 'Partida', hint: 'Aceite automático e sugestões' },
  { id: 'data', label: 'Dados', hint: 'Meta, patch e ícones' },
  { id: 'app', label: 'Aplicativo', hint: 'Versão e diagnóstico' }
]

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line/60 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-snow">{title}</div>
        {hint && <div className="mt-0.5 text-xs text-mist">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full border transition-colors ${checked ? 'border-gold/60 bg-gold/70' : 'border-line bg-raised'}`}
    >
      <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-snow shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} style={{ width: 18, height: 18 }} />
    </button>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-4">
      <h3 className="mb-1 font-display text-lg font-semibold">{title}</h3>
      {children}
    </section>
  )
}

export function SettingsDialog() {
  const close = useApp((s) => s.closeSettings)
  const settings = useApp((s) => s.settings)
  const status = useApp((s) => s.lcuStatus)
  const metaInfo = useApp((s) => s.metaInfo)
  const catalog = useApp((s) => s.catalog)
  const pickGameDir = useApp((s) => s.pickGameDir)
  const resetGameDir = useApp((s) => s.resetGameDir)
  const importMeta = useApp((s) => s.importMeta)
  const updateMeta = useApp((s) => s.updateMeta)
  const saveSettings = useApp((s) => s.saveSettings)
  const update = useApp((s) => s.update)
  const checkForUpdates = useApp((s) => s.checkForUpdates)

  const [dirMessage, setDirMessage] = useState<Message>(null)
  const [metaMessage, setMetaMessage] = useState<Message>(null)
  const [urlDraft, setUrlDraft] = useState(settings?.metaUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [checkingApp, setCheckingApp] = useState(false)
  const [tab, setTab] = useState<TabId>('general')
  const [diagMsg, setDiagMsg] = useState<Message>(null)
  const [lastAccept, setLastAccept] = useState<{ ok: boolean; status: number; at: number } | null>(null)
  const account = useApp((s) => s.identity?.account)
  const pickMode = useApp((s) => s.settings?.pickMode ?? 'balanced')
  const setPickMode = useApp((s) => s.setPickMode)

  const effectiveUrl = (settings?.metaUrl ?? DEFAULT_META_URL) || null

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  async function chooseDir(): Promise<void> {
    const r = await pickGameDir()
    if (r.ok) setDirMessage({ ok: true, text: `Pasta definida: ${r.path}` })
    else if (r.reason === 'not-lol')
      setDirMessage({ ok: false, text: 'Essa pasta não parece ser a do League of Legends: não encontrei o LeagueClient.exe. Escolha a pasta onde o jogo está instalado.' })
  }

  async function chooseMeta(): Promise<void> {
    const r = await importMeta()
    if (r.ok) setMetaMessage({ ok: true, text: `Dados importados: patch ${r.info.patch}, ${r.info.champions} campeões.` })
    else if (r.reason === 'invalid') setMetaMessage({ ok: false, text: `Arquivo inválido: ${r.message ?? 'formato não reconhecido'}.` })
  }

  async function runUpdate(): Promise<void> {
    setBusy(true)
    setMetaMessage(null)
    try {
      const r = await updateMeta()
      if (r.ok)
        setMetaMessage({
          ok: true,
          text: r.changed ? `Dados atualizados: patch ${r.info.patch}, ${r.info.champions} campeões.` : 'Você já está com os dados mais recentes.'
        })
      else if (r.reason === 'no-url') setMetaMessage({ ok: false, text: 'Informe o endereço do meta.json abaixo para poder atualizar.' })
      else if (r.reason === 'network') setMetaMessage({ ok: false, text: `Não foi possível atualizar: ${r.message ?? 'sem conexão'}. O app continua com os dados atuais.` })
      else setMetaMessage({ ok: false, text: `${r.message ?? 'O arquivo baixado não é válido'}. O app continua com os dados atuais.` })
    } finally {
      setBusy(false)
    }
  }

  async function saveUrlAndUpdate(): Promise<void> {
    setMetaMessage(null)
    try {
      await saveSettings({ metaUrl: urlDraft.trim() || null })
    } catch {
      setMetaMessage({ ok: false, text: 'Endereço inválido: use um link que comece com https://' })
      return
    }
    if (urlDraft.trim() || DEFAULT_META_URL) await runUpdate()
    else setMetaMessage({ ok: true, text: 'Endereço removido.' })
  }

  async function checkApp(): Promise<void> {
    setCheckingApp(true)
    try {
      await checkForUpdates()
    } finally {
      setCheckingApp(false)
    }
  }

  const appText = ((): { ok: boolean; text: string } | null => {
    if (!update) return null
    switch (update.status) {
      case 'unsupported':
        return { ok: false, text: update.message ?? 'Atualização automática indisponível.' }
      case 'available':
        return { ok: true, text: `Versão ${update.latest} disponível. Use o aviso no topo da tela para atualizar.` }
      case 'downloading':
        return { ok: true, text: `Baixando a versão ${update.latest} (${update.percent ?? 0}%)…` }
      case 'ready':
        return { ok: true, text: `Versão ${update.latest} pronta: reinicie o app para instalar.` }
      case 'error':
        return { ok: false, text: update.message ?? 'Falha ao atualizar.' }
      case 'idle':
        return update.checkedAt ? { ok: true, text: 'Você já está com a versão mais recente.' } : null
      default:
        return null
    }
  })()

  useEffect(() => {
    void window.api.getLastAccept().then(setLastAccept)
  }, [tab])

  async function copyDiagnostics(): Promise<void> {
    try {
      await window.api.copyText(await window.api.getDiagnostics())
      setDiagMsg({ ok: true, text: 'Relatório copiado. Cole na conversa com o Pedro.' })
    } catch {
      setDiagMsg({ ok: false, text: 'Não consegui copiar o relatório.' })
    }
  }

  const generated = metaInfo ? formatDate(metaInfo.generatedAt) : null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-night/85 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Configurações"
        className="flex h-[min(640px,100%)] w-full max-w-3xl overflow-hidden rounded-2xl border border-line bg-deck shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]"
      >
        <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-line bg-night/40 p-3" aria-label="Seções" role="tablist">
          <h2 className="px-2 pb-2 pt-1 font-display text-2xl font-semibold">Configurações</h2>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-xl px-3 py-2 text-left transition-colors ${tab === t.id ? 'bg-raised text-gold' : 'text-snow hover:bg-panel'}`}
            >
              <span className="block font-display text-lg font-semibold leading-tight">{t.label}</span>
              <span className="block text-xs text-mist">{t.hint}</span>
            </button>
          ))}
          <button type="button" className={`${btn} mt-auto justify-center`} onClick={close}>
            Fechar
          </button>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5" role="tabpanel">
          {tab === 'general' && (
            <>
              <Card title="Cliente do League of Legends">
                <p className="text-sm text-mist">{STATUS_TEXT[status]}</p>
                {account && (
                  <p className="mt-1 text-sm">
                    Conta detectada: <span className="font-medium text-snow">{account.gameName}{account.tagLine ? `#${account.tagLine}` : ''}</span>
                  </p>
                )}
                <p className="mt-3 break-all rounded-xl border border-line bg-night px-3 py-2 text-sm">{settings?.lockfilePath ?? 'Detecção automática da pasta'}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className={btnGold} onClick={() => void chooseDir()}>
                    Escolher pasta
                  </button>
                  {settings?.lockfilePath && (
                    <button type="button" className={btn} onClick={() => void resetGameDir().then(() => setDirMessage(null))}>
                      Usar detecção automática
                    </button>
                  )}
                </div>
                {dirMessage && (
                  <p role="status" className={`mt-2 text-sm ${dirMessage.ok ? 'text-ally' : 'text-enemy'}`}>
                    {dirMessage.text}
                  </p>
                )}
              </Card>
              <Card title="Aparência">
                <Row title="Animação de abertura" hint="A vinheta que aparece quando o app inicia.">
                  <Switch label="Animação de abertura" checked={settings?.introAnimation ?? true} onChange={(v) => void saveSettings({ introAnimation: v })} />
                </Row>
                <Row title="Reduzir movimento" hint="Desliga animações e transições. Ajuda em computadores mais fracos.">
                  <Switch label="Reduzir movimento" checked={settings?.reduceMotion ?? false} onChange={(v) => void saveSettings({ reduceMotion: v })} />
                </Row>
              </Card>
            </>
          )}

          {tab === 'match' && (
            <>
              <Card title="Aceitar partida">
                <p className="text-sm text-mist">
                  Quando a partida é encontrada, o app aceita por você pelo próprio cliente do LoL: não lê a tela e não mexe no mouse, então funciona com o
                  cliente minimizado ou em outro monitor. Se você aceitar ou recusar antes, ele não faz nada.
                </p>
                <Row title="Aceitar partida automaticamente">
                  <Switch label="Aceitar partida automaticamente" checked={settings?.autoAccept ?? false} onChange={(v) => void saveSettings({ autoAccept: v })} />
                </Row>
                <Row title="Esperar antes de aceitar" hint="Dá tempo de você mesmo aceitar ou recusar.">
                  <select
                    aria-label="Espera antes de aceitar"
                    value={settings?.autoAcceptDelay ?? 1}
                    onChange={(e) => void saveSettings({ autoAcceptDelay: Number(e.target.value) })}
                    className="rounded-lg border border-line bg-panel px-2 py-1 text-sm text-snow"
                  >
                    {[0, 1, 2, 3, 5, 8].map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? 'na hora' : `${n} s`}
                      </option>
                    ))}
                  </select>
                </Row>
                <p className="mt-2 text-xs text-mist">
                  Última tentativa:{' '}
                  {lastAccept
                    ? `${lastAccept.ok ? 'aceita' : `recusada pelo cliente (HTTP ${lastAccept.status})`} às ${new Date(lastAccept.at).toLocaleTimeString('pt-BR')}`
                    : 'nenhuma ainda'}
                </p>
              </Card>
              <Card title="Sugestões do draft">
                <Row title="Prioridade padrão" hint="Também dá para trocar durante a seleção.">
                  <select
                    aria-label="Prioridade das sugestões"
                    value={pickMode}
                    onChange={(e) => void setPickMode(e.target.value as 'balanced' | 'comfort' | 'meta')}
                    className="rounded-lg border border-line bg-panel px-2 py-1 text-sm text-snow"
                  >
                    <option value="balanced">Equilibrado</option>
                    <option value="comfort">Conforto</option>
                    <option value="meta">Meta</option>
                  </select>
                </Row>
              </Card>
            </>
          )}

          {tab === 'data' && (
            <>
              <Card title="Dados de meta">
                {metaInfo ? (
                  <p className="text-sm text-mist">
                    {metaInfo.isSample ? 'Dados de amostra (não refletem o meta real). ' : `Fonte: ${metaInfo.source}. `}
                    Patch {metaInfo.patch}, {metaInfo.champions} campeões
                    {generated && !metaInfo.isSample ? `, gerado em ${generated}` : ''}.
                  </p>
                ) : (
                  <p className="text-sm text-mist">Nenhum dado de meta carregado.</p>
                )}

                <label htmlFor="meta-url" className="mt-3 block text-sm text-mist">
                  Endereço do meta.json
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="meta-url"
                    className={input}
                    value={urlDraft}
                    placeholder={DEFAULT_META_URL || 'https://…/meta.json'}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    spellCheck={false}
                  />
                  <button type="button" className={`${btnGold} shrink-0`} disabled={busy} onClick={() => void saveUrlAndUpdate()}>
                    Salvar e atualizar
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" className={btn} disabled={busy || !effectiveUrl} onClick={() => void runUpdate()}>
                    {busy ? 'Atualizando…' : 'Atualizar agora'}
                  </button>
                  <button type="button" className={btn} onClick={() => void chooseMeta()}>
                    Importar arquivo (JSON)
                  </button>
                </div>
                <Row title="Atualizar ao abrir o app">
                  <Switch label="Atualizar ao abrir o app" checked={settings?.metaAutoUpdate ?? true} onChange={(v) => void saveSettings({ metaAutoUpdate: v })} />
                </Row>
                {metaMessage && (
                  <p role="status" className={`text-sm ${metaMessage.ok ? 'text-ally' : 'text-enemy'}`}>
                    {metaMessage.text}
                  </p>
                )}
              </Card>
              <Card title="Ícones e dados do jogo">
                <p className="text-sm text-mist">
                  {catalog
                    ? `Versão ${catalog.version}. Acompanha o patch do seu cliente automaticamente.`
                    : 'Ainda não carregados. Conecte à internet uma vez para o app guardar uma cópia.'}
                </p>
              </Card>
            </>
          )}

          {tab === 'app' && (
            <>
              <Card title="Atualização do app">
                <p className="text-sm text-mist">Versão instalada: {update?.current ?? '…'}</p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    className={btn}
                    disabled={checkingApp || update?.status === 'unsupported' || update?.status === 'downloading'}
                    onClick={() => void checkApp()}
                  >
                    {checkingApp || update?.status === 'checking' ? 'Verificando…' : 'Verificar atualizações'}
                  </button>
                </div>
                {appText && (
                  <p role="status" className={`mt-2 text-sm ${appText.ok ? 'text-ally' : 'text-mist'}`}>
                    {appText.text}
                  </p>
                )}
              </Card>
              <Card title="Diagnóstico">
                <p className="text-sm text-mist">
                  Se algo não funcionar (o aceite automático, por exemplo), copie o relatório e mande para o Pedro. Ele não tem senha, nome de conta nem dados pessoais.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" className={btn} onClick={() => void copyDiagnostics()}>
                    Copiar relatório de diagnóstico
                  </button>
                </div>
                {diagMsg && (
                  <p role="status" className={`mt-2 text-sm ${diagMsg.ok ? 'text-ally' : 'text-enemy'}`}>
                    {diagMsg.text}
                  </p>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
