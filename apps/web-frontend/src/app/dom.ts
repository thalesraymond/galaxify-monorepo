/**
 * Resolves the application container without coupling root lookup to the
 * module evaluation order of the entry point.
 */
export function resolveRootContainer(documentRoot: Document = document): HTMLElement {
  const container = documentRoot.getElementById('root')

  if (!container) {
    throw new Error('Unable to find the #root application container.')
  }

  return container
}
