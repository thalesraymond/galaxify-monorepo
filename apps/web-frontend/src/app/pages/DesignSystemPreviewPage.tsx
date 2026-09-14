import { useState } from 'react'

import {
  Button,
  ConfirmationDialog,
  ContentSurface,
  EmptyState,
  Field,
  Skeleton,
  UnavailableState,
} from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'
import styles from './DesignSystemPreviewPage.module.css'

/** Internal visual-regression fixture for the shared, domain-neutral UI foundation. */
export function DesignSystemPreviewPage() {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className={styles.page}>
      <PageHeader
        title="Interface states"
        description="Shared controls and recovery states used across the application."
      />
      <div className={styles.grid}>
        <ContentSurface aria-labelledby="form-state-title">
          <h2 id="form-state-title">Form validation</h2>
          <form className={styles.form} noValidate>
            <Field
              label="Email"
              type="email"
              value="captain@example"
              error="Enter a valid email address."
              onChange={() => undefined}
            />
            <Button type="submit">Save changes</Button>
          </form>
        </ContentSurface>
        <ContentSurface tone="raised" aria-labelledby="loading-state-title">
          <h2 id="loading-state-title">Loading Ship status</h2>
          <Skeleton lines={3} />
        </ContentSurface>
        <ContentSurface aria-labelledby="empty-state-title">
          <EmptyState title="No Dailies">Create a Daily to start your logbook.</EmptyState>
        </ContentSurface>
        <UnavailableState
          title="Ship status is unavailable"
          description="The Ship service did not respond. Your Dailies are still available."
          onRetry={() => undefined}
        />
      </div>
      <Button
        onClick={() => {
          setDialogOpen(true)
        }}
      >
        Delete Daily
      </Button>
      {dialogOpen ? (
        <ConfirmationDialog
          title="Delete Daily"
          confirmLabel="Delete Daily"
          onCancel={() => {
            setDialogOpen(false)
          }}
          onConfirm={() => {
            setDialogOpen(false)
          }}
        >
          <p>This removes the Daily recurrence while preserving its history.</p>
        </ConfirmationDialog>
      ) : null}
    </div>
  )
}
