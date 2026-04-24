# Procedural Parts — what we can manipulate per-critter at runtime

> Last scan: 2026-04-22 · `npm run inspect:parts`
>
> This doc catalogs which parts of each critter's GLB are independently
> addressable at runtime. It answers the question "can we visually hide
> Shelly's head and legs when she hides in her shell, without shipping
> a second GLB?" — yes, via bone manipulation. Different critters give
> us different tools.

## TL;DR

| Route | How it works | Works on… |
|---|---|---|
| **Bone scale/position** | Animate bones by name directly (bypass the clip) | Everyone. Two distinct bone vocabularies: Tripo (L_Foot / L_Hand / NeckTwist / Spine01…) and Meshy/Mixamo (LeftFoot / LeftHand / Head / Spine01…). Both consistent within their family. See the per-critter playbooks below. |
| **Mesh transform** | Address individual `Mesh_N.001` primitives | Cheeto (15 parts), Kowalski (12 parts), Trunk (18 parts) — the Tripo-animated critters |
| **Skeletal clip** | Standard animation track | Any critter with clips (see `CHARACTER_DESIGN.md`) |

## Global bone vocabulary — two families

### Tripo-standard humanoid rig

Used by Cheeto · Trunk · Shelly · Kermit · Kowalski · Sergei (via Mixamo
retarget). Resolve with `skinnedMesh.skeleton.getBoneByName(name)`:

```
Root · ParentNode (or <id>_Parent) · Armature (or <id>_Armature)
Hip · Waist · Spine01 · Spine02 · Pelvis
NeckTwist01 · NeckTwist02 · Head
L_Clavicle · L_Upperarm · L_UpperarmTwist01..02 · L_Forearm · L_ForearmTwist01..02 · L_Hand
R_Clavicle · R_Upperarm · R_UpperarmTwist01..02 · R_Forearm · R_ForearmTwist01..02 · R_Hand
L_Thigh · L_ThighTwist01..02 · L_Calf · L_CalfTwist01..02 · L_Foot
R_Thigh · R_ThighTwist01..02 · R_Calf · R_CalfTwist01..02 · R_Foot
```

Total: ~35 named bones per critter. Twist bones are subdivision helpers
for smooth skinning; rarely worth manipulating by hand.

### Meshy / Mixamo rig

Used by **Kurama** and **Sebastian** (both 2026-04-24 onward). Same
Mixamo naming any generic humanoid rig uses:

```
Hips · Spine · Spine01 · Spine02 · neck · Head · head_end · headfront
LeftShoulder · LeftArm · LeftForeArm · LeftHand
RightShoulder · RightArm · RightForeArm · RightHand
LeftUpLeg · LeftLeg · LeftFoot · LeftToeBase
RightUpLeg · RightLeg · RightFoot · RightToeBase
```

Total: ~23 named bones per critter. Fewer subdivisions than Tripo
(no Twist01..02 bones), which is fine for the abilities we're
prototyping — we don't need per-segment control on forearms.

**When writing procedural ability code** that should work on both
families, use a compatibility helper:

```ts
const LEFT_FOOT = critter.parts.hasBone('L_Foot') ? 'L_Foot' : 'LeftFoot';
critter.parts.hideBone(LEFT_FOOT);
```

Or add a small mapping table at the top of the file. Every Meshy
critter responds to the same Mixamo names, every Tripo critter
responds to the same Tripo names, so the check only happens once.

## Per-critter playbooks

### Shelly — "Mega Shell" ULTI ("hide into the shell")

**Goal**: hide head + all four limbs so only the shell is visible.

**Route**: bone scale to zero — the skin weights carry the geometry
with the bone, so a bone collapsed to origin collapses its geometry.

```ts
const hide = (b: string) => {
  const bone = skinned.skeleton.getBoneByName(b);
  if (bone) bone.scale.setScalar(0.01);     // not 0 → avoids NaN in matrix math
};
hide('Head');
hide('L_Hand'); hide('R_Hand');
hide('L_Foot'); hide('R_Foot');
// Optional extras for a tighter "curl":
// hide('L_Forearm'); hide('R_Forearm');
// hide('L_Calf');    hide('R_Calf');
```

Reverse the effect (scale back to 1) when the ULTI ends. No mesh
swaps, no asset changes.

**Caveat**: the shell is baked into the same mesh as the body, so the
torso stays visible — that's the effect we want (Shelly curls inside
the shell, shell remains prominent).

### Sebastian — "Claw Rush" + "Claw Sweep" + "Crab Slash"

**2026-04-24 update.** Sebastian switched from the Tripo rig (which
had crab-specific `L_Claw` / `R_Claw` / `L_Leg1..4` / `R_Leg1..4`
bones — a rare rig-lottery win) to the Meshy AI export, which uses
the **standard Mixamo humanoid skeleton**:

```
Hips · Spine · Spine01 · Spine02 · neck · Head · head_end · headfront
LeftShoulder · LeftArm · LeftForeArm · LeftHand
RightShoulder · RightArm · RightForeArm · RightHand
LeftUpLeg · LeftLeg · LeftFoot · LeftToeBase
RightUpLeg · RightLeg · RightFoot · RightToeBase
```

The 8-legs morphology of the original crab collapses to 2 biped
legs; the two pincers (different sizes in the game-design brief)
collapse to `LeftHand` + `RightHand`. We keep the convention that
`RightHand` = the big claw (skinned heavier on the original mesh).

**Clips shipped via Meshy (2026-04-24 import):**
- Idle / Run / Fall / Victory (Punch_Combo_1) / Defeat (Sleep_Normally)
- Ab_2 Claw Sweep → Charged_Slash (2.23 s)

**What goes procedural under the new rig:**

- **Claw Rush (H1)** — lateral dash with the big pincer:
  `glbMesh.position.x += dashSpeed * dt` driven by the ability state,
  plus `parts.scaleBone('RightHand', 1.4)` during the strike window
  and a little `rotation.y` on `RightForeArm` to sell the pincer
  arc. Reset bones on ability end.
- **Crab Slash (ULTI)** — ultra-fast dash + claw extended as a whip:
  * `glbMesh.scale.z = 1 + ulti.progress * 2.0` stretches the whole
    body along the dash direction (same channel used by charge_rush
    already).
  * `parts.scaleBone('RightHand', 2.0)` + `parts.scaleBone('RightForeArm', 1.8)`
    telegraphs the pincer shooting forward.
  * On contact: hit-stop + reset scales; on miss: body keeps
    sliding past the arena edge (existing fall-off physics handles
    the elimination).
- **Stun flash**: bone-agnostic — `updateVisuals()` already supports
  per-critter emissive tints (Hypnosapo flicker on Kermit is the
  existing precedent).

No 8-legs skitter possible anymore — the Meshy rig can't do it.
Trade-off accepted for the much larger Meshy animation library.

### Trunk — "Trunk Grip" (trunk stretches out, grabs, throws)

**The tricky one.** The rig is humanoid-standard; there is **no
dedicated bone for the trunk**. But the mesh WAS authored in 18
separate parts (`Mesh_0.001` .. `Mesh_17.001`), so the segmentation
survives in the GLB.

Three viable routes:

1. **Geometric heuristic + label once** (recommended).
   On first load of the GLB, walk the primitives, compute each one's
   world-space centroid + bounding box, and label the furthest-forward
   one "trunk". Cache the label in `src/roster.ts` so subsequent
   loads skip the scan. Then `trunkMesh.scale.z = 1 + grip * 3` during
   the ability.

2. **Manual label file** (`scripts/mappings/trunk-parts.json`).
   Open the GLB in Blender / a viewer, identify which index is the
   trunk, ship a JSON mapping. Lower engineering effort but requires
   the human-in-the-loop step once per import.

3. **Whole-mesh stretch in Z** (fallback).
   Scale the entire `glbMesh.scale.z` during the ability with an
   ease-out-ease-in curve. Reads less precisely ("everything stretches"
   instead of "trunk stretches") but costs zero bone / mesh logic.

Per the user's note during Trunk integration: the animation clip
already does the spin + throw motion, so what's missing is just the
horizontal trunk lengthening. Option (1) or (3) wins — both layer
cleanly on top of the existing `Ability2TrunkGrip` clip.

### Cheeto — "Shadow Step" (teleport + rear attack)

**Meshes**: 15 separated parts. Bones: humanoid-standard.

- Fade the whole group to opacity 0 via `traverse → material.opacity`
  during the vanish (~150 ms), teleport to target rear, fade back in
  with a subtle purple emissive flash.
- If we want the smoke silhouette: clone the mesh tree, tint it black,
  scale up + fade out in place while the real Cheeto teleports.

Nothing requires the mesh segmentation, but the 15 parts means we
could also do a "dissolution" effect (spread parts outward with
individual scale interpolations).

### Kermit — "Poison Cloud" H2 (occludes vision inside)

- Mesh is merged (1 primitive, 37k verts), but the cloud itself is a
  VFX spawn not a mesh deformation — independent of GLB structure.
- Hypnosapo ULTI is procedural already (purple flicker emissive in
  `critter.ts updateVisuals`).

### Kurama — "Mirror Trick" H2 (decoy copy)

- Mesh merged (1 primitive, 39k verts). Full-critter clone via
  `SkeletonUtils.clone(critter.glbMesh)` → position offset, fade over
  2 s, absorbs 1 hit.
- No part-level hooks needed.

### Sergei · Sihans · Kowalski

- Standard humanoid manipulation. No critter-specific signatures beyond
  what the shared factories already do (Charge Rush + Ground Pound +
  Frenzy).
- Kowalski has 12 segmented meshes but the Ice Slide / Snowball / Ice
  Age all do their thing via VFX spawns, not mesh deformation.

## Implementation hook

When we open signature abilities (post-animation gate), the
recommended utility is `src/critter-parts.ts` (future file):

```ts
// Sketch only — not implemented yet.
export interface CritterParts {
  /** Resolve a bone by name. null if not present on this critter. */
  getBone(name: string): THREE.Bone | null;
  /** Scale a bone by factor. 0.01 hides it (avoid true 0 for matrix
   *  stability). */
  scaleBone(name: string, factor: number): void;
  /** Primitive by numeric index (0..N) or by labelled role if cached. */
  getPrimitive(indexOrLabel: number | string): THREE.Mesh | null;
  /** For future ability VFX: clone the whole rig + tint. */
  cloneTinted(color: number): THREE.Object3D;
}
```

One instance per `Critter`, built in the critter constructor once the
GLB is attached. Caches the bone lookups so the ability tick isn't
doing string-based searches each frame.

## Verify before editing signatures

1. `npm run inspect:parts` — re-runs the audit. Re-read this doc.
2. `npm run inspect:parts public/models/critters/<id>.glb` — single
   critter.
3. If a future import loses the segmentation (e.g. Meshy merges parts
   that Tripo kept separate), this doc goes stale fast — re-run.
