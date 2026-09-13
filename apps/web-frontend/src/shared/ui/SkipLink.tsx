import styles from './SkipLink.module.css'

export type SkipLinkProps = {
  /** ID of the landmark the skip link moves focus to. */
  targetId: string
}

/**
 * Keyboard-first skip link shared by every application shell.
 */
export function SkipLink({ targetId }: SkipLinkProps) {
  return (
    <a className={styles.skipLink} href={`#${targetId}`}>
      Skip to main content
    </a>
  )
}
