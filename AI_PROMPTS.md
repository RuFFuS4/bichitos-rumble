# AI Prompts — Bichitos Rumble

> Centralized prompt library for generative AI passes (Midjourney,
> DALL·E 3, Stable Diffusion, Tripo 3D, Suno, ElevenLabs…). Every
> prompt is designed to be consistent with the game's art direction:
> **cartoon, squashy, arcade, high contrast, chibi proportions, big
> heads, warm arcade lighting**.
>
> When a new asset needs generating, copy the relevant template here,
> substitute the `{VARIABLES}` in CAPS, and paste. The notes per
> section explain the trade-offs + sanity rules so we don't ship
> something that doesn't fit.

## Delivered assets (2026-04-23)

Three prompts have already produced live assets integrated into the game:

| Asset | Prompt section | File | Integration |
|-------|---------------|------|-------------|
| Favicon "BR" | §1 | `public/favicon-br.png` | `<link rel="icon">` in index.html + tools.html (SVG kept as fallback) |
| HUD spritesheet | §8 (new) | `public/images/hud-icons.png` (4×7, 26 icons) | CSS sprite system `.sprite-hud-*`, activated when image loads. First uses pending integration (hearts / bot-mask / belts) |
| Ability spritesheet | §9 (new) | `public/images/ability-icons.png` (3×9, 27 icons) | CSS sprite system `.sprite-ability-{critter}-{slot}`, integrated in character-select info pane + in-match cooldown HUD |

Preload logic in `src/main.ts` adds `body.has-hud-sprites` /
`body.has-ability-sprites` only if the backing PNG actually loads;
emoji fallbacks stay if the asset is missing.

**3D belts** (§ belts design, AI-generated render prompt used in chat
on 2026-04-23) are still pending — user will generate and drop into
`public/images/belts/` once done. 16 belts: 9 Champion + 7 Global.

---

## 1 · Favicon (32×32 → 16×16)

**Goal**: a silhouette-readable mark that says "arcade brawler with
cartoon animals", works on dark and light tab backgrounds.

**Prompt (Midjourney / DALL·E)**:

> "Flat vector mascot logo for 'Bichitos Rumble', a cartoon arcade
> brawler game. Central shape: a chibi-proportioned critter silhouette
> (think gorilla or tiger head-forward fighting stance), big expressive
> eyes, oversized head, tiny body. Bold outline 4px, filled with a
> vibrant gradient from warm orange to crimson. Background: solid
> transparent. Composition fits in a 32×32 pixel square — silhouette
> must read at 16×16 downscale (no fine details below 2-pixel stroke
> width). No text, no watermark, no shadows beyond a simple drop
> below the mark. Output PNG 1024×1024, centre-framed with 10%
> padding, transparent background. Style reference: classic Kirby
> and Mario favicons — bold, friendly, instantly readable."

**Sanity rule**: after generation, scale the result to 32×32 and 16×16
and squint — if the silhouette "dissolves", reject and regenerate.

**Target paths**:
- `public/favicon.png` (32×32 master)
- `public/favicon-16.png` (16×16, hand-downscaled)
- `<link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">`
  in `index.html` (add to the `<head>` once the asset lands).

---

## 2 · OG Image — social card

Already shipped via `scripts/make-og-image.mjs` (generates from a
higher-res hero). If we re-gen the hero:

**Prompt**:

> "Horizontal 1536×1024 hero illustration for a cartoon arcade game
> called 'Bichitos Rumble'. A stone platform floats in a blue sky with
> warm sunrise horizon. On it, 6-7 chibi critters (gorilla, elephant,
> tiger, red fox with bushy tail, emperor penguin with yellow crest,
> green turtle with metallic shell, frog with cartoon eyes) battle
> dynamically — mid-punch, mid-jump, bouncing. Each has oversized
> head, tiny body, exaggerated expressions. Golden coins + small
> impact sparks scattered. Centre top: logo text 'BICHITOS' (blue
> gradient) stacked over 'RUMBLE' (yellow-to-red gradient) with
> comic-book burst behind. No realistic shading — flat cartoon cel
> with rim light. Target: cute but brawl-ready, mascot-fighting-game
> energy."

Then: `npm run og -- <source> --position top` → `public/og-image.png`.

---

## 3 · Per-critter HUD portraits (9 assets)

**Goal**: a square portrait of each critter, used in the lives HUD +
character-select slot + online waiting slots. Must work at ~64×64 and
~120×120 sizes. Backgrounds transparent so the HUD can tint them with
the critter's signature colour.

**Prompt template** (substitute `{CRITTER}`, `{ANIMAL}`, `{POSE}`,
`{COLORS}`, `{REFERENCE}`):

> "Square 1024×1024 cartoon mascot portrait of **{CRITTER}**, a
> chibi-proportioned {ANIMAL} from the Bichitos Rumble brawler. Big
> expressive head (head-to-body ratio ~2:1), tiny determined body,
> {POSE}. Palette: {COLORS}. Thick outline 6-8px black. Flat cartoon
> shading, one key light upper-right + soft rim from behind-left.
> No background (transparent PNG). Character fills ~75% of the frame,
> centered. Style: {REFERENCE}. Expressive eyes, slight comic-book
> motion lines behind to suggest kinetic energy. No text, no watermark."

Per-critter parameters:

| Critter   | Animal | Pose | Colors | Reference |
|-----------|--------|------|--------|-----------|
| Sergei    | mountain gorilla | chest-thumping mid-roar, knuckles bracing ground | brown-tan fur, peach chest, tiny gold bracer | Donkey Kong mixed with Kirby |
| Trunk     | baby elephant  | trumpeting forward, trunk curled up, one foot stomping | slate grey with pink inner ears, small white tusks | friendly circus elephant mascot, chibi |
| Kurama    | nine-tailed fox | nine fluffy tails fanned behind, mid-pounce with paws forward | deep crimson + cream underside, white tail tips, glowing amber eyes | kitsune shrine guardian, slightly mischievous smirk |
| Shelly    | giant turtle   | standing inside armored shell, arms crossed defiantly | teal-green skin, golden-brown shell with metallic sheen | Bowser's turtle kid brother, stoic and proud |
| Kermit    | poison dart frog | perched on haunches ready to leap, tongue slightly out | chartreuse green + magenta spots, big black eyes | Futurama's Hypnotoad meets Muppet Kermit |
| Sihans    | mole wearing sunglasses | standing upright with dirt on paws, aviator shades | dark brown fur, yellow tinted shades, orange pants | Hans Moleman of Simpsons as a secret agent |
| Kowalski  | emperor penguin | military salute with flipper, yellow crest feathers | black back, white belly, canary-yellow crest + beak tips | Kowalski from Madagascar, stern and analytical |
| Cheeto    | bengal tiger cub | stalking low, tail curled, predator eyes | orange with bold black stripes, white muzzle | Tiger cub with Batman vibes, menacing but cute |
| Sebastian | fiddler crab    | one massive claw raised, one tiny claw | bright crimson shell, yellow eyes on stalks | Sebastian from The Little Mermaid crossed with a samurai |

**Target paths**: `public/portraits/<critter>.png` (1024×1024 master).
Runtime downscales via `slot-thumbnail` or CSS `background-size`.

---

## 4 · Belt icons (16 assets — BADGES system)

**Prompts + per-belt parameters already captured in
[`BADGES_DESIGN.md`](BADGES_DESIGN.md)** — see the "Prompt para
generación de belts (IA)" section. Not duplicated here to avoid
drift. Two sets:
- **9 Champion belts** (one per critter, habitat-themed)
- **7 global trophies** (Speedrun / Iron Will / Untouchable / Survivor
  / Globetrotter / Arena Apex / Pain Tolerance)

Target output: `public/badges/<id>.png` (1024×1024 master; swap the
placeholder emoji for `<img src="/badges/<id>.png">` in the toast +
Hall of Belts CSS once assets land).

---

## 5 · Ability icons (24 assets — 3 per critter minimum)

**Goal**: 80×80 icons for the ability HUD cooldown bar. Each critter
has 2-3 abilities (J / K / L); that's up to 27 icons but we can
collapse shared factories (Charge Rush / Ground Pound / Frenzy) to one
icon each.

**Prompt template**:

> "Square 512×512 icon for a brawler ability called **'{NAME}'**.
> Central shape: **{MOTIF}** rendered in a bold cartoon cel style with
> thick 6px black outline. Palette: {PALETTE}. Background: a soft
> radial gradient from {ACCENT} at centre to transparent at the
> corners (circular vignette, not rectangular). No realistic rendering
> — pure flat colour with one highlight shine per shape. Motion-burst
> streaks optional if the ability implies movement. No text, no
> watermark, no critter silhouette (icons are type-agnostic so they
> can be swapped between kits)."

Per-ability parameters (current kit):

| Key | Name | Motif | Palette | Accent |
|-----|------|-------|---------|--------|
| J | Charge Rush | arrow-shaped motion blur + speed lines | orange + white | warm gold |
| K | Ground Pound | downward fist inside a shockwave ring | yellow-orange + brown | amber |
| L | Frenzy | flame silhouette with angry eyes inside | crimson + orange-red | deep red |

**Signature ability icons** (future — one per critter's bespoke
ability, Tier 2):

| Critter   | Ability        | Motif                              | Accent      |
|-----------|----------------|------------------------------------|-------------|
| Trunk     | Trunk Grip     | coiled trunk / lasso shape         | slate grey  |
| Kurama    | Mirror Trick   | fox silhouette with ghost copy     | crimson     |
| Shelly    | Shell Shield   | turtle shell with metallic sheen   | teal        |
| Kermit    | Poison Cloud   | green cloud with skull eyes        | chartreuse  |
| Sihans    | Tunnel         | hole with dirt kicking up          | ochre       |
| Kowalski  | Snowball       | snowball with motion trail         | icy cyan    |
| Cheeto    | Shadow Step    | tiger silhouette fading to smoke   | purple-black|
| Sebastian | Claw Sweep     | arcing claw slash                  | coral red   |

**Target paths**: `public/abilities/<ability-id>.png`.

---

## 6 · HUD compound layouts (3D + icon dual mode)

**Goal per the user note**: an organized HUD showing avatar + lives +
belts + abilities for each player, in both icon and 3D modes.

Currently the HUD is pure DOM. Two layout proposals the user described:

### Icon mode (compact, default)
Row with: avatar (circular, 32px) · lives (hearts, 14px) · 3 ability
icons (24px greyscale when on cooldown, coloured when ready) · 1-2
belts won (small 16px gold).

### 3D mode (expanded, optional tab)
Character-select-style pane showing the actual 3D model rotating
live, with floating belts orbiting and ability icons in a ring. More
visual, costlier to render — keep behind a `?hud=3d` query param or a
settings toggle.

**Prompt** (only needed for the flat-icon mode, since 3D mode reuses
the existing GLB + belt assets):

> "Cartoon HUD bar for a fighting game, horizontal layout 400×64 px.
> Left: circular avatar slot (empty, ready for a portrait png).
> Centre: row of 3 heart shapes (red with white highlight) and 3
> ability icon slots (square with rounded corners, 40×40). Right:
> narrow trophy belt icon. Background: semi-transparent dark
> rectangle with subtle gold trim along the top edge. All shapes
> flat-cel with thick outlines. No text."

**Target**: `public/hud/bar.png` + corresponding slot masks.

Implementation would replace `src/hud/runtime.ts` lives-row DOM with
`<img>` + overlaid `<span>`s.

---

## 7 · Custom SFX via Suno

Suno is primarily music but generates short stingers via its
"one-shot" prompts. Goals:

### 9 critter signature stingers (for victory / special hits)

**Prompt template**:

> "Short 1-2 second cartoon sound effect for **{CRITTER}**, a
> {ANIMAL} character in a squashy arcade brawler. **{DESCRIPTION}**.
> Bright, punchy, mono. No music. Suitable for a game SFX library.
> Export WAV."

Per critter:

| Critter | Description |
|---------|-------------|
| Sergei    | deep gorilla chest-thump + KING KONG roar, compressed |
| Trunk     | elephant trumpeting with a wet reverb tail |
| Kurama    | playful fox yip + bell chime |
| Shelly    | heavy turtle shell thud + metallic ping |
| Kermit    | ribbit + slimy squelch |
| Sihans    | digging dirt crunch + glasses-adjust "hmm" |
| Kowalski  | penguin quack with a militaristic salute "hup!" |
| Cheeto    | tiger hiss rising to a roar |
| Sebastian | crab pincer snap with a calypso maraca tick |

### Global match stingers

- **3-2-1 countdown voice** — energetic announcer "THREE! TWO! ONE!
  FIGHT!" (or "GO!"). Current implementation is silent; would land
  in `src/audio.ts` as a new entry.
- **Final blow dramatic whoosh** — wind-up anticipation when the last
  enemy is about to be eliminated.
- **Arena about to collapse rumble** — seismic + thunder, longer form
  replacement for the current synthesized warning.

**Target paths**: `public/audio/sfx/<name>.wav` + a new SFX bucket in
`src/audio.ts` that resolves to these files (vs current synth loader).

### Voice lines per critter (stretch goal — NOT urgent)

For end-of-match quotes ("VICTORY!" in their character voice). Likely
ElevenLabs is a better fit than Suno here; skip for Suno.

---

## 8 · Open questions / still-to-think-through

- Do we want a **logo + wordmark SVG** separate from the OG hero? Nice
  for press kits but not on the critical path.
- **Critter theme music** — a 30s loop per critter for character-select?
  Currently one `intro.mp3` covers the whole menu. Probably post-jam.
- **Announcer voice language** — EN is the default jam audience, but
  the game UI is partially ES. Do we bilingual the 3-2-1? Probably not
  worth the extra assets.

---

## Appendix — where these prompts get consumed

| Prompt section | Output path | Code touchpoint |
|---|---|---|
| Favicon | `public/favicon.png` | `index.html` `<link rel="icon">` |
| OG image | `public/og-image.png` | `<meta property="og:image">` (already wired) |
| Portraits | `public/portraits/<id>.png` | `src/slot-thumbnail.ts` (or CSS bg) |
| Belts | `public/badges/<id>.png` | `src/badge-toast.ts` + `src/hall-of-belts.ts` (swap innerHTML) |
| Ability icons | `public/abilities/<id>.png` | `src/hud/runtime.ts` `.ability-name` area |
| SFX | `public/audio/sfx/<name>.wav` | `src/audio.ts` — add a mp3/wav loader branch |

When an asset lands, update the table so future sessions know what's
shipped vs still placeholder.

---

## 10 · Arena packs — 3D terrain variants (post-jam)

Propuesta de 4 escenarios principales + 4 extras. Cada uno viene como
un "pack" de props 3D + skybox + ground tile. El arena circular de
gameplay (radius 12, 29 fragmentos colapsables) no cambia — lo que
cambia es el **anillo decorativo exterior** (radius 14–22), la
**textura del suelo** que reemplaza el verde de los fragments, y el
**skybox**. Selección aleatoria por seed de partida (misma seed =
mismo arena + mismo pack, reproducible).

### Preamble global (ir en cada prompt)

```
# CONTEXT (for the generative 3D AI)

"Bichitos Rumble" is a 4-player web-browser arena brawler built in
Three.js. Critters are chunky chibi animals with oversized heads
(gorilla, tiger, fox, turtle, frog, mole, penguin, crab, elephant)
that fight by headbutting each other off a collapsing circular
platform. Art direction:

  - Chunky cartoon, bold black outlines (2–4 px equivalent in 3D).
  - Slight cel-shading, NO realism, NO photorealistic textures.
  - Vibrant saturated colours, soft AO, warm arcade feel.
  - Reference mix: Fall Guys + Pummel Party + Smash Bros trophy.
  - Silhouettes must read at 3/4 isometric from ~25 world units away.

# CAMERA + ARENA BRIEFING (so props scale correctly)

  - Arena is a circular platform, RADIUS 12 world units, made of ~29
    irregular fragments (hex-ish) that collapse during play.
  - Arena is centred at world origin (0, 0, 0) on the XZ plane.
  - Pseudo-isometric camera: position ≈ (0, 23, 25), looking at the
    centre. FOV 40°. So props are seen from a high-angle 3/4 view.
  - Critters stand ~1.6 world units tall. Decorative props should
    feel BIGGER than the critters (players are tiny vs the world).

# WHERE THE PROPS GO

Decorative props live in a RING OUTSIDE the fighting arena — between
radius 14 and radius 22. The 0-to-12u disc is the combat surface
(don't put anything there). Props cast silhouette against the sky,
never obstruct the camera's line of sight to critters.

# OUTPUT CONSTRAINTS

  - GLB/GLTF format, Y-up, metres as units.
  - Low-poly target: < 5 000 triangles per decorative prop, < 20 000
    per full scene pack.
  - 1024 × 1024 max textures, PNG/JPG baked. Metalness ≤ 0.3
    (we render without an env map — fully metallic reads as dark grey).
  - No embedded skeleton — props are static.
  - No baked lighting — the game scene lights them at runtime.
  - Origin of each prop at its base centre (feet/floor contact),
    pointing +Z forward when applicable.
```

### Pack 1 — JUNGLE TROPIC (🌴, Sergei / Cheeto)

Palette: deep emerald greens (#1f5f2a – #3aa24a), warm earth browns
(#5a3a1a – #8a5a2a), splashes of golden sunlight (#ffd86a), small
pops of red-orange fruit (#e65a1a).

| Prop | File | Dimensions |
|------|------|------------|
| Tall palm | `tree_palm_tall.glb` | 4.5 m, curved trunk, 6–8 drooping fronds, coconut cluster |
| Mid palm | `tree_palm_mid.glb` | 3.2 m, straight, 5 fronds, no coconuts |
| Broadleaf tree | `tree_jungle_broadleaf.glb` | 3.8 m, ficus/rubber, dangling vines |
| Tropical bush | `bush_tropical.glb` | 1.0 × 1.2 m, dense leafy |
| Tiki totem | `totem_tiki.glb` | 3.0 m, 3 grumpy faces, moss |
| Stone ruin | `stone_ruin_block.glb` | 1.2 × 1.0 × 0.8 m, glyphs + ivy |
| Ground tile | `ground_tile_jungle.glb` | 4 × 4 m, grass + leaves + dirt, tileable |

Skybox: 2048×1024 equirectangular PNG. Canopy silhouette at horizon
(~15 % height). Warm midday sun + sunbeams + subtle fog. Upper half
soft gradient green-teal → cream.

Placement: palm trees lean outward; totems + broadleaves as 2–3
focal points; bushes fill gaps.

### Pack 2 — FROZEN TUNDRA (❄️, Kowalski)

Palette: glacial ice blue (#8fd8ff – #3a8fc9), bright white
(#f5faff), pale lavender shadow (#c8c0e8), silver-grey rock accents
(#5a6a78), pops of orange on wooden signs (#f08a3a).

| Prop | File | Dimensions |
|------|------|------------|
| Tall iceberg | `iceberg_tall.glb` | 4.0 m jagged spike, angular, translucent top |
| Mid iceberg | `iceberg_mid.glb` | 2.5 m blocky, flat top |
| Low iceberg | `iceberg_low.glb` | 1.2 m scatter block |
| Snow pine | `pine_snow.glb` | 3.8 m conifer, snow-laden branches, dark green peeking |
| Signpost | `signpost_wood.glb` | 2.0 m leaning wooden post + blank plate |
| Ice shard | `ice_shard.glb` | 0.4–0.8 m crystalline, cluster-friendly |
| Ground tile | `ground_tile_ice.glb` | 4 × 4 m packed snow + faint footprints + cracks |

Skybox: 2048×1024. Night with aurora borealis ribbons (green +
magenta). Distant snow-capped mountains at horizon (~20 % height).
Few scattered stars. Deep navy (#0a1530) upper → soft purple
(#6a4a8a) horizon.

Placement: tall icebergs at radius 16–20 forming a "crown"; pines
behind (20–22); signposts near-edge (14); cold and still vibe.

### Pack 3 — DESERT DUNES (🏜️, Sihans)

Palette: warm sand (#e6c178 – #d19b4a), burnt orange (#d35a1a), deep
crimson rocks (#a33030), cactus green (#5a8c4a), pale bone cream
(#f0e8d0), tiny turquoise accents (#40c0b0).

| Prop | File | Dimensions |
|------|------|------------|
| Tall spire | `sandstone_spire_tall.glb` | 5.0 m pillar, wind-carved layers, tilted top |
| Short spire | `sandstone_spire_short.glb` | 2.5 m fat-base spire |
| Saguaro | `cactus_saguaro.glb` | 2.8 m classic, 2–3 arms, top flowers |
| Desert palm | `palm_desert.glb` | 3.0 m thin, wispy fronds, exposed roots |
| Minecart | `minecart_rusted.glb` | 2.0 × 1.0 × 1.0 m wooden + rusted iron |
| Bones scatter | `bones_skull_scatter.glb` | 0.6 m skull + 4 ribs (single GLB) |
| Tattered flag | `cloth_flag_tattered.glb` | 2.2 m pole + torn red/orange banner |
| Ground tile | `ground_tile_sand.glb` | 4 × 4 m wind-rippled sand + small stones + subtle prints |

Skybox: 2048×1024. Golden-hour sunset, sun at 5 % height. Gradient
deep violet (#4a2a6a) → orange-pink (#f0805a) → dusty gold
(#f0c870) horizon. Distant dune silhouette + thin pink clouds.

Placement: spires at 16–20 forming a triangle; saguaros + palms
between; minecart as a single storytelling anchor (15); bones at 14
(close enough to see from combat).

### Pack 4 — CORAL REEF BEACH (🌊, Shelly / Sebastian)

Palette: turquoise water (#40c0c0 – #70e0d0), wet sand beige
(#e8d0a0), coral red (#e25a3a – #f0805a), coral pink (#f09a9a),
fresh palm green (#3aa24a), white shell accents.

| Prop | File | Dimensions |
|------|------|------------|
| Red coral | `coral_stack_red.glb` | 3.0 m branching red formation |
| Pink coral | `coral_stack_pink.glb` | 2.4 m curly cabbage-pink |
| Brain coral | `coral_brain.glb` | 1.2 m round with swirly grooves |
| Tilted palm | `palm_beach_tilted.glb` | 3.5 m 45°-tilt coconut palm |
| Shipwreck piece | `shipwreck_hull_piece.glb` | 2.5 × 1.5 × 2.0 m wooden hull + barnacles |
| Wet boulder | `boulder_wet.glb` | 1.5 m rounded + tiny tide pool with starfish |
| Seashells | `seashell_scatter.glb` | 0.3 m cluster of 5–6 shells |
| Starfish | `starfish_decor.glb` | 0.4 m orange, flat |
| Ground tile | `ground_tile_beach.glb` | 4 × 4 m wet sand + darker shoreline + shells |

Skybox: 2048×1024. Horizon at ~45 %. Upper: soft turquoise-blue
(#70b8e0) with puffy cumulus. Lower: deeper turquoise (#40c0c0)
with sun glint.

Placement: coral stacks at 14–16 (they are the reef rim, closer);
palms tilted outward at 18–22; shipwreck as single anchor (17);
wet boulders in gaps. Ground darker toward outer edge (tide line).

### Extras (post-jam stretch, already scoped for prompts)

Si sobra ventana de IA generativa, los 4 hábitats restantes:

| Extra pack | Hábitat de | Keywords visuales |
|-----------|-----------|--------------------|
| `savanna` | Trunk (elefante) | Acacias dispersas, baobab, hierba alta dorada, termiteros, cielo caluroso |
| `kitsune_shrine` | Kurama (zorro) | Torii rojos, linternas de piedra, bambú, cerezos en flor, niebla suave |
| `swamp` | Kermit (sapo) | Árboles retorcidos con musgo, nenúfares, raíces aéreas, niebla verde |
| `jungle_moonlight` | Cheeto (tigre) | Variante nocturna del Pack 1: mismos props, skybox luna llena, luciérnagas |

Mismo formato que los 4 principales (preamble + tabla de props +
skybox + placement). Palettes y silueta a definir cuando se entre.

### Sistema de carga (backend del feature — 2–3 h de dev)

Cuando los assets lleguen:

1. `public/models/arenas/<pack-id>/*.glb` — props + ground tile.
2. `public/images/skyboxes/<pack-id>.png` — equirectangular.
3. JSON de placement por pack: `public/arenas/<pack-id>.json` con
   array `{ prop: 'tree_palm_tall', pos: [r, angleDeg], rotY, scale }`
   (r = radio, ángulo en grados; el renderer lo traduce a XZ).
4. Módulo nuevo `src/arena-decorations.ts` que, dado un `packId` y
   el seed del arena, carga los GLBs + skybox + ground tile.
5. Hook en `Arena.buildFromSeed(seed)` → llama a
   `arenaDecorations.apply(packId, seed)` pasando un `packId`
   elegido via hash del seed (o argumento del room config).
6. Opción lab: `/tools.html` añade un picker de "force arena pack".

Gameplay del arena (fragments collapse, falloff, respawn) no cambia.
El packId es pura cosmética + audio ambient futuro.
