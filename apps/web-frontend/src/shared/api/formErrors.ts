import { isApiTransportError } from '@/api/transport'

export type FieldErrorMap = Readonly<Record<string, string>>

/**
 * Optional per-code overrides. `field` attaches the message to one field;
 * `form: true` raises it as the form-level error. Unknown codes fall back to
 * the backend's own field errors and message.
 */
export type CodeMessageMap = Readonly<
  Record<string, { readonly message: string; readonly field?: string; readonly form?: boolean }>
>

export type MappedFormError = {
  readonly fieldErrors: FieldErrorMap
  readonly formError: string | undefined
  /** True when the request was aborted; callers should not surface an error. */
  readonly aborted: boolean
}

/**
 * Domain-neutral normalization of transport failures into inline field errors
 * plus one form-level message. Feature adapters supply their code synonyms
 * (`docs/specs/web-frontend.md` §7 — branch on code, not status).
 */
export function mapApiFormError(
  error: unknown,
  fields: readonly string[],
  codeMessages: CodeMessageMap = {},
): MappedFormError {
  if (!isApiTransportError(error)) {
    return { fieldErrors: {}, formError: 'Something went wrong. Try again.', aborted: false }
  }

  if (error.kind === 'aborted') {
    return { fieldErrors: {}, formError: undefined, aborted: true }
  }

  if (error.kind !== 'api') {
    return {
      fieldErrors: {},
      formError: 'We could not reach the service. Try again.',
      aborted: false,
    }
  }

  const fieldErrors: Record<string, string> = {}
  for (const [key, message] of Object.entries(error.fieldErrors ?? {})) {
    if (fields.includes(key)) {
      fieldErrors[key] = message
    }
  }

  const override = codeMessages[error.code]
  if (override !== undefined) {
    if (override.form === true) {
      return { fieldErrors, formError: override.message, aborted: false }
    }
    const field = override.field ?? fields[0]
    if (field !== undefined) {
      fieldErrors[field] = override.message
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, formError: undefined, aborted: false }
  }
  return { fieldErrors, formError: error.message, aborted: false }
}
