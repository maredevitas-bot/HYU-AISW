export function calculateMealIntakeRatio(dishes, portions) {
  if (!dishes.length) return 0
  const ratio = dishes.reduce((sum, dish) => sum + (Number(portions[dish.id]) || 0), 0) / dishes.length
  return Number(Math.max(0, Math.min(1, ratio)).toFixed(2))
}
