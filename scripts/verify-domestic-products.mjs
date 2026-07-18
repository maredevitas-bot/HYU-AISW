import { readFile } from 'node:fs/promises'
import { validateRetailBarcode } from '../barcode-validation.mjs'

const baseUrl = String(process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const fixtureUrl = new URL('../verification/domestic-products.json', import.meta.url)
const cases = JSON.parse(await readFile(fixtureUrl, 'utf8'))

let failed = 0
for (const item of cases) {
  const validation = validateRetailBarcode(item.barcode)
  if (!validation.valid) {
    failed += 1
    console.error(`FAIL ${item.barcode}: ${validation.message}`)
    continue
  }

  try {
    const response = await fetch(`${baseUrl}/api/barcode/${item.barcode}`)
    const payload = await response.json()
    const product = payload.product
    const domestic = product?.dataScope === 'domestic-public'
    const nameMatches = String(product?.name ?? '').includes(item.expectedName)
    const passed = response.ok && payload.ok && product && domestic && nameMatches

    if (!passed) failed += 1
    console.log(`${passed ? 'PASS' : 'FAIL'} ${item.barcode} | ${product?.name ?? '조회 실패'} | ${product?.source ?? payload.message ?? ''}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${item.barcode}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log(`\n국내 제품 자동 조회 ${cases.length - failed}/${cases.length}건 통과`)
console.log('실물 포장 대조는 docs/domestic-product-verification.md 체크리스트로 별도 수행해야 합니다.')
if (failed) process.exitCode = 1
