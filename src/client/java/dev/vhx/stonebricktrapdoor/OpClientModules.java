package dev.vhx.stonebricktrapdoor;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import org.lwjgl.glfw.GLFW;

import java.util.LinkedHashMap;
import java.util.Map;

public final class OpClientModules implements ClientModInitializer {
    private static final Map<String, Boolean> MODULES = new LinkedHashMap<>();
    private static final double AURA_RANGE = 4.0;
    private static final double AIM_RANGE = 6.0;
    private static final int CLICKGUI_KEY = GLFW.GLFW_KEY_RIGHT_SHIFT;
    private static boolean wasGuiKeyDown;
    private static int attackDelay;
    private static int totemDelay;
    private static int waterDelay;
    private static int lastWaterSlot = -1;

    static {
        MODULES.put("Auto Totem", true);
        MODULES.put("Auto Water MLG", true);
        MODULES.put("KillAura", false);
        MODULES.put("AimAssist", false);
        MODULES.put("Triggerbot", false);
        MODULES.put("AutoClicker", false);
        MODULES.put("AntiKnockback", false);
    }

    @Override
    public void onInitializeClient() {
        ClientTickEvents.END_CLIENT_TICK.register(this::tick);
    }

    private void tick(Minecraft client) {
        boolean guiKeyDown = GLFW.glfwGetKey(client.getWindow().handle(), CLICKGUI_KEY) == GLFW.GLFW_PRESS;
        if (guiKeyDown && !wasGuiKeyDown && client.player != null) {
            client.setScreen(client.screen instanceof ModuleScreen ? null : new ModuleScreen());
        }
        wasGuiKeyDown = guiKeyDown;

        LocalPlayer player = client.player;
        if (player == null || client.level == null || client.gameMode == null || player.isRemoved()) {
            return;
        }
        if (client.screen != null) {
            return;
        }

        if (totemDelay > 0) totemDelay--;
        if (waterDelay > 0) waterDelay--;
        if (attackDelay > 0) attackDelay--;

        if (enabled("Auto Totem") && totemDelay == 0) {
            equipTotem(client, player);
            totemDelay = 5;
        }
        if (enabled("Auto Water MLG") && waterDelay == 0) {
            tryWaterClutch(client, player);
        }
        if (enabled("AntiKnockback") && player.hurtTime > 0) {
            Vec3 velocity = player.getDeltaMovement();
            player.setDeltaMovement(0.0, velocity.y, 0.0);
        }

        LivingEntity target = nearestTarget(client, player, enabled("KillAura") ? AURA_RANGE : AIM_RANGE);
        if (enabled("AimAssist") && target != null) {
            aimAt(player, target, 0.22f);
        }
        if (enabled("KillAura") && target != null && attackDelay == 0) {
            aimAt(player, target, 1.0f);
            client.gameMode.attack(player, target);
            player.swing(InteractionHand.MAIN_HAND);
            attackDelay = 10;
        }

        if (enabled("Triggerbot") && client.hitResult instanceof EntityHitResult hit
                && hit.getEntity() instanceof LivingEntity targetEntity
                && validTarget(player, targetEntity) && attackDelay == 0) {
            client.gameMode.attack(player, targetEntity);
            player.swing(InteractionHand.MAIN_HAND);
            attackDelay = 10;
        }

        if (enabled("AutoClicker") && client.options.keyAttack.isDown() && attackDelay == 0) {
            if (client.hitResult instanceof EntityHitResult hit && hit.getEntity() instanceof LivingEntity living
                    && validTarget(player, living)) {
                client.gameMode.attack(player, living);
                player.swing(InteractionHand.MAIN_HAND);
            } else if (client.hitResult instanceof BlockHitResult hit) {
                client.gameMode.attack(player, hit.getBlockPos());
                player.swing(InteractionHand.MAIN_HAND);
            }
            attackDelay = 2;
        }
    }

    private static boolean enabled(String name) {
        return Boolean.TRUE.equals(MODULES.get(name));
    }

    private void equipTotem(Minecraft client, LocalPlayer player) {
        if (player.getOffhandItem().is(Items.TOTEM_OF_UNDYING)) return;
        if (player.getHealth() > 8.0f && !player.getOffhandItem().isEmpty()) {
            return;
        }
        int inventorySlot = -1;
        for (int slot = 0; slot < player.getInventory().getContainerSize(); slot++) {
            ItemStack stack = player.getInventory().getItem(slot);
            if (stack.is(Items.TOTEM_OF_UNDYING)) {
                inventorySlot = slot;
                break;
            }
        }
        if (inventorySlot < 0) return;

        int menuSlot = inventorySlot < 9 ? inventorySlot + 36 : inventorySlot;
        client.gameMode.handleInventoryMouseClick(
                player.inventoryMenu.containerId, menuSlot, 40,
                net.minecraft.world.inventory.ClickType.SWAP, player
        );
    }

    private void tryWaterClutch(Minecraft client, LocalPlayer player) {
        if (player.onGround() || player.getDeltaMovement().y >= -0.55 || player.getFallDistance() < 3.0f) return;
        int bucketSlot = -1;
        for (int slot = 0; slot < 9; slot++) {
            if (player.getInventory().getItem(slot).is(Items.WATER_BUCKET)) {
                bucketSlot = slot;
                break;
            }
        }
        if (bucketSlot < 0) return;

        HitResult result = player.pick(5.0, 1.0f, false);
        if (!(result instanceof BlockHitResult blockHit)) return;
        lastWaterSlot = player.getInventory().getSelectedSlot();
        player.getInventory().setSelectedSlot(bucketSlot);
        client.gameMode.useItemOn(player, InteractionHand.MAIN_HAND, blockHit);
        waterDelay = 5;
    }

    private LivingEntity nearestTarget(Minecraft client, LocalPlayer player, double range) {
        LivingEntity nearest = null;
        double best = range * range;
        for (Entity entity : client.level.entitiesForRendering()) {
            if (!(entity instanceof LivingEntity living) || !validTarget(player, living)) continue;
            double distance = player.distanceToSqr(living);
            if (distance <= best) {
                best = distance;
                nearest = living;
            }
        }
        return nearest;
    }

    private boolean validTarget(LocalPlayer player, LivingEntity target) {
        return target != player && target.isAlive() && !target.isRemoved()
                && !target.isAlliedTo(player) && !target.isSpectator();
    }

    private void aimAt(LocalPlayer player, LivingEntity target, float strength) {
        Vec3 from = player.getEyePosition();
        Vec3 to = target.getBoundingBox().getCenter();
        double dx = to.x - from.x;
        double dy = to.y - from.y;
        double dz = to.z - from.z;
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        float desiredYaw = (float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0);
        float desiredPitch = (float) -Math.toDegrees(Math.atan2(dy, horizontal));
        player.setYRot(player.getYRot() + wrapDegrees(desiredYaw - player.getYRot()) * strength);
        player.setXRot(player.getXRot() + wrapDegrees(desiredPitch - player.getXRot()) * strength);
    }

    private float wrapDegrees(float value) {
        value %= 360.0f;
        if (value >= 180.0f) value -= 360.0f;
        if (value < -180.0f) value += 360.0f;
        return value;
    }

    private static final class ModuleScreen extends Screen {
        private ModuleScreen() {
            super(Component.literal("OP Client"));
        }

        @Override
        protected void init() {
            int buttonWidth = 190;
            int buttonHeight = 22;
            int x = (this.width - buttonWidth) / 2;
            int y = Math.max(35, (this.height - MODULES.size() * 27) / 2);
            for (String name : MODULES.keySet()) {
                addRenderableWidget(Button.builder(label(name), button -> {
                    MODULES.put(name, !enabled(name));
                    button.setMessage(label(name));
                }).bounds(x, y, buttonWidth, buttonHeight).build());
                y += 27;
            }
        }

        private Component label(String name) {
            return Component.literal((enabled(name) ? "[ON]  " : "[OFF] ") + name);
        }

        @Override
        public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            graphics.fill(0, 0, width, height, 0xC0101115);
            graphics.drawCenteredString(font, title, width / 2, 14, 0xFF55DDEE);
            super.render(graphics, mouseX, mouseY, partialTick);
            graphics.drawCenteredString(font, "Right Shift to close", width / 2, height - 18, 0xFFAAAAAA);
        }

        @Override
        public boolean isPauseScreen() {
            return false;
        }
    }
}
