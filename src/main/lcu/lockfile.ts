// src/main/lcu/lockfile.ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

export interface LockfileData {
  processName: string
  pid: number
  port: number
  password: string
  protocol: string
}

const LOCKFILE_NAME = 'lockfile'
const PROCESS_PROBE_INTERVAL_MS = 15_000

/** Formato: processo:pid:porta:senha:protocolo */
export function parseLockfile(content: string): LockfileData {
  const parts = content.trim().split(':')
  if (parts.length < 5) throw new Error('Formato de lockfile inválido')

  const processName = parts[0]
  const pid = Number(parts[1])
  const port = Number(parts[2])
  const protocol = parts[parts.length - 1]
  // Defensivo: se a senha algum dia contiver ":", junta o miolo.
  const password = parts.slice(3, -1).join(':')

  if (!Number.isInteger(pid) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Lockfile com pid/porta inválidos')
  }
  if (!password || !protocol) throw new Error('Lockfile incompleto')

  return { processName, pid, port, password, protocol }
}

export async function readLockfile(filePath: string): Promise<LockfileData> {
  // O arquivo é recriado a cada abertura do cliente (porta e senha mudam),
  // então sempre relemos em vez de cachear o conteúdo.
  return parseLockfile(await fs.readFile(filePath, 'utf8'))
}

function toLockfilePath(p: string): string {
  return path.basename(p).toLowerCase() === LOCKFILE_NAME ? p : path.join(p, LOCKFILE_NAME)
}

function defaultCandidates(): string[] {
  if (process.platform === 'win32') {
    return ['C', 'D', 'E', 'F', 'G'].flatMap((d) => [
      `${d}:\\Riot Games\\League of Legends`,
      `${d}:\\Program Files\\Riot Games\\League of Legends`,
      `${d}:\\Program Files (x86)\\Riot Games\\League of Legends`,
      `${d}:\\Games\\Riot Games\\League of Legends`
    ])
  }
  if (process.platform === 'darwin') {
    return ['/Applications/League of Legends.app/Contents/LoL']
  }
  return []
}

/**
 * Instalação em pasta não padrão: o LeagueClientUx recebe --install-directory
 * na linha de comando. Só usamos para descobrir a PASTA; a autenticação continua
 * vindo do lockfile.
 */
function installDirFromProcess(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'LeagueClientUx.exe' } | Select-Object -ExpandProperty CommandLine"
      ],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(null)
        const m = stdout.match(/--install-directory=(?:"([^"]+)"|(\S+))/)
        resolve(m ? (m[1] ?? m[2] ?? null) : null)
      }
    )
  })
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

let cachedPath: string | null = null
let lastProcessProbe = 0

/**
 * Ordem: caminho configurado pelo usuário → último encontrado → pastas padrão
 * → pasta descoberta pelo processo (limitado a 1 consulta a cada 15 s).
 * Aceita tanto a pasta quanto o caminho completo do arquivo 'lockfile'.
 */
export async function findLockfilePath(override?: string | null): Promise<string | null> {
  const quick = [
    override ? toLockfilePath(override) : null,
    cachedPath,
    ...defaultCandidates().map(toLockfilePath)
  ]
  const seen = new Set<string>()
  for (const p of quick) {
    if (!p || seen.has(p)) continue
    seen.add(p)
    if (await exists(p)) {
      cachedPath = p
      return p
    }
  }

  if (Date.now() - lastProcessProbe > PROCESS_PROBE_INTERVAL_MS) {
    lastProcessProbe = Date.now()
    const dir = await installDirFromProcess()
    if (dir) {
      const p = toLockfilePath(dir)
      if (await exists(p)) {
        cachedPath = p
        return p
      }
    }
  }
  return null
}
