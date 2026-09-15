import { useEffect, useRef, useState } from 'react'

import { useForm } from 'react-hook-form'
import { Link } from 'react-router'

import { Button, Field, FormError } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

import { PasswordField } from '../components/PasswordField'
import { SessionNotice } from '../components/SessionNotice'
import { zLoginForm, type LoginForm } from '../forms/authSchemas'
import { mapAuthError } from '../forms/mapAuthError'
import { useSession } from '../session/SessionProvider'
import styles from './AuthForm.module.css'

const loginFields = ['email', 'password'] as const

export function LoginPage() {
  const { manager, notice } = useSession()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ defaultValues: { email: '', password: '' } })
  const formRef = useRef<HTMLFormElement>(null)
  const [formError, setFormError] = useState<string>()

  useEffect(() => {
    const firstInvalid = loginFields.find((field) => errors[field] !== undefined)
    if (firstInvalid !== undefined) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus()
    }
  }, [errors])

  async function submitValues(values: LoginForm): Promise<void> {
    setFormError(undefined)
    const parsed = zLoginForm.safeParse(values)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (
          typeof field === 'string' &&
          loginFields.includes(field as (typeof loginFields)[number])
        ) {
          setError(field as (typeof loginFields)[number], { message: issue.message })
        }
      }
      return
    }

    try {
      await manager.login(parsed.data)
    } catch (error: unknown) {
      const mapped = mapAuthError(error, loginFields)
      for (const [field, message] of Object.entries(mapped.fieldErrors)) {
        setError(field as (typeof loginFields)[number], { message })
      }
      setFormError(mapped.formError)
    }
  }

  const submit = handleSubmit((values) => submitValues(values))

  return (
    <div className={styles.page}>
      <PageHeader
        tone="on-light"
        title="Sign in"
        description="Return to your Dailies, Ship, and Expeditions."
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
        <PasswordField
          autoComplete="current-password"
          error={errors.password?.message}
          label="Password"
          {...register('password')}
        />
        {formError !== undefined ? <FormError>{formError}</FormError> : null}
        <div className={styles.actions}>
          <Button loading={isSubmitting} type="submit">
            Sign in
          </Button>
          <p className={styles.crossLink}>
            New to Galaxify? <Link to="/signup">Create an account</Link>.
          </p>
        </div>
      </form>
    </div>
  )
}
