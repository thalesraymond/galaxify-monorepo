import { useState, type InputHTMLAttributes, type ReactNode } from 'react'

import { Field } from '@/shared/ui'

import styles from './PasswordField.module.css'

export type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string
  error?: string | undefined
  hint?: ReactNode
}

/**
 * Password control with a visible show/hide toggle. Labels remain visible and
 * the toggle is a real button so keyboard and screen-reader users can use it
 * (`web-frontend.md` §5.1).
 */
export function PasswordField({ label, error, hint, ...input }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className={styles.password}>
      <Field
        autoComplete="current-password"
        label={label}
        error={error}
        hint={hint}
        type={visible ? 'text' : 'password'}
        {...input}
      />
      <button
        className={styles.toggle}
        type="button"
        aria-pressed={visible}
        onClick={() => {
          setVisible((current) => !current)
        }}
      >
        {visible ? 'Hide password' : 'Show password'}
      </button>
    </div>
  )
}
