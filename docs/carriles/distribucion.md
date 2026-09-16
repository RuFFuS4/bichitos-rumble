# Carril DISTRIBUCIÓN Y DATOS — servidor, red, despliegue, payload, estadísticas y tienda

Territorio y reglas: [`docs/SESIONES.md`](../SESIONES.md). Detalle en
`ONLINE.md`, `STACK.md`, `ROADMAP.md` (H5 monetización, H6 Steam) y
`ASSET_LICENSES.md`.

## Pendiente (por orden)

1. **El despliegue de H4.5, parado.** En producción sigue
   `v1.7-h4-social`: todo el terreno v2, el fondo y los dioramas viven
   solo en `dev` (`git log --oneline main..dev`). Cuando Rafa apruebe las
   capturas de `.tmp/shots-cierre/`, toca merge `dev` → `main` con
   `--no-ff` y tag (`v1.8-terreno-v2`). **Railway autodespliega el
   servidor desde `main`**, así que cliente y servidor salen a la vez:
   comprobar que los espejos del sim están sincronizados antes de mergear.
2. **Presupuesto de payload**: el ratchet está en 75 MB y la dist ronda
   70 → quedan ~5 MB. Los crítters son el 62 % del peso. Cualquier carril
   que quiera meter assets nuevos choca contigo: eres quien dice sí o no,
   y quien mantiene `scripts/check-payload-budget.mjs`.
3. **Limpiar la base de producción**: nicks `SMOKE*` / `Test*` de las
   campañas (`admin:delete-test`).
4. **Tabla multi-dispositivo de tokens** (diferido del review de
   networking de H4).
5. **Licencias y facturas de los assets de IA** (Meshy/Tripo): es un
   bloqueante NO técnico de la monetización, y H5 depende de él.
6. **Flag de build del portal para Steam** (`VITE_PORTAL=off`): el
   mecanismo de la URL lo hace el carril INTERFAZ; el empaquetado es
   tuyo.

## Lo que no puedes romper

- **Zona hard-stop de `CLAUDE.md`**: networking/Colyseus, build config y
  pipeline de despliegue. Plan antes de tocar.
- `server/src/sim/` **no es tuyo**: son espejos de los carriles ARENA y
  PERSONAJES. Tuyo es el resto de `server/`.
- El servidor solo manda `arenaSeed` + `arenaPackId`: la geometría se
  deriva en cliente. No mandes geometría por la red para "arreglar" un
  desajuste visual; es un bug de determinismo de otro carril.
- Nunca despliegues con el árbol sucio ni con ramas sin mergear de otros
  carriles.

## Buzón

*(Notas que te dejan otros carriles. Vacío.)*

## Cómo retomar

**2026-09-16** — carril recién creado, sin trabajo empezado. El punto 1
está a la espera de que Rafa apruebe las capturas; lo demás es trabajo
independiente que puede avanzar sin esperar a nadie.
