export function LiveRegion({
  message,
  assertive = false,
}: {
  message: string
  assertive?: boolean
}) {
  return (
    <p aria-live={assertive ? 'assertive' : 'polite'} aria-atomic="true" className="sr-only">
      {message}
    </p>
  )
}
