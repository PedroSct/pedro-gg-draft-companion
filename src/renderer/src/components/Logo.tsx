/** Marca do Pedro.gg: hexágono + P isométrico + traço. As formas ficam aqui para o app inteiro usar a mesma. */
const RING = 'M0,-188 L162.8,-94 L162.8,94 L0,188 L-162.8,94 L-162.8,-94 Z'
const RING_SMALL = 'M0,-182 L157.6,-91 L157.6,91 L0,182 L-157.6,91 L-157.6,-91 Z'
const P_BODY = 'M0,-136 L118,-68 L118,-16 L0,51 L-70,11 L-70,95 L-118,67 L-118,-68 Z'
const P_HOLE = 'M0,-84 L71,-43 L0,-2 L-71,-43 Z'
const TAIL = 'M-42,73 L0,97 L118,29 L118,59 L0,127 L-42,103 Z'

interface LogoMarkProps {
  size?: number
  /** versão para tamanhos pequenos (borda mais grossa e P maior) */
  small?: boolean
  /** classes de animação da abertura */
  animated?: boolean
  /** cor da marca (padrão: dourado) */
  color?: string
  className?: string
}

export function LogoMark({ size = 32, small = false, animated = false, color = 'var(--color-gold)', className = '' }: LogoMarkProps) {
  return (
    <svg viewBox="-200 -200 400 400" width={size} height={size} className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <path
        d={small ? RING_SMALL : RING}
        pathLength={300}
        fill="none"
        stroke={color}
        strokeWidth={small ? 24 : 12}
        strokeLinejoin="miter"
        className={animated ? 'logo-ring' : undefined}
      />
      <g transform={`scale(${small ? 1.16 : 1}) translate(0 4)`} fill={color}>
        <path fillRule="evenodd" d={`${P_BODY} ${P_HOLE}`} className={animated ? 'logo-body' : undefined} />
        <path d={TAIL} className={animated ? 'logo-tail' : undefined} />
      </g>
    </svg>
  )
}
