import '@/shared/styles/tokens.css'

import { resolveRootContainer } from '@/app/dom'
import { mountApp } from '@/app/mount'

mountApp(resolveRootContainer())
