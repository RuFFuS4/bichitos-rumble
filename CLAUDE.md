# CLAUDE.md

## Project
Bichitos Rumble is a lightweight web arena brawler for the 2026 Vibe Coding Game Jam.

## Core constraints
- Brand new jam project
- Web playable
- Free to play
- No login or signup
- No heavy downloads
- No long loading screens
- Fast startup
- AI-first development workflow
- Keep scope small and finishable

## Tech stack
- TypeScript
- Vite
- Three.js
- GitHub
- Vercel
- Hostinger

## Current strategy
Do NOT start with full online multiplayer.
First validate the game loop with a local/simulated prototype:
- one arena
- one controllable critter
- simple bots or dummy opponents
- collisions
- knockback
- falling into void
- progressive arena destruction
- minimal HUD
- fast restart

## MVP target
- 4 fighters per match
- 4 critters initially
- 60 to 90 second rounds
- basic movement
- basic headbutt
- 2 special abilities per critter
- collapsing circular arena
- last survivor wins

## Non-goals for early phase
- ranking
- persistence
- login
- matchmaking
- advanced cosmetics
- large content scope
- backend complexity

## Art direction
- Style: cartoon squashy arcade
- Game feel > realism
- Impacts, abilities, and movement must feel punchy, exaggerated, and clear
- Future phases will add squash/stretch, hit stop, expressive animations, strong audio/visual feedback

## Ability design principles
- Each critter has 2 unique abilities (J and K)
- Abilities may share base logic (dash, AoE, etc.) but each critter must have:
  - Distinct behavior (timing, force, usage)
  - Distinct identity (animation, VFX, execution style)
- Architecture must support: config-driven per-critter definitions, reusable base logic, per-critter customization without hacking the system
- All tuning values (speed multipliers, mass, cooldowns, knockback, radii) must be centralized in config, never hardcoded in logic

## Separation of concerns
- Gameplay logic (physics, effects, cooldowns) must be separate from visual representation (animations, emissive, squash/stretch, VFX)
- Leave clear integration points where hit stop, squash/stretch, anticipation, and exaggerated reactions can be added later without refactoring gameplay code

## Code maintenance policy
1. **Continuous light cleanup**: after each functional block, remove new hardcodes, centralize values in FEEL/config, eliminate duplication
2. **Structural cleanup only at milestones**: no refactoring for its own sake; only after completing important systems; keep dev momentum
3. **Complexity control**: no long multi-responsibility functions; keep gameplay/visual separation clean; don't mix unrelated systems in the same file
4. **Protect working code**: don't rewrite systems that work without clear reason; evaluate impact before modifying existing code
5. **Branch discipline**: work in dev; merge to main only when a functional block is stable and playable; avoid massive unintegrated changes
6. **Document decisions**: important decisions in BUILD_LOG.md; structural changes noted

## Coding rules
- Keep code modular and typed
- Prefer simple architecture
- Avoid unnecessary dependencies
- Favor performance-aware decisions
- Keep browser payload light
- Do not create dead code or speculative abstractions
- Make small, reviewable changes

## Documentation rules
Keep these files updated when relevant:
- README.md
- RULES.md
- STACK.md
- PROMPTS.md
- BUILD_LOG.md
- SUBMISSION_CHECKLIST.md
- GAME_DESIGN.md
- MEMORY.md
- ERROR_LOG.md

## Working style
- Propose a short plan before major changes
- Implement in small vertical slices
- Explain file changes clearly
- Prefer the smallest working solution first
- After each milestone, summarize what changed and the next step

## Communication
- Always answer the user in Spanish.
- Keep code, file names, and technical identifiers in English when appropriate.
- Explain plans, changes, risks, and next steps in Spanish.

## Git workflow
- Never work directly on main.
- Use dev as the integration branch. (Development)
- Keep changes small and reviewable before merging to main.

## Debugging priorities
- If the game does not render correctly, stop feature work.
- Fix rendering, visibility, input, and restart flow before expanding scope.
- Prioritize a working playable scene over adding content.