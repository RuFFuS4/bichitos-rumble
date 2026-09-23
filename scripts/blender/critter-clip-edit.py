# ---------------------------------------------------------------------------
# critter-clip-edit.py — edita UN clip de un GLB de bicho dentro de Blender
# ---------------------------------------------------------------------------
#
# Lo llama scripts/critter-recipe.mjs (no hace falta abrir Blender a mano):
#
#   blender -b --factory-startup --python scripts/blender/critter-clip-edit.py -- \
#       <src.glb> <out.glb> <params.json>
#
# Probado con Blender 5.2 (API de action slots / channelbags). Exporta SIN
# meshopt: el GLB de salida es solo el "donante" del que la receta copia los
# canales editados al GLB del juego, que así conserva su codificación.
#
# params.json (todas las secciones son opcionales y se aplican en este orden):
#   {
#     "clip": "Run",
#     "hold": [                       fija la rotación local de un hueso a la de
#       { "bone": "Pelvis",           otro clip (p. ej. la pelvis del Idle) en
#         "fromClip": "Idle",         todos los fotogramas; va antes del IK, que
#         "frame": 0 }                recoloca las piernas desde ahí
#     ],
#     "ik": {                         reescribe la trayectoria de los pies
#       "d": 0.3,                     fracción del ciclo con el pie apoyado
#       "L": 0.11,                    zancada (unidades de modelo)
#       "H": 0.035,                   altura del paso
#       "D": 0.035,                   agachado constante de la raíz
#       "A": 0.008,                   rebote de la raíz (dos por ciclo)
#       "phaseL": 0.14,               fase de mitad de apoyo del pie izquierdo
#       "x0": 0.02,                   centro del apoyo (si falta: el del clip)
#       "footFlat": true              pie plano mientras apoya
#     },
#     "torso": {                      endereza (o inclina) el tronco
#       "bone": "Waist",              hueso que se gira (arrastra lo de encima)
#       "base": "Waist", "tip": "Head",   segmento con el que se mide
#       "pitchDeg": 6                 inclinación media hacia delante buscada
#     }
#   }
#
# Convenciones del rig (Tripo): Z arriba, +X adelante, +Y a la izquierda del
# bicho; huesos L_/R_ Thigh, Calf, Foot y Root. La inclinación se mide como
# atan2(adelante, arriba) del segmento base.head → tip.tail.
# ---------------------------------------------------------------------------
import bpy, sys, math, json
from mathutils import Quaternion, Vector, Matrix
from bpy_extras import anim_utils

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, PARAMS = argv[0], argv[1], argv[2]
with open(PARAMS, encoding='utf-8') as fh:
    P = json.load(fh)
CLIP = P.get('clip', 'Run')
FWD, UP, SIDE = Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
scene.render.fps_base = 1.0
bpy.ops.import_scene.gltf(filepath=SRC, disable_bone_shape=True)

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
if arm.matrix_world != Matrix.Identity(4):
    raise SystemExit('[edit] el armature no está en el origen; este script asume su espacio = mundo')
ad = arm.animation_data
orig_active = ad.action
act = bpy.data.actions[CLIP]
slot = act.slots[0]
cb = anim_utils.action_get_channelbag_for_slot(act, slot)
F0, F1 = int(round(act.frame_range[0])), int(round(act.frame_range[1]))
FRAMES = list(range(F0, F1 + 1))
N = F1 - F0
pb = arm.pose.bones
ad.action = act
ad.action_slot = slot
print(f'[edit] {CLIP}: fotogramas {F0}-{F1}')


def write_quat_keys(bone, quats):
    path = f'pose.bones["{bone}"].rotation_quaternion'
    fcs = [cb.fcurves.find(path, index=i) for i in range(4)]
    if any(fc is None for fc in fcs):
        fcs = [cb.fcurves.new(path, index=i, group_name=bone) for i in range(4)]
    prev = None
    for q in quats:
        if prev is not None and prev.dot(q) < 0:
            q.negate()
        prev = q
    for i, fc in enumerate(fcs):
        fc.keyframe_points.clear()
        fc.keyframe_points.add(len(FRAMES))
        for kp, fr, q in zip(fc.keyframe_points, FRAMES, quats):
            kp.co = (fr, q[i])
            kp.handle_left = (fr, q[i])
            kp.handle_right = (fr, q[i])
            kp.interpolation = 'LINEAR'
        fc.update()


def edit_hold(holds):
    for h in holds:
        bone = pb[h['bone']]
        # Los hijos (p. ej. los muslos) conservan su orientación en el espacio
        # del armature: sin esto giran con la pelvis y el IK arranca de una
        # pierna apuntando a cualquier sitio (rodilla invertida en un fotograma).
        kids = [c.name for c in bone.children]
        before = {c: [] for c in kids}
        for f in FRAMES:
            scene.frame_set(f)
            for c in kids:
                before[c].append(pb[c].matrix.copy())
        src = bpy.data.actions[h['fromClip']]
        ad.action, ad.action_slot = src, src.slots[0]
        scene.frame_set(int(h.get('frame', 0)))
        q = bone.rotation_quaternion.copy()
        ad.action, ad.action_slot = act, slot
        write_quat_keys(bone.name, [q.copy() for _ in FRAMES])
        for c in kids:
            quats = []
            for i, f in enumerate(FRAMES):
                scene.frame_set(f)
                quats.append(arm.convert_space(pose_bone=pb[c], matrix=before[c][i], from_space='POSE', to_space='LOCAL').to_quaternion())
            write_quat_keys(c, quats)
        print(f'[hold] {bone.name} fijo a {h["fromClip"]}@{h.get("frame", 0)} (hijos en su sitio: {", ".join(kids)})')


def report_jumps(bones, warn_deg=25.0, limit_deg=90.0):
    """Mayor giro entre fotogramas seguidos de cada hueso horneado. Más de
    90° es una rodilla que se da la vuelta (tirón del pie): para la receta.
    Entre 25 y 90 solo avisa: con la pierna muy plegada en el vuelo, una
    pantorrilla corta gira rápido sin mover el pie (compruébalo en el juego
    con stride-probe/critter-motion)."""
    worst = []
    for b in bones:
        prev = None
        top = 0.0
        for f in FRAMES:
            scene.frame_set(f)
            q = pb[b].matrix.to_quaternion()
            if prev is not None:
                a = prev.rotation_difference(q).angle          # 0..2π: q y −q son el mismo giro
                top = max(top, math.degrees(min(a, 2 * math.pi - a)))
            prev = q
        worst.append((top, b))
    worst.sort(reverse=True)
    print('[saltos] máximo entre fotogramas: ' + ', '.join(f'{b} {t:.0f}°' for t, b in worst[:4]))
    if worst[0][0] > limit_deg:
        raise SystemExit(f'[saltos] {worst[0][1]} gira {worst[0][0]:.0f}° de un fotograma al siguiente (límite {limit_deg:.0f}°)')
    if worst[0][0] > warn_deg:
        print(f'[saltos] AVISO: {worst[0][1]} gira {worst[0][0]:.0f}° entre fotogramas; mira el pie en el juego')


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def sample_legs():
    """Tobillo (cola de la pantorrilla) y giro del pie del clip SIN editar:
    el suelo y la huella salen de aquí aunque `hold` mueva la pelvis."""
    orig = {s: [] for s in ('L', 'R')}
    for f in FRAMES:
        scene.frame_set(f)
        for s in orig:
            orig[s].append({'ankle': pb[f'{s}_Calf'].tail.copy(), 'footRot': pb[f'{s}_Foot'].matrix.to_quaternion()})
    return orig


def edit_ik(p, orig):
    d, L, H = float(p.get('d', 0.3)), float(p.get('L', 0.12)), float(p.get('H', 0.05))
    D, A = float(p.get('D', 0.03)), float(p.get('A', 0.012))
    phaseL = float(p.get('phaseL', 0.66))
    foot_flat = bool(p.get('footFlat', True))
    sides = {'L': phaseL % 1.0, 'R': (phaseL + 0.5) % 1.0}
    # 1) Suelo, centro del apoyo y pie plano, medidos en el clip original.
    info = {}
    for s in sides:
        zs = [o['ankle'].z for o in orig[s]]
        imin = min(range(len(zs)), key=lambda i: zs[i])
        x0 = float(p['x0']) if 'x0' in p else sum(o['ankle'].x for o in orig[s]) / len(zs)
        info[s] = {'zg': min(zs), 'x0': x0, 'y': sum(o['ankle'].y for o in orig[s]) / len(zs), 'flat': orig[s][imin]['footRot']}
    # 2) Raíz: agachado + rebote, con el mínimo en mitad de cada apoyo.
    root = pb['Root']
    to_local = root.bone.matrix_local.to_3x3().inverted()
    loc0 = root.location.copy()
    for i, f in enumerate(FRAMES):
        dz = -D - A * math.cos(4 * math.pi * (i / N - sides['L']))
        root.location = loc0 + to_local @ Vector((0, 0, dz))
        root.keyframe_insert('location', frame=f)

    # 3) Objetivo del tobillo: recto hacia atrás al apoyar, en arco al volar.
    def ankle_target(s, ph):
        psi = ((ph - sides[s] + 0.5) % 1.0) - 0.5      # 0 = mitad del apoyo
        I = info[s]
        if abs(psi) <= d / 2:
            return Vector((I['x0'] - L * psi / d, I['y'], I['zg'])), 1.0
        u = (psi - d / 2) % 1.0 / (1 - d)                 # 0 despegue → 1 aterrizaje
        x = I['x0'] - L / 2 + L * (0.5 - 0.5 * math.cos(math.pi * u))
        z = I['zg'] + H * math.sin(math.pi * u)
        return Vector((x, I['y'], z)), 1.0 - smoothstep(0.0, 0.3, u) * (1.0 - smoothstep(0.7, 1.0, u))

    # 4) IK analítico de dos huesos: la rodilla siempre hacia `pole` (adelante
    #    por defecto), así que no puede invertirse de un fotograma a otro como
    #    el solver de Blender sin polo. Cada hueso gira lo mínimo desde su pose
    #    original, que conserva su giro sobre sí mismo (twist).
    pole = Vector(p.get('pole', [1, 0, 0])).normalized()
    # Soft IK: cerca de la pierna estirada el ángulo de rodilla cambia a
    # saltos (46° en un fotograma con la pantorrilla corta de Kowalski). En
    # el último `soft` de la longitud de la pierna el tobillo se queda
    # corto de forma suave: el pie cede unos milímetros en vez del tirón.
    soft_frac = float(p.get('soft', 0.08))
    view_layer = bpy.context.view_layer

    def soften(dist, reach):
        soft = soft_frac * reach
        knee_lock = reach - soft
        if soft <= 0 or dist <= knee_lock:
            return dist
        return knee_lock + soft * (1 - math.exp(-(dist - knee_lock) / soft))

    def aim(bone, old_dir, new_dir):
        R = old_dir.rotation_difference(new_dir).to_matrix()
        M = (R @ bone.matrix.to_3x3()).to_4x4()
        M.translation = bone.head
        bone.matrix = M
        view_layer.update()

    baked = {f'{s}_{b}': [] for s in sides for b in ('Thigh', 'Calf', 'Foot')}
    worst = 0.0
    reach = {s: [] for s in sides}      # distancia cadera→tobillo / (muslo + pantorrilla)
    for i, f in enumerate(FRAMES):
        scene.frame_set(f)
        for s in sides:
            th, ca, fo = pb[f'{s}_Thigh'], pb[f'{s}_Calf'], pb[f'{s}_Foot']
            hip = th.head.copy()
            a = (ca.head - hip).length
            b = (fo.head - ca.head).length
            tgt, w = ankle_target(s, i / N)
            u = (tgt - hip).normalized()
            dist = min(max(soften((tgt - hip).length, a + b), abs(a - b) + 1e-6), a + b - 1e-6)
            v = (pole - u * pole.dot(u)).normalized()
            cos_h = (a * a + dist * dist - b * b) / (2 * a * dist)
            knee = hip + a * (cos_h * u + math.sqrt(max(0.0, 1 - cos_h * cos_h)) * v)
            ankle = hip + u * dist
            worst = max(worst, (ankle - tgt).length)
            reach[s].append(((tgt - hip).length / (a + b), f))
            aim(th, ca.head - hip, knee - hip)
            aim(ca, fo.head - ca.head, ankle - ca.head)
            if foot_flat:
                q0, qf = orig[s][i]['footRot'], info[s]['flat']
                q = (q0 if q0.dot(qf) >= 0 else -q0).slerp(qf, w)
                M = q.to_matrix().to_4x4()
                M.translation = fo.head
                fo.matrix = M
                view_layer.update()
            for bone in (th, ca, fo):
                baked[bone.name].append(bone.rotation_quaternion.copy())
    print(f'[ik] error máximo del tobillo al objetivo: {worst:.4f}')
    for s in sides:
        lo, hi = min(reach[s]), max(reach[s])
        print(f'[ik] pierna {s}: extensión {lo[0]:.2f} (f{lo[1]}) .. {hi[0]:.2f} (f{hi[1]}) — 1 = estirada, '
              f'{abs(a - b) / (a + b):.2f} = plegada del todo')
    if worst > 0.004:
        print('[ik] AVISO: la pierna no llega al objetivo en algún fotograma (baja L o H, o sube D)')
    for bn, qs in baked.items():
        write_quat_keys(bn, qs)
    report_jumps(list(baked))


def torso_pitches(base, tip):
    out = []
    for f in FRAMES:
        scene.frame_set(f)
        v = pb[tip].tail - pb[base].head
        out.append(math.degrees(math.atan2(v.dot(FWD), v.dot(UP))))
    return out


def edit_torso(p):
    bone, base, tip = p.get('bone', 'Waist'), p.get('base', 'Waist'), p.get('tip', 'Head')
    before = torso_pitches(base, tip)
    mean = sum(before) / len(before)
    # Girar sobre +Y suma inclinación hacia +X (adelante): theta = objetivo − media.
    R = Quaternion(SIDE, math.radians(float(p['pitchDeg']) - mean)).to_matrix()
    quats = []
    for f in FRAMES:
        scene.frame_set(f)
        b = pb[bone]
        M = (R @ b.matrix.to_3x3()).to_4x4()
        M.translation = b.matrix.translation
        quats.append(arm.convert_space(pose_bone=b, matrix=M, from_space='POSE', to_space='LOCAL').to_quaternion())
    write_quat_keys(bone, quats)
    after = torso_pitches(base, tip)
    print(f'[torso] inclinación media {mean:.1f}° → {sum(after) / len(after):.1f}° '
          f'(oscila {min(after):.1f}..{max(after):.1f})')


legs = sample_legs() if 'ik' in P else None
if 'hold' in P:
    edit_hold(P['hold'])
if 'ik' in P:
    edit_ik(P['ik'], legs)
if 'torso' in P:
    edit_torso(P['torso'])

ad.action = orig_active
ad.action_slot = orig_active.slots[0]
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animation_mode='ACTIONS')
print('[edit] exportado', OUT)
