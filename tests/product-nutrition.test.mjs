import assert from 'node:assert/strict'
import test from 'node:test'
import { nutritionBasisFromText, openFoodFactsNutrition, parseMeasuredAmount } from '../product-nutrition.mjs'

test('포장 중량을 구조화한다', () => {
  assert.deepEqual(parseMeasuredAmount('총 내용량 300g'), { amount: 300, unit: 'g' })
})

test('HACCP 100g당 영양과 총 내용량을 분리한다', () => {
  assert.deepEqual(
    nutritionBasisFromText('100g당/총 내용량 300g\n열량 80kcal', '300g'),
    {
      amount: 100,
      unit: 'g',
      label: '100g 기준',
      confidence: 'declared',
      packageAmount: 300,
      packageUnit: 'g',
    },
  )
})

test('Open Food Facts의 100g 영양을 제품 전체와 혼동하지 않는다', () => {
  const result = openFoodFactsNutrition({
    quantity: '400 g',
    nutriments: {
      'energy-kcal_100g': 539,
      carbohydrates_100g: 57.5,
      proteins_100g: 6.3,
      fat_100g: 30.9,
      sodium_100g: 0.043,
    },
  })
  assert.equal(result.nutrients.kcal, 539)
  assert.equal(result.basis.label, '100g 기준')
  assert.equal(result.basis.packageAmount, 400)
})

test('Open Food Facts의 1회 제공량 영양을 우선한다', () => {
  const result = openFoodFactsNutrition({
    serving_size: '15g',
    quantity: '400g',
    nutriments: {
      'energy-kcal_serving': 81,
      'energy-kcal_100g': 539,
      carbohydrates_100g: 57.5,
      sodium_100g: 0.043,
    },
  })
  assert.equal(result.nutrients.kcal, 81)
  assert.equal(result.nutrients.carbs, 8.625)
  assert.equal(result.basis.amount, 15)
})
