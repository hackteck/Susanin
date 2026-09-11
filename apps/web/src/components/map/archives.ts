import { FileSource, PMTiles, type Source } from 'pmtiles'

/**
 * The basemap archives, served from the browser's own storage once they have
 * been there once.
 *
 * Why bother: the pair is 11 MB, it changes about as often as Batumi's streets
 * do, and the reader this app is for is standing at a pole with one bar of
 * signal. Reading it locally also makes the map work with no network at all,
 * which is the same promise the timetable already makes.
 *
 * What this is NOT: a blocking download. A first visit draws from the network
 * exactly as before — `protomaps-leaflet` range-requests the few kilobytes of
 * directory and tile it needs, which is far less than the whole file — and the
 * full archive is fetched afterwards, in the background, for next time. Making
 * the map wait on 11 MB would be a worse app for the one visit that cannot
 * benefit from the cache.
 */

const DB_NAME = 'susanin-basemap'
const DB_VERSION = 1
const STORE = 'archives'

export interface ArchiveEntry {
  url: string
  bytes: number
  sha256: string
  maxZoom: number
}

export interface Manifest {
  planetBuild: string
  archives: Record<string, ArchiveEntry>
}

/** What a layer is built from: a stored copy, or the URL to range-request. */
export type ArchiveSource = PMTiles | string

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

interface Stored {
  sha256: string
  blob: Blob
}

/**
 * Keyed by the archive's name, and holding the sha256 the build recorded. A URL
 * would be a worse key: it never changes, so a rebuilt archive would be served
 * from a year-old copy forever — and a stale map is not a visible fault, it is
 * last year's streets drawn with confidence.
 */
const read = async (key: string, sha256: string): Promise<Blob | null> => {
  try {
    const stored = await withStore<Stored | undefined>('readonly', (store) => store.get(key))
    return stored && stored.sha256 === sha256 ? stored.blob : null
  } catch {
    // Private mode, a blocked upgrade, storage disabled outright — none of it is
    // worth a word to the reader, because the network copy still works.
    return null
  }
}

const write = async (key: string, entry: Stored) => {
  try {
    await withStore('readwrite', (store) => store.put(entry, key))
    return true
  } catch {
    // QuotaExceededError lands here. The map is already running from the
    // network; failing to squirrel a copy away changes nothing the reader sees.
    return false
  }
}

/**
 * `FileSource` wants a `File`, and IndexedDB hands back a `Blob` — a `File` is a
 * `Blob` with a name, and the name is what `getKey()` returns, so it has to be
 * stable rather than empty.
 */
const sourceFor = (blob: Blob, url: string): Source => new FileSource(new File([blob], url))

const MANIFEST_KEY = 'basemap-manifest'

// The last manifest seen. The stored archives are keyed by the sha256 it
// carries, so without it they cannot be opened at all — and the manifest is a
// network fetch. Offline, that returned null, the map fell back to URLs it
// could not reach either, and the reader got a grey map with 11 MB of the
// right one sitting in IndexedDB. On the one visit the cache exists for.
const rememberManifest = (manifest: Manifest) => {
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest))
  } catch {
    // Storage disabled or full. The next visit will try again.
  }
}

const recallManifest = (): Manifest | null => {
  try {
    const stored = localStorage.getItem(MANIFEST_KEY)
    return stored ? (JSON.parse(stored) as Manifest) : null
  } catch {
    return null
  }
}

export const loadManifest = async (base: string): Promise<Manifest | null> => {
  try {
    const response = await fetch(`${base}tiles/manifest.json`, { cache: 'no-cache' })
    if (!response.ok) return recallManifest()
    const manifest = (await response.json()) as Manifest
    rememberManifest(manifest)
    return manifest
  } catch {
    return recallManifest()
  }
}

/**
 * The archive's URL, versioned by its content. The file name never changes and
 * vercel.json marks /tiles/ immutable for a year — so after a planet rebuild a
 * returning browser's HTTP cache kept answering range requests from the old
 * file, and handed the background download the old bytes too, which the size
 * check then rejected: the new copy was never stored, and the old map was drawn
 * with confidence. A sha in the query makes each build its own URL, which is
 * what `immutable` was promising all along.
 */
const archiveUrl = (base: string, entry: ArchiveEntry) =>
  `${base}${entry.url.replace(/^\//, '')}?v=${entry.sha256.slice(0, 12)}`

/**
 * The source for one archive: the stored copy when there is a current one, and
 * otherwise the URL, so the map draws immediately either way.
 */
export const openArchive = async (base: string, entry: ArchiveEntry): Promise<ArchiveSource> => {
  const url = archiveUrl(base, entry)
  if (typeof indexedDB === 'undefined') return url

  const blob = await read(entry.sha256, entry.sha256)
  return blob ? new PMTiles(sourceFor(blob, url)) : url
}

/**
 * Fetch anything not already stored, after the map is up. Deliberately quiet and
 * deliberately skippable: on a metered or slow connection the reader wants the
 * bus, not a 5 MB download they never asked for.
 */
export const cacheArchives = async (base: string, manifest: Manifest) => {
  const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (connection?.saveData) return
  if (connection?.effectiveType && /^(slow-)?2g$/.test(connection.effectiveType)) return

  // Asked for, never insisted on. Chrome and Safari decide silently from how
  // much the reader uses the site; Firefox prompts. Without it the copy is
  // "best effort" and can be evicted under storage pressure — which is survivable,
  // since a miss just falls back to the network.
  try {
    await navigator.storage?.persist?.()
  } catch {
    // Not available, or refused. Neither changes what happens next.
  }

  // Keyed by sha256, so a rebuilt archive stores a new copy beside the old one.
  // Without this, every planet bump leaves 11 MB of last year's map behind and
  // the app's footprint only ever grows.
  const wanted = new Set(Object.values(manifest.archives).map((entry) => entry.sha256))
  try {
    const keys = await withStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
    for (const key of keys) {
      if (typeof key === 'string' && !wanted.has(key)) {
        await withStore('readwrite', (store) => store.delete(key))
      }
    }
  } catch {
    // Storage unavailable; there is nothing stored to prune either.
  }

  for (const entry of Object.values(manifest.archives)) {
    if (await read(entry.sha256, entry.sha256)) continue
    try {
      const response = await fetch(archiveUrl(base, entry))
      if (!response.ok) continue
      const blob = await response.blob()
      // A truncated download would be stored as a valid-looking archive and then
      // fail to decode on the next visit, which is far harder to diagnose than
      // simply not caching.
      if (blob.size !== entry.bytes) continue
      await write(entry.sha256, { sha256: entry.sha256, blob })
    } catch {
      // Offline, interrupted, evicted mid-write. Next visit tries again.
    }
  }
}

/** Drop everything: the archives changed, or the reader asked for the space back. */
export const forgetArchives = async () => {
  try {
    await withStore('readwrite', (store) => store.clear())
  } catch {
    // Nothing stored, or storage unavailable. Either way there is nothing to do.
  }
}
