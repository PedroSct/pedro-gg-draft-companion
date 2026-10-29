// src/main/store/share.ts
// Código de compartilhamento ("PGG1:...") e arquivo (.json) de uma Pool.
// O código é o JSON compacto comprimido (deflate) em base64url: cabe numa mensagem de Discord/WhatsApp.
// Tudo que entra é tratado como não confiável: tamanhos limitados e conteúdo revalidado.
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { ROLES } from '../../shared/dataTypes'
import type { DecodeResult, ShareOptions, SharedProfile } from '../../shared/poolShare'
import { sanitizeShared } from './profiles'

export const SHARE_PREFIX = 'PGG1:'
const MAX_TEXT_CHARS = 400_000
const MAX_INFLATED_BYTES = 2 * 1024 * 1024
const TOKEN_RE = /PGG1:([A-Za-z0-9_-]{8,})/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Remove o que não deve viajar. Recebe qualquer coisa parecida com um perfil (o renderer não é confiável). */
function normalize(profile: unknown, opts: ShareOptions): SharedProfile {
  const s = sanitizeShared(profile)
  if (!opts.includeNotes) {
    delete s.notes
    for (const r of ROLES) s.pool[r] = s.pool[r].map(({ notes: _n, ...rest }) => rest)
  }
  return s
}

/** Formato compacto: tuplas [id, chave, conforto, anotação?] por rota. */
function compact(s: SharedProfile): unknown {
  const p: Record<string, unknown[]> = {}
  for (const r of ROLES) {
    if (!s.pool[r].length) continue
    p[r] = s.pool[r].map((e) => (e.notes ? [e.championId, e.championKey, e.comfort, e.notes] : [e.championId, e.championKey, e.comfort]))
  }
  return { v: 1, n: s.nickname, ...(s.riotId ? { r: s.riotId } : {}), m: s.mainRoles, ...(s.notes ? { o: s.notes } : {}), p }
}

function expand(raw: unknown): unknown {
  if (!isRecord(raw) || raw.v !== 1 || !isRecord(raw.p)) throw new Error('versão de código desconhecida')
  const pool: Record<string, unknown[]> = {}
  for (const r of ROLES) {
    const list = raw.p[r]
    if (!Array.isArray(list)) continue
    pool[r] = list.map((t) =>
      Array.isArray(t) ? { championId: t[0], championKey: t[1], comfort: t[2], notes: t[3] } : null
    )
  }
  return { nickname: raw.n, riotId: raw.r, mainRoles: raw.m, notes: raw.o, pool }
}

export function encodeShare(profile: unknown, opts: ShareOptions): string {
  const json = JSON.stringify(compact(normalize(profile, opts)))
  return SHARE_PREFIX + deflateRawSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64url')
}

/** Conteúdo do arquivo .json (legível, para quem prefere mandar um arquivo). */
export function toFileJson(profile: unknown, opts: ShareOptions): string {
  const s = normalize(profile, opts)
  return JSON.stringify({ app: 'pedro.gg', type: 'pool', version: 1, ...s }, null, 2)
}

/** Aceita o código puro, uma mensagem que contém o código, ou o conteúdo de um arquivo exportado. */
export function decodeShare(text: unknown): DecodeResult {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, message: 'Cole o código ou escolha um arquivo.' }
  if (text.length > MAX_TEXT_CHARS) return { ok: false, message: 'Esse conteúdo é grande demais para ser uma Pool.' }

  try {
    const token = text.match(TOKEN_RE)
    if (token) {
      const json = inflateRawSync(Buffer.from(token[1], 'base64url'), { maxOutputLength: MAX_INFLATED_BYTES }).toString('utf8')
      return { ok: true, shared: sanitizeShared(expand(JSON.parse(json))) }
    }
    const trimmed = text.trim()
    if (trimmed.startsWith('{')) {
      const raw: unknown = JSON.parse(trimmed)
      if (isRecord(raw) && raw.type === 'pool' && isRecord(raw.pool)) return { ok: true, shared: sanitizeShared(raw) }
    }
  } catch {
    return { ok: false, message: 'O código parece estar incompleto ou corrompido. Peça para o amigo copiar de novo.' }
  }
  return { ok: false, message: 'Não reconheci isso como uma Pool do Pedro.gg.' }
}
