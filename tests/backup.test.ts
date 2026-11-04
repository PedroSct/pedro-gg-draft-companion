// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeBackup, parseBackup } from '../src/main/store/backup'
import { ProfileStore } from '../src/main/store/profiles'

const dirs: string[] = []
async function store(): Promise<ProfileStore> {
  const d = await mkdtemp(path.join(tmpdir(), 'pgg-'))
  dirs.push(d)
  const s = new ProfileStore(path.join(d, 'profiles.json'))
  await s.load()
  return s
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const pool = { TOP: [], JUNGLE: [], MIDDLE: [{ championId: 103, championKey: 'Ahri', comfort: 5 }], BOTTOM: [], UTILITY: [] }

describe('backup dos perfis', () => {
  it('exporta e restaura em outro PC mantendo ids, Pool e preferências', async () => {
    const a = await store()
    const p = await a.upsert({ nickname: 'Pedro', riotId: 'Pedro#BR1', mainRoles: ['MIDDLE'], pool })
    await a.updateSettings({ pickMode: 'meta', metaRegion: 'br1' })
    const text = makeBackup(a.list(), a.getSettings(), '0.6.0')

    const b = await store()
    const parsed = parseBackup(text)
    const r = await b.restore(parsed.profiles, parsed.settings)
    expect(r).toEqual({ added: 1, updated: 0, skipped: 0 })
    expect(b.get(p.id)?.pool.MIDDLE[0].championKey).toBe('Ahri')
    expect(b.getSettings()).toMatchObject({ pickMode: 'meta', metaRegion: 'br1' })
    expect(b.getSettings().lastActiveProfileId).toBe(p.id)
  })

  it('não leva pastas nem endereços do PC antigo', async () => {
    const a = await store()
    await a.updateSettings({ metaUrl: 'https://exemplo.com/meta.json' })
    const text = makeBackup(a.list(), a.getSettings(), '0.6.0')
    expect(text).not.toContain('exemplo.com')
    expect(text).not.toContain('lockfilePath')
  })

  it('restaurar duas vezes atualiza em vez de duplicar e nunca apaga perfis existentes', async () => {
    const a = await store()
    await a.upsert({ nickname: 'Pedro', pool })
    const text = makeBackup(a.list(), a.getSettings(), '0.6.0')
    const b = await store()
    const extra = await b.upsert({ nickname: 'Amigo', pool })
    await b.restore(parseBackup(text).profiles)
    expect(await b.restore(parseBackup(text).profiles)).toEqual({ added: 0, updated: 1, skipped: 0 })
    expect(b.list().map((p) => p.nickname).sort()).toEqual(['Amigo', 'Pedro'])
    expect(b.get(extra.id)).toBeDefined()
  })

  it('rejeita arquivo que não é backup e ignora perfil ilegível', async () => {
    expect(() => parseBackup('lixo')).toThrow(/não é um backup/)
    expect(() => parseBackup(JSON.stringify({ kind: 'outra-coisa' }))).toThrow(/não é um backup/)
    expect(() => parseBackup(JSON.stringify({ kind: 'pedro.gg-backup', version: 2, profiles: [] }))).toThrow(/versão/)
    const s = await store()
    const parsed = parseBackup(JSON.stringify({ kind: 'pedro.gg-backup', version: 1, profiles: [{ nickname: '' }, 42, { nickname: 'Ok', pool }] }))
    expect(await s.restore(parsed.profiles)).toEqual({ added: 1, updated: 0, skipped: 2 })
  })
})
