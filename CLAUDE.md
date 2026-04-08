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