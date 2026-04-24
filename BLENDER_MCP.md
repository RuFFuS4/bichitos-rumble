# Blender MCP — Bichitos Rumble

Alternativa al lab `/animations` (Mesh2Motion) para los críters cuyo
resultado en el lab sale flojo — los no-humanoides estándar: **Shelly**
(tortuga), **Sebastian** (cangrejo), **Kermit** (rana), **Sihans** (topo).
Para humanoides y cuadrúpedos felinos, `/animations` ya funciona bien
(ver [ASSET_PIPELINE.md](ASSET_PIPELINE.md)).

**Qué es**: [`ahujasid/blender-mcp`](https://github.com/ahujasid/blender-mcp)
— un servidor MCP (Model Context Protocol) que expone Blender a Claude
Code. Claude escribe y ejecuta scripts Python (`bpy`) directamente en una
sesión de Blender viva, mientras Blender actúa de motor visual. Claude no
"ve" el viewport, pero puede consultar el estado de la escena, crear
objetos, aplicar modificadores, configurar rigs, pintar weights y exportar.

MIT license. 16.3k stars (enero 2026). Ejemplo más complejo que también
valoramos: [`Dev-GOM/blender-toolkit`](https://github.com/Dev-GOM/claude-code-marketplace/tree/main/plugins/blender-toolkit/skills)
(Claude Code Skill con fuzzy bone mapping para Mixamo→rig custom).
Arrancamos con MCP primero; Toolkit se añade si lo necesitamos.

## Estado de instalación (snapshot)

- [x] `uv` package manager — `C:/Users/rafa_/AppData/Local/Microsoft/WinGet/Links/uvx.exe` — v0.11.7
- [x] Blender — `R:/[APPS-STEAM]/steamapps/common/Blender/blender.exe` — versiones 3.4, 3.6, 4.0, 4.1, 4.3, 5.1 (Steam multi-version)
- [x] Addon `addon.py` descargado — `tools/blender-mcp/addon.py` (v1.2, compatible Blender 3.0+)
- [x] MCP server configurado — `.mcp.json` (root)
- [x] MCP server autorizado — `enabledMcpjsonServers: ["blender"]` en `.claude/settings.local.json`
- [ ] Addon activado en Blender (paso manual, usuario)
- [ ] Primera conexión Claude ↔ Blender (paso manual, usuario)

## Por qué hay dos archivos de config

Claude Code separa la definición del servidor MCP (`.mcp.json`, checked-in)
de la autorización para ejecutarlo (`.claude/settings.local.json`,
gitignored per-user). Así:

- `.mcp.json` viaja con el repo — cualquier dev que clone ve que **existe**
  un servidor Blender MCP disponible.
- `settings.local.json` es per-usuario — cada dev decide si lo activa.

## Instalación paso a paso (usuario)

Lo que **tú** tienes que hacer (una sola vez):

### 1. Activar el addon en Blender

Abre Blender (cualquier versión 3.0+, idealmente 4.3 por máxima compat):

1. `Edit > Preferences > Add-ons`
2. Botón `Install...` (esquina superior derecha)
3. Selecciona `R:\Proyectos_Trabajos\WorkSpaces\Claude\bichitos-rumble\tools\blender-mcp\addon.py`
4. En la lista busca **"Interface: Blender MCP"** y activa el checkbox
5. Cierra preferences

### 2. Arrancar el servidor en el addon

Dentro del viewport 3D:

1. Pulsa `N` para abrir el sidebar lateral
2. Nueva pestaña **"BlenderMCP"** (o similar)
3. Botón **"Connect to Claude"** (o "Start MCP Server")
4. Debería mostrar algo como "Server running on port 9876"

Deja Blender abierto con esta pestaña activa durante toda la sesión.

### 3. Reiniciar Claude Code

El MCP server se descubre al arrancar. Mata la sesión actual y vuelve a
abrir Claude Code desde este directorio. En el primer arranque Claude Code
pedirá confirmación para aprobar `blender` — acepta.

Si todo va bien, al preguntarme algo de Blender tendré herramientas nuevas
disponibles (`mcp__blender__*`).

### 4. Test de humo

Una vez conectado, puedes probar con:

> "Dame una descripción de la escena actual de Blender"

Si responde con info de la escena (objetos, cámara, luces), está vivo.

## Workflow por crítter (cuando el setup esté activo)

Plan tentativo, ajustable según cómo se comporte:

1. **En Blender (usuario)**: `File > Open` el GLB del crítter desde
   `public/models/critters/<id>.glb`. Se importa la malla y la textura.
2. **En Claude Code**: _"Analiza el mesh importado. Crea un armature
   apropiado para este crítter: human para Sergei, spider para Sebastian,
   etc. Colócalo dentro del volumen del mesh."_
3. **En Claude Code**: _"Descarga desde Mixamo una animación idle humanoide
   y aplícala al rig actual. Verifica que no haya deformaciones extremas."_
   (Mixamo requiere login — este paso puede requerir intervención manual;
   alternativa: usar keyframes generados por IA, ver `blender-mcp`
   README).
4. **En Claude Code**: _"Renombra los clips para que coincidan con los
   keywords del SkeletalAnimator (idle, run, victory, defeat,
   headbutt_lunge, ability_1/2/3, fall, hit)."_
5. **En Blender (usuario)**: `File > Export > glTF 2.0` con Animation
   marcado. Sobrescribir `public/models/critters/<id>.glb`.
6. **En Claude Code**: _"Corre verify-critter-glbs.mjs sobre el GLB
   nuevo y reporta cuántos estados resolvieron."_
7. **Reload del juego** para verificar en runtime que el crítter se anima.

## Per-critter sanity checklist (post-import)

Aprendido en la primera pasada con Sergei (2026-04-20). Cualquier crítter
nuevo importado en Blender debe pasar estos chequeos antes de re-exportar.
Hay un script reutilizable que automatiza todos los pasos:
**`tools/blender-mcp/critter-cleanup.py`**.

Edita `CRITTER_ID` al principio del script y córrelo (Blender Text Editor
o vía `mcp__blender__execute_blender_code`). Por defecto NO re-exporta —
revisa renders + métricas antes y luego llama `export_critter()`.

### Los 7 chequeos

1. **OBJECT Mode** — el resto del pipeline asume modo objeto activo.
2. **Limpieza de pose state** — `pose_bone.location/rotation/scale` a
   identidad + detach de la action activa. **Razón**: Tripo3D y otros
   pipelines exportan el rig con un pose state pegado (no rest pose),
   que en Blender se ve como un personaje torcido / acuclillado en
   Object Mode aunque Edit Mode muestre T-pose limpio. Si no se
   limpia, el GLB exportado bind-poseará a esa postura.
   **Gotcha crítico**: NO cambies `pose_bone.rotation_mode` a un valor
   distinto del que usan las actions. Si las actions tienen keyframes
   en `rotation_euler[*]` (típico de Tripo3D/Mixamo) y fuerzas el bone
   a `'QUATERNION'`, los keyframes Euler quedan ignorados → el GLB
   exporta clips estáticos en T-pose aunque el `.blend` parezca correcto.
   El template detecta el modo objetivo escaneando `data_path` de las
   fcurves antes de tocar nada.
3. **ParentNode rotation reset** — pequeños yaws (1-5°) baked durante
   el import son comunes. `parent.rotation_euler = (0,0,0)`.
4. **Detección + borrado de actions placeholder** — actions con
   `fcurves == bone_count × 10` (3 loc + 4 quat + 3 scale por bone),
   2 keyframes idénticos por fcurve y value range = 0 son snapshots
   auto-generados. Reproducirlas fuerza el rig al bind pose →
   T-pose snap mid-gameplay (síntoma original del bug en Sergei).
5. **Snapshot de métricas** — guarda bones + lean de spine/brazos/
   piernas a `tools/{critter}-pose-baseline.json`. Útil para
   diff antes/después de cualquier ajuste manual.
6. **Render de 3 vistas ortográficas** — RIGHT (frente, +X), FRONT
   (lado, -Y), TOP (cenital, +Z). Salen a `tools/{critter}-views/`.
   Permite verificar visualmente la pose limpia sin tener que
   abrir Blender.
7. **Re-export con `use_selection=True`** — selecciona ParentNode +
   Armature + Mesh, descarta el resto (incluido `_reference`).

### Fallback runtime

Aunque la limpieza falle y se cuelen clips placeholder en el GLB,
`SkeletalAnimator` filtra al cargar todo clip cuya variance entre
keyframes sea 0 (ver `src/critter-skeletal.ts:isClipEffectivelyStatic`).
Logea `[SkeletalAnimator] dropped N static (bind-pose) clip(s)` en
consola. Esto evita el T-pose snap incluso si el GLB es sucio. La
limpieza en source es preferible — el filtro es solo seguridad.

### Reference floor (para verificar pies a nivel del suelo)

Hay una collection `_reference` con `_REFERENCE_FLOOR` (plane 5×5 a
nivel de pies) y `_REFERENCE_FORWARD` (cono apuntando a +X = front del
personaje). Ambos con `hide_render=True` así que `use_selection=True`
los descarta automáticamente al exportar. La crea el script
[`crear plane reference`](tools/blender-mcp/) si no existe.

## Animaciones via Tripo Animate (Kermit-style flow)

**Cuándo usarlo**: cuando el crítter ya se ha rigged en Tripo y se le han
generado animaciones directamente en Tripo Animate (cada clip tiene un
nombre tipo "Reposo", "Correr", "baile_05", etc). Flujo validado con
Kermit (2026-04-21).

**Gotcha crítico**: Tripo exporta los clips metidos en NLA tracks, y
al cargar el GLB los nombres semánticos **se pierden** — todos los
clips aparecen como `NlaTrack`, `NlaTrack.001`, `NlaTrack.002`, etc.
Hay que remapear manualmente por duración y contenido visual.

### Flujo

1. **En Tripo Animate**: genera las animaciones que quieras para el
   crítter. Apunta los nombres que asignas (ej. `Reposo`, `Correr`).
   Exporta el modelo con animaciones incluidas (GLB).

2. **Descarga + guarda**: deja el GLB en una carpeta clara, ej.
   `C:\Users\<user>\Downloads\Bichitos Rumble\Modelos\<Critter>+Anim\<Critter>.glb`.

3. **Inspección** (from repo root):
   ```bash
   node --input-type=module -e "
     import { NodeIO } from '@gltf-transform/core';
     const io = new NodeIO();
     const doc = await io.read('/ruta/a/Critter.glb');
     const anims = doc.getRoot().listAnimations();
     for (const a of anims) {
       let maxT = 0;
       for (const c of a.listChannels()) {
         const times = c.getSampler()?.getInput()?.getArray();
         if (times) maxT = Math.max(maxT, times[times.length - 1]);
       }
       console.log(a.getName(), '→', maxT.toFixed(2) + 's');
     }
   "
   ```
   Apunta las duraciones. Las extremas (la más larga y la más corta)
   suelen ser identificables: la más larga = baile / victory, la más
   corta = jump / ability_1.

4. **Pásale al usuario** las duraciones. Que te diga qué clip semántico
   (de los que el usuario asignó en Tripo) corresponde a cada índice
   `NlaTrack.XXX`.

5. **En Blender via MCP**: importa el GLB + renombra actions + joinea
   meshes + decimate + limpia pose + exporta. Pipeline batch:
   ```python
   RENAME_MAP = {
       'NlaTrack':     'Idle',
       'NlaTrack.001': 'Run',
       # …
   }
   for old, new in RENAME_MAP.items():
       act = bpy.data.actions.get(old)
       if act: act.name = new; act.use_fake_user = True
   # Join tripo_part_0..N into one mesh + decimate 0.02 ratio
   # Clean pose (XYZ mode, identity pose) + set Idle as active
   # Export to public/models/critters/<id>.glb
   ```

6. **Verifica** con `node scripts/verify-critter-glbs.mjs
   public/models/critters/<id>.glb` — cada clip renombrado debe
   resolver a un state del engine (idle, run, victory, defeat, fall,
   ability_1/2).

### Mapping de nombres Tripo → SkeletalState

La resolución es por keyword substring, ver `STATE_KEYWORDS` en
`src/critter-skeletal.ts`. Nombres sugeridos que resuelven limpio:

- `Idle`              → state `idle`
- `Run`               → state `run`
- `Walk`              → state `walk` (el engine no lo llama hoy,
  pero no estorba)
- `Victory`           → state `victory`
- `Defeat`            → state `defeat`
- `Fall`              → state `fall`
- `Hit`               → state `hit`
- `HeadbuttAnticip`   → state `headbutt_anticip`
- `HeadbuttLunge`     → state `headbutt_lunge`
- `Ability1<Name>`    → state `ability_1` (ej. `Ability1LeapForward`)
- `Ability2<Name>`    → state `ability_2` (ej. `Ability2PoisonCloud`)
- `Ability3<Name>`    → state `ability_3` (ej. `Ability3Frenzy`)
- `Respawn`           → state `respawn`

### Qué hacer con los estados sin clip

Si faltan clips (caso normal — Tripo no genera todos los 13 estados),
el engine cae automáticamente a la capa procedural
(`critter-animation.ts`): bob, squash/stretch, lean, sway, emissive.
Para un ulti con identidad visual fuerte sin clip skeletal, añade
un flicker / color swap en `updateVisuals()` dentro de `critter.ts`
condicionado al `config.name` del crítter. Ejemplo real: Kermit
`Hypnosapo` (ability_3) sin clip → flicker morado/rosa vía emissive
(ver `critter.ts` → `updateVisuals` → branch `frenzy + name==='Kermit'`).

## Plantilla de animaciones por crítter

Archivo: `tools/blender-mcp/<critter>-animations.yml`. Ejemplo base:
[`sergei-animations.yml`](tools/blender-mcp/sergei-animations.yml).

Contiene los 13 states que el engine resuelve (`idle`, `walk`, `run`,
`headbutt_anticip/_lunge`, `ability_1/2/3`, `victory`, `defeat`, `fall`,
`hit`, `respawn`) con `duration` y `loop` razonables por defecto. El
usuario rellena `hint` (descripción en prosa) y/o `keyframes` (valores
precisos por bone).

**Flujo**:
1. Usuario edita el YAML (o solo escribe hints).
2. Pasa el archivo a Claude: _"aplica la plantilla en Blender"_.
3. Claude lee el YAML, genera actions vía bpy (una por state), re-exporta
   el GLB (`export_animations=True` esta vez porque las queremos).
4. Reload del juego → clips reales.

**Gotchas del formato**:
- Rotation en **grados Euler XYZ**, location en **metros**.
- Sólo bones que SE MUEVEN. Twist bones (auxiliares de deformación)
  quedan fuera del keyframed manual.
- Último keyframe == primero para loops limpios (idle/walk/run).
- Sign-flips comunes cuando el bone roll no coincide con el axis
  convencional — se ajusta en iteración, no hace falta adivinar a ciegas.
- Actions pesadas (headbutt_lunge, abilities, victory, defeat, fall,
  hit) suprimen la capa procedural durante playback (HEAVY_STATES en
  `critter-skeletal.ts`) — autora poses completas.
- idle/walk/run coexisten con procedural → basta motion primaria.

## Notas de compatibilidad

- **Blender 5.1 vs 4.3**: el addon declara `"blender": (3, 0, 0)` como
  mínimo, así que 5.1 debería funcionar. Si algo peta, Steam permite
  cambiar a 4.3 desde la misma instalación sin reinstalar — suele ser la
  versión más testeada por la comunidad MCP.
- **Draco**: algunos exports GLB de Blender usan Draco compression por
  defecto. El `model-loader.ts` del juego carga Draco OK; el lab
  `/animations` probablemente también. No cambia nada, solo observación.
- **Scale**: Blender usa metros y Three.js usa unidades genéricas. Los
  críters del juego miden ~1 unidad. Al importar el GLB en Blender, si se
  ve de 1m de alto, es el mismo tamaño.

## Troubleshooting

- **"Server not found" al arrancar Claude Code**: verifica que `.mcp.json`
  existe en la raíz del proyecto y que `blender` está en
  `enabledMcpjsonServers` en `settings.local.json`.
- **Claude arranca pero no tiene las tools de Blender**: el addon de
  Blender no está corriendo el server. Dentro del viewport, sidebar (N),
  pestaña BlenderMCP, pulsa Connect/Start.
- **`uvx blender-mcp` cuelga al arrancar**: probablemente primera
  instalación del package Python — dale 1-2 minutos. Si sigue, prueba
  manualmente `"C:/Users/rafa_/AppData/Local/Microsoft/WinGet/Links/uvx.exe" blender-mcp`
  en una terminal y mira el error.
- **Blender 5.1 rechaza el addon**: instálalo en la versión 4.3 del
  mismo Steam package. Los perfiles de usuario se comparten entre
  versiones dentro de `%APPDATA%\Blender Foundation\Blender\`.
- **Deformación extrema tras aplicar rig**: mismo problema que con
  `/animations` — el rig humanoide genérico no encaja con un crítter
  cuadrúpedo/raro. Pide a Claude que pre-ajuste los joints al volumen del
  mesh antes de aplicar animaciones.

## Archivos relevantes

- `.mcp.json` — define el servidor `blender` (comando + args).
- `.claude/settings.local.json` — autoriza el servidor en
  `enabledMcpjsonServers`.
- `tools/blender-mcp/addon.py` — el addon que se instala dentro de
  Blender.

## Alternativa si el MCP no es suficiente

Blender Toolkit (`Dev-GOM/blender-toolkit`) es un Claude Code Skill (no
MCP server) con lógica de más alto nivel para retargeting
Mixamo→rig-custom con fuzzy bone matching y workflow de dos fases. Si el
MCP directo genera demasiada fricción, Toolkit es la siguiente apuesta.
Install via `claude mcp add <marketplace>` o descarga manual. Ver
[CLAUDE.md](CLAUDE.md) y la discusión en la conversación original.

## Propuesta cuando esté probado

Si el flujo con MCP funciona para al menos uno de los críters difíciles
(Shelly o Sebastian son los más informativos), lo documentamos aquí
con el comando exacto que dio buen resultado, y se convierte en el
camino oficial para no-humanoides. Los humanoides siguen pasando por
`/animations` que es más rápido.
