// Gráficos em SVG puro (sem biblioteca): leves, nítidos em qualquer tamanho e com animação de entrada.
import { useEffect, useRef, useState } from 'react'

const reduceMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Número que sobe até o valor. Com "reduzir movimento" ligado, aparece já no valor final. */
export function useCountUp(target: number, ms = 800): number {
  const [v, setV] = useState(() => (reduceMotion() ? target : 0))
  const from = useRef(0)
  useEffect(() => {
    if (reduceMotion() || typeof requestAnimationFrame !== 'function') {
      setV(target)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number): void => {
      const k = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - k, 3)
      const cur = a + (target - a) * eased
      from.current = cur
      setV(cur)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

export function CountUp({ value, decimals = 0, suffix = '', className = '' }: { value: number; decimals?: number; suffix?: string; className?: string }) {
  const v = useCountUp(value)
  return (
    <span className={`num ${className}`}>
      {v.toFixed(decimals)}
      {suffix}
    </span>
  )
}

/** Marca "montou": liga a transição CSS no frame seguinte. */
function useMounted(): boolean {
  const [m, setM] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame?.(() => setM(true)) ?? 0
    const t = setTimeout(() => setM(true), 30) // jsdom e abas em segundo plano
    return () => {
      cancelAnimationFrame?.(id)
      clearTimeout(t)
    }
  }, [])
  return m
}

// ---------------------------------------------------------------- anel da nota

const GRADE_COLOR: Record<string, string> = {
  S: 'var(--color-gold)',
  A: 'var(--color-ally)',
  B: '#7ad39b',
  C: '#e0a85c',
  D: 'var(--color-enemy)'
}
export const gradeColor = (g: string): string => GRADE_COLOR[g] ?? 'var(--color-mist)'

export function ScoreRing({ score, grade, size = 150 }: { score: number; grade: string; size?: number }) {
  const mounted = useMounted()
  const r = 52
  const c = 2 * Math.PI * r
  const off = c * (1 - (mounted ? score : 0) / 100)
  const color = gradeColor(grade)
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`Nota ${score} de 100, conceito ${grade}`}>
      <svg viewBox="0 0 120 120" width={size} height={size}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-line)" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          transform="rotate(-90 60 60)"
          style={{ transition: 'stroke-dashoffset 1100ms cubic-bezier(0.2,0.7,0.2,1)', filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <CountUp value={score} className="block text-4xl font-semibold leading-none" />
          <span className="num text-lg font-semibold" style={{ color }}>
            {grade}
          </span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- radar

export function Radar({ items, size = 260 }: { items: { label: string; score: number }[]; size?: number }) {
  const mounted = useMounted()
  const n = items.length
  const cx = 130
  const cy = 130
  const R = 82
  const pt = (i: number, k: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return [cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k]
  }
  if (n < 3) return null
  const poly = items.map((it, i) => pt(i, it.score / 100).join(',')).join(' ')
  return (
    <svg viewBox="0 0 260 260" width={size} height={size} role="img" aria-label={`Radar: ${items.map((i) => `${i.label} ${i.score}`).join(', ')}`}>
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={items.map((_, i) => pt(i, k).join(',')).join(' ')} fill="none" stroke="var(--color-line)" strokeWidth="1" />
      ))}
      {items.map((_, i) => {
        const [x, y] = pt(i, 1)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-line)" strokeWidth="1" />
      })}
      <g style={{ transformOrigin: '130px 130px', transform: mounted ? 'scale(1)' : 'scale(0.2)', opacity: mounted ? 1 : 0, transition: 'transform 900ms cubic-bezier(0.2,0.7,0.2,1), opacity 600ms' }}>
        <polygon points={poly} fill="rgb(60 201 220 / 0.22)" stroke="var(--color-ally)" strokeWidth="2" strokeLinejoin="round" />
        {items.map((it, i) => {
          const [x, y] = pt(i, it.score / 100)
          return <circle key={it.label} cx={x} cy={y} r="3.5" fill="var(--color-ally)" />
        })}
      </g>
      {items.map((it, i) => {
        const [x, y] = pt(i, 1.2)
        return (
          <text key={it.label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="var(--color-mist)">
            {it.label}
          </text>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------- linhas

export interface LineSeries {
  name: string
  color: string
  values: number[]
  dashed?: boolean
}

export interface Marker {
  x: number
  label: string
}

/** Eixo com números redondos (0, 50, 100…) em vez de valores quebrados. */
function niceScale(lo: number, hi: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  const span = hi - lo || 1
  const rough = span / count
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((st) => st >= rough) ?? 10 * pow
  const nLo = Math.floor(lo / step) * step
  const nHi = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = nLo; v <= nHi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return { lo: nLo, hi: nHi, ticks }
}

interface LineChartProps {
  xs: number[]
  series: LineSeries[]
  height?: number
  /** pinta a área entre a série e o zero (bom para "diferença") */
  area?: boolean
  format?: (v: number) => string
  xLabel?: (x: number) => string
  markers?: Marker[]
  /** largura lógica do desenho: use maior em gráficos de tela cheia, para o texto não crescer */
  width?: number
  ariaLabel: string
}

export function LineChart({ xs, series, height = 190, area = false, format = (v) => String(Math.round(v)), xLabel = (x) => `${x} min`, markers = [], width = 560, ariaLabel }: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const mounted = useMounted()
  const W = width
  const H = height
  const pad = { l: 44, r: 12, t: 12, b: 24 }
  const n = xs.length
  if (n < 2 || series.length === 0) return null
  const all = series.flatMap((s) => s.values)
  const rawLo = Math.min(...all, area ? 0 : Infinity)
  const rawHi = Math.max(...all, area ? 0 : -Infinity)
  const scale = niceScale(rawLo >= -0.05 * rawHi ? 0 : rawLo, rawHi === rawLo ? rawHi + 1 : rawHi)
  const { lo, hi, ticks } = scale
  const sx = (i: number): number => pad.l + (i / (n - 1)) * (W - pad.l - pad.r)
  const sy = (v: number): number => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b)
  const xTicks = xs.map((x, i) => ({ x, i })).filter(({ x }) => x % 5 === 0)
  const path = (vals: number[]): string => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')
  const zeroY = sy(0)

  const onMove = (e: React.MouseEvent<SVGRectElement>): void => {
    const box = e.currentTarget.getBoundingClientRect()
    const k = (e.clientX - box.left) / box.width
    setHover(Math.max(0, Math.min(n - 1, Math.round(k * (n - 1)))))
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={sy(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="var(--color-dim)">
              {format(t)}
            </text>
          </g>
        ))}
        {xTicks.map(({ x, i }) => (
          <text key={x} x={sx(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-dim)">
            {x}
          </text>
        ))}
        {area && lo < 0 && hi > 0 && <line x1={pad.l} x2={W - pad.r} y1={zeroY} y2={zeroY} stroke="var(--color-mist)" strokeWidth="1" opacity="0.5" />}
        {area &&
          series.slice(0, 1).map((s) => (
            <path key="area" d={`${path(s.values)} L${sx(n - 1)},${zeroY} L${sx(0)},${zeroY} Z`} fill={s.color} opacity={mounted ? 0.14 : 0} style={{ transition: 'opacity 900ms 300ms' }} />
          ))}
        {markers.map((m) => {
          const i = xs.indexOf(m.x)
          if (i < 0) return null
          return (
            <g key={m.x + m.label}>
              <line x1={sx(i)} x2={sx(i)} y1={pad.t} y2={H - pad.b} stroke="var(--color-gold)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
              <text x={sx(i)} y={pad.t + 8} textAnchor="middle" fontSize="9" fill="var(--color-gold)">
                {m.label}
              </text>
            </g>
          )
        })}
        {series.map((s) => (
          <path
            key={s.name}
            d={path(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={mounted ? (s.dashed ? '0.02 0.012' : '1 0') : '1 1'}
            strokeDashoffset={mounted ? 0 : 1}
            style={{ transition: 'stroke-dashoffset 1200ms cubic-bezier(0.2,0.7,0.2,1)' }}
          />
        ))}
        {hover !== null && (
          <g>
            <line x1={sx(hover)} x2={sx(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--color-mist)" strokeWidth="1" opacity="0.6" />
            {series.map((s) => (
              <circle key={s.name} cx={sx(hover)} cy={sy(s.values[hover])} r="4" fill={s.color} stroke="var(--color-night)" strokeWidth="1.5" />
            ))}
          </g>
        )}
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 rounded-sm border border-line bg-deck/95 px-2 py-1 text-xs shadow-lg"
          style={{ left: `${Math.min(78, Math.max(2, (sx(hover) / W) * 100 + 1))}%` }}
        >
          <div className="text-mist">{xLabel(xs[hover])}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-mist">{s.name}</span>
              <span className="num text-snow">{format(s.values[hover])}</span>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-mist">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- barra que cresce

export function GrowBar({ value, max = 100, color = 'var(--color-ally)', label }: { value: number; max?: number; color?: string; label?: string }) {
  const mounted = useMounted()
  const w = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="h-2 overflow-hidden bg-line" role="img" aria-label={label}>
      <div className="h-full" style={{ width: mounted ? `${w}%` : '0%', background: color, transition: 'width 900ms cubic-bezier(0.2,0.7,0.2,1)' }} />
    </div>
  )
}
