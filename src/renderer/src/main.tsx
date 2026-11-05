import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import '@fontsource-variable/inter'
import './styles.css'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// A mesma página também é o painel dentro do jogo (janela própria, aberta com #overlay).
const Overlay = lazy(() => import('./components/Overlay'))
const isOverlay = window.location.hash === '#overlay'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {isOverlay ? (
      <Suspense fallback={null}>
        <Overlay />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
)
