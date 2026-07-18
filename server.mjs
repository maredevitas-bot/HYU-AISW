import { createReadStream, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deleteFoodLogEntry,
  findCachedProduct,
  findHaccpProductByBarcode,
  getDatabaseStats,
  listFoodLogEntries,
  logBarcodeLookup,
  saveFoodLogEntry,
  saveProductCache,
} from './database.mjs'
import {
  nutritionBasisFromText,
  nutritionBasisFromValues,
  openFoodFactsNutrition,
} from './product-nutrition.mjs'
import { isCommunityProduct, productCacheHours, shouldRetryFoodSafety } from './source-policy.mjs'
import { validateRetailBarcode } from './barcode-validation.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = resolve(__dirname)
const distDir = resolve(rootDir, 'dist')

const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  // API keys are read from the server runtime environment, not committed files.
  neisKey: process.env.NEIS_API_KEY ?? 'YOUR_NEIS_API_KEY',
  foodSafetyKey: process.env.FOODSAFETY_API_KEY ?? 'YOUR_FOODSAFETY_API_KEY',
  publicDataKey: process.env.PUBLIC_DATA_API_KEY ?? process.env.WASTE_API_KEY ?? 'YOUR_PUBLIC_DATA_API_KEY',
  wasteKey: process.env.WASTE_API_KEY ?? process.env.PUBLIC_DATA_API_KEY ?? 'YOUR_WASTE_API_KEY',
  appUserAgent: process.env.APP_USER_AGENT ?? 'NutriCycle/1.0 (student contest prototype)',
}

const wasteItemCache = new Map()
const foodSafetyCooldowns = new Map()

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function sendError(res, status, message, detail) {
  sendJson(res, status, { ok: false, message, detail })
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0

  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('요청 데이터가 너무 큽니다.')
    chunks.push(chunk)
  }

  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const nutrientKeys = ['kcal', 'carbs', 'protein', 'fat', 'sodium', 'calcium', 'iron']
const foodLogSources = new Set(['meal', 'barcode', 'manual'])
const mealTypes = new Set(['breakfast', 'lunch', 'dinner', 'snack'])

function validOwnerId(value) {
  return /^[a-zA-Z0-9_-]{12,80}$/.test(String(value ?? ''))
}

function validDate(value) {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const parsed = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
}

function validMonth(value) {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}$/.test(text)) return false
  const [, month] = text.split('-').map(Number)
  return month >= 1 && month <= 12
}

function normalizedNutrients(value) {
  const source = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(nutrientKeys.map((key) => {
    const number = Number(source[key] ?? 0)
    return [key, Number.isFinite(number) ? Math.max(0, Math.min(number, 100000)) : 0]
  }))
}

function validateFoodLogEntry(body) {
  const ownerId = String(body?.ownerId ?? '').trim()
  const date = String(body?.date ?? '').trim()
  const entryKey = String(body?.entryKey ?? '').trim().slice(0, 160)
  const source = String(body?.source ?? '').trim()
  const mealType = String(body?.mealType ?? '').trim()
  const name = String(body?.name ?? '').trim().slice(0, 120)
  const quantity = Number(body?.quantity ?? 1)

  if (!validOwnerId(ownerId)) throw new Error('올바른 사용자 식별자가 필요합니다.')
  if (!validDate(date)) throw new Error('올바른 기록 날짜가 필요합니다.')
  if (!entryKey) throw new Error('기록 식별자가 필요합니다.')
  if (!foodLogSources.has(source)) throw new Error('지원하지 않는 기록 출처입니다.')
  if (!mealTypes.has(mealType)) throw new Error('지원하지 않는 식사 구분입니다.')
  if (!name) throw new Error('음식 이름이 필요합니다.')
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 50) throw new Error('섭취량은 0보다 크고 50 이하여야 합니다.')

  const metadata = body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata
    : {}

  return {
    ownerId,
    date,
    entryKey,
    source,
    mealType,
    name,
    quantity,
    nutrients: normalizedNutrients(body?.nutrients),
    metadata,
  }
}

async function fetchJson(url, options = {}) {
  const { skipDefaultAccept, timeoutMs = 8000, ...fetchOptions } = options
  const headers = skipDefaultAccept ? (fetchOptions.headers ?? {}) : { accept: 'application/json', ...(fetchOptions.headers ?? {}) }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const response = await fetch(url, {
    ...fetchOptions,
    headers,
    signal: fetchOptions.signal ?? controller.signal,
  }).finally(() => {
    clearTimeout(timer)
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`)
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`JSON 응답이 아닙니다: ${text.slice(0, 160)}`)
  }
}

function readRows(payload, rootKey) {
  const block = payload?.[rootKey]
  return Array.isArray(block) ? (block[1]?.row ?? []) : []
}

function neisKeyReady() {
  return Boolean(config.neisKey && config.neisKey !== 'YOUR_NEIS_API_KEY')
}

function neisResultCode(payload, rootKey) {
  return payload?.RESULT?.CODE ?? payload?.[rootKey]?.[0]?.head?.[1]?.RESULT?.CODE ?? ''
}

function createNeisUrl(endpoint, params, useKey) {
  const apiUrl = new URL(`https://open.neis.go.kr/hub/${endpoint}`)
  apiUrl.searchParams.set('Type', 'json')
  apiUrl.searchParams.set('pIndex', '1')
  apiUrl.searchParams.set('pSize', '10')

  Object.entries(params).forEach(([key, value]) => {
    apiUrl.searchParams.set(key, value)
  })

  if (useKey) {
    apiUrl.searchParams.set('KEY', config.neisKey)
  }

  return apiUrl
}

async function fetchNeisJson(endpoint, rootKey, params) {
  const attempts = neisKeyReady() ? [true, false] : [false]
  const errors = []

  for (const useKey of attempts) {
    try {
      const payload = await fetchJson(createNeisUrl(endpoint, params, useKey), { skipDefaultAccept: true })
      const resultCode = neisResultCode(payload, rootKey)

      if (useKey && resultCode === 'ERROR-290') {
        errors.push('NEIS 인증키가 open.neis.go.kr 호출에서 거부되어 키 없이 재시도했습니다.')
        continue
      }

      return { payload, usedKey: useKey, warnings: errors }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))

      if (!useKey) {
        throw new Error(errors.join(' / '))
      }
    }
  }

  throw new Error(errors.join(' / '))
}

function hasFoodSafetyKey() {
  return Boolean(config.foodSafetyKey && config.foodSafetyKey !== 'YOUR_FOODSAFETY_API_KEY')
}

function hasWasteKey() {
  return Boolean(config.wasteKey && config.wasteKey !== 'YOUR_WASTE_API_KEY')
}

function hasPublicDataKey() {
  return Boolean(config.publicDataKey && config.publicDataKey !== 'YOUR_PUBLIC_DATA_API_KEY')
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) {
      return text
    }
  }
  return ''
}

function numberFrom(value) {
  const match = String(value ?? '').replace(',', '').match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function foodSafetyUrl(serviceId, filters = {}) {
  const filterText = Object.entries(filters)
    .filter(([, value]) => firstText(value))
    .map(([key, value]) => `${key}=${encodeURIComponent(firstText(value))}`)
    .join('&')

  return `https://openapi.foodsafetykorea.go.kr/api/${encodeURIComponent(config.foodSafetyKey)}/${serviceId}/json/1/5${filterText ? `/${filterText}` : ''}`
}

function foodSafetyRows(payload, serviceId) {
  return payload?.[serviceId]?.row ?? []
}

async function queryFoodSafety(serviceId, filters) {
  if (!hasFoodSafetyKey()) {
    return { rows: [], error: '식약처 API 키가 설정되지 않았습니다.' }
  }

  const cooldownUntil = foodSafetyCooldowns.get(serviceId) ?? 0
  if (cooldownUntil > Date.now()) {
    return { rows: [], error: '최근 시간초과로 잠시 건너뜀' }
  }

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const payload = await fetchJson(foodSafetyUrl(serviceId, filters), { timeoutMs: 4500 })
      return { rows: foodSafetyRows(payload, serviceId), error: '' }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      const timedOut = error instanceof Error && (error.name === 'AbortError' || /aborted|timeout/i.test(error.message))
      if (timedOut) {
        foodSafetyCooldowns.set(serviceId, Date.now() + 10 * 60 * 1000)
        break
      }
      if (!shouldRetryFoodSafety(lastError) || attempt === 1) break
    }
  }
  return { rows: [], error: lastError }
}

function asArray(value) {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function publicDataRows(payload) {
  const items = payload?.body?.items ?? payload?.response?.body?.items

  if (Array.isArray(items)) {
    return items.flatMap((entry) => asArray(entry?.item ?? entry))
  }

  return asArray(items?.item ?? items).flatMap((entry) => asArray(entry?.item ?? entry))
}

function publicDataResult(payload) {
  const header = payload?.header ?? payload?.response?.header ?? {}
  return {
    code: firstText(header.resultCode, header.RESULT_CODE),
    message: firstText(header.resultMsg, header.resultMessage, header.RESULT_MSG),
  }
}

function todayYmd() {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
}

function recordVersion(row) {
  return numberFrom(firstText(row?.VER_NO, row?.VER_INFO))
}

function isCurrentPublicRecord(row) {
  const today = todayYmd()
  const start = firstText(row?.VLD_BGNG_YMD).replace(/\D/g, '')
  const end = firstText(row?.VLD_END_YMD).replace(/\D/g, '')
  return (!start || start <= today) && (!end || end >= today)
}

function currentPublicRows(rows, preferredVersion = 0) {
  const source = asArray(rows)
  const active = source.filter(isCurrentPublicRecord)
  const candidates = active.length ? active : source
  const versionRows = preferredVersion
    ? candidates.filter((row) => recordVersion(row) === preferredVersion)
    : []
  const selected = versionRows.length ? versionRows : candidates
  const highestVersion = Math.max(0, ...selected.map(recordVersion))
  return highestVersion ? selected.filter((row) => recordVersion(row) === highestVersion) : selected
}

function pickCurrentPublicRow(rows, preferredVersion = 0) {
  return currentPublicRows(rows, preferredVersion)
    .sort((left, right) => {
      const leftKorean = firstText(left?.LANG_CD) === '001' || /[가-힣]/.test(firstText(left?.PRDT_NM, left?.PRDCT_NM))
      const rightKorean = firstText(right?.LANG_CD) === '001' || /[가-힣]/.test(firstText(right?.PRDT_NM, right?.PRDCT_NM))
      return Number(rightKorean) - Number(leftKorean) || recordVersion(right) - recordVersion(left)
    })[0]
}

function foodQrUrl(endpoint, barcode, numOfRows = 100) {
  const apiUrl = new URL(`https://apis.data.go.kr/1471000/FoodQrInfoService01/${endpoint}`)
  apiUrl.searchParams.set('serviceKey', config.publicDataKey)
  apiUrl.searchParams.set('pageNo', '1')
  apiUrl.searchParams.set('numOfRows', String(numOfRows))
  apiUrl.searchParams.set('type', 'json')
  apiUrl.searchParams.set('brcd_no', barcode)
  return apiUrl
}

async function queryFoodQrEndpoint(endpoint, barcode, numOfRows = 100) {
  if (!hasPublicDataKey()) {
    return { rows: [], error: '공공데이터포털 API 키가 설정되지 않았습니다.' }
  }

  try {
    const payload = await fetchJson(foodQrUrl(endpoint, barcode, numOfRows), { timeoutMs: 6500 })
    const result = publicDataResult(payload)

    if (result.code && !['00', '0', 'OK', 'INFO-000'].includes(result.code)) {
      return { rows: [], error: `${result.code} ${result.message}`.trim() }
    }

    return { rows: publicDataRows(payload), error: '' }
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) }
  }
}

function findFoodQrNutrient(rows, names) {
  const wanted = asArray(names)
  const row = rows.find((candidate) => {
    const name = firstText(candidate?.NIRWMT_NM).replace(/\s/g, '')
    return wanted.some((wantedName) => name === wantedName.replace(/\s/g, '') || name.includes(wantedName.replace(/\s/g, '')))
  })
  return numberFrom(row?.CTA ?? row?.NTRTN_ICUT_CTV)
}

function nutrientsFromFoodQr(rows) {
  return {
    kcal: findFoodQrNutrient(rows, ['열량', '에너지']),
    carbs: findFoodQrNutrient(rows, ['탄수화물']),
    protein: findFoodQrNutrient(rows, ['단백질']),
    fat: findFoodQrNutrient(rows, ['지방']),
    sodium: findFoodQrNutrient(rows, ['나트륨']),
    calcium: findFoodQrNutrient(rows, ['칼슘']),
    iron: findFoodQrNutrient(rows, ['철', '철분']),
  }
}

function availableNutrientsFromFoodQr(rows) {
  const candidates = [
    ['kcal', ['열량', '에너지']],
    ['carbs', ['탄수화물']],
    ['protein', ['단백질']],
    ['fat', ['지방']],
    ['sodium', ['나트륨']],
    ['calcium', ['칼슘']],
    ['iron', ['철', '철분']],
  ]
  return candidates.filter(([, names]) => rows.some((row) => {
    const name = firstText(row?.NIRWMT_NM).replace(/\s/g, '')
    return names.some((wanted) => name.includes(wanted))
  })).map(([key]) => key)
}

function availableNutrientsFromText(value) {
  const text = firstText(value)
  return [
    ['kcal', /열량|에너지/],
    ['carbs', /탄수화물/],
    ['protein', /단백질/],
    ['fat', /(?:^|[,\s])지방/],
    ['sodium', /나트륨/],
    ['calcium', /칼슘/],
    ['iron', /철분|(?:^|[,\s])철/],
  ].filter(([, pattern]) => pattern.test(text)).map(([key]) => key)
}

function availableNutrientsFromNutritionDb(row) {
  if (!row) return []
  return [
    ['kcal', 'AMT_NUM1'],
    ['carbs', 'AMT_NUM6'],
    ['protein', 'AMT_NUM3'],
    ['fat', 'AMT_NUM4'],
    ['sodium', 'AMT_NUM13'],
    ['calcium', 'AMT_NUM9'],
    ['iron', 'AMT_NUM10'],
  ].filter(([, field]) => row[field] !== null && row[field] !== undefined && row[field] !== '').map(([key]) => key)
}

function splitPublicText(...values) {
  return values
    .flatMap((value) => firstText(value).split(/[,;\n]|\s+및\s+/))
    .map((value) => value.trim())
    .filter(Boolean)
}

function splitIngredientText(value) {
  const text = firstText(value)
  const ingredients = []
  let depth = 0
  let current = ''

  for (const character of text) {
    if ('({['.includes(character)) depth += 1
    if (')}]'.includes(character)) depth = Math.max(0, depth - 1)

    if ((character === ',' || character === ';' || character === '\n') && depth === 0) {
      if (current.trim()) ingredients.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }

  if (current.trim()) ingredients.push(current.trim())
  return ingredients
}

function uniqueText(values, limit = 8) {
  return [...new Set(values.map((value) => firstText(value)).filter(Boolean))].slice(0, limit)
}

async function queryFoodQrProduct(barcode) {
  const listResult = await queryFoodQrEndpoint('getFoodQrProdList01', barcode, 30)
  const listRow = pickCurrentPublicRow(listResult.rows)
  const diagnostics = [{ source: '푸드QR 제품목록', count: listResult.rows.length, error: listResult.error }]

  if (!listRow) {
    return { product: null, diagnostics }
  }

  const endpoints = [
    ['제조정보', 'getFoodQrProdMnfInfo01'],
    ['표시정보', 'getFoodQrIndctInfo01'],
    ['포장정보', 'getFoodQrIndctPackInfo01'],
    ['원재료', 'getFoodQrProdRawmtrl01'],
    ['영양성분', 'getFoodQrProdNsd01'],
    ['알레르기', 'getFoodQrAllrgyInfo01'],
  ]
  const results = await Promise.all(endpoints.map(([, endpoint]) => queryFoodQrEndpoint(endpoint, barcode)))
  results.forEach((result, index) => diagnostics.push({
    source: `푸드QR ${endpoints[index][0]}`,
    count: result.rows.length,
    error: result.error,
  }))

  const preferredVersion = recordVersion(listRow)
  const manufacture = pickCurrentPublicRow(results[0].rows, preferredVersion) ?? {}
  const labeling = pickCurrentPublicRow(results[1].rows, preferredVersion) ?? {}
  const packaging = pickCurrentPublicRow(results[2].rows, preferredVersion) ?? {}
  const rawMaterials = currentPublicRows(results[3].rows, preferredVersion)
  const nutritionRows = currentPublicRows(results[4].rows, preferredVersion)
  const allergyRows = currentPublicRows(results[5].rows, preferredVersion)
  const name = firstText(listRow.PRDT_NM, manufacture.PRDCT_NM, labeling.PRDCT_NM, '푸드QR 조회 제품')
  const maker = firstText(listRow.ENTP_NM, manufacture.BUES_NM, manufacture.BSOP_NM, nutritionRows[0]?.BUES_NM, '제조사 정보 없음')
  const reportNo = firstText(manufacture.IMRPT_NO, nutritionRows[0]?.IMRPT_NO)
  const materialText = firstText(packaging.CSTDY_TRMT)
  const ingredients = uniqueText(rawMaterials.flatMap((row) => {
    const detail = splitIngredientText(row.PRVW_CN)
    return detail.length ? detail : splitPublicText(row.RWMT_INDCT_GRCN)
  }))
  const allergens = uniqueText(allergyRows.map((row) => row.ALG_CSG_MTR_NM), 20)
  const servingAmount = firstText(nutritionRows[0]?.NTRTN_INDCT_TCT)
  const servingUnit = firstText(nutritionRows[0]?.NTRTN_INDCT_TCD)
  const packageText = firstText(labeling.TOT_CONTENTS, labeling.CAPACITY, manufacture.CAPACITY)
  const nutritionBasis = nutritionBasisFromValues(servingAmount, servingUnit, packageText)

  return {
    product: {
      barcode,
      name,
      maker,
      category: firstText(labeling.FOOD_TYPE_CD_NM, labeling.FOOD_SE_CD_NM, '식품'),
      serving: packageText || nutritionBasis.label,
      nutrients: nutrientsFromFoodQr(nutritionRows),
      nutritionBasis,
      availableNutrients: availableNutrientsFromFoodQr(nutritionRows),
      packageParts: packagePartsFromMaterial(materialText).length
        ? packagePartsFromMaterial(materialText)
        : guessPackagePartsFromText(`${name} ${firstText(labeling.FOOD_TYPE_CD_NM)}`),
      advice: '식약처 푸드QR에서 바코드와 연결된 최신 제품 표시정보를 조회했습니다.',
      source: '식약처 푸드QR 공공데이터',
      dataScope: 'domestic-public',
      reportNo,
      ingredients,
      safetyFlags: allergens.length ? [`알레르기 유발물질: ${allergens.join(', ')}`] : [],
    },
    diagnostics,
  }
}

function haccpUrl(reportNo) {
  const apiUrl = new URL('https://apis.data.go.kr/B553748/CertImgListServiceV3/getCertImgListServiceV3')
  apiUrl.searchParams.set('ServiceKey', config.publicDataKey)
  apiUrl.searchParams.set('prdlstReportNo', reportNo)
  apiUrl.searchParams.set('returnType', 'json')
  apiUrl.searchParams.set('pageNo', '1')
  apiUrl.searchParams.set('numOfRows', '10')
  return apiUrl
}

async function queryHaccpProduct(reportNo) {
  if (!hasPublicDataKey() || !reportNo) return { row: null, error: '' }

  try {
    const payload = await fetchJson(haccpUrl(reportNo), { timeoutMs: 5500 })
    const result = publicDataResult(payload)
    if (result.code && !['00', '0', 'OK'].includes(result.code)) {
      return { row: null, error: `${result.code} ${result.message}`.trim() }
    }
    return { row: publicDataRows(payload)[0] ?? null, error: '' }
  } catch (error) {
    return { row: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function nutritionDbUrl(reportNo) {
  const apiUrl = new URL('https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02')
  apiUrl.searchParams.set('serviceKey', config.publicDataKey)
  apiUrl.searchParams.set('pageNo', '1')
  apiUrl.searchParams.set('numOfRows', '10')
  apiUrl.searchParams.set('type', 'json')
  apiUrl.searchParams.set('ITEM_REPORT_NO', reportNo)
  return apiUrl
}

function nutrientsFromNutritionDb(row = {}) {
  const source = row ?? {}
  return {
    kcal: numberFrom(source.AMT_NUM1),
    carbs: numberFrom(source.AMT_NUM6),
    protein: numberFrom(source.AMT_NUM3),
    fat: numberFrom(source.AMT_NUM4),
    sodium: numberFrom(source.AMT_NUM13),
    calcium: numberFrom(source.AMT_NUM9),
    iron: numberFrom(source.AMT_NUM10),
  }
}

function nutrientsFromHaccpText(value) {
  const text = firstText(value)
  const amount = (names) => {
    const pattern = new RegExp(`(?:${names.join('|')})[^,\\n]*?([0-9,.]+)\\s*(?:kcal|mg|g)`, 'i')
    return numberFrom(text.match(pattern)?.[1])
  }

  return {
    kcal: amount(['열량', '에너지']),
    carbs: amount(['탄수화물']),
    protein: amount(['단백질']),
    fat: amount(['지방']),
    sodium: amount(['나트륨']),
    calcium: amount(['칼슘']),
    iron: amount(['철분', '철']),
  }
}

async function queryNutritionDb(reportNo) {
  if (!hasPublicDataKey() || !reportNo) return { row: null, error: '' }

  try {
    const payload = await fetchJson(nutritionDbUrl(reportNo), { timeoutMs: 5500 })
    const result = publicDataResult(payload)
    if (result.code && !['00', '0', 'OK', 'INFO-000'].includes(result.code)) {
      return { row: null, error: `${result.code} ${result.message}`.trim() }
    }
    return { row: publicDataRows(payload)[0] ?? null, error: '' }
  } catch (error) {
    return { row: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function mergeNutrients(primary, fallback) {
  return Object.fromEntries(
    Object.keys(emptyNutrients()).map((key) => [key, numberFrom(primary?.[key]) || numberFrom(fallback?.[key])]),
  )
}

function enrichProductWithPublicRows(product, haccp, nutrition) {
  const haccpIngredients = splitIngredientText(haccp?.rawmtrl)
  const haccpAllergy = firstText(haccp?.allergy)
  const haccpSource = haccp && !firstText(product.source).includes('HACCP') ? 'HACCP 제품정보' : ''
  const enrichmentSources = [haccpSource, nutrition ? '식품영양성분 DB' : ''].filter(Boolean)
  const sources = [product.source, ...enrichmentSources]

  return {
    ...product,
    name: firstText(product.name, haccp?.prdlstNm, nutrition?.FOOD_NM_KR),
    maker: firstText(product.maker, haccp?.manufacture, haccp?.seller, nutrition?.MAKER_NM),
    category: firstText(product.category, haccp?.prdkind, nutrition?.FOOD_CAT1_NM),
    serving: firstText(product.serving === '제품 포장 기준' ? '' : product.serving, haccp?.capacity, nutrition?.SERVING_SIZE, '제품 포장 기준'),
    nutrients: mergeNutrients(product.nutrients, nutrientsFromNutritionDb(nutrition)),
    availableNutrients: uniqueText([
      ...asArray(product.availableNutrients),
      ...availableNutrientsFromNutritionDb(nutrition),
    ], 7),
    ingredients: uniqueText([...asArray(product.ingredients), ...haccpIngredients]),
    safetyFlags: uniqueText([
      ...asArray(product.safetyFlags),
      haccpAllergy && haccpAllergy !== '알수없음' ? `알레르기 표시: ${haccpAllergy}` : '',
    ], 20),
    source: sources.join(' + '),
    advice: enrichmentSources.length
      ? `${product.advice} 품목제조보고번호로 ${enrichmentSources.join('와 ')}를 교차 보완했습니다.`
      : product.advice,
  }
}

async function enrichFoodQrProduct(product) {
  const [haccpResult, nutritionResult] = await Promise.all([
    queryHaccpProduct(product.reportNo),
    queryNutritionDb(product.reportNo),
  ])
  return {
    product: enrichProductWithPublicRows(product, haccpResult.row, nutritionResult.row),
    diagnostics: [
      { source: 'HACCP 제품정보', count: haccpResult.row ? 1 : 0, error: haccpResult.error },
      { source: '식품영양성분 DB', count: nutritionResult.row ? 1 : 0, error: nutritionResult.error },
    ],
  }
}

function buildHaccpDatabaseProduct(barcode, row) {
  const name = firstText(row?.prdlstNm, 'HACCP 조회 제품')
  const category = firstText(row?.prdkind, '식품')
  const allergy = firstText(row?.allergy)
  const manufacturer = firstText(row?.manufacture, row?.seller, '제조사 정보 없음')

  return {
    barcode,
    name,
    maker: manufacturer.split('_')[0],
    category,
    serving: firstText(row?.capacity, '제품 포장 기준'),
    nutrients: nutrientsFromHaccpText(row?.nutrient),
    nutritionBasis: nutritionBasisFromText(row?.nutrient, row?.capacity),
    availableNutrients: availableNutrientsFromText(row?.nutrient),
    packageParts: guessPackagePartsFromText(`${name} ${category}`),
    advice: '공공데이터에서 동기화한 HACCP 제품 인덱스로 바코드와 품목제조보고번호를 연결했습니다.',
    source: 'HACCP 공개데이터 DB',
    dataScope: 'domestic-public',
    reportNo: firstText(row?.prdlstReportNo),
    ingredients: splitIngredientText(row?.rawmtrl).slice(0, 8),
    safetyFlags: allergy && allergy !== '알수없음' ? [`알레르기 표시: ${allergy}`] : [],
  }
}

async function enrichHaccpDatabaseProduct(product, haccpRow) {
  const nutrients = product.nutrients ?? emptyNutrients()
  const hasHaccpNutrition = nutrients.kcal > 0 && (nutrients.carbs > 0 || nutrients.protein > 0 || nutrients.fat > 0)
  const nutritionResult = hasHaccpNutrition
    ? { row: null, error: '' }
    : await queryNutritionDb(product.reportNo)
  return {
    product: enrichProductWithPublicRows(product, haccpRow, nutritionResult.row),
    diagnostics: [
      { source: 'HACCP 공개데이터 DB', count: 1, error: '' },
      hasHaccpNutrition
        ? { source: 'HACCP 영양표시', count: 1, error: '' }
        : { source: '식품영양성분 DB', count: nutritionResult.row ? 1 : 0, error: nutritionResult.error },
    ],
  }
}

function wasteItemUrl(itemNm) {
  const apiUrl = new URL('https://apis.data.go.kr/1482000/WasteRecyclingService/getItem')
  apiUrl.searchParams.set('serviceKey', config.wasteKey)
  apiUrl.searchParams.set('pageNo', '1')
  apiUrl.searchParams.set('numOfRows', '3')
  apiUrl.searchParams.set('itemNm', itemNm)
  return apiUrl
}

function wasteSearchTermForPart(part) {
  const text = `${part.part ?? ''} ${part.material ?? ''} ${part.stream ?? ''}`.toLowerCase()

  if (text.includes('pet') || text.includes('페트')) return '무색페트병'
  if (text.includes('bottle')) return '무색페트병'
  if (text.includes('유리')) return '유리병'
  if (text.includes('glass')) return '유리병'
  if (text.includes('우유팩') || text.includes('종이팩')) return '종이팩'
  if (text.includes('팩')) return '종이팩'
  if (text.includes('carton')) return '종이팩'
  if (text.includes('비닐') || text.includes('vinyl') || text.includes('폴리에틸렌') || text.includes('폴리프로필렌')) return '비닐'
  if (text.includes('packet') || text.includes('wrapper') || text.includes('film') || text.includes('folie') || text.includes('bag') || text.includes('pouch')) return '비닐'
  if (text.includes('캔') || text.includes('알루미늄') || text.includes('철')) return text.includes('참치') ? '참치캔' : '음료캔'
  if (text.includes('can') || text.includes('aluminium') || text.includes('aluminum') || text.includes('metal')) return '음료캔'
  if (text.includes('pp') || text.includes('pe') || text.includes('ps') || text.includes('hdpe') || text.includes('플라스틱')) return '플라스틱'
  if (text.includes('plastic')) return '플라스틱'
  if (text.includes('종이')) return '종이'
  if (text.includes('paper') || text.includes('cardboard')) return '종이'

  return ''
}

async function queryWasteItem(itemNm) {
  if (!hasWasteKey()) {
    return { item: null, error: '분리배출 API 키가 설정되지 않았습니다.' }
  }

  if (wasteItemCache.has(itemNm)) {
    return wasteItemCache.get(itemNm)
  }

  const promise = fetchJson(wasteItemUrl(itemNm), { timeoutMs: 3500 })
    .then((payload) => {
      const response = payload?.response ?? {}
      const resultCode = firstText(response.header?.resultCode)
      const resultMsg = firstText(response.header?.resultMsg)

      if (resultCode && resultCode !== '00') {
        return { item: null, error: `${resultCode} ${resultMsg}`.trim() }
      }

      const items = asArray(response.body?.items?.item)
      const item = items.find((candidate) => firstText(candidate?.itemNm, candidate?.dschgMthd))
      return item ? { item, error: '' } : { item: null, error: '검색 결과 없음' }
    })
    .catch((error) => ({ item: null, error: error instanceof Error ? error.message : String(error) }))

  wasteItemCache.set(itemNm, promise)
  return promise
}

async function enrichPackagePartsWithWasteApi(packageParts) {
  const parts = asArray(packageParts)

  return Promise.all(
    parts.map(async (part) => {
      const query = wasteSearchTermForPart(part)

      if (!query) {
        return { ...part, source: '재질 추정', confidence: part.confidence ?? 'material-inferred' }
      }

      const result = await queryWasteItem(query)
      const itemName = firstText(result.item?.itemNm)
      const method = firstText(result.item?.dschgMthd)

      if (!itemName || !method) {
        return {
          ...part,
          query,
          source: result.error ? `재질 추정(API 미응답: ${result.error})` : '재질 추정',
          confidence: part.confidence ?? 'material-inferred',
        }
      }

      return {
        ...part,
        query,
        stream: method,
        guide: `${part.guide} 공공데이터포털 분리배출 품목 "${itemName}" 기준 대표 배출방법은 ${method}입니다.`,
        source: '분리배출 정보조회 API',
        confidence: 'official-confirmed',
      }
    }),
  )
}

async function enrichProductRecycling(product) {
  return {
    ...product,
    packageParts: await enrichPackagePartsWithWasteApi(product.packageParts),
  }
}

function recycleGuideForMaterial(material) {
  const normalized = material.toUpperCase()

  if (normalized.includes('PET') || material.includes('페트')) {
    return { stream: '페트병/플라스틱류', guide: '내용물을 비우고 라벨과 뚜껑을 분리한 뒤 배출합니다.' }
  }

  if (material.includes('내면') && (material.includes('폴리에틸렌') || material.includes('폴리프로필렌'))) {
    return { stream: '비닐류', guide: '내용물과 이물질을 제거한 뒤 비닐류로 배출합니다.' }
  }

  if (
    normalized.includes('PP')
    || normalized.includes('PE')
    || normalized.includes('PS')
    || material.includes('플라스틱')
    || material.includes('폴리에틸렌')
    || material.includes('폴리프로필렌')
    || material.includes('폴리스티렌')
  ) {
    return { stream: '플라스틱류', guide: '음식물이 묻어 있으면 헹군 뒤 플라스틱류로 배출합니다.' }
  }

  if (material.includes('비닐') || normalized.includes('VINYL')) {
    return { stream: '비닐류', guide: '부스러기와 이물질을 털고 비닐류로 배출합니다.' }
  }

  if (material.includes('종이') || material.includes('팩')) {
    return { stream: material.includes('팩') ? '종이팩' : '종이류', guide: '내용물을 비우고 펼치거나 접어서 배출합니다.' }
  }

  if (material.includes('캔') || material.includes('알루미늄') || material.includes('철')) {
    return { stream: '캔류', guide: '내용물을 비우고 가능하면 헹군 뒤 캔류로 배출합니다.' }
  }

  if (material.includes('유리')) {
    return { stream: '유리병', guide: '뚜껑을 분리하고 내용물을 비운 뒤 유리병으로 배출합니다.' }
  }

  return { stream: '표시 확인', guide: '포장지의 분리배출 표시와 지역 배출 기준을 함께 확인합니다.' }
}

function packagePartsFromMaterial(materialText) {
  const materials = firstText(materialText)
    .replace(/\s+/g, ' ')
    .split(/[,/+\n]| 및 |ㆍ/)
    .map((item) => item.trim())
    .filter(Boolean)

  return materials.slice(0, 5).map((material, index) => {
    const guide = recycleGuideForMaterial(material)
    return {
      part: index === 0 ? '주 포장' : `포장 부품 ${index + 1}`,
      material,
      stream: guide.stream,
      guide: guide.guide,
      confidence: 'material-inferred',
    }
  })
}

function guessPackagePartsFromText(text) {
  const source = text.toLowerCase()

  if (source.includes('음료') || source.includes('주스') || source.includes('water') || source.includes('drink')) {
    return [
      { part: '병', material: 'PET 또는 유리', stream: '표시 확인', guide: '라벨을 떼고 내용물을 비운 뒤 분리배출 표시를 확인합니다.', confidence: 'label-required' },
      { part: '라벨/뚜껑', material: '비닐류/플라스틱', stream: '각 재질별', guide: '분리 가능한 부품은 따로 배출합니다.', confidence: 'label-required' },
    ]
  }

  if (source.includes('캔')) {
    return [{ part: '용기', material: '금속캔', stream: '캔류', guide: '내용물을 비우고 헹군 뒤 캔류로 배출합니다.', confidence: 'material-inferred' }]
  }

  return [
    { part: '외포장', material: '포장재 표시 확인', stream: '직접 확인', guide: '바코드 주변 또는 뒷면의 분리배출 표시를 보고 재질별로 배출합니다.', confidence: 'label-required' },
    { part: '라벨/부속 포장', material: '비닐류 또는 종이', stream: '각 재질별', guide: '떼어낼 수 있는 부품은 분리해서 배출합니다.', confidence: 'label-required' },
  ]
}

function emptyNutrients() {
  return { kcal: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, calcium: 0, iron: 0 }
}

function buildFoodSafetyProduct(barcode, c005, i2570, i1250, c002Rows) {
  const primary = c005 ?? i2570 ?? i1250 ?? {}
  const reportNo = firstText(c005?.PRDLST_REPORT_NO, i2570?.PRDLST_REPORT_NO, i1250?.PRDLST_REPORT_NO)
  const name = firstText(c005?.PRDLST_NM, i2570?.PRDT_NM, i2570?.PRDLST_NM, i1250?.PRDLST_NM, '공공 API 조회 제품')
  const maker = firstText(c005?.BSSH_NM, i2570?.CMPNY_NM, i1250?.BSSH_NM, '제조사 정보 없음')
  const category = firstText(
    c005?.PRDLST_DCNM,
    i1250?.PRDLST_DCNM,
    [i2570?.HTRK_PRDLST_NM, i2570?.HRNK_PRDLST_NM, i2570?.PRDLST_NM].filter(Boolean).join(' / '),
    '식품',
  )
  const packageParts = packagePartsFromMaterial(i1250?.FRMLC_MTRQLT)
  const ingredients = c002Rows.map((row) => firstText(row.RAWMTRL_NM)).filter(Boolean)
  const flags = [
    firstText(i1250?.HIENG_LNTRT_DVS_NM) ? `고열량저영양: ${i1250.HIENG_LNTRT_DVS_NM}` : '',
    firstText(i1250?.CHILD_CRTFC_YN) ? `어린이기호식품품질인증: ${i1250.CHILD_CRTFC_YN}` : '',
    firstText(i1250?.POG_DAYCNT, c005?.POG_DAYCNT) ? `소비기한: ${firstText(i1250?.POG_DAYCNT, c005?.POG_DAYCNT)}` : '',
  ].filter(Boolean)

  return {
    barcode,
    name,
    maker,
    category,
    serving: firstText(primary.POG_DAYCNT) ? `소비기한 ${primary.POG_DAYCNT}` : '제품 포장 기준',
    nutrients: emptyNutrients(),
    nutritionBasis: nutritionBasisFromText('', ''),
    availableNutrients: [],
    packageParts: packageParts.length ? packageParts : guessPackagePartsFromText(`${name} ${category}`),
    advice: reportNo
      ? '바코드로 제품을 찾고 품목보고번호로 포장재질과 제품 정보를 보완했습니다.'
      : '바코드 공공 API로 제품명을 확인했습니다. 포장재질은 제품 표시 기반으로 보완 확인이 필요합니다.',
    source: [c005 ? 'C005' : '', i1250 ? 'I1250' : '', i2570 ? 'I2570' : '', c002Rows.length ? 'C002' : ''].filter(Boolean).join(' + '),
    dataScope: 'domestic-public',
    reportNo,
    ingredients: ingredients.slice(0, 8),
    safetyFlags: flags,
  }
}

function buildOpenFoodFactsProduct(barcode, product) {
  const packagingText = firstText(product.packaging, product.packagings?.map?.((item) => firstText(item.material, item.shape)).join(', '))
  const packageParts = packagePartsFromMaterial(packagingText)
  const nutrition = openFoodFactsNutrition(product)

  return {
    barcode,
    name: firstText(product.product_name, 'Open Food Facts 제품'),
    maker: firstText(product.brands, '브랜드 정보 없음'),
    category: firstText(product.categories, '식품'),
    serving: firstText(product.quantity, '제품 포장 기준'),
    nutrients: nutrition.nutrients,
    nutritionBasis: nutrition.basis,
    availableNutrients: nutrition.availableNutrients,
    packageParts: packageParts.length ? packageParts : guessPackagePartsFromText(`${product.product_name ?? ''} ${product.categories ?? ''}`),
    advice: '국내 공공데이터에서 제품을 찾지 못해 Open Food Facts의 글로벌 커뮤니티 정보를 참고용으로 표시합니다. 실제 제품 포장 표시와 함께 확인해 주세요.',
    source: 'Open Food Facts · 글로벌 커뮤니티',
    dataScope: 'global-community',
    reportNo: '',
    ingredients: firstText(product.ingredients_text)
      .split(/[,;]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8),
    safetyFlags: [
      firstText(product.recycling_instructions_to_recycle) ? `재활용 안내: ${product.recycling_instructions_to_recycle}` : '',
      firstText(product.recycling_instructions_to_discard) ? `폐기 안내: ${product.recycling_instructions_to_discard}` : '',
    ].filter(Boolean),
  }
}

async function queryOpenFoodFacts(barcode) {
  const fields = [
    'product_name',
    'brands',
    'quantity',
    'serving_size',
    'categories',
    'nutriments',
    'packaging',
    'packagings',
    'recycling_instructions_to_recycle',
    'recycling_instructions_to_discard',
    'ingredients_text',
  ].join(',')
  const urls = [
    `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}?fields=${encodeURIComponent(fields)}`,
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${encodeURIComponent(fields)}`,
  ]

  for (const apiUrl of urls) {
    try {
      const payload = await fetchJson(apiUrl, { headers: { 'user-agent': config.appUserAgent }, timeoutMs: 4500 })
      const product = payload?.product

      if (product) {
        return buildOpenFoodFactsProduct(barcode, product)
      }
    } catch {
      // Try the next Open Food Facts endpoint before giving up.
    }
  }

  return null
}

async function queryUpcItemDb(barcode) {
  const apiUrl = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`

  try {
    const payload = await fetchJson(apiUrl, { headers: { 'user-agent': config.appUserAgent }, timeoutMs: 3500 })
    const item = payload?.items?.[0]

    if (!item) {
      return { product: null, error: '' }
    }

    const title = firstText(item.title, item.description, 'UPCitemdb 제품')
    const category = firstText(item.category, item.category_path?.join?.(' / '), '상품')
    const maker = firstText(item.brand, item.publisher, '브랜드 정보 없음')

    return {
      product: {
        barcode,
        name: title,
        maker,
        category,
        serving: firstText(item.size, item.dimension, '상품 포장 기준'),
        nutrients: emptyNutrients(),
        nutritionBasis: nutritionBasisFromText('', firstText(item.size)),
        availableNutrients: [],
        packageParts: guessPackagePartsFromText(`${title} ${category}`),
        advice: '국내 공공데이터에서 제품을 찾지 못해 UPCitemdb의 글로벌 상품 정보를 참고용으로 표시합니다. 영양성분과 포장재질은 제품 표시 확인이 필요합니다.',
        source: 'UPCitemdb · 글로벌 상품 DB',
        dataScope: 'global-community',
        reportNo: '',
        ingredients: [],
        safetyFlags: [],
      },
      error: '',
    }
  } catch (error) {
    return { product: null, error: error instanceof Error ? error.message : String(error) }
  }
}

async function handleSchoolSearch(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const school = url.searchParams.get('school')?.trim()

  if (!school) {
    sendError(res, 400, '학교명을 입력해야 합니다.')
    return
  }

  try {
    const result = await fetchNeisJson('schoolInfo', 'schoolInfo', { SCHUL_NM: school })
    sendJson(res, 200, {
      ok: true,
      source: result.usedKey ? 'neis-key' : 'neis-open',
      rows: readRows(result.payload, 'schoolInfo'),
      warnings: result.warnings,
    })
  } catch (error) {
    sendError(res, 502, 'NEIS 학교 검색에 실패했습니다.', error instanceof Error ? error.message : String(error))
  }
}

async function handleMeal(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const officeCode = url.searchParams.get('officeCode')?.trim()
  const schoolCode = url.searchParams.get('schoolCode')?.trim()
  const date = url.searchParams.get('date')?.replace(/\D/g, '')

  if (!officeCode || !schoolCode || !date) {
    sendError(res, 400, '교육청 코드, 학교 코드, 날짜가 필요합니다.')
    return
  }

  try {
    const result = await fetchNeisJson('mealServiceDietInfo', 'mealServiceDietInfo', {
      ATPT_OFCDC_SC_CODE: officeCode,
      SD_SCHUL_CODE: schoolCode,
      MLSV_YMD: date,
    })
    sendJson(res, 200, {
      ok: true,
      source: result.usedKey ? 'neis-key' : 'neis-open',
      rows: readRows(result.payload, 'mealServiceDietInfo'),
      warnings: result.warnings,
    })
  } catch (error) {
    sendError(res, 502, 'NEIS 급식 조회에 실패했습니다.', error instanceof Error ? error.message : String(error))
  }
}

function ensureProductNutritionBasis(barcode, product) {
  const hadPackageConfidence = asArray(product?.packageParts).every((part) => part.confidence)
  const packageParts = asArray(product?.packageParts).map((part) => ({
    ...part,
    confidence: part.confidence
      ?? (part.source === '분리배출 정보조회 API' ? 'official-confirmed'
        : part.material?.includes('표시 확인') ? 'label-required' : 'material-inferred'),
  }))
  if (product?.nutritionBasis && Array.isArray(product.availableNutrients) && hadPackageConfidence) {
    return product
  }
  const haccpRow = !isCommunityProduct(product) ? findHaccpProductByBarcode(barcode) : null
  if (!haccpRow) return { ...product, packageParts }
  return {
    ...product,
    packageParts,
    nutritionBasis: product.nutritionBasis ?? nutritionBasisFromText(haccpRow.nutrient, haccpRow.capacity),
    availableNutrients: Array.isArray(product.availableNutrients) ? product.availableNutrients : availableNutrientsFromText(haccpRow.nutrient),
  }
}

function withoutCacheAdvice(product) {
  const advice = firstText(product?.advice)
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !sentence.includes('캐시'))
    .join(' ')
  return { ...product, advice }
}

function sendFoundProduct(res, barcode, product, diagnostics, cache = true) {
  const normalizedProduct = ensureProductNutritionBasis(barcode, product)
  if (cache || normalizedProduct !== product) saveProductCache(barcode, normalizedProduct, productCacheHours(normalizedProduct))
  logBarcodeLookup(barcode, true, normalizedProduct.source)
  sendJson(res, 200, {
    ok: true,
    found: true,
    source: normalizedProduct.source,
    product: normalizedProduct,
    diagnostics,
  })
}

async function handleBarcode(req, res, barcode) {
  const validation = validateRetailBarcode(barcode)
  const normalized = validation.barcode

  if (!validation.valid) {
    sendError(res, 400, validation.message)
    return
  }

  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const refresh = requestUrl.searchParams.get('refresh') === '1'
  const freshCache = refresh ? null : findCachedProduct(normalized)

  if (freshCache && !isCommunityProduct(freshCache.product)) {
    const product = withoutCacheAdvice(freshCache.product)
    sendFoundProduct(res, normalized, product, [{ source: '서버 DB 캐시', count: 1, error: '' }], false)
    return
  }

  const foodQrResult = await queryFoodQrProduct(normalized)
  const diagnostics = [...foodQrResult.diagnostics]

  if (foodQrResult.product) {
    const publicEnrichment = await enrichFoodQrProduct(foodQrResult.product)
    const product = await enrichProductRecycling(publicEnrichment.product)
    sendFoundProduct(res, normalized, product, [...diagnostics, ...publicEnrichment.diagnostics])
    return
  }

  const indexedHaccpRow = findHaccpProductByBarcode(normalized)

  if (indexedHaccpRow) {
    const baseProduct = buildHaccpDatabaseProduct(normalized, indexedHaccpRow)
    const publicEnrichment = await enrichHaccpDatabaseProduct(baseProduct, indexedHaccpRow)
    const product = await enrichProductRecycling(publicEnrichment.product)
    sendFoundProduct(res, normalized, product, [...diagnostics, ...publicEnrichment.diagnostics])
    return
  }

  diagnostics.push({ source: 'HACCP 공개데이터 DB', count: 0, error: '' })

  const [c005Result, i2570Result] = await Promise.all([
    queryFoodSafety('C005', { BAR_CD: normalized }),
    queryFoodSafety('I2570', { BRCD_NO: normalized }),
  ])
  diagnostics.push({ source: 'C005', count: c005Result.rows.length, error: c005Result.error })
  const c005 = c005Result.rows[0]
  diagnostics.push({ source: 'I2570', count: i2570Result.rows.length, error: i2570Result.error })
  const i2570 = i2570Result.rows[0]
  const reportNo = firstText(c005?.PRDLST_REPORT_NO, i2570?.PRDLST_REPORT_NO)

  const [i1250Result, c002Result] = reportNo
    ? await Promise.all([
        queryFoodSafety('I1250', { PRDLST_REPORT_NO: reportNo }),
        queryFoodSafety('C002', { PRDLST_REPORT_NO: reportNo }),
      ])
    : [{ rows: [], error: '' }, { rows: [], error: '' }]
  diagnostics.push({ source: 'I1250', count: i1250Result.rows.length, error: i1250Result.error })
  const i1250 = i1250Result.rows[0]
  diagnostics.push({ source: 'C002', count: c002Result.rows.length, error: c002Result.error })

  if (c005 || i2570 || i1250) {
    const product = await enrichProductRecycling(buildFoodSafetyProduct(normalized, c005, i2570, i1250, c002Result.rows))
    sendFoundProduct(res, normalized, product, diagnostics)
    return
  }

  if (freshCache?.product?.nutritionBasis && Array.isArray(freshCache.product.availableNutrients)) {
    const product = {
      ...withoutCacheAdvice(freshCache.product),
      dataScope: 'global-community',
    }
    sendFoundProduct(res, normalized, product, [
      ...diagnostics,
      { source: '국내 공공데이터 우선 재조회', count: 0, error: '' },
      { source: '글로벌 커뮤니티 캐시', count: 1, error: '' },
    ], false)
    return
  }

  const openFoodFactsProduct = await queryOpenFoodFacts(normalized)

  if (openFoodFactsProduct) {
    const product = await enrichProductRecycling(openFoodFactsProduct)
    sendFoundProduct(res, normalized, product, [...diagnostics, { source: 'Open Food Facts', count: 1, error: '' }])
    return
  }

  const upcItemDbResult = await queryUpcItemDb(normalized)

  if (upcItemDbResult.product) {
    const product = await enrichProductRecycling(upcItemDbResult.product)
    sendFoundProduct(res, normalized, product, [
      ...diagnostics,
      { source: 'Open Food Facts', count: 0, error: '' },
      { source: 'UPCitemdb', count: 1, error: '' },
    ])
    return
  }

  const cached = findCachedProduct(normalized, true)

  if (cached) {
    const product = withoutCacheAdvice(cached.product)
    sendFoundProduct(res, normalized, product, [
      ...diagnostics,
      { source: 'Open Food Facts', count: 0, error: '' },
      { source: 'UPCitemdb', count: 0, error: upcItemDbResult.error },
      { source: '서버 DB 캐시', count: 1, error: '' },
    ], false)
    return
  }

  logBarcodeLookup(normalized, false, 'not-found')

  sendJson(res, 200, {
    ok: true,
    found: false,
    source: 'not-found',
    rows: [],
    message: '연결된 바코드 API에서 제품을 찾지 못했습니다. 다른 바코드를 스캔하거나 포장재 표시를 직접 확인해 주세요.',
    diagnostics: [
      ...diagnostics,
      { source: 'Open Food Facts', count: 0, error: '' },
      { source: 'UPCitemdb', count: 0, error: upcItemDbResult.error },
    ],
  })
}

async function handleRecycling(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const item = url.searchParams.get('item')?.trim()

  if (!item) {
    sendError(res, 400, '분리배출 품목명이 필요합니다.')
    return
  }

  const result = await queryWasteItem(item)

  sendJson(res, 200, {
    ok: true,
    found: Boolean(result.item),
    source: '분리배출 정보조회 API',
    item: result.item,
    message: result.error,
  })
}

async function handleFoodLog(req, res, entryId = '') {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  if (req.method === 'GET' && !entryId) {
    const ownerId = url.searchParams.get('ownerId')?.trim() ?? ''
    const month = url.searchParams.get('month')?.trim() ?? ''
    const date = url.searchParams.get('date')?.trim() ?? ''

    if (!validOwnerId(ownerId)) {
      sendError(res, 400, '올바른 사용자 식별자가 필요합니다.')
      return
    }
    if (date && !validDate(date)) {
      sendError(res, 400, '날짜 형식은 YYYY-MM-DD여야 합니다.')
      return
    }
    if (!date && !validMonth(month)) {
      sendError(res, 400, '월 형식은 YYYY-MM여야 합니다.')
      return
    }

    sendJson(res, 200, {
      ok: true,
      entries: listFoodLogEntries(ownerId, date ? { date } : { month }),
    })
    return
  }

  if (req.method === 'POST' && !entryId) {
    try {
      const entry = validateFoodLogEntry(await readJsonBody(req))
      sendJson(res, 200, { ok: true, entry: saveFoodLogEntry(entry) })
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '식단 기록을 저장하지 못했습니다.')
    }
    return
  }

  if (req.method === 'DELETE' && entryId) {
    const ownerId = url.searchParams.get('ownerId')?.trim() ?? ''
    if (!validOwnerId(ownerId) || !/^\d+$/.test(entryId)) {
      sendError(res, 400, '삭제할 기록 정보가 올바르지 않습니다.')
      return
    }

    const deleted = deleteFoodLogEntry(Number(entryId), ownerId)
    sendJson(res, deleted ? 200 : 404, {
      ok: deleted,
      message: deleted ? '식단 기록을 삭제했습니다.' : '식단 기록을 찾지 못했습니다.',
    })
    return
  }

  sendError(res, 405, '지원하지 않는 요청 방식입니다.')
}

async function handleApi(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  if (url.pathname === '/api/health') {
    const stats = getDatabaseStats()
    sendJson(res, 200, {
      ok: true,
      status: 'ready',
      uptimeSeconds: Math.round(process.uptime()),
      databaseReady: true,
      haccpProductsWithBarcode: stats.haccpProductsWithBarcode,
      checkedAt: new Date().toISOString(),
    })
    return true
  }

  if (url.pathname === '/api/food-log') {
    await handleFoodLog(req, res)
    return true
  }

  if (url.pathname.startsWith('/api/food-log/')) {
    await handleFoodLog(req, res, decodeURIComponent(url.pathname.replace('/api/food-log/', '')))
    return true
  }

  if (url.pathname === '/api/school/search') {
    await handleSchoolSearch(req, res)
    return true
  }

  if (url.pathname === '/api/meals') {
    await handleMeal(req, res)
    return true
  }

  if (url.pathname.startsWith('/api/barcode/')) {
    await handleBarcode(req, res, decodeURIComponent(url.pathname.replace('/api/barcode/', '')))
    return true
  }

  if (url.pathname === '/api/recycling') {
    await handleRecycling(req, res)
    return true
  }

  if (url.pathname === '/api/database/status') {
    const stats = getDatabaseStats()
    sendJson(res, 200, {
      ok: true,
      haccpProducts: stats.haccpProducts,
      haccpProductsWithBarcode: stats.haccpProductsWithBarcode,
      haccpLatest: stats.haccpLatest,
      cachedProducts: stats.cachedProducts,
      lookupEvents: stats.lookupEvents,
      foodLogEntries: stats.foodLogEntries,
      foodLogOwners: stats.foodLogOwners,
      sync: stats.sync,
    })
    return true
  }

  if (url.pathname === '/api/config') {
    sendJson(res, 200, {
      ok: true,
      neisKeyReady: neisKeyReady(),
      publicDataKeyReady: hasPublicDataKey(),
      foodSafetyKeyReady: hasFoodSafetyKey(),
      wasteKeyReady: hasWasteKey(),
      databaseReady: true,
    })
    return true
  }

  return false
}

function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
  const safePath = normalize(join(distDir, requested))
  const filePath = safePath.startsWith(distDir) && existsSync(safePath) ? safePath : join(distDir, 'index.html')
  const ext = extname(filePath)

  res.writeHead(200, { 'content-type': contentTypes[ext] ?? 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

async function createRequestHandler() {
  const useStatic = process.argv.includes('--static')

  if (useStatic) {
    return async (req, res) => {
      if (req.url?.startsWith('/api/') && (await handleApi(req, res))) {
        return
      }
      serveStatic(req, res)
    }
  }

  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    root: rootDir,
    appType: 'spa',
    server: { middlewareMode: true },
  })

  return async (req, res) => {
    if (req.url?.startsWith('/api/') && (await handleApi(req, res))) {
      return
    }
    vite.middlewares(req, res)
  }
}

const handler = await createRequestHandler()

createServer((req, res) => {
  handler(req, res).catch((error) => {
    sendError(res, 500, '서버 처리 중 오류가 발생했습니다.', error instanceof Error ? error.message : String(error))
  })
}).listen(config.port, config.host, () => {
  const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host
  console.log(`NutriCycle server: http://${displayHost}:${config.port}/`)
})
