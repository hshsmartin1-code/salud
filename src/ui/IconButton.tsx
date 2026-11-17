import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

export type IconButtonTone = 'default' | 'accent' | 'danger'

const TONE: Record<IconButtonTone, string> = {
  default: 'text-muted hover:bg-surface2 hover:text-ink focus-visible:text-ink',
  accent: 'text-accent hover:bg-accent/10',
  danger: 'text-bad hover:bg-bad/10',
}

/** Icon-only action. Always 44 x 44 px, always named (aria-label and tooltip). */
export function IconButton({
  icon,
  label,
  onClick,
  tone = 'default',
  disabled,
  pressed,
  size = 20,
  className = '',
  ...rest
}: {
  icon: IconName
  /** Accessible name; icon-only controls must say what they do. */
  label: string
  onClick?: () => void
  tone?: IconButtonTone
  disabled?: boolean
  /** Toggle state (aria-pressed) for buttons that switch something on and off. */
  pressed?: boolean
  size?: number
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'aria-label' | 'children' | 'className'>) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-xl transition-colors duration-state active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${TONE[tone]} ${
        pressed ? 'bg-surface2 text-ink' : ''
      } ${className}`}
    >
      <Icon name={icon} size={size} strokeWidth={icon === 'dots' ? 3.2 : undefined} />
    </button>
  )
}
