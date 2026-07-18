import type { Nutrients } from './nutrition'
import { listStoredEntries, removeStoredEntry, upsertStoredEntry } from '../food-log-storage.mjs'

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
const foodLogStorageKey = 'nutricycle-food-log-v2'

export function getOwnerId() {
  const stored = window.localStorage.getItem(ownerStorageKey)
  if (stored) return stored

  const random = window.crypto.randomUUID().replace(/-/g, '')
  const ownerId = `nc_${random}`
  window.localStorage.setItem(ownerStorageKey, ownerId)
  return ownerId
}

function readEntries() {
  try {
    const entries = JSON.parse(window.localStorage.getItem(foodLogStorageKey) ?? '[]')
    return Array.isArray(entries) ? entries as FoodLogEntry[] : []
  } catch {
    return []
  }
}

function writeEntries(entries: FoodLogEntry[]) {
  window.localStorage.setItem(foodLogStorageKey, JSON.stringify(entries))
}

export async function loadFoodLog(ownerId: string, month: string) {
  const entries = listStoredEntries(readEntries(), ownerId, month)
  return { ok: true, entries }
}

export async function saveFoodLog(entry: NewFoodLogEntry) {
  const entries = readEntries()
  const now = new Date().toISOString()
  const result = upsertStoredEntry(entries, entry, now, Date.now() * 1000 + Math.floor(Math.random() * 1000))
  const saved = result.saved as FoodLogEntry
  writeEntries(result.entries as FoodLogEntry[])
  return { ok: true, entry: saved }
}

export async function removeFoodLog(ownerId: string, id: number) {
  const entries = readEntries()
  const result = removeStoredEntry(entries, ownerId, id)
  if (!result.removed) throw new Error('삭제할 식단 기록을 찾지 못했습니다.')
  writeEntries(result.entries)
  return { ok: true, message: '식단 기록을 삭제했습니다.' }
}
