'use strict'

const minecraftProtocol = require('@wp2508/minecraft-protocol')
const https = require('https')

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

  const summary = message.replace(/\\s+/g, ' ').trim().slice(0, 900)
  const safeHost = config.host.replace(/`/g, '')
  const body = JSON.stringify({
    embeds: [{
      title: 'Falix Hosting Verification Required',
      description: 'The Minecraft hosting service is requesting verification to keep your server running.\n\n[**Open verification link**](' + url + ')',
      color: 0xF0B232,
      fields: [
        {
          name: 'Minecraft Server',
          value: '`' + safeHost + '`',
          inline: true
        },
        {
          name: 'Action Needed',
          value: 'Open the verification link above and complete the requested check.',
          inline: true
        },
        ...(summary ? [{
          name: 'Original Server Message',
          value: summary,
          inline: false
        }] : [])
      ],
      footer: {
        text: 'Solis AFK Bot • Verification Alerts'
      },
      timestamp: new Date().toISOString()
    }],
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

let activeClient = null
let reconnectTimer = null
let movementTimer = null
let shuttingDown = false
let movement = null

function newMovementState() {
  return {
    ready: false,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    baseY: 0,
    velocityY: 0,
    onGround: false,
    jumping: false,
    jumpKeyTicks: 0,
    tick: 0,
    lastSentTick: 0,
    lastSentX: 0,
    lastSentY: 0,
    lastSentZ: 0,
    lastSentOnGround: false,
    nextJumpAt: 0
  }
}

function randomJumpDelay() {
  return config.jumpMinMs + Math.floor(Math.random() * (config.jumpMaxMs - config.jumpMinMs + 1))
}

function relativeFlag(flags, axis, bit) {
  if (flags && typeof flags === 'object') return Boolean(flags[axis])
  return typeof flags === 'number' && Boolean(flags & bit)
}

function formatReason(reason) {
  if (reason == null) return 'no reason supplied'
  if (typeof reason === 'string') return reason
  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function stopMovement() {
  if (movementTimer) clearInterval(movementTimer)
  movementTimer = null
  if (movement) movement.ready = false
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, config.reconnectDelayMs)
}

function sendMovement(client, name) {
  client.write(name, {
    x: movement.x,
    y: movement.y,
    z: movement.z,
    yaw: movement.yaw,
    pitch: movement.pitch,
    onGround: movement.onGround,
    tick: movement.tick,
    flags: {
      onGround: movement.onGround,
      hasHorizontalCollision: false
    }
  })
}

function handleServerPosition(client, packet) {
  if (activeClient !== client || client.ended) return

  const flags = packet.flags
  const x = relativeFlag(flags, 'x', 1) ? movement.x + packet.x : packet.x
  const y = relativeFlag(flags, 'y', 2) ? movement.y + packet.y : packet.y
  const z = relativeFlag(flags, 'z', 4) ? movement.z + packet.z : packet.z
  const yaw = relativeFlag(flags, 'yaw', 8) ? movement.yaw + packet.yaw : packet.yaw
  const pitch = relativeFlag(flags, 'pitch', 16) ? movement.pitch + packet.pitch : packet.pitch

  if (![x, y, z, yaw, pitch].every(Number.isFinite)) {
    console.warn('Ignored a server position update with invalid coordinates.')
    return
  }

  movement.x = x
  movement.y = y
  movement.z = z
  movement.yaw = yaw
  movement.pitch = pitch
  movement.baseY = y
  movement.velocityY = 0
  movement.onGround = true
  movement.jumping = false
  movement.jumpKeyTicks = 0
  movement.nextJumpAt = Date.now() + randomJumpDelay()

  client.write('teleport_confirm', {
    teleportId: packet.teleportId,
    x,
    y,
    z,
    yaw,
    pitch
  })

  movement.lastSentX = x
  movement.lastSentY = y
  movement.lastSentZ = z
  movement.lastSentOnGround = false
  movement.lastSentTick = movement.tick
  sendMovement(client, 'position_look')

  if (!movement.ready) {
    movement.ready = true
    movementTimer = setInterval(() => tick(client), 50)
    console.log('Position synchronized. Low-memory AFK jumping is active.')
  }
}

function tick(client) {
  if (shuttingDown || activeClient !== client || client.ended || !movement?.ready || client.state !== 'play') return

  movement.tick++
  const now = Date.now()

  if (!movement.jumping && movement.onGround && now >= movement.nextJumpAt) {
    movement.jumping = true
    movement.onGround = false
    movement.velocityY = 0.42
    movement.jumpKeyTicks = 2
    movement.nextJumpAt = now + randomJumpDelay()
  }

  if (movement.jumping) {
    movement.y += movement.velocityY
    movement.velocityY = (movement.velocityY - 0.08) * 0.98
    if (movement.velocityY < 0 && movement.y <= movement.baseY) {
      movement.y = movement.baseY
      movement.velocityY = 0
      movement.jumping = false
      movement.onGround = true
    }
  }

  const jump = movement.jumpKeyTicks > 0
  if (movement.jumpKeyTicks > 0) movement.jumpKeyTicks--

  client.write('player_input', {
    inputs: {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump,
      shift: false,
      sprint: false
    }
  })

  const positionChanged = movement.x !== movement.lastSentX ||
    movement.y !== movement.lastSentY ||
    movement.z !== movement.lastSentZ ||
    movement.tick - movement.lastSentTick >= 20

  if (positionChanged) {
    sendMovement(client, 'position')
    movement.lastSentX = movement.x
    movement.lastSentY = movement.y
    movement.lastSentZ = movement.z
    movement.lastSentOnGround = movement.onGround
    movement.lastSentTick = movement.tick
  } else if (movement.onGround !== movement.lastSentOnGround) {
    client.write('flying', {
      onGround: movement.onGround,
      flags: {
        onGround: movement.onGround,
        hasHorizontalCollision: false
      }
    })
    movement.lastSentOnGround = movement.onGround
  }

  client.write('tick_end', {})
}

function connect() {
  if (shuttingDown || activeClient) return

  movement = newMovementState()
  console.log(`Connecting to ${config.host}:${config.port} as ${config.username} (Minecraft ${config.version})...`)

  let client
  try {
    client = minecraftProtocol.createClient({
      host: config.host,
      port: config.port,
      username: config.username,
      auth: 'offline',
      version: config.version,
      keepAlive: true,
      clientSettings: {
        locale: 'en_us',
        viewDistance: 2,
        chatFlags: 0,
        chatColors: false,
        skinParts: 0,
        enableTextFiltering: false,
        enableServerListing: false,
        particleStatus: 'minimal'
      }
    })
  } catch (error) {
    console.error('Could not start the connection:', error.message)
    scheduleReconnect()
    return
  }

  activeClient = client
  let thisClientReachedOnline = false
  client.on('playerJoin', () => {
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
    console.log('Login complete; waiting for initial position synchronization.')
  })
  for (const eventName of ['system_chat', 'player_chat', 'disguised_chat', 'profileless_chat', 'chat']) {
    client.on(eventName, handleChatAlert)
  }
  client.on('position', packet => handleServerPosition(client, packet))
  client.on('start_configuration', stopMovement)
  client.on('respawn', stopMovement)
  client.on('disconnect', packet => {
    console.warn('Server disconnected the bot:', formatReason(packet?.reason ?? packet))
  })
  client.on('error', error => {
    console.error('Connection error:', error.message || formatReason(error))
  })
  client.on('end', reason => {
    stopMovement()
    if (activeClient === client) activeClient = null
    console.warn(`Disconnected: ${formatReason(reason)}`)
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
        'The bot could not complete its initial connection to ' + config.host + ':' + config.port + '. The server may be stopped, starting, or temporarily unreachable. Connection attempts will continue.',
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
  stopMovement()
  clearTimeout(reconnectTimer)
  reconnectTimer = null

  const client = activeClient
  activeClient = null
  if (client) {
    try {
      client.end('AFK bot stopped')
    } catch (error) {
      console.error('Error while stopping:', error.message)
    }
  }

  console.log('AFK bot stopped.')
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

connect()
