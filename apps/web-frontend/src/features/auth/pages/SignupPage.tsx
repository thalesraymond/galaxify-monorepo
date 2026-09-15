import { useEffect, useRef, useState } from 'react'

import { useForm } from 'react-hook-form'
import { Link } from 'react-router'

import { Button, Field, FormError } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

import { PasswordField } from '../components/PasswordField'
import { SessionNotice } from '../components/SessionNotice'
import { zSignupForm, type SignupForm } from '../forms/authSchemas'
import { mapAuthError } from '../forms/mapAuthError'
import { useSession } from '../session/SessionProvider'
import styles from './AuthForm.module.css'

const signupFields = ['email', 'username', 'password'] as const

export function SignupPage() {
  const { manager, notice } = useSession()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupForm>({ defaultValues: { email: '', username: '', password: '' } })
  const formRef = useRef<HTMLFormElement>(null)
  const [formError, setFormError] = useState<string>()

  // Keep focus on the first invalid field so keyboard and screen-reader users
  // land on the problem (`web-frontend.md` §5.1).
  useEffect(() => {
    const firstInvalid = signupFields.find((field) => errors[field] !== undefined)
    if (firstInvalid !== undefined) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus()
    }
  }, [errors])

  async function submitValues(values: SignupForm): Promise<void> {
    setFormError(undefined)
    const parsed = zSignupForm.safeParse(values)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (
          typeof field === 'string' &&
          signupFields.includes(field as (typeof signupFields)[number])
        ) {
          setError(field as (typeof signupFields)[number], { message: issue.message })
        }
      }
      return
    }

    try {
      await manager.signup(parsed.data)
    } catch (error: unknown) {
      const mapped = mapAuthError(error, signupFields)
      for (const [field, message] of Object.entries(mapped.fieldErrors)) {
        setError(field as (typeof signupFields)[number], { message })
      }
      setFormError(mapped.formError)
    }
  }

  const submit = handleSubmit((values) => submitValues(values))

  return (
    <div className={styles.page}>
      <PageHeader
        tone="on-light"
        title="Create your account"
        description="Start your logbook, complete Dailies, and keep your Ship flying."
      />
      <SessionNotice notice={notice} />
      <form
        ref={formRef}
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <Field
          autoComplete="email"
          error={errors.email?.message}
          label="Email"
          type="email"
          {...register('email')}
        />
        <Field
          autoComplete="username"
          error={errors.username?.message}
          hint="3–30 characters."
          label="Username"
          {...register('username')}
        />
        <PasswordField
          autoComplete="new-password"
          error={errors.password?.message}
          hint="At least 8 characters."
          label="Password"
          {...register('password')}
        />
        {formError !== undefined ? <FormError>{formError}</FormError> : null}
        <div className={styles.actions}>
          <Button loading={isSubmitting} type="submit">
            Create account
          </Button>
          <p className={styles.crossLink}>
            Already have an account? <Link to="/login">Sign in</Link>.
          </p>
        </div>
      </form>
    </div>
  )
}
