// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { MetaStore, MetaUpdateError } from '../src/main/data/meta'
import { sanitizeSettingsPatch } from '../src/main/store/profiles'

const SAMPLE = join(process.cwd(), 'resources', 'meta.sample.json')
const URL_OK = 'https://example.test/meta.json'

const dataset = (generatedAt: string, extra: object = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    source: 'Riot Match-v5, 100 partidas',
    patch: '16.20',
    generatedAt,
    champions: { '103': { roles: { MIDDLE: { games: 50, wins: 27, matchups: {} } } } },
    ...extra
  })

const reply = (body: string, init: ResponseInit = {}): Response => new Response(body, { status: 200, ...init })

describe('atualização do meta pela internet', () => {
  let userFile: string
  let store: MetaStore

  beforeEach(async () => {
    userFile = join(mkdtempSync(join(tmpdir(), 'upd-')), 'meta', 'meta.json')
    store = new MetaStore(userFile, SAMPLE)
    await store.load()
  })

  it('baixa, valida, grava e passa a usar o dataset novo', async () => {
    expect(store.info()?.isSample).toBe(true)
    const r = await store.updateFromUrl(URL_OK, (async () => reply(dataset('2026-10-27T10:00:00Z'), { headers: { etag: 'W/"v1"' } })) as unknown as typeof fetch)
    expect(r.changed).toBe(true)
    expect(r.info).toMatchObject({ isSample: false, patch: '16.20', champions: 1 })

    const reloaded = new MetaStore(userFile, SAMPLE) // reabrir o app: o arquivo do usuário vence a amostra
    await reloaded.load()
    expect(reloaded.info()?.isSample).toBe(false)
  })

  it('pergunta ao servidor se mudou (ETag) e aceita o 304', async () => {
    await store.updateFromUrl(URL_OK, (async () => reply(dataset('2026-10-27T10:00:00Z'), { headers: { etag: 'W/"v1"' } })) as unknown as typeof fetch)
    let sent: string | null = null
    const r = await store.updateFromUrl(URL_OK, (async (_u: unknown, init?: RequestInit) => {
      sent = new Headers(init?.headers).get('if-none-match')
      return new Response(null, { status: 304 })
    }) as unknown as typeof fetch)
    expect(sent).toBe('W/"v1"')
    expect(r.changed).toBe(false)
  })

  it('detecta versão repetida e versão nova pelo conteúdo, mesmo sem ETag', async () => {
    const same = (async () => reply(dataset('2026-10-27T10:00:00Z'))) as unknown as typeof fetch
    expect((await store.updateFromUrl(URL_OK, same)).changed).toBe(true)
    expect((await store.updateFromUrl(URL_OK, same)).changed).toBe(false)
    expect((await store.updateFromUrl(URL_OK, (async () => reply(dataset('2026-10-28T10:00:00Z'))) as unknown as typeof fetch)).changed).toBe(true)
  })

  it('arquivo inválido nunca substitui o que já funciona', async () => {
    await store.updateFromUrl(URL_OK, (async () => reply(dataset('2026-10-27T10:00:00Z'))) as unknown as typeof fetch)
    const bad = JSON.stringify({ schemaVersion: 1, patch: '16.21', champions: { '1': { roles: { TOP: { games: 3, wins: 9 } } } } })
    const err = await store.updateFromUrl(URL_OK, (async () => reply(bad)) as unknown as typeof fetch).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MetaUpdateError)
    expect((err as MetaUpdateError).kind).toBe('invalid')
    expect(store.info()?.patch).toBe('16.20')

    const html = await store.updateFromUrl(URL_OK, (async () => reply('<html>404</html>')) as unknown as typeof fetch).catch((e: unknown) => e)
    expect((html as MetaUpdateError).kind).toBe('invalid')
  })

  it('recusa endereços sem https e erros de rede viram "network"', async () => {
    const never = (async () => {
      throw new Error('não deveria chamar')
    }) as unknown as typeof fetch
    for (const url of ['http://example.test/meta.json', 'ftp://x/meta.json', 'isso não é url']) {
      const e = await store.updateFromUrl(url, never).catch((x: unknown) => x)
      expect((e as MetaUpdateError).kind).toBe('invalid')
    }
    const offline = await store.updateFromUrl(URL_OK, (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch).catch((x: unknown) => x)
    expect((offline as MetaUpdateError).kind).toBe('network')
    const down = await store.updateFromUrl(URL_OK, (async () => new Response('', { status: 503 })) as unknown as typeof fetch).catch((x: unknown) => x)
    expect((down as MetaUpdateError).kind).toBe('network')
    expect(store.info()?.isSample).toBe(true) // continua com o que tinha
  })

  it('recusa arquivo declarado como gigante antes de baixar', async () => {
    const huge = (async () => reply('{}', { headers: { 'content-length': String(500 * 1024 * 1024) } })) as unknown as typeof fetch
    const e = await store.updateFromUrl(URL_OK, huge).catch((x: unknown) => x)
    expect((e as MetaUpdateError).kind).toBe('invalid')
  })
})

describe('configuração do endereço', () => {
  it('só aceita https e permite limpar', () => {
    expect(sanitizeSettingsPatch({ metaUrl: URL_OK })).toEqual({ metaUrl: URL_OK })
    expect(sanitizeSettingsPatch({ metaUrl: '  ' + URL_OK + ' ' })).toEqual({ metaUrl: URL_OK })
    expect(sanitizeSettingsPatch({ metaUrl: '' })).toEqual({ metaUrl: null })
    expect(sanitizeSettingsPatch({ metaUrl: null })).toEqual({ metaUrl: null })
    expect(() => sanitizeSettingsPatch({ metaUrl: 'http://example.test/meta.json' })).toThrow(/https/)
    expect(() => sanitizeSettingsPatch({ metaUrl: 'javascript:alert(1)' })).toThrow()
    expect(sanitizeSettingsPatch({ metaAutoUpdate: false })).toEqual({ metaAutoUpdate: false })
    expect(() => sanitizeSettingsPatch({ metaAutoUpdate: 'sim' })).toThrow()
  })
})
