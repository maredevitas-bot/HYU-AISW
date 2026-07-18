export function isCommunityProduct(product) {
  const source = String(product?.source ?? '').trim()
  return product?.dataScope === 'global-community' || source.includes('Open Food Facts') || source.includes('UPCitemdb')
}

export function productCacheHours(product) {
  return isCommunityProduct(product) ? 6 : 24 * 7
}

export function shouldRetryFoodSafety(errorMessage) {
  return /HTTP (?:429|5\d\d)\b/i.test(String(errorMessage ?? ''))
}
