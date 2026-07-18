const nutrientKeys = ['kcal', 'carbs', 'protein', 'fat', 'sodium', 'calcium', 'iron']

function numberFrom(value) {
  const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function normalizeUnit(value) {
  const unit = String(value ?? '').trim().toLowerCase()
  if (unit === 'g' || unit === '그램') return 'g'
  if (unit === 'ml' || unit === 'mℓ' || unit === '㎖') return 'ml'
  return ''
}

export function parseMeasuredAmount(value) {
  const match = String(value ?? '').match(/([\d,.]+)\s*(g|그램|ml|mℓ|㎖)/i)
  const unit = normalizeUnit(match?.[2])
  const amount = numberFrom(match?.[1])
  return amount > 0 && unit ? { amount, unit } : null
}

export function nutritionBasisFromText(nutrientText, packageText = '') {
  const text = String(nutrientText ?? '')
  const perAmount = text.match(/([\d,.]+)\s*(g|그램|ml|mℓ|㎖)\s*당/i)
  const servingAmount = text.match(/1회\s*(?:제공량|분)\s*[:：]?\s*([\d,.]+)\s*(g|그램|ml|mℓ|㎖)/i)
  const basis = parseMeasuredAmount(perAmount ? `${perAmount[1]}${perAmount[2]}` : servingAmount ? `${servingAmount[1]}${servingAmount[2]}` : '')
  const packageAmount = parseMeasuredAmount(packageText) ?? parseMeasuredAmount(text.match(/총\s*내용량\s*[:：]?\s*[^\n,/]*/i)?.[0])

  if (!basis) {
    return {
      amount: 0,
      unit: 'serving',
      label: '영양 기준량 미확인',
      confidence: 'unknown',
      ...(packageAmount ? { packageAmount: packageAmount.amount, packageUnit: packageAmount.unit } : {}),
    }
  }

  return {
    amount: basis.amount,
    unit: basis.unit,
    label: `${basis.amount}${basis.unit} 기준`,
    confidence: 'declared',
    ...(packageAmount ? { packageAmount: packageAmount.amount, packageUnit: packageAmount.unit } : {}),
  }
}

export function nutritionBasisFromValues(amountValue, unitValue, packageText = '') {
  const amount = numberFrom(amountValue)
  const unit = normalizeUnit(unitValue)
  const packageAmount = parseMeasuredAmount(packageText)
  if (!amount || !unit) return nutritionBasisFromText('', packageText)
  return {
    amount,
    unit,
    label: `${amount}${unit} 기준`,
    confidence: 'declared',
    ...(packageAmount ? { packageAmount: packageAmount.amount, packageUnit: packageAmount.unit } : {}),
  }
}

function offValue(nutriments, key, suffix) {
  return numberFrom(nutriments?.[`${key}_${suffix}`])
}

function hasOffValue(nutriments, key, suffix) {
  const field = `${key}_${suffix}`
  return Object.hasOwn(nutriments ?? {}, field) && nutriments[field] !== null && nutriments[field] !== ''
}

export function openFoodFactsNutrition(product = {}) {
  const nutriments = product.nutriments ?? {}
  const servingAmount = parseMeasuredAmount(product.serving_size)
  const packageAmount = parseMeasuredAmount(product.quantity)
  const hasServingNutrition = numberFrom(nutriments['energy-kcal_serving']) > 0
  const basis = hasServingNutrition && servingAmount
    ? {
        amount: servingAmount.amount,
        unit: servingAmount.unit,
        label: `${servingAmount.amount}${servingAmount.unit} 1회 제공량 기준`,
        confidence: 'declared',
        ...(packageAmount ? { packageAmount: packageAmount.amount, packageUnit: packageAmount.unit } : {}),
      }
    : {
        amount: 100,
        unit: 'g',
        label: '100g 기준',
        confidence: 'declared',
        ...(packageAmount ? { packageAmount: packageAmount.amount, packageUnit: packageAmount.unit } : {}),
      }

  const suffix = hasServingNutrition && servingAmount ? 'serving' : '100g'
  const ratio = suffix === 'serving' ? servingAmount.amount / 100 : 1
  const value = (key) => offValue(nutriments, key, suffix) || Number((offValue(nutriments, key, '100g') * ratio).toFixed(3))
  const nutrients = {
    kcal: value('energy-kcal'),
    carbs: value('carbohydrates'),
    protein: value('proteins'),
    fat: value('fat'),
    sodium: Math.round(value('sodium') * 1000),
    calcium: Math.round(value('calcium') * 1000),
    iron: Math.round(value('iron') * 10) / 10,
  }
  const availableNutrients = [
    ['kcal', 'energy-kcal'],
    ['carbs', 'carbohydrates'],
    ['protein', 'proteins'],
    ['fat', 'fat'],
    ['sodium', 'sodium'],
    ['calcium', 'calcium'],
    ['iron', 'iron'],
  ].filter(([, sourceKey]) => hasOffValue(nutriments, sourceKey, suffix) || hasOffValue(nutriments, sourceKey, '100g')).map(([key]) => key)

  return { nutrients: Object.fromEntries(nutrientKeys.map((key) => [key, nutrients[key] ?? 0])), basis, availableNutrients }
}
