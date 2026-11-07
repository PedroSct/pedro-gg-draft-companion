import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../store/useApp'
import { DEFAULT_META_URL } from '../../../shared/config'
import { btn, btnGold, input } from '../lib/ui'
import { acceleratorFromEvent, DEFAULT_KEY_MOVE, DEFAULT_KEY_SIZE, formatAccelerator } from '../../../shared/shortcuts'

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

const DEFAULT_REGIONS = ['br1', 'euw1', 'kr']
const REGION_NAMES: Record<string, string> = {
  br1: 'Brasil (BR)',
  euw1: 'Europa Oeste (EUW)',
  eun1: 'Europa Nordeste (EUNE)',
  kr: 'Coreia (KR)',
  na1: 'América do Norte (NA)',
  la1: 'LAN',
  la2: 'LAS',
  jp1: 'Japão (JP)'
}

/** Campo que grava a combinação de teclas apertada. Esc cancela; precisa de Ctrl, Alt ou Shift e uma tecla. */
function ShortcutField({ label, value, fallback, other, onChange }: { label: string; value: string; fallback: string; other: string; onChange: (acc: string) => void }) {
  const [recording, setRecording] = useState(false)
  const [warn, setWarn] = useState('')
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-label={label}
        className={`${btn} min-w-[9rem] font-mono text-xs`}
        onClick={() => {
          setWarn('')
          setRecording(true)
        }}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return
          e.preventDefault()
          if (e.key === 'Escape') return setRecording(false)
          const acc = acceleratorFromEvent(e)
          if (!acc) return // só o modificador: espera a tecla
          if (acc === other) return setWarn('Já é o outro atalho.')
          setRecording(false)
          onChange(acc)
        }}
      >
        {recording ? 'Aperte as teclas… (Esc cancela)' : formatAccelerator(value)}
      </button>
      {value !== fallback && (
        <button type="button" className={btn} onClick={() => onChange(fallback)}>
          Padrão
        </button>
      )}
      {warn && <span className="text-xs text-enemy">{warn}</span>}
    </span>
  )
}

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
  const openTour = useApp((s) => s.openTour)

  const [dirMessage, setDirMessage] = useState<Message>(null)
  const [metaMessage, setMetaMessage] = useState<Message>(null)
  const [urlDraft, setUrlDraft] = useState(settings?.metaUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [checkingApp, setCheckingApp] = useState(false)
  const [tab, setTab] = useState<TabId>('general')
  const [diagMsg, setDiagMsg] = useState<Message>(null)
  const [overlayMsg, setOverlayMsg] = useState<Message>(null)
  const [probe, setProbe] = useState<string[] | null>(null)
  const [backupMsg, setBackupMsg] = useState<Message>(null)
  const reloadProfiles = useApp((s) => s.reloadProfiles)
  const poolDirty = useApp((s) => s.poolDirty)
  const [lastAccept, setLastAccept] = useState<{ ok: boolean; status: number; at: number } | null>(null)
  const account = useApp((s) => s.identity?.account)
  const pickMode = useApp((s) => s.settings?.pickMode ?? 'balanced')
  const setPickMode = useApp((s) => s.setPickMode)

  const region = settings?.metaRegion ?? 'global'
  const regionOptions = [...new Set([...DEFAULT_REGIONS, ...(metaInfo?.regions ?? []), ...(region !== 'global' ? [region] : [])])]

  async function changeRegion(next: string): Promise<void> {
    setMetaMessage(null)
    try {
      await saveSettings({ metaRegion: next })
    } catch {
      setMetaMessage({ ok: false, text: 'Região inválida.' })
      return
    }
    await runUpdate()
  }

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

  async function exportBackup(): Promise<void> {
    try {
      const r = await window.api.exportBackup()
      if (r.ok) setBackupMsg({ ok: true, text: `Backup salvo com ${r.profiles} ${r.profiles === 1 ? 'perfil' : 'perfis'}.` })
      else if (r.reason === 'error') setBackupMsg({ ok: false, text: 'Não consegui salvar o backup.' })
    } catch {
      setBackupMsg({ ok: false, text: 'Não consegui salvar o backup.' })
    }
  }

  async function importBackup(): Promise<void> {
    if (poolDirty && !window.confirm('Há alterações não salvas na Pool. Restaurar o backup agora pode sobrescrevê-las. Continuar?')) return
    try {
      const r = await window.api.importBackup()
      if (r.ok) {
        await reloadProfiles()
        setBackupMsg({ ok: true, text: `Backup restaurado: ${r.added} novos, ${r.updated} atualizados${r.skipped ? `, ${r.skipped} ignorados` : ''}.` })
      } else if (r.reason === 'invalid') setBackupMsg({ ok: false, text: r.message ?? 'Arquivo inválido.' })
    } catch {
      setBackupMsg({ ok: false, text: 'Não consegui restaurar o backup.' })
    }
  }

  async function testOverlay(): Promise<void> {
    try {
      const ok = await window.api.previewOverlay()
      setOverlayMsg(ok ? { ok: true, text: 'O painel aparece por 12 segundos no canto escolhido, com dados de exemplo.' } : { ok: false, text: 'Preciso dos dados de meta reais para a demonstração: atualize os dados em Configurações > Dados.' })
    } catch {
      setOverlayMsg({ ok: false, text: 'Não consegui abrir a demonstração.' })
    }
  }

  async function moveOverlay(): Promise<void> {
    try {
      const ok = await window.api.startOverlayMove()
      setOverlayMsg(
        ok
          ? { ok: true, text: 'Arraste o painel e clique em "Salvar posição". Durante uma partida, use o atalho de mover (Configurações > Partida) para ligar e desligar o modo mover.' }
          : { ok: false, text: 'Preciso dos dados de meta reais para mostrar o painel: atualize os dados em Configurações > Dados.' }
      )
    } catch {
      setOverlayMsg({ ok: false, text: 'Não consegui ligar o modo mover.' })
    }
  }

  async function saveDiagnostics(): Promise<void> {
    try {
      const r = await window.api.saveDiagnostics()
      if (r.ok) setDiagMsg({ ok: true, text: 'Relatório salvo. Envie o arquivo para o Pedro.' })
    } catch {
      setDiagMsg({ ok: false, text: 'Não consegui salvar o relatório.' })
    }
  }

  async function probeClient(): Promise<void> {
    setProbe(['Testando…'])
    try {
      setProbe(await window.api.probeClient())
    } catch {
      setProbe(['Não consegui testar o cliente.'])
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
              <Card title="Tutorial">
                <Row title="Conhecer o app" hint="Um passo a passo rápido pelas telas e botões.">
                  <button type="button" className={btn} onClick={openTour}>
                    Rever tutorial
                  </button>
                </Row>
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
              <Card title="Overlay no jogo">
                <p className="text-sm text-mist">
                  Um painel pequeno sobre o jogo com a próxima habilidade a evoluir e os itens da sua build. Usa a API oficial da partida em andamento (só o que você já vê), não mexe no jogo e o clique atravessa o painel. Aparece com o LoL em <strong>janela ou tela cheia sem bordas</strong>; em tela cheia exclusiva o Windows esconde o painel.
                </p>
                <Row title="Mostrar o overlay durante a partida">
                  <Switch label="Mostrar o overlay durante a partida" checked={settings?.overlayEnabled ?? false} onChange={(v) => void saveSettings({ overlayEnabled: v })} />
                </Row>
                <Row title="Tamanho do painel" hint="Recuado mostra só o próximo item (e a habilidade quando há ponto). Durante a partida, o atalho abaixo alterna.">
                  <select
                    aria-label="Tamanho do overlay"
                    value={settings?.overlayCompact ? 'compact' : 'full'}
                    onChange={(e) => void saveSettings({ overlayCompact: e.target.value === 'compact' })}
                    className="rounded-lg border border-line bg-panel px-2 py-1 text-sm text-snow"
                  >
                    <option value="full">Estendido (build completa)</option>
                    <option value="compact">Recuado (só o próximo item)</option>
                  </select>
                </Row>
                <Row title="Atalho: recuado ⇄ estendido" hint="Funciona com o jogo na frente. Se outro programa (como o painel da AMD) já usa a combinação, troque aqui.">
                  <ShortcutField
                    label="Atalho de tamanho do overlay"
                    value={settings?.overlayKeySize ?? DEFAULT_KEY_SIZE}
                    fallback={DEFAULT_KEY_SIZE}
                    other={settings?.overlayKeyMove ?? DEFAULT_KEY_MOVE}
                    onChange={(acc) => void saveSettings({ overlayKeySize: acc })}
                  />
                </Row>
                <Row title="Atalho: mover o painel" hint="Liga e desliga o modo mover durante a partida (arrastar o painel e soltar).">
                  <ShortcutField
                    label="Atalho de mover o overlay"
                    value={settings?.overlayKeyMove ?? DEFAULT_KEY_MOVE}
                    fallback={DEFAULT_KEY_MOVE}
                    other={settings?.overlayKeySize ?? DEFAULT_KEY_SIZE}
                    onChange={(acc) => void saveSettings({ overlayKeyMove: acc })}
                  />
                </Row>
                <Row title="Canto da tela">
                  <select
                    aria-label="Canto do overlay"
                    value={settings?.overlayCorner ?? 'tr'}
                    onChange={(e) => void saveSettings({ overlayCorner: e.target.value as 'tl' | 'tr' | 'bl' | 'br', overlayPos: null })}
                    className="rounded-lg border border-line bg-panel px-2 py-1 text-sm text-snow"
                  >
                    <option value="tr">Superior direito</option>
                    <option value="tl">Superior esquerdo</option>
                    <option value="br">Inferior direito</option>
                    <option value="bl">Inferior esquerdo</option>
                  </select>
                </Row>
                <Row title="Opacidade">
                  <select
                    aria-label="Opacidade do overlay"
                    value={String(settings?.overlayOpacity ?? 0.9)}
                    onChange={(e) => void saveSettings({ overlayOpacity: Number(e.target.value) })}
                    className="rounded-lg border border-line bg-panel px-2 py-1 text-sm text-snow"
                  >
                    {[1, 0.9, 0.8, 0.7, 0.6, 0.5].map((n) => (
                      <option key={n} value={n}>
                        {Math.round(n * 100)}%
                      </option>
                    ))}
                  </select>
                </Row>
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" className={btn} onClick={() => void testOverlay()}>
                    Testar o overlay
                  </button>
                  <button type="button" className={btn} onClick={() => void moveOverlay()}>
                    Mover o overlay
                  </button>
                  {settings?.overlayPos && (
                    <button type="button" className={btn} onClick={() => void saveSettings({ overlayPos: null })}>
                      Voltar ao canto
                    </button>
                  )}
                </div>
                {overlayMsg && (
                  <p role="status" className={`mt-2 text-sm ${overlayMsg.ok ? 'text-ally' : 'text-mist'}`}>
                    {overlayMsg.text}
                  </p>
                )}
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

                <Row title="Região dos dados" hint="Global junta todas as regiões coletadas (mais partidas, mais precisão). As outras usam só aquele servidor.">
                  <select
                    aria-label="Região dos dados"
                    value={region}
                    disabled={busy}
                    onChange={(e) => void changeRegion(e.target.value)}
                    className="rounded-lg border border-line bg-panel px-2 py-1 text-sm text-snow"
                  >
                    <option value="global">Global</option>
                    {regionOptions.map((r) => (
                      <option key={r} value={r}>
                        {REGION_NAMES[r] ?? r.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </Row>

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
              <Card title="Backup dos perfis">
                <p className="text-sm text-mist">
                  Salve todos os perfis e Pools em um arquivo para guardar ou levar a outro PC. Ao restaurar, perfis com o mesmo código são atualizados e os novos são adicionados; nada é apagado.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" className={btn} onClick={() => void exportBackup()}>
                    Salvar backup
                  </button>
                  <button type="button" className={btn} onClick={() => void importBackup()}>
                    Restaurar backup
                  </button>
                </div>
                {backupMsg && (
                  <p role="status" className={`mt-2 text-sm ${backupMsg.ok ? 'text-ally' : 'text-enemy'}`}>
                    {backupMsg.text}
                  </p>
                )}
              </Card>
              <Card title="Diagnóstico">
                <p className="text-sm text-mist">
                  Se algo não funcionar (o aceite automático, por exemplo), copie o relatório e mande para o Pedro. Ele não tem senha, nome de conta nem dados pessoais. O autoteste só lê do cliente e mostra, recurso por recurso, o que responde (itens com "--" só existem em certas fases, como dentro da seleção de campeões ou da partida).
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" className={btn} onClick={() => void copyDiagnostics()}>
                    Copiar relatório de diagnóstico
                  </button>
                  <button type="button" className={btn} onClick={() => void saveDiagnostics()}>
                    Salvar em arquivo
                  </button>
                  <button type="button" className={btn} onClick={() => void probeClient()}>
                    Autoteste do cliente
                  </button>
                </div>
                {probe && (
                  <ul aria-label="Resultado do teste" className="mt-2 space-y-0.5 font-mono text-xs text-mist">
                    {probe.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
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
