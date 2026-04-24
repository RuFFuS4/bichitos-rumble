"""
Per-critter import sanity script — Bichitos Rumble.

Runs in a Blender session that just imported a critter GLB. Performs the
cleanup checklist we wrote during Sergei's first rigging pass:

  1. Detach any active action so leftover pose state from animation
     playback doesn't pollute what we see at frame 0.
  2. Clear pose transforms on every bone → mesh in Object Mode shows
     the rest pose (matches Edit Mode T/A-pose). 99% of "torcido" /
     "twisted" complaints came from non-identity pose state, not the
     rest pose.
  3. Reset ParentNode rotation (small yaws baked from Tripo3D / other
     pipelines are common — clear them).
  4. Detect "placeholder" actions: fcurves == bone_count × 10 with
     2 keyframes per fcurve and value range == 0 across all of them.
     These force the rig to bind pose during playback → in-game
     T-pose snap on whatever state they map to.
  5. Snapshot bones + lean metrics to JSON for diffing later.
  6. Render 3 ortho views (RIGHT/FRONT/TOP) with the reference floor
     hidden so framing only includes the critter.

Usage:
    Edit CRITTER_ID below, then either:
      a) Open Blender, paste this script in the Text Editor, Run.
      b) Via Claude+MCP: paste the file contents into
         mcp__blender__execute_blender_code.

  CRITTER_ID drives all the file paths. The mesh is found by name
  pattern "<CritterName>_Mesh" (case-insensitive) — adjust if your
  rig has a different convention.

Outputs (under tools/):
    {critter}-pose-baseline.json
    {critter}-views/{01,02,03}_*.png

Re-export is NOT done automatically — review the renders + metrics
first, then call export_critter() at the bottom (or do File > Export
manually).
"""

import bpy
import bmesh  # noqa: F401  (kept handy for future ops)
import os
import json
import math
import mathutils

# ---------------------------------------------------------------------------
# Per-critter config — EDIT THIS PER CRITTER
# ---------------------------------------------------------------------------
CRITTER_ID = "sergei"
ARMATURE_NAME = "Armature"   # what the imported GLB calls its armature
PARENT_EMPTY = "ParentNode"  # the EMPTY node above the armature, if any

REPO_ROOT = r"R:\Proyectos_Trabajos\WorkSpaces\Claude\bichitos-rumble"

# Actions known to be auto-generated bind-pose snapshots from earlier
# pipeline experiments. Override or extend if you add new ones in Blender.
PLACEHOLDER_ACTION_NAMES = (
    'Ability1Rush', 'Ability2Shockwave', 'Ability3Frenzy', 'Anticip',
    'Defeat', 'Fall', 'HeadbuttLunge', 'Hit', 'Respawn', 'Victory', 'Walk',
)

# ---------------------------------------------------------------------------
# Derived paths
# ---------------------------------------------------------------------------
EXPORT_PATH = os.path.join(REPO_ROOT, "public", "models", "critters", f"{CRITTER_ID}.glb")
BASELINE_PATH = os.path.join(REPO_ROOT, "tools", f"{CRITTER_ID}-pose-baseline.json")
VIEWS_DIR = os.path.join(REPO_ROOT, "tools", f"{CRITTER_ID}-views")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_mesh(critter_id: str):
    """Mesh name convention is '<Critter>_Mesh' (e.g. 'Sergei_Mesh')."""
    capital = critter_id.capitalize()
    candidates = (f"{capital}_Mesh", f"{critter_id}_Mesh", f"{capital}Mesh")
    for name in candidates:
        obj = bpy.data.objects.get(name)
        if obj and obj.type == 'MESH':
            return obj
    # Fallback: any mesh in the scene parented to the armature
    arm = bpy.data.objects.get(ARMATURE_NAME)
    if arm:
        for obj in bpy.data.objects:
            if obj.type == 'MESH' and obj.parent == arm:
                return obj
    return None


def _force_object_mode():
    if bpy.context.mode != 'OBJECT':
        if not bpy.context.view_layer.objects.active:
            bpy.context.view_layer.objects.active = next(iter(bpy.data.objects), None)
        try:
            bpy.ops.object.mode_set(mode='OBJECT')
        except Exception as e:
            print(f"  [warn] mode_set failed: {e}")


def _deselect_all():
    """No operator — works in any mode."""
    for o in bpy.data.objects:
        o.select_set(False)


# ---------------------------------------------------------------------------
# Step 1+2: pose cleanup
# ---------------------------------------------------------------------------

def clear_pose_state():
    """Clear active action + reset every pose bone to identity."""
    arm_obj = bpy.data.objects.get(ARMATURE_NAME)
    if not arm_obj:
        print(f"  [skip] no armature '{ARMATURE_NAME}'")
        return

    if arm_obj.animation_data:
        arm_obj.animation_data.action = None

    # Detect what the actions target — euler vs quaternion — so we keep
    # bones in the matching rotation_mode. If we silently switch a bone
    # to QUATERNION while the action animates rotation_euler[*], the
    # keyframes are silenced and the GLB ships a static T-pose clip
    # (lesson learned the hard way on Sergei: clip looked alive in
    # Blender but exported as an effectively static T-pose).
    targets_euler = False
    targets_quat = False
    for action in bpy.data.actions:
        for layer in action.layers:
            for strip in layer.strips:
                for slot in action.slots:
                    try:
                        cb = strip.channelbag(slot, ensure=False)
                    except Exception:
                        cb = None
                    if not cb:
                        continue
                    for fc in cb.fcurves:
                        if 'rotation_euler' in fc.data_path:
                            targets_euler = True
                        elif 'rotation_quaternion' in fc.data_path:
                            targets_quat = True

    if targets_euler and not targets_quat:
        target_mode = 'XYZ'
    elif targets_quat and not targets_euler:
        target_mode = 'QUATERNION'
    elif targets_euler and targets_quat:
        # Mixed — pick XYZ as safer default; user can override per bone after
        target_mode = 'XYZ'
        print("  [warn] actions mix euler + quaternion; defaulting bones to XYZ")
    else:
        # No actions found (or no rotation keyframes); leave bones alone
        target_mode = None

    cleared = 0
    for pb in arm_obj.pose.bones:
        if target_mode and pb.rotation_mode != target_mode:
            pb.rotation_mode = target_mode
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.rotation_euler = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
        cleared += 1
    print(f"  bone rotation_mode aligned to action target: {target_mode}")
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    print(f"  cleared pose transforms on {cleared} bones")


# ---------------------------------------------------------------------------
# Step 3: ParentNode yaw cleanup
# ---------------------------------------------------------------------------

def clear_parent_rotation():
    parent = bpy.data.objects.get(PARENT_EMPTY)
    if not parent:
        return
    rot_deg_before = [c * 57.2958 for c in parent.rotation_euler]
    parent.rotation_euler = (0.0, 0.0, 0.0)
    rot_deg_after = [c * 57.2958 for c in parent.rotation_euler]
    if any(abs(v) > 0.01 for v in rot_deg_before):
        print(f"  ParentNode rotation reset: {rot_deg_before} → {rot_deg_after}")


# ---------------------------------------------------------------------------
# Step 4: placeholder action detection + cleanup
# ---------------------------------------------------------------------------

def is_placeholder_action(action, bone_count: int) -> bool:
    """An auto-generated bind-pose snapshot has fcurves == bone_count × 10
    (3 location + 4 quaternion + 3 scale) AND every fcurve has 2 keyframes
    AND every keyframe pair is identical (value range == 0).
    """
    expected_fcurves = bone_count * 10
    fcurves_seen = 0
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                try:
                    cb = strip.channelbag(slot, ensure=False)
                except Exception:
                    cb = None
                if not cb:
                    continue
                for fc in cb.fcurves:
                    fcurves_seen += 1
                    kps = list(fc.keyframe_points)
                    if len(kps) > 3:
                        return False  # real animation has more keys
                    if len(kps) < 2:
                        continue
                    vals = [kp.co[1] for kp in kps]
                    if max(vals) - min(vals) > 1e-5:
                        return False  # has variance → real
    if fcurves_seen != expected_fcurves:
        return False
    return True


def detect_and_remove_placeholders():
    """Scan all actions, drop the ones that look auto-generated."""
    arm = bpy.data.armatures.get(ARMATURE_NAME)
    if not arm:
        return
    bone_count = len(arm.bones)
    flagged = []
    for action in list(bpy.data.actions):
        if action.name in PLACEHOLDER_ACTION_NAMES or is_placeholder_action(action, bone_count):
            flagged.append(action.name)
    for name in flagged:
        action = bpy.data.actions.get(name)
        if action:
            bpy.data.actions.remove(action)
    print(f"  removed {len(flagged)} placeholder action(s): {flagged or '(none)'}")
    print(f"  remaining actions: {[a.name for a in bpy.data.actions]}")


# ---------------------------------------------------------------------------
# Step 5: bone metrics snapshot
# ---------------------------------------------------------------------------

def snapshot_metrics():
    arm = bpy.data.armatures.get(ARMATURE_NAME)
    arm_obj = bpy.data.objects.get(ARMATURE_NAME)
    if not (arm and arm_obj):
        return None

    # Per-bone positions
    bones = {}
    for b in arm.bones:
        head_w = arm_obj.matrix_world @ b.head_local
        tail_w = arm_obj.matrix_world @ b.tail_local
        bones[b.name] = {
            "head_world": [round(c, 5) for c in head_w],
            "tail_world": [round(c, 5) for c in tail_w],
            "head_local": [round(c, 5) for c in b.head_local],
            "tail_local": [round(c, 5) for c in b.tail_local],
            "length": round(b.length, 5),
            "parent": b.parent.name if b.parent else None,
        }

    # Object transforms
    objects = {}
    for name in (PARENT_EMPTY, ARMATURE_NAME):
        obj = bpy.data.objects.get(name)
        if obj:
            objects[name] = {
                "location": [round(c, 5) for c in obj.location],
                "rotation_euler_deg": [round(c * 57.2958, 3) for c in obj.rotation_euler],
                "scale": [round(c, 5) for c in obj.scale],
            }

    # Lean metrics: spine, arms, legs
    metrics = {}
    pairs = [
        ("spine", "Hip", "Head"),
        ("left_arm", "L_Clavicle", "L_Hand"),
        ("right_arm", "R_Clavicle", "R_Hand"),
        ("left_leg", "L_Thigh", "L_Foot"),
        ("right_leg", "R_Thigh", "R_Foot"),
    ]
    for label, b1, b2 in pairs:
        bb1 = arm.bones.get(b1)
        bb2 = arm.bones.get(b2)
        if not (bb1 and bb2):
            continue
        p1 = arm_obj.matrix_world @ bb1.head_local
        p2 = arm_obj.matrix_world @ bb2.head_local
        v = p2 - p1
        metrics[label] = {
            "from_to": [b1, b2],
            "vector": [round(c, 5) for c in v],
            "lean_forward_deg_from_Z": round(math.degrees(math.atan2(v.x, v.z)), 3),
            "lean_lateral_deg_from_Z": round(math.degrees(math.atan2(v.y, v.z)), 3),
        }

    snapshot = {
        "critter": CRITTER_ID,
        "axis_convention": {
            "world_up": "+Z",
            "character_front": "+X (per roster.ts comment)",
            "character_left": "+Y",
        },
        "objects": objects,
        "metrics": metrics,
        "bones": bones,
    }
    os.makedirs(os.path.dirname(BASELINE_PATH), exist_ok=True)
    with open(BASELINE_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2)
    print(f"  baseline → {BASELINE_PATH}")

    # Print spine + arms summary
    for label in ("spine", "left_arm", "right_arm"):
        if label in metrics:
            m = metrics[label]
            print(f"    {label:<12} vec={m['vector']}  "
                  f"forward_lean={m['lean_forward_deg_from_Z']:+.2f}°  "
                  f"lateral_lean={m['lean_lateral_deg_from_Z']:+.2f}°")
    return snapshot


# ---------------------------------------------------------------------------
# Step 6: render 3 ortho views
# ---------------------------------------------------------------------------

def render_three_views():
    arm_obj = bpy.data.objects.get(ARMATURE_NAME)
    mesh = _find_mesh(CRITTER_ID)
    if not (arm_obj and mesh):
        print(f"  [skip] need both armature and mesh")
        return

    os.makedirs(VIEWS_DIR, exist_ok=True)

    # Hide reference floor / forward marker temporarily
    refs = [bpy.data.objects.get(n) for n in ("_REFERENCE_FLOOR", "_REFERENCE_FORWARD")]
    ref_state = []
    for obj in refs:
        if obj:
            ref_state.append((obj, obj.hide_viewport))
            obj.hide_viewport = True

    _deselect_all()
    mesh.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj

    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'PNG'
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 1300

    views = [
        ('RIGHT', '01_front_+X.png'),
        ('FRONT', '02_side_-Y.png'),
        ('TOP',   '03_top_+Z.png'),
    ]
    for view_type, filename in views:
        area = next((a for a in bpy.context.screen.areas if a.type == 'VIEW_3D'), None)
        region = next((r for r in area.regions if r.type == 'WINDOW'), None) if area else None
        if not (area and region):
            print(f"    {view_type}: no 3D viewport")
            continue
        try:
            with bpy.context.temp_override(area=area, region=region,
                                           selected_objects=[mesh, arm_obj]):
                bpy.ops.view3d.view_axis(type=view_type)
                bpy.ops.view3d.view_selected()
                scene.render.filepath = os.path.join(VIEWS_DIR, filename)
                bpy.ops.render.opengl(write_still=True, view_context=True)
            print(f"    {view_type:<6} → {filename}")
        except Exception as e:
            print(f"    {view_type}: {type(e).__name__}: {e}")

    # Restore
    for obj, prev in ref_state:
        obj.hide_viewport = prev
    _deselect_all()


# ---------------------------------------------------------------------------
# Step 7: export
# ---------------------------------------------------------------------------

def export_critter():
    """Re-export the critter to public/models/critters/<id>.glb.

    Selects ParentNode + Armature + Mesh and uses use_selection=True so
    the _reference collection (and anything else in the scene) stays out.
    """
    arm_obj = bpy.data.objects.get(ARMATURE_NAME)
    parent = bpy.data.objects.get(PARENT_EMPTY)
    mesh = _find_mesh(CRITTER_ID)

    _force_object_mode()
    _deselect_all()
    targets = []
    for obj in (parent, arm_obj, mesh):
        if obj:
            obj.select_set(True)
            targets.append(obj.name)
    bpy.context.view_layer.objects.active = arm_obj
    print(f"  selected for export: {targets}")

    size_before = os.path.getsize(EXPORT_PATH) if os.path.exists(EXPORT_PATH) else 0
    bpy.ops.export_scene.gltf(
        filepath=EXPORT_PATH,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_animations=True,
        export_optimize_animation_size=True,
    )
    size_after = os.path.getsize(EXPORT_PATH)
    print(f"  exported: {size_before} → {size_after} bytes ({size_after - size_before:+d})")
    print(f"  path: {EXPORT_PATH}")


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def cleanup_pipeline(*, do_export: bool = False):
    """Run all cleanup steps in order. Set do_export=True to also re-export."""
    print(f"\n=== Cleanup pipeline for '{CRITTER_ID}' ===\n")

    print("[1] Force OBJECT mode")
    _force_object_mode()

    print("[2] Clear pose state (detach action + reset bones)")
    clear_pose_state()

    print("[3] Clear ParentNode rotation")
    clear_parent_rotation()

    print("[4] Detect + remove placeholder actions")
    detect_and_remove_placeholders()

    print("[5] Snapshot baseline metrics")
    snapshot_metrics()

    print("[6] Render 3 ortho views")
    render_three_views()

    if do_export:
        print("[7] Re-export GLB")
        export_critter()
    else:
        print("[7] Skipping export — call export_critter() manually after review.")

    print("\n=== Done ===")


if __name__ == "__main__":
    cleanup_pipeline(do_export=False)
