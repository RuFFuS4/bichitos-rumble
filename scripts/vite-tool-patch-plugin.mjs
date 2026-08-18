// ---------------------------------------------------------------------------
// vite-tool-patch-plugin — dev-only HTTP endpoints for ToolPatch apply
// ---------------------------------------------------------------------------
//
// H3 slice 4. Mounts two POST endpoints on the Vite DEV server:
//
//   POST /__tool-patch/preview  { ...ToolPatch }  →
//     { ok, target, changed, diff: [{kind,text}…] }
//   POST /__tool-patch/apply    { ...ToolPatch }  →
//     { ok, target, changed, written }
//
// Both validate the envelope + payload with the same `validateToolPatch`
// the CLI uses, run the same pure mutators (scripts/tool-patch-core.mjs)
// and never write outside the three known target files (`targetByTool`
// — the client cannot choose paths). `apply` writes to the WORKING TREE
// only; committing stays a human act (`git diff` + commit), same
// contract as the CLI.
//
// Production safety is structural: `apply: 'serve'` means the plugin
// does not exist in builds — the endpoint 404s in prod because there is
// no server code at all, not because of a guard flag.
//
// Error shape: HTTP 400 (bad JSON / validation), 422 (mutator refused —
// anchors missing/ambiguous), 500 (unexpected). Always JSON:
// { ok: false, errors: [string…] }.
// ---------------------------------------------------------------------------

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  applyPatch,
  validateToolPatch,
  targetByTool,
  simpleDiff,
} from './tool-patch-core.mjs';

const MAX_BODY = 5 * 1024 * 1024; // 5 MB — patches are tiny; this is a DoS guard

export function toolPatchDevPlugin() {
  return {
    name: 'bichitos-tool-patch',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__tool-patch', (req, res) => {
        const respond = (status, body) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };

        const mode = req.url === '/preview' ? 'preview'
          : req.url === '/apply' ? 'apply'
          : null;
        if (!mode) return respond(404, { ok: false, errors: ['unknown endpoint'] });
        if (req.method !== 'POST') return respond(405, { ok: false, errors: ['POST only'] });

        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
          size += c.length;
          if (size > MAX_BODY) { req.destroy(); return; }
          chunks.push(c);
        });
        req.on('end', async () => {
          let patch;
          try {
            patch = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            return respond(400, { ok: false, errors: ['body is not valid JSON'] });
          }
          const problems = validateToolPatch(patch);
          if (problems.length > 0) return respond(400, { ok: false, errors: problems });

          const target = targetByTool[patch.tool];
          const targetPath = path.resolve(server.config.root, target);
          let original;
          try {
            original = await readFile(targetPath, 'utf8');
          } catch {
            return respond(500, { ok: false, errors: [`target file not found: ${target}`] });
          }

          let updated;
          try {
            updated = applyPatch(original, patch);
          } catch (err) {
            return respond(422, { ok: false, errors: [String(err.message ?? err)] });
          }

          const changed = updated !== original;
          if (mode === 'preview') {
            const diff = changed ? simpleDiff(original, updated) : [];
            server.config.logger.info(
              `[tool-patch] preview ${patch.tool} → ${target} (${changed ? diff.filter((l) => l.kind !== 'ctx' && l.kind !== 'sep').length + ' changed lines' : 'no change'})`,
            );
            return respond(200, { ok: true, target, changed, diff });
          }

          // apply
          if (!changed) return respond(200, { ok: true, target, changed: false, written: false });
          try {
            await writeFile(targetPath, updated, 'utf8');
          } catch (err) {
            return respond(500, { ok: false, errors: [`write failed: ${String(err.message ?? err)}`] });
          }
          server.config.logger.info(
            `[tool-patch] APPLIED ${patch.tool} → ${target} — review with \`git diff ${target}\` and commit when ready`,
          );
          return respond(200, { ok: true, target, changed: true, written: true });
        });
      });
    },
  };
}
