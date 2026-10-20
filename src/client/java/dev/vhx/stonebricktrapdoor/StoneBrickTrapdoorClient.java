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

/** Automatically place a spruce trapdoor under overhead stone-brick blocks. */
public final class StoneBrickTrapdoorClient implements ClientModInitializer {
    private static final int SCAN_INTERVAL_TICKS = 3;
    private static final int PLACEMENT_COOLDOWN_TICKS = 8;
    private static final int RESTORE_SLOT_DELAY_TICKS = 2;

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

        // In 26.2 the active screen is exposed through Minecraft.gui.
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

        BlockPos playerPos = player.blockPosition();
        BlockPos stoneBrickPos = playerPos.above(2);
        BlockState supportState = client.level.getBlockState(stoneBrickPos);
        if (!supportState.is(Blocks.STONE_BRICKS)) {
            return;
        }

        if (!supportState.isFaceSturdy(client.level, stoneBrickPos, Direction.DOWN)) {
            return;
        }

        BlockPos placementPos = stoneBrickPos.below();
        BlockState placementState = client.level.getBlockState(placementPos);
        if (!placementState.canBeReplaced()) {
            return;
        }

        int originalSlot = player.getInventory().getSelectedSlot();
        if (originalSlot != hotbarSlot) {
            player.getInventory().setSelectedSlot(hotbarSlot);
            slotBeforeSwitch = originalSlot;
            trapdoorHotbarSlot = hotbarSlot;
            restoreSlotDelay = RESTORE_SLOT_DELAY_TICKS;
        }

        Vec3 undersideCenter = new Vec3(
                stoneBrickPos.getX() + 0.5,
                stoneBrickPos.getY(),
                stoneBrickPos.getZ() + 0.5
        );
        BlockHitResult hit = new BlockHitResult(
                undersideCenter,
                Direction.DOWN,
                stoneBrickPos,
                false
        );

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
