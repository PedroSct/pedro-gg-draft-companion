// src/shared/shortcuts.ts
// Atalhos globais do overlay (mover e recuar/estender). Formato do Electron: "CommandOrControl+Shift+F9".
// Os padrões usam F9/F10 porque Ctrl+Shift+letra costuma ser tomado por outros programas (o painel da AMD usa Ctrl+Shift+O/E).

export const DEFAULT_KEY_SIZE = 'CommandOrControl+Shift+F9'
export const DEFAULT_KEY_MOVE = 'CommandOrControl+Shift+F10'

const MODS = ['CommandOrControl', 'Alt', 'Shift'] as const
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4]))$/

/** Aceita só "modificadores + uma tecla" (letra, número ou F1-F24), com ao menos um modificador. Senão devolve o padrão. */
export function sanitizeAccelerator(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const parts = raw.split('+')
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  if (!KEY.test(key) || mods.length === 0) return fallback
  if (!mods.every((m) => (MODS as readonly string[]).includes(m)) || new Set(mods).size !== mods.length) return fallback
  // ordem fixa, para comparar e mostrar sempre igual
  return [...MODS.filter((m) => mods.includes(m)), key].join('+')
}

export interface KeyEventLike {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey?: boolean
}

/** Converte o que a pessoa apertou no formato do Electron; null se ainda faltar a tecla ou o modificador. */
export function acceleratorFromEvent(e: KeyEventLike): string | null {
  let key: string | null = null
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) key = e.key
  else if (e.code && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (e.code && /^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (/^[a-zA-Z0-9]$/.test(e.key)) key = e.key.toUpperCase()
  if (!key) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('CommandOrControl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (mods.length === 0) return null
  return [...mods, key].join('+')
}

/** "CommandOrControl+Shift+F9" -> "Ctrl+Shift+F9" (para mostrar). */
export function formatAccelerator(acc: string): string {
  return acc.replace('CommandOrControl', 'Ctrl')
}
