// Classes reutilizadas (Tailwind detecta as strings neste arquivo).
export const btn =
  'inline-flex items-center gap-2 rounded-sm border border-line bg-panel px-3 py-1.5 text-sm text-snow transition-colors hover:border-mist/60 hover:bg-raised disabled:pointer-events-none disabled:opacity-40'

export const btnGold =
  'inline-flex items-center gap-2 rounded-sm border border-gold/70 bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold transition-colors hover:bg-gold/20 disabled:pointer-events-none disabled:opacity-40'

export const btnDanger =
  'inline-flex items-center gap-2 rounded-sm border border-enemy/50 bg-enemy/10 px-3 py-1.5 text-sm text-enemy transition-colors hover:bg-enemy/20 disabled:pointer-events-none disabled:opacity-40'

export const input =
  'w-full rounded-sm border border-line bg-night px-2.5 py-1.5 text-sm text-snow placeholder:text-dim hover:border-mist/40 focus:border-gold/70'

/** Botão-etiqueta de filtro (liga/desliga). */
export const chip = (on: boolean): string =>
  `rounded-sm border px-2 py-0.5 text-xs transition-colors ${
    on ? 'border-gold/70 bg-gold/10 text-gold' : 'border-line bg-panel text-mist hover:border-mist/50 hover:text-snow'
  }`
