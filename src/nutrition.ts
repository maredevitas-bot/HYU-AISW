export type Gender = 'female' | 'male'
export type Activity = 'low' | 'normal' | 'high'

export type Nutrients = {
  kcal: number
  carbs: number
  protein: number
  fat: number
  sodium: number
  calcium: number
  iron: number
}

export type NutritionTarget = Nutrients & {
  dayKcal: number
}

export type MealItem = {
  name: string
  amount: string
  note: string
  nutrients: Nutrients
}

export type PackagePart = {
  part: string
  material: string
  stream: string
  guide: string
  source?: string
  query?: string
}

export type Product = {
  barcode: string
  name: string
  maker: string
  category: string
  serving: string
  nutrients: Nutrients
  packageParts: PackagePart[]
  advice: string
  source?: string
  reportNo?: string
  ingredients?: string[]
  safetyFlags?: string[]
}

export const activityOptions: Record<Activity, { label: string; factor: number }> = {
  low: { label: '활동 적음', factor: 0.92 },
  normal: { label: '보통', factor: 1 },
  high: { label: '운동 많음', factor: 1.12 },
}

export const profileTargets: Record<Gender, { label: string; dayKcal: number; protein: number; calcium: number; iron: number }> = {
  female: { label: '여학생', dayKcal: 2000, protein: 55, calcium: 900, iron: 14 },
  male: { label: '남학생', dayKcal: 2600, protein: 65, calcium: 900, iron: 11 },
}

export const nutrientMeta = [
  { key: 'kcal', label: '열량', unit: 'kcal' },
  { key: 'carbs', label: '탄수화물', unit: 'g' },
  { key: 'protein', label: '단백질', unit: 'g' },
  { key: 'fat', label: '지방', unit: 'g' },
  { key: 'sodium', label: '나트륨', unit: 'mg' },
  { key: 'calcium', label: '칼슘', unit: 'mg' },
  { key: 'iron', label: '철', unit: 'mg' },
] as const

export function emptyNutrients(): Nutrients {
  return { kcal: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, calcium: 0, iron: 0 }
}

export function sumNutrients(values: Nutrients[]): Nutrients {
  return values.reduce((total, value) => ({
    kcal: total.kcal + value.kcal,
    carbs: total.carbs + value.carbs,
    protein: total.protein + value.protein,
    fat: total.fat + value.fat,
    sodium: total.sodium + value.sodium,
    calcium: total.calcium + value.calcium,
    iron: total.iron + value.iron,
  }), emptyNutrients())
}

export function addMealNutrients(items: MealItem[]): Nutrients {
  return sumNutrients(items.map((item) => item.nutrients))
}

export function scaleNutrients(value: Nutrients, quantity: number): Nutrients {
  return Object.fromEntries(
    nutrientMeta.map(({ key }) => [key, Number((value[key] * quantity).toFixed(2))]),
  ) as unknown as Nutrients
}

export function makeDailyTarget(gender: Gender, activity: Activity): NutritionTarget {
  const profile = profileTargets[gender]
  const dayKcal = Math.round(profile.dayKcal * activityOptions[activity].factor)
  return {
    dayKcal,
    kcal: dayKcal,
    carbs: Math.round((dayKcal * 0.58) / 4),
    protein: profile.protein,
    fat: Math.round((dayKcal * 0.24) / 9),
    sodium: 2000,
    calcium: profile.calcium,
    iron: profile.iron,
  }
}

export function makeLunchTarget(gender: Gender, activity: Activity): NutritionTarget {
  const daily = makeDailyTarget(gender, activity)
  const ratio = 0.34
  return {
    dayKcal: daily.dayKcal,
    kcal: Math.round(daily.kcal * ratio),
    carbs: Math.round(daily.carbs * ratio),
    protein: Math.round(daily.protein * ratio),
    fat: Math.round(daily.fat * ratio),
    sodium: 650,
    calcium: Math.round(daily.calcium * ratio),
    iron: Number((daily.iron * ratio).toFixed(1)),
  }
}

export function nutrientPercent(value: number, target: number) {
  return target > 0 ? Math.min(140, Math.round((value / target) * 100)) : 0
}

export function formatNutrient(value: number, unit: string) {
  const rounded = unit === 'mg' && value < 10 ? Number(value.toFixed(1)) : Math.round(value)
  return `${rounded.toLocaleString('ko-KR')}${unit}`
}

export function todayInputValue() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}
