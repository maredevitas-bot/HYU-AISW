import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateMealIntakeRatio } from '../meal-intake.mjs'

test('메뉴별 섭취 비율의 평균으로 급식 전체 섭취율을 계산한다', () => {
  const dishes = [{ id: 'rice' }, { id: 'soup' }, { id: 'side' }, { id: 'milk' }]
  const ratio = calculateMealIntakeRatio(dishes, { rice: 1, soup: 0.25, side: 0.5, milk: 0.25 })
  assert.equal(ratio, 0.5)
})

test('급식 섭취율은 0~1 범위를 벗어나지 않는다', () => {
  assert.equal(calculateMealIntakeRatio([{ id: 'rice' }], { rice: 2 }), 1)
  assert.equal(calculateMealIntakeRatio([], {}), 0)
})
