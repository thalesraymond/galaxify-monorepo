export function validateProxyTarget(value: string, envKey: string): string {
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new Error(`${envKey} must be an absolute http(s) service origin`)
  }

  if (
    (target.protocol !== 'http:' && target.protocol !== 'https:') ||
    target.username !== '' ||
    target.password !== '' ||
    target.pathname !== '/' ||
    target.search !== '' ||
    target.hash !== ''
  ) {
    throw new Error(
      `${envKey} must be an absolute http(s) service origin without credentials or a path`,
    )
  }

  return target.origin
}
