import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

// CSP só no build: o servidor de desenvolvimento precisa de scripts inline (HMR do React).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://ddragon.leagueoflegends.com",
  "font-src 'self' data:",
  "connect-src 'self'"
].join('; ')

function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    transformIndexHtml(html, ctx) {
      const tag = ctx.server ? '' : `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`
      return html.replace('<!--CSP-->', tag)
    }
  }
}

export default defineConfig({
  main: {
    // No GitHub Actions o repositório vem sozinho; localmente vale DEFAULT_UPDATE_REPO (shared/config.ts).
    define: { __UPDATE_REPO__: JSON.stringify(process.env['GITHUB_REPOSITORY'] ?? '') }
  },
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss(), cspMeta()],
    resolve: { alias: { '@': resolve('src/renderer/src') } }
  }
})
