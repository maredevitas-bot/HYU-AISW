export {
  KDRI_SOURCE_URL,
  ageGroupOptions,
  genderOptions,
  kdriProfiles,
  makeDailyTarget,
  makeLunchTarget,
} from '../nutrition-targets.mjs'
export type { AgeGroup, Gender } from '../nutrition-targets.mjs'

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
  confidence?: RecyclingConfidence
}

export type RecyclingConfidence = 'official-confirmed' | 'material-inferred' | 'label-required'

export type ProductDataScope = 'domestic-public' | 'global-community'

export type ProductNutritionBasis = {
  amount: number
  unit: 'g' | 'ml' | 'serving'
  label: string
  confidence: 'declared' | 'unknown'
  packageAmount?: number
  packageUnit?: 'g' | 'ml'
}

export type Product = {
  barcode: string
  name: string
  maker: string
  category: string
  serving: string
  nutrients: Nutrients
  nutritionBasis?: ProductNutritionBasis
  availableNutrients?: Array<keyof Nutrients>
  packageParts: PackagePart[]
  advice: string
  source?: string
  dataScope?: ProductDataScope
  reportNo?: string
  ingredients?: string[]
  safetyFlags?: string[]
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
