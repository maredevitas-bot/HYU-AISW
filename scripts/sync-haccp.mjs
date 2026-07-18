import { getDatabaseStats, saveSyncState, upsertHaccpProducts } from '../database.mjs'

const key = process.env.PUBLIC_DATA_API_KEY ?? process.env.WASTE_API_KEY ?? ''
const pageSize = Math.max(10, Math.min(100, Number(process.env.HACCP_SYNC_PAGE_SIZE ?? 100)))
const concurrency = Math.max(1, Math.min(6, Number(process.env.HACCP_SYNC_CONCURRENCY ?? 4)))
const maxPages = Math.max(0, Number(process.env.HACCP_SYNC_MAX_PAGES ?? 0))

if (!key) {
  throw new Error('PUBLIC_DATA_API_KEY 환경변수가 필요합니다.')
}

function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function rowsFromPayload(payload) {
  return asArray(payload?.body?.items).flatMap((entry) => asArray(entry?.item ?? entry))
}

async function requestPage(pageNo) {
  const apiUrl = new URL('https://apis.data.go.kr/B553748/CertImgListServiceV3/getCertImgListServiceV3')
  apiUrl.searchParams.set('ServiceKey', key)
  apiUrl.searchParams.set('returnType', 'json')
  apiUrl.searchParams.set('pageNo', String(pageNo))
  apiUrl.searchParams.set('numOfRows', String(pageSize))

  const response = await fetch(apiUrl, { signal: AbortSignal.timeout(20000) })
  const body = await response.text()
  if (!response.ok) throw new Error(`HACCP ${pageNo}페이지 HTTP ${response.status}: ${body.slice(0, 120)}`)

  const payload = JSON.parse(body)
  const resultCode = String(payload?.header?.resultCode ?? '').trim()
  if (resultCode && !['00', '0', 'OK'].includes(resultCode)) {
    throw new Error(`HACCP ${pageNo}페이지 ${resultCode}: ${payload?.header?.resultMsg ?? ''}`)
  }

  return {
    pageNo,
    totalCount: Number(payload?.body?.totalCount ?? 0),
    rows: rowsFromPayload(payload),
  }
}

async function fetchPage(pageNo) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await requestPage(pageNo)
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }
  throw lastError
}

const firstPage = await fetchPage(1)
const availablePages = Math.max(1, Math.ceil(firstPage.totalCount / pageSize))
const totalPages = maxPages ? Math.min(maxPages, availablePages) : availablePages
let stored = upsertHaccpProducts(firstPage.rows)
saveSyncState({ recordCount: stored, lastPage: 1, totalPages })
console.log(`HACCP 동기화: 1/${totalPages} 페이지, ${stored}건 저장`)

for (let start = 2; start <= totalPages; start += concurrency) {
  const pageNumbers = Array.from(
    { length: Math.min(concurrency, totalPages - start + 1) },
    (_, index) => start + index,
  )
  const pages = await Promise.all(pageNumbers.map(fetchPage))

  for (const page of pages.sort((left, right) => left.pageNo - right.pageNo)) {
    stored += upsertHaccpProducts(page.rows)
    saveSyncState({ recordCount: stored, lastPage: page.pageNo, totalPages })
    console.log(`HACCP 동기화: ${page.pageNo}/${totalPages} 페이지, ${stored}건 저장`)
  }
}

saveSyncState({ recordCount: stored, lastPage: totalPages, totalPages, completed: totalPages === availablePages })
const stats = getDatabaseStats()
console.log(`완료: 전체 ${stats.haccpProducts}건, 바코드 보유 ${stats.haccpProductsWithBarcode}건`)
