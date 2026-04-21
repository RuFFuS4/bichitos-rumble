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
