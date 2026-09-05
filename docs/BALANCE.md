# BALANCE.md — marco de balanceo de Bichitos Rumble

Doc vivo del balance del roster. Nace del replanteo del 2026-08-21
(Rafa: "quizás hay que replantear desde el inicio para balancear bien
ahora y en el futuro"). Historia detallada por ronda en
[BUILD_LOG.md](../BUILD_LOG.md) (entradas 2026-08-21).

## Marco v2 — las reglas

1. **P/W/S es el lenguaje de diseño** (potencia/peso/velocidad, −2..+2,
   fuente única en [src/pws-stats.ts](../src/pws-stats.ts) con copia
   byte-idéntica en server). Las barras del HUD lo hablan.
2. **Cero potencia fuera de presupuesto.** Todo lo que empuja, aguanta
   o esquiva puntúa: los overrides explícitos (`speed`/`headbuttForce`
   en critter.ts) y el `headbuttBoost` (multiplicador DIRECTO de fuerza
   en physics.ts) se tasan en puntos P/W/S equivalentes.
3. **Boost domado**: rango 1.0–1.5. Es el knob de "sensación de golpe"
   por critter, no una segunda P encubierta.
4. **Las mecánicas tienen fuerza en el balanceo** (principio de Rafa,
   2026-08-21): cuando tres iteraciones de tuning no mueven a un
   critter, la palanca correcta es una mecánica nueva de su identidad,
   no más números. Ver "Cola de mecánicas" abajo.
5. **El juicio final es empírico**: el presupuesto orienta, el batch
   decide. Los ejes NO pesan igual en la práctica (medido: la velocidad
   compra supervivencia cerca del borde más que la masa; el volumen de
   headbutts escala con S). Los pesos se calibran batch a batch.
6. **Caveat permanente**: el autopilot mide el **meta-bot** (lo que el
   jugador enfrenta), no el meta-jugador. Un critter de skill
   (puntería, timing de escudo) puede rendir mal en batch y bien en
   manos humanas. No nerfear/bufar solo por el batch a los de skill.

## Herramientas (dual-surface)

```bash
npm run balance       # presupuesto efectivo por critter + cruce con audits
npm run batch -- --matches=6 --seed=100 --player=Shelly --speed=8 --out=.tmp/x.json
npm run batch -- --verify --seed=7      # prueba de reproducibilidad
```

Flujo de iteración: `balance` → ajustar (tuners/código) → `batch` de
los tocados con los MISMOS seeds → comparar → BUILD_LOG. Detalles de
las herramientas en [DEV_TOOLS.md](../DEV_TOOLS.md).

## Estado del roster (2026-08-21, tras rondas 1-3)

Batch de referencia: 6 partidas/critter como jugador-autopilot, seeds
100-108, bots con conciencia del borde.

| Critter | Identidad | Wins | Notas |
|---|---|---|---|
| Trunk* | Bruiser "elefante que persigue" | 5/6 | Domado (boost 2.30→1.0, fuerza ef. 110→48): gana partidas largas, no de dos golpes. Vigilar. |
| Sihans | Trapper veloz | 4/6 | Gana por volumen (69 HB/p). Sano. |
| Kurama | Trickster | 3/6 | Boost 1.15: mismo resultado con 40% menos ruido. Sano. |
| Cheeto | Assassin | 3/6 | Sano. |
| Kowalski | Mage/zoner | 2-4/6 | Varianza de muestra; mejor wr como bot (29%). Sano. |
| Sergei | Baseline | 1/6 | Bajo pero es el punto cero del sistema. Vigilar. |
| Kermit | Controller | 1-2/6 | Bajo-medio. Vigilar en muestra mayor. |
| Sebastian | Glass Cannon | 0/6 | **Necesita mecánica** (skill-dependiente). |
| Shelly | Tank | 0/6 | **Necesita mecánica** (estructural a speed 8). |

`*` = lleva overrides explícitos fuera de la derivación P/W/S.

## Cola de mecánicas de balanceo (para la fase de mecánicas)

- [x] **Shelly — shell que castiga** (2026-08-24): reflect del golpe
  del atacante × `FEEL.collision.shellReflectFactor` (0.85) durante
  Steel Shell, cliente+server. Medido: recorta a Trunk (5→4 wins);
  no mueve el 0/6 de la propia Shelly en autopilot → su prueba real
  es playtesting humano (regla 6).
- [x] **Sebastian — que el cañón dispare** (2026-08-24): el cerebro
  distingue conos (coneAngleDeg) de AoE radial — la Claw Wave dispara
  con una víctima delante, no "rodeado ≥2". Def-driven. Mismo veredicto:
  el autopilot no lo refleja, playtesting humano.
- [ ] **PENDIENTE de playtesting de Rafa**: sentir shell-reflect y la
  Claw Wave en partida real antes de más iteración sobre estos dos. El
  autopilot tocó techo como instrumento aquí.
- Infra ya lista que ayuda: trigger defensivo del cerebro (bot.ts, se
  activa con cualquier def `tags: ['defensive']`), FEEL.bots tuneable
  desde el match lab, y el pipeline de signature moves des-riesgado
  (retarget Swing-Twist verificado con GLB Tripo — ver PORT_MAP.md del
  repo hermano).

## Deuda de sincronización server

Decisión offline-first (2026-08-19): el server se sincroniza al FINAL
de la fase de tuning. Ya sincronizado: pws-stats (copia byte-idéntica),
CRITTER_CONFIGS (boosts), bot con conciencia del borde. Pendiente de
espejar cuando toque: trigger defensivo del cerebro (el server no
conoce tags de kit) y cualquier mecánica nueva de la cola.
