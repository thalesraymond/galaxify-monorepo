import { useState } from 'react'

import {
  Button,
  ConfirmationDialog,
  ContentSurface,
  EmptyState,
  Field,
  Gauge,
  Skeleton,
  StatusBadge,
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
        description="Shared After hours controls, telemetry indicators, and recovery states."
      />
      <div className={styles.grid}>
        <ContentSurface aria-labelledby="form-state-title">
          <h2 id="form-state-title">Form validation</h2>
          <form className={styles.form} noValidate>
            <Field
              label="Email"
              type="email"
              value="player@example"
              error="Enter a valid email address."
              onChange={() => undefined}
            />
            <Button type="submit">Save changes</Button>
          </form>
        </ContentSurface>
        <ContentSurface tone="raised" aria-labelledby="loading-state-title">
          <h2 id="loading-state-title">Loading Ship status</h2>
          <Gauge label="Hull condition" value={72} />
          <div className={styles.badges}>
            <StatusBadge status="ready" />
            <StatusBadge status="updating" />
          </div>
          <Skeleton lines={3} />
        </ContentSurface>
        <ContentSurface aria-labelledby="empty-state-title">
          <EmptyState embedded title="No Dailies">
            Create a Daily to begin tracking today&apos;s routine.
          </EmptyState>
        </ContentSurface>
        <UnavailableState
          title="Ship status is unavailable"
          description="The Ship service did not respond. Your Dailies remain usable."
          onRetry={() => undefined}
        />
      </div>
      <div className={styles.actions}>
        <Button
          variant="danger"
          onClick={() => {
            setDialogOpen(true)
          }}
        >
          Delete Daily
        </Button>
      </div>
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
