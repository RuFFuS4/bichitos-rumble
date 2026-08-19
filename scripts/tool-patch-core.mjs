// ---------------------------------------------------------------------------
// tool-patch-core — pure ToolPatch mutation library (no I/O, no CLI)
// ---------------------------------------------------------------------------
//
// Extracted from scripts/apply-tool-patch.mjs (H3 slice 1) so the same
// mutators can be consumed by:
//   · the CLI (scripts/apply-tool-patch.mjs — thin wrapper)
//   · the dev-server apply endpoint (H3 slice 4 — Vite configureServer)
//   · tests (scripts/tests/tool-patch-core.test.mjs)
//
// Every function here is string → string (or data → data): no argv, no
// fs, no process. Throwing is the error channel — callers decide how to
// present failures. A throw always happens BEFORE any output is
// produced, so partial application is impossible by construction.
//
// Semantics per tool
// ------------------
//   · calibrate    — sparse per-critter field rewrite in src/roster.ts.
//   · anim-lab     — sparse per-critter MERGE into ANIMATION_OVERRIDES
//                    (src/animation-overrides.ts). Critters absent from
//                    the patch keep their blocks byte-identical; states
//                    absent from a patched critter survive; comments
//                    inside blocks survive. The merge NEVER deletes an
//                    override — removing one is a manual source edit
//                    (explicit tombstones are a possible v3 feature).
//                    This makes the tool-storage.ts contract ("entries
//                    not in data are left untouched") actually true —
//                    the old implementation replaced the whole record.
//   · decor-editor — per-pack wholesale array replace in
//                    src/arena-decor-layouts.ts (placements are
//                    positional; partial merges don't make sense).
//
// Textual robustness: all brace/anchor scanning is COMMENT- and
// STRING-AWARE (see codeMask) — a stray `}` inside a `// note` or a
// state "parked" inside a `/* */` block can't corrupt the output. When
// an anchor is missing or ambiguous the mutator throws loudly rather
// than guessing; a formatter pass over the target files surfaces here
// as hard errors, not silent corruption. Appended lines follow the
// file's dominant EOL so CRLF working trees don't end up mixed.
// ---------------------------------------------------------------------------

export const SUPPORTED_VERSIONS = {
  'calibrate':    [1],
  'anim-lab':     [1, 2],
  'decor-editor': [1],
  'feel-patch':   [1],
};

export const targetByTool = {
  'calibrate':     'src/roster.ts',
  'anim-lab':      'src/animation-overrides.ts',
  'decor-editor':  'src/arena-decor-layouts.ts',
  'feel-patch':    'src/gamefeel.ts',
};

/** Keys written as bare TS identifiers must actually be identifiers —
 *  a typo like `"sergei "` or `"fall-fast"` would otherwise emit
 *  invalid TS or a silently-shadowing duplicate block. */
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// ---------------------------------------------------------------------------
// Envelope + payload validation
// ---------------------------------------------------------------------------

/**
 * Validate a parsed ToolPatch (envelope + per-tool payload shape).
 * Returns an array of human-readable problems; empty array = valid.
 * Kept as data-in/errors-out so both the CLI and the future HTTP
 * endpoint can present the same messages their own way.
 */
export function validateToolPatch(patch) {
  const errors = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return ['patch is not an object'];
  }
  const { tool, version, data } = patch;
  if (typeof tool !== 'string') errors.push('missing or non-string "tool"');
  else if (!(tool in SUPPORTED_VERSIONS)) errors.push(`unknown tool "${tool}"`);
  if (typeof version !== 'number') errors.push('missing or non-numeric "version"');
  else if (tool in SUPPORTED_VERSIONS && !SUPPORTED_VERSIONS[tool].includes(version)) {
    errors.push(`unsupported version ${version} for tool "${tool}" (supported: ${SUPPORTED_VERSIONS[tool].join(', ')})`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('missing or non-object "data"');
    return errors;
  }
  if (errors.length > 0) return errors;

  const isFinite_ = (n) => typeof n === 'number' && Number.isFinite(n);
  const checkIdent = (label, key) => {
    if (!IDENT_RE.test(key)) errors.push(`${label} "${key}" is not a valid identifier`);
  };

  if (tool === 'calibrate') {
    for (const [id, fields] of Object.entries(data)) {
      checkIdent('calibrate: critter id', id);
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        errors.push(`calibrate: entry "${id}" is not an object`); continue;
      }
      for (const [k, v] of Object.entries(fields)) {
        if (!['scale', 'pivotY', 'rotation', 'physicsRadius'].includes(k)) {
          errors.push(`calibrate: entry "${id}" has unknown field "${k}"`);
        } else if (!isFinite_(v)) {
          errors.push(`calibrate: entry "${id}" field "${k}" is not a finite number`);
        }
      }
    }
  } else if (tool === 'anim-lab') {
    for (const [id, states] of Object.entries(data)) {
      checkIdent('anim-lab: critter id', id);
      if (!states || typeof states !== 'object' || Array.isArray(states)) {
        errors.push(`anim-lab: critter "${id}" is not an object`); continue;
      }
      for (const [state, v] of Object.entries(states)) {
        checkIdent(`anim-lab: state key of "${id}"`, state);
        if (typeof v === 'string') continue;
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
          errors.push(`anim-lab: ${id}.${state} is neither string nor object`); continue;
        }
        if (typeof v.clip !== 'string' || v.clip.length === 0) {
          errors.push(`anim-lab: ${id}.${state} object form is missing "clip"`);
        }
        if ('speed' in v && !isFinite_(v.speed)) {
          errors.push(`anim-lab: ${id}.${state} "speed" is not a finite number`);
        }
        if ('loop' in v && typeof v.loop !== 'boolean') {
          errors.push(`anim-lab: ${id}.${state} "loop" is not a boolean`);
        }
        for (const k of Object.keys(v)) {
          if (!['clip', 'speed', 'loop'].includes(k)) {
            errors.push(`anim-lab: ${id}.${state} has unknown field "${k}"`);
          }
        }
      }
    }
  } else if (tool === 'feel-patch') {
    const PATH_RE = /^[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*$/;
    for (const [path, v] of Object.entries(data)) {
      if (!PATH_RE.test(path)) {
        errors.push(`feel-patch: key "${path}" is not a two-segment dot-path (section.key)`);
      }
      if (!isFinite_(v)) {
        errors.push(`feel-patch: "${path}" is not a finite number`);
      }
    }
  } else if (tool === 'decor-editor') {
    for (const [pack, placements] of Object.entries(data)) {
      checkIdent('decor-editor: pack id', pack);
      if (!Array.isArray(placements)) {
        errors.push(`decor-editor: pack "${pack}" is not an array`); continue;
      }
      placements.forEach((p, i) => {
        if (!p || typeof p !== 'object') {
          errors.push(`decor-editor: ${pack}[${i}] is not an object`); return;
        }
        for (const k of ['r', 'angle', 'rotY', 'scale']) {
          if (!isFinite_(p[k])) errors.push(`decor-editor: ${pack}[${i}].${k} is not a finite number`);
        }
        if (typeof p.type !== 'string' || p.type.length === 0) {
          errors.push(`decor-editor: ${pack}[${i}].type is not a non-empty string`);
        }
      });
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Route a validated patch to its mutator. Throws on unknown tool. */
export function applyPatch(source, patch) {
  if (patch.tool === 'calibrate')    return applyCalibrate(source, patch.data);
  if (patch.tool === 'anim-lab')     return applyAnimLab(source, patch.data);
  if (patch.tool === 'decor-editor') return applyDecorEditor(source, patch.data);
  if (patch.tool === 'feel-patch')   return applyFeelPatch(source, patch.data);
  throw new Error(`unknown tool: ${patch.tool}`);
}

// ===========================================================================
// feel-patch — numeric token rewrite inside the FEEL record
// ===========================================================================

/**
 * Rewrite numeric leaves of the `FEEL` record in src/gamefeel.ts.
 *
 * Each data key is a two-segment dot-path ("shake.headbutt"). The
 * mutator locates the section block, then the key's line, and replaces
 * ONLY the numeric token — the trailing comma and the tuning comment
 * (the file's institutional memory) survive byte-identical. It never
 * creates sections or keys: a path missing from source is a hard error
 * (the tuner only offers leaves that exist).
 */
export function applyFeelPatch(source, data) {
  const anchor = 'export const FEEL';
  const start = source.indexOf(anchor);
  if (start < 0) throw new Error('feel-patch: FEEL export not found');
  const srcMask = codeMask(source);
  let openBrace = -1;
  for (let i = start; i < source.length; i++) {
    if (srcMask[i] === M_CODE && source[i] === '{') { openBrace = i; break; }
  }
  if (openBrace < 0) throw new Error('feel-patch: FEEL open brace not found');
  const close = matchBraceMasked(source, openBrace, srcMask);
  if (close < 0) throw new Error('feel-patch: FEEL close brace not found');

  let record = source.slice(openBrace, close + 1);

  for (const path of Object.keys(data).sort()) {
    const [sec, key] = path.split('.');
    const mask = codeMask(record);
    const headRe = new RegExp(`(^|\\n)([ \\t]+)${escapeRegex(sec)}:\\s*\\{`, 'g');
    const heads = [...record.matchAll(headRe)].filter((m) => {
      const keyIdx = m.index + m[1].length + m[2].length;
      return mask[keyIdx] === M_CODE;
    });
    if (heads.length === 0) throw new Error(`feel-patch: section '${sec}' not found in FEEL`);
    if (heads.length > 1) throw new Error(`feel-patch: section '${sec}' matches ${heads.length} blocks — refusing to guess`);

    const blockOpen = heads[0].index + heads[0][0].length - 1;
    const blockClose = matchBraceMasked(record, blockOpen, mask);
    if (blockClose < 0) throw new Error(`feel-patch: unbalanced braces in section '${sec}'`);
    const blockText = record.slice(blockOpen + 1, blockClose);

    const lineRe = new RegExp(`(^|\\n)([ \\t]*)${escapeRegex(key)}:\\s*(-?\\d+(?:\\.\\d+)?)`, 'g');
    const blockMask = codeMask(blockText);
    const lines = [...blockText.matchAll(lineRe)].filter((m) => {
      const keyIdx = m.index + m[1].length + m[2].length;
      return blockMask[keyIdx] === M_CODE;
    });
    if (lines.length === 0) throw new Error(`feel-patch: '${path}' not found (or its value is not a plain number)`);
    if (lines.length > 1) throw new Error(`feel-patch: '${path}' matches ${lines.length} lines — refusing to guess`);

    const lm = lines[0];
    const numStart = lm.index + lm[0].length - lm[3].length;
    const numEnd = lm.index + lm[0].length;
    const merged = blockText.slice(0, numStart) + formatNumber(data[path]) + blockText.slice(numEnd);
    record = record.slice(0, blockOpen + 1) + merged + record.slice(blockClose);
  }

  return source.slice(0, openBrace) + record + source.slice(close + 1);
}

// ===========================================================================
// Code mask — comment/string-aware scanning
// ===========================================================================

/** Mask values: what a character belongs to. Strings are CONTENT (a
 *  value like "anims//Fall" is real data) but their braces/slashes
 *  must never count as syntax; comments are dead text entirely. */
export const M_COMMENT = 0;
export const M_CODE = 1;
export const M_STRING = 2;

/**
 * Tri-state mask over `text`: M_CODE for live syntax, M_COMMENT inside
 * `// …EOL` and `/* … *​/` comments (delimiters included), M_STRING
 * inside string literals ('…', "…", `…`, quotes included). Escapes
 * inside strings are honoured; template interpolation is treated as
 * string (good enough for the target files, which keep braces out of
 * literals).
 */
export function codeMask(text) {
  const mask = new Uint8Array(text.length).fill(M_CODE);
  let mode = 'code'; // code | line | block | string
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (mode === 'code') {
      if (ch === '/' && text[i + 1] === '/') { mode = 'line'; mask[i] = M_COMMENT; }
      else if (ch === '/' && text[i + 1] === '*') { mode = 'block'; mask[i] = M_COMMENT; }
      else if (ch === "'" || ch === '"' || ch === '`') { mode = 'string'; quote = ch; mask[i] = M_STRING; }
    } else if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; continue; } // newline itself is code
      mask[i] = M_COMMENT;
    } else if (mode === 'block') {
      mask[i] = M_COMMENT;
      if (ch === '*' && text[i + 1] === '/') { mask[i + 1] = M_COMMENT; i++; mode = 'code'; }
    } else { // string
      mask[i] = M_STRING;
      if (ch === '\\') { if (i + 1 < text.length) { mask[i + 1] = M_STRING; i++; } }
      else if (ch === quote) { mode = 'code'; quote = null; }
    }
  }
  return mask;
}

/** Index of the brace matching text[openIdx] (which must be `{`),
 *  counting only M_CODE braces. Returns -1 if unbalanced. */
function matchBraceMasked(text, openIdx, mask) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (mask[i] !== M_CODE) continue;
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Dominant EOL of the file — appended lines must match or a CRLF
 *  working tree ends up with mixed endings. */
function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

// ===========================================================================
// calibrate — sparse per-critter field rewrite in roster.ts
// ===========================================================================

/**
 * Each entry is located by `id: 'critterId'`. The rewrite is scoped to
 * that entry's text-block (until the next top-level `},`). Within the
 * block we replace `scale:` / `pivotY:` / `rotation:` tokens. Fields
 * the patch omits are left untouched. Field-like text inside comments
 * is never rewritten.
 */
export function applyCalibrate(source, data) {
  let out = source;
  for (const [critterId, fields] of Object.entries(data)) {
    const block = locateBlock(out, `id: '${critterId}'`, /^\s{0,2}\},\s*$/m);
    if (!block) throw new Error(`calibrate: entry not found for critter '${critterId}'`);
    let inner = block.text;
    if (typeof fields.scale === 'number') {
      inner = replaceFieldOutsideComments(inner, /scale:\s*[^,}\r\n]+/g, `scale: ${formatNumber(fields.scale)}`);
    }
    if (typeof fields.pivotY === 'number') {
      inner = replaceFieldOutsideComments(inner, /pivotY:\s*[^,}\r\n]+/g, `pivotY: ${formatNumber(fields.pivotY)}`);
    }
    if (typeof fields.rotation === 'number') {
      inner = replaceFieldOutsideComments(inner, /rotation:\s*[^,}\r\n]+/g, `rotation: ${formatRotation(fields.rotation)}`);
    }
    if (typeof fields.physicsRadius === 'number') {
      // Replaces the shared `R` const reference with a per-critter
      // literal — that IS the point (afilado slice C: the uniform-R
      // hitbox opened up to per-critter tuning).
      inner = replaceFieldOutsideComments(inner, /physicsRadius:\s*[^,}\r\n]+/g, `physicsRadius: ${formatNumber(fields.physicsRadius)}`);
    }
    out = out.slice(0, block.start) + inner + out.slice(block.end);
  }
  return out;
}

/**
 * Like String.replace(re, replacement) but line-scoped and skipping
 * anything after a comment start (quote-aware). Roster blocks carry
 * calibration notes in comments — a note like "scale: 0.66 was the old
 * value" must never be rewritten by the mutator.
 */
function replaceFieldOutsideComments(text, fieldRe, replacement) {
  const mask = codeMask(text);
  let offset = 0;
  return text.split('\n').map((line) => {
    const lineStart = offset;
    offset += line.length + 1;
    // Cut at the first char that starts a comment on this line.
    let cut = -1;
    for (let i = 0; i < line.length; i++) {
      if (mask[lineStart + i] === M_COMMENT && line[i] === '/') { cut = i; break; }
    }
    if (cut < 0) return line.replace(fieldRe, replacement);
    return line.slice(0, cut).replace(fieldRe, replacement) + line.slice(cut);
  }).join('\n');
}

// ===========================================================================
// anim-lab — sparse per-critter MERGE into ANIMATION_OVERRIDES
// ===========================================================================

/**
 * Merge an AnimLabPatch into the `ANIMATION_OVERRIDES` record.
 *
 * Per critter in the patch:
 *   · block exists  → per state: replace the state's value in place
 *     (preserving indentation and any trailing comment), or append the
 *     state as a new line before the block's closing brace.
 *   · block missing → append a whole new block before the record's
 *     closing brace, formatted like the authored blocks.
 *
 * Everything the patch doesn't mention is preserved byte-for-byte:
 * other critters, untouched states, comments, blank lines. The merge
 * never deletes an override — that stays a manual source edit.
 *
 * Hard errors (no output produced): record/braces not found, critter
 * anchor ambiguous, state line ambiguous, or a state value spanning
 * multiple lines (hand-authored shape the line-scoped rewrite can't
 * safely touch). A state line living inside a comment is treated as
 * absent (the real value is appended; the comment survives).
 */
export function applyAnimLab(source, data) {
  const anchor = 'export const ANIMATION_OVERRIDES';
  const start = source.indexOf(anchor);
  if (start < 0) throw new Error('anim-lab: ANIMATION_OVERRIDES export not found');
  const srcMask = codeMask(source);
  let openBrace = -1;
  for (let i = start; i < source.length; i++) {
    if (srcMask[i] === M_CODE && source[i] === '{') { openBrace = i; break; }
  }
  if (openBrace < 0) throw new Error('anim-lab: ANIMATION_OVERRIDES open brace not found');
  const close = matchBraceMasked(source, openBrace, srcMask);
  if (close < 0) throw new Error('anim-lab: ANIMATION_OVERRIDES close brace not found');

  const eol = detectEol(source);
  // Work on the record text (outer braces included) in isolation, then
  // splice it back — keeps all index math local.
  let record = source.slice(openBrace, close + 1);

  for (const critterId of Object.keys(data).sort()) {
    const states = data[critterId];
    if (!states || Object.keys(states).length === 0) continue;
    if (!IDENT_RE.test(critterId)) {
      throw new Error(`anim-lab: critter id '${critterId}' is not a valid identifier`);
    }

    const mask = codeMask(record);
    const entryIndent = detectEntryIndent(record, mask);
    const headRe = new RegExp(`(^|\\n)(${escapeRegex(entryIndent)})${escapeRegex(critterId)}:\\s*\\{`, 'g');
    const matches = [...record.matchAll(headRe)].filter((m) => {
      const keyIdx = m.index + m[1].length + m[2].length;
      return mask[keyIdx] === 1;
    });
    if (matches.length > 1) {
      throw new Error(`anim-lab: critter '${critterId}' matches ${matches.length} blocks — refusing to guess`);
    }

    if (matches.length === 1) {
      const m = matches[0];
      const blockOpen = m.index + m[0].length - 1; // index of '{'
      const blockClose = matchBraceMasked(record, blockOpen, mask);
      if (blockClose < 0) throw new Error(`anim-lab: unbalanced braces in block for '${critterId}'`);
      const blockText = record.slice(blockOpen + 1, blockClose); // inner text
      const merged = mergeStatesIntoBlock(blockText, states, m[2], critterId, eol);
      record = record.slice(0, blockOpen + 1) + merged + record.slice(blockClose);
    } else {
      // New critter — append a block before the record's closing brace.
      const lines = [`${entryIndent}${critterId}: {`];
      for (const state of Object.keys(states).sort()) {
        lines.push(`${entryIndent}  ${state}: ${formatAnimLabValue(states[state])},`);
      }
      lines.push(`${entryIndent}},`);
      const closeIdx = record.length - 1; // record ends with the code '}'
      const before = record.slice(0, closeIdx).replace(/\s+$/, '');
      record = `${before}${eol}${eol}${lines.join(eol)}${eol}${record.slice(closeIdx)}`;
    }
  }

  return source.slice(0, openBrace) + record + source.slice(close + 1);
}

/** Indentation of the record's own entries (first code-level `<id>: {`
 *  line). Anchoring critter lookups to THIS exact indent keeps a
 *  critter that shares its name with a state (run, fall, victory…)
 *  from matching deeper state lines of other blocks. */
function detectEntryIndent(record, mask) {
  const re = /(^|\n)([ \t]*)[A-Za-z_$][A-Za-z0-9_$]*:\s*\{/g;
  for (const m of record.matchAll(re)) {
    const keyIdx = m.index + m[1].length + m[2].length;
    if (mask[keyIdx] === 1) return m[2];
  }
  return '  ';
}

/**
 * Merge states into one critter block's inner text. Exported for tests.
 * `headIndent` is the indentation of the `<id>: {` line; state lines
 * get two more spaces (or copy the block's existing state indent).
 */
export function mergeStatesIntoBlock(blockText, states, headIndent, critterId, eol = '\n') {
  let out = blockText;

  for (const state of Object.keys(states).sort()) {
    if (!IDENT_RE.test(state)) {
      throw new Error(`anim-lab: state key '${state}' of '${critterId}' is not a valid identifier`);
    }
    const value = formatAnimLabValue(states[state]);
    const mask = codeMask(out);
    const indentMatch = maskedFirstMatch(out, mask, /(^|\n)([ \t]+)[A-Za-z_$]/g, 2);
    const stateIndent = indentMatch ?? `${headIndent ?? '  '}  `;

    const lineRe = new RegExp(`(^|\\n)([ \\t]*)${escapeRegex(state)}:`, 'g');
    const lineMatches = [...out.matchAll(lineRe)].filter((m) => {
      const keyIdx = m.index + m[1].length + m[2].length;
      return mask[keyIdx] === 1; // a state "parked" in a comment is absent
    });
    if (lineMatches.length > 1) {
      throw new Error(`anim-lab: state '${state}' of '${critterId}' matches ${lineMatches.length} lines — refusing to guess`);
    }

    if (lineMatches.length === 1) {
      const lm = lineMatches[0];
      const keyStart = lm.index + lm[1].length;          // start of indent
      const valueStart = lm.index + lm[0].length;        // right after ':'
      const lineEnd = endOfLine(out, valueStart);
      // Split the rest of the line into code part and trailing comment
      // using the mask (quote-aware — a "//" inside the value string
      // does not count as a comment).
      let commentIdx = lineEnd;
      for (let i = valueStart; i < lineEnd; i++) {
        if (mask[i] === M_COMMENT && out[i] === '/' && (out[i + 1] === '/' || out[i + 1] === '*')) { commentIdx = i; break; }
      }
      const trailing = out.slice(commentIdx, lineEnd); // comment (or '')
      const opens = countCodeChar(out, mask, valueStart, commentIdx, '{');
      const closes = countCodeChar(out, mask, valueStart, commentIdx, '}');
      if (opens !== closes) {
        throw new Error(
          `anim-lab: state '${state}' of '${critterId}' spans multiple lines — edit src/animation-overrides.ts by hand`,
        );
      }
      // An inline /* */ comment with MORE content after it on the same
      // line (`fall: /* note */ "Fall",`) can't be rebuilt safely.
      for (let i = commentIdx; i < lineEnd; i++) {
        if (mask[i] !== M_COMMENT && !/\s/.test(out[i])) {
          throw new Error(
            `anim-lab: state '${state}' of '${critterId}' mixes a comment into the value — edit src/animation-overrides.ts by hand`,
          );
        }
      }
      const cleanTrailing = trailing.length > 0 ? ` ${trailing.trimStart()}` : '';
      const rebuilt = `${lm[2]}${state}: ${value},${cleanTrailing}`;
      out = out.slice(0, keyStart) + rebuilt + out.slice(lineEnd);
    } else {
      // Append before the closing brace. If the last code line doesn't
      // end with a comma (legal TS), add one first — otherwise the
      // appended line would produce a parse error.
      out = ensureTrailingCommaOnLastCodeLine(out);
      const trimmed = out.replace(/\s+$/, '');
      out = `${trimmed}${eol}${stateIndent}${state}: ${value},${eol}${headIndent ?? '  '}`;
    }
  }
  return out;
}

/** First regex match whose key position is CODE per the mask; returns
 *  the requested capture group's text or null. */
function maskedFirstMatch(text, mask, re, groupIdx) {
  for (const m of text.matchAll(re)) {
    const keyIdx = m.index + m[1].length + m[2].length;
    if (mask[keyIdx] === 1) return m[groupIdx];
  }
  return null;
}

/** End-of-line index (position of '\n' or '\r\n' start, or text end). */
function endOfLine(text, from) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\n') return text[i - 1] === '\r' ? i - 1 : i;
    if (text[i] === '\r' && text[i + 1] === '\n') return i;
  }
  return text.length;
}

function countCodeChar(text, mask, from, to, ch) {
  let n = 0;
  for (let i = from; i < to; i++) if (mask[i] === M_CODE && text[i] === ch) n++;
  return n;
}

/** If the block's last CONTENT (code or string) char isn't a trailing
 *  comma, add one after it — otherwise the appended state line would
 *  produce a parse error. Comments don't count as content. */
function ensureTrailingCommaOnLastCodeLine(blockText) {
  const mask = codeMask(blockText);
  let last = -1;
  for (let i = blockText.length - 1; i >= 0; i--) {
    if (mask[i] !== M_COMMENT && !/\s/.test(blockText[i])) { last = i; break; }
  }
  if (last < 0) return blockText;          // empty / all-comment block
  if (blockText[last] === ',') return blockText;
  return blockText.slice(0, last + 1) + ',' + blockText.slice(last + 1);
}

/**
 * Render a single anim-lab override value as TypeScript source.
 *
 *   "Idle"                             → "Idle"
 *   { clip: "Idle" }                   → "Idle" (string shorthand)
 *   { clip: "Idle", speed: 1.15 }      → { clip: "Idle", speed: 1.15 }
 *   { clip: "Idle", loop: false }      → { clip: "Idle", loop: false }
 *
 * Must stay byte-identical to `formatAnimLabValueForTs` in
 * src/animlab/main.ts (snippet path) so the TS snippet and the JSON
 * patch produce the same source.
 */
export function formatAnimLabValue(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v && typeof v === 'object' && typeof v.clip === 'string') {
    const hasSpeed = typeof v.speed === 'number' && v.speed !== 1;
    const hasLoop = typeof v.loop === 'boolean';
    if (!hasSpeed && !hasLoop) return JSON.stringify(v.clip);
    const parts = [`clip: ${JSON.stringify(v.clip)}`];
    if (hasSpeed) parts.push(`speed: ${formatNumber(v.speed)}`);
    if (hasLoop) parts.push(`loop: ${v.loop}`);
    return `{ ${parts.join(', ')} }`;
  }
  // Defensive: unknown shape — emit as JSON so the source still parses
  // and the user sees something they can hand-edit.
  return JSON.stringify(v);
}

// ===========================================================================
// decor-editor — per-pack wholesale array replace
// ===========================================================================

/**
 * Per-pack: locate the `<packId>: [` block in DECOR_LAYOUTS and replace
 * its contents with the patch's placement array. Unmodified packs are
 * left as-is.
 */
export function applyDecorEditor(source, data) {
  let out = source;
  const eol = detectEol(source);
  for (const [packId, placements] of Object.entries(data)) {
    const mask = codeMask(out);
    const re = new RegExp(`(^|\\n)(\\s*)${escapeRegex(packId)}:\\s*\\[`, 'g');
    const matches = [...out.matchAll(re)].filter((m) => {
      const keyIdx = m.index + m[1].length + m[2].length;
      return mask[keyIdx] === 1;
    });
    if (matches.length === 0) throw new Error(`decor-editor: pack '${packId}' not found in DECOR_LAYOUTS`);
    if (matches.length > 1) throw new Error(`decor-editor: pack '${packId}' matches ${matches.length} blocks — refusing to guess`);
    const m = matches[0];
    const openIdx = m.index + m[0].length;
    let depth = 1;
    let close = -1;
    for (let i = openIdx; i < out.length; i++) {
      if (mask[i] !== M_CODE) continue;
      if (out[i] === '[') depth++;
      else if (out[i] === ']') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close < 0) throw new Error(`decor-editor: closing bracket for pack '${packId}' not found`);
    const indent = '    ';
    const body = placements.length === 0
      ? `${eol}  `
      : eol + placements.map((p) =>
          `${indent}{ r: ${formatNumber(p.r)}, angle: ${formatNumber(p.angle)}, ` +
          `rotY: ${formatNumber(p.rotY)}, scale: ${formatNumber(p.scale)}, ` +
          `type: ${JSON.stringify(p.type)} },`
        ).join(eol) + `${eol}  `;
    out = out.slice(0, openIdx) + body + out.slice(close);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block locator + formatting helpers
// ---------------------------------------------------------------------------

/**
 * Find the text block that contains `anchor` and runs until a line
 * matching `closeRe`. Returns { start, end, text } where
 * slice(start, end) === text.
 */
export function locateBlock(source, anchor, closeRe) {
  const aIdx = source.indexOf(anchor);
  if (aIdx < 0) return null;
  const tail = source.slice(aIdx);
  const closeMatch = tail.match(closeRe);
  if (!closeMatch) return null;
  const localEnd = closeMatch.index + closeMatch[0].length;
  return { start: aIdx, end: aIdx + localEnd, text: tail.slice(0, localEnd) };
}

export function formatNumber(n) {
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(3);
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function formatRotation(r) {
  const SNAP = 0.01;
  if (Math.abs(r) < SNAP) return '0';
  if (Math.abs(r - Math.PI / 2) < SNAP) return 'Math.PI / 2';
  if (Math.abs(r + Math.PI / 2) < SNAP) return '-Math.PI / 2';
  if (Math.abs(r - Math.PI) < SNAP) return 'Math.PI';
  if (Math.abs(r + Math.PI) < SNAP) return '-Math.PI';
  return r.toFixed(4);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Line-based diff producer. Emits `{ kind: 'add'|'del'|'ctx'|'sep',
 * text }` — renderable by the CLI (colours) and by a future UI modal.
 *
 * Uses Myers O(ND) line diff so a sparse merge reads as the handful of
 * lines it actually changed (the review diff is how a human verifies
 * the no-deletion guarantee — a whole-record dump would defeat it).
 * Falls back to a cheap common-prefix/suffix dump when the edit
 * distance exceeds a cap (pathological inputs; keeps memory bounded).
 */
export function simpleDiff(a, b) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const ctx = 2;
  const raw = myersDiff(aLines, bLines, 800) ?? prefixSuffixDiff(aLines, bLines);
  return collapseHunks(raw, ctx);
}

/** Myers greedy O(ND) diff over line arrays. Returns raw ctx/del/add
 *  entries, or null if edit distance exceeds `maxD`. */
function myersDiff(aLines, bLines, maxD) {
  const N = aLines.length, M = bLines.length;
  if (N === 0 && M === 0) return [];
  const max = Math.max(1, Math.min(N + M, maxD));
  const offset = max;
  let v = new Int32Array(2 * max + 1);
  const trace = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && aLines[x] === bLines[y]) { x++; y++; }
      next[offset + k] = x;
      if (x >= N && y >= M) { found = true; }
    }
    v = next;
  }
  if (!found) return null;

  // Backtrack.
  const ops = []; // reversed list of {kind, text}
  let x = N, y = M;
  for (let d = trace.length - 1; d > 0 && (x > 0 || y > 0); d--) {
    const vPrev = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && vPrev[offset + k - 1] < vPrev[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vPrev[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push({ kind: 'ctx', text: aLines[x] }); }
    if (d > 0) {
      if (x === prevX) { y--; ops.push({ kind: 'add', text: bLines[y] }); }
      else { x--; ops.push({ kind: 'del', text: aLines[x] }); }
    }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ kind: 'ctx', text: aLines[x] }); }
  while (x > 0) { x--; ops.push({ kind: 'del', text: aLines[x] }); }
  while (y > 0) { y--; ops.push({ kind: 'add', text: bLines[y] }); }
  return ops.reverse();
}

/** Fallback raw diff: common prefix/suffix as ctx, middle as del+add. */
function prefixSuffixDiff(aLines, bLines) {
  const out = [];
  let prefix = 0;
  const minLen = Math.min(aLines.length, bLines.length);
  while (prefix < minLen && aLines[prefix] === bLines[prefix]) prefix++;
  let aEnd = aLines.length;
  let bEnd = bLines.length;
  while (aEnd > prefix && bEnd > prefix && aLines[aEnd - 1] === bLines[bEnd - 1]) {
    aEnd--; bEnd--;
  }
  for (let i = 0; i < prefix; i++) out.push({ kind: 'ctx', text: aLines[i] });
  for (let i = prefix; i < aEnd; i++) out.push({ kind: 'del', text: aLines[i] });
  for (let j = prefix; j < bEnd; j++) out.push({ kind: 'add', text: bLines[j] });
  for (let i = aEnd; i < aLines.length; i++) out.push({ kind: 'ctx', text: aLines[i] });
  return out;
}

function collapseHunks(raw, ctxLines) {
  const isChange = (k) => k === 'add' || k === 'del';
  const visible = new Array(raw.length).fill(false);
  for (let k = 0; k < raw.length; k++) {
    if (!isChange(raw[k].kind)) continue;
    const lo = Math.max(0, k - ctxLines);
    const hi = Math.min(raw.length - 1, k + ctxLines);
    for (let kk = lo; kk <= hi; kk++) visible[kk] = true;
  }
  const out = [];
  let prevVisible = false;
  let started = false;
  for (let k = 0; k < raw.length; k++) {
    if (visible[k]) {
      if (started && !prevVisible) out.push({ kind: 'sep', text: '...' });
      out.push(raw[k]);
      prevVisible = true;
      started = true;
    } else {
      prevVisible = false;
    }
  }
  return out;
}
