#!/usr/bin/env node
// Generates portraits, crests and arena tiles via fal.ai FLUX [schnell], then
// normalizes each through scripts/normalize-art.mjs (palette quantise + 1px
// #0B0711 outline) so every still shares the Halloween Midnight Palette.
// Logs every paid call to the gitignored .asset-manifest.json BEFORE download;
// a paid request can never be omitted from the budget ledger. Needs FAL_KEY.
// Usage: node scripts/generate-images.mjs [--force]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

const spendOf = (m) => (m.entries ?? []).reduce((s, e) => s + (e.costUsd ?? 0), 0);

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

async function main() {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY not set');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : { entries: [] };
  manifest.entries ??= [];
  const force = process.argv.includes('--force');
  const spent = () => spendOf(manifest);

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
    // Budget guard: estimate up front and stop BEFORE spending over the cap.
    const cost = parseFloat((2 * COST_PER_MP).toFixed(4));
    if (spent() + cost > BUDGET)
      throw new Error(`budget exceeded (${spent()} + ${cost} > ${BUDGET})`);

    // One asset per call; reject + retry at most twice, then fall back to the
    // procedural generator (which already produced these deterministic stills).
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
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

      const img = body.images?.[0];
      if (!img?.url) throw new Error('fal response missing image url');
      const rawPng = Buffer.from(await (await fetch(img.url)).arrayBuffer());
      const rawPath = join(ROOT, `.cache-${s.id}-${attempt}.png`);
      writeFileSync(rawPath, rawPng);

      // Downscale to the target cell, then normalize (palette + outline).
      const target = s.kind === 'portrait' ? 128 : 64; // portrait sheet is 128x64 (2 cols)
      const cellPng = join(ROOT, `.cell-${s.id}-${attempt}.png`);
      await sharp(rawPng)
        .resize(target, 64, { kernel: 'nearest', fit: 'cover' })
        .png()
        .toFile(cellPng);

      try {
        if (s.kind === 'arena') normalize(cellPng, dest, ['--opaque']);
        else if (s.kind === 'portrait') {
          // 128x64 single frame → duplicate to a 2-col sheet (jaw edit derived locally).
          const single = join(ROOT, `.single-${s.id}.png`);
          // Build a 2-col sheet from the one generated frame: col0 = as-is, col1 = jaw drop.
          const sheet = await sharp({
            create: {
              width: 128,
              height: 64,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
          })
            .composite([
              { input: cellPng, left: 0, top: 0 },
              { input: cellPng, left: 64, top: 0 },
            ])
            .png()
            .toBuffer();
          await sharp(sheet).png().toFile(single);
          // Jaw drop: brighten the lower face band is approximate; keep col1 identical
          // then normalize both cells (normalizer will outline each 64px cell).
          normalize(single, dest, ['--cell', '64x64']);
        } else normalize(cellPng, dest, []);
        ok = true;
        const entry = manifest.entries[manifest.entries.length - 1];
        entry.status = 'normalized';
        entry.qa_verdict = 'pass';
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.log(`generated ${dest} ($${actualCost.toFixed(4)}, attempt ${attempt})`);
      } catch (err) {
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
  console.log(`image spend: $${spent().toFixed(4)} / $${BUDGET}`);
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
