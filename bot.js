'use strict'

const minecraftProtocol = require('@wp2508/minecraft-protocol')

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
  reconnectDelayMs: readInteger('RECONNECT_DELAY_SECONDS', 10, 1, 3600) * 1000
}

if (!config.host) throw new Error('MC_HOST must not be empty.')
if (!/^[A-Za-z0-9_]{3,16}$/.test(config.username)) {
  throw new Error('MC_USERNAME must contain 3–16 letters, numbers, or underscores.')
}
if (!config.version) throw new Error('MC_VERSION must not be empty.')
if (config.jumpMinMs > config.jumpMaxMs) {
  throw new Error('JUMP_MIN_SECONDS must be less than or equal to JUMP_MAX_SECONDS.')
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
  client.on('playerJoin', () => {
    console.log('Login complete; waiting for initial position synchronization.')
  })
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
