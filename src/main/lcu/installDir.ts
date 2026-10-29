// src/main/lcu/installDir.ts
// Valida a pasta que o usuário escolheu na tela de configurações.
// O 'lockfile' só existe com o cliente aberto, então reconhecemos a instalação
// pelos executáveis do cliente (ou pelo próprio lockfile, se já estiver aberto).
import { promises as fs } from 'node:fs'
import path from 'node:path'

const MARKERS = ['LeagueClient.exe', 'LeagueClientUx.exe', 'lockfile']

/**
 * Aceita a pasta do LoL ou uma pasta acima dela (ex.: "C:\Riot Games").
 * Retorna a pasta correta da instalação, ou null se não parecer o LoL.
 */
export async function resolveInstallDir(dir: string): Promise<string | null> {
  const candidates = [dir, path.join(dir, 'League of Legends'), path.join(dir, 'Riot Games', 'League of Legends')]
  for (const candidate of candidates) {
    for (const marker of MARKERS) {
      try {
        await fs.access(path.join(candidate, marker))
        return candidate
      } catch {
        /* próximo marcador */
      }
    }
  }
  return null
}
