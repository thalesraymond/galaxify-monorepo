import { Link } from 'react-router'

import { useApiTransport } from '@/shared/api/TransportContext'
import { ContentSurface } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

import { createDaily } from '../api/dailyApi'
import { DailyForm, dailyRequestBody } from '../components/DailyForm'
import styles from './DailyFormPage.module.css'

export function NewDailyPage() {
  const transport = useApiTransport()

  return (
    <div className={styles.page}>
      <PageHeader title="Create a Daily" description="Create a task that repeats every day." />
      <Link className={styles.backLink} to="/dailies">
        Back to Dailies
      </Link>

      <ContentSurface aria-labelledby="create-daily-heading">
        <h2 className={styles.heading} id="create-daily-heading">
          New Daily
        </h2>
        <DailyForm
          mode="create"
          submitLabel="Create Daily"
          onSubmit={(values) => createDaily(transport, dailyRequestBody(values))}
        />
      </ContentSurface>
    </div>
  )
}
