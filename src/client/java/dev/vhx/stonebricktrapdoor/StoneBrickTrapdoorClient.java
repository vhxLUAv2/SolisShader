package dev.vhx.stonebricktrapdoor;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

/**
 * Places a spruce trapdoor under a stone-brick block immediately above
 * the player's actual bounding box. Placement uses vanilla interaction logic,
 * so multiplayer servers receive an ordinary use-on-block interaction.
 */
public final class StoneBrickTrapdoorClient implements ClientModInitializer {
    private static final int SCAN_INTERVAL_TICKS = 3;
    private static final int PLACEMENT_COOLDOWN_TICKS = 20;
    private static final int RESTORE_SLOT_DELAY_TICKS = 3;
    private static final double HIT_FACE_EPSILON = 0.01;

    private int scanTicker;
    private int placementCooldown;
    private int restoreSlotDelay;
    private int slotBeforeSwitch = -1;
    private int trapdoorHotbarSlot = -1;

    @Override
    public void onInitializeClient() {
        ClientTickEvents.END_CLIENT_TICK.register(this::onClientTick);
    }

    private void onClientTick(Minecraft client) {
        LocalPlayer player = client.player;

        if (player == null || client.level == null || client.gameMode == null
                || player.isSpectator() || player.isRemoved()) {
            clearPendingSlotRestore();
            scanTicker = 0;
            placementCooldown = 0;
            return;
        }

        restorePreviousSlotWhenDue(player);

        // Do not interfere with inventory/container screens or chat.
        if (client.gui.screen() != null) {
            return;
        }

        if (placementCooldown > 0) {
            placementCooldown--;
        }
        if (++scanTicker < SCAN_INTERVAL_TICKS || placementCooldown > 0) {
            return;
        }
        scanTicker = 0;

        int hotbarSlot = findSpruceTrapdoorInHotbar(player);
        if (hotbarSlot < 0) {
            return;
        }

        /*
         * Use the player's bounding box rather than assuming their feet are
         * centered on a full block. Subtract a tiny epsilon so a head exactly
         * touching the ceiling still resolves to the block just below it.
         */
        BlockPos headCell = BlockPos.containing(
                player.getX(),
                player.getBoundingBox().maxY - 1.0E-4,
                player.getZ()
        );
        BlockPos stoneBrickPos = headCell.above();
        BlockState supportState = client.level.getBlockState(stoneBrickPos);

        if (!supportState.is(Blocks.STONE_BRICKS)
                || !supportState.isFaceSturdy(client.level, stoneBrickPos, Direction.DOWN)) {
            return;
        }

        BlockPos placementPos = stoneBrickPos.relative(Direction.DOWN);
        if (!client.level.getBlockState(placementPos).canBeReplaced()) {
            return;
        }

        int originalSlot = player.getInventory().getSelectedSlot();
        if (originalSlot != hotbarSlot) {
            player.getInventory().setSelectedSlot(hotbarSlot);
            slotBeforeSwitch = originalSlot;
            trapdoorHotbarSlot = hotbarSlot;
            restoreSlotDelay = RESTORE_SLOT_DELAY_TICKS;
        }

        // A point slightly inside the underside avoids an exact boundary hit.
        Vec3 undersideHit = new Vec3(
                stoneBrickPos.getX() + 0.5,
                stoneBrickPos.getY() + HIT_FACE_EPSILON,
                stoneBrickPos.getZ() + 0.5
        );
        BlockHitResult hit = new BlockHitResult(
                undersideHit,
                Direction.DOWN,
                stoneBrickPos,
                false
        );

        /*
         * Use the vanilla multiplayer interaction path. It syncs the selected
         * hotbar slot and sends the ordinary use-on-block packet to the server;
         * the server still validates placement and can reject it.
         */
        client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND, hit);
        placementCooldown = PLACEMENT_COOLDOWN_TICKS;
    }

    private int findSpruceTrapdoorInHotbar(LocalPlayer player) {
        for (int slot = 0; slot < 9; slot++) {
            if (player.getInventory().getItem(slot).is(Items.SPRUCE_TRAPDOOR)) {
                return slot;
            }
        }
        return -1;
    }

    private void restorePreviousSlotWhenDue(LocalPlayer player) {
        if (restoreSlotDelay <= 0) {
            return;
        }
        restoreSlotDelay--;
        if (restoreSlotDelay > 0) {
            return;
        }

        // Respect manual slot changes made by the player.
        if (slotBeforeSwitch >= 0
                && player.getInventory().getSelectedSlot() == trapdoorHotbarSlot) {
            player.getInventory().setSelectedSlot(slotBeforeSwitch);
        }
        clearPendingSlotRestore();
    }

    private void clearPendingSlotRestore() {
        restoreSlotDelay = 0;
        slotBeforeSwitch = -1;
        trapdoorHotbarSlot = -1;
    }
}
