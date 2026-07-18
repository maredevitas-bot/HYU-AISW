import assert from 'node:assert/strict'
import test from 'node:test'
import { listStoredEntries, removeStoredEntry, upsertStoredEntry } from '../food-log-storage.mjs'

const baseEntry = {
  ownerId: 'nc_test',
  date: '2026-07-19',
  entryKey: 'meal:test',
  source: 'meal',
  mealType: 'lunch',
  name: '테스트 급식',
  quantity: 0.5,
  nutrients: { kcal: 400 },
  metadata: { consumptionLabel: '급식 전체의 약 50% 섭취' },
}

test('같은 식단 키를 다시 저장하면 중복 없이 갱신한다', () => {
  const first = upsertStoredEntry([], baseEntry, '2026-07-19T00:00:00.000Z', 1)
  const second = upsertStoredEntry(first.entries, { ...baseEntry, quantity: 0.75 }, '2026-07-19T01:00:00.000Z', 2)
  assert.equal(second.entries.length, 1)
  assert.equal(second.saved.id, 1)
  assert.equal(second.saved.quantity, 0.75)
})

test('사용자와 월별로 기록을 분리하고 삭제한다', () => {
  const other = { ...baseEntry, ownerId: 'nc_other', entryKey: 'meal:other' }
  const entries = [
    upsertStoredEntry([], baseEntry, '2026-07-19T00:00:00.000Z', 1).saved,
    upsertStoredEntry([], other, '2026-07-19T00:00:00.000Z', 2).saved,
  ]
  assert.equal(listStoredEntries(entries, 'nc_test', '2026-07').length, 1)
  const removed = removeStoredEntry(entries, 'nc_test', 1)
  assert.equal(removed.removed, true)
  assert.equal(removed.entries.length, 1)
})
