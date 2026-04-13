# Ultimate Ability System — Design Doc

Status: **Partially implemented.** Infrastructure complete (Phase A). First real
ultimate (Sergei — Frenzy) is implemented and wired. See BUILD_LOG.md for details.

## Goals
- One long-cooldown, spectacular ability per critter
- Clear identity — no ulti should feel like a bigger version of the normal abilities
- Fits cleanly into the existing ability system without a refactor
- Presented in character select so the player knows what they're picking

## Non-goals
- No new resource system (no mana, no meter filled by damage). The ulti is just a long-CD ability.
- No cinematic cutscene. The ulti is still a one-shot effect in gameplay time.
- No per-ulti unique input schemes.

---

## Technical structure — minimal changes to current architecture

### Reuse existing ability infrastructure
The current ability system already supports:
- Per-critter definitions via `CRITTER_ABILITIES[name]: AbilityDef[]`
- Different ability types via `AbilityType` union
- Wind-up, duration, cooldown, active state, effectFired tracking
- HUD rendering from an array

**The ulti is just a third slot in the per-critter ability array.** No new runtime types required.

### Changes needed

**1. `AbilityDef` gains one optional flag**

```ts
export interface AbilityDef {
  // ... existing fields ...
  isUltimate?: boolean;   // true for the third slot per critter
}
```

The HUD uses this flag to render the ulti slot differently. The update loop doesn't care — it ticks cooldowns and fires effects identically.

**2. Extend `AbilityType` with new variants as needed**

```ts
export type AbilityType =
  | 'charge_rush'
  | 'ground_pound'
  | 'rampage'           // NEW: Rojo ulti
  | 'phantom_strike'    // NEW: Azul ulti
  | 'titan_slam'        // NEW: Verde ulti
  | 'glass_storm';      // NEW: Morado ulti
```

Each new type gets an entry in `EFFECT_MAP` pointing to its fire function, same pattern as existing.

**3. Each critter's ability array grows to length 3**

```ts
Rojo: [
  makeChargeRush(),
  makeGroundPound(),
  makeRampage(),           // ulti
],
// ... same for Azul/Verde/Morado
```

`createAbilityStates(critterName)` already maps over the array — works unchanged.

### Impact on existing systems
- **`critter.ts`**: no changes. Ability states come from the factory.
- **`physics.ts`**: no changes. Collisions don't care about ulti.
- **`bot.ts`**: bots can use ultis with a simple probability gate (same pattern as ability1 / ability2 but lower chance, higher range).
- **`player.ts`**: adds one more `isHeld('ultimate')` check that calls `activateAbility(states[2], critter)`.
- **`input.ts`**: adds `ultimate` to the `HeldAction` union and maps `KeyL` to it.
- **`hud.ts`**: the ability bar HUD already renders from the array — auto-renders 3 slots. The ulti slot gets a distinct CSS class via the `isUltimate` flag.

**Total new code**: ~150 lines for 4 ultis (≈35 lines each) + ~20 lines wiring = manageable.

---

## Input

### Desktop
- **Key: `L`**
- Lives next to J and K in the home row on QWERTY. Natural extension of the existing right-hand action cluster.
- `input.ts` adds:
  ```ts
  _setHeld('ultimate', !!keyState['KeyL']);
  ```
  and `HeldAction` union becomes `'headbutt' | 'ability1' | 'ability2' | 'ultimate'`.

### Mobile
- 4th touch button added to the existing 3-button cluster.
- Smaller but visually louder: a circular button with a **golden border** that pulses slowly when ready, greyed out on cooldown.
- Position: above the headbutt button (vertical offset), so the thumb doesn't accidentally hit it during normal combat.

### Activation rules (same for all ultis)
- Only activates if `cooldownLeft <= 0 && !active` (existing `canActivateAbility`)
- Immunity blocks activation (just like headbutt)
- Falling blocks activation (already handled by the ability update loop)

---

## HUD

### Match HUD — new ulti slot
The existing `#ability-bar-container` already renders any number of abilities. The third slot is just one more `.ability-slot`, but with a distinct look:

- **Size**: 1.3× bigger than regular ability slots
- **Key label**: `[L]` in gold, slightly larger
- **Name label**: ulti name (e.g. "RAMPAGE") in uppercase, gold color
- **Fill bar**: radial circular fill instead of linear bar. Fills from empty to full over the cooldown.
- **Ready state**: the entire slot pulses (soft golden glow, 1.2s loop) when ready
- **Active state**: filled completely, golden solid, slight shake

CSS class: `.ability-slot.ultimate`. HUD code reads `state.def.isUltimate` and adds the class once on init.

### Character select — ulti preview
In the right-side info panel of the character select (already implemented in `hud.ts paintInfoPane`), add below the tagline:

```
┌──────────────────────────────────┐
│ ULTIMATE                         │
│ Rampage                          │
│ 3s of unstoppable fury           │
└──────────────────────────────────┘
```

A highlighted box with:
- "ULTIMATE" label in small uppercase gold
- Ulti name in the critter's color
- One-line description (read from a new `ultDescription` field on `AbilityDef`)

HTML structure (added inside `#critter-info`):
```html
<div id="critter-info-ulti" class="ulti-box">
  <div class="ulti-label">ULTIMATE</div>
  <div class="ulti-name"></div>
  <div class="ulti-desc"></div>
</div>
```

Painted by `paintInfoPane()` reading from `CRITTER_ABILITIES[name][2]`.

---

## Per-critter ulti concepts

Each ulti must feel **mechanically different** from the other two slots of the same critter, AND different from the ultis of other critters. Here's the first draft:

### Rojo — "Rampage"
- **Type**: `rampage`
- **Cooldown**: 45s
- **Wind-up**: 0.2s (visible roar pose)
- **Duration**: 3.0s active window
- **Effect**: during the window, Rojo is **invincible** (can't be knocked back, can't fall off), **headbutt cooldown is 0** (spam-able), speed ×1.5, mass ×3
- **Visual**: full red emissive pulse, trail effect
- **Identity**: berserker — your job during those 3 seconds is to slam every enemy into the void
- **Not redundant**: Charge Rush commits to a direction, Ground Pound is area; Rampage turns you into a chase predator

### Azul — "Phantom Strike"
- **Type**: `phantom_strike`
- **Cooldown**: 50s
- **Wind-up**: 0.4s (fade out + teleport tracking)
- **Duration**: 0.1s (effect is near-instant)
- **Effect**: Azul disappears, teleports behind the nearest enemy, and delivers an **auto-headbutt with 3× force**. Brief invulnerability frames during the fade.
- **Visual**: vanishing particles at origin, appear particles at target, then hit flash on the target
- **Identity**: assassin — precision strike on a single priority target
- **Not redundant**: Quick Dash is a directional committed dash, Sharp Stomp is a small AoE; Phantom Strike is a targeted deletion tool

### Verde — "Titan Slam"
- **Type**: `titan_slam`
- **Cooldown**: 60s
- **Wind-up**: 0.9s (Verde jumps straight up, off-screen)
- **Duration**: 0.05s (effect on landing)
- **Effect**: Verde lands with a **massive radial shockwave** covering 70% of the arena (radius ~8). Enemies inside are **launched vertically and outward**. Center-point damage is brutal, falloff to the edge.
- **Visual**: long wind-up (Verde rises, casts a shadow), huge slam VFX on landing, multiple concentric rings
- **Identity**: cataclysm — one big defining moment that changes the map
- **Not redundant**: Heavy Charge is linear, Earthquake is medium AoE; Titan Slam is a screen-wide event

### Morado — "Glass Storm"
- **Type**: `glass_storm`
- **Cooldown**: 40s (shortest — fragile but frequent)
- **Wind-up**: 0.1s
- **Duration**: 1.2s
- **Effect**: Morado **spins and fires 5 rapid mini-Blitzes** in a star pattern (72° apart), each dealing reduced Blitz damage. The critter is briefly invincible during the spin.
- **Visual**: purple trails forming a star shape, 5 impacts
- **Identity**: burst spam — overwhelming output, no precision
- **Not redundant**: Blitz is one directional dash, Shockwave is a single AoE; Glass Storm is chaos unleashed in all directions

---

## Character select presentation

The existing info panel has name, role, tagline, stats. The ulti appears **below the stats**, visually separated with a gold accent bar:

```
┌───────────────────────────────┐
│         [ 3D PREVIEW ]        │
├───────────────────────────────┤
│  ROJO                         │
│  BALANCED                     │
│  All-rounder. Easy to use.    │
│                               │
│  SPEED  ██████░░░░            │
│  WEIGHT ████░░░░░░            │
│  POWER  ██████░░░░            │
│                               │
│  ━━━━━ ULTIMATE ━━━━━         │
│  RAMPAGE                      │
│  3 seconds of invincible fury │
└───────────────────────────────┘
```

---

## Implementation order (when we implement it)

1. Add `isUltimate` flag to `AbilityDef` and extend `AbilityType` union
2. Add `ultName` + `ultDescription` convenience fields to `AbilityDef`
3. Create `makeRampage`, `makePhantomStrike`, `makeTitanSlam`, `makeGlassStorm` factories
4. Extend each critter's ability array with the ulti as slot 3
5. Implement each `fire*` effect function and register in `EFFECT_MAP`
6. Add `'ultimate'` to `HeldAction` union in `input.ts`, map `KeyL`
7. Update `player.ts` to check `isHeld('ultimate')`
8. Update HUD: distinct `.ultimate` class styling, radial fill for cooldown
9. Update character select: paint ulti box below stats in `paintInfoPane`
10. Add touch button (4th slot) for mobile
11. Add ulti sounds (gold-tier impact + hit)
12. Playtest and tune

## Risks
- **Rampage invincibility**: makes Rojo almost unkillable during 3s. Needs tuning — maybe he can still fall off if he steps over the edge, just can't be knocked off by others.
- **Phantom Strike targeting**: "nearest enemy" might feel arbitrary. Could be "nearest visible" or "nearest to the crosshair direction".
- **Titan Slam window**: a 0.9s wind-up is long. Other players have time to dodge. That's fair for a 60s CD, but needs playtest.
- **Glass Storm invincibility frames**: Morado is fragile. These frames are Morado's real defense window. Needs tuning so he's not a second Rojo during the spin.

## Estimated implementation effort
- Engine wiring: ~1h
- 4 fire functions: ~2h
- HUD ulti slot (desktop): ~45 min
- Character select ulti box: ~30 min
- Mobile ulti button: ~20 min
- Sound + tuning: ~1h
- **Total: ~5–6h**

---

## Summary
The ulti system fits into the current architecture as **one more entry per critter in `CRITTER_ABILITIES`**, with a flag for HUD styling. No refactor required. Four unique ultis covering four distinct playstyles (berserker, assassin, cataclysm, burst). Input via `KeyL` on desktop and a 4th touch button. Character select shows the ulti name + description below the stats. Ready to implement when the user gives the go.
