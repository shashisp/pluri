import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import type { AgentState } from '@shared/types'

// ---- Button ----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: Size
  icon?: ReactNode
  block?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  block,
  className = '',
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const cls = [
    'pluri-btn',
    `pluri-btn--${variant}`,
    size !== 'md' ? `pluri-btn--${size}` : '',
    block ? 'pluri-btn--block' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={cls} {...rest}>
      {icon && <span className="pluri-btn__icon">{icon}</span>}
      {children}
    </button>
  )
}

// ---- IconButton ------------------------------------------------------------

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size
  active?: boolean
  label?: string
}

export function IconButton({
  size = 'md',
  active,
  label,
  className = '',
  children,
  ...rest
}: IconButtonProps): JSX.Element {
  const cls = [
    'pluri-iconbtn',
    size !== 'md' ? `pluri-iconbtn--${size}` : '',
    active ? 'pluri-iconbtn--active' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={cls} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  )
}

// ---- Badge -----------------------------------------------------------------

type BadgeVariant =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'info'
  | 'warning'
  | 'danger'
  | 'violet'

export function Badge({
  variant = 'neutral',
  dot,
  children
}: {
  variant?: BadgeVariant
  dot?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <span className={`pluri-badge pluri-badge--${variant}`}>
      {dot && <span className="pluri-badge__dot" />}
      {children}
    </span>
  )
}

// ---- Tag -------------------------------------------------------------------

export function Tag({ children, title }: { children: ReactNode; title?: string }): JSX.Element {
  return (
    <span className="pluri-tag" title={title}>
      {children}
    </span>
  )
}

// ---- Kbd -------------------------------------------------------------------

export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return <kbd className="pluri-kbd">{children}</kbd>
}

// ---- StatusDot -------------------------------------------------------------

type DotKind = 'idle' | 'working' | 'awaiting' | 'open' | 'error'

const STATE_TO_DOT: Record<AgentState, DotKind> = {
  idle: 'idle',
  working: 'working',
  awaiting_mr: 'awaiting',
  mr_open: 'open',
  done: 'open',
  killed: 'error',
  error: 'error'
}

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  idle: 'queued',
  working: 'working',
  awaiting_mr: 'awaiting MR',
  mr_open: 'MR open',
  done: 'done',
  killed: 'killed',
  error: 'error'
}

export function StatusDot({
  state,
  lg
}: {
  state: AgentState
  lg?: boolean
}): JSX.Element {
  return (
    <span
      className={`pluri-dot pluri-dot--${STATE_TO_DOT[state]}${lg ? ' pluri-dot--lg' : ''}`}
      title={AGENT_STATE_LABEL[state]}
    />
  )
}

// ---- Input -----------------------------------------------------------------

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  icon?: ReactNode
  invalid?: boolean
  mono?: boolean
}

export function Input({
  label,
  icon,
  invalid,
  mono,
  className = '',
  ...rest
}: InputProps): JSX.Element {
  const input = (
    <input
      className={`pluri-input${mono ? ' pluri-input--mono' : ''}${
        invalid ? ' pluri-input--invalid' : ''
      } ${className}`.trim()}
      {...rest}
    />
  )
  const control = icon ? (
    <div className="pluri-inputwrap">
      <span className="pluri-inputwrap__icon">{icon}</span>
      {input}
    </div>
  ) : (
    input
  )
  if (!label) return control
  return (
    <label className="pluri-field">
      <span className="pluri-field__label">{label}</span>
      {control}
    </label>
  )
}

// ---- Textarea --------------------------------------------------------------

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  invalid?: boolean
}

export function Textarea({
  label,
  invalid,
  className = '',
  ...rest
}: TextareaProps): JSX.Element {
  const ta = (
    <textarea
      className={`pluri-textarea${invalid ? ' pluri-textarea--invalid' : ''} ${className}`.trim()}
      {...rest}
    />
  )
  if (!label) return ta
  return (
    <label className="pluri-field">
      <span className="pluri-field__label">{label}</span>
      {ta}
    </label>
  )
}

// ---- Checkbox --------------------------------------------------------------

export function Checkbox({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: ReactNode
}): JSX.Element {
  return (
    <label className={`pluri-check${disabled ? ' pluri-check--disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="pluri-check__box">
        <Check strokeWidth={3} />
      </span>
      {label}
    </label>
  )
}

// ---- Select ----------------------------------------------------------------

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
}

export function Select({ options, className = '', ...rest }: SelectProps): JSX.Element {
  return (
    <div className={`pluri-select ${className}`.trim()}>
      <select {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pluri-select__chevron">
        <ChevronDown />
      </span>
    </div>
  )
}

// ---- Tabs ------------------------------------------------------------------

interface TabDef {
  value: string
  label: string
  icon?: ReactNode
  count?: number
}

export function Tabs({
  value,
  onChange,
  tabs
}: {
  value: string
  onChange: (v: string) => void
  tabs: TabDef[]
}): JSX.Element {
  return (
    <div className="pluri-tabs">
      {tabs.map((t) => (
        <button
          key={t.value}
          className={`pluri-tab${value === t.value ? ' pluri-tab--active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.icon}
          {t.label}
          {t.count != null && <span className="pluri-tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ---- Dialog ----------------------------------------------------------------

export function Dialog({
  title,
  onClose,
  footer,
  width,
  children
}: {
  title: string
  onClose: () => void
  footer?: ReactNode
  width?: number
  children: ReactNode
}): JSX.Element {
  return (
    <div className="pluri-dialog-backdrop" onClick={onClose}>
      <div
        className="pluri-dialog"
        style={width ? { width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pluri-dialog__header">
          <h2 className="pluri-dialog__title">{title}</h2>
          <IconButton size="sm" className="pluri-dialog__close" label="Close" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        <div className="pluri-dialog__body">{children}</div>
        {footer && <div className="pluri-dialog__footer">{footer}</div>}
      </div>
    </div>
  )
}

// ---- EmptyState ------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  desc
}: {
  icon?: ReactNode
  title: string
  desc?: string
}): JSX.Element {
  return (
    <div className="pluri-empty">
      {icon && <span className="pluri-empty__icon">{icon}</span>}
      <span className="pluri-empty__title">{title}</span>
      {desc && <span className="pluri-empty__desc">{desc}</span>}
    </div>
  )
}
