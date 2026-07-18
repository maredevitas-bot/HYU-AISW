import { expect, test } from '@playwright/test'

const sampleProduct = {
  barcode: '8801024949960',
  name: '국산콩두부',
  maker: '국내 제조사',
  category: '두부',
  serving: '300g',
  nutrients: { kcal: 80, carbs: 3, protein: 9, fat: 4, sodium: 0, calcium: 0, iron: 0 },
  nutritionBasis: { amount: 100, unit: 'g', label: '100g 기준', confidence: 'declared', packageAmount: 300, packageUnit: 'g' },
  availableNutrients: ['kcal', 'carbs', 'protein', 'fat', 'sodium'],
  packageParts: [
    { part: '주 포장', material: '폴리프로필렌', stream: '플라스틱류', guide: '헹군 뒤 배출합니다.', source: '분리배출 정보조회 API', confidence: 'official-confirmed' },
    { part: '뚜껑', material: 'PP', stream: '플라스틱류', guide: '재질 기준 안내입니다.', confidence: 'material-inferred' },
    { part: '라벨', material: '표시 확인', stream: '직접 확인', guide: '포장 표시를 확인합니다.', confidence: 'label-required' },
  ],
  advice: '국내 공공데이터 조회 결과입니다.',
  source: 'HACCP 공개데이터 DB',
  dataScope: 'domestic-public',
}

test('연령 구간에 따라 2025 KDRI 점심 참고량을 바꾼다', async ({ page }) => {
  await page.goto('/meal')
  await expect(page.getByRole('heading', { name: '급식 영양과 섭취량' })).toBeVisible()
  await page.getByRole('button', { name: '남학생' }).click()
  await page.getByRole('button', { name: '12-14세' }).click()
  await expect(page.getByText('하루 에너지 필요추정량 2,500 kcal')).toBeVisible()
  await expect(page.getByRole('link', { name: '2025 한국인 영양소 섭취기준' })).toBeVisible()
})

test('바코드 제품을 조회하고 실제 섭취량을 캘린더에 기록한다', async ({ page }) => {
  await page.route('**/api/barcode/8801024949960', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, found: true, product: sampleProduct }),
  }))

  await page.goto('/scan')
  const input = page.getByLabel('바코드 번호 조회')
  await input.fill('8801024949960')
  await page.getByRole('button', { name: '조회' }).click()
  await expect(page.getByRole('heading', { name: '국산콩두부', exact: true })).toBeVisible()
  await expect(page.getByText('공공 API 확인', { exact: true }).last()).toBeVisible()
  await expect(page.getByText('재질 기반 추정', { exact: true }).last()).toBeVisible()
  await expect(page.getByText('포장 표시 확인 필요', { exact: true }).last()).toBeVisible()

  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('실제로 먹은 양 (g)').fill('150')
  await page.getByRole('button', { name: '오늘 기록' }).click()
  await page.locator('.page-tab').filter({ hasText: '푸드 캘린더' }).click()
  await expect(page.getByText('국산콩두부')).toBeVisible()
  await expect(page.getByText('120 kcal').first()).toBeVisible()
})

test('검증 숫자가 틀린 바코드는 API를 호출하지 않는다', async ({ page }) => {
  let apiCalled = false
  await page.route('**/api/barcode/**', (route) => {
    apiCalled = true
    return route.abort()
  })

  await page.goto('/scan')
  await page.getByLabel('바코드 번호 조회').fill('8801024949961')
  await page.getByRole('button', { name: '조회' }).click()
  await expect(page.getByText(/바코드 검증 숫자가 맞지 않습니다/)).toBeVisible()
  expect(apiCalled).toBe(false)
})
