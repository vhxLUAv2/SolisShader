'use strict'

const mineflayer = require('@wp2508/mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const https = require('https')
const fs = require('fs')
const path = require('path')

const FARM_CROPS = {
  wheat: { blockName: 'wheat', itemName: 'wheat_seeds', maxAge: 7 },
  carrots: { blockName: 'carrots', itemName: 'carrot', maxAge: 7 },
  potatoes: { blockName: 'potatoes', itemName: 'potato', maxAge: 7 },
  beetroots: { blockName: 'beetroots', itemName: 'beetroot_seeds', maxAge: 3 }
}

const MAX_FARM_BLOCKS = 4096
const FARM_STATE_PATH = path.join(__dirname, '.farm-region.json')

function readInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return value
}

const config = {
  host: (process.env.MC_HOST || 'myawesomeserverwithf.falix.gg').trim(),
  port: readInteger('MC_PORT', 25565, 1, 65535),
  username: (process.env.MC_USERNAME || 'bot').trim(),
  ownerUsername: (process.env.MC_OWNER_USERNAME || '').trim(),
  farmCrop: (process.env.FARM_CROP || 'wheat').trim().toLowerCase(),
  version: (process.env.MC_VERSION || '26.3').trim(),
  jumpMinMs: readInteger('JUMP_MIN_SECONDS', 20, 1, 3600) * 1000,
  jumpMaxMs: readInteger('JUMP_MAX_SECONDS', 28, 1, 3600) * 1000,
  reconnectDelayMs: readInteger('RECONNECT_DELAY_SECONDS', 10, 1, 3600) * 1000,
  discordWebhookUrl: (process.env.DISCORD_WEBHOOK_URL || '').trim(),
  verificationWebhookUrl: (process.env.DISCORD_VERIFICATION_WEBHOOK_URL || '').trim()
}

if (!config.host) throw new Error('MC_HOST must not be empty.')
if (!/^[A-Za-z0-9_]{3,16}$/.test(config.username)) {
  throw new Error('MC_USERNAME must contain 3–16 letters, numbers, or underscores.')
}
if (!config.version) throw new Error('MC_VERSION must not be empty.')
if (config.ownerUsername && !/^[A-Za-z0-9_]{3,16}$/.test(config.ownerUsername)) {
  throw new Error('MC_OWNER_USERNAME must contain 3–16 letters, numbers, or underscores when set.')
}
if (!Object.prototype.hasOwnProperty.call(FARM_CROPS, config.farmCrop)) {
  throw new Error('FARM_CROP must be wheat, carrots, potatoes, or beetroots.')
}
if (config.jumpMinMs > config.jumpMaxMs) {
  throw new Error('JUMP_MIN_SECONDS must be less than or equal to JUMP_MAX_SECONDS.')
}


function parseDiscordWebhook(value, settingName) {
  if (!value) return null
  try {
    const parsedWebhook = new URL(value)
    if (
      parsedWebhook.protocol !== 'https:' ||
      !['discord.com', 'discordapp.com'].includes(parsedWebhook.hostname) ||
      !/^\/api\/webhooks\/\d+\/[^/]+\/?$/.test(parsedWebhook.pathname)
    ) {
      throw new Error('Invalid Discord webhook URL')
    }
    return parsedWebhook
  } catch {
    console.warn(settingName + ' disabled: it must be a valid HTTPS Discord webhook URL.')
    return null
  }
}

const discordWebhook = parseDiscordWebhook(config.discordWebhookUrl, 'DISCORD_WEBHOOK_URL')
const verificationWebhook = parseDiscordWebhook(config.verificationWebhookUrl, 'DISCORD_VERIFICATION_WEBHOOK_URL')
const alertedVerificationLinks = new Set()
let verificationPromptUntil = 0

function collectChatStrings(value, output, visited, depth = 0) {
  if (output.length >= 128 || depth > 12) return
  if (typeof value === 'string') {
    output.push(value.slice(0, 3000))
    return
  }
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || visited.has(value)) return

  visited.add(value)
  if (Array.isArray(value)) {
    for (const child of value) collectChatStrings(child, output, visited, depth + 1)
    return
  }

  for (const [key, child] of Object.entries(value)) {
    if (['signature', 'previousMessages', 'lastSeenMessages'].includes(key)) continue
    collectChatStrings(child, output, visited, depth + 1)
  }
}

function sendDiscordVerificationAlert(url, message) {
  if (alertedVerificationLinks.has(url)) return
  if (alertedVerificationLinks.size >= 100) {
    alertedVerificationLinks.delete(alertedVerificationLinks.values().next().value)
  }
  alertedVerificationLinks.add(url)

  if (!verificationWebhook) {
    console.warn('Falix verification link detected. Set DISCORD_VERIFICATION_WEBHOOK_URL to send it to a dedicated Discord channel: ' + url)
    return
  }

  const summary = message.replace(/\s+/g, ' ').slice(0, 600)
  const content = [
    '**Falix hosting verification detected**',
    'Minecraft server: ' + config.host,
    'Verification link: ' + url,
    summary ? 'In-game message: ' + summary : ''
  ].filter(Boolean).join('\n').slice(0, 1900)
  const body = JSON.stringify({
    content,
    allowed_mentions: { parse: [] }
  })

  const request = https.request({
    hostname: verificationWebhook.hostname,
    port: verificationWebhook.port || 443,
    path: verificationWebhook.pathname + verificationWebhook.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, response => {
    response.resume()
    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.warn('Discord webhook rejected the verification alert (HTTP ' + response.statusCode + ').')
      return
    }
    console.log('Forwarded Falix verification link to Discord.')
  })

  request.setTimeout(8000, () => request.destroy(new Error('Discord webhook timed out')))
  request.on('error', error => {
    console.warn('Discord webhook delivery failed: ' + error.message)
  })
  request.end(body)
}

function handleChatAlert(packet) {
  const parts = []
  collectChatStrings(packet, parts, new Set())
  const message = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (!message) return

  const verificationContext = /(falix|verif(?:y|ication)|captcha|add\s+time|extend.{0,30}timer|keep.{0,50}server.{0,30}running|server.{0,40}(?:stop|shutdown|suspend|expire))/i.test(message)
  if (verificationContext) verificationPromptUntil = Date.now() + 60000

  const urls = message.match(/https?:\/\/[^\s<>"']+/gi) || []
  for (const candidate of new Set(urls)) {
    const url = candidate.replace(/[.,!?;:)\]}]+$/, '')
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue

    const host = parsed.hostname.toLowerCase()
    const isFalixLink = host === 'falix.gg' ||
      host.endsWith('.falix.gg') ||
      host === 'falixnodes.net' ||
      host.endsWith('.falixnodes.net')

    if (isFalixLink || Date.now() <= verificationPromptUntil) {
      sendDiscordVerificationAlert(url, message)
    }
  }
}



let hasBeenOnline = false
let initialOfflineAlertSent = false

function sendDiscordServerStatus(title, details, color) {
  if (!discordWebhook) return

  const body = JSON.stringify({
    embeds: [{
      title: title.slice(0, 256),
      description: details.slice(0, 3500),
      color,
      timestamp: new Date().toISOString(),
      footer: { text: 'Solis AFK Bot · ' + config.host }
    }],
    allowed_mentions: { parse: [] }
  })

  const request = https.request({
    hostname: discordWebhook.hostname,
    port: discordWebhook.port || 443,
    path: discordWebhook.pathname + discordWebhook.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, response => {
    response.resume()
    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.warn('Discord server-status alert rejected (HTTP ' + response.statusCode + ').')
    }
  })

  request.setTimeout(8000, () => request.destroy(new Error('Discord webhook timed out')))
  request.on('error', error => {
    console.warn('Discord server-status alert failed: ' + error.message)
  })
  request.end(body)
}

const playerNamesByUuid = new Map()
const discordChatQueue = []
let discordChatTimer = null
let discordChatInFlight = false
let chatQueueOverflowWarned = false

function normalizeUuid(uuid) {
  return typeof uuid === 'string' ? uuid.replace(/-/g, '').toLowerCase() : ''
}

function readComponentText(value, depth = 0) {
  if (depth > 14 || value == null) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object') return readComponentText(parsed, depth + 1)
      } catch {}
    }
    return value
  }
  if (Array.isArray(value)) return value.map(child => readComponentText(child, depth + 1)).join('')
  if (typeof value !== 'object' || Buffer.isBuffer(value)) return ''

  if (typeof value.type === 'string' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    if (value.type === 'string') return typeof value.value === 'string' ? value.value : ''
    if (['byte', 'short', 'int', 'long', 'float', 'double', 'intArray', 'longArray'].includes(value.type)) return ''
    return readComponentText(value.value, depth + 1)
  }

  let output = ''
  if (value.text !== undefined) output += readComponentText(value.text, depth + 1)
  if (!output && value.player?.name !== undefined) output += readComponentText(value.player.name, depth + 1)
  for (const key of ['with', 'extra', 'content', 'message']) {
    if (value[key] !== undefined) output += readComponentText(value[key], depth + 1)
  }
  if (output) return output

  const ignored = new Set([
    'type', 'name', 'id', 'color', 'bold', 'italic', 'underlined', 'strikethrough',
    'obfuscated', 'font', 'insertion', 'clickEvent', 'hoverEvent', 'show_in_tooltip',
    'translate', 'fallback', 'score', 'selector', 'keybind', 'nbt', 'interpret', 'separator'
  ])
  for (const [key, child] of Object.entries(value)) {
    if (ignored.has(key)) continue
    output += readComponentText(child, depth + 1)
  }
  return output
}

function findPlayerSelector(value, depth = 0) {
  if (depth > 14 || value == null || typeof value !== 'object') return ''
  if (Array.isArray(value)) {
    for (const child of value) {
      const name = findPlayerSelector(child, depth + 1)
      if (name) return name
    }
    return ''
  }
  if (typeof value.type === 'string' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    return findPlayerSelector(value.value, depth + 1)
  }
  if (value.player?.name !== undefined) {
    const name = readComponentText(value.player.name).trim()
    if (name) return name
  }
  for (const [key, child] of Object.entries(value)) {
    if (['clickEvent', 'hoverEvent', 'style'].includes(key)) continue
    const name = findPlayerSelector(child, depth + 1)
    if (name) return name
  }
  return ''
}

function rememberPlayerNames(packet) {
  if (!Array.isArray(packet?.data)) return
  const action = packet.action
  const addsPlayer = action && typeof action === 'object'
    ? Boolean(action.add_player ?? action.addPlayer)
    : typeof action === 'number' && Boolean(action & 1)

  for (const entry of packet.data) {
    const uuid = normalizeUuid(entry?.uuid)
    const username = entry?.player?.name ?? entry?.profile?.name ?? entry?.username
    if (uuid && addsPlayer && typeof username === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(username)) {
      playerNamesByUuid.set(uuid, username)
    }
  }
  while (playerNamesByUuid.size > 500) {
    playerNamesByUuid.delete(playerNamesByUuid.keys().next().value)
  }
}

function forgetPlayerNames(packet) {
  if (!Array.isArray(packet?.players)) return
  for (const uuid of packet.players) playerNamesByUuid.delete(normalizeUuid(uuid))
}

function sendDiscordChat(username, message) {
  if (!discordWebhook || !username || !message) return
  const safeUsername = String(username).replace(/[\r\n]/g, '').slice(0, 32)
  const safeMessage = String(message).replace(/\u0000/g, '').trim().slice(0, 1650)
  if (!safeUsername || !safeMessage) return

  if (discordChatQueue.length >= 40) {
    if (!chatQueueOverflowWarned) {
      console.warn('Discord chat queue is full; further chat messages are temporarily being dropped.')
      chatQueueOverflowWarned = true
    }
    return
  }

  if (!/^[A-Za-z0-9_]{3,16}$/.test(safeUsername)) return

  discordChatQueue.push({
    username: safeUsername,
    avatar_url: 'https://mc-heads.net/avatar/' + encodeURIComponent(safeUsername) + '/64.png',
    content: safeMessage,
    allowed_mentions: { parse: [] }
  })
  pumpDiscordChatQueue()
}

function pumpDiscordChatQueue() {
  if (discordChatInFlight || discordChatTimer || !discordWebhook || discordChatQueue.length === 0) return
  discordChatTimer = setTimeout(() => {
    discordChatTimer = null
    const payload = discordChatQueue.shift()
    if (!payload) return

    discordChatInFlight = true
    const body = JSON.stringify(payload)
    let finished = false
    const finish = delay => {
      if (finished) return
      finished = true
      discordChatInFlight = false
      if (discordChatQueue.length < 20) chatQueueOverflowWarned = false
      if (discordChatQueue.length) {
        discordChatTimer = setTimeout(() => {
          discordChatTimer = null
          pumpDiscordChatQueue()
        }, delay)
      }
    }

    const request = https.request({
      hostname: discordWebhook.hostname,
      port: discordWebhook.port || 443,
      path: discordWebhook.pathname + discordWebhook.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, response => {
      response.resume()
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          console.warn('Discord chat forwarding failed (HTTP ' + response.statusCode + ').')
        }
        finish(response.statusCode === 429 ? 2000 : 650)
      })
    })

    request.setTimeout(8000, () => request.destroy(new Error('Discord webhook timed out')))
    request.on('error', error => {
      console.warn('Discord chat forwarding failed: ' + error.message)
      finish(1500)
    })
    request.end(body)
  }, 0)
}

function handlePlayerChat(packet) {
  if (typeof packet?.plainMessage !== 'string') return
  const uuid = normalizeUuid(packet.senderUuid)
  const username = playerNamesByUuid.get(uuid) ||
    readComponentText(packet.networkName ?? packet.senderName).trim()
  if (!username || username.toLowerCase() === config.username.toLowerCase()) return
  sendDiscordChat(username, packet.plainMessage)
}

function handleProfilelessChat(packet) {
  const username = readComponentText(packet?.name).trim()
  const message = readComponentText(packet?.message).trim()
  if (!username || !message) return
  sendDiscordChat(username, message)
}

function handleSystemPlayerChat(packet) {
  const username = findPlayerSelector(packet?.content)
  if (!username) return
  let message = readComponentText(packet.content).trim()
  const escapedName = username.replace(/[^A-Za-z0-9_]/g, '')
  if (!escapedName) return
  message = message.replace(new RegExp('^\\s*<?' + escapedName + '(?:>|:)\\s*'), '').trim()
  if (!message) return
  sendDiscordChat(username, message)
}

function handleLegacyPlayerChat(packet) {
  const text = readComponentText(packet?.message).trim()
  const match = text.match(/^<([A-Za-z0-9_]{3,16})>\s*(.+)$/s)
  if (match) sendDiscordChat(match[1], match[2])
}


let activeBot = null
let reconnectTimer = null
let afkJumpTimer = null
let jumpReleaseTimer = null
let shuttingDown = false

let farmArea = null
let selectedCrop = config.farmCrop
let farmEnabled = false
let farmSession = 0
let farmLoopBot = null
let farmLoopSession = 0
let farmSweepRow = 0
let farmSweepForward = true
const farmTargetCooldowns = new Map()
const recentlyForwardedChat = new Map()

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function safeBotChat(bot, message) {
  if (!bot || !bot.entity || bot !== activeBot) return
  try {
    bot.chat(String(message).slice(0, 240))
  } catch (error) {
    console.warn('Could not send an in-game status message: ' + error.message)
  }
}

function saveFarmState() {
  try {
    fs.writeFileSync(FARM_STATE_PATH, JSON.stringify({
      area: farmArea,
      crop: selectedCrop,
      enabled: farmEnabled
    }, null, 2) + '\n')
  } catch (error) {
    console.warn('Could not save farm settings: ' + error.message)
  }
}

function normalizeFarmArea(x1, y, z1, x2, z2) {
  const values = [x1, y, z1, x2, z2]
  if (!values.every(Number.isSafeInteger)) throw new Error('Farm coordinates must be whole numbers.')
  const minX = Math.min(x1, x2)
  const maxX = Math.max(x1, x2)
  const minZ = Math.min(z1, z2)
  const maxZ = Math.max(z1, z2)
  const areaSize = (maxX - minX + 1) * (maxZ - minZ + 1)
  if (!Number.isSafeInteger(areaSize) || areaSize > MAX_FARM_BLOCKS) {
    throw new Error('Farm area is too large. Limit it to ' + MAX_FARM_BLOCKS + ' crop blocks.')
  }
  if (y < -64 || y > 320) throw new Error('Crop Y coordinate must be between -64 and 320.')
  return { minX, maxX, minZ, maxZ, y }
}

function loadFarmState() {
  try {
    const state = JSON.parse(fs.readFileSync(FARM_STATE_PATH, 'utf8'))
    if (state.area) {
      farmArea = normalizeFarmArea(
        state.area.minX,
        state.area.y,
        state.area.minZ,
        state.area.maxX,
        state.area.maxZ
      )
    }
    if (typeof state.crop === 'string' && Object.prototype.hasOwnProperty.call(FARM_CROPS, state.crop)) {
      selectedCrop = state.crop
    }
    farmEnabled = Boolean(state.enabled && farmArea)
    console.log(farmArea
      ? 'Loaded saved farm area: ' + farmArea.minX + ',' + farmArea.y + ',' + farmArea.minZ +
        ' to ' + farmArea.maxX + ',' + farmArea.y + ',' + farmArea.maxZ
      : 'No farm area saved yet. Use #farm area to configure one.')
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not load saved farm settings: ' + error.message)
  }
}

function cropInfoForBlock(block) {
  if (!block) return null
  return Object.values(FARM_CROPS).find(crop => crop.blockName === block.name) || null
}

function cropAge(block) {
  if (!block) return -1
  let properties = {}
  if (typeof block.getProperties === 'function') {
    try {
      properties = block.getProperties() || {}
    } catch {}
  }
  const age = Number(properties.age ?? block.metadata ?? -1)
  return Number.isFinite(age) ? age : -1
}

function targetCooldownKey(target) {
  return target.kind + ':' + target.pos.x + ',' + target.pos.y + ',' + target.pos.z
}

function scanFarm(bot) {
  const targets = []
  let unknownBlocks = 0
  const now = Date.now()
  const items = bot.inventory.items()

  for (let x = farmArea.minX; x <= farmArea.maxX; x++) {
    for (let z = farmArea.minZ; z <= farmArea.maxZ; z++) {
      const pos = new Vec3(x, farmArea.y, z)
      const block = bot.blockAt(pos)
      if (!block) {
        unknownBlocks++
        continue
      }

      const crop = cropInfoForBlock(block)
      if (crop) {
        if (cropAge(block) >= crop.maxAge) {
          const target = { kind: 'harvest', pos, crop }
          if ((farmTargetCooldowns.get(targetCooldownKey(target)) || 0) <= now) targets.push(target)
        }
        continue
      }

      if (block.name !== 'air') continue
      const soil = bot.blockAt(pos.offset(0, -1, 0))
      if (!soil) {
        unknownBlocks++
        continue
      }
      if (soil.name !== 'farmland') continue

      const plantingCrop = FARM_CROPS[selectedCrop]
      if (items.some(item => item.name === plantingCrop.itemName)) {
        const target = { kind: 'plant', pos, crop: plantingCrop }
        if ((farmTargetCooldowns.get(targetCooldownKey(target)) || 0) <= now) targets.push(target)
      }
    }
  }

  const botPos = bot.entity.position
  targets.sort((a, b) => {
    const priority = (a.kind === 'harvest' ? 0 : 1) - (b.kind === 'harvest' ? 0 : 1)
    if (priority !== 0) return priority
    return botPos.distanceTo(a.pos) - botPos.distanceTo(b.pos)
  })
  return { targets, unknownBlocks }
}

function isFarmSessionCurrent(bot, session) {
  return !shuttingDown &&
    farmEnabled &&
    farmArea !== null &&
    activeBot === bot &&
    farmSession === session &&
    bot.entity != null
}

async function plantCropAt(bot, pos, crop) {
  const block = bot.blockAt(pos)
  const soil = bot.blockAt(pos.offset(0, -1, 0))
  if (!block || block.name !== 'air' || !soil || soil.name !== 'farmland') return false
  const seed = bot.inventory.items().find(item => item.name === crop.itemName)
  if (!seed) return false
  await bot.equip(seed, 'hand')
  await bot.placeBlock(soil, new Vec3(0, 1, 0))
  return true
}

function nextFarmSweepAnchor() {
  const rowZ = farmArea.minZ + farmSweepRow
  const x = farmSweepForward ? farmArea.minX : farmArea.maxX
  if (farmSweepRow >= farmArea.maxZ - farmArea.minZ) {
    farmSweepRow = 0
    farmSweepForward = !farmSweepForward
  } else {
    farmSweepRow++
  }
  return new Vec3(x, farmArea.y, rowZ)
}

async function runFarmLoop(bot, session) {
  let lastUnknownNotice = 0
  let lastSweepFailure = 0
  while (isFarmSessionCurrent(bot, session)) {
    const scan = scanFarm(bot)
    if (scan.targets.length === 0) {
      if (scan.unknownBlocks > 0) {
        const now = Date.now()
        if (now - lastUnknownNotice > 60000) {
          console.log('Some farm blocks are not loaded yet; moving through the plot to load more chunks.')
          lastUnknownNotice = now
        }
        try {
          const anchor = nextFarmSweepAnchor()
          await bot.pathfinder.goto(new goals.GoalNear(anchor.x, anchor.y, anchor.z, 1))
        } catch (error) {
          if (isFarmSessionCurrent(bot, session)) {
            const failureTime = Date.now()
            if (failureTime - lastSweepFailure > 30000) {
              console.warn('Farm scan movement failed: ' + error.message)
              lastSweepFailure = failureTime
            }
            await sleep(5000)
          }
        }
      } else {
        await sleep(2500)
      }
      continue
    }

    const target = scan.targets[0]
    const key = targetCooldownKey(target)
    try {
      await bot.pathfinder.goto(new goals.GoalBlock(target.pos.x, target.pos.y, target.pos.z))
      if (!isFarmSessionCurrent(bot, session)) break

      if (target.kind === 'harvest') {
        const block = bot.blockAt(target.pos)
        const crop = cropInfoForBlock(block)
        if (!crop || cropAge(block) < crop.maxAge) {
          farmTargetCooldowns.delete(key)
          continue
        }

        await bot.dig(block)
        await sleep(180)
        if (!isFarmSessionCurrent(bot, session)) break
        const replanted = await plantCropAt(bot, target.pos, crop)
        if (replanted) {
          console.log('Harvested and replanted ' + crop.blockName + ' at ' +
            target.pos.x + ',' + target.pos.y + ',' + target.pos.z)
        } else {
          console.log('Harvested ' + crop.blockName + ' at ' +
            target.pos.x + ',' + target.pos.y + ',' + target.pos.z +
            '; waiting for ' + crop.itemName + ' before replanting.')
        }
      } else {
        await plantCropAt(bot, target.pos, target.crop)
      }

      farmTargetCooldowns.delete(key)
      await sleep(250)
    } catch (error) {
      farmTargetCooldowns.set(key, Date.now() + 15000)
      console.warn('Farm action failed at ' + target.pos.x + ',' + target.pos.y + ',' +
        target.pos.z + ': ' + error.message)
      await sleep(1000)
    }
  }
}

function startFarmLoop(bot) {
  if (!farmEnabled || !farmArea || !bot || !bot.entity || activeBot !== bot || farmLoopBot === bot) return
  farmSession++
  const session = farmSession
  farmLoopBot = bot
  farmLoopSession = session
  if (afkJumpTimer) clearTimeout(afkJumpTimer)
  afkJumpTimer = null
  if (jumpReleaseTimer) clearTimeout(jumpReleaseTimer)
  jumpReleaseTimer = null
  try {
    bot.setControlState('jump', false)
    bot.setControlState('forward', false)
  } catch {}
  console.log('Crop farming started.')
  void runFarmLoop(bot, session).catch(error => {
    console.warn('Farm loop stopped after an error: ' + error.message)
  }).finally(() => {
    if (farmLoopBot === bot && farmLoopSession === session) farmLoopBot = null
    if (farmEnabled && activeBot && activeBot.entity && farmLoopBot !== activeBot) {
      startFarmLoop(activeBot)
    }
  })
}

function stopFarmLoop(bot) {
  farmSession++
  farmLoopBot = null
  if (bot && bot.pathfinder) {
    try {
      bot.pathfinder.stop()
    } catch {}
    try {
      bot.clearControlStates()
    } catch {}
  }
}

function enableFarm(bot) {
  if (!farmArea) {
    safeBotChat(bot, 'Set the crop plot first: #farm area <x1> <y> <z1> <x2> <z2>')
    return
  }
  farmEnabled = true
  saveFarmState()
  startFarmLoop(bot)
  safeBotChat(bot, 'Crop farming enabled. Use #farm status to check the plot.')
}

function handleFarmCommand(bot, username, message) {
  const trimmed = String(message || '').trim()
  if (!/^#farm(?:\s|$)/i.test(trimmed)) return false
  if (config.ownerUsername && username.toLowerCase() !== config.ownerUsername.toLowerCase()) return true

  const parts = trimmed.split(/\s+/)
  const action = (parts[1] || 'help').toLowerCase()
  if (action === 'area') {
    if (parts.length !== 7) {
      safeBotChat(bot, 'Usage: #farm area <x1> <y> <z1> <x2> <z2>')
      return true
    }
    const coords = parts.slice(2).map(Number)
    if (!coords.every(Number.isSafeInteger)) {
      safeBotChat(bot, 'Farm coordinates must be whole numbers.')
      return true
    }
    try {
      farmArea = normalizeFarmArea(coords[0], coords[1], coords[2], coords[3], coords[4])
      farmSweepRow = 0
      farmSweepForward = true
      farmTargetCooldowns.clear()
      farmEnabled = true
      saveFarmState()
      safeBotChat(bot, 'Farm plot saved (' + (farmArea.maxX - farmArea.minX + 1) + ' x ' +
        (farmArea.maxZ - farmArea.minZ + 1) + '). Farming started.')
      startFarmLoop(bot)
    } catch (error) {
      safeBotChat(bot, error.message)
    }
    return true
  }

  if (action === 'start') {
    enableFarm(bot)
    return true
  }

  if (action === 'stop') {
    farmEnabled = false
    saveFarmState()
    stopFarmLoop(bot)
    scheduleAfkJump(bot)
    safeBotChat(bot, 'Crop farming paused. Use #farm start to resume.')
    return true
  }

  if (action === 'crop') {
    const crop = (parts[2] || '').toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(FARM_CROPS, crop)) {
      safeBotChat(bot, 'Choose a crop: wheat, carrots, potatoes, or beetroots.')
      return true
    }
    selectedCrop = crop
    saveFarmState()
    safeBotChat(bot, 'Empty farmland will be planted with ' + crop + '.')
    return true
  }

  if (action === 'status') {
    const areaText = farmArea
      ? 'x=' + farmArea.minX + '..' + farmArea.maxX + ', y=' + farmArea.y +
        ', z=' + farmArea.minZ + '..' + farmArea.maxZ
      : 'not set'
    safeBotChat(bot, 'Farm ' + (farmEnabled ? 'running' : 'paused') +
      '; area: ' + areaText + '; empty plots: ' + selectedCrop + '.')
    return true
  }

  safeBotChat(bot, 'Commands: #farm area <x1> <y> <z1> <x2> <z2> | #farm start | #farm stop | #farm crop <wheat|carrots|potatoes|beetroots> | #farm status')
  return true
}

function forwardPlayerChat(bot, username, message) {
  if (!username || username.toLowerCase() === config.username.toLowerCase()) return
  const safeMessage = String(message || '').trim()
  if (!safeMessage) return

  const key = username + '\u0000' + safeMessage
  const now = Date.now()
  const previous = recentlyForwardedChat.get(key)
  if (previous && now - previous < 2000) return
  recentlyForwardedChat.set(key, now)
  if (recentlyForwardedChat.size > 100) {
    for (const [chatKey, timestamp] of recentlyForwardedChat) {
      if (now - timestamp > 10000) recentlyForwardedChat.delete(chatKey)
      if (recentlyForwardedChat.size <= 80) break
    }
  }

  const isFarmCommand = handleFarmCommand(bot, username, safeMessage)
  if (!isFarmCommand) sendDiscordChat(username, safeMessage)
}

function randomJumpDelay() {
  return config.jumpMinMs + Math.floor(Math.random() * (config.jumpMaxMs - config.jumpMinMs + 1))
}

function scheduleAfkJump(bot) {
  if (afkJumpTimer) clearTimeout(afkJumpTimer)
  afkJumpTimer = null
  if (shuttingDown || farmEnabled || !bot || !bot.entity || activeBot !== bot) return

  afkJumpTimer = setTimeout(() => {
    afkJumpTimer = null
    if (activeBot === bot && !farmEnabled && bot.entity) {
      try {
        bot.setControlState('jump', true)
        if (jumpReleaseTimer) clearTimeout(jumpReleaseTimer)
        jumpReleaseTimer = setTimeout(() => {
          jumpReleaseTimer = null
          if (activeBot === bot && bot.entity) {
            try {
              bot.setControlState('jump', false)
            } catch {}
          }
        }, 250)
      } catch {}
    }
    scheduleAfkJump(bot)
  }, randomJumpDelay())
}

function formatReason(reason) {
  if (reason == null) return 'no reason supplied'
  if (typeof reason === 'string') return reason
  try {
    if (typeof reason.toString === 'function') {
      const text = reason.toString()
      if (text && text !== '[object Object]') return text
    }
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, config.reconnectDelayMs)
}

function connect() {
  if (shuttingDown || activeBot) return
  console.log('Connecting to ' + config.host + ':' + config.port + ' as ' +
    config.username + ' (Minecraft ' + config.version + ')...')

  let bot
  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      auth: 'offline',
      version: config.version,
      keepAlive: true,
      checkTimeoutInterval: 30000,
      viewDistance: 4,
      hideErrors: true
    })
    bot.loadPlugin(pathfinder)
  } catch (error) {
    console.error('Could not start the connection: ' + error.message)
    scheduleReconnect()
    return
  }

  activeBot = bot
  let thisClientReachedOnline = false

  bot.on('spawn', () => {
    if (activeBot !== bot) return
    if (!thisClientReachedOnline) {
      thisClientReachedOnline = true
      const wasOnlineBefore = hasBeenOnline
      const wasUnreachable = initialOfflineAlertSent
      const title = wasOnlineBefore || wasUnreachable
        ? 'Minecraft Server Back Online'
        : 'Minecraft Server Online'
      const details = wasOnlineBefore || wasUnreachable
        ? 'The bot successfully connected again after a previous disconnect. This may indicate a server restart or a temporary network interruption.'
        : 'The bot connected successfully to ' + config.host + ':' + config.port + '.'
      sendDiscordServerStatus(title, details, 0x57F287)
      hasBeenOnline = true
      initialOfflineAlertSent = false
    }

    try {
      const movements = new Movements(bot, bot.registry)
      movements.canDig = false
      bot.pathfinder.setMovements(movements)
      bot.settings.viewDistance = 4
      bot.settings.particleStatus = 'minimal'
    } catch (error) {
      console.warn('Could not configure pathfinding: ' + error.message)
    }

    console.log('Connected and spawned. Use #farm help in Minecraft chat.')
    if (farmEnabled && farmArea) startFarmLoop(bot)
    else scheduleAfkJump(bot)
  })

  bot.on('death', () => {
    farmSession++
    if (farmLoopBot === bot) farmLoopBot = null
    try {
      bot.pathfinder.stop()
      bot.clearControlStates()
    } catch {}
  })

  bot.on('message', message => {
    const text = message && typeof message.toString === 'function'
      ? message.toString()
      : String(message || '')
    if (text) handleChatAlert(text)
    const match = text.match(/^<([A-Za-z0-9_]{3,16})>\s*(.+)$/s)
    if (match) forwardPlayerChat(bot, match[1], match[2])
  })

  bot.on('chat', (username, message) => {
    forwardPlayerChat(bot, username, message)
  })

  bot.on('whisper', (username, message) => {
    handleFarmCommand(bot, username, message)
  })

  bot.on('kicked', reason => {
    console.warn('Server disconnected the bot:', formatReason(reason))
  })

  bot.on('error', error => {
    console.error('Connection error:', error.message || formatReason(error))
  })

  bot.on('end', reason => {
    if (afkJumpTimer) clearTimeout(afkJumpTimer)
    if (jumpReleaseTimer) clearTimeout(jumpReleaseTimer)
    afkJumpTimer = null
    jumpReleaseTimer = null
    farmSession++
    if (farmLoopBot === bot) farmLoopBot = null
    try {
      bot.pathfinder.stop()
      bot.clearControlStates()
    } catch {}
    if (activeBot === bot) activeBot = null

    console.warn('Disconnected: ' + formatReason(reason))
    if (!shuttingDown && thisClientReachedOnline) {
      sendDiscordServerStatus(
        'Minecraft Server Offline / Connection Lost',
        'The active Minecraft connection ended. The server may have been stopped or restarted, or there may be a network interruption. The bot will keep trying to reconnect.',
        0xED4245
      )
      initialOfflineAlertSent = true
    } else if (!shuttingDown && !hasBeenOnline && !initialOfflineAlertSent) {
      sendDiscordServerStatus(
        'Minecraft Server Unreachable',
        'The bot could not complete its initial connection to ' + config.host + ':' + config.port +
          '. The server may be stopped, starting, or temporarily unreachable. Connection attempts will continue.',
        0xFEE75C
      )
      initialOfflineAlertSent = true
    }
    scheduleReconnect()
  })
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  saveFarmState()
  if (afkJumpTimer) clearTimeout(afkJumpTimer)
  if (jumpReleaseTimer) clearTimeout(jumpReleaseTimer)
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  stopFarmLoop(activeBot)

  const bot = activeBot
  activeBot = null
  if (bot) {
    try {
      bot.quit('AFK farm bot stopped')
    } catch (error) {
      console.error('Error while stopping: ' + error.message)
    }
  }
  console.log('Bot stopped.')
}

loadFarmState()
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
connect()
