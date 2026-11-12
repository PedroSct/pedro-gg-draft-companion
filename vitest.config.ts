import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    // Cada arquivo de teste abre um ambiente jsdom. Em PCs mais lentos, dezenas deles ao mesmo tempo estouravam o limite de
    // 90 s para iniciar o processo ("Timeout waiting for worker to respond") e arquivos inteiros deixavam de rodar.
    // Poucos processos por vez são tão rápidos quanto, e confiáveis. No GitHub (CI) deixa o padrão.
    maxWorkers: process.env.CI ? undefined : 3
  }
})
