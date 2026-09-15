import { useEffect, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { z } from 'zod'

import type { UserResponse } from '@/api/generated/user/types.gen'
import { useSession } from '@/features/auth'
import { mapApiFormError } from '@/shared/api/formErrors'
import { useApiTransport } from '@/shared/api/TransportContext'
import { Button, ContentSurface, Dialog, Field, LiveRegion, Skeleton } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

import { getProfile, profileQueryKey, updateProfile } from '../api/profileApi'
import styles from './ProfilePage.module.css'

const usernameFields = ['username'] as const

const zUsername = z
  .string()
  .trim()
  .min(3, 'Username must be 3–30 characters.')
  .max(30, 'Username must be 3–30 characters.')

function focusDeletePassword(): void {
  document.getElementById('delete-account-password')?.focus()
}

const memberSinceFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

function formatMemberSince(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : memberSinceFormatter.format(date)
}

export function ProfilePage() {
  const transport = useApiTransport()
  const { user: sessionUser, manager } = useSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const query = useQuery({
    queryKey: profileQueryKey,
    queryFn: ({ signal }) => getProfile(transport, signal),
  })
  const user = query.data ?? sessionUser

  if (user === undefined) {
    return (
      <div className={styles.page}>
        <PageHeader title="Profile" description="Review your identity and account actions." />
        <Skeleton lines={4} />
      </div>
    )
  }

  return (
    <ProfileContent
      key={user.id}
      user={user}
      onUpdated={(updated) => {
        manager.updateUser(updated)
        queryClient.setQueryData(profileQueryKey, updated)
      }}
      onDeleted={() => {
        // Deletion purges state directly; it never calls logout. Land on signup.
        void navigate('/signup', { replace: true })
      }}
      deleteAccount={(password) => manager.deleteAccount(password)}
    />
  )
}

function ProfileContent({
  user,
  onUpdated,
  onDeleted,
  deleteAccount,
}: {
  user: UserResponse
  onUpdated: (user: UserResponse) => void
  onDeleted: () => void
  deleteAccount: (password: string) => Promise<void>
}) {
  const transport = useApiTransport()
  const [successMessage, setSuccessMessage] = useState<string>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState<string>()
  const [isDeleting, setIsDeleting] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<{ username: string }>({ defaultValues: { username: user.username } })

  const updateMutation = useMutation({
    mutationFn: (username: string) => updateProfile(transport, { username }),
    onSuccess: (updated) => {
      reset({ username: updated.username })
      setSuccessMessage('Your username was updated.')
      onUpdated(updated)
    },
    onError: (error: unknown) => {
      const mapped = mapApiFormError(error, usernameFields, {
        USER_USERNAME_TAKEN: { field: 'username', message: 'That username is already taken.' },
      })
      for (const [field, message] of Object.entries(mapped.fieldErrors)) {
        setError(field as (typeof usernameFields)[number], { message })
      }
      if (mapped.formError !== undefined) {
        setError('username', { message: mapped.formError })
      }
    },
  })

  // Clear the announcement so an identical later update is announced again.
  useEffect(() => {
    if (successMessage === undefined) {
      return
    }
    const handle = setTimeout(() => {
      setSuccessMessage(undefined)
    }, 4_000)
    return () => {
      clearTimeout(handle)
    }
  }, [successMessage])

  // The dialog focuses its own first control (the close button); move focus to
  // the password field once the destructive dialog opens.
  useEffect(() => {
    if (deleteOpen) {
      focusDeletePassword()
    }
  }, [deleteOpen])

  const submitUsername = handleSubmit((values) => {
    setSuccessMessage(undefined)
    const parsed = zUsername.safeParse(values.username)
    if (!parsed.success) {
      setError('username', { message: parsed.error.issues[0]?.message ?? 'Enter a username.' })
      return
    }
    updateMutation.mutate(parsed.data)
  })

  async function confirmDelete() {
    setDeleteError(undefined)
    if (deletePassword.trim() === '') {
      setDeleteError('Enter your password to confirm.')
      focusDeletePassword()
      return
    }
    setIsDeleting(true)
    try {
      await deleteAccount(deletePassword)
      setDeleteOpen(false)
      onDeleted()
    } catch (error: unknown) {
      const mapped = mapApiFormError(error, ['password'])
      setDeleteError(
        mapped.fieldErrors.password ?? mapped.formError ?? 'We could not delete your account.',
      )
      focusDeletePassword()
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Profile" description="Review your identity and account actions." />

      <ContentSurface aria-labelledby="identity-heading">
        <h2 id="identity-heading">Identity</h2>
        <dl className={styles.identity}>
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{formatMemberSince(user.created_at)}</dd>
          </div>
        </dl>

        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            void submitUsername(event)
          }}
        >
          <Field
            autoComplete="username"
            error={errors.username?.message}
            hint="3–30 characters."
            label="Username"
            {...register('username')}
          />
          <div>
            <Button loading={isSubmitting || updateMutation.isPending} type="submit">
              Save username
            </Button>
          </div>
        </form>
        {successMessage !== undefined ? <LiveRegion message={successMessage} /> : null}
      </ContentSurface>

      <ContentSurface aria-labelledby="danger-heading" tone="raised">
        <h2 id="danger-heading">Danger zone</h2>
        <p>
          Deleting your account permanently removes your Player, Dailies, Ship, and Expeditions.
          This cannot be undone.
        </p>
        <Button
          variant="danger"
          onClick={() => {
            setDeletePassword('')
            setDeleteError(undefined)
            setDeleteOpen(true)
          }}
        >
          Delete account
        </Button>
      </ContentSurface>

      {deleteOpen ? (
        <Dialog
          title="Delete your account"
          onClose={() => {
            setDeleteOpen(false)
          }}
        >
          <p>
            Enter your password to permanently delete <strong>{user.username}</strong>. This cannot
            be undone.
          </p>
          <Field
            error={deleteError}
            id="delete-account-password"
            label="Password"
            type="password"
            value={deletePassword}
            onChange={(event) => {
              setDeletePassword(event.target.value)
            }}
          />
          <div className={styles.dialogActions}>
            <Button
              variant="quiet"
              onClick={() => {
                setDeleteOpen(false)
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" loading={isDeleting} onClick={() => void confirmDelete()}>
              Delete account
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}
