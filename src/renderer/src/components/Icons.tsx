import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useApp } from '../store/useApp'

/**
 * Imagem do Data Dragon com plano B: sem internet (ou se o CDN falhar) mostra um ladrilho
 * com a inicial, em vez do texto alternativo do navegador.
 */
export function SafeImg({
  src,
  alt,
  title,
  className = '',
  style,
  fallback
}: {
  src: string
  alt: string
  title?: string
  className?: string
  style?: CSSProperties
  fallback: ReactNode
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (failed) return <>{fallback}</>
  return (
    <img
      src={src}
      alt={alt}
      title={title}
      draggable={false}
      loading="lazy"
      className={className}
      style={style}
      onError={() => setFailed(true)}
    />
  )
}

function Tile({ size, label, text, className = '' }: { size: number; label?: string; text: string; className?: string }) {
  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={`chamfer-sm num grid shrink-0 place-items-center bg-raised text-dim ${className}`}
      style={{ width: size, height: size, minWidth: size, fontSize: Math.max(11, size * 0.42) }}
    >
      {text}
    </div>
  )
}

interface ChampionIconProps {
  id: number
  size?: number
  /** acinzentado: banido ou indisponível */
  dim?: boolean
  className?: string
}

export function ChampionIcon({ id, size = 40, dim = false, className = '' }: ChampionIconProps) {
  const info = useApp((s) => s.champById.get(id))

  if (!info) return <Tile size={size} text={id > 0 ? '?' : ''} className={className} />

  return (
    <SafeImg
      src={info.iconUrl}
      alt={info.name}
      className={`chamfer-sm shrink-0 bg-raised object-cover ${dim ? 'opacity-45 grayscale' : ''} ${className}`}
      style={{ width: size, height: size, minWidth: size }}
      fallback={
        <Tile size={size} label={info.name} text={info.name.slice(0, 1).toUpperCase()} className={`${dim ? 'opacity-45' : ''} ${className}`} />
      }
    />
  )
}

export function useChampionName(id: number): string {
  return useApp((s) => s.champById.get(id)?.name ?? (id > 0 ? `Campeão ${id}` : ''))
}

export function ItemIcon({ id, size = 40 }: { id: number; size?: number }) {
  const item = useApp((s) => s.catalog?.items[String(id)])
  if (!item) return <Tile size={size} label={`Item ${id}`} text={String(id)} />
  return (
    <SafeImg
      src={item.iconUrl}
      alt={item.name}
      title={item.name}
      className="chamfer-sm shrink-0 bg-raised object-cover"
      style={{ width: size, height: size, minWidth: size }}
      fallback={<Tile size={size} label={item.name} text={item.name.slice(0, 1).toUpperCase()} />}
    />
  )
}

export function Stars({ value, onChange, label }: { value: number; onChange?: (n: number) => void; label: string }) {
  return (
    <div role={onChange ? 'group' : 'img'} aria-label={`${label}: ${value} de 5`} className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value
        const star = (
          <svg viewBox="0 0 20 20" className={`h-4 w-4 ${on ? 'fill-gold' : 'fill-line'}`} aria-hidden="true">
            <path d="M10 1.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6L10 15l-5.4 3 1.2-6L1.3 7.8l6.1-.7z" />
          </svg>
        )
        return onChange ? (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} de 5`}
            aria-pressed={n === value}
            className="rounded-sm p-0.5 hover:brightness-125"
          >
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        )
      })}
    </div>
  )
}
