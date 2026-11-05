// src/main/overlay/foreground.ts
// Descobre qual programa está em primeiro plano, para o overlay só aparecer com o LoL na frente.
// Um único PowerShell leve fica rodando e imprime o nome do processo da janela ativa (só no Windows, sem módulo nativo).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** Processo da partida (o cliente é "LeagueClient"; a partida é "League of Legends"). */
export function isGameProcess(name: string): boolean {
  return /^league of legends$/i.test(name.trim())
}

export const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PggFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
}
"@
$last = -1; $name = ''
while ($true) {
  $p = 0
  [void][PggFg]::GetWindowThreadProcessId([PggFg]::GetForegroundWindow(), [ref]$p)
  if ($p -ne $last) {
    $last = $p
    $name = ''
    try { $name = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {}
  }
  [Console]::Out.WriteLine($name)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 600
}
`

type Spawn = (cmd: string, args: string[]) => ChildProcessWithoutNullStreams

/**
 * Observa a janela em primeiro plano. `onChange(name)` recebe o nome do processo sempre que muda;
 * `onChange(null)` significa "não consegui observar" (aí o overlay volta a aparecer sempre, como antes).
 */
export class ForegroundWatcher {
  private child: ChildProcessWithoutNullStreams | null = null
  private last: string | null | undefined
  private buf = ''

  constructor(
    private readonly onChange: (name: string | null) => void,
    private readonly platform: string = process.platform,
    private readonly spawnFn: Spawn = (cmd, args) => spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  ) {}

  get running(): boolean {
    return this.child !== null
  }

  start(): void {
    if (this.child) return
    if (this.platform !== 'win32') return this.emit(null)
    try {
      const child = this.spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')])
      this.child = child
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => this.feed(chunk))
      child.stderr.on('data', () => undefined)
      child.on('error', () => this.fail(child))
      child.on('exit', () => this.fail(child))
      child.stdin.on('error', () => undefined)
      child.stdin.end()
    } catch {
      this.child = null
      this.emit(null)
    }
  }

  stop(): void {
    const c = this.child
    this.child = null
    this.last = undefined
    this.buf = ''
    if (c && !c.killed) c.kill()
  }

  /** exposto para teste */
  feed(chunk: string): void {
    this.buf += chunk
    const lines = this.buf.split(/\r?\n/)
    this.buf = lines.pop() ?? ''
    for (const line of lines) this.emit(line.trim())
  }

  private fail(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return // já parado de propósito
    this.child = null
    this.emit(null)
  }

  private emit(name: string | null): void {
    if (name === this.last) return
    this.last = name
    this.onChange(name)
  }
}
