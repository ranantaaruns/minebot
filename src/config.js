'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULTS = {
  server: {
    host: '127.0.0.1',
    port: null,
    version: null,
    brand: 'vanilla'
  },
  bot: {
    username: 'BuilderBot',
    auth: 'offline'
  },
  physics: {
    paperCollisionFix: true,
    playerHalfWidth: 0.30001,
    playerHeight: 1.80001
  },
  auth: {
    enabled: true,
    password: '',
    registerCommand: '/register {password} {password}',
    loginCommand: '/login {password}',
    registerPatterns: ['register', 'daftar', 'reg'],
    loginPatterns: ['login', 'masuk', 'log in'],
    alreadyRegisteredPatterns: ['already registered', 'sudah terdaftar', 'sudah register'],
    loggedInPatterns: ['successfully logged in', 'berhasil login', 'you are now logged in', 'login successful'],
    proactiveLogin: true,
    proactiveLoginDelayMs: 3000,
    attemptDelayMs: 2500,
    maxAttempts: 6
  },
  owner: {
    username: '',
    autoFollow: true,
    followDistance: 3,
    stuckTimeoutMs: 4000,
    maxStuckRetries: 2,
    stuckCooldownMs: 10000,
    unstickJump: true,
    askCoords: false,
    askCoordsIntervalMs: 60000,
    allowTower: true,
    towerBlocks: ['dirt', 'grass_block', 'cobblestone', 'oak_planks', 'scaffolding'],
    towerPlaceCost: 40,
    towerGather: {
      enabled: true,
      item: 'dirt',
      preferredBlocks: ['grass_block', 'dirt'],
      radius: 32,
      protectRadius: 6,
      reserve: 8,
      minGap: 2,
      maxPerAttempt: 32,
      maxAttempts: 3,
      cooldownMs: 30000,
      timeoutMs: 120000,
      allowHandMining: true
    },
    swim: {
      enabled: true,
      liquidCost: 12,
      updateMs: 250,
      timeoutMs: 120000,
      shoreStrafeAfterMs: 2000,
      strafeMs: 800,
      approachFromShore: true,
      approachScanDistance: 16,
      approachTimeoutMs: 4000
    },
    navigation: {
      surfaceBias: true,
      verticalThreshold: 4,
      maxDescent: 2,
      coverScanHeight: 4
    }
  },
  combat: {
    enabled: true,
    autoArmor: true,
    attackRange: 3.5,
    detectRadius: 8,
    maxPursueDistance: 6,
    attackCooldownMs: 650,
    defendTimeoutMs: 12000,
    pvp: {
      enabled: true,
      tickMs: 50,
      smashRange: 3.2,
      minFall: 1.5,
      clutchMinFall: 3,
      clutchHeight: 1.8,
      chargeRange: 12,
      flyRange: 15,
      leadTicks: 1,
      maxChains: 3
    },
    hunt: {
      meleeRange: 3.2,
      bowRange: 24,
      drawMs: 1000,
      drawMarginMs: 80,
      aimHeightRatio: 0.5,
      aimLeadTicks: 2,
      tickMs: 250,
      timeoutMs: 180000,
      retreatEnabled: true,
      retreatHealth: 10,
      retreatResumeHealth: 16,
      retreatDistance: 12,
      retreatTickMs: 200,
      retreatFleeTimeoutMs: 15000,
      retreatZigzagDeg: 35,
      retreatZigzagMs: 400,
      critEnabled: true,
      critTickMs: 20,
      critRiseTimeoutMs: 250,
      critFallTimeoutMs: 500,
      shieldBreakEnabled: true,
      shieldBreakPunishMs: 5000,
      shieldBreakWindowMs: 1500
    },
    shield: {
      enabled: true,
      blockRange: 4.5,
      predictMs: 400,
      approachWindow: 2.5,
      refreshMs: 900,
      face: true
    }
  },
  storage: {
    enabled: true,
    radius: 32,
    minFreeSlots: 2,
    clearObstructions: true,
    containers: ['chest', 'trapped_chest', 'barrel', 'shulker_box']
  },
  gamemode: {
    enabled: true,
    command: '/gamemode {mode}',
    buildMode: 'creative',
    restoreAfterBuild: true,
    switchTimeoutMs: 3000
  },
  build: {
    maxVolume: 200000,
    reach: 4.2,
    placeDelayMs: 120,
    retryLimit: 3,
    maxPasses: 4,
    anchor: 'bot',
    removeScaffolds: false,
    scaffold: {
      enabled: true,
      blocks: ['dirt', 'cobblestone', 'oak_planks', 'scaffolding']
    },
    biomeMaterials: {
      enabled: true,
      askOwner: true,
      allowCustomAlternative: true,
      reminderMs: 30000,
      pickupRadius: 8,
      ownerSupplyTimeoutMs: 0
    }
  },
  gather: {
    enabled: true,
    chestRadius: 32,
    mineRadius: 64,
    protectRadius: 8,
    maxMinePerJob: 1024,
    mineYMin: -60,
    mineYMax: 160,
    maxDepth: 8,
    preferChests: true,
    clearChestObstructions: true,
    clearHeight: 3,
    digTimeoutMs: 15000,
    walkTimeoutMs: 8000,
    maxStalled: 5,
    preferCaves: true,
    caveRadius: 48,
    caveTravelTimeoutMs: 60000,
    caveMinOreDistance: 16,
    tree: {
      enabled: true,
      scanRadius: 48,
      maxScanRadius: 128,
      scanCount: 512,
      maxEmptyTrees: 3,
      maxTreesPerJob: 64,
      minTreeSize: 4,
      waitMs: 2000,
      gap: 1,
      climb: true,
      removeScaffolds: false,
      clearLeaves: true,
      stuckMs: 20000,
      collectDrops: true,
      collectRadius: 12,
      collectPerDropMs: 3000,
      collectTimeoutMs: 20000,
      maxDrops: 32,
      replant: true,
      replantRadius: 2,
      maxFailures: 6,
      maxClimbs: 6
    }
  },
  safety: {
    autoEat: true,
    eatThreshold: 16,
    criticalFood: 6,
    eatCheckIntervalMs: 2000,
    eatRetryMs: 4000,
    noFoodAction: 'stop',
    pauseMovementWhileEating: true,
    preventDrowning: true,
    lava: {
      enabled: true,
      checkIntervalMs: 250,
      dangerRadius: 8,
      escapeTimeoutMs: 2500,
      cooldownMs: 1500
    },
    minHealth: 6,
    arrowDodge: {
      enabled: true,
      detectRange: 16,
      drawRange: 20,
      dodgeMs: 220,
      cooldownMs: 500,
      tickMs: 80,
      radius: 0.55,
      ticks: 40
    },
    pauseOnDeath: false,
    antiAfk: false,
    antiAfkIntervalMs: 45000
  },
  nether: {
    portalFollow: true,
    portalWaitTimeoutMs: 20000,
    avoidStructures: true,
    structureAvoidRadius: 48,
    minHealth: 10,
    targetDebrisY: 14,
    wearGoldInNether: true
  },
  connection: {
    reconnect: true,
    reconnectDelayMs: 5000,
    maxReconnectDelayMs: 60000
  },
  logging: {
    debug: false,
    chat: true
  },
  swarm: {
    staggerDelayMs: 1500,
    deliverOnGather: true,
    tossDistance: 2.5,
    gatherRounds: 2
  }
}

function isObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function merge (base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base }
  if (!isObject(override)) return out
  for (const [key, value] of Object.entries(override)) {
    if (isObject(value) && isObject(out[key])) {
      out[key] = merge(out[key], value)
    } else if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}

function validate (config) {
  const errors = []
  if (!config.server.host || typeof config.server.host !== 'string') {
    errors.push('server.host wajib diisi')
  }
  if (config.server.port !== null && config.server.port !== undefined && config.server.port !== '') {
    const p = Number(config.server.port)
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      errors.push('server.port harus angka 1-65535')
    }
  }
  if (!config.bot.username || typeof config.bot.username !== 'string') {
    errors.push('bot.username wajib diisi')
  }
  if (!config.owner.username || config.owner.username === 'NamaKamu') {
    errors.push('owner.username wajib diisi dengan username Minecraft Anda')
  }
  if (!Number.isFinite(Number(config.physics.playerHalfWidth)) || Number(config.physics.playerHalfWidth) <= 0) {
    errors.push('physics.playerHalfWidth harus angka lebih dari 0')
  }
  if (!Number.isFinite(Number(config.physics.playerHeight)) || Number(config.physics.playerHeight) <= 0) {
    errors.push('physics.playerHeight harus angka lebih dari 0')
  }
  if (!Number.isFinite(Number(config.owner.stuckTimeoutMs)) || Number(config.owner.stuckTimeoutMs) <= 0) {
    errors.push('owner.stuckTimeoutMs harus angka lebih dari 0')
  }
  if (!Number.isInteger(Number(config.owner.maxStuckRetries)) || Number(config.owner.maxStuckRetries) < 0) {
    errors.push('owner.maxStuckRetries harus bilangan bulat 0 atau lebih')
  }
  if (!Number.isFinite(Number(config.owner.stuckCooldownMs)) || Number(config.owner.stuckCooldownMs) < 0) {
    errors.push('owner.stuckCooldownMs harus angka 0 atau lebih')
  }
  if (!Array.isArray(config.owner.towerBlocks) || config.owner.towerBlocks.length === 0) {
    errors.push('owner.towerBlocks harus berisi minimal satu nama block')
  }
  if (!Number.isFinite(Number(config.owner.towerPlaceCost)) || Number(config.owner.towerPlaceCost) < 0) {
    errors.push('owner.towerPlaceCost harus angka 0 atau lebih')
  }
  if (!isObject(config.owner.towerGather)) {
    errors.push('owner.towerGather harus berupa object')
  } else {
    if (!Array.isArray(config.owner.towerGather.preferredBlocks)) {
      errors.push('owner.towerGather.preferredBlocks harus berupa array')
    }
    for (const key of ['radius', 'protectRadius', 'reserve', 'minGap', 'maxPerAttempt', 'maxAttempts', 'cooldownMs', 'timeoutMs']) {
      const value = Number(config.owner.towerGather[key])
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`owner.towerGather.${key} harus angka 0 atau lebih`)
      }
    }
  }
  if (!isObject(config.owner.swim)) {
    errors.push('owner.swim harus berupa object')
  } else {
    for (const key of ['liquidCost', 'updateMs', 'timeoutMs', 'shoreStrafeAfterMs', 'strafeMs', 'approachScanDistance', 'approachTimeoutMs']) {
      const value = Number(config.owner.swim[key])
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`owner.swim.${key} harus angka 0 atau lebih`)
      }
    }
    for (const key of ['updateMs', 'timeoutMs', 'strafeMs', 'approachScanDistance', 'approachTimeoutMs']) {
      if (Number(config.owner.swim[key]) <= 0) {
        errors.push(`owner.swim.${key} harus lebih dari 0`)
      }
    }
  }
  if (!isObject(config.owner.navigation)) {
    errors.push('owner.navigation harus berupa object')
  } else {
    for (const key of ['verticalThreshold', 'maxDescent', 'coverScanHeight']) {
      const value = Number(config.owner.navigation[key])
      if (!Number.isInteger(value) || value < 0) {
        errors.push(`owner.navigation.${key} harus bilangan bulat 0 atau lebih`)
      }
    }
  }
  if (!isObject(config.combat)) {
    errors.push('combat harus berupa object')
  } else {
    for (const key of ['attackRange', 'detectRadius', 'maxPursueDistance', 'attackCooldownMs', 'defendTimeoutMs']) {
      const value = Number(config.combat[key])
      if (!Number.isFinite(value) || value <= 0) {
        errors.push(`combat.${key} harus lebih dari 0`)
      }
    }
    if (!isObject(config.combat.pvp)) {
      errors.push('combat.pvp harus berupa object')
    } else {
      for (const key of ['tickMs', 'smashRange', 'minFall', 'clutchMinFall', 'clutchHeight', 'chargeRange', 'flyRange', 'leadTicks']) {
        const value = Number(config.combat.pvp[key])
        if (!Number.isFinite(value) || value <= 0) {
          errors.push(`combat.pvp.${key} harus lebih dari 0`)
        }
      }
    }
    if (!isObject(config.combat.hunt)) {
      errors.push('combat.hunt harus berupa object')
    } else {
      for (const key of ['meleeRange', 'bowRange', 'drawMs', 'drawMarginMs', 'aimHeightRatio', 'aimLeadTicks', 'tickMs', 'timeoutMs']) {
        const value = Number(config.combat.hunt[key])
        if (!Number.isFinite(value) || value <= 0) {
          errors.push(`combat.hunt.${key} harus lebih dari 0`)
        }
      }
    }
  }
  if (!isObject(config.storage)) {
    errors.push('storage harus berupa object')
  } else {
    if (!Number.isInteger(Number(config.storage.minFreeSlots)) || Number(config.storage.minFreeSlots) < 0) {
      errors.push('storage.minFreeSlots harus bilangan bulat 0 atau lebih')
    }
    if (!Number.isFinite(Number(config.storage.radius)) || Number(config.storage.radius) <= 0) {
      errors.push('storage.radius harus lebih dari 0')
    }
    if (!Array.isArray(config.storage.containers) || config.storage.containers.length === 0) {
      errors.push('storage.containers harus berisi minimal satu nama blok')
    }
  }
  if (config.gamemode !== undefined && config.gamemode !== null) {
    if (!isObject(config.gamemode)) {
      errors.push('gamemode harus berupa object')
    } else {
      if (config.gamemode.buildMode !== undefined && config.gamemode.buildMode !== null) {
        const bm = String(config.gamemode.buildMode).toLowerCase()
        if (!['creative', 'survival', 'auto'].includes(bm)) {
          errors.push('gamemode.buildMode harus "creative", "survival", "auto", atau null')
        }
      }
      if (config.gamemode.switchTimeoutMs !== undefined && (!Number.isFinite(Number(config.gamemode.switchTimeoutMs)) || Number(config.gamemode.switchTimeoutMs) <= 0)) {
        errors.push('gamemode.switchTimeoutMs harus angka lebih dari 0')
      }
    }
  }
  if (!isObject(config.build.biomeMaterials)) {
    errors.push('build.biomeMaterials harus berupa object')
  } else {
    for (const key of ['reminderMs', 'pickupRadius', 'ownerSupplyTimeoutMs']) {
      const value = Number(config.build.biomeMaterials[key])
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`build.biomeMaterials.${key} harus angka 0 atau lebih`)
      }
    }
  }
  if (!isObject(config.gather)) {
    errors.push('gather harus berupa object')
  } else {
    if (!Number.isInteger(Number(config.gather.clearHeight)) || Number(config.gather.clearHeight) < 0) {
      errors.push('gather.clearHeight harus bilangan bulat 0 atau lebih')
    }
    if (!Number.isInteger(Number(config.gather.chestRadius)) || Number(config.gather.chestRadius) <= 0) {
      errors.push('gather.chestRadius harus bilangan bulat lebih dari 0')
    }
  }
  if (!isObject(config.safety)) {
    errors.push('safety harus berupa object')
  } else {
    for (const key of ['eatThreshold', 'criticalFood']) {
      const value = Number(config.safety[key])
      if (!Number.isInteger(value) || value < 0 || value > 20) {
        errors.push(`safety.${key} harus bilangan bulat 0-20`)
      }
    }
    if (Number(config.safety.criticalFood) > Number(config.safety.eatThreshold)) {
      errors.push('safety.criticalFood tidak boleh lebih besar dari safety.eatThreshold')
    }
    for (const key of ['eatCheckIntervalMs', 'eatRetryMs']) {
      const value = Number(config.safety[key])
      if (!Number.isFinite(value) || value <= 0) {
        errors.push(`safety.${key} harus lebih dari 0`)
      }
    }
    if (!['stop', 'continue'].includes(config.safety.noFoodAction)) {
      errors.push('safety.noFoodAction harus "stop" atau "continue"')
    }
  }
  if (config.auth.enabled) {
    if (!config.auth.password || config.auth.password === 'GANTI_PASSWORD_INI') {
      errors.push('auth.password wajib diisi')
    }
    if (!config.auth.registerCommand.includes('{password}') && !config.auth.loginCommand.includes('{password}')) {
      errors.push('auth.registerCommand/loginCommand harus mengandung {password}')
    }
  }
  if (config.nether && typeof config.nether.targetDebrisY === 'number') {
    if (config.nether.targetDebrisY < 0 || config.nether.targetDebrisY > 120) {
      errors.push('nether.targetDebrisY harus antara 0 dan 120')
    }
  }
  if (config.swarm) {
    if (!Number.isFinite(Number(config.swarm.staggerDelayMs)) || Number(config.swarm.staggerDelayMs) < 0) {
      errors.push('swarm.staggerDelayMs harus angka 0 atau lebih')
    }
  }
  return errors
}

function loadConfig (configPath) {
  const ROOT = path.resolve(__dirname, '..')
  const file = configPath
    ? path.resolve(configPath)
    : path.join(ROOT, 'config.json')

  if (!fs.existsSync(file)) {
    const example = path.join(ROOT, 'config.example.json')
    const hint = fs.existsSync(example)
      ? `Salin dulu: cp "${example}" "${file}" lalu edit isinya.`
      : 'Buat config.json berdasarkan config.example.json.'
    const err = new Error(`File config tidak ditemukan: ${file}. ${hint}`)
    err.code = 'CONFIG_MISSING'
    throw err
  }

  let userConfig
  try {
    userConfig = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`config.json tidak valid: ${err.message}`)
  }

  const config = merge(DEFAULTS, userConfig)

  if (typeof config.server?.host === 'string' && config.server.host.includes(':') && !config.server.host.startsWith('[')) {
    const [h, p] = config.server.host.split(':')
    config.server.host = h.trim()
    if (!config.server.port && p) {
      config.server.port = Number(p.trim())
    }
  }

  if (config.server.port !== null && config.server.port !== undefined && config.server.port !== '' && config.server.port !== 'auto') {
    config.server.port = Number(config.server.port)
  } else {
    config.server.port = null
  }
  config.physics.playerHalfWidth = Number(config.physics.playerHalfWidth)
  config.physics.playerHeight = Number(config.physics.playerHeight)
  config.owner.followDistance = Number(config.owner.followDistance)
  config.owner.stuckTimeoutMs = Number(config.owner.stuckTimeoutMs)
  config.owner.maxStuckRetries = Number(config.owner.maxStuckRetries)
  config.owner.stuckCooldownMs = Number(config.owner.stuckCooldownMs)
  config.owner.towerPlaceCost = Number(config.owner.towerPlaceCost)
  if (isObject(config.owner.towerGather)) {
    for (const key of ['radius', 'protectRadius', 'reserve', 'minGap', 'maxPerAttempt', 'maxAttempts', 'cooldownMs', 'timeoutMs']) {
      config.owner.towerGather[key] = Number(config.owner.towerGather[key])
    }
  }
  if (isObject(config.owner.swim)) {
    for (const key of ['liquidCost', 'updateMs', 'timeoutMs', 'shoreStrafeAfterMs', 'strafeMs', 'approachScanDistance', 'approachTimeoutMs']) {
      config.owner.swim[key] = Number(config.owner.swim[key])
    }
  }
  if (isObject(config.owner.navigation)) {
    for (const key of ['verticalThreshold', 'maxDescent', 'coverScanHeight']) {
      config.owner.navigation[key] = Number(config.owner.navigation[key])
    }
  }
  if (isObject(config.combat)) {
    for (const key of ['attackRange', 'detectRadius', 'maxPursueDistance', 'attackCooldownMs', 'defendTimeoutMs']) {
      config.combat[key] = Number(config.combat[key])
    }
    if (isObject(config.combat.pvp)) {
      for (const key of ['tickMs', 'smashRange', 'minFall', 'clutchMinFall', 'clutchHeight', 'chargeRange', 'flyRange', 'leadTicks']) {
        config.combat.pvp[key] = Number(config.combat.pvp[key])
      }
    }
    if (isObject(config.combat.hunt)) {
      for (const key of ['meleeRange', 'bowRange', 'drawMs', 'drawMarginMs', 'aimHeightRatio', 'aimLeadTicks', 'tickMs', 'timeoutMs']) {
        config.combat.hunt[key] = Number(config.combat.hunt[key])
      }
    }
  }
  if (isObject(config.storage)) {
    config.storage.radius = Number(config.storage.radius)
    config.storage.minFreeSlots = Number(config.storage.minFreeSlots)
  }
  if (isObject(config.gamemode) && config.gamemode.switchTimeoutMs !== undefined) {
    config.gamemode.switchTimeoutMs = Number(config.gamemode.switchTimeoutMs)
  }
  if (isObject(config.build?.biomeMaterials)) {
    for (const key of ['reminderMs', 'pickupRadius', 'ownerSupplyTimeoutMs']) {
      config.build.biomeMaterials[key] = Number(config.build.biomeMaterials[key])
    }
  }
  if (isObject(config.gather)) {
    config.gather.chestRadius = Number(config.gather.chestRadius)
    config.gather.clearHeight = Number(config.gather.clearHeight)
  }
  if (isObject(config.safety)) {
    for (const key of ['eatThreshold', 'criticalFood', 'eatCheckIntervalMs', 'eatRetryMs']) {
      config.safety[key] = Number(config.safety[key])
    }
  }
  if (config.server.version === 'auto' || config.server.version === '') config.server.version = null

  const errors = validate(config)
  if (errors.length) {
    const err = new Error(`Config belum lengkap:\n- ${errors.join('\n- ')}`)
    err.code = 'CONFIG_INVALID'
    throw err
  }

  config.__file = file
  return config
}

module.exports = { loadConfig, validate, merge, DEFAULTS }
