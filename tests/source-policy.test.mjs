import assert from 'node:assert/strict'
import test from 'node:test'
import { isCommunityProduct, productCacheHours } from '../source-policy.mjs'

test('국내 공공데이터와 글로벌 커뮤니티 캐시 정책을 분리한다', () => {
  const domestic = { source: 'HACCP 공개데이터 DB', dataScope: 'domestic-public' }
  const global = { source: 'Open Food Facts · 글로벌 커뮤니티', dataScope: 'global-community' }
  assert.equal(isCommunityProduct(domestic), false)
  assert.equal(productCacheHours(domestic), 168)
  assert.equal(isCommunityProduct(global), true)
  assert.equal(productCacheHours(global), 6)
})
