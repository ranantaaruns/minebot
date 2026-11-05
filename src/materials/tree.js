'use strict'

const { countItemName } = require('../util/inventory')
const { mineBlock, inReach, REACH } = require('./dig')

const LOG_SUFFIX_RE = /_(log|wood|stem)$/

function bareName (name) {
  return String(name || '').replace(/^minecraft:/, '').toLowerCase()
}

function isLogName (name) {
  return LOG_SUFFIX_RE.test(bareName(name))
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
    return { ok: placed > 0, placed, positions: res?.placed || [], reason: res?.reason }
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
    ownerId = null,
    claims = null
  } = options

  const stats = { chopped: 0, blocks: 0, climbs: 0, skipped: 0, scaffolds: [], reason: null }
  if (!tree || !tree.blocks?.length) {
    stats.reason = 'empty-tree'
    return stats
  }

  let remaining = orderTopDown(tree.blocks, bot.entity.position)
  const failed = new Set()

  while (remaining.length > 0 && stats.blocks < maxBlocks) {
    cancellation?.throwIfCancelled?.()
    if (claims && ownerId) claims.renew(tree.id, ownerId)
    if (bot.health !== undefined && bot.health <= 0) {
      stats.reason = 'dead'
      break
    }

    const reachable = remaining.find(pos => {
      const block = bot.blockAt(pos)
      return block && inReach(bot, block)
    })

    if (reachable) {
      const block = bot.blockAt(reachable)
      const dug = await mineBlock(bot, block, { logger, digTimeoutMs, walkTimeoutMs })
      remaining = remaining.filter(pos => blockKey(pos) !== blockKey(reachable))
      if (dug.ok) {
        stats.blocks++
        stats.chopped++
      } else {
        failed.add(blockKey(reachable))
        stats.skipped++
        logger?.debug(`Gagal menebang ${reachable} (${dug.reason})`)
        if (failed.size >= maxFailures) {
          stats.reason = dug.reason || 'unreachable'
          break
        }
      }
      continue
    }

    // Tidak ada blok yang bisa dijangkau sekarang.
    const highest = remaining[0]
    const feetY = bot.entity.position.y
    if (climb && highest.y >= feetY + 4 && stats.climbs < maxClimbs) {
      const up = await climbOne(bot, mcData, { ...options, cancellation, logger })
      if (up.ok) {
        stats.climbs++
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
      stats.blocks++
      stats.chopped++
      continue
    }

    failed.add(blockKey(target))
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
  const out = { mined: have - before, have, blocks: chopped, trees: choppedTrees }
  if (have < count && reason) out.reason = reason
  return out
}

module.exports = {
  isLogName,
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
