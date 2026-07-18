import { useCallback, useMemo, useState } from 'react'
import { Drumstick, Leaf, Soup, Wheat, type LucideIcon } from 'lucide-react'
import DataSourceBadge from '../components/DataSourceBadge'
import { saveFoodLog } from '../foodLog'
import { calculateMealIntakeRatio } from '../../meal-intake.mjs'
import {
  ageGroupOptions,
  addMealNutrients,
  emptyNutrients,
  formatNutrient,
  genderOptions,
  KDRI_SOURCE_URL,
  makeLunchTarget,
  nutrientMeta,
  nutrientPercent,
  scaleNutrients,
  sumNutrients,
  todayInputValue,
  type AgeGroup,
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
  ageGroup: AgeGroup
  onGenderChange: (gender: Gender) => void
  onAgeGroupChange: (ageGroup: AgeGroup) => void
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
  { value: 0.25, label: '조금' },
  { value: 0.5, label: '절반' },
  { value: 1, label: '전부' },
]

const categoryLabels: Record<TrayCategory, string> = {
  rice: '밥',
  soup: '국·탕',
  main: '주반찬',
  side: '곁반찬',
  dessert: '후식',
}

const adviceIcons: LucideIcon[] = [Wheat, Soup, Drumstick, Leaf]

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

  return scaleNutrients(fullMeal, calculateMealIntakeRatio(dishes, portions))
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

function servingAdvice(total: Nutrients, target: Nutrients, live: boolean) {
  const sodiumKnown = !live || total.sodium > 0
  return [
    {
      label: '밥',
      amount: total.carbs > target.carbs * 1.08 ? '제공량의 1/2~3/4' : '먹은 비율 그대로 기록',
      reason: total.carbs > target.carbs * 1.08 ? '급식 전체의 탄수화물이 점심 참고량보다 높습니다.' : 'NEIS 급식 전체 영양량을 기준으로 한 참고 안내입니다.',
    },
    {
      label: '국물',
      amount: sodiumKnown && total.sodium > target.sodium ? '건더기 중심, 3-5숟가락' : '건더기 중심으로 먹기',
      reason: sodiumKnown ? '급식 전체 나트륨을 기준으로 한 보수적인 안내입니다.' : 'NEIS가 나트륨을 제공하지 않아 일반적인 국물 조절 원칙을 적용합니다.',
    },
    {
      label: '단백질 반찬',
      amount: total.protein > 0 && total.protein < target.protein ? '제공량 남기지 않기' : '먹은 비율 기록하기',
      reason: total.protein > 0 ? '급식 전체 단백질과 점심 참고량을 비교했습니다.' : '단백질 정보가 없어 양만 기록합니다.',
    },
    {
      label: '채소·우유',
      amount: total.calcium > 0 && total.calcium < target.calcium ? '우유·채소 제공량 챙기기' : '먹은 비율 기록하기',
      reason: total.calcium > 0 ? '급식 전체 칼슘과 점심 참고량을 비교했습니다.' : '칼슘 정보가 없어 양만 기록합니다.',
    },
  ]
}

export default function MealPage({ ownerId, gender, ageGroup, onGenderChange, onAgeGroupChange, onSaved }: MealPageProps) {
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
  const intakeRatio = useMemo(() => calculateMealIntakeRatio(trayDishes, trayPortions), [trayDishes, trayPortions])
  const total = useMemo(() => estimateTrayNutrients(fullMealTotal, trayDishes, trayPortions, isLiveMeal), [fullMealTotal, isLiveMeal, trayDishes, trayPortions])
  const target = useMemo(() => makeLunchTarget(gender, ageGroup), [ageGroup, gender])
  const advice = useMemo(() => servingAdvice(fullMealTotal, target, isLiveMeal), [fullMealTotal, isLiveMeal, target])

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
    if (!selectedSchool || !isLiveMeal) {
      setStatus('현재 급식판은 예시입니다. 학교를 검색한 뒤 급식이 있는 날짜를 조회하면 기록할 수 있습니다.')
      return
    }
    setStatus('푸드 캘린더에 저장 중')
    try {
      await saveFoodLog({
        ownerId,
        date: mealDate,
        entryKey: `meal:${selectedSchool.SD_SCHUL_CODE}:${mealDate}`,
        source: 'meal',
        mealType: 'lunch',
        name: `${selectedSchool.SCHUL_NM} 급식`,
        quantity: intakeRatio,
        nutrients: total,
        metadata: {
          school: selectedSchool.SCHUL_NM,
          dishes: trayDishes.map((dish) => ({
            name: dish.name,
            category: categoryLabels[dish.category],
            portion: trayPortions[dish.id] ?? 1,
          })),
          source: 'NEIS 급식식단정보 API',
          calculation: 'NEIS 급식 전체 영양량에 메뉴별 섭취 비율의 평균을 곱한 추정치',
          intakeRatio,
          consumptionLabel: `급식 전체의 약 ${Math.round(intakeRatio * 100)}% 섭취`,
          availableNutrients: nutrientMeta.filter(({ key }) => fullMealTotal[key] > 0).map(({ key }) => key),
        },
      })
      onSaved()
      setStatus('이 급식을 푸드 캘린더에 저장했습니다.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '급식 기록 저장 실패')
    }
  }, [fullMealTotal, intakeRatio, isLiveMeal, mealDate, onSaved, ownerId, selectedSchool, total, trayDishes, trayPortions])

  return (
    <section className="page-stack" aria-labelledby="meal-title">
      <header className="page-heading">
        <div>
          <span>NEIS 공공데이터</span>
          <h1 id="meal-title">급식 영양과 섭취량</h1>
          <p>학교 급식표를 불러와 제공량 중 실제로 먹은 비율을 기록합니다.</p>
          <div className="page-source-row"><DataSourceBadge label="NEIS 급식식단정보 API" /><span className="data-mode">{isLiveMeal ? '조회 데이터' : '조회 전 예시'}</span></div>
        </div>
        <button className={isLiveMeal ? 'primary-button' : 'secondary-button'} type="button" onClick={saveMeal}>{isLiveMeal ? '담은 급식 기록' : '급식 조회 후 기록'}</button>
      </header>

      <div className="two-column-layout">
        <article className="panel">
          <div className="panel-heading"><span>급식표 조회</span><h2>학교와 날짜</h2></div>
          <div className="profile-controls">
            <div className="control-row" aria-label="학생 기준">
              {(Object.keys(genderOptions) as Gender[]).map((option) => (
                <button className={gender === option ? 'segmented active' : 'segmented'} key={option} type="button" onClick={() => onGenderChange(option)}>{genderOptions[option].label}</button>
              ))}
            </div>
            <div className="control-row" aria-label="연령 구간">
              {(Object.keys(ageGroupOptions) as AgeGroup[]).map((option) => (
                <button className={ageGroup === option ? 'segmented active' : 'segmented'} key={option} type="button" onClick={() => onAgeGroupChange(option)}>{ageGroupOptions[option].label}</button>
              ))}
            </div>
          </div>

          <div className="target-card"><span>점심 참고량</span><strong>{target.kcal.toLocaleString('ko-KR')} kcal</strong><small>하루 에너지 필요추정량 {target.dayKcal.toLocaleString('ko-KR')} kcal</small></div>
          <p className="reference-note">건강한 {ageGroupOptions[ageGroup].label} 청소년을 위한 <a href={KDRI_SOURCE_URL} target="_blank" rel="noreferrer">2025 한국인 영양소 섭취기준</a> 참고값입니다. 키·체중·개인 활동량을 반영한 진단이나 식사 처방이 아닙니다. 나트륨은 만성질환 위험감소섭취량을 상한 참고선으로 사용합니다.</p>

          <div className="api-tools">
            <label className="api-input"><span>학교명</span><div><input aria-label="학교명 검색" value={schoolName} onChange={(event) => setSchoolName(event.target.value)} /><button type="button" onClick={searchSchools}>검색</button></div></label>
            {schoolOptions.length > 0 && (
              <label className="api-input"><span>학교 선택</span><select value={selectedSchool ? `${selectedSchool.ATPT_OFCDC_SC_CODE}:${selectedSchool.SD_SCHUL_CODE}` : ''} onChange={(event) => { setSelectedSchool(schoolOptions.find((school) => `${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}` === event.target.value)); showSampleTray() }}>{schoolOptions.map((school) => <option key={`${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}`} value={`${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}`}>{school.SCHUL_NM}{school.LCTN_SC_NM ? ` (${school.LCTN_SC_NM})` : ''}</option>)}</select></label>
            )}
            <label className="api-input"><span>급식 날짜</span><div><input aria-label="급식 날짜 조회" type="date" value={mealDate} onChange={(event) => { setMealDate(event.target.value); showSampleTray() }} /><button type="button" onClick={loadMeal}>조회</button></div></label>
            <p className="api-status">{status}</p>
          </div>

          <section className="meal-tray-section" aria-labelledby="meal-tray-title">
            <div className="tray-heading"><div><span>{isLiveMeal ? `전체 급식의 약 ${Math.round(intakeRatio * 100)}%` : '급식판 사용 예시'}</span><h3 id="meal-tray-title">실제로 먹은 비율</h3></div><strong>약 {Math.round(total.kcal).toLocaleString('ko-KR')} kcal</strong></div>
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
            <p className="tray-note">{isLiveMeal ? 'NEIS는 메뉴별 영양량을 제공하지 않습니다. 각 메뉴에서 먹은 비율의 평균을 급식 전체 영양량에 적용한 추정치입니다.' : '학교 급식 조회 후 실제 메뉴로 교체되며, 조회 전 예시는 캘린더에 저장되지 않습니다.'}</p>
          </section>
        </article>

        <div className="page-stack compact">
          <article className="panel">
            <div className="panel-heading"><span>참고 안내</span><h2>어떻게 먹을까?</h2></div>
            <div className="advice-list">{advice.map((item, index) => {
              const AdviceIcon = adviceIcons[index] ?? Wheat
              return <div className="advice-row" key={item.label}><span className="advice-icon"><AdviceIcon aria-hidden="true" size={20} strokeWidth={2.1} /></span><div><span>{item.label}</span><strong>{item.amount}</strong><p>{item.reason}</p></div></div>
            })}</div>
          </article>
          <article className="panel">
            <div className="panel-heading"><span>영양 비교</span><h2>점심 목표 대비</h2></div>
            <div className="nutrient-list">{nutrientMeta.map(({ key, label, unit }) => {
              const available = !isLiveMeal || fullMealTotal[key] > 0
              return <div className="nutrient-row" key={key}><div><strong>{label}</strong><span>{available ? `약 ${formatNutrient(total[key], unit)} / ${formatNutrient(target[key], unit)}` : 'NEIS 미제공'}</span></div>{available && <div className="meter" aria-label={`${label} ${nutrientPercent(total[key], target[key])}%`}><span style={{ width: `${nutrientPercent(total[key], target[key])}%` }} /></div>}</div>
            })}</div>
          </article>
        </div>
      </div>
    </section>
  )
}
