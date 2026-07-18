const baseUrl = String(process.argv[2] ?? process.env.BASE_URL ?? 'https://hyu-aisw.onrender.com').replace(/\/$/, '')

async function getJson(path, timeoutMs = 20_000) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
  const payload = await response.json()
  if (!response.ok || !payload.ok) throw new Error(`${path}: ${payload.message ?? response.status}`)
  return payload
}

const health = await getJson('/api/health')
const config = await getJson('/api/config')
const database = await getJson('/api/database/status')
const sample = await getJson('/api/barcode/8801024949960', 30_000)

const checks = [
  ['서버 응답', health.status === 'ready'],
  ['NEIS 키', config.neisKeyReady],
  ['공공데이터 키', config.publicDataKeyReady],
  ['분리배출 키', config.wasteKeyReady],
  ['HACCP 바코드 DB', database.haccpProductsWithBarcode > 0],
  ['국내 제품 조회', sample.product?.dataScope === 'domestic-public'],
  ['영양 기준량', sample.product?.nutritionBasis?.confidence === 'declared'],
  ['분리배출 근거 수준', sample.product?.packageParts?.every((part) => part.confidence)],
]

for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`)
if (checks.some(([, passed]) => !passed)) process.exitCode = 1
