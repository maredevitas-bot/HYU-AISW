export type BarcodeValidation = {
  valid: boolean
  barcode: string
  format?: string
  message: string
}

export function normalizeBarcode(value: unknown): string
export function calculateGtinCheckDigit(body: unknown): number | null
export function isValidGtin(value: unknown): boolean
export function validateRetailBarcode(value: unknown): BarcodeValidation
