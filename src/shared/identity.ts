// src/shared/identity.ts
// Descobre quem é você e quais amigos (com perfil salvo) estão na seleção de campeões.
// Funções puras: o main aplica, o renderer só lê o resultado.
import type { DraftState, LcuIdentity } from './types'
import type { FriendProfile } from './dataTypes'

/** "Nome #BR1 " e "nome#br1" são o mesmo Riot ID. */
export const normRiotId = (s: string | undefined | null): string =>
  (s ?? '').normalize('NFC').replace(/\s+#/g, '#').replace(/#\s+/g, '#').trim().toLowerCase()

export const riotIdOf = (id: Pick<LcuIdentity, 'gameName' | 'tagLine'>): string =>
  id.tagLine ? `${id.gameName}#${id.tagLine}` : id.gameName

/** Procura o perfil de uma conta: primeiro pelo puuid aprendido, depois pelo Riot ID digitado. */
export function findProfileFor(
  profiles: readonly FriendProfile[],
  who: { puuid?: string; name?: string }
): FriendProfile | undefined {
  if (who.puuid) {
    const byPuuid = profiles.find((p) => p.puuid === who.puuid)
    if (byPuuid) return byPuuid
  }
  const n = normRiotId(who.name)
  if (!n) return undefined
  // Sem a tag ("Pedro") só vale se for único; com tag, exige igualdade.
  const exact = profiles.find((p) => normRiotId(p.riotId) === n)
  if (exact) return exact
  if (!n.includes('#')) return undefined
  const bare = n.split('#')[0]
  const loose = profiles.filter((p) => {
    const r = normRiotId(p.riotId)
    return r !== '' && !r.includes('#') && r === bare
  })
  return loose.length === 1 ? loose[0] : undefined
}

export interface Annotated {
  draft: DraftState
  /** puuid → perfil que ainda não tinha puuid: o main grava para reconhecer na próxima */
  learn: { profileId: string; puuid: string }[]
  /** perfil dono da conta logada (null = conta ainda sem perfil) */
  me: FriendProfile | null
}

/** Marca em cada aliado se é você e se tem perfil salvo. */
export function annotateDraft(draft: DraftState, profiles: readonly FriendProfile[], me: LcuIdentity | null): Annotated {
  const learn: Annotated['learn'] = []
  const myCell = draft.localPlayerCellId
  const meName = me ? riotIdOf(me) : undefined
  const myProfile = me ? (findProfileFor(profiles, { puuid: me.puuid, name: meName }) ?? null) : null

  const allies = draft.allies.map((p) => {
    const isMe = p.cellId === myCell || (!!me && !!p.puuid && p.puuid === me.puuid)
    const name = p.name ?? (isMe && meName ? meName : undefined)
    const prof = isMe ? myProfile : findProfileFor(profiles, { puuid: p.puuid, name })
    if (prof && p.puuid && prof.puuid !== p.puuid) learn.push({ profileId: prof.id, puuid: p.puuid })
    return {
      ...p,
      ...(name ? { name } : {}),
      ...(isMe ? { isMe: true } : {}),
      ...(prof ? { profileId: prof.id } : {})
    }
  })
  return { draft: { ...draft, allies }, learn, me: myProfile }
}
