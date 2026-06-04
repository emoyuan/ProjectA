# Copilot Instructions for HoldOn

This is a Cocos Creator 3.8 TypeScript project. The playable game logic lives under `assets/script`, and the scene configuration is managed by the Cocos Creator editor rather than npm build scripts.

## Key architecture
- `assets/script/Player.ts`: central game logic, character IK, limb state, balance checks, hold/release rules, body side switching, and draw/update loop.
- `assets/script/UIController.ts`: input bridge for buttons, keyboard shortcuts, double-click semantics, and interaction with `Player`.
- `assets/script/Joystick.ts`: touch joystick handling, normalized direction, and thumb positioning.
- `assets/script/hold/HoldBase.ts`: unified hold interface with point/volume adsorption, release range, cooldown, and foot permissions.
- `assets/script/hold/HoldManager.ts`: scans child `HoldBase` components, manages cooldowns, and finds nearest valid hold.

## What matters most
- The game depends on Cocos component properties wired in the editor. Look for `@property(...)` declarations in `Player.ts`, `UIController.ts`, `Joystick.ts`, and hold classes.
- `Player` does not use a physics engine; it simulates limbs with a custom `BoneChain` solver and enforces rules in `moveActivePart()`, `releaseHoldAndCooldown()`, and `checkBalance()`.
- `HoldBase` distinguishes `HoldType.VOLUME` from point holds. Volume holds use rectangle projection and allow sliding; point holds use radius-based lock/release logic.
- Input flow is stateful: selected body part + joystick drag + keyboard buttons determine which limb moves or releases.
- `UIController` and `Player` share the selected part list: `['leftHand','rightHand','leftFoot','rightFoot','torso']`.

## Developer workflow
- There is no npm build/test pipeline in this repo. `package.json` is only Cocos project metadata.
- Use Cocos Creator editor to open the project and run `MainScene.scene`.
- VS Code task `Cocos Creator compile` triggers `curl http://localhost:7456/asset-db/refresh` to refresh the Cocos asset database.
- Debugging is done by launching Chrome against `http://localhost:7456` as configured in `.vscode/launch.json`.

## Patterns and conventions
- The game uses Cocos built-in `cc` module only; avoid adding unrelated npm dependencies unless the project explicitly requires them.
- Scene-linked behavior should be updated through component properties and node references, not by assuming hard-coded scene structure.
- Use `holdManager.startCooldown(...)` and `adsorbedHold` map updates when modifying hold/release behavior.
- Respect current side state (`leftSide`, `rightSide`, `front`) in `Player.trySetSide()` and `applySideConfiguration()`.

## Good first changes
- Follow existing style in `assets/script/*.ts`; there is no separate lint config beyond Cocos TypeScript compiler settings.
- Preserve the explicit handling of `EventTouch` and `KeyCode` logic in `UIController.ts`.
- Keep `Player.update()` as the single authoritative frame solver that calls `solveAllChains()`, `checkArmForceAngles()`, `checkBalance()`, and `drawCharacter()`.
