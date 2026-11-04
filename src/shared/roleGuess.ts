// src/shared/roleGuess.ts
// Palpite da rota quando a fila não informa (normal, flex...): elimina as rotas que os aliados já ocupam
// e escolhe, entre as que sobram, a que mais combina com a Pool e as rotas principais do perfil.
import { ROLES, type FriendProfile } from './dataTypes'
import type { DraftState, Role } from './types'

/** Rota mais provável do jogador `cellId`; null quando não dá para separar com segurança. */
export function guessRole(draft: DraftState, profile: FriendProfile, cellId: number = draft.localPlayerCellId): Role | null {
  const taken = new Set<Role>()
  for (const a of draft.allies) if (a.cellId !== cellId && a.role) taken.add(a.role)
  const free = ROLES.filter((r) => !taken.has(r))
  if (free.length === 0) return null
  if (taken.size > 0 && free.length === 1) return free[0]

  const scored = free
    .filter((r) => (profile.pool[r]?.length ?? 0) > 0)
    .map((r) => {
      const pool = profile.pool[r]
      const main = profile.mainRoles.indexOf(r)
      const mainBonus = main === 0 ? 3 : main === 1 ? 2 : main > 1 ? 1 : 0
      const topComfort = Math.max(...pool.map((e) => e.comfort))
      return { role: r, score: mainBonus + topComfort * 0.5 + Math.min(pool.length, 5) * 0.1 }
    })
    .sort((a, b) => b.score - a.score)
  if (scored.length === 0) return null
  if (scored.length === 1) return scored[0].role
  // empate (ou quase): melhor perguntar do que chutar
  return scored[0].score - scored[1].score >= 0.5 ? scored[0].role : null
}
