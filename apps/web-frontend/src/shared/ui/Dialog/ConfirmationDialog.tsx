import type { ReactNode } from 'react'
import { Button } from '../Button/Button'
import { Dialog } from './Dialog'
import styles from './ConfirmationDialog.module.css'
export function ConfirmationDialog({
  title,
  children,
  confirmLabel = 'Confirm',
  onCancel,
  onConfirm,
}: {
  title: string
  children: ReactNode
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog title={title} onClose={onCancel}>
      <div className={styles.content}>{children}</div>
      <footer>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </footer>
    </Dialog>
  )
}
