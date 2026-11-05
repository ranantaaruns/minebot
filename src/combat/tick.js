'use strict'

// Semua timing tempur memakai physicsTick server (20/detik), bukan setTimeout.
// setTimeout hanya jaring pengaman supaya bot tidak menggantung kalau server
// berhenti mengirim tick (mis. saat koneksi lambat).

function nextTick (bot, count = 1, timeoutMs = 1000) {
  return new Promise(resolve => {
    if (!bot?.on) return resolve()
    let left = Math.max(1, Math.floor(count))
    let timer = null
    const cleanup = () => {
      bot.removeListener('physicsTick', onTick)
      if (timer) clearTimeout(timer)
    }
    const onTick = () => {
      left -= 1
      if (left <= 0) { cleanup(); resolve() }
    }
    timer = setTimeout(() => { cleanup(); resolve() }, Math.max(60, Number(timeoutMs) || 1000))
    timer.unref?.()
    bot.on('physicsTick', onTick)
  })
}

// ID aksi start_fall_flying beda antar versi protokol
// (1.20.x = 5, 1.21.4 = 8, 1.21.11 = 6). Baca dari minecraft-data, jangan hardcode.
// Catatan: bot.elytraFly() bawaan mineflayer menulis 8 untuk 1.21.11 karena
// feature 'entityActionUsesStringMapper' tidak ada di data versi ini, jadi
// paket glide harus dikirim sendiri lewat startGlide().
function fallFlyingActionId (mcData) {
  try {
    const packet = mcData?.protocol?.play?.toServer?.types?.packet_entity_action
    const mapper = packet?.[1]?.[1]?.type?.[1]?.mappings
    for (const [id, name] of Object.entries(mapper || {})) {
      if (name === 'start_fall_flying' || name === 'start_elytra_flying') return Number(id)
    }
  } catch {}
  return 8
}

function startGlide (bot, mcData) {
  const entityId = bot?.entity?.id
  if (entityId === undefined) return false
  try {
    bot._client.write('entity_action', {
      entityId,
      actionId: fallFlyingActionId(mcData),
      jumpBoost: 0
    })
    return true
  } catch (err) {
    // Fallback: lompat lalu lepas-tekan jump lagi di udara (double jump)
    try {
      bot.setControlState('jump', true)
      bot.setControlState('jump', false)
    } catch {}
    return false
  }
}

module.exports = { nextTick, fallFlyingActionId, startGlide }
