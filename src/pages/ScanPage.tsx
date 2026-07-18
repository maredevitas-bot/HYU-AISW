import type { IScannerControls } from '@zxing/browser'
import { Globe2, Scale } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DataSourceBadge from '../components/DataSourceBadge'
import { saveFoodLog, type MealType } from '../foodLog'
import { emptyNutrients, formatNutrient, nutrientMeta, scaleNutrients, todayInputValue, type Product } from '../nutrition'

type ScanPageProps = {
  ownerId: string
  onSaved: () => void
}

type BarcodeLookupResponse = {
  ok?: boolean
  product?: Product
  message?: string
}

type DetectedBarcode = { rawValue?: string }
type BarcodeDetectorInstance = { detect: (image: CanvasImageSource) => Promise<DetectedBarcode[]> }
type BarcodeDetectorStatic = {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance
  getSupportedFormats?: () => Promise<string[]>
}
type BarcodeWindow = Window & { BarcodeDetector?: BarcodeDetectorStatic }

const barcodeFormats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code']
const barcodeSamples = [
  { label: 'bibigo 왕교자', barcode: '08801007325224' },
  { label: '국산콩두부', barcode: '8801024949960' },
  { label: 'Nutella', barcode: '3017620422003' },
]

function normalizeBarcode(value: string) {
  return value.replace(/\D/g, '')
}

export default function ScanPage({ ownerId, onSaved }: ScanPageProps) {
  const [barcodeInput, setBarcodeInput] = useState(barcodeSamples[0].barcode)
  const [selectedProduct, setSelectedProduct] = useState<Product>()
  const [scannerStatus, setScannerStatus] = useState('카메라 대기')
  const [isScanning, setIsScanning] = useState(false)
  const [mealType, setMealType] = useState<MealType>('snack')
  const [consumedAmount, setConsumedAmount] = useState(1)
  const [showLogPrompt, setShowLogPrompt] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanFrameRef = useRef<number | null>(null)
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null)
  const zxingControlsRef = useRef<IScannerControls | null>(null)
  const scanActiveRef = useRef(false)
  const lastDetectedRef = useRef('')

  const nutritionBasis = selectedProduct?.nutritionBasis
  const availableNutrients = useMemo(
    () => selectedProduct ? (selectedProduct.availableNutrients ?? nutrientMeta.filter(({ key }) => selectedProduct.nutrients[key] > 0).map(({ key }) => key)) : [],
    [selectedProduct],
  )
  const canCalculateNutrition = Boolean(
    selectedProduct && nutritionBasis && nutritionBasis.confidence === 'declared' && nutritionBasis.amount > 0 && availableNutrients.length,
  )
  const nutritionMultiplier = canCalculateNutrition && nutritionBasis ? consumedAmount / nutritionBasis.amount : 0
  const loggedNutrients = useMemo(
    () => selectedProduct && canCalculateNutrition ? scaleNutrients(selectedProduct.nutrients, nutritionMultiplier) : emptyNutrients(),
    [canCalculateNutrition, nutritionMultiplier, selectedProduct],
  )
  const isCommunityProduct = selectedProduct?.dataScope === 'global-community'
    || selectedProduct?.source?.includes('Open Food Facts')
    || selectedProduct?.source?.includes('UPCitemdb')

  const stopScanner = useCallback(() => {
    scanActiveRef.current = false
    zxingControlsRef.current?.stop()
    zxingControlsRef.current = null
    if (scanFrameRef.current !== null) window.cancelAnimationFrame(scanFrameRef.current)
    scanFrameRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setIsScanning(false)
  }, [])

  const lookupBarcode = useCallback(async (rawValue: string) => {
    const normalized = normalizeBarcode(rawValue)
    if (normalized.length < 8) return setScannerStatus('8자리 이상의 바코드를 입력해 주세요.')
    setBarcodeInput(normalized)
    setScannerStatus('공공데이터에서 제품 조회 중')

    try {
      const response = await fetch(`/api/barcode/${encodeURIComponent(normalized)}`)
      const payload = await response.json() as BarcodeLookupResponse
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? '바코드 조회 실패')
      if (!payload.product) {
        setSelectedProduct(undefined)
        setShowLogPrompt(false)
        return setScannerStatus(payload.message ?? '등록되지 않은 바코드입니다.')
      }
      setSelectedProduct(payload.product)
      const basis = payload.product.nutritionBasis
      const packageAmount = basis?.packageAmount && basis.packageUnit === basis.unit ? basis.packageAmount : 0
      setConsumedAmount(packageAmount || basis?.amount || 1)
      setMealType('snack')
      setShowLogPrompt(true)
      setScannerStatus(`${payload.product.name} 조회 완료`)
    } catch (error) {
      setSelectedProduct(undefined)
      setShowLogPrompt(false)
      setScannerStatus(error instanceof Error ? error.message : '바코드 조회 실패')
    } finally {
      stopScanner()
    }
  }, [stopScanner])

  const handleBarcodeValue = useCallback((rawValue: string) => {
    const normalized = normalizeBarcode(rawValue)
    if (normalized.length < 8 || normalized === lastDetectedRef.current) return
    lastDetectedRef.current = normalized
    void lookupBarcode(normalized)
  }, [lookupBarcode])

  const scanLoop = useCallback(async () => {
    if (!scanActiveRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    const detector = detectorRef.current

    if (video && canvas && detector && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context && video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        try {
          const firstValue = (await detector.detect(canvas)).find((item) => item.rawValue)?.rawValue
          if (firstValue) return handleBarcodeValue(firstValue)
        } catch {
          setScannerStatus('스캔 프레임 확인 중')
        }
      }
    }
    scanFrameRef.current = window.requestAnimationFrame(scanLoop)
  }, [handleBarcodeValue])

  const startScanner = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setScannerStatus('이 브라우저에서는 카메라를 사용할 수 없습니다.')
    stopScanner()
    lastDetectedRef.current = ''
    setScannerStatus('카메라 권한 확인 중')

    try {
      const Detector = (window as BarcodeWindow).BarcodeDetector
      const video = videoRef.current
      if (!video) throw new Error('카메라 화면을 준비하지 못했습니다.')
      scanActiveRef.current = true

      if (!Detector) {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 500 })
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          video,
          (result) => { if (result?.getText()) handleBarcodeValue(result.getText()) },
        )
        zxingControlsRef.current = controls
        streamRef.current = video.srcObject instanceof MediaStream ? video.srcObject : null
      } else {
        let formats = barcodeFormats
        if (Detector.getSupportedFormats) {
          const supported = await Detector.getSupportedFormats()
          const filtered = barcodeFormats.filter((format) => supported.includes(format))
          formats = filtered.length ? filtered : barcodeFormats
        }
        detectorRef.current = new Detector({ formats })
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        streamRef.current = stream
        video.srcObject = stream
        await video.play()
        scanFrameRef.current = window.requestAnimationFrame(scanLoop)
      }

      setIsScanning(true)
      setScannerStatus('바코드를 화면 중앙에 맞춰 주세요.')
    } catch (error) {
      stopScanner()
      setScannerStatus(error instanceof DOMException && error.name === 'NotAllowedError' ? '카메라 권한이 거부되었습니다.' : '카메라를 시작하지 못했습니다.')
    }
  }, [handleBarcodeValue, scanLoop, stopScanner])

  const saveProduct = useCallback(async () => {
    if (!selectedProduct) return
    setScannerStatus('푸드 캘린더에 저장 중')
    try {
      await saveFoodLog({
        ownerId,
        date: todayInputValue(),
        entryKey: `barcode:${selectedProduct.barcode}:${Date.now()}`,
        source: 'barcode',
        mealType,
        name: selectedProduct.name,
        quantity: canCalculateNutrition ? nutritionMultiplier : 1,
        nutrients: loggedNutrients,
        metadata: {
          barcode: selectedProduct.barcode,
          maker: selectedProduct.maker,
          serving: selectedProduct.serving,
          source: selectedProduct.source,
          nutritionBasis,
          nutritionUnavailable: !canCalculateNutrition,
          availableNutrients: canCalculateNutrition ? availableNutrients : [],
          consumptionLabel: canCalculateNutrition && nutritionBasis
            ? `${consumedAmount}${nutritionBasis.unit === 'serving' ? '회분' : nutritionBasis.unit}`
            : '영양 정보 없이 음식 이름만 기록',
        },
      })
      onSaved()
      setShowLogPrompt(false)
      setScannerStatus(`${selectedProduct.name} 섭취 기록을 저장했습니다.`)
    } catch (error) {
      setScannerStatus(error instanceof Error ? error.message : '식품 기록 저장 실패')
    }
  }, [availableNutrients, canCalculateNutrition, consumedAmount, loggedNutrients, mealType, nutritionBasis, nutritionMultiplier, onSaved, ownerId, selectedProduct])

  useEffect(() => () => stopScanner(), [stopScanner])

  return (
    <section className="page-stack" aria-labelledby="scan-title">
      <header className="page-heading"><div><span>국내 바코드 우선 조회</span><h1 id="scan-title">식품 영양과 분리배출</h1><p>국내 공공데이터를 먼저 조회하고, 결과가 없을 때만 글로벌 데이터를 참고용으로 표시합니다.</p><div className="page-source-row"><DataSourceBadge label="식약처·HACCP 바코드 데이터" /><DataSourceBadge label="분리배출 정보조회 API" /></div></div></header>

      <div className={selectedProduct ? 'scan-layout has-result' : 'scan-layout lookup-only'}>
        <article className="panel scanner-panel">
          <div className="panel-heading"><span>실제 바코드</span><h2>카메라 스캔</h2></div>
          <div className={isScanning ? 'scanner-preview active' : 'scanner-preview'}>
            <video ref={videoRef} aria-label="바코드 스캔 카메라" muted playsInline />
            <canvas ref={canvasRef} aria-hidden="true" />
            <div className="scanner-overlay"><span>{scannerStatus}</span></div>
          </div>
          <div className="scanner-actions"><button className="primary-button" type="button" onClick={startScanner} disabled={isScanning}>스캔 시작</button><button type="button" onClick={stopScanner} disabled={!isScanning}>정지</button></div>
          <label className="manual-input"><span>바코드 번호</span><div><input aria-label="바코드 번호 조회" inputMode="numeric" value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void lookupBarcode(barcodeInput) }} /><button type="button" onClick={() => void lookupBarcode(barcodeInput)}>조회</button></div></label>
          <div className="sample-buttons" aria-label="시연 바코드">{barcodeSamples.map((sample) => <button key={sample.barcode} type="button" onClick={() => void lookupBarcode(sample.barcode)}>{sample.label}</button>)}</div>
        </article>

        {selectedProduct && <div className="page-stack compact scan-results">
          <article className="panel product-panel">
            <div className="panel-heading"><span>제품 영양</span><h2>{selectedProduct.name}</h2></div>
            <>
              <div className="result-source-row"><DataSourceBadge label={selectedProduct.source ?? '바코드 공공데이터'} tone={selectedProduct.source?.includes('Open Food Facts') || selectedProduct.source?.includes('UPCitemdb') ? 'community' : 'public'} /></div>
              {isCommunityProduct && <div className="community-data-notice" role="note"><Globe2 size={20} aria-hidden="true" /><div><strong>국내 공공데이터 미확인</strong><p>국내 식약처·HACCP 조회에서 찾지 못한 제품입니다. 아래 내용은 글로벌 커뮤니티 참고 정보이며 포장지의 한글 표시사항을 우선 확인해 주세요.</p></div></div>}
              <div className="product-meta"><span>{selectedProduct.maker}</span><span>{selectedProduct.category}</span><span>{selectedProduct.serving}</span></div>
              <div className={canCalculateNutrition ? 'nutrition-basis-note' : 'nutrition-basis-note warning'}><Scale size={18} aria-hidden="true" /><span>{nutritionBasis?.label ?? '영양 기준량 미확인'}{nutritionBasis?.packageAmount ? ` · 총 내용량 ${nutritionBasis.packageAmount}${nutritionBasis.packageUnit}` : ''}</span></div>
              <div className="product-nutrients">{nutrientMeta.slice(0, 6).map(({ key, label, unit }) => <div key={key}><strong>{availableNutrients.includes(key) ? formatNutrient(selectedProduct.nutrients[key], unit) : '정보 없음'}</strong><span>{label}</span></div>)}</div>
              <p className="product-advice">{selectedProduct.advice}</p>
              {selectedProduct.ingredients && selectedProduct.ingredients.length > 0 && <div className="detail-list"><strong>원재료</strong><p>{selectedProduct.ingredients.join(', ')}</p></div>}
              <button className="primary-button add-today-button" type="button" onClick={() => setShowLogPrompt(true)}>오늘 푸드 캘린더에 추가</button>
            </>
          </article>

          <article className="panel recycle-panel">
            <div className="panel-heading"><span>분리배출</span><h2>포장 구성</h2></div>
            <div className="result-source-row"><DataSourceBadge label={selectedProduct.packageParts.find((part) => part.source)?.source ?? '제품 표시 기반 분리배출 안내'} /></div>
            <div className="package-list">{(selectedProduct.packageParts.length ? selectedProduct.packageParts : [{ part: '제품 포장', material: '표시 확인 필요', stream: '직접 확인', guide: '포장재의 분리배출 표시를 확인해 주세요.' }]).map((part, index) => <div className="package-row" key={`${part.part}-${part.material}-${index}`}><div><strong>{part.part}</strong><span>{part.material}</span></div><em>{part.stream}</em><p>{part.guide}</p>{part.source && <small className="package-source">{part.source}{part.query ? ` · 검색어 ${part.query}` : ''}</small>}</div>)}</div>
          </article>
        </div>}
      </div>

      {showLogPrompt && selectedProduct && (
        <div className="modal-backdrop">
          <section className="log-dialog" role="dialog" aria-modal="true" aria-labelledby="food-log-dialog-title">
            <div className="dialog-heading">
              <div><span>오늘의 식단 노트</span><h2 id="food-log-dialog-title">{selectedProduct.name} 제품을 기록할까요?</h2></div>
              <button type="button" aria-label="기록 창 닫기" onClick={() => setShowLogPrompt(false)}>×</button>
            </div>
            <p className="dialog-description">{todayInputValue()} 푸드 캘린더에 실제로 먹은 양만큼 영양소를 추가합니다.</p>
            {isCommunityProduct && <div className="dialog-source-warning"><Globe2 size={17} aria-hidden="true" /><span>글로벌 커뮤니티 기반 영양 정보입니다. 포장지 표시와 일치하는지 확인한 뒤 기록해 주세요.</span></div>}
            {!canCalculateNutrition && <div className="dialog-source-warning"><Scale size={17} aria-hidden="true" /><span>영양 기준량을 확인할 수 없어 음식 이름만 기록하며 영양 합계에는 포함하지 않습니다.</span></div>}
            <div className="dialog-product"><div><strong>{selectedProduct.name}</strong><span>{nutritionBasis?.label ?? '영양 기준량 미확인'}</span></div><strong>{canCalculateNutrition ? formatNutrient(loggedNutrients.kcal, 'kcal') : '합산 제외'}</strong></div>
            <div className="dialog-controls">
              <label><span>언제 먹었나요?</span><select value={mealType} onChange={(event) => setMealType(event.target.value as MealType)}><option value="breakfast">아침</option><option value="lunch">점심</option><option value="dinner">저녁</option><option value="snack">간식</option></select></label>
              {canCalculateNutrition && nutritionBasis && <label><span>실제로 먹은 양 ({nutritionBasis.unit === 'serving' ? '회분' : nutritionBasis.unit})</span><input type="number" min="0.1" max="5000" step={nutritionBasis.unit === 'serving' ? '0.25' : '1'} value={consumedAmount} onChange={(event) => setConsumedAmount(Math.max(0.1, Number(event.target.value) || 0.1))} /></label>}
            </div>
            {canCalculateNutrition && nutritionBasis?.packageAmount && nutritionBasis.packageUnit === nutritionBasis.unit && <div className="amount-presets" aria-label="총 내용량 기준 빠른 선택">{[{ label: '1/4', ratio: 0.25 }, { label: '절반', ratio: 0.5 }, { label: '전부', ratio: 1 }].map((option) => <button type="button" key={option.ratio} className={consumedAmount === nutritionBasis.packageAmount! * option.ratio ? 'active' : ''} onClick={() => setConsumedAmount(nutritionBasis.packageAmount! * option.ratio)}>{option.label}</button>)}</div>}
            {canCalculateNutrition && <div className="dialog-nutrients">{nutrientMeta.slice(0, 5).map(({ key, label, unit }) => <div key={key}><span>{label}</span><strong>{availableNutrients.includes(key) ? formatNutrient(loggedNutrients[key], unit) : '정보 없음'}</strong></div>)}</div>}
            <div className="dialog-actions"><button type="button" onClick={() => setShowLogPrompt(false)}>추가하지 않기</button><button className="primary-button" type="button" onClick={saveProduct}>{canCalculateNutrition ? '오늘 기록' : '이름만 기록'}</button></div>
          </section>
        </div>
      )}
    </section>
  )
}
