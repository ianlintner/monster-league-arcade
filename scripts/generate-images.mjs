#!/usr/bin/env node
// Generates portraits, crests and arena tiles via fal.ai FLUX [schnell], then
// normalizes each through scripts/normalize-art.mjs (palette quantise + 1px
// #0B0711 outline) so every still shares the Halloween Midnight Palette.
// Logs every paid call to the gitignored .asset-manifest.json BEFORE download;
// a paid request can never be omitted from the budget ledger. Needs FAL_KEY.
// Usage: node scripts/generate-images.mjs [--force]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (p) => join(ROOT, 'public/assets', p);
const MODEL = 'fal-ai/flux/schnell';
// Current fal.ai list price (read 2026-11-17 from https://fal.ai/models/fal-ai/flux/schnell).
const COST_PER_MP = 0.003; // USD per megapixel, billed by rounding up to the nearest MP
const BUDGET = 5.0;
const manifestPath = join(ROOT, '.asset-manifest.json');

// One asset per paid call, single-image subjects only. No text/franchise/brand
// in prompts — original designs only. Pixel-art portrait/crest/tile subjects.
const SUBJECTS = [
  {
    kind: 'portrait',
    id: 'coach_boneyard_reapers',
    prompt:
      'cartoon skeleton football coach bust, bone white skull, purple helmet, cyan glowing eye sockets, side profile, dark background, 16-bit pixel art',
  },
  {
    kind: 'portrait',
    id: 'coach_rotting_deadskins',
    prompt:
      'cartoon zombie football coach bust, olive rotting skin, torn red jersey, amber glowing eyes, exposed grey brain patch, dark background, 16-bit pixel art',
  },
  {
    kind: 'portrait',
    id: 'coach_transylvania_nightstalkers',
    prompt:
      'cartoon vampire football coach bust, pale skin, black hair, crimson cape collar, gold medallion, fangs, dark background, 16-bit pixel art',
  },
  {
    kind: 'portrait',
    id: 'coach_salem_bayou_ghouls',
    prompt:
      'cartoon witch ghoul football coach bust, green skin, pointed purple witch hat, orange glowing eyes, dark background, 16-bit pixel art',
  },
  {
    kind: 'portrait',
    id: 'necro_ref',
    prompt:
      'cartoon skeleton referee bust, black and white vertical striped shirt, red glowing eyes, dark background, 16-bit pixel art',
  },
  {
    kind: 'portrait',
    id: 'demon_ref',
    prompt:
      'cartoon red demon referee bust, white and black vertical striped shirt, horns, amber glowing eyes, dark background, 16-bit pixel art',
  },
  {
    kind: 'portrait',
    id: 'crypt_announcer',
    prompt:
      'cartoon grey stone gargoyle announcer bust, iron headset microphone, green glowing eyes, dark background, 16-bit pixel art',
  },
  {
    kind: 'crest',
    id: 'boneyard_reapers',
    prompt:
      'football team crest emblem, white skull with crossed bones on purple shield, cyan accents, symmetrical, flat 16-bit pixel art, no text',
  },
  {
    kind: 'crest',
    id: 'rotting_deadskins',
    prompt:
      'football team crest emblem, decaying zombie face on rust red shield, green slime accents, symmetrical, flat 16-bit pixel art, no text',
  },
  {
    kind: 'crest',
    id: 'transylvania_nightstalkers',
    prompt:
      'football team crest emblem, bat wings and fangs on crimson shield, gold accents, symmetrical, flat 16-bit pixel art, no text',
  },
  {
    kind: 'crest',
    id: 'salem_bayou_ghouls',
    prompt:
      'football team crest emblem, jack o lantern on violet witch shield, orange flame accents, symmetrical, flat 16-bit pixel art, no text',
  },
  {
    kind: 'arena',
    id: 'cursed_graveyard',
    prompt:
      'seamless tileable texture, weathered gothic graveyard turf, dark green grass with tombstone grey speckles, top-down, flat 16-bit pixel art, no text',
  },
  {
    kind: 'arena',
    id: 'brimstone_hellfire_pit',
    prompt:
      'seamless tileable texture, cracked obsidian stone with ember orange veins, top-down, flat 16-bit pixel art, no text',
  },
  {
    kind: 'arena',
    id: 'ectoplasm_swamp',
    prompt:
      'seamless tileable texture, toxic swamp muddy bog, olive brown with green slime patches, top-down, flat 16-bit pixel art, no text',
  },
];

// Sum image spend only. The ledger is shared with generate-announcer.mjs, whose
// `kind: 'audio'` entries draw from a separate budget; counting them here would
// shrink the image cap and misreport image spending.
const isImage = (e) => (e.kind ?? '') !== 'audio';
const spendOf = (m) => (m.entries ?? []).filter(isImage).reduce((s, e) => s + (e.costUsd ?? 0), 0);

const normalize = (src, dest, opts = []) =>
  execFileSync(process.execPath, [join(ROOT, 'scripts/normalize-art.mjs'), src, dest, ...opts]);

/**
 * Call fal once for `s`, persist the paid entry to the ledger IMMEDIATELY, then
 * download. Returns the downloaded buffer. Throws on a non-OK response so the
 * caller can reject/retry. Never auto-retries on timeout (caller checks id).
 */
async function generate(s) {
  const res = await fetch(`https://fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: s.prompt,
      image_size: 'square_hd', // 1024x1024 → downscaled + normalised to 64x64
      num_images: 1,
      num_inference_steps: 4, // schnell default; low cost, fast
      enable_safety_checker: true,
    }),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const cost = parseFloat(COST_PER_MP.toFixed(4)); // 1024x1024 ≈ 1.05 MP → billed 2 MP
  return { body, cost: cost * 2 };
}

/**
 * Derive a jaw-open variant of a 64x64 portrait bust so the two-frame talk
 * animation has real motion (col0 = mouth closed, col1 = mouth/jaw dropped).
 * Deterministic: shifts the lower-face band down 2px and inserts a 2px mouth
 * gap, without touching the upper head or chest. The result is re-normalized
 * (palette + outline) alongside the closed frame, so it stays validator-clean.
 */
export async function jawDrop(src, out) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const dst = new Uint8Array(data); // copy
  const col = (x, y) => (y * w + x) * 4;
  const put = (x, y, i) => dst.set(data.subarray(i, i + 4), col(x, y));
  const MOUTH_TOP = Math.floor(h * 0.6); // ~y38 on a 64px bust
  const MOUTH_BOT = Math.floor(h * 0.78); // ~y50
  const drop = Math.max(1, Math.floor(h * 0.03)); // ~2px
  // shift the mouth band down, bottom-up so we don't clobber source rows
  for (let y = MOUTH_BOT - 1; y >= MOUTH_TOP; y--)
    for (let x = 0; x < w; x++) if (data[col(x, y) + 3] !== 0) put(x, y + drop, col(x, y));
  // clear the vacated band to transparent, leaving a mouth gap
  for (let y = MOUTH_TOP; y < MOUTH_TOP + drop; y++)
    for (let x = 0; x < w; x++) dst[col(x, y) + 3] = 0;
  await sharp(Buffer.from(dst), { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(out);
}

/**
 * Post-normalize QA before a candidate replaces the on-disk destinaton. Mirrors
 * the validator's occupancy rules so a uniform-background subject that
 * normalizes to near-transparency is rejected instead of recorded as `pass`.
 */
async function qaCheck(path, kind) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let opaque = 0;
  let transparent = 0;
  for (let i = 0; i < w * h; i++)
    if (data[i * 4 + 3] === 0) transparent++;
    else opaque++;
  if (kind === 'arena') return transparent === 0; // opaque tiling tile: no gaps
  if (kind === 'portrait') {
    // 128x64 = two 64x64 cells; each must carry at least 100 opaque px (validator min)
    const cellOpaque = (col) => {
      let n = 0;
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) if (data[(y * w + col * 64 + x) * 4 + 3] !== 0) n++;
      return n;
    };
    return opaque >= 400 && cellOpaque(0) >= 100 && cellOpaque(1) >= 100;
  }
  return opaque >= 200; // crest
}

async function main() {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY not set');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : { entries: [] };
  manifest.entries ??= [];
  const force = process.argv.includes('--force');
  const perCall = parseFloat((2 * COST_PER_MP).toFixed(4));

  for (const s of SUBJECTS) {
    const kindDir = s.kind === 'portrait' ? 'portraits' : s.kind === 'crest' ? 'sprites' : 'arenas';
    const fileName =
      s.kind === 'crest'
        ? `crest_${s.id}.png`
        : s.kind === 'arena'
          ? `${s.id}_turf.png`
          : `${s.id}.png`;
    const dest = out(join(kindDir, fileName));
    if (existsSync(dest) && !force) {
      console.log(`skip ${dest} (exists)`);
      continue;
    }

    // One asset per call; reject + retry at most twice, then fall back to the
    // procedural generator (which already produced these deterministic stills).
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      // Budget guard immediately before every paid attempt, not just the first.
      const spent = spendOf(manifest);
      if (spent + perCall > BUDGET)
        throw new Error(`budget exceeded (${spent} + ${perCall} > ${BUDGET})`);

      const { body, cost: actualCost } = await generate(s);
      // Log the paid call BEFORE any download/normalize step can fail.
      manifest.entries.push({
        kind: s.kind,
        id: s.id,
        model: MODEL,
        prompt: s.prompt,
        costUsd: actualCost,
        requestId: body.request_id ?? null,
        status: 'paid_pending_normalize',
        file: dest,
        qa_verdict: 'pending',
        at: new Date().toISOString(),
      });
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      // Download + decode + normalize ALL live inside the attempt try block so a
      // failed download or invalid image takes the retry/fallback path instead of
      // aborting the script with a dangling paid entry.
      try {
        const img = body.images?.[0];
        if (!img?.url) throw new Error('fal response missing image url');
        const dl = await fetch(img.url);
        if (!dl.ok) throw new Error(`image download HTTP ${dl.status}`);
        const rawPng = Buffer.from(await dl.arrayBuffer());
        const rawPath = join(ROOT, `.cache-${s.id}-${attempt}.png`);
        writeFileSync(rawPath, rawPng);

        // Every cell is 64x64: resize the single subject to a 64x64 cell, and only
        // the assembled two-frame portrait sheet should be 128x64.
        const cellPng = join(ROOT, `.cell-${s.id}-${attempt}.png`);
        await sharp(rawPng)
          .resize(64, 64, { kernel: 'nearest', fit: 'cover' })
          .png()
          .toFile(cellPng);

        const candidate = `${dest}.candidate.png`;
        if (s.kind === 'arena') normalize(cellPng, candidate, ['--opaque']);
        else if (s.kind === 'portrait') {
          // Remove the generated background BEFORE deriving the jaw frame. The
          // normalizer skips background removal for any cell that already carries
          // alpha, so jawDrop (which introduces alpha in the jaw band) running on
          // the still-opaque cell would leave the jaw-open frame with its original
          // background — flashing against the transparent closed frame. Strip the
          // background from the raw 64x64 cell first, then both frames share the
          // same clean transparent backdrop and the final pass only quantises and
          // re-outlines.
          const cellClean = join(ROOT, `.cell-${s.id}-${attempt}-clean.png`);
          normalize(cellPng, cellClean, []); // single 64x64 cell → bg removed + palette + outline
          const jawPng = join(ROOT, `.jaw-${s.id}-${attempt}.png`);
          await jawDrop(cellClean, jawPng);
          const single = join(ROOT, `.single-${s.id}.png`);
          const sheet = await sharp({
            create: {
              width: 128,
              height: 64,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
          })
            .composite([
              { input: cellClean, left: 0, top: 0 }, // closed mouth
              { input: jawPng, left: 64, top: 0 }, // jaw-open second frame
            ])
            .png()
            .toBuffer();
          await sharp(sheet).png().toFile(single);
          normalize(single, candidate, ['--cell', '64x64']);
        } else normalize(cellPng, candidate, []);

        // Validate the candidate before it replaces the destination; a
        // near-transparent quantise must not overwrite a good procedural asset.
        if (!(await qaCheck(candidate, s.kind)))
          throw new Error('candidate failed occupancy QA (too little opaque content)');

        renameSync(candidate, dest);
        ok = true;
        const entry = manifest.entries[manifest.entries.length - 1];
        entry.status = 'normalized';
        entry.qa_verdict = 'pass';
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.log(`generated ${dest} ($${actualCost.toFixed(4)}, attempt ${attempt})`);
      } catch (err) {
        const candidate = `${dest}.candidate.png`;
        if (existsSync(candidate)) unlinkSync(candidate); // never leave a bad candidate behind
        const entry = manifest.entries[manifest.entries.length - 1];
        entry.status = attempt >= 2 ? 'fallback_procedural' : 'rejected';
        entry.qa_verdict = 'fail';
        entry.error = String(err.message ?? err).slice(0, 200);
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.error(`reject ${dest} attempt ${attempt}: ${entry.error}`);
      }
    }
    if (!ok) {
      // Fall back to procedural: the deterministic generator already emitted these.
      console.log(`fallback to procedural for ${dest} (run generate-art.mjs)`);
    }
  }
  console.log(`image spend: $${spendOf(manifest).toFixed(4)} / $${BUDGET}`);
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
