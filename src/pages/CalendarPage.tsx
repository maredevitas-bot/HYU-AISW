import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadFoodLog, removeFoodLog, saveFoodLog, type FoodLogEntry } from '../foodLog'
import {
  emptyNutrients,
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

function hasNutrition(entry: FoodLogEntry) {
  return nutrientMeta.some(({ key }) => entry.nutrients[key] > 0)
}

export default function CalendarPage({ ownerId, gender, activity, refreshKey }: CalendarPageProps) {
  const today = todayInputValue()
  const [month, setMonth] = useState(monthValue(today))
  const [selectedDate, setSelectedDate] = useState(today)
  const [entries, setEntries] = useState<FoodLogEntry[]>([])
  const [status, setStatus] = useState('기록을 불러오는 중')
  const [manualFoodName, setManualFoodName] = useState('')

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
  const dailyNutritionEntries = useMemo(() => dailyEntries.filter(hasNutrition), [dailyEntries])
  const dailyTotal = useMemo(() => sumNutrients(dailyNutritionEntries.map((entry) => entry.nutrients)), [dailyNutritionEntries])
  const manualEntryCount = dailyEntries.length - dailyNutritionEntries.length
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

  const addManualFood = async () => {
    const name = manualFoodName.trim()
    if (!name) {
      setStatus('기록할 음식 이름을 입력해 주세요.')
      return
    }

    try {
      await saveFoodLog({
        ownerId,
        date: selectedDate,
        entryKey: `manual:${Date.now()}`,
        source: 'manual',
        mealType: 'snack',
        name,
        quantity: 1,
        nutrients: emptyNutrients(),
        metadata: { nutritionUnavailable: true },
      })
      setManualFoodName('')
      await loadEntries()
      setStatus(`${selectedDate}에 ${name} 기록을 추가했습니다.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '음식 기록을 저장하지 못했습니다.')
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
              const nutritionEntries = dayEntries.filter(hasNutrition)
              const total = sumNutrients(nutritionEntries.map((entry) => entry.nutrients))
              const dayStatus = nutritionEntries.length ? statusFor(total, target) : dayEntries.length ? 'noted' : 'empty'
              return (
                <button className={`calendar-day ${selectedDate === date ? 'selected' : ''}`} key={date} type="button" onClick={() => setSelectedDate(date)}>
                  <span>{Number(date.slice(-2))}</span>
                  {dayEntries.length > 0 && <><strong>{nutritionEntries.length ? `${Math.round(total.kcal).toLocaleString('ko-KR')} kcal` : `${dayEntries.length}개 기록`}</strong><em className={dayStatus}>{dayStatus === 'over' ? '과다' : dayStatus === 'low' ? '부족' : dayStatus === 'noted' ? '메모' : '적정'}</em></>}
                </button>
              )
            })}
          </div>
        </article>

        <div className="page-stack compact">
          <article className="panel daily-summary">
            <div className="panel-heading"><span>{selectedDate}</span><h2>오늘의 영양 판정</h2></div>
            {dailyNutritionEntries.length > 0 ? <>
              <div className="summary-callouts">
                <div className={excessive.length ? 'summary-callout over' : 'summary-callout balanced'}><span>과도한 영양소</span><strong>{excessive.length ? excessive.join(', ') : '없음'}</strong></div>
                <div className={insufficient.length ? 'summary-callout low' : 'summary-callout balanced'}><span>부족한 영양소</span><strong>{insufficient.length ? insufficient.join(', ') : '없음'}</strong></div>
              </div>
              <p className="summary-note">영양 정보가 있는 기록만 합산한 결과입니다.{manualEntryCount > 0 ? ` 성분을 알 수 없는 직접 기록 ${manualEntryCount}개는 판정에서 제외했습니다.` : ''}</p>
              <div className="nutrient-list">{assessments.map(({ key, label, unit, state }) => <div className={`nutrient-row ${state}`} key={key}><div><strong>{label}</strong><span>{formatNutrient(dailyTotal[key], unit)} / {formatNutrient(target[key], unit)}</span></div><div className="meter" aria-label={`${label} ${nutrientPercent(dailyTotal[key], target[key])}%`}><span style={{ width: `${nutrientPercent(dailyTotal[key], target[key])}%` }} /></div></div>)}</div>
            </> : dailyEntries.length > 0 ? <div className="unknown-nutrition-state"><strong>음식 이름만 기록되어 있습니다.</strong><p>정확한 성분을 알 수 없어 영양 합계와 과다·부족 판정에서는 제외했습니다.</p></div> : <p className="empty-state">선택한 날짜에 저장된 음식이 없습니다. 아래에서 음식 이름을 직접 기록할 수 있습니다.</p>}
          </article>

          <article className="panel">
            <div className="panel-heading"><span>식단 노트</span><h2>먹은 음식 {dailyEntries.length}개</h2></div>
            <form className="manual-food-form" onSubmit={(event) => { event.preventDefault(); void addManualFood() }}>
              <label><span>{selectedDate}에 음식 직접 기록</span><div><input aria-label="직접 기록할 음식 이름" value={manualFoodName} onChange={(event) => setManualFoodName(event.target.value)} placeholder="예: 떡볶이, 집에서 먹은 샌드위치" maxLength={120} /><button className="primary-button" type="submit">추가</button></div></label>
              <p>음식 이름만 저장하며 영양 합계에는 포함하지 않습니다.</p>
            </form>
            <div className="food-entry-list">{dailyEntries.map((entry) => <div className="food-entry" key={entry.id}><div><span>{entry.source === 'manual' ? '직접 기록' : mealTypeLabels[entry.mealType]}</span><strong>{entry.name}</strong><small>{entry.source === 'meal' ? `NEIS 급식 · ${entry.quantity}회분` : entry.source === 'barcode' ? `바코드 제품 · ${entry.quantity}회분` : '영양 정보 없음 · 합산 제외'}</small></div><div><strong>{entry.source === 'manual' ? '성분 미상' : `${Math.round(entry.nutrients.kcal).toLocaleString('ko-KR')} kcal`}</strong><button type="button" aria-label={`${entry.name} 기록 삭제`} onClick={() => void deleteEntry(entry)}>삭제</button></div></div>)}</div>
          </article>
        </div>
      </div>
    </section>
  )
}
