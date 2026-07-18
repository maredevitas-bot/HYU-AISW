import assert from 'node:assert/strict'
import test from 'node:test'
import { kdriProfiles, makeDailyTarget, makeLunchTarget } from '../nutrition-targets.mjs'

test('2025 KDRI 청소년 성별·연령 구간 권장값을 사용한다', () => {
  assert.deepEqual(kdriProfiles.male['12-14'], { dayKcal: 2500, protein: 60, calcium: 950, iron: 11 })
  assert.deepEqual(kdriProfiles.female['15-18'], { dayKcal: 2000, protein: 55, calcium: 700, iron: 12 })
})

test('임의 활동량 배율 없이 공식 에너지 필요추정량을 사용한다', () => {
  const target = makeDailyTarget('female', '12-14')
  assert.equal(target.dayKcal, 2000)
  assert.equal(target.protein, 55)
  assert.equal(target.calcium, 850)
})

test('점심 참고량은 하루 기준의 34%이며 나트륨은 위험감소섭취량을 기준으로 한다', () => {
  const lunch = makeLunchTarget('male', '15-18')
  assert.equal(lunch.kcal, 918)
  assert.equal(lunch.sodium, 782)
  assert.equal(lunch.dayKcal, 2700)
})
