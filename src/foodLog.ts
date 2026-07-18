import type { Nutrients } from './nutrition'

export type FoodLogSource = 'meal' | 'barcode' | 'manual'
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export type FoodLogEntry = {
  id: number
  ownerId: string
  date: string
  entryKey: string
  source: FoodLogSource
  mealType: MealType
  name: string
  quantity: number
  nutrients: Nutrients
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type NewFoodLogEntry = Omit<FoodLogEntry, 'id' | 'createdAt' | 'updatedAt'>

const ownerStorageKey = 'nutricycle-owner-id'

export function getOwnerId() {
  const stored = window.localStorage.getItem(ownerStorageKey)
  if (stored) return stored

  const random = window.crypto.randomUUID().replace(/-/g, '')
  const ownerId = `nc_${random}`
  window.localStorage.setItem(ownerStorageKey, ownerId)
  return ownerId
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { message?: string }
  if (!response.ok) throw new Error(payload.message ?? '식단 기록 요청에 실패했습니다.')
  return payload
}

export async function loadFoodLog(ownerId: string, month: string) {
  const params = new URLSearchParams({ ownerId, month })
  const response = await fetch(`/api/food-log?${params.toString()}`)
  return readResponse<{ ok: boolean; entries: FoodLogEntry[] }>(response)
}

export async function saveFoodLog(entry: NewFoodLogEntry) {
  const response = await fetch('/api/food-log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entry),
  })
  return readResponse<{ ok: boolean; entry: FoodLogEntry }>(response)
}

export async function removeFoodLog(ownerId: string, id: number) {
  const params = new URLSearchParams({ ownerId })
  const response = await fetch(`/api/food-log/${id}?${params.toString()}`, { method: 'DELETE' })
  return readResponse<{ ok: boolean; message: string }>(response)
}
