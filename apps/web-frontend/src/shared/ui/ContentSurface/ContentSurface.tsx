import type { HTMLAttributes } from 'react'
import { classNames } from '../classNames'
import styles from './ContentSurface.module.css'
export type ContentSurfaceProps = HTMLAttributes<HTMLElement> & {
  tone?: 'logbook' | 'raised'
  as?: 'article' | 'section' | 'div'
}
export function ContentSurface({
  as: Tag = 'section',
  className,
  tone = 'logbook',
  ...props
}: ContentSurfaceProps) {
  return <Tag {...props} className={classNames(styles.surface, styles[tone], className)} />
}
