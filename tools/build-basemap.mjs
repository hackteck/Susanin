// Builds the basemap the buses are drawn on: a Protomaps `.pmtiles` extract of
// the Batumi bounding box, which protomaps-leaflet renders in the browser — so
// street labels follow the reader's locale (ru / ka / en) instead of being
// baked into a raster image by whoever drew the tile.
//
//   npm run basemap                build if a pin has moved, then verify
//   npm run basemap -- --force     rebuild even when the artifact is current
//   npm run basemap -- --dry-run   cost the extract without downloading it
//
// The same command runs locally and on ubuntu-latest, with no global install:
// the script fetches Protomaps' Go `pmtiles` CLI itself. There is no JavaScript
// alternative — the `pmtiles` npm package is a decoder ("PMTiles archive
// decoder for browsers"), so nothing in node_modules can write an archive.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync, inflateRawSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Protomaps rebuilds the whole planet daily and publishes it as
// <YYYYMMDD>.pmtiles. This is pinned rather than tracking the newest build,
// because a basemap that changes under a deploy nobody made is indistinguishable
// from a bug: a street moves, a label appears, and nothing in the repo says why.
//
// To bump it: pick a date that is listed at https://build.protomaps.com/, put it
// here, run `npm run basemap -- --force`, and look at the map. It costs about
// twenty seconds and forty range requests against Protomaps' bucket, plus a
// fresh 6 MB download for every client once it ships. OSM's Batumi coverage
// moves slowly — once a year, or when someone reports a missing street, is the
// right cadence.
const PLANET_BUILD = '20260910'
const PLANET_URL = `https://build.protomaps.com/${PLANET_BUILD}.pmtiles`

// The same rectangle as TransitMap.vue's BOUNDS:
//
//   const BOUNDS = L.latLngBounds([41.55, 41.5], [41.75, 41.78])
//                                 [south, west]  [north, east]
//
// The map cannot be panned outside it, so a tile outside it could never be
// drawn. Leaflet takes [lat, lon] corners; pmtiles takes the opposite order,
// min_lon,min_lat,max_lon,max_lat, which is the one place this is easy to get
// wrong. Two files holding one rectangle is how one of them rots, so the build
// re-reads BOUNDS out of the component and refuses to ship a disagreement.
const BBOX = { west: 41.5, south: 41.55, east: 41.78, north: 41.75 }
const BOUNDS_SOURCE = join(ROOT, 'apps/web/src/components/map/TransitMap.vue')

// A second, deliberately coarse archive, and the reason it exists is that the
// rectangle above stops at the network's edge. That is right for the zooms where
// stops and buses are drawn and wrong the moment anyone zooms out: at z11 a
// 2559px screen shows 1.76 degrees of longitude against that rectangle's 0.28,
// and the rest came out as a grey void around the city.
//
// Covering that view is affordable only because of where the cost actually sits.
// Measured against the same planet build: a z0-13 cut of this rectangle is about
// 12 MB, a z0-12 cut is 4.97 MB. Nearly all of it is z13. The renderer overzooms
// and, being vector, stays crisp doing it, so z12 data draws z13 perfectly well
// and z12 is where this stops.
const OVERVIEW_BBOX = { west: 40.73, south: 41.3, east: 42.53, north: 42.0 }
const OVERVIEW_MAX_ZOOM = 12

// 15 is the Protomaps basemap's own maximum. The renderer overzooms above it
// and, being vector, the labels stay crisp — so z15 data covers the app's whole
// z11–19 range. Asking for more would only fail.
const MAX_ZOOM = 15

// Vite copies public/ verbatim, so these land at /tiles/*.pmtiles with no config
// change and no plugin. They are generated, so they are gitignored.
//
// Two archives, each verified on its own terms. Only the detail one is the map's
// own rectangle, so only it is cross-checked against BOUNDS; and the overview's
// floors are lower because a z12 tile carries the through-roads and little else,
// which the detail archive's thresholds would read as a broken file.
const ARCHIVES = [
  {
    key: 'detail',
    out: join(ROOT, 'apps/web/public/tiles/batumi.pmtiles'),
    bbox: BBOX,
    maxZoom: MAX_ZOOM,
    minTileEntries: 300,
    minNamedRoads: 20,
    boundsSource: BOUNDS_SOURCE,
  },
  {
    key: 'overview',
    out: join(ROOT, 'apps/web/public/tiles/batumi-overview.pmtiles'),
    bbox: OVERVIEW_BBOX,
    maxZoom: OVERVIEW_MAX_ZOOM,
    minTileEntries: 100,
    minNamedRoads: 5,
    boundsSource: null,
  },
]

// Tiny, and fetched before the archives so the client knows what it is looking for.
const MANIFEST = join(ROOT, 'apps/web/public/tiles/manifest.json')

const CACHE = join(ROOT, '.cache/basemap')
const STAMP = join(CACHE, 'stamp.json')

const CLI_VERSION = '1.31.2'

// go-pmtiles publishes no checksums file — the v1.31.2 release has these six
// assets and nothing else, and .../download/v1.31.2/checksums.txt is a 404.
// GitHub's API does report a sha256 per asset, so those digests are pinned here
// instead. Pinning beats fetching a checksums file next to the download: this
// one also fails if an asset is ever replaced under an existing tag.
//
//   curl -s https://api.github.com/repos/protomaps/go-pmtiles/releases/tags/v1.31.2 \
//     | jq -r '.assets[] | "\(.name) \(.digest)"'
//
// Darwin's assets put a dash before the version where every other platform puts
// an underscore. That is upstream's naming, not a typo here.
const CLI_ASSETS = {
  'win32-x64': ['go-pmtiles_1.31.2_Windows_x86_64.zip', 'a658baa4d7e55020aef6ca17bd9ff9faa1582671266b36f58c52db0ac8e785a1'],
  'win32-arm64': ['go-pmtiles_1.31.2_Windows_arm64.zip', '8780a17453c63af757917a694cbbb50b943db89cc3f1b07e6fd62c1ff8e6963b'],
  'linux-x64': ['go-pmtiles_1.31.2_Linux_x86_64.tar.gz', '3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f'],
  'linux-arm64': ['go-pmtiles_1.31.2_Linux_arm64.tar.gz', 'f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1'],
  'darwin-x64': ['go-pmtiles-1.31.2_Darwin_x86_64.zip', '1f0dc02eee6c58312dd6c509faee1b5c32f0596568af1bf51f1b034e7a88a65b'],
  'darwin-arm64': ['go-pmtiles-1.31.2_Darwin_arm64.zip', '40528f7f616fcbf91207cd48c8fc023d213f6d86c0cbf1f748732803d1880f3d'],
}

// Measured on the 20260910 build: 589 tile entries, and in the city-centre z15
// tile 45 roads carry name:ru, 45 carry the local Georgian name, 44 carry
// name:en. The floors below sit well under those, so a re-pin or a bbox tweak
// does not fail the build while a truncated download or a tileset that lost its
// translations still does.
const MIN_TILE_ENTRIES = 300
const MIN_NAMED_ROADS = 20

// A tile over the Black Sea would pass any check about labels by having none,
// and the bbox contains plenty of sea. So the language check is aimed at the
// middle of Batumi, where there is something to read.
const VERIFY_AT = { lat: 41.641, lon: 41.63 }

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const die = (message) => {
  console.error(`\nbasemap: ${message}\n`)
  process.exit(1)
}

// --- the CLI ---------------------------------------------------------------

// The release archives hold LICENSE, README.md and the binary. Both formats are
// walked by hand: reaching for `tar` or Expand-Archive would work on CI and on
// this machine right up until it met a runner that had neither.
//
// Exported because only one of these two ever runs on a given machine — the dev
// box takes the zip and CI takes the tarball — so running the build can never
// check both, and the one nobody runs is the one that breaks the deploy.
export const fromZip = (buf, wanted) => {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) die('release asset is not a zip file (no end-of-central-directory record)')

  let p = buf.readUInt32LE(eocd + 16)
  const count = buf.readUInt16LE(eocd + 10)
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10)
    const compressed = buf.readUInt32LE(p + 20)
    const nameLength = buf.readUInt16LE(p + 28)
    const name = buf.subarray(p + 46, p + 46 + nameLength).toString('utf8')
    const localHeader = buf.readUInt32LE(p + 42)
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
    if (name !== wanted) continue

    // The local header repeats the name and extra fields at its own lengths,
    // which are not the central directory's.
    const dataAt = localHeader + 30 + buf.readUInt16LE(localHeader + 26) + buf.readUInt16LE(localHeader + 28)
    const data = buf.subarray(dataAt, dataAt + compressed)
    return method === 0 ? Buffer.from(data) : inflateRawSync(data)
  }
  return die(`release asset contains no ${wanted}`)
}

export const fromTarGz = (buf, wanted) => {
  const tar = gunzipSync(buf)
  for (let p = 0; p + 512 <= tar.length; ) {
    const name = tar.subarray(p, p + 100).toString('utf8').replace(/\0.*$/, '')
    if (!name) break
    const size = Number.parseInt(tar.subarray(p + 124, p + 136).toString('utf8').replace(/[^0-7]/g, ''), 8) || 0
    const body = p + 512
    p = body + Math.ceil(size / 512) * 512
    if (name === wanted || name === `./${wanted}`) return Buffer.from(tar.subarray(body, body + size))
  }
  return die(`release asset contains no ${wanted}`)
}

const ensureCli = async () => {
  const key = `${process.platform}-${process.arch}`
  const asset = CLI_ASSETS[key]
  if (!asset) die(`no go-pmtiles ${CLI_VERSION} release asset for ${key} — there are ${Object.keys(CLI_ASSETS).join(', ')}`)
  const [assetName, digest] = asset

  const binaryName = process.platform === 'win32' ? 'pmtiles.exe' : 'pmtiles'
  // Versioned, so bumping CLI_VERSION cannot quietly reuse the old binary.
  const cached = join(CACHE, `pmtiles-${CLI_VERSION}${process.platform === 'win32' ? '.exe' : ''}`)
  if (existsSync(cached)) return cached

  mkdirSync(CACHE, { recursive: true })
  const url = `https://github.com/protomaps/go-pmtiles/releases/download/v${CLI_VERSION}/${assetName}`
  console.log(`fetching ${assetName}`)
  const response = await fetch(url)
  if (!response.ok) die(`GitHub returned ${response.status} ${response.statusText} for ${url}`)
  const archive = Buffer.from(await response.arrayBuffer())

  const got = sha256(archive)
  if (got !== digest) {
    die(
      `checksum mismatch for ${assetName}\n  expected ${digest}\n  got      ${got}\n` +
        'Refusing to run a binary that is not the pinned release.',
    )
  }

  const binary = assetName.endsWith('.zip') ? fromZip(archive, binaryName) : fromTarGz(archive, binaryName)
  // Written aside and renamed, so an interrupted run leaves no half a binary for
  // the next run to execute happily.
  const partial = `${cached}.partial`
  writeFileSync(partial, binary)
  if (process.platform !== 'win32') chmodSync(partial, 0o755)
  renameSync(partial, cached)
  console.log(`go-pmtiles ${CLI_VERSION} cached at ${relative(ROOT, cached)} (${binary.length.toLocaleString('en-US')} bytes, sha256 verified)`)
  return cached
}

// --- PMTiles v3 ------------------------------------------------------------

// Offsets are the v3 spec's fixed 127-byte header.
export const readHeader = (buf) => {
  if (buf.length < 127) throw new Error(`archive is ${buf.length} bytes — too short to hold a PMTiles header`)
  const magic = buf.subarray(0, 7).toString('latin1')
  if (magic !== 'PMTiles') throw new Error(`not a PMTiles archive: magic is ${JSON.stringify(magic)}, expected "PMTiles"`)
  if (buf[7] !== 3) throw new Error(`PMTiles v${buf[7]}, but protomaps-leaflet reads v3`)
  const u64 = (at) => Number(buf.readBigUInt64LE(at))
  return {
    metadataOffset: u64(24),
    metadataLength: u64(32),
    addressedTiles: u64(72),
    tileEntries: u64(80),
    internalCompression: buf[97],
    tileType: buf[99],
    minZoom: buf[100],
    maxZoom: buf[101],
    bbox: {
      west: buf.readInt32LE(102) / 1e7,
      south: buf.readInt32LE(106) / 1e7,
      east: buf.readInt32LE(110) / 1e7,
      north: buf.readInt32LE(114) / 1e7,
    },
  }
}

const readMetadata = (buf, header) => {
  const raw = buf.subarray(header.metadataOffset, header.metadataOffset + header.metadataLength)
  if (header.internalCompression === 2) return JSON.parse(gunzipSync(raw).toString('utf8'))
  if (header.internalCompression === 1) return JSON.parse(raw.toString('utf8'))
  throw new Error(`archive metadata uses compression code ${header.internalCompression}, which this script cannot read`)
}

// --- vector tiles ----------------------------------------------------------

// Just enough of the vector-tile protobuf to answer one question: does a real
// feature carry name:ru? A parser for that would be a dependency, in a repo
// whose test runner deliberately has none.
const varint = (buf, at) => {
  let value = 0
  let shift = 0
  let byte
  let p = at
  do {
    byte = buf[p++]
    value += (byte & 0x7f) * 2 ** shift
    shift += 7
  } while (byte & 0x80)
  return [value, p]
}

function* protoFields(buf, start, end) {
  let p = start
  while (p < end) {
    const [key, afterKey] = varint(buf, p)
    p = afterKey
    const num = key >>> 3
    const wire = key & 7
    if (wire === 0) {
      const [, afterValue] = varint(buf, p)
      yield { num, from: p, to: afterValue }
      p = afterValue
    } else if (wire === 2) {
      const [length, afterLength] = varint(buf, p)
      yield { num, from: afterLength, to: afterLength + length }
      p = afterLength + length
    } else if (wire === 5) {
      yield { num, from: p, to: p + 4 }
      p += 4
    } else if (wire === 1) {
      yield { num, from: p, to: p + 8 }
      p += 8
    } else {
      throw new Error(`vector tile is malformed: wire type ${wire}`)
    }
  }
}

export const decodeMvt = (tile) => {
  const buf = tile[0] === 0x1f && tile[1] === 0x8b ? gunzipSync(tile) : tile
  const layers = new Map()
  for (const layer of protoFields(buf, 0, buf.length)) {
    if (layer.num !== 3) continue
    let name = ''
    const keys = []
    const values = []
    const features = []
    for (const field of protoFields(buf, layer.from, layer.to)) {
      if (field.num === 1) {
        name = buf.subarray(field.from, field.to).toString('utf8')
      } else if (field.num === 3) {
        keys.push(buf.subarray(field.from, field.to).toString('utf8'))
      } else if (field.num === 4) {
        // Only the string variant matters here; a street name is never a number.
        let value = null
        for (const variant of protoFields(buf, field.from, field.to)) {
          if (variant.num === 1) value = buf.subarray(variant.from, variant.to).toString('utf8')
        }
        values.push(value)
      } else if (field.num === 2) {
        for (const part of protoFields(buf, field.from, field.to)) {
          if (part.num !== 2) continue
          const tags = []
          for (let p = part.from; p < part.to; ) {
            const [tag, next] = varint(buf, p)
            tags.push(tag)
            p = next
          }
          features.push(tags)
        }
      }
    }
    layers.set(name, { keys, values, features })
  }
  return layers
}

// --- verification ----------------------------------------------------------

// The one that actually matters. An archive of Georgian-only labels weighs the
// same as a good one and renders a map a Russian reader cannot use, so the build
// asserts that real road features carry a real name in each locale the app
// offers. `ka` is checked through the plain `name` key on purpose: these tiles
// carry no name:ka, and protomaps-leaflet falls back to `name`, which is what is
// painted on the street sign.
export const verifyTileLanguages = (tile, minRoads = MIN_NAMED_ROADS) => {
  const roads = decodeMvt(tile).get('roads')
  if (!roads) throw new Error('tile has no roads layer')

  const expected = [
    ['ru', 'name:ru', /\p{Script=Cyrillic}/u],
    ['ka', 'name', /\p{Script=Georgian}/u],
    ['en', 'name:en', /\p{Script=Latin}/u],
  ]
  const report = []
  for (const [locale, tag, script] of expected) {
    const key = roads.keys.indexOf(tag)
    let named = 0
    let sample = null
    if (key >= 0) {
      for (const tags of roads.features) {
        for (let i = 0; i + 1 < tags.length; i += 2) {
          if (tags[i] !== key) continue
          const value = roads.values[tags[i + 1]]
          if (typeof value === 'string' && script.test(value)) {
            named++
            sample ??= value
          }
        }
      }
    }
    if (named < minRoads) {
      throw new Error(
        `locale ${locale}: only ${named} road features carry ${tag} in the expected script (need ${minRoads}). ` +
          'This archive would label the map in a language that reader cannot read.',
      )
    }
    report.push(`${locale} ${String(named).padStart(3)} roads via ${tag.padEnd(7)} e.g. ${sample}`)
  }
  return report
}

// z/x/y for a point, so the checked tile follows the bbox rather than being a
// magic number that outlives a move of the map.
const tileAt = (lat, lon, z) => {
  const n = 2 ** z
  const rad = (lat * Math.PI) / 180
  return {
    z,
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  }
}

const near = (a, b) => Math.abs(a - b) < 1e-6

export const verifyArchive = (cli, file, { planetBuild, bbox, maxZoom, minTileEntries = MIN_TILE_ENTRIES, minNamedRoads = MIN_NAMED_ROADS }) => {
  const buf = readFileSync(file)
  const header = readHeader(buf)

  if (header.tileType !== 1) throw new Error(`tile type ${header.tileType}, expected 1 (MVT) — protomaps-leaflet cannot draw anything else`)
  if (header.maxZoom !== maxZoom || header.minZoom !== 0) throw new Error(`archive covers z${header.minZoom}–${header.maxZoom}, expected z0–${maxZoom}`)
  if (header.tileEntries < minTileEntries) {
    throw new Error(`only ${header.tileEntries} tile entries (expected at least ${minTileEntries}) — the extract is truncated, or the bbox is wrong`)
  }
  for (const edge of ['west', 'south', 'east', 'north']) {
    if (!near(header.bbox[edge], bbox[edge])) {
      throw new Error(`archive ${edge} edge is ${header.bbox[edge]}, expected ${bbox[edge]} — this file was built for a different rectangle`)
    }
  }

  const metadata = readMetadata(buf, header)

  // Ties the artifact to the pin. Without this the file is just bytes: someone
  // bumps PLANET_BUILD, the stale archive passes every structural check, and the
  // deploy ships last year's streets. It is a window rather than an equality
  // because a daily build is named for its date but cut from an OSM replication
  // snapshot a few hours either side of midnight.
  const osmTime = metadata['planetiler:osm:osmosisreplicationtime']
  if (!osmTime) throw new Error('archive metadata carries no planetiler:osm:osmosisreplicationtime — its provenance cannot be checked')
  const pinned = Date.UTC(+planetBuild.slice(0, 4), +planetBuild.slice(4, 6) - 1, +planetBuild.slice(6, 8))
  const drift = Math.abs(Date.parse(osmTime) - pinned) / 86400000
  if (!(drift <= 2)) {
    throw new Error(`archive holds OSM data from ${osmTime}, ${drift.toFixed(1)} days from the pinned build ${planetBuild} — rebuild with --force`)
  }

  // Cheap, and it is the format's own reference implementation checking its own
  // work: it walks every directory entry rather than trusting the header counts.
  execFileSync(cli, ['verify', file], { stdio: ['ignore', 'ignore', 'inherit'] })

  const { z, x, y } = tileAt(VERIFY_AT.lat, VERIFY_AT.lon, maxZoom)
  const tile = execFileSync(cli, ['tile', file, String(z), String(x), String(y)], { maxBuffer: 64 * 1024 * 1024 })
  if (tile.length === 0) throw new Error(`tile ${z}/${x}/${y}, over central Batumi, is empty`)
  const languages = verifyTileLanguages(tile, minNamedRoads)

  return { header, metadata, languages, tile: { z, x, y, bytes: tile.length }, bytes: buf.length, sha256: sha256(buf) }
}

// The rectangle lives in two files and only one of them is the map. If they
// drift, tiles stop existing exactly where the app is still willing to pan. A
// rename or a reformat of that line is not a reason to fail a build, so an
// unreadable BOUNDS warns — but a BOUNDS that contradicts this one stops it.
export const checkBoundsMatch = (source, bbox) => {
  if (!existsSync(source)) return `cannot cross-check BOUNDS: ${relative(ROOT, source)} is missing`
  const found = readFileSync(source, 'utf8').match(
    /BOUNDS\s*=\s*L\.latLngBounds\(\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*,\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/,
  )
  if (!found) return `cannot cross-check BOUNDS: no L.latLngBounds([south, west], [north, east]) in ${relative(ROOT, source)}`
  const [south, west, north, east] = found.slice(1, 5).map(Number)
  if (near(south, bbox.south) && near(west, bbox.west) && near(north, bbox.north) && near(east, bbox.east)) return null
  throw new Error(
    'BBOX does not match the map\'s BOUNDS.\n' +
      `  ${relative(ROOT, source)}: south ${south} west ${west} north ${north} east ${east}\n` +
      `  tools/build-basemap.mjs:    south ${bbox.south} west ${bbox.west} north ${bbox.north} east ${bbox.east}\n` +
      'Whichever moved, the other must move with it and the archive must be rebuilt.',
  )
}

// --- build -----------------------------------------------------------------

const stampFor = (spec, sha) => ({
  planetBuild: PLANET_BUILD,
  bbox: spec.bbox,
  maxZoom: spec.maxZoom,
  cli: CLI_VERSION,
  sha256: sha,
})

const stampPath = (spec) => join(CACHE, `${spec.key}.json`)

const isCurrent = (spec) => {
  if (!existsSync(spec.out) || !existsSync(stampPath(spec))) return false
  try {
    const stamp = JSON.parse(readFileSync(stampPath(spec), 'utf8'))
    return (
      JSON.stringify(stamp) === JSON.stringify(stampFor(spec, stamp.sha256)) &&
      sha256(readFileSync(spec.out)) === stamp.sha256
    )
  } catch {
    return false
  }
}

const cut = async (cli, spec, { force, dryRun }) => {
  if (spec.boundsSource) {
    const warning = checkBoundsMatch(spec.boundsSource, spec.bbox)
    if (warning) console.warn(`basemap: ${warning}`)
  }

  if (!dryRun && !force && isCurrent(spec)) {
    console.log(`${relative(ROOT, spec.out).replace(/\\/g, '/')} is current for planet ${PLANET_BUILD} — rebuild with --force`)
    return
  }

  // Built aside and moved into place only once it has been verified, so the path
  // the SPA fetches never holds a half-written or unchecked archive.
  const partial = `${spec.out}.partial`
  mkdirSync(dirname(spec.out), { recursive: true })
  rmSync(partial, { force: true })
  execFileSync(
    cli,
    [
      'extract',
      PLANET_URL,
      partial,
      `--bbox=${spec.bbox.west},${spec.bbox.south},${spec.bbox.east},${spec.bbox.north}`,
      `--maxzoom=${spec.maxZoom}`,
      ...(dryRun ? ['--dry-run'] : []),
    ],
    { stdio: 'inherit' },
  )
  if (dryRun) return

  const built = verifyArchive(cli, partial, { planetBuild: PLANET_BUILD, ...spec })
  rmSync(spec.out, { force: true })
  renameSync(partial, spec.out)
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(stampPath(spec), `${JSON.stringify(stampFor(spec, built.sha256), null, 2)}\n`)
}

const report = (cli, spec) => {
  // Verified on every run, the skipped-rebuild path included: the artifacts are
  // gitignored, so the copies on this disk are the only ones anybody has.
  const result = verifyArchive(cli, spec.out, { planetBuild: PLANET_BUILD, ...spec })
  console.log('')
  console.log(`  ${relative(ROOT, spec.out).replace(/\\/g, '/')}`)
  console.log(`  ${result.bytes.toLocaleString('en-US')} bytes  sha256 ${result.sha256}`)
  console.log(`  ${result.header.tileEntries} tiles, z${result.header.minZoom}–${result.header.maxZoom}, ${result.metadata.name} ${result.metadata.version}`)
  console.log(`  OSM data ${result.metadata['planetiler:osm:osmosisreplicationtime']} (planet build ${PLANET_BUILD})`)
  for (const line of result.languages) console.log(`  ${line}`)
  console.log(`  checked tile ${result.tile.z}/${result.tile.x}/${result.tile.y}, ${result.tile.bytes.toLocaleString('en-US')} bytes gzipped`)
  return result
}

const main = async () => {
  const started = Date.now()
  const force = process.argv.includes('--force')
  const dryRun = process.argv.includes('--dry-run')

  const cli = await ensureCli()

  if (dryRun || force || ARCHIVES.some((spec) => !isCurrent(spec))) {
    // Checked here rather than left to the extract: a build date that was never
    // published, or has aged out of the bucket, otherwise surfaces as a wall of
    // range-request errors that says nothing about the cause.
    const head = await fetch(PLANET_URL, { method: 'HEAD' })
    if (!head.ok) {
      die(
        `the pinned planet build is not available: HEAD ${PLANET_URL} → ${head.status} ${head.statusText}\n` +
          'Pick a date that is listed at https://build.protomaps.com/ and update PLANET_BUILD.',
      )
    }
    console.log(`planet ${PLANET_BUILD}: ${(Number(head.headers.get('content-length')) / 1e9).toFixed(1)} GB upstream`)
  }

  for (const spec of ARCHIVES) await cut(cli, spec, { force, dryRun })

  if (dryRun) {
    console.log('\ndry run: nothing was written.')
    return
  }

  let total = 0
  const manifest = { planetBuild: PLANET_BUILD, archives: {} }
  for (const spec of ARCHIVES) {
    const result = report(cli, spec)
    total += result.bytes
    manifest.archives[spec.key] = {
      url: `/tiles/${basename(spec.out)}`,
      bytes: result.bytes,
      sha256: result.sha256,
      maxZoom: spec.maxZoom,
    }
  }

  // The browser cannot tell a current archive from last year's by looking at it,
  // and a stale one is not a visible fault — it is last year's streets drawn
  // confidently. So the build states what it produced, and the client keys its
  // stored copy on the sha256 rather than on the URL, which never changes.
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`\n  ${relative(ROOT, MANIFEST).replace(/\\/g, '/')}`)
  console.log(`\n  ${total.toLocaleString('en-US')} bytes total for the pair`)
  console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

// Importable, for the guards' own sake: breaking a check and watching it go red
// is the only way to know it is a check and not a comment.
// argv[1] is absent when node is handed a script on the command line, which is
// how the checks below get imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
