'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadConfig } = require('../src/config')
const { resolveServer } = require('../src/bot')

function writeConfig (data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cfg-'))
  const file = path.join(dir, 'config.json')
  fs.writeFileSync(file, JSON.stringify(data))
  return { dir, file }
}

test('loadConfig allows omitting server.port and sets it to null', () => {
  const { dir, file } = writeConfig({
    server: { host: 'vivo-checker.tun.ply.gg' },
    bot: { username: 'Bot' },
    owner: { username: 'Owner' },
    auth: { enabled: false }
  })

  const config = loadConfig(file)
  assert.equal(config.server.host, 'vivo-checker.tun.ply.gg')
  assert.equal(config.server.port, null)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadConfig parses host:port syntax from host field', () => {
  const { dir, file } = writeConfig({
    server: { host: 'vivo-checker.tun.ply.gg:31555' },
    bot: { username: 'Bot' },
    owner: { username: 'Owner' },
    auth: { enabled: false }
  })

  const config = loadConfig(file)
  assert.equal(config.server.host, 'vivo-checker.tun.ply.gg')
  assert.equal(config.server.port, 31555)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('resolveServer uses explicit port when provided', async () => {
  const res = await resolveServer('example.com', 25565)
  assert.equal(res.host, 'example.com')
  assert.equal(res.port, 25565)
  assert.equal(res.srv, false)
})

test('resolveServer extracts port from host string with colon', async () => {
  const res = await resolveServer('play.example.com:19132', null)
  assert.equal(res.host, 'play.example.com')
  assert.equal(res.port, 19132)
  assert.equal(res.srv, false)
})

test('resolveServer resolves SRV record for live tunnel domain without port', async () => {
  const dns = require('dns').promises
  let isOffline = false
  try {
    await dns.resolveSrv('_minecraft._tcp.vivo-checker.tun.ply.gg')
  } catch {
    isOffline = true
  }

  if (isOffline) {
    const original = dns.resolveSrv
    dns.resolveSrv = async () => [{ name: 'vivo-checker.tun.ply.gg', port: 31555, priority: 0, weight: 0 }]
    try {
      const res = await resolveServer('vivo-checker.tun.ply.gg', null)
      assert.equal(res.host, 'vivo-checker.tun.ply.gg')
      assert.equal(res.port, 31555)
      assert.equal(res.srv, true)
    } finally {
      dns.resolveSrv = original
    }
    return
  }

  const res = await resolveServer('vivo-checker.tun.ply.gg', null)
  assert.equal(res.host, 'vivo-checker.tun.ply.gg')
  assert.equal(res.port, 31555)
  assert.equal(res.srv, true)
})

test('resolveServer falls back to 25565 for IP address or missing SRV', async () => {
  const res = await resolveServer('127.0.0.1', null)
  assert.equal(res.host, '127.0.0.1')
  assert.equal(res.port, 25565)
  assert.equal(res.srv, false)
})
