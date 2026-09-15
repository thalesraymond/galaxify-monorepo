import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import styles from './Field.module.css'
export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string | undefined
  hint?: ReactNode
}
export function Field({ error, hint, id, label, ...input }: FieldProps) {
  const generatedId = useId()
  const inputId = id ?? `field-${generatedId}`
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const describedBy = [hint ? hintId : '', error ? errorId : '', input['aria-describedby'] ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={styles.field}>
      <label htmlFor={inputId}>{label}</label>
      <input
        {...input}
        id={inputId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint ? <small id={hintId}>{hint}</small> : null}
      {error ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
