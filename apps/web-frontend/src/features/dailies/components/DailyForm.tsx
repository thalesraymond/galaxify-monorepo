import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, useId } from 'react'
import { useBlocker, useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import type { Daily, Difficulty } from '@/api/generated/daily/types.gen'
import { useApiTransport } from '@/shared/api/TransportContext'
import { mapApiFormError } from '@/shared/api/formErrors'
import { Button, ConfirmationDialog, Field, FormError, Skeleton } from '@/shared/ui'

import { difficultiesQueryKey, listDifficulties, type CreateDailyInput } from '../api/dailyApi'
import { isValidDateInput, todayDateInput } from '../lib/dailyTime'
import { difficultyLabel, difficultyRewardsMap } from '../lib/difficulties'
import styles from './DailyForm.module.css'

const FORM_FIELDS = [
  'title',
  'description',
  'difficulty',
  'due_local_date',
  'due_local_time',
  'time_zone',
] as const

type FormField = (typeof FORM_FIELDS)[number]

export type DailyFormValues = {
  title: string
  description: string
  difficulty: Difficulty
  due_local_date: string
  due_local_time: string
  time_zone: string
}

const zDailyForm = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Enter a title.')
    .max(120, 'Titles are limited to 120 characters.'),
  description: z.string().trim().max(1000, 'Descriptions are limited to 1000 characters.'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD'], { message: 'Choose a difficulty.' }),
  due_local_date: z.string().refine(isValidDateInput, { message: 'Enter a valid date.' }),
  due_local_time: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, { message: 'Enter a valid time in HH:MM.' }),
  time_zone: z.string().min(1, 'Select a time zone.'),
})

/**
 * Shared Daily creation/editing form (spec §5.3): title, optional description,
 * difficulty with backend reward/damage metadata, local due date and time, and
 * an advanced IANA timezone select defaulted from the browser. Validation
 * mirrors the backend limits; inline errors come from `mapApiFormError`.
 *
 * The form owns submission UX — dirty-navigation protection, error mapping,
 * dirty-clear on success, and the return navigation to the Daily's local date.
 */
export function DailyForm({
  mode,
  defaultValues,
  submitLabel,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  defaultValues?: DailyFormValues
  submitLabel: string
  /** Persists validated values and resolves with the saved Daily. */
  onSubmit: (values: DailyFormValues) => Promise<Daily>
}) {
  const transport = useApiTransport()
  const navigate = useNavigate()
  const descriptionId = useId()
  const timeZoneId = useId()

  const difficultiesQuery = useQuery({
    queryKey: difficultiesQueryKey,
    queryFn: ({ signal }) => listDifficulties(transport, signal),
    retry: false,
  })
  const difficultyMetadata = useMemo(
    () => difficultyRewardsMap(difficultiesQuery.data),
    [difficultiesQuery.data],
  )

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<DailyFormValues>({
    defaultValues: defaultValues ?? {
      title: '',
      description: '',
      difficulty: 'EASY',
      due_local_date: todayDateInput(),
      due_local_time: '',
      time_zone: browserTimeZone(),
    },
  })

  const [submitError, setSubmitError] = useState<string>()
  // While the form is submitting, its own success navigation must not be
  // intercepted by the dirty guard; any other dirty navigation stays blocked.
  const blocker = useBlocker(() => isDirty && !isSubmitting)

  // Warn before unload while the form is dirty (spec §5.3).
  useEffect(() => {
    if (!isDirty) {
      return
    }
    const handleUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [isDirty])

  const applyFieldIssues = (issues: z.core.$ZodIssue[] | readonly z.core.$ZodIssue[]): void => {
    for (const issue of issues) {
      const path = issue.path[0]
      if (typeof path === 'string' && isFormField(path)) {
        setError(path, { message: issue.message })
      }
    }
  }

  const submit = handleSubmit(async (values) => {
    setSubmitError(undefined)
    const parsed = zDailyForm.safeParse(values)
    if (!parsed.success) {
      applyFieldIssues(parsed.error.issues)
      return
    }
    setSubmitError(undefined)
    let saved: Daily
    try {
      saved = await onSubmit(parsed.data)
    } catch (error: unknown) {
      const mapped = mapApiFormError(error, FORM_FIELDS, {
        DAILY_PLAYER_NOT_READY: {
          form: true,
          message: 'Your Dailies are still being prepared. Try again in a moment.',
        },
      })
      if (mapped.aborted) {
        return
      }
      for (const [field, message] of Object.entries(mapped.fieldErrors)) {
        if (isFormField(field)) {
          setError(field, { message })
        }
      }
      if (mapped.formError !== undefined) {
        setSubmitError(mapped.formError)
      } else if (Object.keys(mapped.fieldErrors).length === 0) {
        setSubmitError('The Daily could not be saved.')
      }
      return
    }
    // Save succeeded: mark the form clean before navigating so the dirty
    // guard does not intercept the return trip. `isSubmitting` is still true
    // here, which also keeps the blocker unarmed.
    reset(parsed.data)
    const target =
      saved.due_local_date === todayDateInput()
        ? '/dailies'
        : `/dailies?date=${saved.due_local_date}`
    void navigate(target, {
      state: {
        dailyFocus: {
          dailyId: saved.id,
          verb: mode === 'create' ? 'created' : 'updated',
          title: saved.title,
        },
      },
    })
  })

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
      <Field
        autoComplete="off"
        error={errors.title?.message}
        hint="Required · up to 120 characters."
        label="Title"
        {...register('title')}
      />

      <div className={styles.field}>
        <label htmlFor={descriptionId}>Description</label>
        <textarea
          aria-describedby={
            errors.description?.message !== undefined ? `${descriptionId}-error` : undefined
          }
          aria-invalid={errors.description !== undefined ? true : undefined}
          className={styles.textarea}
          id={descriptionId}
          maxLength={1000}
          rows={4}
          {...register('description')}
        />
        <small id={`${descriptionId}-hint`}>Optional · up to 1000 characters.</small>
        {errors.description?.message !== undefined ? (
          <p className={styles.error} id={`${descriptionId}-error`}>
            {errors.description.message}
          </p>
        ) : null}
      </div>

      <fieldset className={styles.fieldset}>
        <legend>Difficulty</legend>
        <div className={styles.radios}>
          {DIFFICULTY_OPTIONS.map((option) => {
            const meta = difficultyMetadata.get(option)
            const label =
              meta === undefined
                ? difficultyLabel(option)
                : `${difficultyLabel(option)} — rewards ${meta.reward}, missed damage ${meta.damage}`
            return (
              <label className={styles.radio} key={option}>
                <input type="radio" value={option} {...register('difficulty')} />
                <span>{label}</span>
              </label>
            )
          })}
        </div>
        {difficultiesQuery.isPending ? <Skeleton lines={1} /> : null}
        {errors.difficulty?.message !== undefined ? (
          <p className={styles.error} role="alert">
            {errors.difficulty.message}
          </p>
        ) : null}
      </fieldset>

      <div className={styles.grid}>
        <Field
          error={errors.due_local_date?.message}
          hint="Local calendar date."
          label="Due date"
          type="date"
          {...register('due_local_date')}
        />
        <Field
          error={errors.due_local_time?.message}
          hint="Local wall-clock deadline."
          label="Due time"
          type="time"
          {...register('due_local_time')}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor={timeZoneId}>Time zone</label>
        <select id={timeZoneId} {...register('time_zone')}>
          {timeZones().map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <small id={`${timeZoneId}-hint`}>
          Advanced · Dailies recur at this local wall-clock time.
        </small>
      </div>

      {submitError !== undefined ? <FormError>{submitError}</FormError> : null}

      <div>
        <Button loading={isSubmitting} type="submit">
          {submitLabel}
        </Button>
      </div>

      {blocker.state === 'blocked' ? (
        <ConfirmationDialog
          confirmLabel="Discard changes"
          onCancel={() => {
            blocker.reset()
          }}
          onConfirm={() => {
            blocker.proceed()
          }}
          title="Discard unsaved changes?"
        >
          <p>Your edits have not been saved. Discard them and leave this page?</p>
        </ConfirmationDialog>
      ) : null}
    </form>
  )
}

/** Wire body for create and update: the local deadline pair plus zone. */
export function dailyRequestBody(values: DailyFormValues): CreateDailyInput {
  return {
    title: values.title,
    difficulty: values.difficulty,
    time_zone: values.time_zone,
    due_local_date: values.due_local_date,
    due_local_time: values.due_local_time,
    ...(values.description === '' ? {} : { description: values.description }),
  }
}

const DIFFICULTY_OPTIONS = ['EASY', 'MEDIUM', 'HARD'] as const

function isFormField(field: string): field is FormField {
  return (FORM_FIELDS as readonly string[]).includes(field)
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const FALLBACK_TIME_ZONES: readonly string[] = ['UTC']

let timeZonesCache: readonly string[] | undefined

function timeZones(): readonly string[] {
  if (timeZonesCache !== undefined) {
    return timeZonesCache
  }
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : FALLBACK_TIME_ZONES
  const browser = browserTimeZone()
  timeZonesCache = zones.includes(browser) ? zones : [browser, ...zones]
  return timeZonesCache
}
