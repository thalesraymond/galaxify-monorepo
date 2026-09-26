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
import { todayDateInput } from '../lib/dailyTime'
import { difficultyLabel, difficultyRewardsMap } from '../lib/difficulties'
import styles from './DailyForm.module.css'

const FORM_FIELDS = ['title', 'description', 'difficulty'] as const

type FormField = (typeof FORM_FIELDS)[number]

export type DailyFormValues = {
  title: string
  description: string
  difficulty: Difficulty
}

const zDailyForm = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Enter a title.')
    .max(120, 'Titles are limited to 120 characters.'),
  description: z.string().trim().max(1000, 'Descriptions are limited to 1000 characters.'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD'], { message: 'Choose a difficulty.' }),
})

/**
 * Shared Daily creation/editing form (spec §5.3): title, optional description,
 * difficulty with backend reward/damage metadata. The backend owns the
 * recurring deadline. Validation
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
      } else if (Object.keys(mapped.fieldErrors).every((field) => !isFormField(field))) {
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

/** Wire body for create and update; scheduling remains backend-owned. */
export function dailyRequestBody(values: DailyFormValues): CreateDailyInput {
  return {
    title: values.title,
    difficulty: values.difficulty,
    ...(values.description === '' ? {} : { description: values.description }),
  }
}

const DIFFICULTY_OPTIONS = ['EASY', 'MEDIUM', 'HARD'] as const

function isFormField(field: string): field is FormField {
  return (FORM_FIELDS as readonly string[]).includes(field)
}
