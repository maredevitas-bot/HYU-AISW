export function listStoredEntries<T extends { ownerId: string; date: string; createdAt: string; id: number }>(entries: T[], ownerId: string, month: string): T[]
export function upsertStoredEntry<T extends { ownerId: string; date: string; entryKey: string }, U extends T & { id: number; createdAt: string; updatedAt: string }>(entries: U[], entry: T, now?: string, id?: number): { entries: U[]; saved: U }
export function removeStoredEntry<T extends { ownerId: string; id: number }>(entries: T[], ownerId: string, id: number): { entries: T[]; removed: boolean }
