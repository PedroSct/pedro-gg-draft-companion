import { describe, expect, it } from 'vitest'
import { annotateDraft, findProfileFor, normRiotId } from '../src/shared/identity'
import type { FriendProfile } from '../src/shared/dataTypes'
import type { DraftState } from '../src/shared/types'
import { sanitizeProfile } from '../src/main/store/profiles'

const emptyPool = { TOP: [], JUNGLE: [], MIDDLE: [], BOTTOM: [], UTILITY: [] }
const prof = (id: string, nickname: string, riotId?: string, puuid?: string): FriendProfile => ({
  id,
  nickname,
  riotId,
  puuid,
  mainRoles: [],
  pool: emptyPool,
  createdAt: '',
  updatedAt: ''
})

const draft = (allies: DraftState['allies']): DraftState => ({
  phase: 'BAN_PICK',
  localPlayerCellId: 0,
  localRole: 'UTILITY',
  allies,
  enemies: [],
  bans: { allies: [], enemies: [] }
})
const ally = (cellId: number, extra: Partial<DraftState['allies'][number]> = {}): DraftState['allies'][number] => ({
  cellId,
  championId: 0,
  status: 'none',
  role: null,
  ...extra
})

describe('identidade e amigos na seleção', () => {
  it('compara Riot IDs ignorando maiúsculas e espaços', () => {
    expect(normRiotId(' Pedro #BR1 ')).toBe('pedro#br1')
    expect(normRiotId(undefined)).toBe('')
  })

  it('acha o perfil pelo puuid aprendido ou pelo Riot ID digitado', () => {
    const list = [prof('a', 'Aline', 'Aline#BR1'), prof('b', 'Caio', undefined, 'puuid-do-caio')]
    expect(findProfileFor(list, { name: 'aline#br1' })?.id).toBe('a')
    expect(findProfileFor(list, { puuid: 'puuid-do-caio' })?.id).toBe('b')
    expect(findProfileFor(list, { name: 'Outro#BR1' })).toBeUndefined()
    expect(findProfileFor(list, {})).toBeUndefined()
  })

  it('Riot ID salvo sem a tag só vale se for o único com aquele nome', () => {
    const list = [prof('a', 'A', 'Aline')]
    expect(findProfileFor(list, { name: 'Aline#BR1' })?.id).toBe('a')
    const dup = [prof('a', 'A', 'Aline'), prof('b', 'B', 'aline')]
    expect(findProfileFor(dup, { name: 'Aline#BR1' })).toBeUndefined()
  })

  it('marca você e os amigos, e pede para aprender o puuid de quem foi reconhecido pelo nome', () => {
    const profiles = [prof('me', 'Pedro', 'Pedro#BR1'), prof('al', 'Aline', 'Aline#BR1'), prof('xx', 'Sem conta')]
    const res = annotateDraft(
      draft([
        ally(0, { puuid: 'p-pedro', role: 'UTILITY' }),
        ally(1, { puuid: 'p-aline', name: 'Aline#BR1', role: 'MIDDLE' }),
        ally(2, { puuid: 'p-estranho', name: 'Estranho#123' })
      ]),
      profiles,
      { puuid: 'p-pedro', gameName: 'Pedro', tagLine: 'BR1' }
    )
    const [me, aline, stranger] = res.draft.allies
    expect(me).toMatchObject({ isMe: true, profileId: 'me', name: 'Pedro#BR1' })
    expect(aline).toMatchObject({ profileId: 'al' })
    expect(aline.isMe).toBeUndefined()
    expect(stranger.profileId).toBeUndefined()
    expect(res.me?.id).toBe('me')
    expect(res.learn).toEqual([
      { profileId: 'me', puuid: 'p-pedro' },
      { profileId: 'al', puuid: 'p-aline' }
    ])
  })

  it('conta sem perfil: você continua marcado, só não há perfil', () => {
    const res = annotateDraft(draft([ally(0, { puuid: 'p1' })]), [prof('x', 'X', 'Outro#1')], { puuid: 'p1', gameName: 'Novo', tagLine: 'BR1' })
    expect(res.draft.allies[0]).toMatchObject({ isMe: true, name: 'Novo#BR1' })
    expect(res.draft.allies[0].profileId).toBeUndefined()
    expect(res.me).toBeNull()
  })

  it('o puuid do perfil só é aceito com formato válido e não viaja no que é compartilhado', () => {
    expect(sanitizeProfile({ nickname: 'A', puuid: 'abc-123-def-456' }).puuid).toBe('abc-123-def-456')
    expect(sanitizeProfile({ nickname: 'A', puuid: '../etc/passwd' }).puuid).toBeUndefined()
  })
})
