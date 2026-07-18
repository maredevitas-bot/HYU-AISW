import { useCallback, useMemo, useState } from 'react'
import { saveFoodLog } from '../foodLog'
import {
  activityOptions,
  addMealNutrients,
  emptyNutrients,
  formatNutrient,
  makeLunchTarget,
  nutrientMeta,
  nutrientPercent,
  profileTargets,
  todayInputValue,
  type Activity,
  type Gender,
  type MealItem,
  type Nutrients,
} from '../nutrition'

type SchoolRow = {
  ATPT_OFCDC_SC_CODE: string
  SD_SCHUL_CODE: string
  SCHUL_NM: string
  LCTN_SC_NM?: string
}

type MealApiRow = {
  MMEAL_SC_NM?: string
  MLSV_YMD?: string
  DDISH_NM?: string
  CAL_INFO?: string
  NTR_INFO?: string
}

type MealPageProps = {
  ownerId: string
  gender: Gender
  activity: Activity
  onGenderChange: (gender: Gender) => void
  onActivityChange: (activity: Activity) => void
  onSaved: () => void
}

const sampleMealItems: MealItem[] = [
  { name: '잡곡밥', amount: '1공기', note: '주 에너지', nutrients: { kcal: 315, carbs: 68, protein: 7, fat: 1.3, sodium: 12, calcium: 18, iron: 1.1 } },
  { name: '닭가슴살 채소볶음', amount: '1접시', note: '단백질', nutrients: { kcal: 205, carbs: 10, protein: 28, fat: 6.5, sodium: 520, calcium: 42, iron: 1.4 } },
  { name: '김치콩나물국', amount: '1그릇', note: '국물 조절', nutrients: { kcal: 72, carbs: 8, protein: 5, fat: 2, sodium: 780, calcium: 66, iron: 1.2 } },
  { name: '시금치나물', amount: '반찬 1칸', note: '무기질', nutrients: { kcal: 38, carbs: 5, protein: 3, fat: 1, sodium: 180, calcium: 96, iron: 2.2 } },
  { name: '우유', amount: '200mL', note: '칼슘', nutrients: { kcal: 130, carbs: 10, protein: 6, fat: 7, sodium: 95, calcium: 220, iron: 0 } },
]

function parseHtmlList(value?: string) {
  return (value ?? '')
    .replace(/\([0-9.]+\)/g, '')
    .split(/<br\s*\/?>|\n|,/i)
    .map((item) => item.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean)
}

function parseNutritionInfo(calInfo?: string, ntrInfo?: string): Nutrients {
  const total = emptyNutrients()
  const kcalMatch = calInfo?.match(/([\d.]+)/)
  if (kcalMatch) total.kcal = Number(kcalMatch[1])

  parseHtmlList(ntrInfo).forEach((line) => {
    const valueMatch = line.match(/:\s*([\d.]+)/)
    const value = valueMatch ? Number(valueMatch[1]) : 0
    if (line.includes('탄수화물')) total.carbs = value
    if (line.includes('단백질')) total.protein = value
    if (line.includes('지방')) total.fat = value
    if (line.includes('나트륨')) total.sodium = value
    if (line.includes('칼슘')) total.calcium = value
    if (line.includes('철')) total.iron = value
  })
  return total
}

function mealRowToItems(row: MealApiRow): MealItem[] {
  const dishes = parseHtmlList(row.DDISH_NM)
  return [
    {
      name: row.MMEAL_SC_NM ?? '급식 전체',
      amount: row.CAL_INFO ?? 'NEIS 조회',
      note: row.MLSV_YMD ?? '공공데이터',
      nutrients: parseNutritionInfo(row.CAL_INFO, row.NTR_INFO),
    },
    ...dishes.slice(0, 9).map((name) => ({ name, amount: '식단 항목', note: 'NEIS', nutrients: emptyNutrients() })),
  ]
}

function servingAdvice(total: Nutrients, target: Nutrients) {
  return [
    {
      label: '밥',
      amount: total.carbs > target.carbs * 1.08 ? '2-3숟가락 덜기' : '1공기 기준 유지',
      reason: total.carbs > target.carbs * 1.08 ? '탄수화물이 점심 목표보다 높습니다.' : '에너지 균형이 안정적입니다.',
    },
    {
      label: '국물',
      amount: total.sodium > target.sodium ? '3-5숟가락만' : '반 그릇 이하',
      reason: total.sodium > target.sodium ? '나트륨이 높아 국물 섭취를 줄입니다.' : '나트륨은 목표 안쪽입니다.',
    },
    {
      label: '단백질 반찬',
      amount: total.protein < target.protein ? '한 젓가락 더' : '현재 양 유지',
      reason: total.protein < target.protein ? '성장기 단백질 보충이 필요합니다.' : '단백질이 충분합니다.',
    },
    {
      label: '채소·우유',
      amount: total.calcium < target.calcium ? '우유 1개 또는 채소 남기지 않기' : '채소 반찬 유지',
      reason: total.calcium < target.calcium ? '칼슘 목표에 조금 부족합니다.' : '칼슘 보충이 잘 되어 있습니다.',
    },
  ]
}

export default function MealPage({ ownerId, gender, activity, onGenderChange, onActivityChange, onSaved }: MealPageProps) {
  const [schoolName, setSchoolName] = useState('한세사이버보안고등학교')
  const [schoolOptions, setSchoolOptions] = useState<SchoolRow[]>([])
  const [selectedSchool, setSelectedSchool] = useState<SchoolRow>()
  const [mealDate, setMealDate] = useState(todayInputValue())
  const [mealPlan, setMealPlan] = useState<MealItem[]>(sampleMealItems)
  const [isLiveMeal, setIsLiveMeal] = useState(false)
  const [status, setStatus] = useState('학교와 날짜를 조회하면 NEIS 급식표를 불러옵니다.')

  const total = useMemo(() => addMealNutrients(mealPlan), [mealPlan])
  const target = useMemo(() => makeLunchTarget(gender, activity), [gender, activity])
  const advice = useMemo(() => servingAdvice(total, target), [total, target])

  const searchSchools = useCallback(async () => {
    const keyword = schoolName.trim()
    if (!keyword) return setStatus('학교명을 입력해 주세요.')
    setStatus('학교 검색 중')

    try {
      const response = await fetch(`/api/school/search?school=${encodeURIComponent(keyword)}`)
      const payload = await response.json() as { ok?: boolean; rows?: SchoolRow[]; message?: string }
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? '학교 검색 실패')
      const rows = payload.rows ?? []
      setSchoolOptions(rows)
      setSelectedSchool(rows[0])
      setStatus(rows[0] ? `${rows[0].SCHUL_NM} 선택됨` : '검색 결과가 없습니다.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '학교 검색 실패')
    }
  }, [schoolName])

  const loadMeal = useCallback(async () => {
    if (!selectedSchool) return setStatus('먼저 학교를 검색해 주세요.')
    setStatus('NEIS 급식 조회 중')
    const params = new URLSearchParams({
      officeCode: selectedSchool.ATPT_OFCDC_SC_CODE,
      schoolCode: selectedSchool.SD_SCHUL_CODE,
      date: mealDate.replace(/\D/g, ''),
    })

    try {
      const response = await fetch(`/api/meals?${params.toString()}`)
      const payload = await response.json() as { ok?: boolean; rows?: MealApiRow[]; message?: string }
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? '급식 조회 실패')
      const row = payload.rows?.[0]
      if (!row) {
        setIsLiveMeal(false)
        return setStatus('해당 날짜의 급식 정보가 없습니다.')
      }
      setMealPlan(mealRowToItems(row))
      setIsLiveMeal(true)
      setStatus(`${selectedSchool.SCHUL_NM} ${mealDate} 급식표를 불러왔습니다.`)
    } catch (error) {
      setIsLiveMeal(false)
      setStatus(error instanceof Error ? error.message : '급식 조회 실패')
    }
  }, [mealDate, selectedSchool])

  const saveMeal = useCallback(async () => {
    if (!selectedSchool || !isLiveMeal) return
    setStatus('푸드 캘린더에 저장 중')
    try {
      await saveFoodLog({
        ownerId,
        date: mealDate,
        entryKey: `meal:${selectedSchool.SD_SCHUL_CODE}:${mealDate}`,
        source: 'meal',
        mealType: 'lunch',
        name: `${selectedSchool.SCHUL_NM} 급식`,
        quantity: 1,
        nutrients: total,
        metadata: {
          school: selectedSchool.SCHUL_NM,
          dishes: mealPlan.slice(1).map((item) => item.name),
          source: 'NEIS 급식식단정보 API',
        },
      })
      onSaved()
      setStatus('이 급식을 푸드 캘린더에 저장했습니다.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '급식 기록 저장 실패')
    }
  }, [isLiveMeal, mealDate, mealPlan, onSaved, ownerId, selectedSchool, total])

  return (
    <section className="page-stack" aria-labelledby="meal-title">
      <header className="page-heading">
        <div>
          <span>NEIS 공공데이터</span>
          <h1 id="meal-title">급식 영양과 섭취량</h1>
          <p>학교 급식표를 불러와 영양소를 비교하고, 실제로 먹을 양을 판단합니다.</p>
        </div>
        <button className="primary-button" type="button" onClick={saveMeal} disabled={!isLiveMeal}>캘린더에 급식 기록</button>
      </header>

      <div className="two-column-layout">
        <article className="panel">
          <div className="panel-heading"><span>급식표 조회</span><h2>학교와 날짜</h2></div>
          <div className="profile-controls">
            <div className="control-row" aria-label="학생 기준">
              {(Object.keys(profileTargets) as Gender[]).map((option) => (
                <button className={gender === option ? 'segmented active' : 'segmented'} key={option} type="button" onClick={() => onGenderChange(option)}>{profileTargets[option].label}</button>
              ))}
            </div>
            <div className="control-row three" aria-label="활동량">
              {(Object.keys(activityOptions) as Activity[]).map((option) => (
                <button className={activity === option ? 'segmented active' : 'segmented'} key={option} type="button" onClick={() => onActivityChange(option)}>{activityOptions[option].label}</button>
              ))}
            </div>
          </div>

          <div className="target-card"><span>점심 목표</span><strong>{target.kcal.toLocaleString('ko-KR')} kcal</strong><small>하루 기준 {target.dayKcal.toLocaleString('ko-KR')} kcal</small></div>

          <div className="api-tools">
            <label className="api-input"><span>학교명</span><div><input aria-label="학교명 검색" value={schoolName} onChange={(event) => setSchoolName(event.target.value)} /><button type="button" onClick={searchSchools}>검색</button></div></label>
            {schoolOptions.length > 0 && (
              <label className="api-input"><span>학교 선택</span><select value={selectedSchool ? `${selectedSchool.ATPT_OFCDC_SC_CODE}:${selectedSchool.SD_SCHUL_CODE}` : ''} onChange={(event) => setSelectedSchool(schoolOptions.find((school) => `${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}` === event.target.value))}>{schoolOptions.map((school) => <option key={`${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}`} value={`${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}`}>{school.SCHUL_NM}{school.LCTN_SC_NM ? ` (${school.LCTN_SC_NM})` : ''}</option>)}</select></label>
            )}
            <label className="api-input"><span>급식 날짜</span><div><input aria-label="급식 날짜 조회" type="date" value={mealDate} onChange={(event) => setMealDate(event.target.value)} /><button type="button" onClick={loadMeal}>조회</button></div></label>
            <p className="api-status">{status}</p>
          </div>

          <div className="meal-list">{mealPlan.map((item, index) => <div className="meal-row" key={`${item.name}-${index}`}><div><strong>{item.name}</strong><span>{item.amount}</span></div><em>{item.note}</em></div>)}</div>
        </article>

        <div className="page-stack compact">
          <article className="panel">
            <div className="panel-heading"><span>섭취 조절</span><h2>얼마나 먹을까?</h2></div>
            <div className="advice-grid">{advice.map((item) => <div className="advice-card" key={item.label}><span>{item.label}</span><strong>{item.amount}</strong><p>{item.reason}</p></div>)}</div>
          </article>
          <article className="panel">
            <div className="panel-heading"><span>영양 비교</span><h2>점심 목표 대비</h2></div>
            <div className="nutrient-list">{nutrientMeta.map(({ key, label, unit }) => <div className="nutrient-row" key={key}><div><strong>{label}</strong><span>{formatNutrient(total[key], unit)} / {formatNutrient(target[key], unit)}</span></div><div className="meter" aria-label={`${label} ${nutrientPercent(total[key], target[key])}%`}><span style={{ width: `${nutrientPercent(total[key], target[key])}%` }} /></div></div>)}</div>
          </article>
        </div>
      </div>
    </section>
  )
}
