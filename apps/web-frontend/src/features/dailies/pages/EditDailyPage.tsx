import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { isApiHttpError } from '@/api/transport'
import { useApiTransport } from '@/shared/api/TransportContext'
import { Button, ContentSurface, Skeleton, StatusBadge, UnavailableState } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

import { dailyQueryKey, getDaily, updateDaily } from '../api/dailyApi'
import { DailyForm, dailyRequestBody, type DailyFormValues } from '../components/DailyForm'
import styles from './DailyFormPage.module.css'

export function EditDailyPage() {
  const { dailyId } = useParams()
  const transport = useApiTransport()
  const dailyQuery = useQuery({
    queryKey: dailyQueryKey(dailyId ?? ''),
    queryFn: ({ signal }) => getDaily(transport, dailyId ?? '', signal),
    enabled: dailyId !== undefined,
    retry: false,
  })
  const daily = dailyQuery.data

  if (isApiHttpError(dailyQuery.error, 'DAILY_NOT_FOUND')) {
    return (
      <div className={styles.page}>
        <PageHeader title="Daily not found" description="That Daily could not be opened." />
        <ContentSurface aria-labelledby="missing-daily-heading" tone="raised">
          <h2 className={styles.heading} id="missing-daily-heading">
            This Daily does not exist
          </h2>
          <p>It may have been deleted, or the link is out of date.</p>
          <Link className={styles.backLink} to="/dailies">
            Back to Dailies
          </Link>
        </ContentSurface>
      </div>
    )
  }

  if (isApiHttpError(dailyQuery.error, 'DAILY_PLAYER_NOT_READY')) {
    return (
      <div className={styles.page}>
        <PageHeader title="Edit a Daily" description="Update the Daily's details." />
        <ContentSurface aria-labelledby="preparing-daily-heading" tone="raised">
          <StatusBadge status="preparing" />
          <h2 className={styles.heading} id="preparing-daily-heading">
            Preparing your Dailies
          </h2>
          <p>Your Daily roster is still being prepared. This usually takes a few moments.</p>
          <Button
            variant="secondary"
            onClick={() => {
              void dailyQuery.refetch()
            }}
          >
            Retry
          </Button>
        </ContentSurface>
      </div>
    )
  }

  if (dailyQuery.isError) {
    return (
      <div className={styles.page}>
        <PageHeader title="Edit a Daily" description="Update the Daily's details." />
        <UnavailableState
          title="The Daily could not be loaded"
          onRetry={() => {
            void dailyQuery.refetch()
          }}
        />
      </div>
    )
  }

  if (daily === undefined) {
    return (
      <div className={styles.page}>
        <PageHeader title="Edit a Daily" description="Update the Daily's details." />
        <ContentSurface aria-hidden="true">
          <Skeleton lines={5} />
        </ContentSurface>
      </div>
    )
  }

  const edited = daily.status === 'COMPLETED'

  return (
    <div className={styles.page}>
      <PageHeader title="Edit a Daily" description={`Update “${daily.title}”.`} />
      <Link className={styles.backLink} to="/dailies">
        Back to Dailies
      </Link>

      {edited ? (
        <div className={styles.completedNotice} role="note">
          <strong>This Daily is already completed.</strong>{' '}
          <span>
            Changes apply to future recurrences; past outcomes in Daily history stay unchanged.
          </span>
        </div>
      ) : null}

      <ContentSurface aria-labelledby="edit-daily-heading">
        <h2 className={styles.heading} id="edit-daily-heading">
          Daily details
        </h2>
        <DailyForm
          defaultValues={formValuesFromDaily(daily)}
          key={daily.id}
          mode="edit"
          submitLabel="Save changes"
          onSubmit={(values) => updateDaily(transport, daily.id, dailyRequestBody(values))}
        />
      </ContentSurface>
    </div>
  )
}

function formValuesFromDaily(daily: {
  readonly title: string
  readonly description: string
  readonly difficulty: 'EASY' | 'MEDIUM' | 'HARD'
}): DailyFormValues {
  return {
    title: daily.title,
    description: daily.description,
    difficulty: daily.difficulty,
  }
}
