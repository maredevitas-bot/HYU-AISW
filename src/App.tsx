import type { IScannerControls } from '@zxing/browser'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import heroImage from './assets/hero.png'
import './App.css'

type Gender = 'female' | 'male'
type Activity = 'low' | 'normal' | 'high'

type Nutrients = {
  kcal: number
  carbs: number
  protein: number
  fat: number
  sodium: number
  calcium: number
  iron: number
}

type MealItem = {
  name: string
  amount: string
  note: string
  nutrients: Nutrients
}

type Product = {
  barcode: string
  name: string
  maker: string
  category: string
  serving: string
  nutrients: Nutrients
  packageParts: PackagePart[]
  advice: string
  source?: string
  reportNo?: string
  ingredients?: string[]
  safetyFlags?: string[]
}

type PackagePart = {
  part: string
  material: string
  stream: string
  guide: string
  source?: string
  query?: string
}

type SchoolRow = {
  ATPT_OFCDC_SC_CODE: string
  ATPT_OFCDC_SC_NM?: string
  SD_SCHUL_CODE: string
  SCHUL_NM: string
  LCTN_SC_NM?: string
}

type MealApiRow = {
  MMEAL_SC_NM?: string
  MLSV_YMD?: string
  DDISH_NM?: string
  CAL_INFO?: string
  NTR_INFO?: string
}

type NutritionTarget = Nutrients & {
  dayKcal: number
}

type BarcodeLookupResponse = {
  ok?: boolean
  found?: boolean
  product?: Product
  source?: string
  message?: string
}

type DetectedBarcode = {
  rawValue?: string
  format?: string
}

type BarcodeDetectorInstance = {
  detect: (image: CanvasImageSource) => Promise<DetectedBarcode[]>
}

type BarcodeDetectorStatic = {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance
  getSupportedFormats?: () => Promise<string[]>
}

type BarcodeWindow = Window & {
  BarcodeDetector?: BarcodeDetectorStatic
}

const barcodeFormats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code']

const activityOptions: Record<Activity, { label: string; factor: number }> = {
  low: { label: '활동 적음', factor: 0.92 },
  normal: { label: '보통', factor: 1 },
  high: { label: '운동 많음', factor: 1.12 },
}

const profileTargets: Record<Gender, { label: string; dayKcal: number; protein: number; calcium: number; iron: number }> = {
  female: { label: '여학생', dayKcal: 2000, protein: 55, calcium: 900, iron: 14 },
  male: { label: '남학생', dayKcal: 2600, protein: 65, calcium: 900, iron: 11 },
}

const lunchRatio = 0.34

const sampleMealItems: MealItem[] = [
  {
    name: '잡곡밥',
    amount: '1공기',
    note: '주 에너지',
    nutrients: { kcal: 315, carbs: 68, protein: 7, fat: 1.3, sodium: 12, calcium: 18, iron: 1.1 },
  },
  {
    name: '닭가슴살 채소볶음',
    amount: '1접시',
    note: '단백질',
    nutrients: { kcal: 205, carbs: 10, protein: 28, fat: 6.5, sodium: 520, calcium: 42, iron: 1.4 },
  },
  {
    name: '김치콩나물국',
    amount: '1그릇',
    note: '국물 조절',
    nutrients: { kcal: 72, carbs: 8, protein: 5, fat: 2, sodium: 780, calcium: 66, iron: 1.2 },
  },
  {
    name: '시금치나물',
    amount: '반찬 1칸',
    note: '무기질',
    nutrients: { kcal: 38, carbs: 5, protein: 3, fat: 1, sodium: 180, calcium: 96, iron: 2.2 },
  },
  {
    name: '우유',
    amount: '200mL',
    note: '칼슘',
    nutrients: { kcal: 130, carbs: 10, protein: 6, fat: 7, sodium: 95, calcium: 220, iron: 0 },
  },
]

const barcodeSamples = [
  { label: 'Nutella', barcode: '3017620422003' },
  { label: 'Prince 비스킷', barcode: '7622210449283' },
  { label: 'Barilla 파스타', barcode: '8076800195057' },
]

function emptyNutrients(): Nutrients {
  return { kcal: 0, carbs: 0, protein: 0, fat: 0, sodium: 0, calcium: 0, iron: 0 }
}

function addNutrients(items: MealItem[]): Nutrients {
  return items.reduce((total, item) => {
    return {
      kcal: total.kcal + item.nutrients.kcal,
      carbs: total.carbs + item.nutrients.carbs,
      protein: total.protein + item.nutrients.protein,
      fat: total.fat + item.nutrients.fat,
      sodium: total.sodium + item.nutrients.sodium,
      calcium: total.calcium + item.nutrients.calcium,
      iron: total.iron + item.nutrients.iron,
    }
  }, emptyNutrients())
}

function makeTarget(gender: Gender, activity: Activity): NutritionTarget {
  const profile = profileTargets[gender]
  const dayKcal = Math.round(profile.dayKcal * activityOptions[activity].factor)
  return {
    dayKcal,
    kcal: Math.round(dayKcal * lunchRatio),
    carbs: Math.round((dayKcal * lunchRatio * 0.58) / 4),
    protein: Math.round(profile.protein * lunchRatio),
    fat: Math.round((dayKcal * lunchRatio * 0.24) / 9),
    sodium: 650,
    calcium: Math.round(profile.calcium * lunchRatio),
    iron: Number((profile.iron * lunchRatio).toFixed(1)),
  }
}

function percent(value: number, target: number) {
  return Math.min(140, Math.round((value / target) * 100))
}

function formatNumber(value: number, unit: string) {
  return `${Math.round(value).toLocaleString('ko-KR')}${unit}`
}

function normalizeBarcode(value: string) {
  return value.replace(/\D/g, '')
}

function toNeisDate(date: string) {
  return date.replace(/\D/g, '')
}

function todayInputValue() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function parseHtmlList(value?: string) {
  return (value ?? '')
    .replace(/\([0-9.]+\)/g, '')
    .split(/<br\s*\/?>|\n|,/i)
    .map((item) => item.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean)
}

function parseNutritionInfo(calInfo?: string, ntrInfo?: string): Nutrients {
  const total = emptyNutrients()
  const kcalMatch = calInfo?.match(/([\d.]+)/)

  if (kcalMatch) {
    total.kcal = Number(kcalMatch[1])
  }

  parseHtmlList(ntrInfo).forEach((line) => {
    const valueMatch = line.match(/:\s*([\d.]+)/)
    const value = valueMatch ? Number(valueMatch[1]) : 0

    if (line.includes('탄수화물')) total.carbs = value
    if (line.includes('단백질')) total.protein = value
    if (line.includes('지방')) total.fat = value
    if (line.includes('나트륨')) total.sodium = value
    if (line.includes('칼슘')) total.calcium = value
    if (line.includes('철')) total.iron = value
  })

  return total
}

function mealRowToItems(row: MealApiRow): MealItem[] {
  const dishes = parseHtmlList(row.DDISH_NM)
  const totalNutrients = parseNutritionInfo(row.CAL_INFO, row.NTR_INFO)
  const mealName = row.MMEAL_SC_NM ?? '급식 전체'

  return [
    {
      name: mealName,
      amount: row.CAL_INFO ?? 'NEIS 조회',
      note: row.MLSV_YMD ?? '실시간 API',
      nutrients: totalNutrients,
    },
    ...dishes.slice(0, 7).map((dish) => ({
      name: dish,
      amount: '식단 항목',
      note: 'NEIS',
      nutrients: emptyNutrients(),
    })),
  ]
}

function buildServingAdvice(total: Nutrients, target: NutritionTarget) {
  return [
    {
      label: '밥',
      amount: total.carbs > target.carbs * 1.08 ? '2-3숟가락 덜기' : '1공기 기준 유지',
      reason: total.carbs > target.carbs * 1.08 ? '탄수화물이 점심 목표보다 높습니다.' : '에너지 균형이 안정적입니다.',
    },
    {
      label: '국물',
      amount: total.sodium > target.sodium ? '3-5숟가락만' : '반 그릇 이하',
      reason: total.sodium > target.sodium ? '나트륨이 높아 국물 섭취를 줄입니다.' : '나트륨은 목표 안쪽입니다.',
    },
    {
      label: '단백질 반찬',
      amount: total.protein < target.protein ? '한 젓가락 더' : '현재 양 유지',
      reason: total.protein < target.protein ? '성장기 단백질 보충이 필요합니다.' : '단백질이 충분합니다.',
    },
    {
      label: '채소/우유',
      amount: total.calcium < target.calcium ? '우유 1개 또는 채소 남기지 않기' : '채소 반찬 유지',
      reason: total.calcium < target.calcium ? '칼슘 목표에 조금 부족합니다.' : '칼슘 보충이 잘 되어 있습니다.',
    },
  ]
}

function App() {
  const [gender, setGender] = useState<Gender>('female')
  const [activity, setActivity] = useState<Activity>('normal')
  const [schoolName, setSchoolName] = useState('한세사이버보안고등학교')
  const [schoolOptions, setSchoolOptions] = useState<SchoolRow[]>([])
  const [selectedSchool, setSelectedSchool] = useState<SchoolRow | undefined>()
  const [mealDate, setMealDate] = useState(todayInputValue())
  const [mealPlan, setMealPlan] = useState<MealItem[]>(sampleMealItems)
  const [mealStatus, setMealStatus] = useState('샘플 급식 데이터 사용 중')
  const [barcodeInput, setBarcodeInput] = useState(barcodeSamples[0].barcode)
  const [scannedBarcode, setScannedBarcode] = useState(barcodeSamples[0].barcode)
  const [selectedProduct, setSelectedProduct] = useState<Product | undefined>()
  const [scannerStatus, setScannerStatus] = useState('카메라 대기')
  const [isScanning, setIsScanning] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanFrameRef = useRef<number | null>(null)
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null)
  const zxingControlsRef = useRef<IScannerControls | null>(null)
  const scanActiveRef = useRef(false)
  const lastDetectedRef = useRef('')

  const total = useMemo(() => addNutrients(mealPlan), [mealPlan])
  const target = useMemo(() => makeTarget(gender, activity), [gender, activity])
  const servingAdvice = useMemo(() => buildServingAdvice(total, target), [total, target])

  const nutritionRows = [
    { key: 'kcal', label: '열량', value: total.kcal, target: target.kcal, unit: 'kcal' },
    { key: 'carbs', label: '탄수화물', value: total.carbs, target: target.carbs, unit: 'g' },
    { key: 'protein', label: '단백질', value: total.protein, target: target.protein, unit: 'g' },
    { key: 'fat', label: '지방', value: total.fat, target: target.fat, unit: 'g' },
    { key: 'sodium', label: '나트륨', value: total.sodium, target: target.sodium, unit: 'mg' },
    { key: 'calcium', label: '칼슘', value: total.calcium, target: target.calcium, unit: 'mg' },
  ]

  const searchSchools = useCallback(async () => {
    const keyword = schoolName.trim()

    if (!keyword) {
      setMealStatus('학교명을 입력해 주세요.')
      return
    }

    setMealStatus('학교 검색 중')

    try {
      const response = await fetch(`/api/school/search?school=${encodeURIComponent(keyword)}`)
      const payload = (await response.json()) as { ok?: boolean; rows?: SchoolRow[]; message?: string }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? '학교 검색 실패')
      }

      const rows = payload.rows ?? []
      setSchoolOptions(rows)
      setSelectedSchool(rows[0])
      setMealStatus(rows[0] ? `${rows[0].SCHUL_NM} 선택됨` : '검색 결과가 없습니다. 샘플을 유지합니다.')
    } catch (error) {
      setMealStatus(error instanceof Error ? error.message : '학교 검색 실패')
    }
  }, [schoolName])

  const loadMealFromServer = useCallback(async () => {
    if (!selectedSchool) {
      setMealStatus('먼저 학교를 검색해 주세요.')
      return
    }

    setMealStatus('급식 조회 중')

    const params = new URLSearchParams({
      officeCode: selectedSchool.ATPT_OFCDC_SC_CODE,
      schoolCode: selectedSchool.SD_SCHUL_CODE,
      date: toNeisDate(mealDate),
    })

    try {
      const response = await fetch(`/api/meals?${params.toString()}`)
      const payload = (await response.json()) as { ok?: boolean; rows?: MealApiRow[]; message?: string }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? '급식 조회 실패')
      }

      const row = payload.rows?.[0]

      if (!row) {
        setMealStatus('해당 날짜 급식이 없습니다. 샘플을 유지합니다.')
        return
      }

      setMealPlan(mealRowToItems(row))
      setMealStatus(`${selectedSchool.SCHUL_NM} ${mealDate} 급식 반영`)
    } catch (error) {
      setMealStatus(error instanceof Error ? error.message : '급식 조회 실패')
    }
  }, [mealDate, selectedSchool])

  const stopScanner = useCallback(() => {
    scanActiveRef.current = false

    zxingControlsRef.current?.stop()
    zxingControlsRef.current = null

    if (scanFrameRef.current !== null) {
      window.cancelAnimationFrame(scanFrameRef.current)
      scanFrameRef.current = null
    }

    streamRef.current?.getTracks().forEach((track) => {
      track.stop()
    })
    streamRef.current = null

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setIsScanning(false)
  }, [])

  const lookupBarcode = useCallback(
    async (rawValue: string) => {
      const normalized = normalizeBarcode(rawValue)

      if (normalized.length < 8) {
        setScannerStatus('8자리 이상 입력')
        return
      }

      setBarcodeInput(normalized)
      setScannedBarcode(normalized)
      setScannerStatus('서버 바코드 조회 중')

      try {
        const response = await fetch(`/api/barcode/${encodeURIComponent(normalized)}`)
        const payload = (await response.json()) as BarcodeLookupResponse

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message ?? '바코드 조회 실패')
        }

        if (payload.product) {
          setSelectedProduct(payload.product)
          setScannerStatus(`${payload.product.name} 조회 완료`)
          stopScanner()
          return
        }

        setSelectedProduct(undefined)
        setScannerStatus(payload.message ?? '등록되지 않은 바코드')
      } catch (error) {
        setSelectedProduct(undefined)
        setScannerStatus(error instanceof Error ? error.message : '바코드 조회 실패')
      }

      stopScanner()
    },
    [stopScanner],
  )

  const handleBarcodeValue = useCallback(
    (rawValue: string) => {
      const normalized = normalizeBarcode(rawValue)

      if (normalized.length < 8 || normalized === lastDetectedRef.current) {
        return
      }

      lastDetectedRef.current = normalized
      setBarcodeInput(normalized)
      setScannerStatus('바코드 인식 완료')
      void lookupBarcode(normalized)
    },
    [lookupBarcode],
  )

  const scanLoop = useCallback(async () => {
    if (!scanActiveRef.current) {
      return
    }

    const video = videoRef.current
    const canvas = canvasRef.current
    const detector = detectorRef.current

    if (video && canvas && detector && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const width = video.videoWidth
      const height = video.videoHeight

      if (width > 0 && height > 0) {
        const context = canvas.getContext('2d', { willReadFrequently: true })

        if (context) {
          canvas.width = width
          canvas.height = height
          context.drawImage(video, 0, 0, width, height)

          try {
            const detected = await detector.detect(canvas)
            const firstValue = detected.find((barcode) => barcode.rawValue)?.rawValue

            if (firstValue) {
              handleBarcodeValue(firstValue)
              return
            }
          } catch {
            setScannerStatus('스캔 프레임 확인 중')
          }
        }
      }
    }

    scanFrameRef.current = window.requestAnimationFrame(scanLoop)
  }, [handleBarcodeValue])

  const startScanner = useCallback(async () => {
    const barcodeWindow = window as BarcodeWindow
    const Detector = barcodeWindow.BarcodeDetector

    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerStatus('카메라 권한을 사용할 수 없습니다.')
      return
    }

    stopScanner()
    lastDetectedRef.current = ''
    setScannerStatus('카메라 권한 확인 중')

    try {
      if (!Detector) {
        const video = videoRef.current

        if (!video) {
          throw new Error('카메라 화면을 준비하지 못했습니다.')
        }

        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 120,
          delayBetweenScanSuccess: 500,
        })
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
          video,
          (result) => {
            const value = result?.getText()
            if (value) handleBarcodeValue(value)
          },
        )

        zxingControlsRef.current = controls
        streamRef.current = video.srcObject instanceof MediaStream ? video.srcObject : null
        scanActiveRef.current = true
        setIsScanning(true)
        setScannerStatus('스캔 중')
        return
      }

      let formats = barcodeFormats

      if (Detector.getSupportedFormats) {
        const supportedFormats = await Detector.getSupportedFormats()
        const filtered = barcodeFormats.filter((format) => supportedFormats.includes(format))
        formats = filtered.length > 0 ? filtered : barcodeFormats
      }

      detectorRef.current = new Detector({ formats })
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      scanActiveRef.current = true
      setIsScanning(true)
      setScannerStatus('스캔 중')
      scanFrameRef.current = window.requestAnimationFrame(scanLoop)
    } catch (error) {
      stopScanner()
      setScannerStatus(error instanceof DOMException && error.name === 'NotAllowedError' ? '카메라 권한이 거부되었습니다.' : '카메라를 시작하지 못했습니다.')
    }
  }, [handleBarcodeValue, scanLoop, stopScanner])

  const submitBarcode = useCallback(
    (value: string) => {
      const normalized = normalizeBarcode(value)

      lastDetectedRef.current = ''
      void lookupBarcode(normalized)
    },
    [lookupBarcode],
  )

  useEffect(() => {
    return () => {
      stopScanner()
    }
  }, [stopScanner])

  return (
    <main className="app-shell">
      <section className="top-grid">
        <div className="product-heading">
          <p className="eyebrow">NutriCycle MVP</p>
          <h1>급식 영양 균형과 바코드 분리배출 도우미</h1>
          <p>
            청소년이 오늘 급식과 간식을 함께 보고, 몇 숟가락 덜거나 더 먹을지 바로 판단하는 시연용
            앱입니다.
          </p>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <img src={heroImage} alt="" />
          <div>
            <strong>{scannedBarcode}</strong>
            <span>{selectedProduct?.name ?? '제품 정보 없음'}</span>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="panel meal-panel">
          <div className="panel-heading">
            <span>오늘의 급식</span>
            <h2>영양 기준 설정</h2>
          </div>

          <div className="control-row" aria-label="학생 기준">
            {(Object.keys(profileTargets) as Gender[]).map((option) => (
              <button
                className={gender === option ? 'segmented active' : 'segmented'}
                key={option}
                type="button"
                onClick={() => setGender(option)}
              >
                {profileTargets[option].label}
              </button>
            ))}
          </div>

          <div className="control-row" aria-label="활동량">
            {(Object.keys(activityOptions) as Activity[]).map((option) => (
              <button
                className={activity === option ? 'segmented active' : 'segmented'}
                key={option}
                type="button"
                onClick={() => setActivity(option)}
              >
                {activityOptions[option].label}
              </button>
            ))}
          </div>

          <div className="target-card">
            <span>점심 목표</span>
            <strong>{target.kcal.toLocaleString('ko-KR')} kcal</strong>
            <small>하루 기준 {target.dayKcal.toLocaleString('ko-KR')} kcal의 {Math.round(lunchRatio * 100)}%</small>
          </div>

          <div className="api-tools">
            <label className="api-input">
              <span>학교명</span>
              <div>
                <input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} />
                <button type="button" onClick={searchSchools}>
                  검색
                </button>
              </div>
            </label>

            {schoolOptions.length > 0 && (
              <label className="api-input">
                <span>학교 선택</span>
                <select
                  value={selectedSchool ? `${selectedSchool.ATPT_OFCDC_SC_CODE}:${selectedSchool.SD_SCHUL_CODE}` : ''}
                  onChange={(event) => {
                    const next = schoolOptions.find(
                      (school) => `${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}` === event.target.value,
                    )
                    setSelectedSchool(next)
                  }}
                >
                  {schoolOptions.map((school) => (
                    <option key={`${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}`} value={`${school.ATPT_OFCDC_SC_CODE}:${school.SD_SCHUL_CODE}`}>
                      {school.SCHUL_NM} {school.LCTN_SC_NM ? `(${school.LCTN_SC_NM})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="api-input">
              <span>급식 날짜</span>
              <div>
                <input type="date" value={mealDate} onChange={(event) => setMealDate(event.target.value)} />
                <button type="button" onClick={loadMealFromServer}>
                  조회
                </button>
              </div>
            </label>
            <p className="api-status">{mealStatus}</p>
          </div>

          <div className="meal-list">
            {mealPlan.map((item) => (
              <div className="meal-row" key={item.name}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.amount}</span>
                </div>
                <em>{item.note}</em>
              </div>
            ))}
          </div>
        </article>

        <article className="panel balance-panel">
          <div className="panel-heading">
            <span>섭취 조절</span>
            <h2>몇 숟가락 먹을까?</h2>
          </div>

          <div className="advice-grid">
            {servingAdvice.map((advice) => (
              <div className="advice-card" key={advice.label}>
                <span>{advice.label}</span>
                <strong>{advice.amount}</strong>
                <p>{advice.reason}</p>
              </div>
            ))}
          </div>

          <div className="nutrient-list">
            {nutritionRows.map((row) => (
              <div className="nutrient-row" key={row.key}>
                <div>
                  <strong>{row.label}</strong>
                  <span>
                    {formatNumber(row.value, row.unit)} / {formatNumber(row.target, row.unit)}
                  </span>
                </div>
                <div className="meter" aria-label={`${row.label} ${percent(row.value, row.target)}%`}>
                  <span style={{ width: `${percent(row.value, row.target)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel scanner-panel">
          <div className="panel-heading">
            <span>바코드</span>
            <h2>카메라 스캔</h2>
          </div>

          <div className={isScanning ? 'scanner-preview active' : 'scanner-preview'}>
            <video ref={videoRef} aria-label="바코드 스캔 카메라" muted playsInline />
            <canvas ref={canvasRef} aria-hidden="true" />
            <div className="scanner-overlay">
              <span>{scannerStatus}</span>
            </div>
          </div>

          <div className="scanner-actions">
            <button className="primary-button" type="button" onClick={startScanner} disabled={isScanning}>
              스캔 시작
            </button>
            <button className="secondary-button" type="button" onClick={stopScanner} disabled={!isScanning}>
              정지
            </button>
          </div>

          <label className="manual-input">
            <span>바코드 번호</span>
            <div>
              <input
                inputMode="numeric"
                value={barcodeInput}
                onChange={(event) => setBarcodeInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    submitBarcode(barcodeInput)
                  }
                }}
              />
              <button type="button" onClick={() => submitBarcode(barcodeInput)}>
                조회
              </button>
            </div>
          </label>

          <div className="sample-buttons" aria-label="시연 바코드">
            {barcodeSamples.map((sample) => (
              <button key={sample.barcode} type="button" onClick={() => submitBarcode(sample.barcode)}>
                {sample.label}
              </button>
            ))}
          </div>
        </article>
      </section>

      <section className="result-grid">
        <article className="panel product-panel">
          <div className="panel-heading">
            <span>간식 판단</span>
            <h2>{selectedProduct?.name ?? '제품 DB에 없는 바코드'}</h2>
          </div>

          {selectedProduct ? (
            <>
              <div className="product-meta">
                <span>{selectedProduct.maker}</span>
                <span>{selectedProduct.category}</span>
                <span>{selectedProduct.serving}</span>
                {selectedProduct.source && <span>{selectedProduct.source}</span>}
                {selectedProduct.reportNo && <span>품목보고번호 {selectedProduct.reportNo}</span>}
              </div>
              <div className="product-nutrients">
                <div>
                  <strong>{selectedProduct.nutrients.kcal}</strong>
                  <span>kcal</span>
                </div>
                <div>
                  <strong>{selectedProduct.nutrients.carbs}g</strong>
                  <span>탄수화물</span>
                </div>
                <div>
                  <strong>{selectedProduct.nutrients.protein}g</strong>
                  <span>단백질</span>
                </div>
                <div>
                  <strong>{selectedProduct.nutrients.sodium}mg</strong>
                  <span>나트륨</span>
                </div>
              </div>
              <p className="product-advice">{selectedProduct.advice}</p>
              {selectedProduct.ingredients && selectedProduct.ingredients.length > 0 && (
                <div className="detail-list">
                  <strong>원재료</strong>
                  <p>{selectedProduct.ingredients.join(', ')}</p>
                </div>
              )}
              {selectedProduct.safetyFlags && selectedProduct.safetyFlags.length > 0 && (
                <div className="detail-list">
                  <strong>제품 표시 보완 정보</strong>
                  <p>{selectedProduct.safetyFlags.join(' · ')}</p>
                </div>
              )}
            </>
          ) : (
            <p className="empty-state">연결된 바코드 API에서 아직 제품을 찾지 못했습니다. 다른 바코드를 스캔하거나 제품명과 포장 표시를 직접 확인해 주세요.</p>
          )}
        </article>

        <article className="panel recycle-panel">
          <div className="panel-heading">
            <span>분리배출</span>
            <h2>포장 구성</h2>
          </div>

          <div className="package-list">
            {(selectedProduct?.packageParts ?? [
              { part: '제품 포장', material: '표시 확인 필요', stream: '직접 선택', guide: '포장재의 분리배출 표시를 보고 재질을 선택합니다.' },
            ]).map((part) => (
              <div className="package-row" key={`${part.part}-${part.material}`}>
                <div>
                  <strong>{part.part}</strong>
                  <span>{part.material}</span>
                </div>
                <em>{part.stream}</em>
                <p>{part.guide}</p>
                {part.source && <small className="package-source">{part.source}{part.query ? ` · 검색어 ${part.query}` : ''}</small>}
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  )
}

export default App
