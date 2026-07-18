export type Gender = 'female' | 'male'
export type AgeGroup = '12-14' | '15-18'

export type NutritionTarget = {
  dayKcal: number
  kcal: number
  carbs: number
  protein: number
  fat: number
  sodium: number
  calcium: number
  iron: number
}

export const KDRI_SOURCE_URL: string
export const genderOptions: Record<Gender, { label: string }>
export const ageGroupOptions: Record<AgeGroup, { label: string }>
export const kdriProfiles: Record<Gender, Record<AgeGroup, { dayKcal: number; protein: number; calcium: number; iron: number }>>
export function makeDailyTarget(gender: Gender, ageGroup: AgeGroup): NutritionTarget
export function makeLunchTarget(gender: Gender, ageGroup: AgeGroup): NutritionTarget
