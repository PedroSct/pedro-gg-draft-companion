import { describe, expect, it } from 'vitest'
import { acceleratorFromEvent, DEFAULT_KEY_MOVE, DEFAULT_KEY_SIZE, formatAccelerator, sanitizeAccelerator } from '../src/shared/shortcuts'
import { sanitizeSettingsPatch } from '../src/main/store/profiles'

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}, code?: string) => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
})

describe('atalhos do overlay', () => {
  it('os padrões não usam Ctrl+Shift+letra (o painel da AMD usa O e E) e são diferentes entre si', () => {
    expect(DEFAULT_KEY_SIZE).toBe('CommandOrControl+Shift+F9')
    expect(DEFAULT_KEY_MOVE).toBe('CommandOrControl+Shift+F10')
    expect(DEFAULT_KEY_SIZE).not.toBe(DEFAULT_KEY_MOVE)
    expect(formatAccelerator(DEFAULT_KEY_SIZE)).toBe('Ctrl+Shift+F9')
  })

  it('monta a combinação a partir das teclas apertadas', () => {
    expect(acceleratorFromEvent(ev('F9', { ctrlKey: true, shiftKey: true }))).toBe('CommandOrControl+Shift+F9')
    expect(acceleratorFromEvent(ev('K', { altKey: true, ctrlKey: true }, 'KeyK'))).toBe('CommandOrControl+Alt+K')
    expect(acceleratorFromEvent(ev('º', { ctrlKey: true }, 'Digit5'))).toBe('CommandOrControl+5')
  })

  it('espera a tecla e exige um modificador', () => {
    expect(acceleratorFromEvent(ev('Control', { ctrlKey: true }))).toBeNull() // só o modificador
    expect(acceleratorFromEvent(ev('F9'))).toBeNull() // sem modificador
    expect(acceleratorFromEvent(ev('Enter', { ctrlKey: true }))).toBeNull() // tecla não aceita
  })

  it('valida e normaliza o que vem das configurações', () => {
    expect(sanitizeAccelerator('Shift+CommandOrControl+F5', 'x')).toBe('CommandOrControl+Shift+F5')
    expect(sanitizeAccelerator('F9', 'x')).toBe('x')
    expect(sanitizeAccelerator('Ctrl+F9', 'x')).toBe('x') // só o nome do Electron
    expect(sanitizeAccelerator('CommandOrControl+Shift+Enter', 'x')).toBe('x')
    expect(sanitizeAccelerator('CommandOrControl+CommandOrControl+F9', 'x')).toBe('x')
    expect(sanitizeAccelerator(42, 'x')).toBe('x')
    expect(sanitizeSettingsPatch({ overlayKeyMove: 'Alt+Shift+F5' }).overlayKeyMove).toBe('Alt+Shift+F5')
    expect(() => sanitizeSettingsPatch({ overlayKeySize: 'qualquer coisa' })).toThrow()
  })
})
