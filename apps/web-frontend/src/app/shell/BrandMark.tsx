export function BrandMark({ className }: { className?: string | undefined }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M6 24 16 5l10 19-10-5Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3 28h26M16 19v9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}
