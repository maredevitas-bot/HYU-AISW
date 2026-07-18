import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadFoodLog, removeFoodLog, type FoodLogEntry } from '../foodLog'
import {
  formatNutrient,
  makeDailyTarget,
  nutrientMeta,
  nutrientPercent,
  sumNutrients,
  todayInputValue,
  type Activity,
  type Gender,
  type Nutrients,
} from '../nutrition'

type CalendarPageProps = {
  ownerId: string
  gender: Gender
  activity: Activity
  refreshKey: number
}

const weekDays = ['월', '화', '수', '목', '금', '토', '일']
const mealTypeLabels = { breakfast: '아침', lunch: '점심', dinner: '저녁', snack: '간식' }

function monthValue(date: string) {
  return date.slice(0, 7)
}

function moveMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7)
}

function monthCells(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, monthNumber - 1, 1))
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const mondayOffset = (first.getUTCDay() + 6) % 7
  return [
    ...Array.from({ length: mondayOffset }, () => ''),
    ...Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`),
  ]
}

function statusFor(total: Nutrients, target: Nutrients) {
  const over = total.kcal > target.kcal * 1.15 || total.sodium > target.sodium || total.fat > target.fat * 1.2
  const low = total.kcal < target.kcal * 0.8 || total.protein < target.protein * 0.8 || total.calcium < target.calcium * 0.8
  if (over) return 'over'
  if (low) return 'low'
  return 'balanced'
}

export default function CalendarPage({ ownerId, gender, activity, refreshKey }: CalendarPageProps) {
  const today = todayInputValue()
  const [month, setMonth] = useState(monthValue(today))
  const [selectedDate, setSelectedDate] = useState(today)
  const [entries, setEntries] = useState<FoodLogEntry[]>([])
  const [status, setStatus] = useState('기록을 불러오는 중')

  const loadEntries = useCallback(async () => {
    setStatus('기록을 불러오는 중')
    try {
      const payload = await loadFoodLog(ownerId, month)
      setEntries(payload.entries)
      setStatus(payload.entries.length ? `${payload.entries.length}개의 섭취 기록` : '이 달에는 아직 기록이 없습니다.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '기록을 불러오지 못했습니다.')
    }
  }, [month, ownerId])

  useEffect(() => { void loadEntries() }, [loadEntries, refreshKey])

  const dailyEntries = useMemo(() => entries.filter((entry) => entry.date === selectedDate), [entries, selectedDate])
  const dailyTotal = useMemo(() => sumNutrients(dailyEntries.map((entry) => entry.nutrients)), [dailyEntries])
  const target = useMemo(() => makeDailyTarget(gender, activity), [activity, gender])
  const cells = useMemo(() => monthCells(month), [month])
  const byDate = useMemo(() => entries.reduce<Record<string, FoodLogEntry[]>>((groups, entry) => {
    groups[entry.date] = [...(groups[entry.date] ?? []), entry]
    return groups
  }, {}), [entries])

  const assessments = nutrientMeta.map(({ key, label, unit }) => {
    const ratio = target[key] > 0 ? dailyTotal[key] / target[key] : 0
    const state = key === 'sodium'
      ? (ratio > 1 ? 'over' : 'balanced')
      : ratio > 1.15 ? 'over' : ratio < 0.8 ? 'low' : 'balanced'
    return { key, label, unit, state, ratio }
  })
  const excessive = assessments.filter((item) => item.state === 'over').map((item) => item.label)
  const insufficient = assessments.filter((item) => item.state === 'low').map((item) => item.label)

  const changeMonth = (nextMonth: string) => {
    setMonth(nextMonth)
    setSelectedDate(nextMonth === monthValue(today) ? today : `${nextMonth}-01`)
  }

  const deleteEntry = async (entry: FoodLogEntry) => {
    try {
      await removeFoodLog(ownerId, entry.id)
      await loadEntries()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '기록을 삭제하지 못했습니다.')
    }
  }

  return (
    <section className="page-stack" aria-labelledby="calendar-title">
      <header className="page-heading">
        <div><span>하루 식단 노트</span><h1 id="calendar-title">푸드 캘린더</h1><p>급식과 스캔 식품을 날짜별로 합산해 지금까지의 과다·부족 영양소를 확인합니다.</p></div>
        <div className="month-controls"><button type="button" aria-label="이전 달" onClick={() => changeMonth(moveMonth(month, -1))}>‹</button><input aria-label="조회할 달" type="month" value={month} onChange={(event) => changeMonth(event.target.value)} /><button type="button" aria-label="다음 달" onClick={() => changeMonth(moveMonth(month, 1))}>›</button></div>
      </header>

      <div className="calendar-layout">
        <article className="panel calendar-panel">
          <div className="calendar-summary"><strong>{month.replace('-', '년 ')}월</strong><span>{status}</span></div>
          <div className="week-header">{weekDays.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-grid">
            {cells.map((date, index) => {
              if (!date) return <span className="calendar-blank" key={`blank-${index}`} />
              const dayEntries = byDate[date] ?? []
              const total = sumNutrients(dayEntries.map((entry) => entry.nutrients))
              const dayStatus = dayEntries.length ? statusFor(total, target) : 'empty'
              return (
                <button className={`calendar-day ${selectedDate === date ? 'selected' : ''}`} key={date} type="button" onClick={() => setSelectedDate(date)}>
                  <span>{Number(date.slice(-2))}</span>
                  {dayEntries.length > 0 && <><strong>{Math.round(total.kcal).toLocaleString('ko-KR')} kcal</strong><em className={dayStatus}>{dayStatus === 'over' ? '과다' : dayStatus === 'low' ? '부족' : '적정'}</em></>}
                </button>
              )
            })}
          </div>
        </article>

        <div className="page-stack compact">
          <article className="panel daily-summary">
            <div className="panel-heading"><span>{selectedDate}</span><h2>오늘의 영양 판정</h2></div>
            {dailyEntries.length > 0 ? <>
              <div className="summary-callouts">
                <div className={excessive.length ? 'summary-callout over' : 'summary-callout balanced'}><span>과도한 영양소</span><strong>{excessive.length ? excessive.join(', ') : '없음'}</strong></div>
                <div className={insufficient.length ? 'summary-callout low' : 'summary-callout balanced'}><span>부족한 영양소</span><strong>{insufficient.length ? insufficient.join(', ') : '없음'}</strong></div>
              </div>
              <p className="summary-note">현재 저장된 식사만 합산한 결과입니다. 먹은 음식을 추가할수록 하루 판정이 갱신됩니다.</p>
              <div className="nutrient-list">{assessments.map(({ key, label, unit, state }) => <div className={`nutrient-row ${state}`} key={key}><div><strong>{label}</strong><span>{formatNutrient(dailyTotal[key], unit)} / {formatNutrient(target[key], unit)}</span></div><div className="meter" aria-label={`${label} ${nutrientPercent(dailyTotal[key], target[key])}%`}><span style={{ width: `${nutrientPercent(dailyTotal[key], target[key])}%` }} /></div></div>)}</div>
            </> : <p className="empty-state">선택한 날짜에 저장된 음식이 없습니다. 급식 또는 바코드 페이지에서 섭취 기록을 추가해 주세요.</p>}
          </article>

          <article className="panel">
            <div className="panel-heading"><span>식단 노트</span><h2>먹은 음식 {dailyEntries.length}개</h2></div>
            <div className="food-entry-list">{dailyEntries.map((entry) => <div className="food-entry" key={entry.id}><div><span>{mealTypeLabels[entry.mealType]}</span><strong>{entry.name}</strong><small>{entry.source === 'meal' ? 'NEIS 급식' : '바코드 제품'} · {entry.quantity}회분</small></div><div><strong>{Math.round(entry.nutrients.kcal).toLocaleString('ko-KR')} kcal</strong><button type="button" aria-label={`${entry.name} 기록 삭제`} onClick={() => void deleteEntry(entry)}>삭제</button></div></div>)}</div>
          </article>
        </div>
      </div>
    </section>
  )
}
