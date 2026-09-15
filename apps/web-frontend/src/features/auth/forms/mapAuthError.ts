import { mapApiFormError, type CodeMessageMap, type MappedFormError } from '@/shared/api/formErrors'

const authCodeMessages: CodeMessageMap = {
  USER_EMAIL_TAKEN: { field: 'email', message: 'That email is already registered.' },
  USER_USERNAME_TAKEN: { field: 'username', message: 'That username is already taken.' },
  USER_INVALID_CREDENTIALS: { form: true, message: 'Email or password is incorrect.' },
}

/**
 * Auth-specific error mapping. Backend field errors stay attached to their
 * fields; unique-constraint and credential codes map to fixed messages
 * (`web-frontend.md` §5.1, §7).
 */
export function mapAuthError(error: unknown, fields: readonly string[]): MappedFormError {
  return mapApiFormError(error, fields, authCodeMessages)
}
