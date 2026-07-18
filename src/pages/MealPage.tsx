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
  scaleNutrients,
  sumNutrients,
  todayInputValue,
  type Activity,
  type Gender,
  type MealItem,
  type Nutrients,
} from '../nutrition'

type TrayCategory = 'rice' | 'soup' | 'main' | 'side' | 'dessert'

type TrayDish = {
  id: string
  name: string
  category: TrayCategory
  nutrients?: Nutrients
}

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

const portionOptions = [
  { value: 0, label: '안 먹음' },
  { value: 0.5, label: '절반' },
  { value: 1, label: '기본' },
  { value: 1.5, label: '많이' },
]

const categoryLabels: Record<TrayCategory, string> = {
  rice: '밥',
  soup: '국·탕',
  main: '주반찬',
  side: '곁반찬',
  dessert: '후식',
}

const categoryWeights: Record<TrayCategory, Nutrients> = {
  rice: { kcal: 1.7, carbs: 3.2, protein: 0.5, fat: 0.2, sodium: 0.05, calcium: 0.2, iron: 0.5 },
  soup: { kcal: 0.6, carbs: 0.4, protein: 0.7, fat: 0.5, sodium: 2.5, calcium: 0.8, iron: 0.7 },
  main: { kcal: 1.6, carbs: 0.8, protein: 3, fat: 3, sodium: 1.8, calcium: 0.8, iron: 2 },
  side: { kcal: 0.7, carbs: 0.7, protein: 0.5, fat: 0.6, sodium: 1, calcium: 1.2, iron: 1.2 },
  dessert: { kcal: 0.8, carbs: 1, protein: 0.5, fat: 0.4, sodium: 0.3, calcium: 1.5, iron: 0.2 },
}

function classifyDish(name: string): TrayCategory {
  if (/밥|라이스|죽|볶음밥/.test(name)) return 'rice'
  if (/국|탕|찌개|전골|스프/.test(name)) return 'soup'
  if (/우유|요구르트|요거트|과일|주스|귤|사과|수박|케이크|푸딩/.test(name)) return 'dessert'
  if (/고기|닭|돼지|소고기|불고기|갈비|생선|고등어|두부|계란|달걀|돈가스|커틀렛|만두|오리|떡갈비|제육/.test(name)) return 'main'
  return 'side'
}

function trayDishesFrom(items: MealItem[], live: boolean): TrayDish[] {
  const source = live ? items.slice(1) : items
  return source.map((item, index) => ({
    id: `${index}:${item.name}`,
    name: item.name,
    category: classifyDish(item.name),
    nutrients: live ? undefined : item.nutrients,
  }))
}

function defaultPortions(dishes: TrayDish[]) {
  return Object.fromEntries(dishes.map((dish) => [dish.id, 1]))
}

function estimateTrayNutrients(fullMeal: Nutrients, dishes: TrayDish[], portions: Record<string, number>, live: boolean): Nutrients {
  if (!live) {
    return sumNutrients(dishes.map((dish) => scaleNutrients(dish.nutrients ?? emptyNutrients(), portions[dish.id] ?? 1)))
  }

  return Object.fromEntries(nutrientMeta.map(({ key }) => {
    const weightTotal = dishes.reduce((sum, dish) => sum + categoryWeights[dish.category][key], 0)
    const eaten = dishes.reduce((sum, dish) => {
      const share = weightTotal > 0 ? categoryWeights[dish.category][key] / weightTotal : 0
      return sum + fullMeal[key] * share * (portions[dish.id] ?? 1)
    }, 0)
    return [key, Number(eaten.toFixed(2))]
  })) as unknown as Nutrients
}

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
  const [trayPortions, setTrayPortions] = useState<Record<string, number>>(() => defaultPortions(trayDishesFrom(sampleMealItems, false)))
  const [status, setStatus] = useState('학교와 날짜를 조회하면 NEIS 급식표를 불러옵니다.')

  const trayDishes = useMemo(() => trayDishesFrom(mealPlan, isLiveMeal), [isLiveMeal, mealPlan])
  const fullMealTotal = useMemo(() => isLiveMeal ? (mealPlan[0]?.nutrients ?? emptyNutrients()) : addMealNutrients(mealPlan), [isLiveMeal, mealPlan])
  const total = useMemo(() => estimateTrayNutrients(fullMealTotal, trayDishes, trayPortions, isLiveMeal), [fullMealTotal, isLiveMeal, trayDishes, trayPortions])
  const target = useMemo(() => makeLunchTarget(gender, activity), [gender, activity])
  const advice = useMemo(() => servingAdvice(total, target), [total, target])

  const setDishPortion = (dishId: string, portion: number) => {
    setTrayPortions((current) => ({ ...current, [dishId]: portion }))
  }

  const showSampleTray = () => {
    setIsLiveMeal(false)
    setMealPlan(sampleMealItems)
    setTrayPortions(defaultPortions(trayDishesFrom(sampleMealItems, false)))
  }

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
        showSampleTray()
        return setStatus('해당 날짜의 급식 정보가 없습니다.')
      }
      const nextMealPlan = mealRowToItems(row)
      const nextDishes = trayDishesFrom(nextMealPlan, true)
      setMealPlan(nextMealPlan)
      setTrayPortions(defaultPortions(nextDishes))
      setIsLiveMeal(true)
      setStatus(`${selectedSchool.SCHUL_NM} ${mealDate} 급식표를 불러왔습니다.`)
    } catch (error) {
      showSampleTray()
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
          dishes: trayDishes.map((dish) => ({
            name: dish.name,
            category: categoryLabels[dish.category],
            portion: trayPortions[dish.id] ?? 1,
          })),
          source: 'NEIS 급식식단정보 API',
          calculation: 'NEIS 메뉴 전체 영양량을 음식 종류와 사용자가 담은 양에 따라 나눈 추정치',
        },
      })
      onSaved()
      setStatus('이 급식을 푸드 캘린더에 저장했습니다.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '급식 기록 저장 실패')
    }
  }, [isLiveMeal, mealDate, onSaved, ownerId, selectedSchool, total, trayDishes, trayPortions])

  return (
    <section className="page-stack" aria-labelledby="meal-title">
      <header className="page-heading">
        <div>
          <span>NEIS 공공데이터</span>
          <h1 id="meal-title">급식 영양과 섭취량</h1>
          <p>학교 급식표를 불러와 영양소를 비교하고, 실제로 먹을 양을 판단합니다.</p>
        </div>
        <button className="primary-button" type="button" onClick={saveMeal} disabled={!isLiveMeal}>담은 급식 기록</button>
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
              <label className="api-input"><span>학교 선택</span><select value={selectedSchool ? `${selectedSchool.ATPT_OFCDC_SC_CODE}:${selectedSchool.SD_SCHUL_CODE}` : ''} onChange={(event) => { setSelectedSchool(schoolOptions.find((school) => `${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}` === event.target.value)); showSampleTray() }}>{schoolOptions.map((school) => <option key={`${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}`} value={`${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}`}>{school.SCHUL_NM}{school.LCTN_SC_NM ? ` (${school.LCTN_SC_NM})` : ''}</option>)}</select></label>
            )}
            <label className="api-input"><span>급식 날짜</span><div><input aria-label="급식 날짜 조회" type="date" value={mealDate} onChange={(event) => { setMealDate(event.target.value); showSampleTray() }} /><button type="button" onClick={loadMeal}>조회</button></div></label>
            <p className="api-status">{status}</p>
          </div>

          <section className="meal-tray-section" aria-labelledby="meal-tray-title">
            <div className="tray-heading"><div><span>{isLiveMeal ? '조회한 급식표' : '급식판 사용 예시'}</span><h3 id="meal-tray-title">급식판에 담은 양</h3></div><strong>{Math.round(total.kcal).toLocaleString('ko-KR')} kcal</strong></div>
            <div className="meal-tray">
              {trayDishes.map((dish) => (
                <div className={`tray-compartment ${dish.category}`} key={dish.id}>
                  <div className="tray-food"><span>{categoryLabels[dish.category]}</span><strong>{dish.name}</strong></div>
                  <div className="portion-control" aria-label={`${dish.name} 담은 양`}>
                    {portionOptions.map((option) => <button className={(trayPortions[dish.id] ?? 1) === option.value ? 'active' : ''} key={option.value} type="button" onClick={() => setDishPortion(dish.id, option.value)}>{option.label}</button>)}
                  </div>
                </div>
              ))}
            </div>
            <p className="tray-note">{isLiveMeal ? 'NEIS가 제공한 메뉴 전체 영양량을 음식 종류와 선택한 양에 따라 나눈 추정치입니다.' : '학교 급식 조회 후 실제 메뉴로 교체되며, 조회 전 예시는 캘린더에 저장되지 않습니다.'}</p>
          </section>
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
