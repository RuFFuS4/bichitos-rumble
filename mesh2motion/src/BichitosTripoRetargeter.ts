// ---------------------------------------------------------------------------
// Tripo → Mesh2Motion retargeting utility
// ---------------------------------------------------------------------------
//
// Bichitos Rumble's critters ship pre-rigged from Tripo Animate with a
// 39-bone humanoid skeleton (Tripo's standard naming). Mesh2Motion's
// animation library is authored against the lab's own template skeletons
// (e.g. the human template uses `pelvis`, `spine_01`, `upperarm_l`).
//
// Three.js drives skinning by matching `KeyframeTrack` names like
// `BoneName.quaternion` against the live skeleton's bone names. When an
// MM clip targets `upperarm_l.quaternion` and the SkinnedMesh only has
// `L_Upperarm`, the track is silently skipped — the bone never animates.
//
// This module provides the bridge:
//   1. A static `MM_HUMAN_TO_TRIPO` mapping covering the 20 bones we care
//      about (the rest are MM-only finger / face leaves we don't have).
//   2. `retargetClip(clip)` clones a clip and rewrites every track's bone
//      prefix from MM names to Tripo names. Tracks targeting MM bones not
//      in the map are dropped (silent — they can't apply to Tripo
//      anyway).
//   3. `isTripoRig(skeleton)` heuristic to decide whether a freshly-loaded
//      mesh's skeleton is the Tripo rig (so the rest of the lab can skip
//      its Fit Skeleton + Bind Weights phases).
//
// Pure utility — no side effects, no DOM, no engine state. Safe to import
// from anywhere.
// ---------------------------------------------------------------------------

import { AnimationClip, KeyframeTrack, Skeleton } from 'three'

/**
 * DEFAULT Mesh2Motion `human` template bone name → Tripo's standard rig
 * bone name. Ordered by body region so a UI pairing panel renders in a
 * sensible top-down sequence (head → arms → legs).
 *
 * Coverage: 20 bones (spine + head + 2 arms × 4 bones + 2 legs × 3 bones).
 * MM-only bones (fingers, head_leaf, ball_leaf_*, all *_leaf_*) are NOT
 * mapped here — those tracks get dropped during retargeting because
 * Tripo doesn't have equivalents and they would break silently anyway.
 *
 * Tripo's NeckTwist01 is the closest equivalent to MM's `neck_01` (Tripo
 * splits the neck into two twist bones; we hit the first one).
 *
 * This is the DEFAULT mapping used when the user doesn't override. The
 * manual bone-pairing UI can call `setActiveMapping()` with custom
 * values — `retargetClipForTripo()` always reads the active mapping
 * returned by `getActiveMapping()`.
 */
export const MM_HUMAN_TO_TRIPO_DEFAULT: Record<string, string> = {
  // Spine chain
  pelvis:     'Hip',
  spine_01:   'Waist',
  spine_02:   'Spine01',
  spine_03:   'Spine02',
  neck_01:    'NeckTwist01',
  head:       'Head',
  // Left arm
  clavicle_l: 'L_Clavicle',
  upperarm_l: 'L_Upperarm',
  lowerarm_l: 'L_Forearm',
  hand_l:     'L_Hand',
  // Right arm
  clavicle_r: 'R_Clavicle',
  upperarm_r: 'R_Upperarm',
  lowerarm_r: 'R_Forearm',
  hand_r:     'R_Hand',
  // Left leg
  thigh_l:    'L_Thigh',
  calf_l:     'L_Calf',
  foot_l:     'L_Foot',
  // Right leg
  thigh_r:    'R_Thigh',
  calf_r:     'R_Calf',
  foot_r:     'R_Foot',
}

/**
 * Back-compat alias for code that still imports `MM_HUMAN_TO_TRIPO`
 * (the old export name). Prefer the `_DEFAULT` suffix going forward to
 * make it clear the user can override.
 */
export const MM_HUMAN_TO_TRIPO = MM_HUMAN_TO_TRIPO_DEFAULT

/**
 * Ordered list of MM human bones that the pairing UI should render rows
 * for. The order matches how an animator thinks about the body (root →
 * extremities). The UI uses this to build the left column of the
 * pairing panel.
 */
export const MM_HUMAN_BONE_ORDER: readonly string[] = [
  'pelvis',
  'spine_01',
  'spine_02',
  'spine_03',
  'neck_01',
  'head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l',
  'thigh_r', 'calf_r', 'foot_r',
]

/**
 * Module-level "active mapping" used by retargetClipForTripo. Starts as
 * a clone of the default. Replace via setActiveMapping() when the user
 * edits rows in the pairing UI; reset via resetActiveMapping().
 */
let active_mapping: Record<string, string> = { ...MM_HUMAN_TO_TRIPO_DEFAULT }

export function getActiveMapping (): Record<string, string> {
  return active_mapping
}

export function setActiveMapping (mapping: Record<string, string>): void {
  // Shallow clone so outside mutations don't leak into our state.
  active_mapping = { ...mapping }
}

export function resetActiveMapping (): void {
  active_mapping = { ...MM_HUMAN_TO_TRIPO_DEFAULT }
}

/**
 * Bone count we expect a Tripo-rigged GLB to have. Used as a heuristic
 * by `isTripoRig`. The exact rig has 39 joints; we accept ±5 to be
 * tolerant of small variants between Tripo Animate exports.
 */
const TRIPO_BONE_COUNT_RANGE: [number, number] = [34, 44]

/**
 * Bone names that, when present, are strong evidence the rig is Tripo's
 * humanoid. We don't require all of them — just enough to disambiguate
 * from MM templates. (MM uses `pelvis` / `upperarm_l`; Tripo uses `Hip` /
 * `L_Upperarm`.)
 */
const TRIPO_SIGNATURE_BONES = new Set([
  'Hip', 'Waist', 'Spine01', 'Spine02', 'L_Upperarm', 'R_Upperarm',
  'L_Thigh', 'R_Thigh', 'L_Forearm', 'R_Forearm',
])

/**
 * Detect whether a skeleton uses the Tripo naming convention. Returns
 * true if at least 6 of the 10 signature bones are present AND the
 * total bone count falls in the expected range.
 *
 * False positives are fine — they'd just cause us to skip the Edit step
 * when we shouldn't. The user can still escape via the standard MM UI
 * (we never destroy state). False negatives are the bigger risk; the
 * heuristic is intentionally permissive.
 */
export function isTripoRig(skeleton: Skeleton | null | undefined): boolean {
  if (!skeleton || !skeleton.bones?.length) return false
  const count = skeleton.bones.length
  if (count < TRIPO_BONE_COUNT_RANGE[0] || count > TRIPO_BONE_COUNT_RANGE[1]) {
    return false
  }
  const names = new Set(skeleton.bones.map(b => b.name))
  let hits = 0
  for (const sig of TRIPO_SIGNATURE_BONES) {
    if (names.has(sig)) hits++
  }
  return hits >= 6
}

/**
 * Extract the bone name from a Three.js KeyframeTrack name. Tracks are
 * named like `BoneName.quaternion`, `BoneName.position`, `BoneName.scale`,
 * or with a prefixed root: `Armature|BoneName.quaternion`.
 *
 * Returns `{ bone, suffix }` where `suffix` is the property part
 * (`.quaternion` etc.) including the leading dot, ready for re-prefixing.
 * Returns `null` if the track name doesn't match the expected shape.
 */
function splitTrackName(trackName: string): { bone: string; suffix: string } | null {
  const lastDot = trackName.lastIndexOf('.')
  if (lastDot < 0) return null
  // The bone part may include a `Armature|` or similar prefix — strip it.
  const fullBonePart = trackName.slice(0, lastDot)
  const suffix = trackName.slice(lastDot)
  const lastSep = Math.max(fullBonePart.lastIndexOf('|'), fullBonePart.lastIndexOf('/'))
  const bone = lastSep >= 0 ? fullBonePart.slice(lastSep + 1) : fullBonePart
  return { bone, suffix }
}

/**
 * Clone an AnimationClip, renaming each track's bone prefix using the
 * currently-active MM-human → Tripo mapping (defaulting to
 * `MM_HUMAN_TO_TRIPO_DEFAULT` unless `setActiveMapping()` was called).
 * Tracks whose MM bone has no entry in the mapping (empty string or
 * missing key) are dropped — typical for finger / leaf bones that have
 * no Tripo equivalent.
 *
 * The original clip is left untouched; the return value is a fresh clone
 * with renamed tracks. The caller is responsible for reloading / reapplying
 * the clip if it's already playing on a mixer.
 *
 * @returns the retargeted clone, or `null` if every track was dropped
 *   (e.g. the user blanked the whole mapping, or the clip only animated
 *   finger bones).
 */
export function retargetClipForTripo(
  clip: AnimationClip,
  mapping: Record<string, string> = getActiveMapping(),
): AnimationClip | null {
  const newTracks: KeyframeTrack[] = []

  for (const track of clip.tracks) {
    const split = splitTrackName(track.name)
    if (!split) continue
    const tripoName = mapping[split.bone]
    if (!tripoName) continue // unmapped → drop silently (e.g. fingers)
    const cloned = track.clone()
    ;(cloned as { name: string }).name = `${tripoName}${split.suffix}`
    newTracks.push(cloned)
  }

  if (newTracks.length === 0) return null

  // AnimationClip generates its own uuid in the constructor — no need to
  // override it here (and `uuid` is read-only on the type anyway).
  return new AnimationClip(clip.name, clip.duration, newTracks, clip.blendMode)
}

/**
 * Retarget every clip in an array. Filtered list — drops clips that
 * couldn't be retargeted at all. Useful for the lab's "load animation
 * library" path where we want to keep only clips that will actually
 * affect the Tripo rig.
 */
export function retargetClipsForTripo(clips: AnimationClip[]): AnimationClip[] {
  const out: AnimationClip[] = []
  for (const c of clips) {
    const r = retargetClipForTripo(c)
    if (r) out.push(r)
  }
  return out
}
