# FINAL JAM QA CHECKLIST

> **Use this as the final pass before clicking "Submit" on the Vibe Jam form.**
> Tick items only when you've personally verified them on the **production**
> URL ([https://www.bichitosrumble.com](https://www.bichitosrumble.com)) — local dev passes don't count.
>
> Build under test: `ce5a61f` (or later — check `git log -1` and confirm Vercel
> shows the same hash deployed).
>
> Symbol legend:
> - `[ ]` pendiente / por probar
> - `[x]` verificado OK
> - `[!]` problema detectado — describir en una línea debajo
>
> Items already prefixed `[x]` were verified by Claude during the polish pass
> (build / config / source). Anything that requires running the live game,
> moving a player, or touching a real other client is left blank for Rafa.

---

## 1. Producción / Deploy

- [x] Último commit en `main` — `git log -1 --oneline` muestra `7293266 chore: audit asset sizes before submission` (o posterior tras cualquier hotfix).
- [x] `npm run check` verde local (tsc + verify-glbs + vite build + clean-dist-raw).
- [x] `cd server && npx tsc --noEmit` verde local.
- [x] `node scripts/verify-ability-parity.mjs` → ALL PARITY CHECKS PASSED.
- [x] `dist/` post-build = ~240 MB (después del cleanup); pre-cleanup era 2.7 GB.
- [ ] **Vercel** muestra el commit `7293266+` como último deployment para `bichitos-rumble` (Production env).
- [ ] **Railway** server muestra mismo branch / commit en el último deploy.
- [ ] `https://www.bichitosrumble.com` responde 200 en HTTPS (no certificado caducado, no warnings de seguridad).
- [ ] `https://bichitosrumble.com` (sin www) redirige correctamente a www o sirve la misma SPA.
- [ ] DNS Hostinger apunta correctamente a Vercel (no propagación pendiente).
- [ ] URL fallback de Vercel (`https://bichitos-rumble.vercel.app` o similar) carga si el dominio custom falla.

## 2. Primer acceso (cold load)

- [ ] Hard refresh de `https://www.bichitosrumble.com` (Ctrl+Shift+R).
- [ ] Title screen se muestra en menos de 3 s con loading visible si tarda.
- [ ] Logo "BICHITOS RUMBLE" + tagline "HEADBUTT YOUR RIVALS INTO THE VOID" legibles.
- [ ] Botones "🤖 vs Bots" y "🌐 Online Multiplayer (up to 4P)" presentes.
- [ ] Hint inferior visible: `WASD move · SPACE headbutt · J K abilities · L ultimate · R restart`.
- [ ] "by @RGomezR14" presente bottom-left.
- [ ] Vibe Jam widget badge presente bottom-right (pill negra clickable).
- [ ] Botones settings top-right: 🔊, 🎶, ❓.
- [ ] Click ❓ abre la leyenda de status effects sin romper la pantalla.
- [ ] **DevTools → Console**: 0 errores rojos. Warnings amarillos OK si son del widget de VibeJam o políticas de cache.
- [ ] **DevTools → Network**: ningún 404, ningún mixed content (no `ws://` ni `http://` con HTTPS).

## 3. Offline (vs Bots)

- [ ] Click "vs Bots" → entra a character select.
- [ ] Grid 3×3 con los 9 críticos visibles. Avatares NO en T-pose.
- [ ] Hover/click en cada slot cambia preview 3D + nombre + role + tagline.
- [ ] Doble-click confirma → "Preparing arena…" breve → countdown 3-2-1-GO.
- [ ] **Decoración del pack ya visible al GO** (palmas/icebergs/cactus/corales/torii según el pack).
- [ ] 4 críticos en arena (jugador + 3 bots).
- [ ] HUD: timer 1:30, "Alive: 4", barras de habilidad con J/K/L sprites + cooldown overlay.
- [ ] Movimiento WASD responde inmediatamente.
- [ ] Headbutt con SPACE: anticipación + lunge + camera shake al impacto.
- [ ] J / K / L disparan ability con ícono + sonido + cooldown se aprecia.
- [ ] Caer al void → respawn con immunity blink (parpadeo blanco ~1.5 s).
- [ ] R en cualquier momento → restart limpio (vuelve a "Preparing arena…").
- [ ] T / ESC → vuelve a title screen sin DOM huérfano (sin emojis flotantes leftover).
- [ ] Pause con ESC durante match → menú Resume/Restart/Quit; resume reanuda input.

## 4. Online (Colyseus)

> Pre-requisito: `VITE_SERVER_URL` en Vercel apunta a `wss://` Railway domain.

- [ ] Tab A: nickname `Rafa1`, click "Online Multiplayer" → entra a waiting room.
- [ ] Waiting room muestra avatar(es) **NO en T-pose** (idle clip pose).
- [ ] Slot del jugador muestra "HUMAN" badge + nickname.
- [ ] Slots vacíos muestran "OPEN".
- [ ] Tab B: nickname `Rafa2` → ambos jugadores se ven en la sala.
- [ ] Si la sala no se llena en 60 s → bots con badge "🤖 BOT" rellenan automáticamente.
- [ ] Countdown empieza → "Preparing arena…" en cliente → GO.
- [ ] Movimiento de Tab A se ve en Tab B y vice versa con lerp suave (no teletransporte).
- [ ] Headbutt sync: cuando A golpea, B ve a su critter recibir knockback + camera shake en B.
- [ ] **Tab B con MISMO nickname `Rafa1`** mientras Tab A está activa → alert claro "This nickname is already active in another tab on this device" → vuelve a title sin colgar.
- [ ] **Servidor caído** simulado (apagar Railway momentáneamente o tirar la conexión): cliente muestra error de conexión y vuelve a title sin pantalla en blanco.
- [ ] Cerrar Tab A mid-match → bot toma el control del crítico de A; partida sigue.
- [ ] End screen consistente entre las dos pestañas (mismo winner / draw).

## 5. Personajes J/K/L (cada uno necesita 1 round mínimo)

> Marca [x] cuando hayas confirmado en partida real (offline u online).

- [ ] **Sergei** — J Gorilla Rush dash · K Shockwave radial AoE · L Frenzy (durante L, otros le golpean y casi no se mueve — confirmación visual del aguante).
- [ ] **Trunk** — J Trunk Ram (recorre claramente más que un dash normal) · K Trunk Grip (yank + stun: víctima queda quieta + recibe ×2 knockback) · L Stampede (Trunk como battering ram, los demás rebotan al choque).
- [ ] **Kurama** — J Fox Dash · K Mirror Trick (clon aparece DONDE activaste; Kurama aparece DETRÁS-ALEJADA; Kurama puede moverse durante el clon) · L Copycat (después de hacer headbutt a otro critter, **mini-icono del bichito target aparece en el slot L**; al activar L copia su mecánica).
- [ ] **Shelly** — J Shell Charge · K Steel Shell (Shelly inamovible mientras dura, otros rebotan al chocar) · L Saw Shell (gira + cualquier toque MANDA al enemigo MUY lejos; al terminar, no hay anim rara colgada).
- [ ] **Kermit** — J Leap Forward · K Poison Cloud (zona verde, slow + overlay vignette local SOLO cuando el viewer está dentro) · L Toxic Touch (al tocar enemigo, su input se invierte ~3 s).
- [ ] **Sihans** — J Burrow Rush · K Sand Trap (blink + quicksand zone) · L Sinkhole (**fragmentos REALES del arena se rompen + caen** delante de Sihans; centro nunca se rompe; un crítico que esté encima cae).
- [ ] **Kowalski** — J Ice Slide · K Snowball (proyectil; al impactar, target ❄️ frozen 5 s y reduce velocidad 50%) · L Frozen Floor (área amplia de hielo + dura ≥ 7 s; los enemigos resbalan).
- [ ] **Cheeto** — J Pounce · K Shadow Step (blink al enemigo más cercano + impact shockwave) · L Cone Pulse (Cheeto se queda quieto + frente sale anillo expansivo cada 0.30 s + sonido + camera shake; enemigos delante reciben push, detrás no).
- [ ] **Sebastian** — J Claw Rush · K Claw Wave (cono frontal con knockback fuerte) · L All-in (1 s vibración → dash lateral hacia un borde · HIT → enemy mandado lejos, Sebastian se PARA, control vuelve · MISS → Sebastian sigue y **cae al void**).

## 6. Estados / Iconos

- [ ] ❓ button abre legend overlay con los 8 emojis.
- [ ] **stunned 💫 + vulnerable 💥** en Trunk Grip target durante 4 s.
- [ ] **frozen ❄️** en Snowball target durante 5 s.
- [ ] **slowed 🐌** sobre cualquier crítico dentro de Sihans Quicksand.
- [ ] **poisoned ☠️** dentro de Kermit Cloud o tras Toxic Touch.
- [ ] **frenzy 🔥** sobre cualquier crítico con L active post-windup.
- [ ] **steel-shell 🛡️** sobre Shelly durante K active.
- [ ] **decoy-ghost 👻** sobre Kurama durante K active.
- [ ] Top-3 prioritario: si un crítico tiene >3 estados, solo aparecen los 3 más importantes.
- [ ] Iconos NO se quedan colgados al terminar match / restart / Quit-to-title.
- [ ] Iconos NO se quedan colgados cuando un crítico es eliminado.

## 7. Arena packs / decoración

- [ ] Cada match arranca con **un pack** rolled aleatoriamente entre los 5: jungle / frozen_tundra / desert_dunes / coral_beach / kitsune_shrine.
- [ ] **jungle** → palmas altas, ruinas, totem; sky degradado verde-noche.
- [ ] **frozen_tundra** → icebergs cyan, pinos nevados, signpost; sky azul claro.
- [ ] **desert_dunes** → cactus, sandstone spires, palm desert, bones, minecart, flag; sky atardecer.
- [ ] **coral_beach** → palm tilted, corales rosa/rojo, conchas, starfish, shipwreck, boulder; sky tropical.
- [ ] **kitsune_shrine** → torii rojo, sakura, kitsune statue, lanterns, bambúes; sky sunset.
- [ ] Decoración con presencia visual (palmas / sakura / torii ≈ 2.5× la altura del crítico más alto).
- [ ] Decoración NO bloquea zona de combate ni tapa críticos.
- [ ] Centro inmune (radio ≤ 2.5) siempre visible y libre.
- [ ] **Sin pop-in**: en el momento del "GO!", la decoración ya está colocada. Si tarda > 2.5 s en cargar, el "Preparing arena…" se queda hasta que termine; no aparece tras el GO.
- [ ] Fragmentos colapsan con warning + decoración encima cae con ellos.

## 8. UI / HUD

- [ ] Title screen: logo legible, botones grandes, hint de controles.
- [ ] Character select: 9 slots visibles, preview 3D no en T-pose, info pane (name/role/tagline/abilities).
- [ ] Match HUD: timer top-center 1:30, "Alive: N" debajo, 4 corner avatars con vidas + critter name + colored highlight para local player.
- [ ] Ability slots bottom-center: 3 sprites con keyboard hint (J/K/L) + cooldown overlay (conic-gradient).
- [ ] Status icons bottom-left settings (🔊/🎶/❓).
- [ ] **Mobile portrait** → "Please rotate your device" overlay con icono de móvil; no rompe orientación landscape.
- [ ] **Mobile landscape** → joystick virtual bottom-left + 4 botones touch (J/K/L + ⚡ headbutt) bottom-right.
- [ ] Gamepad conectado → toast bottom-right "🎮 Gamepad connected" + control activo (left stick / A / X / Y / RB).

## 9. End screen / restart

- [ ] Match termina con WIN / LOSS / DRAW correcto.
- [ ] Cámara reposiciona suavemente al critter ganador (no jumpcut).
- [ ] Subtitle distingue ganador humano vs ganador bot.
- [ ] "Press R / Click" para restart funciona.
- [ ] "Press T" / Quit vuelve a title sin emojis flotantes.
- [ ] Online: end screen consistente entre clientes (mismo winner reportado en ambas pestañas).
- [ ] Sin sub-cards de belt unlock vacíos / placeholders rotos. Si un belt unlock dispara, el toast aparece y desaparece limpio.
- [ ] Stats del match (kills / hits / abilities / falls) visibles para el local player.

## 10. Performance / carga

- [ ] Primera carga (cold cache) `< 5 s` hasta title screen interactivo. Aceptable < 8 s en conexión Slow 3G simulada.
- [ ] Segunda carga (warm cache) `< 1 s` hasta title.
- [ ] Match a 60 fps estable en desktop (DevTools → Performance, FPS counter).
- [ ] Mobile (mid-tier device) ≥ 30 fps.
- [ ] Sin memory leaks visibles tras 3-5 partidas seguidas (Memory tab → no crecimiento monótono).
- [ ] Sin glitches al cambiar de pack repetidamente (restart 5 veces → cada arena rueda bien).
- [ ] Audio playback OK: SFX al headbutt + ability + fall + respawn + victory.
- [ ] Music crossfade title → ingame → end sin clipping ni cortes bruscos.

## 11. Submission / VibeJam

- [x] `<script async src="https://vibej.am/2026/widget.js"></script>` presente en `index.html` (línea 2821).
- [x] Widget badge `<a href="https://vibej.am/...">🕹️ Vibe Jam 2026</a>` se inyecta y se ve bottom-right.
- [ ] Click en el widget badge abre la página oficial de Vibe Jam en pestaña nueva.
- [ ] No requiere login / signup.
- [ ] No requiere descarga.
- [ ] Free to play.
- [ ] Browser-native (no extensions ni plugins).
- [ ] AI-assisted compliance (Tripo, Meshy, Suno declarados en README).
- [ ] Submission form ya enviado el 2026-04-23 (per `SUBMISSION_CHECKLIST.md`); este pass solo confirma el estado del game para el jurado.

## 12. Limpieza de datos

- [x] Local DB tiene 1 player de prueba (`TestPlayer`). `npm run admin:delete-test` lo detecta correctamente. NO hay producción contaminada en local.
- [ ] **Producción** (Railway shell o `DATA_DIR` configurado): correr `npm run admin:list-players` y revisar.
- [ ] Si solo aparecen test players (`*test*`, `*qa*`, `*demo*`, `*foo*`, `*bar*`, `*temp*`, `*dummy*`):
   ```sh
   cd server
   npm run admin:delete-test            # dry-run preview
   npm run admin:delete-test -- --confirm   # actually delete
   ```
- [ ] Si hay players reales (de testers Discord / amigos / playtests previos): **NO borrar**, solo documentar la lista.
- [ ] Si necesitas reset total (último recurso, irreversible):
   ```sh
   npm run admin:reset-players -- --confirm --i-know-what-im-doing
   ```

## 13. Go / no-go final

> Tick **todo** lo de abajo antes de declarar "submit-ready". Cualquier `[!]` bloquea.

- [ ] Producción (sección 1) verde.
- [ ] Primer acceso (sección 2) sin errores rojos en consola.
- [ ] Offline funcional (sección 3) end-to-end al menos 1 partida completa.
- [ ] Online básico (sección 4) end-to-end con 2 humanos al menos 1 partida.
- [ ] Cada uno de los 9 críticos jugado al menos 1 round (sección 5).
- [ ] Status icons visibles + se limpian (sección 6).
- [ ] 5 packs vistos al menos 1 vez sin pop-in (sección 7).
- [ ] HUD legible en desktop + mobile landscape (sección 8).
- [ ] End screen + restart loop sin glitches (sección 9).
- [ ] 60 fps desktop / 30 fps mobile (sección 10).
- [ ] Widget VibeJam visible en producción (sección 11).
- [ ] Datos de producción saneados o documentados (sección 12).

---

## Last-minute fixes 2026-05-01 (submit-night, verificar específicamente)

> Estos siete puntos se cambiaron tras la prueba de Rafa en producción
> 2e34870. Confirmar antes del go-final.

- [ ] **Sebastian L**: durante el windup se ve una línea roja en el suelo apuntando hacia el borde por donde Sebastian va a salir. Hit más fácil que antes; miss sigue mandándolo al void.
- [ ] **Cheeto L**: la fuerza de cada pulso es CLARAMENTE el doble del anterior (al menos los 4 primeros). Pulso 5 y 6 ya cap.
- [ ] **Trunk K = Trunk Slam**: golpe amplio (radius 7) que knockback a todos los enemigos en el área Y los stunea brevemente (1 s). Si después le metes un cabezazo, sale volando ×4.
- [ ] **Trunk L = Trunk Grip**: agarra al enemigo más cercano en cono frontal hasta 28 u, lo trae al lado de Trunk, stun 5 s + ×4 vulnerable. Cabezazo posterior = mandado al carajo.
- [ ] **Kurama online**: usa K en la pestaña A; en la pestaña B verifica que Kurama vuelve a visible cuando se acaba el clon (NO se queda invisible permanente).
- [ ] **Multi-tab online**: pestaña A = "Rafa1" entra. Pestaña B mismo navegador = "Rafa2" entra. Antes daba problema, ahora no.
- [ ] **Mobile landscape**: en un móvil real (o DevTools 812×375), el character select muestra grid 3×3 + preview lado a lado, sin clipping.

## Microfixes 2026-05-01 (verificar específicamente)

> Estos seis bullets cambiaron en `fce9bd5` + `5d2d321`. Revísalos
> antes del go-final aunque las secciones 5-8 ya los cubran.

- [ ] **Sebastian L**: hit → enemigo vuela + Sebastian se PARA + control vuelve limpio. Miss → Sebastian sale al void inevitablemente.
- [ ] **Cheeto L**: cada pulso empuja MÁS que el anterior (escalado visible). Enemigo delante recibe push acumulativo.
- [ ] **Kurama K**: original casi invisible (alpha 0.08) durante el clon, en LOCAL Y EN REMOTO (online).
- [ ] **Kurama L**: chip de color con la inicial del bichito copiado se ve claro en el slot L. Tooltip al hover dice "Copycat target: X".
- [ ] **Trunk K**: alcanza enemigos a 28 u (casi todo el arena) PERO solo si están en cono frontal estrecho (35°).
- [ ] **Trunk L Stampede**: Trunk pasa cerca de un enemigo y lo MANDA a volar (nuevo flag `rammingL`). No hace falta headbutt.
- [ ] **HUD sprites**: settings buttons, hearts, bot-mask, end-screen crown/skull/trophy se ven como iconos generados (no emojis).

## Polish notes pendientes para post-jam

> No bloquean el submit. Documentados aquí para que no se olviden.

- [ ] **Belts / insignias 3D**: actualmente los belts en Hall of Belts y end-screen se muestran con imágenes 2D que tienen fondo cuadrado feo. Hay modelos 3D de belts (`public/models/belts/*.glb`, ~8 MB total) que podrían sustituir las imágenes con un thumbnail render. Click → modal con preview 3D rotable. POST-JAM: requiere ~2 horas de UI work, no toca gameplay.
- [ ] **Gamepad full validation**: el código soporta gamepad standard layout (left stick + A/B/X/Y + RB + Start) según `src/input.ts`. Rafa NO lo ha probado físicamente. El title-screen menciona "🎮 Gamepad auto-detected" sólo si es desktop sin touch. Si en post-jam se confirma que el mapping no encaja en algún navegador / mando concreto, el texto debería suavizarse a "Gamepad support (alpha)" o moverse a docs.
- [ ] **Limpieza usuarios test producción**: antes del submit, correr `cd server && DATA_DIR=<railway path> npm run admin:list-players` → si solo aparecen test patterns (test/qa/demo/foo/bar/temp/dummy), `npm run admin:delete-test -- --confirm`. Si aparecen jugadores reales (testers Discord), NO borrar.
- [ ] **Online smoke 2-tabs final** después de Railway redeploy: con `ce5a61f+` desplegado, verificar las 7 cosas de la sección "Last-minute fixes 2026-05-01" arriba.

## Riesgos go/no-go conocidos

- **Sihans L online**: el broadcast `arenaFragmentsKilled` es nuevo en este push. Si el server desplegado en Railway no tiene el código (`28ecbb0+`), los clientes verán el zone pero NO el agujero real. Asegurar que Railway autodeploy ha terminado antes del go.
- **Three.js chunk 627 kB**: warning de Vite acepteado. Cache estable, no bloquea.
- **`public/animations/` 57 MB**: ruta `/animations` en vercel.json, no enlazada desde game UI. Inocuo si no se navega ahí.
- **Trunk Stampede vs Sergei Frenzy clash**: ambos tienen mass × alto durante L. Si en playtest se descubre que es absurdo (uno empuja al otro literalmente sin física razonable), hay margen de tuning post-jam.
- **Cheeto Cone Pulse VFX online**: el ring expansivo se emite en `tickLOffline` (offline). En online el server emite `lPulse` events que el cliente maneja desde antes. Verificar que en online el VFX se ve igualmente al ejecutar Cheeto L en una segunda pestaña.
- **Audio autoplay**: navegadores requieren interacción del usuario antes de reproducir audio. Si la música no arranca al primer click, NO es bug — es policy del browser.
