export type ClassNameValue = string | false | null | undefined

/**
 * Joins truthy class name fragments. Domain-neutral helper for composing CSS
 * Module class names without importing a utility CSS framework.
 */
export function classNames(...values: readonly ClassNameValue[]): string {
  return values.filter((value): value is string => typeof value === 'string').join(' ')
}
