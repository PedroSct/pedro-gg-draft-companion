import { useMemo } from 'react'
import { ROLES, type FriendProfile } from '../../../shared/dataTypes'
import type { Role } from '../../../shared/types'
import { selectFocusPlayer, selectFocusProfile, useApp } from '../store/useApp'

export interface Focus {
  championId: number
  role: Role | null
  /** de onde veio: o pick do jogador, uma alternativa clicada, ou a melhor sugestão */
  source: 'local' | 'preview' | 'suggestion'
  /** a build é do jogador local (só ele pode importá-la para o próprio cliente) */
  forLocal: boolean
}

function guessRole(profile: FriendProfile | null, championId: number): Role | null {
  if (!profile) return null
  return ROLES.find((r) => profile.pool[r].some((e) => e.championId === championId)) ?? profile.mainRoles[0] ?? null
}

/**
 * Qual campeão o painel de build deve mostrar:
 * alternativa clicada > campeão que o jogador já escolheu/está pensando > melhor sugestão da Pool.
 */
export function useFocus(): Focus | null {
  const draft = useApp((s) => s.draft)
  const rec = useApp((s) => s.recommendation)
  const preview = useApp((s) => s.previewChampionId)
  const roleOverride = useApp((s) => s.roleOverride)
  const friendRoles = useApp((s) => s.friendRoles)
  const player = useApp(selectFocusPlayer)
  const profile = useApp(selectFocusProfile)

  return useMemo(() => {
    if (!draft) return null
    const isLocal = !player || player.cellId === draft.localPlayerCellId
    const chosen = isLocal ? roleOverride : (friendRoles[player.cellId] ?? null)
    const role = (isLocal ? draft.localRole : player.role) ?? chosen ?? rec?.role ?? null

    const mine = player ?? draft.allies.find((p) => p.cellId === draft.localPlayerCellId)
    // Pick travado: a build é do campeão escolhido, mesmo que antes tenha clicado em uma alternativa.
    const locked = !!mine && mine.status === 'locked' && mine.championId > 0
    if (preview !== null && !locked) {
      const hit = rec?.ranking.find((r) => r.championId === preview)
      return { championId: preview, role: hit?.role ?? role ?? guessRole(profile, preview), source: 'preview' as const, forLocal: isLocal }
    }
    if (mine && mine.championId > 0) {
      return { championId: mine.championId, role: role ?? guessRole(profile, mine.championId), source: 'local' as const, forLocal: isLocal }
    }
    const top = rec?.ranking[0]
    if (top) return { championId: top.championId, role: top.role, source: 'suggestion' as const, forLocal: isLocal }
    return null
  }, [draft, rec, preview, roleOverride, friendRoles, player, profile])
}
