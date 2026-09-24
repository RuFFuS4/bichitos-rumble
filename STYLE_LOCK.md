# Style Lock — Bichitos Rumble

This document defines the **mandatory visual style** for the project.
Every asset, model, effect, and UI element must conform to these rules.
No exceptions without explicit product approval.

## Core Identity

Arcade / chibi arena brawler. Toy-like, punchy, instantly readable.

## Shape Language

- **Silhouette first, detail second.** Every critter must be recognizable
  by outline alone at gameplay camera distance (~25 units).
- **Simple volumes**: spheres, cylinders, rounded cubes. No organic
  subdivision or sculpted detail.
- **Soft edges everywhere.** Bevels, rounded corners. Nothing sharp.
- **Big heads, compact bodies.** Chibi proportions (head ≥ body size).
- One **dominant visual idea** per character. If you can't describe it
  in 3 words, it's too complex.

## Color

- **2-3 colors max per character.** One dominant, one accent, one optional detail.
- **Flat base color** with very subtle shading. No PBR maps, no roughness
  variation, no metallic surfaces.
- Colors must be **distinct at a glance** between all roster members.
- No gradients, no noise, no complex texturing.

## Materials

- `MeshStandardMaterial` with flat color.
- Emissive used only for gameplay feedback (ability glow, immunity blink).
- `transparent: true` on all critter materials (required for immunity blink).
- No reflections, no environment maps, no normal maps.

## Accessories

- Minimal and integrated into the silhouette.
- No clothing, no loose items, no detachable parts.
- Accessories must read as part of the character, not as costume pieces.
- Examples: Sergei's bracelet, Kowalski's crest — simple, iconic, integrated.

## Model Constraints (Technical)

- **Max vertices per model**: 8,000 (target 3,000-5,000).
- **Max file size per GLB**: 500 KB (including embedded texture).
- **Single mesh per model** when possible. Max 3 meshes if needed for
  articulation (e.g., separate head for future animation).
- **One material per model.** Vertex colors or a single small texture
  (≤ 512×512 JPEG) for color variation.
- **Procedural animation is the default baseline.** The shared
  `critter-animation.ts` layer drives idle bob / run bounce / lean /
  sway / squash-stretch / headbutt pose from mass+speed — the same
  for every critter, tuned per-instance.
- **Skeletal animation clips are now supported as an OPTIONAL layer.**
  GLBs may ship `AnimationClips` (typically from Mixamo or Tripo
  Animate). The engine's `SkeletalAnimator`
  (`src/critter-skeletal.ts`) resolves states (`idle` / `run` /
  `victory` / `defeat` / `ability_1..3` / `headbutt_lunge` /
  `fall` / `hit`) by fuzzy name match and crossfades 0.15s between
  them. Loop states (idle/walk/run) coexist with procedural
  lean/sway/squash; heavy states (victory/defeat/ability/lunge/fall/
  hit) take over the root transforms while procedural steps aside.
- Clips must stay **consistent with the style**: no realistic-motion
  pack (no jogging, no walk-cycle pointing ideal human mass). Prefer
  bouncy / toy-like poses, clear pose-to-pose timing, readable
  silhouettes at gameplay camera distance.

## What This Style Is NOT

- Not realistic. Not semi-realistic. Not stylized-realistic.
- Not low-poly aesthetic (deliberate facets). Smooth, not angular.
- Not voxel. Not pixel art 3D.
- Not detailed figurines. Not collectible-quality sculpts.

## Enforcement

- Every model must pass visual review against this document before integration.
- The `scripts/optimize-models.mjs` pipeline validates vertex count and file
  size automatically. Models exceeding limits are rejected.
- Art direction changes require updating this document first.

## Roster Visual Reference

| Character | Animal | Dominant Idea | Key Visual | Palette (dominant · accent · detail) |
|-----------|--------|--------------|------------|--------------------------------------|
| Trunk | Elephant | Strong, armored | Big ears, subtle trunk, mini armor | grey (not on the sketch sheet) |
| Kurama | Fox | Agile, tricky | 9 large fan tails | `#f47c24` · `#fadeae` · `#3f3f3e` |
| Sergei | Gorilla | Dominant, territorial | Enormous arms, small bracelet | `#3f3f40` · `#8e8d8a` · `#dbc6ac` |
| Shelly | Turtle | Heavy, wise | Large shell, stable stance | `#68784c` · `#bca27d` · `#f9bb25` |
| Kermit | Frog | Venomous controller | Green body, purple/yellow accents | `#99bb28` · `#9259ba` · `#fcc736` |
| Sihans | Mole | Underground trapper | Sunglasses, big claws | `#845834` · `#bda586` · `#3f3f3e` |
| Kowalski | Penguin | Smart, analytical | Yellow crest | `#2f3647` · `#f3efe6` · `#f9ba27` |
| Cheeto | Tiger | Fast assassin | Marked claws, simplified stripes | `#f47f1d` · `#f0d6a1` · `#d9d9db` |
| Sebastian | Crab | Asymmetric brawler | One giant pincer, one tiny | red · cream · dark (swatches cut off on the sheet) |

**Palette (2026-09-23).** The swatches come from Rafa's roster sheet in
`resources/Bocetos/`, which is local and not in git. They are the
*look on screen*, not texture values: the arena and select-screen lights
brighten the albedo. The textures are brought towards them by colour
family in each critter's recipe (`textures.grade`,
`scripts/critter-grade.mjs`). The shapes of the models are not touched
(Rafa: «solo los colores»).

Done for Sergei, Kowalski, Kermit, Shelly, Cheeto and Sihans. Kurama and
Sebastian were already on palette, and Trunk has no swatches.

A new or re-imported critter should be checked against its row: render
it next to the sketch, not the swatch.
