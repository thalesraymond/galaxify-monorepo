import { DailyHistoryPage } from './pages/DailyHistoryPage'
import { DailiesListPage } from './pages/DailiesListPage'
import { EditDailyPage } from './pages/EditDailyPage'
import { NewDailyPage } from './pages/NewDailyPage'

export { DailyHistoryPage, DailiesListPage, EditDailyPage, NewDailyPage }
export { dailyTabs } from './navigation'
// API surface the Dashboard will compose when it renders today's Dailies.
export {
  completeDaily,
  createDaily,
  dailyHistoryQueryKey,
  dailyQueryKey,
  dailiesQueryKey,
  deleteDaily,
  difficultiesQueryKey,
  getDaily,
  listDailyHistory,
  listDailies,
  listDifficulties,
  updateDaily,
} from './api/dailyApi'
export type {
  CreateDailyInput,
  DailyHistoryFilters,
  DailyListFilters,
  UpdateDailyInput,
} from './api/dailyApi'
