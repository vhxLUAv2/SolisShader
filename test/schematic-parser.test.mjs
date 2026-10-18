import assert from 'node:assert/strict'
import { Schematic } from 'nucleation'

const source = Schematic.create('solis-schematic-parser-smoke')
source.setBlockWithProperties(0, 0, 0, 'minecraft:oak_stairs', {
  JSON.stringify({ facing: 'east', half: 'bottom', shape: 'straight' })
)
source.setBlockWithNbt(
  1, 0, 0,
  'minecraft:chest[facing=south]',
  '{"Items":[{"Slot":0,"id":"minecraft:diamond","Count":3}]}'
)

const formats = [
  ['.litematic', source.toLitematicB64()],
  ['.schem', source.toSchematicB64()]
]

for (const [extension, base64] of formats) {
  const bytes = Buffer.from(base64, 'base64')
  assert.ok(bytes.length > 0, `Empty ${extension} export`)

  const loaded = Schematic.fromData(bytes)
  const blocks = loaded.blocks()
  const stairs = blocks.find(block => block.name === 'minecraft:oak_stairs')
  assert.ok(stairs, `Missing stairs after ${extension} round-trip`)
  assert.equal(String(stairs.properties.facing), 'east')
  assert.equal(String(stairs.properties.half), 'bottom')
  assert.equal(String(stairs.properties.shape), 'straight')

  const chestEntity = loaded.getAllBlockEntities().find(entity => {
    const position = entity.position
    return Array.isArray(position) && position[0] === 1 && position[1] === 0 && position[2] === 0
  })
  assert.ok(chestEntity, `Missing chest block entity after ${extension} round-trip`)
  assert.match(JSON.stringify(chestEntity.nbt), /minecraft:diamond/)
}

console.log('Schematic parser smoke test passed (.litematic, .schem, block states, chest NBT).')
