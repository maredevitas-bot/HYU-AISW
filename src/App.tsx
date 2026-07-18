import { useEffect, useMemo, useState } from 'react'
import heroImage from './assets/hero.png'
import './App.css'
import { getOwnerId } from './foodLog'
import { type Activity, type Gender } from './nutrition'
import CalendarPage from './pages/CalendarPage'
import MealPage from './pages/MealPage'
import ScanPage from './pages/ScanPage'

type Page = 'meal' | 'scan' | 'calendar'

const pages: { id: Page; path: string; label: string; description: string }[] = [
  { id: 'meal', path: '/meal', label: '급식 영양', description: '급식표와 섭취량' },
  { id: 'scan', path: '/scan', label: '바코드·분리배출', description: '제품 영양과 포장' },
  { id: 'calendar', path: '/calendar', label: '푸드 캘린더', description: '하루 영양 기록' },
]

function pageFromPath(): Page {
  const page = pages.find((item) => window.location.pathname === item.path)
  return page?.id ?? 'meal'
}

function savedGender(): Gender {
  return window.localStorage.getItem('nutricycle-gender') === 'male' ? 'male' : 'female'
}

function savedActivity(): Activity {
  const value = window.localStorage.getItem('nutricycle-activity')
  return value === 'low' || value === 'high' ? value : 'normal'
}

function App() {
  const ownerId = useMemo(() => getOwnerId(), [])
  const [page, setPage] = useState<Page>(pageFromPath)
  const [gender, setGender] = useState<Gender>(savedGender)
  const [activity, setActivity] = useState<Activity>(savedActivity)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const handlePopState = () => setPage(pageFromPath())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => { window.localStorage.setItem('nutricycle-gender', gender) }, [gender])
  useEffect(() => { window.localStorage.setItem('nutricycle-activity', activity) }, [activity])

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
              <strong>{item.label}</strong><span>{item.description}</span>
            </button>
          ))}
        </nav>
      </header>

      <main>
        {page === 'meal' && <MealPage ownerId={ownerId} gender={gender} activity={activity} onGenderChange={setGender} onActivityChange={setActivity} onSaved={() => setRefreshKey((value) => value + 1)} />}
        {page === 'scan' && <ScanPage ownerId={ownerId} onSaved={() => setRefreshKey((value) => value + 1)} />}
        {page === 'calendar' && <CalendarPage ownerId={ownerId} gender={gender} activity={activity} refreshKey={refreshKey} />}
      </main>
    </div>
  )
}

export default App
