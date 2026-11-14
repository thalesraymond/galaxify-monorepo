import styles from './ShipHullDiagram.module.css'

export function ShipHullDiagram({ hull }: { hull: number }) {
  const safeHull = Math.min(Math.max(hull, 0), 100)
  const rows = [2, 4, 4, 4, 6, 6, 10, 12, 14, 14, 10, 6, 4, 4]
  let cell = 0

  return (
    <svg
      className={styles.diagram}
      viewBox="0 0 256 240"
      role="img"
      aria-label={`Ship hull diagram: ${safeHull} of 100 cells intact`}
    >
      {rows.flatMap((count, row) =>
        Array.from({ length: count }, (_, col) => {
          const intact = cell++ < safeHull
          const aftColumn = row === 11 ? [3, 4, 7, 8, 11, 12][col] : [3, 4, 11, 12][col]
          const x = row >= 11 ? (aftColumn ?? 0) * 16 : (256 - count * 16) / 2 + col * 16
          return (
            <rect
              key={`${row}-${col}`}
              x={x}
              y={8 + row * 16}
              width="12"
              height="12"
              rx="1"
              className={intact ? styles.intact : styles.damaged}
              data-state={intact ? 'intact' : 'damaged'}
            />
          )
        }),
      )}
    </svg>
  )
}
