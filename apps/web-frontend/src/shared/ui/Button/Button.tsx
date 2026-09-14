import type { ButtonHTMLAttributes } from 'react'

import { classNames } from '../classNames'
import styles from './Button.module.css'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet'
  loading?: boolean
}

export function Button({
  children,
  className,
  disabled,
  loading = false,
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={classNames(styles.button, styles[variant], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? 'Working…' : children}
    </button>
  )
}
