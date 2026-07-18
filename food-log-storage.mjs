export function listStoredEntries(entries, ownerId, month) {
  return entries
    .filter((entry) => entry.ownerId === ownerId && entry.date.startsWith(`${month}-`))
    .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt) || left.id - right.id)
}

export function upsertStoredEntry(entries, entry, now = new Date().toISOString(), id = Date.now()) {
  const nextEntries = [...entries]
  const existingIndex = nextEntries.findIndex((item) => item.ownerId === entry.ownerId && item.date === entry.date && item.entryKey === entry.entryKey)
  const saved = {
    ...entry,
    id: existingIndex >= 0 ? nextEntries[existingIndex].id : id,
    createdAt: existingIndex >= 0 ? nextEntries[existingIndex].createdAt : now,
    updatedAt: now,
  }
  if (existingIndex >= 0) nextEntries[existingIndex] = saved
  else nextEntries.push(saved)
  return { entries: nextEntries, saved }
}

export function removeStoredEntry(entries, ownerId, id) {
  const nextEntries = entries.filter((entry) => !(entry.ownerId === ownerId && entry.id === id))
  return { entries: nextEntries, removed: nextEntries.length !== entries.length }
}
