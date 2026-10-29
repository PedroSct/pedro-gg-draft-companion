import { useEffect, useState } from 'react'
import { useApp } from './store/useApp'
import { Header } from './components/Header'
import { TeamColumn } from './components/TeamColumn'
import { BansBar } from './components/BansBar'
import { PickSuggestion } from './components/PickSuggestion'
import { BuildPanel } from './components/BuildPanel'
import { IdleScreen } from './components/IdleScreen'
import { PoolEditor } from './components/PoolEditor'
import { SettingsDialog } from './components/SettingsDialog'
import { UpdateBanner } from './components/UpdateBanner'
import { btn } from './lib/ui'

function Banners() {
  const metaInfo = useApp((s) => s.metaInfo)
  const catalogError = useApp((s) => s.catalogError)
  const loadCatalog = useApp((s) => s.loadCatalog)
  const openSettings = useApp((s) => s.openSettings)

  return (
    <>
      {catalogError && (
        <div role="alert" className="flex items-center gap-3 border-b border-enemy/40 bg-enemy/10 px-5 py-2 text-sm">
          <span>{catalogError}</span>
          <button type="button" className={btn} onClick={() => void loadCatalog()}>
            Tentar de novo
          </button>
        </div>
      )}
      {metaInfo?.isSample && (
        <div className="flex items-center gap-3 border-b border-gold/30 bg-gold/10 px-5 py-2 text-sm text-gold">
          <span>As sugestões usam dados de amostra, que não refletem o meta real.</span>
          <button type="button" className="underline underline-offset-4 hover:text-snow" onClick={openSettings}>
            Importar dados reais
          </button>
        </div>
      )}
    </>
  )
}

function DraftScreen() {
  const draft = useApp((s) => s.draft)
  if (!draft) return null

  return (
    <div className="grid h-full grid-cols-[minmax(250px,1fr)_minmax(440px,1.7fr)_minmax(250px,1fr)] gap-5">
      <TeamColumn side="ally" players={draft.allies} localCellId={draft.localPlayerCellId} />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <BansBar allies={draft.bans.allies} enemies={draft.bans.enemies} />
        <PickSuggestion />
        <BuildPanel />
      </div>
      <TeamColumn side="enemy" players={draft.enemies} localCellId={-1} />
    </div>
  )
}

export default function App() {
  const init = useApp((s) => s.init)
  const ready = useApp((s) => s.ready)
  const draft = useApp((s) => s.draft)
  const poolOpen = useApp((s) => s.poolOpen)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    let off: (() => void) | undefined
    let cancelled = false
    init()
      .then((unsubscribe) => {
        if (cancelled) unsubscribe()
        else off = unsubscribe
      })
      .catch(() => setFatal('Não foi possível iniciar o app. Feche e abra de novo.'))
    return () => {
      cancelled = true
      off?.()
    }
  }, [init])

  if (fatal) {
    return (
      <div role="alert" className="grid h-full place-items-center text-enemy">
        {fatal}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Header />
      <UpdateBanner />
      <Banners />
      <main className="min-h-0 flex-1 p-5">{!ready ? null : draft ? <DraftScreen /> : <IdleScreen />}</main>
      {poolOpen && <PoolEditor />}
      {settingsOpen && <SettingsDialog />}
    </div>
  )
}
