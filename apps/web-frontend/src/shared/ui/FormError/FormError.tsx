import styles from './FormError.module.css'

export function FormError({ children }: { children: string }) {
  return (
    <p className={styles.formError} role="alert">
      {children}
    </p>
  )
}
