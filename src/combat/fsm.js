'use strict'

// Tabel transisi murni: tanpa bot, tanpa timer, sehingga bisa diuji langsung.
const STATES = Object.freeze({
  IDLE: 'IDLE',
  LAUNCH: 'LAUNCH',
  SMASH: 'SMASH',
  BURST: 'BURST',
  FLY: 'FLY',
  CHARGE: 'CHARGE',
  CLUTCH: 'CLUTCH',
  SHIELD: 'SHIELD'
})

// Urutan prioritas: clutch > shield > smash > burst > fly > launch > charge.
const PRIORITY = Object.freeze([
  STATES.CLUTCH,
  STATES.SHIELD,
  STATES.SMASH,
  STATES.BURST,
  STATES.FLY,
  STATES.LAUNCH,
  STATES.CHARGE
])

const CHARGE_RANGE = 8

function nextState (state, ctx = {}) {
  if (ctx.targetAlive === false) return STATES.IDLE
  if (!Number.isFinite(ctx.distance)) return STATES.IDLE
  for (const candidate of PRIORITY) {
    switch (candidate) {
      case STATES.CLUTCH:
        if (ctx.clutch) return STATES.CLUTCH
        break
      case STATES.SHIELD:
        if (ctx.blocking) return STATES.SHIELD
        break
      case STATES.SMASH:
        if (ctx.smashable) return STATES.SMASH
        break
      case STATES.BURST:
        if (ctx.burst) return STATES.BURST
        break
      case STATES.FLY:
        if (ctx.elytraFlying && ctx.onGround !== true && ctx.distance > CHARGE_RANGE) return STATES.FLY
        break
      case STATES.LAUNCH:
        if (ctx.launchWindow && ctx.onGround === true) return STATES.LAUNCH
        break
      case STATES.CHARGE:
        if (canCharge(ctx)) return STATES.CHARGE
        break
      default:
        break
    }
  }
  return STATES.IDLE
}

function canCharge (ctx) {
  if (ctx.hasMace === false && ctx.hasElytra === false) return false
  if (ctx.elytraFlying) return ctx.distance <= CHARGE_RANGE * 2
  // Di udara tanpa glide: tetap kejar target supaya bisa meluncur/menukik.
  if (ctx.onGround !== true) return ctx.distance <= CHARGE_RANGE * 2.5
  // Di tanah: kejar sampai radius 3x, supaya elytra bisa dilepas landas.
  return ctx.distance <= CHARGE_RANGE * 3
}

function dist (a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function createContext ({ bot, target, fallDistance = 0, heightAbove = Infinity, blocking = false, launchWindow = false, smashable = false, burst = false, clutch = false } = {}) {
  const self = bot?.entity || {}
  const pos = self.position || { x: 0, y: 0, z: 0 }
  const items = (() => {
    try { return bot?.inventory?.items?.() || [] } catch { return [] }
  })()
  const has = name => items.some(it => String(it.name).replace(/^minecraft:/, '') === name)
  const count = name => items.reduce((s, it) => s + (String(it.name).replace(/^minecraft:/, '') === name ? (it.count || 1) : 0), 0)
  const tPos = target?.position
  const alive = target ? target.health === undefined || target.health > 0 : false
  return {
    onGround: self.onGround === true,
    elytraFlying: self.elytraFlying === true,
    velocityY: self.velocity?.y ?? 0,
    distance: tPos ? dist(pos, tPos) : Infinity,
    dy: tPos ? tPos.y - pos.y : 0,
    fallDistance,
    heightAbove,
    blocking,
    hasMace: has('mace'),
    hasElytra: has('elytra'),
    ammo: count('wind_charge'),
    fireworks: count('firework_rocket'),
    targetAlive: alive,
    launchWindow,
    smashable,
    burst,
    clutch
  }
}

module.exports = { nextState, STATES, PRIORITY, createContext, canCharge, CHARGE_RANGE }
