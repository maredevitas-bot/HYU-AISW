import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ScanBarcode, Utensils, type LucideIcon } from 'lucide-react'
import heroImage from './assets/hero.png'
import './App.css'
import { getOwnerId } from './foodLog'
import { type AgeGroup, type Gender } from './nutrition'
import CalendarPage from './pages/CalendarPage'
import MealPage from './pages/MealPage'
import ScanPage from './pages/ScanPage'

type Page = 'meal' | 'scan' | 'calendar'

const pages: { id: Page; path: string; label: string; description: string; icon: LucideIcon }[] = [
  { id: 'meal', path: '/meal', label: '급식 영양', description: '급식표와 섭취량', icon: Utensils },
  { id: 'scan', path: '/scan', label: '바코드·분리배출', description: '제품 영양과 포장', icon: ScanBarcode },
  { id: 'calendar', path: '/calendar', label: '푸드 캘린더', description: '하루 영양 기록', icon: CalendarDays },
]

function pageFromPath(): Page {
  const page = pages.find((item) => window.location.pathname === item.path)
  return page?.id ?? 'meal'
}

function savedGender(): Gender {
  return window.localStorage.getItem('nutricycle-gender') === 'male' ? 'male' : 'female'
}

function savedAgeGroup(): AgeGroup {
  return window.localStorage.getItem('nutricycle-age-group') === '12-14' ? '12-14' : '15-18'
}

function App() {
  const ownerId = useMemo(() => getOwnerId(), [])
  const [page, setPage] = useState<Page>(pageFromPath)
  const [gender, setGender] = useState<Gender>(savedGender)
  const [ageGroup, setAgeGroup] = useState<AgeGroup>(savedAgeGroup)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const handlePopState = () => setPage(pageFromPath())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => { window.localStorage.setItem('nutricycle-gender', gender) }, [gender])
  useEffect(() => { window.localStorage.setItem('nutricycle-age-group', ageGroup) }, [ageGroup])

  const navigate = (next: Page) => {
    const item = pages.find((candidate) => candidate.id === next)
    if (!item || page === next) return
    window.history.pushState({}, '', item.path)
    setPage(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" type="button" onClick={() => navigate('meal')} aria-label="NutriCycle 급식 영양 페이지">
          <img src={heroImage} alt="" />
          <span><strong>NutriCycle</strong><small>먹은 만큼 기록하고, 포장은 제대로 분리하기</small></span>
        </button>
        <nav className="page-tabs" aria-label="주요 페이지">
          {pages.map((item) => (
            <button className={page === item.id ? 'page-tab active' : 'page-tab'} key={item.id} type="button" onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}>
              <item.icon aria-hidden="true" size={20} strokeWidth={2.2} />
              <span className="page-tab-copy"><strong>{item.label}</strong><span>{item.description}</span></span>
            </button>
          ))}
        </nav>
      </header>

      <main>
        {page === 'meal' && <MealPage ownerId={ownerId} gender={gender} ageGroup={ageGroup} onGenderChange={setGender} onAgeGroupChange={setAgeGroup} onSaved={() => setRefreshKey((value) => value + 1)} />}
        {page === 'scan' && <ScanPage ownerId={ownerId} onSaved={() => setRefreshKey((value) => value + 1)} />}
        {page === 'calendar' && <CalendarPage ownerId={ownerId} refreshKey={refreshKey} />}
      </main>
    </div>
  )
}

export default App
