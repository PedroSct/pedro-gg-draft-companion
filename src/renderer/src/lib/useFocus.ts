import { useMemo } from 'react'
import { ROLES, type FriendProfile } from '../../../shared/dataTypes'
import type { Role } from '../../../shared/types'
import { selectActiveProfile, useApp } from '../store/useApp'

export interface Focus {
  championId: number
  role: Role | null
  /** de onde veio: o pick do jogador, uma alternativa clicada, ou a melhor sugestão */
  source: 'local' | 'preview' | 'suggestion'
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
  const profile = useApp(selectActiveProfile)

  return useMemo(() => {
    if (!draft) return null
    const role = draft.localRole ?? roleOverride ?? rec?.role ?? null

    if (preview !== null) {
      const hit = rec?.ranking.find((r) => r.championId === preview)
      return { championId: preview, role: hit?.role ?? role ?? guessRole(profile, preview), source: 'preview' as const }
    }
    const mine = draft.allies.find((p) => p.cellId === draft.localPlayerCellId)
    if (mine && mine.championId > 0) {
      return { championId: mine.championId, role: role ?? guessRole(profile, mine.championId), source: 'local' as const }
    }
    const top = rec?.ranking[0]
    if (top) return { championId: top.championId, role: top.role, source: 'suggestion' as const }
    return null
  }, [draft, rec, preview, roleOverride, profile])
}
