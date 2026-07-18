const supportedLengths = new Set([8, 12, 13, 14])

export function normalizeBarcode(value) {
  return String(value ?? '').replace(/\D/g, '')
}

export function calculateGtinCheckDigit(body) {
  const digits = normalizeBarcode(body)
  if (!digits) return null

  const sum = [...digits].reverse().reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1),
    0,
  )
  return (10 - (sum % 10)) % 10
}

function expandUpcE(value) {
  if (!/^\d{8}$/.test(value) || !['0', '1'].includes(value[0])) return ''
  const [numberSystem, a, b, c, d, e, f, checkDigit] = value

  if (['0', '1', '2'].includes(f)) return `${numberSystem}${a}${b}${f}0000${c}${d}${e}${checkDigit}`
  if (f === '3') return `${numberSystem}${a}${b}${c}00000${d}${e}${checkDigit}`
  if (f === '4') return `${numberSystem}${a}${b}${c}${d}00000${e}${checkDigit}`
  return `${numberSystem}${a}${b}${c}${d}${e}0000${f}${checkDigit}`
}

export function isValidGtin(value) {
  const barcode = normalizeBarcode(value)
  if (!supportedLengths.has(barcode.length)) return false

  const expected = calculateGtinCheckDigit(barcode.slice(0, -1))
  return expected === Number(barcode.at(-1))
}

export function validateRetailBarcode(value) {
  const barcode = normalizeBarcode(value)
  if (!supportedLengths.has(barcode.length)) {
    return { valid: false, barcode, message: 'EAN·UPC·GTIN 바코드는 8, 12, 13, 14자리여야 합니다.' }
  }

  if (isValidGtin(barcode)) return { valid: true, barcode, format: `GTIN-${barcode.length}`, message: '' }

  const expandedUpcE = expandUpcE(barcode)
  if (expandedUpcE && isValidGtin(expandedUpcE)) {
    return { valid: true, barcode, format: 'UPC-E', message: '' }
  }

  return { valid: false, barcode, message: '바코드 검증 숫자가 맞지 않습니다. 포장지 번호를 다시 확인해 주세요.' }
}
