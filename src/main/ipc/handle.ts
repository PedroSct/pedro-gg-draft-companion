// src/main/ipc/handle.ts
// Pequenos auxiliares comuns aos registradores de IPC.
import { ipcMain } from 'electron'

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.removeHandler(channel) // evita "handler já registrado" se a janela for recriada (macOS)
  ipcMain.handle(channel, (_event: unknown, ...args: unknown[]) => fn(...args))
}
