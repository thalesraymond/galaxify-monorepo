import { Button } from '../Button/Button'
export function LoadMore({
  loading = false,
  onLoadMore,
}: {
  loading?: boolean
  onLoadMore: () => void
}) {
  return (
    <Button loading={loading} onClick={onLoadMore}>
      Load more
    </Button>
  )
}
