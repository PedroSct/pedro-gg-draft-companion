import { useEffect, useState } from 'react'
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

  const generated = metaInfo ? formatDate(metaInfo.generatedAt) : null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-night/80 p-6 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label="Configurações" className="w-full max-w-xl border border-line bg-deck">
        <div className="flex items-center border-b border-line px-5 py-3">
          <h2 className="font-display text-xl font-semibold">Configurações</h2>
          <button type="button" className={`${btn} ml-auto`} onClick={close}>
            Fechar
          </button>
        </div>

        <div className="flex flex-col gap-6 p-5">
          <section>
            <h3 className="font-display text-lg font-semibold">Pasta do League of Legends</h3>
            <p className="mt-1 text-sm text-mist">{STATUS_TEXT[status]}</p>
            <p className="mt-2 break-all border border-line bg-night px-3 py-2 text-sm">
              {settings?.lockfilePath ?? 'Detecção automática'}
            </p>
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
          </section>

          <section>
            <h3 className="font-display text-lg font-semibold">Dados de meta</h3>
            {metaInfo ? (
              <p className="mt-1 text-sm text-mist">
                {metaInfo.isSample ? 'Dados de amostra (não refletem o meta real). ' : `Fonte: ${metaInfo.source}. `}
                Patch {metaInfo.patch}, {metaInfo.champions} campeões
                {generated && !metaInfo.isSample ? `, gerado em ${generated}` : ''}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-mist">Nenhum dado de meta carregado.</p>
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
              <label className="ml-auto flex items-center gap-2 text-sm text-mist">
                <input
                  type="checkbox"
                  checked={settings?.metaAutoUpdate ?? true}
                  onChange={(e) => void saveSettings({ metaAutoUpdate: e.target.checked })}
                  className="h-4 w-4 accent-[var(--color-gold)]"
                />
                Atualizar ao abrir o app
              </label>
            </div>
            {metaMessage && (
              <p role="status" className={`mt-2 text-sm ${metaMessage.ok ? 'text-ally' : 'text-enemy'}`}>
                {metaMessage.text}
              </p>
            )}
          </section>

          <section>
            <h3 className="font-display text-lg font-semibold">Aceitar partida</h3>
            <p className="mt-1 text-sm text-mist">
              Quando a partida é encontrada, o app aceita por você pelo próprio cliente do LoL: não lê a tela e não mexe no
              mouse, então funciona com o cliente minimizado ou em outro monitor. Se você aceitar ou recusar antes, ele não
              faz nada.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings?.autoAccept ?? false}
                  onChange={(e) => void saveSettings({ autoAccept: e.target.checked })}
                  className="h-4 w-4 accent-[var(--color-gold)]"
                />
                Aceitar partida automaticamente
              </label>
              <label className="flex items-center gap-2 text-sm text-mist">
                Esperar
                <select
                  aria-label="Espera antes de aceitar"
                  value={settings?.autoAcceptDelay ?? 1}
                  onChange={(e) => void saveSettings({ autoAcceptDelay: Number(e.target.value) })}
                  className="rounded-sm border border-line bg-panel px-2 py-1 text-ink"
                >
                  {[0, 1, 2, 3, 5, 8].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'nada (na hora)' : `${n} s`}
                    </option>
                  ))}
                </select>
                antes de aceitar
              </label>
            </div>
          </section>

          <section>
            <h3 className="font-display text-lg font-semibold">Atualização do app</h3>
            <p className="mt-1 text-sm text-mist">Versão instalada: {update?.current ?? '…'}</p>
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
          </section>

          <section>
            <h3 className="font-display text-lg font-semibold">Ícones e dados do jogo</h3>
            <p className="mt-1 text-sm text-mist">
              {catalog
                ? `Versão ${catalog.version}. Acompanha o patch do seu cliente automaticamente.`
                : 'Ainda não carregados. Conecte à internet uma vez para o app guardar uma cópia.'}
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
