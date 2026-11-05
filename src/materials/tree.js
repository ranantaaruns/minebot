'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const { countItemName } = require('../util/inventory')
const { sleep, withTimeout } = require('../util/async')
const { mineBlock, inReach, isPassableBlock, REACH } = require('./dig')

const LOG_SUFFIX_RE = /_(log|wood|stem)$/
const LEAF_SUFFIX_RE = /_(leaves|wart_block)$/

const SOIL_NAMES = [
  'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'moss_block',
  'pale_moss_block', 'mycelium', 'mud', 'dirt_path', 'soul_soil'
]

function bareName (name) {
  return String(name || '').replace(/^minecraft:/, '').toLowerCase()
}

function isLogName (name) {
  return LOG_SUFFIX_RE.test(bareName(name))
}

function isLeafName (name) {
  return LEAF_SUFFIX_RE.test(bareName(name))
}

// Sapling untuk sebuah log: dark_oak_log -> dark_oak_sapling. Jamur Nether
// memakai _fungus, bukan _sapling.
function saplingNameFor (name) {
  const base = bareName(name)
  if (!base) return null
  if (/_stem$/.test(base)) return `${base.replace(/_stem$/, '')}_fungus`
  const stripped = base.replace(/_(log|wood)$/, '')
  return stripped ? `${stripped}_sapling` : null
}

function isSoil (block) {
  return !!block && SOIL_NAMES.includes(bareName(block.name))
}

function blockKey (pos) {
  return `${pos.x},${pos.y},${pos.z}`
}

// Kelompokkan blok log menjadi pohon. Trunk dark oak 2x2 dan cabangnya saling
// bersentuhan, jadi ketetanggaan 26 arah sudah memisahkan satu pohon dari pohon
// sebelahnya.
function clusterLogs (positions, options = {}) {
  const gap = Math.max(1, Math.min(2, Number(options.gap) || 1))
  const byKey = new Map()
  for (const pos of positions || []) {
    if (!pos) continue
    byKey.set(blockKey(pos), pos)
  }

  const seen = new Set()
  const clusters = []

  for (const start of byKey.values()) {
    const startKey = blockKey(start)
    if (seen.has(startKey)) continue

    const stack = [start]
    const blocks = []
    seen.add(startKey)

    while (stack.length > 0) {
      const current = stack.pop()
      blocks.push(current)
      for (let dx = -gap; dx <= gap; dx++) {
        for (let dy = -gap; dy <= gap; dy++) {
          for (let dz = -gap; dz <= gap; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue
            const key = `${current.x + dx},${current.y + dy},${current.z + dz}`
            const next = byKey.get(key)
            if (!next || seen.has(key)) continue
            seen.add(key)
            stack.push(next)
          }
        }
      }
    }

    clusters.push(summarizeTree(blocks))
  }

  return clusters
}

function summarizeTree (blocks) {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxY = -Infinity
  let sumX = 0
  let sumZ = 0

  for (const pos of blocks) {
    if (pos.x < minX) minX = pos.x
    if (pos.z < minZ) minZ = pos.z
    if (pos.y < minY) minY = pos.y
    if (pos.y > maxY) maxY = pos.y
    sumX += pos.x
    sumZ += pos.z
  }

  const count = blocks.length || 1
  return {
    // id dari sudut terkecil: tetap sama walaupun bagian atas pohon sudah ditebang.
    id: `${minX},${minY},${minZ}`,
    blocks,
    size: blocks.length,
    minY,
    maxY,
    height: maxY - minY + 1,
    center: { x: sumX / count, y: (minY + maxY) / 2, z: sumZ / count }
  }
}

// Urutan tebang: paling atas dulu (permintaan user untuk pohon besar seperti
// dark oak), lalu yang paling dekat supaya bot tidak mondar-mandir.
function orderTopDown (blocks, origin) {
  const base = origin || { x: 0, y: 0, z: 0 }
  return (blocks || []).slice().sort((a, b) => {
    if (b.y !== a.y) return b.y - a.y
    const da = (a.x - base.x) ** 2 + (a.z - base.z) ** 2
    const db = (b.x - base.x) ** 2 + (b.z - base.z) ** 2
    return da - db
  })
}

// Klaim pohon per bot: supaya 3 bot tidak menyerbu satu pohon yang sama.
// Semua sesi bot hidup dalam satu proses, jadi registry ini otomatis dipakai
// bersama (lihat `sharedClaims`).
class TreeClaims {
  constructor (options = {}) {
    this.ttlMs = Number(options.ttlMs) || 180000
    this.claims = new Map()
  }

  prune (now = Date.now()) {
    for (const [id, claim] of this.claims) {
      if (claim.until <= now) this.claims.delete(id)
    }
  }

  ownerOf (treeId, now = Date.now()) {
    this.prune(now)
    return this.claims.get(treeId)?.owner || null
  }

  isClaimedByOther (treeId, ownerId, now = Date.now()) {
    const owner = this.ownerOf(treeId, now)
    return owner !== null && owner !== ownerId
  }

  claim (treeId, ownerId, now = Date.now()) {
    this.prune(now)
    const current = this.claims.get(treeId)
    if (current && current.owner !== ownerId) return false
    this.claims.set(treeId, { owner: ownerId, until: now + this.ttlMs })
    return true
  }

  renew (treeId, ownerId, now = Date.now()) {
    const current = this.claims.get(treeId)
    if (!current || current.owner !== ownerId) return false
    current.until = now + this.ttlMs
    return true
  }

  release (treeId, ownerId) {
    const current = this.claims.get(treeId)
    if (!current) return false
    if (ownerId && current.owner !== ownerId) return false
    this.claims.delete(treeId)
    return true
  }

  clear () {
    this.claims.clear()
  }

  get size () {
    return this.claims.size
  }
}

let sharedRegistry = null

function sharedClaims () {
  if (!sharedRegistry) sharedRegistry = new TreeClaims()
  return sharedRegistry
}

function resetSharedClaims () {
  sharedRegistry = null
}

// Pohon terdekat yang belum diklaim bot lain. Kalau semua di sekitar sudah
// diklaim, kembalikan null supaya pemanggil menunggu / memperluas pencarian.
function pickTree (trees, options = {}) {
  const { origin, claims, ownerId, minSize = 1, exclude } = options
  const base = origin || { x: 0, y: 0, z: 0 }

  const candidatesFor = minBlocks => (trees || [])
    .filter(tree => tree && tree.blocks && tree.blocks.length >= minBlocks)
    .filter(tree => !exclude || !exclude.has(tree.id))
    .filter(tree => !claims || !claims.isClaimedByOther(tree.id, ownerId))
    .map(tree => ({
      tree,
      distance: Math.hypot(tree.center.x - base.x, tree.center.z - base.z)
    }))
    .sort((a, b) => {
      // Pohon besar lebih dulu kalau jaraknya mirip: satu pohon besar = puluhan log.
      if (Math.abs(a.distance - b.distance) > 6) return a.distance - b.distance
      return b.tree.size - a.tree.size
    })

  const candidates = candidatesFor(minSize)
  if (candidates.length > 0) return candidates[0]

  // Kalau tidak ada pohon yang cukup besar, sisa pohon kecil tetap diambil
  // supaya kuota tidak berhenti hanya karena pohonnya kecil.
  const fallback = candidatesFor(1)
  return fallback.length > 0 ? fallback[0] : null
}

function discoverTrees (bot, ids, options = {}) {
  const {
    radius = 64,
    count = 512,
    protectOrigin = null,
    protectRadius = 8,
    mineYMin = -60,
    mineYMax = 320,
    exclude = null
  } = options

  let found = []
  try {
    found = bot.findBlocks({ matching: ids, maxDistance: radius, count }) || []
  } catch (err) {
    options.logger?.debug(`findBlocks pohon gagal: ${err.message}`)
    return []
  }

  const filtered = found.filter(pos => {
    if (pos.y < mineYMin || pos.y > mineYMax) return false
    if (protectOrigin && protectRadius > 0 && pos.distanceTo(protectOrigin) <= protectRadius) return false
    const block = typeof bot.blockAt === 'function' ? bot.blockAt(pos) : null
    if (block && block.name && !ids.includes(block.type)) return false
    return true
  })

  return clusterLogs(filtered, { gap: options.gap })
    .filter(tree => !exclude || !exclude.has(tree.id))
}

// --- Daun --------------------------------------------------------------
// Kanopi dark oak menutupi log bagian dalam: bot bisa "melihat" log itu tapi
// tidak bisa menjangkaunya karena terhalang/tidak ada jalur. Daun di garis
// pandang dibuka dulu, jadi log di dalam pohon tetap bisa ditebang.

function lineLeafBlocks (bot, target, options = {}) {
  const from = bot?.entity?.position
  const to = target?.position
  if (!from || !to) return []
  const step = Number(options.step) || 0.25
  const eye = from.offset(0, 1.62, 0)
  const end = to.offset(0.5, 0.5, 0.5)
  const steps = Math.max(1, Math.ceil(eye.distanceTo(end) / step))
  const seen = new Set()
  const out = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const point = eye.offset(
      (end.x - eye.x) * t,
      (end.y - eye.y) * t,
      (end.z - eye.z) * t
    ).floored()
    const key = blockKey(point)
    if (seen.has(key)) continue
    seen.add(key)
    const found = typeof bot.blockAt === 'function' ? bot.blockAt(point) : null
    if (found && isLeafName(found.name)) out.push(found)
  }
  return out
}

async function clearLeafPath (bot, target, options = {}) {
  const { logger, maxLeaves = 8 } = options
  const leaves = lineLeafBlocks(bot, target, options).slice(0, maxLeaves)
  let cleared = 0
  let failed = 0
  for (const leaf of leaves) {
    const res = await mineBlock(bot, leaf, options)
    if (res.ok) {
      cleared++
      continue
    }
    failed++
    logger?.debug?.(`Gagal membuka daun di ${blockKey(leaf.position)}: ${res.reason}`)
    if (failed >= 3) break
  }
  return cleared
}

// Daun yang mengurung bot (bot berhenti di tengah kanopi dan tidak bisa jalan).
async function clearLeavesAround (bot, options = {}) {
  const { logger, maxLeaves = 4 } = options
  const feet = bot?.entity?.position
  if (!feet || typeof bot.blockAt !== 'function') return 0
  const base = feet.floored()
  const found = []
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue
        const block = bot.blockAt(base.offset(dx, dy, dz))
        if (!block || !isLeafName(block.name)) continue
        if (!inReach(bot, block)) continue
        found.push(block)
      }
    }
  }
  let cleared = 0
  for (const leaf of found.slice(0, maxLeaves)) {
    const res = await mineBlock(bot, leaf, options)
    if (res.ok) cleared++
  }
  if (cleared > 0) logger?.debug?.(`Membuka ${cleared} blok daun di sekitar bot`)
  return cleared
}

// Berhenti memaksa jalan (pathfinder kadang berputar di tempat) lalu lompat
// supaya bot lepas dari blok yang menyangkut.
async function unstick (bot, options = {}) {
  try { bot.pathfinder?.stop?.() } catch {}
  try {
    bot.setControlState?.('jump', true)
    await sleep(180)
    bot.setControlState?.('jump', false)
  } catch {}
  if (options.clearLeaves !== false) {
    await clearLeavesAround(bot, options)
  }
}

// --- Drop di tanah -----------------------------------------------------
// Log yang sudah hancur jatuh sebagai item entity. inventory baru bertambah
// setelah bot mendekat, jadi drop harus diambil sebelum progres dihitung.

function droppedItemOf (entity) {
  try {
    if (typeof entity?.getDroppedItem === 'function') return entity.getDroppedItem()
  } catch {}
  return null
}

function nearbyDrops (bot, options = {}) {
  const self = bot?.entity?.position
  if (!self) return []
  const radius = Number(options.radius) || 16
  const ids = options.ids || null
  const out = []
  for (const entity of Object.values(bot.entities || {})) {
    if (!entity || !entity.position || entity === bot.entity) continue
    const item = droppedItemOf(entity)
    if (!item) continue
    if (ids && ids.size > 0) {
      const type = item.type ?? item.itemId ?? item.id
      if (type !== undefined && !ids.has(type)) continue
    }
    if (entity.position.distanceTo(self) > radius) continue
    out.push(entity)
  }
  return out.sort((a, b) => a.position.distanceTo(self) - b.position.distanceTo(self))
}

async function collectDrops (bot, mcData, options = {}) {
  const {
    itemNames = [],
    radius = 16,
    maxDrops = 32,
    perDropMs = 3000,
    timeoutMs = 20000,
    logger,
    cancellation
  } = options

  const ids = new Set()
  for (const name of itemNames) {
    if (!name) continue
    const id = mcData?.itemsByName?.[bareName(name)]?.id
    if (id !== undefined) ids.add(id)
  }

  if (typeof bot?.pathfinder?.goto !== 'function') return 0
  const deadline = Date.now() + timeoutMs
  let visited = 0

  while (visited < maxDrops && Date.now() < deadline) {
    cancellation?.throwIfCancelled?.()
    const drops = nearbyDrops(bot, { radius, ids })
    if (drops.length === 0) break
    const drop = drops[0]
    visited++
    try {
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0)),
        perDropMs,
        'Mengambil drop timeout'
      )
    } catch {
      // drop di tempat yang tidak terjangkau: lanjut ke drop berikutnya
    }
    await sleep(120)
  }

  if (visited > 0) logger?.debug?.(`Mengambil ${visited} drop di sekitar pohon`)
  return visited
}

// --- Menanam ulang ----------------------------------------------------
// Sapling ikut jatuh saat daun ditebang, jadi setelah satu pohon habis bot
// menanamnya kembali. Dark oak butuh 4 sapling dalam kotak 2x2 supaya tumbuh.

function trunkWidth (tree) {
  const blocks = tree?.blocks || []
  if (blocks.length === 0) return 1
  const base = Math.min(...blocks.map(pos => pos.y))
  const rings = blocks.filter(pos => pos.y === base)
  if (rings.length < 4) return 1
  const xs = new Set(rings.map(pos => pos.x))
  const zs = new Set(rings.map(pos => pos.z))
  return xs.size >= 2 && zs.size >= 2 ? 2 : 1
}

function plantGroups (bot, tree, options = {}) {
  const size = Number(options.size) || 1
  const radius = Number(options.radius) || 2
  const blocks = tree?.blocks || []
  if (blocks.length === 0 || typeof bot?.blockAt !== 'function') return []
  const baseY = Math.min(...blocks.map(pos => pos.y))
  const baseCells = blocks.filter(pos => pos.y === baseY)

  const groups = []
  const seen = new Set()
  for (const cell of baseCells) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const corner = cell.offset(dx, 0, dz)
        const key = `${corner.x},${corner.z}`
        if (seen.has(key)) continue
        seen.add(key)
        const cells = []
        let valid = true
        for (let ax = 0; ax < size && valid; ax++) {
          for (let az = 0; az < size && valid; az++) {
            const spot = corner.offset(ax, 0, az)
            const ground = bot.blockAt(spot.offset(0, -1, 0))
            if (!isSoil(ground)) { valid = false; break }
            if (!isPassableBlock(bot.blockAt(spot))) { valid = false; break }
            if (!isPassableBlock(bot.blockAt(spot.offset(0, 1, 0)))) { valid = false; break }
            cells.push({ ground, spot })
          }
        }
        if (valid && cells.length === size * size) groups.push(cells)
      }
    }
  }
  return groups
}

async function replantTree (bot, mcData, tree, itemName, options = {}) {
  const { logger, replantRadius = 2, walkTimeoutMs = 6000 } = options
  const saplingName = saplingNameFor(itemName)
  if (!saplingName) return { planted: 0, reason: 'no-sapling-type' }
  if (!mcData?.itemsByName?.[saplingName]) return { planted: 0, reason: 'no-sapling-type' }

  const size = trunkWidth(tree) === 2 ? 2 : 1
  const need = size * size
  const have = countItemName(bot, mcData, saplingName)
  if (have < need) return { planted: 0, sapling: saplingName, reason: 'not-enough-saplings' }

  const groups = plantGroups(bot, tree, { size, radius: replantRadius })
  if (groups.length === 0) return { planted: 0, sapling: saplingName, reason: 'no-soil' }

  let planted = 0
  const group = groups[0]
  for (const { ground, spot } of group) {
    const { findItemName } = require('../util/inventory')
    const item = findItemName(bot, mcData, saplingName)
    if (!item) break
    try {
      if (!inReach(bot, ground) && typeof bot.pathfinder?.goto === 'function') {
        await withTimeout(
          bot.pathfinder.goto(new goals.GoalNear(spot.x, spot.y, spot.z, 1)),
          walkTimeoutMs,
          'Menuju titik tanam timeout'
        )
      }
      await bot.equip(item, 'hand')
      await bot.placeBlock(ground, new Vec3(0, 1, 0))
      planted++
    } catch (err) {
      logger?.debug?.(`Gagal menanam sapling di ${blockKey(spot)}: ${err?.message || err}`)
      break
    }
  }

  if (planted > 0) {
    logger?.info(`Menanam ${planted} sapling ${saplingName} di bekas pohon ${tree.id}`)
  }
  return { planted, sapling: saplingName, size }
}

// Naik satu blok dengan menumpuk blok (dipakai kalau puncak pohon di luar
// jangkauan). Blok hasil tebangan sendiri boleh dipakai sebagai penopang.
async function climbOne (bot, mcData, options = {}) {
  let pillarUp
  try {
    ({ pillarUp } = require('../build/scaffold'))
  } catch {
    return { ok: false, reason: 'no-scaffold-module' }
  }
  if (typeof bot?.placeBlock !== 'function') return { ok: false, reason: 'no-place' }

  // Daun tepat di atas kepala menghalangi penumpukan blok (pillarUp melewati
  // kolom yang tidak kosong). Buka dulu supaya bot tetap bisa naik ke puncak.
  let leaves = 0
  if (options.clearLeaves !== false && typeof bot.blockAt === 'function') {
    const feet = bot.entity.position.floored()
    for (const dy of [1, 2]) {
      const block = bot.blockAt(feet.offset(0, dy, 0))
      if (!block || !isLeafName(block.name)) continue
      if (!inReach(bot, block)) continue
      const res = await mineBlock(bot, block, {
        logger: options.logger,
        digTimeoutMs: options.digTimeoutMs,
        walkTimeoutMs: options.walkTimeoutMs
      })
      if (res.ok) leaves++
    }
  }

  const targetY = bot.entity.position.y + 2
  try {
    const res = await pillarUp(bot, targetY, {
      mcData,
      candidates: options.scaffoldBlocks,
      cancellation: options.cancellation,
      logger: options.logger,
      maxBlocks: 2
    })
    const placed = res?.placed?.length || 0
    return { ok: placed > 0, placed, leaves, positions: res?.placed || [], reason: res?.reason }
  } catch (err) {
    return { ok: false, reason: err?.message || 'climb-failed' }
  }
}

// Tebang satu pohon dari atas ke bawah:
//   1. blok tertinggi yang sudah dalam jangkauan dihancurkan dulu,
//   2. kalau puncak masih di atas jangkauan, bot menumpuk 1 blok untuk mendekat,
//   3. kalau sisa blok ada di samping/bawah, bot berjalan ke posisi berdiri
//      terdekat yang masih bisa menjangkau blok itu.
async function chopTree (bot, mcData, tree, options = {}) {
  const {
    logger,
    cancellation,
    digTimeoutMs = 15000,
    walkTimeoutMs = 8000,
    maxBlocks = 512,
    maxFailures = 6,
    maxClimbs = 6,
    climb = true,
    removeScaffolds = false,
    clearLeaves = true,
    stuckMs = 20000,
    ownerId = null,
    claims = null
  } = options

  const stats = {
    chopped: 0,
    blocks: 0,
    climbs: 0,
    skipped: 0,
    leaves: 0,
    gone: 0,
    scaffolds: [],
    reason: null
  }
  if (!tree || !tree.blocks?.length) {
    stats.reason = 'empty-tree'
    return stats
  }

  let remaining = orderTopDown(tree.blocks, bot.entity.position)
  const failed = new Set()
  const leafTries = new Map()
  let lastProgressAt = Date.now()

  while (remaining.length > 0 && stats.blocks < maxBlocks) {
    cancellation?.throwIfCancelled?.()
    if (claims && ownerId) claims.renew(tree.id, ownerId)
    if (bot.health !== undefined && bot.health <= 0) {
      stats.reason = 'dead'
      break
    }

    // Blok yang sudah tidak ada (ditebang bot lain, atau ikut roboh) bukan
    // kegagalan. Dulu blok seperti ini tetap dianggap "masih ada di pohon",
    // jadi bot menunggu di satu tempat padahal lognya sudah jadi drop di tanah.
    const alive = remaining.filter(pos => {
      const found = bot.blockAt(pos)
      return !!found && isLogName(found.name)
    })
    if (alive.length !== remaining.length) {
      stats.gone += remaining.length - alive.length
      remaining = alive
      if (remaining.length === 0) break
    }

    // Bot tidak menebang apa pun dalam stuckMs: biasanya tersangkut di dalam
    // kanopi. Buka daun di sekitarnya, jangan berdiri diam sampai timeout.
    if (Date.now() - lastProgressAt > stuckMs) {
      stats.stuck = (stats.stuck || 0) + 1
      const cleared = await clearLeavesAround(bot, {
        logger, cancellation, digTimeoutMs, walkTimeoutMs, maxLeaves: 6
      })
      await unstick(bot, { clearLeaves: false })
      logger?.debug(`Bot tidak bergerak ${Math.round(stuckMs / 1000)}s di pohon ${tree.id}; membuka ${cleared} daun`)
      if (cleared === 0 && stats.stuck >= 2) {
        stats.reason = 'stuck'
        break
      }
      lastProgressAt = Date.now()
      continue
    }

    const reachable = remaining.find(pos => {
      if (failed.has(blockKey(pos))) return false
      const block = bot.blockAt(pos)
      return !!block && inReach(bot, block)
    })

    if (reachable) {
      const block = bot.blockAt(reachable)
      const key = blockKey(reachable)
      const dug = await mineBlock(bot, block, { logger, digTimeoutMs, walkTimeoutMs })
      if (dug.ok) {
        remaining = remaining.filter(pos => blockKey(pos) !== key)
        failed.delete(key)
        stats.blocks++
        stats.chopped++
        lastProgressAt = Date.now()
        continue
      }

      // Gagal menjangkau blok: penyebab tersering adalah daun kanopi yang
      // menutup jalan. Buka daun di garis pandang, lalu coba blok yang sama.
      const tries = leafTries.get(key) || 0
      if (clearLeaves && tries < 2) {
        leafTries.set(key, tries + 1)
        const cleared = await clearLeafPath(bot, block, {
          logger, cancellation, digTimeoutMs, walkTimeoutMs
        })
        if (cleared > 0) {
          stats.leaves += cleared
          lastProgressAt = Date.now()
          continue
        }
      }

      failed.add(key)
      stats.skipped++
      logger?.debug(`Gagal menebang ${reachable} (${dug.reason})`)
      if (failed.size >= maxFailures) {
        stats.reason = dug.reason || 'unreachable'
        break
      }
      await unstick(bot, { logger, cancellation, digTimeoutMs, walkTimeoutMs })
      continue
    }

    // Tidak ada blok yang bisa dijangkau sekarang.
    const highest = remaining.find(pos => !failed.has(blockKey(pos))) || remaining[0]
    const feetY = bot.entity.position.y
    if (climb && highest.y >= feetY + 4 && stats.climbs < maxClimbs) {
      const up = await climbOne(bot, mcData, { ...options, cancellation, logger })
      if (up.ok) {
        stats.climbs++
        stats.leaves += up.leaves || 0
        if (up.positions?.length) stats.scaffolds.push(...up.positions)
        logger?.debug(`Menumpuk ${up.placed} blok untuk mencapai puncak pohon di y=${highest.y}`)
        continue
      }
      if (up.reason) logger?.debug(`Tidak bisa naik ke puncak pohon: ${up.reason}`)
    }

    // Semua sisa blok ada di bawah bot (puncak sudah habis): turun dengan
    // membongkar scaffolding sendiri supaya batang bawah masuk jangkauan lagi.
    if (highest.y < feetY - 2 && stats.scaffolds.length > 0) {
      const feet = bot.entity.position.floored()
      const below = bot.blockAt(feet.offset(0, -1, 0))
      const belowKey = below ? blockKey(below.position) : null
      if (belowKey && stats.scaffolds.some(pos => blockKey(pos) === belowKey)) {
        const dug = await mineBlock(bot, below, { logger, digTimeoutMs, walkTimeoutMs })
        if (dug.ok) {
          stats.scaffolds = stats.scaffolds.filter(pos => blockKey(pos) !== belowKey)
          stats.descends = (stats.descends || 0) + 1
          await new Promise(resolve => setTimeout(resolve, 400))
          continue
        }
      }
    }

    // Berjalan ke blok tersisa berikutnya (mis. cabang yang agak jauh).
    const target = remaining.find(pos => !failed.has(blockKey(pos)))
    if (!target) {
      stats.reason = stats.reason || 'unreachable'
      break
    }

    const block = bot.blockAt(target)
    const dug = block
      ? await mineBlock(bot, block, { logger, digTimeoutMs, walkTimeoutMs })
      : { ok: false, reason: 'no-block' }

    if (dug.ok) {
      remaining = remaining.filter(pos => blockKey(pos) !== blockKey(target))
      failed.delete(blockKey(target))
      stats.blocks++
      stats.chopped++
      lastProgressAt = Date.now()
      continue
    }

    const targetKey = blockKey(target)
    if (clearLeaves && (leafTries.get(targetKey) || 0) < 2) {
      leafTries.set(targetKey, (leafTries.get(targetKey) || 0) + 1)
      const cleared = await clearLeafPath(bot, block || { position: target }, {
        logger, cancellation, digTimeoutMs, walkTimeoutMs
      })
      if (cleared > 0) {
        stats.leaves += cleared
        lastProgressAt = Date.now()
        continue
      }
    }
    failed.add(targetKey)
    stats.skipped++
    logger?.debug(`Gagal menebang ${target} (${dug.reason})`)
    if (failed.size >= maxFailures) {
      stats.reason = dug.reason || 'unreachable'
      break
    }
  }

  if (removeScaffolds && stats.scaffolds.length > 0) {
    try {
      const { removeTower } = require('../build/scaffold')
      await removeTower(bot, stats.scaffolds, { cancellation, logger })
    } catch (err) {
      logger?.debug(`Gagal membongkar scaffolding: ${err.message}`)
    }
  }

  if (!stats.reason && remaining.length > 0) stats.reason = 'partial'
  return stats
}

// Alur gather khusus kayu: cari pohon, klaim satu yang belum dipakai bot lain,
// tebang sampai habis, lalu lanjut ke pohon berikutnya sampai kuota terpenuhi.
async function gatherLogs (bot, mcData, materials, itemName, count, options = {}) {
  const {
    logger,
    cancellation,
    mineRadius = 64,
    mineYMin = -60,
    mineYMax = 320,
    protectOrigin = null,
    protectRadius = 8,
    maxMinePerJob = Infinity,
    minHealth = 6,
    tree = {},
    ownerId = null,
    claims = null
  } = options

  const before = countItemName(bot, mcData, itemName)
  if (before >= count) return { mined: 0, have: before }

  const block = mcData.blocksByName[bareName(itemName)]
  if (!block) return { mined: 0, reason: 'unknown-block' }
  const ids = [block.id]

  const registry = claims || sharedClaims()
  const owner = ownerId || bot.username || 'bot'
  const scanRadius = Number(tree.scanRadius) || mineRadius
  const scanCount = Number(tree.scanCount) || 512
  const maxEmpty = Number(tree.maxEmptyTrees) || 3
  const minSize = Number(tree.minTreeSize) || 1
  const maxTrees = Number(tree.maxTreesPerJob) || 64
  // Dirt/cobblestone lebih dulu supaya log hasil tebangan tidak dipakai sebagai
  // scaffolding (itu mengurangi hasil yang dilaporkan ke owner).
  const scaffoldBlocks = tree.scaffoldBlocks || ['dirt', 'cobblestone', 'stone', bareName(itemName)]

  if (typeof bot.pathfinder?.setMovements !== 'function') {
    logger?.debug('Pathfinder tidak siap; menebang hanya blok yang terjangkau')
  }

  const exclude = new Set()
  const maxRadius = Math.max(scanRadius, Number(tree.maxScanRadius) || 128)
  let radius = scanRadius
  let chopped = 0
  let choppedTrees = 0
  let emptyTrees = 0
  let collectedDrops = 0
  let replantedTrees = 0
  let plantedSaplings = 0
  let have = before
  let reason = null

  logger?.info(`Menebang kayu ${itemName}: butuh ${count - before} log, cari pohon dalam ${scanRadius} blok`)

  while (have < count && choppedTrees < maxTrees) {
    cancellation?.throwIfCancelled?.()

    if (bot.health !== undefined && bot.health < minHealth) {
      reason = 'low-health'
      break
    }
    if (materials && materials.minedCount >= maxMinePerJob) {
      reason = 'max-mine'
      break
    }
    if (bot.foodManager && typeof bot.foodManager.waitUntilReady === 'function') {
      if (!await bot.foodManager.waitUntilReady(cancellation)) {
        reason = 'no-food'
        break
      }
    }

    const trees = discoverTrees(bot, ids, {
      radius,
      count: scanCount,
      protectOrigin,
      protectRadius,
      mineYMin,
      mineYMax,
      exclude,
      gap: tree.gap,
      logger
    })

    if (trees.length === 0) {
      // Belum ada pohon dalam radius: perluas pencarian sebelum menyerah.
      if (radius < maxRadius) {
        radius = Math.min(maxRadius, Math.round(radius * 1.5))
        logger?.debug(`Tidak ada pohon dalam ${radius} blok, memperluas pencarian`)
        continue
      }
      reason = reason || 'not-found'
      break
    }

    const picked = pickTree(trees, { origin: bot.entity.position, claims: registry, ownerId: owner, minSize, exclude })
    if (!picked) {
      // Semua pohon di sekitar sedang dikerjakan bot lain: tunggu sebentar,
      // lalu pindai ulang (pohon bisa habis dan klaimnya dilepas).
      logger?.debug('Semua pohon di sekitar sedang diklaim bot lain; menunggu')
      await new Promise(resolve => setTimeout(resolve, Number(tree.waitMs) || 2000))
      radius = Math.min(maxRadius, Math.round(radius * 1.5))
      emptyTrees++
      if (emptyTrees >= maxEmpty) {
        reason = 'all-claimed'
        break
      }
      continue
    }

    const target = picked.tree
    if (!registry.claim(target.id, owner)) {
      exclude.add(target.id)
      continue
    }

    // Pohon bisa sudah dihabisi bot lain sejak pemindaian terakhir: buang blok
    // yang sudah hilang supaya tidak dihitung sebagai kegagalan menambang.
    const stillThere = target.blocks.filter(pos => {
      const found = bot.blockAt(pos)
      return found && isLogName(found.name)
    })
    if (stillThere.length === 0) {
      registry.release(target.id, owner)
      exclude.add(target.id)
      logger?.debug(`Pohon ${target.id} sudah habis; pindah ke pohon lain`)
      continue
    }
    const chopping = stillThere.length === target.blocks.length ? target : { ...target, blocks: stillThere, size: stillThere.length }

    logger?.info(`Bot ${owner} menebang pohon ${chopping.id} (${chopping.size} blok, tinggi ${chopping.height}, ${picked.distance.toFixed(1)} blok)`)

    const result = await chopTree(bot, mcData, chopping, {
      ...options,
      logger,
      cancellation,
      ownerId: owner,
      claims: registry,
      scaffoldBlocks,
      climb: tree.climb !== false,
      removeScaffolds: tree.removeScaffolds === true,
      clearLeaves: tree.clearLeaves !== false,
      stuckMs: Number(tree.stuckMs) || undefined,
      maxFailures: Number(tree.maxFailures) || undefined,
      maxClimbs: Number(tree.maxClimbs) || undefined
    })

    registry.release(target.id, owner)
    choppedTrees++
    chopped += result.chopped
    if (materials && typeof materials.minedCount === 'number') {
      materials.minedCount += result.blocks || 0
    }

    if (materials && typeof materials._ensureInventorySpace === 'function' &&
      typeof bot.inventory?.emptySlotCount === 'function' && bot.inventory.emptySlotCount() <= 0) {
      try {
        await materials._ensureInventorySpace(cancellation, { origin: protectOrigin })
      } catch (err) {
        logger?.warn(`Inventory penuh saat menebang: ${err.message}`)
        reason = 'inventory-full'
        break
      }
    }

    // Log yang hancur jatuh sebagai item di tanah. Tanpa diambil, inventory
    // tidak bertambah sehingga bot merasa masih kurang dan terus mencari pohon
    // baru sementara tumpukan log tertinggal di tanah.
    if (tree.collectDrops !== false) {
      const drops = await collectDrops(bot, mcData, {
        itemNames: [itemName, saplingNameFor(itemName)].filter(Boolean),
        radius: Number(tree.collectRadius) || 12,
        maxDrops: Number(tree.maxDrops) || 32,
        perDropMs: Number(tree.collectPerDropMs) || 3000,
        timeoutMs: Number(tree.collectTimeoutMs) || 20000,
        logger,
        cancellation
      })
      collectedDrops += drops
    }

    // Tanam kembali sapling di bekas pohon supaya hutan tidak habis.
    if (tree.replant !== false) {
      const replanted = await replantTree(bot, mcData, chopping, itemName, {
        logger,
        cancellation,
        replantRadius: Number(tree.replantRadius) || 2
      })
      if (replanted.planted > 0) {
        replantedTrees++
        plantedSaplings += replanted.planted
      } else if (result.chopped > 0) {
        logger?.debug(`Tidak menanam ulang pohon ${chopping.id}: ${replanted.reason}`)
      }
    }

    have = countItemName(bot, mcData, itemName)
    logger?.info(`Pohon ${chopping.id}: ${result.chopped} log ditebang, progres ${have}/${count}`)

    if (result.chopped === 0) {
      emptyTrees++
      exclude.add(target.id)
      if (emptyTrees >= maxEmpty) {
        reason = result.reason || 'unreachable'
        break
      }
    } else {
      emptyTrees = 0
    }
  }

  have = countItemName(bot, mcData, itemName)
  const out = {
    mined: have - before,
    have,
    blocks: chopped,
    trees: choppedTrees,
    drops: collectedDrops,
    replanted: replantedTrees,
    saplings: plantedSaplings
  }
  if (have < count && reason) out.reason = reason
  return out
}

module.exports = {
  isLogName,
  isLeafName,
  saplingNameFor,
  lineLeafBlocks,
  clearLeafPath,
  clearLeavesAround,
  unstick,
  nearbyDrops,
  collectDrops,
  plantGroups,
  trunkWidth,
  replantTree,
  blockKey,
  clusterLogs,
  summarizeTree,
  orderTopDown,
  TreeClaims,
  sharedClaims,
  resetSharedClaims,
  pickTree,
  discoverTrees,
  climbOne,
  chopTree,
  gatherLogs,
  REACH
}
