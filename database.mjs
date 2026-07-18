import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const projectDir = fileURLToPath(new URL('.', import.meta.url))
export const databasePath = resolve(process.env.DATABASE_PATH ?? join(projectDir, 'data', 'nutricycle.sqlite'))

mkdirSync(dirname(databasePath), { recursive: true })

const database = new DatabaseSync(databasePath)
database.exec('PRAGMA journal_mode = WAL')
database.exec('PRAGMA foreign_keys = ON')
database.exec('PRAGMA busy_timeout = 5000')
database.exec(`
  CREATE TABLE IF NOT EXISTS haccp_products (
    report_no TEXT PRIMARY KEY,
    barcode TEXT,
    product_name TEXT NOT NULL,
    category TEXT,
    manufacturer TEXT,
    seller TEXT,
    capacity TEXT,
    raw_materials TEXT,
    allergy TEXT,
    nutrient_text TEXT,
    image_url_1 TEXT,
    image_url_2 TEXT,
    raw_json TEXT NOT NULL,
    synced_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_haccp_products_barcode
    ON haccp_products(barcode)
    WHERE barcode IS NOT NULL AND barcode <> '';

  CREATE TABLE IF NOT EXISTS product_cache (
    barcode TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    report_no TEXT,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lookup_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT NOT NULL,
    found INTEGER NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_lookup_events_created_at
    ON lookup_events(created_at);

  CREATE TABLE IF NOT EXISTS food_log_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    entry_key TEXT NOT NULL,
    source TEXT NOT NULL,
    meal_type TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    nutrients_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_id, entry_date, entry_key)
  );

  CREATE INDEX IF NOT EXISTS idx_food_log_owner_date
    ON food_log_entries(owner_id, entry_date);

  CREATE TABLE IF NOT EXISTS sync_state (
    source TEXT PRIMARY KEY,
    record_count INTEGER NOT NULL DEFAULT 0,
    last_page INTEGER NOT NULL DEFAULT 0,
    total_pages INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
`)

const upsertHaccpStatement = database.prepare(`
  INSERT INTO haccp_products (
    report_no, barcode, product_name, category, manufacturer, seller, capacity,
    raw_materials, allergy, nutrient_text, image_url_1, image_url_2, raw_json, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(report_no) DO UPDATE SET
    barcode = excluded.barcode,
    product_name = excluded.product_name,
    category = excluded.category,
    manufacturer = excluded.manufacturer,
    seller = excluded.seller,
    capacity = excluded.capacity,
    raw_materials = excluded.raw_materials,
    allergy = excluded.allergy,
    nutrient_text = excluded.nutrient_text,
    image_url_1 = excluded.image_url_1,
    image_url_2 = excluded.image_url_2,
    raw_json = excluded.raw_json,
    synced_at = excluded.synced_at
`)

const getHaccpByBarcodeStatement = database.prepare(`
  SELECT * FROM haccp_products
  WHERE barcode = ?
  ORDER BY synced_at DESC
  LIMIT 1
`)

const getCacheStatement = database.prepare(`
  SELECT payload_json, source, report_no, updated_at, expires_at
  FROM product_cache
  WHERE barcode = ?
`)

const saveCacheStatement = database.prepare(`
  INSERT INTO product_cache (barcode, source, report_no, payload_json, updated_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(barcode) DO UPDATE SET
    source = excluded.source,
    report_no = excluded.report_no,
    payload_json = excluded.payload_json,
    updated_at = excluded.updated_at,
    expires_at = excluded.expires_at
`)

const logLookupStatement = database.prepare(`
  INSERT INTO lookup_events (barcode, found, source, created_at)
  VALUES (?, ?, ?, ?)
`)

const saveSyncStateStatement = database.prepare(`
  INSERT INTO sync_state (source, record_count, last_page, total_pages, updated_at, completed_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(source) DO UPDATE SET
    record_count = excluded.record_count,
    last_page = excluded.last_page,
    total_pages = excluded.total_pages,
    updated_at = excluded.updated_at,
    completed_at = excluded.completed_at
`)

const upsertFoodLogStatement = database.prepare(`
  INSERT INTO food_log_entries (
    owner_id, entry_date, entry_key, source, meal_type, name, quantity,
    nutrients_json, metadata_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(owner_id, entry_date, entry_key) DO UPDATE SET
    source = excluded.source,
    meal_type = excluded.meal_type,
    name = excluded.name,
    quantity = excluded.quantity,
    nutrients_json = excluded.nutrients_json,
    metadata_json = excluded.metadata_json,
    updated_at = excluded.updated_at
`)

const getFoodLogEntryStatement = database.prepare(`
  SELECT * FROM food_log_entries
  WHERE owner_id = ? AND entry_date = ? AND entry_key = ?
`)

const listFoodLogByMonthStatement = database.prepare(`
  SELECT * FROM food_log_entries
  WHERE owner_id = ? AND entry_date >= ? AND entry_date < ?
  ORDER BY entry_date ASC, created_at ASC, id ASC
`)

const listFoodLogByDateStatement = database.prepare(`
  SELECT * FROM food_log_entries
  WHERE owner_id = ? AND entry_date = ?
  ORDER BY created_at ASC, id ASC
`)

const deleteFoodLogStatement = database.prepare(`
  DELETE FROM food_log_entries
  WHERE id = ? AND owner_id = ?
`)

function text(value) {
  return String(value ?? '').trim()
}

function barcode(value) {
  const normalized = text(value).replace(/\D/g, '')
  return normalized.length >= 8 && normalized.length <= 14 ? normalized : ''
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function foodLogRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    ownerId: row.owner_id,
    date: row.entry_date,
    entryKey: row.entry_key,
    source: row.source,
    mealType: row.meal_type,
    name: row.name,
    quantity: Number(row.quantity),
    nutrients: parseJson(row.nutrients_json) ?? {},
    metadata: parseJson(row.metadata_json) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function haccpRowFromDatabase(row) {
  if (!row) return null
  return {
    prdlstReportNo: row.report_no,
    barcode: row.barcode,
    prdlstNm: row.product_name,
    prdkind: row.category,
    manufacture: row.manufacturer,
    seller: row.seller,
    capacity: row.capacity,
    rawmtrl: row.raw_materials,
    allergy: row.allergy,
    nutrient: row.nutrient_text,
    imgurl1: row.image_url_1,
    imgurl2: row.image_url_2,
    databaseSyncedAt: row.synced_at,
  }
}

export function upsertHaccpProducts(items) {
  const syncedAt = new Date().toISOString()
  let stored = 0

  database.exec('BEGIN IMMEDIATE')
  try {
    for (const item of items) {
      const reportNo = text(item?.prdlstReportNo)
      const productName = text(item?.prdlstNm)
      if (!reportNo || !productName) continue

      upsertHaccpStatement.run(
        reportNo,
        barcode(item?.barcode) || null,
        productName,
        text(item?.prdkind),
        text(item?.manufacture),
        text(item?.seller),
        text(item?.capacity),
        text(item?.rawmtrl),
        text(item?.allergy),
        text(item?.nutrient),
        text(item?.imgurl1),
        text(item?.imgurl2),
        JSON.stringify(item),
        syncedAt,
      )
      stored += 1
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  return stored
}

export function findHaccpProductByBarcode(value) {
  return haccpRowFromDatabase(getHaccpByBarcodeStatement.get(barcode(value)))
}

export function saveProductCache(value, product, ttlHours = 24 * 7) {
  const normalized = barcode(value)
  if (!normalized || !product) return

  const updatedAt = new Date()
  const expiresAt = new Date(updatedAt.getTime() + ttlHours * 60 * 60 * 1000)
  saveCacheStatement.run(
    normalized,
    text(product.source) || 'unknown',
    text(product.reportNo),
    JSON.stringify(product),
    updatedAt.toISOString(),
    expiresAt.toISOString(),
  )
}

export function findCachedProduct(value, includeExpired = false) {
  const row = getCacheStatement.get(barcode(value))
  if (!row || (!includeExpired && row.expires_at < new Date().toISOString())) return null

  const product = parseJson(row.payload_json)
  return product ? { product, updatedAt: row.updated_at, expiresAt: row.expires_at } : null
}

export function logBarcodeLookup(value, found, source) {
  const normalized = barcode(value)
  if (!normalized) return
  logLookupStatement.run(normalized, found ? 1 : 0, text(source) || 'unknown', new Date().toISOString())
}

export function saveSyncState({ recordCount, lastPage, totalPages, completed = false }) {
  const now = new Date().toISOString()
  saveSyncStateStatement.run('haccp', recordCount, lastPage, totalPages, now, completed ? now : null)
}

export function saveFoodLogEntry(entry) {
  const now = new Date().toISOString()
  upsertFoodLogStatement.run(
    text(entry.ownerId),
    text(entry.date),
    text(entry.entryKey),
    text(entry.source),
    text(entry.mealType),
    text(entry.name),
    Number(entry.quantity),
    JSON.stringify(entry.nutrients ?? {}),
    JSON.stringify(entry.metadata ?? {}),
    now,
    now,
  )
  return foodLogRow(getFoodLogEntryStatement.get(text(entry.ownerId), text(entry.date), text(entry.entryKey)))
}

export function listFoodLogEntries(ownerId, { month, date } = {}) {
  if (date) {
    return listFoodLogByDateStatement.all(text(ownerId), text(date)).map(foodLogRow)
  }

  const start = `${text(month)}-01`
  const [year, monthNumber] = text(month).split('-').map(Number)
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7)
  return listFoodLogByMonthStatement.all(text(ownerId), start, `${nextMonth}-01`).map(foodLogRow)
}

export function deleteFoodLogEntry(id, ownerId) {
  const result = deleteFoodLogStatement.run(Number(id), text(ownerId))
  return Number(result.changes) > 0
}

export function getDatabaseStats() {
  const haccp = database.prepare(`
    SELECT COUNT(*) AS total, COUNT(barcode) AS with_barcode, MAX(synced_at) AS latest
    FROM haccp_products
  `).get()
  const cache = database.prepare('SELECT COUNT(*) AS total, MAX(updated_at) AS latest FROM product_cache').get()
  const lookups = database.prepare('SELECT COUNT(*) AS total FROM lookup_events').get()
  const foodLog = database.prepare('SELECT COUNT(*) AS total, COUNT(DISTINCT owner_id) AS owners FROM food_log_entries').get()
  const sync = database.prepare("SELECT * FROM sync_state WHERE source = 'haccp'").get()

  return {
    path: databasePath,
    haccpProducts: Number(haccp?.total ?? 0),
    haccpProductsWithBarcode: Number(haccp?.with_barcode ?? 0),
    haccpLatest: haccp?.latest ?? null,
    cachedProducts: Number(cache?.total ?? 0),
    cacheLatest: cache?.latest ?? null,
    lookupEvents: Number(lookups?.total ?? 0),
    foodLogEntries: Number(foodLog?.total ?? 0),
    foodLogOwners: Number(foodLog?.owners ?? 0),
    sync: sync ?? null,
  }
}
