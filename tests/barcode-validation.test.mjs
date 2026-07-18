import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateGtinCheckDigit, isValidGtin, normalizeBarcode, validateRetailBarcode } from '../barcode-validation.mjs'

test('EAN-13, UPC-A, GTIN-14 검증 숫자를 확인한다', () => {
  assert.equal(isValidGtin('8801024949960'), true)
  assert.equal(isValidGtin('036000291452'), true)
  assert.equal(isValidGtin('08801007325224'), true)
  assert.equal(isValidGtin('8801024949961'), false)
})

test('잘못 입력한 길이와 검증 숫자에 안내 문구를 반환한다', () => {
  assert.match(validateRetailBarcode('1234').message, /8, 12, 13, 14자리/)
  assert.match(validateRetailBarcode('8801024949961').message, /검증 숫자/)
})

test('공백과 하이픈을 제거하고 검증 숫자를 계산한다', () => {
  assert.equal(normalizeBarcode('880-1024-949960'), '8801024949960')
  assert.equal(calculateGtinCheckDigit('880102494996'), 0)
})
