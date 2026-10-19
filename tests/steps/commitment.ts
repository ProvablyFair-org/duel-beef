/**
 * Steps 1–4: Commit-Reveal Integrity
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { verifyHash, computeDeathPoints, DEATH_POINTS_BY_DIFFICULTY } from '../../src/rng';
import {
  EXPECTED_SEEDS,
  EXPECTED_REVEALED_SEEDS,
  EXPECTED_SEED_TRANSITIONS,
  EXPECTED_PHASE_BOUNDARY_SKIPS,
  EXPECTED_NONCE_GAPS,
  EXPECTED_CAPTURE_RETRY_GAPS,
  EXPECTED_EPOCH_SIZE,
  EXPECTED_PHASE_E_SEEDS,
  EXPECTED_EPOCHS,
  EXPECTED_PHASE_E_EPOCHS,
  EXPECTED_PHASE_E_NONCE_GAPS,
} from '../../src/loader';
import type { BeefGame, SeedEntry } from '../../src/types';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, seedMap, byHash } = ctx;

  // ── Step 1: Seed hash integrity ─────────────────────────────────────────────
  // SHA-256(hex_decode(serverSeed)) === serverSeedHashed for all revealed seeds.
  //
  // "0 mismatches" is not a result — an empty seed list satisfies it, and so does a list
  // truncated to one row. The step therefore states how many comparisons it OWES against
  // the population in src/loader.ts and fails when it cannot make them. An unrevealed seed
  // is counted and named rather than passed over in silence, because a seed with no
  // plaintext is exactly the seed an operator would want no one to look at.
  const hashFailures: string[] = [];
  let compared = 0, phaseBoundarySkips = 0, unrevealed = 0;
  for (let i = 1; i < seeds.length; i++) {
    if (!seeds[i].seed.serverSeed) { unrevealed++; continue; }
    const match = verifyHash(seeds[i].seed.serverSeed!, seeds[i - 1].seed.serverSeedHashed);
    if (!match && seeds[i].phase !== seeds[i - 1].phase) {
      phaseBoundarySkips++;
      continue;
    }
    if (!match) {
      hashFailures.push(`seed[${i}]: SHA-256(revealed) ≠ seed[${i - 1}].serverSeedHashed`);
    }
    compared++;
  }

  const revealed = seeds.filter(s => s.seed.serverSeed).length;
  const s1Population: string[] = [];
  if (seeds.length !== EXPECTED_SEEDS) {
    s1Population.push(`seed records ${seeds.length} != ${EXPECTED_SEEDS}`);
  }
  if (revealed !== EXPECTED_REVEALED_SEEDS) {
    s1Population.push(`revealed seeds ${revealed} != ${EXPECTED_REVEALED_SEEDS}`);
  }
  if (compared + phaseBoundarySkips !== EXPECTED_SEED_TRANSITIONS) {
    s1Population.push(`transitions examined ${compared + phaseBoundarySkips} != ${EXPECTED_SEED_TRANSITIONS}`);
  }
  if (phaseBoundarySkips !== EXPECTED_PHASE_BOUNDARY_SKIPS) {
    s1Population.push(`phase-boundary skips ${phaseBoundarySkips} != ${EXPECTED_PHASE_BOUNDARY_SKIPS}`);
  }
  if (unrevealed !== 0) {
    s1Population.push(`${unrevealed} seed rows carry no plaintext and could not be checked`);
  }

  const s1Ok = hashFailures.length === 0 && s1Population.length === 0;
  const s1 = step(1, 'Seed Hash Integrity',
    s1Ok ? 'PASS' : 'FAIL',
    s1Ok
      ? `${compared} of the ${EXPECTED_SEED_TRANSITIONS} rotation transitions required by src/loader.ts verified by SHA-256; `
        + `${phaseBoundarySkips} phase-boundary transitions excluded (the opening rotations of Phases B, C and D reveal the previous phase's last bet-bearing seed again, not the end-of-phase seed, which had no bets); `
        + `0 seed rows without plaintext`
      : s1Population.length > 0
        ? `POPULATION MISMATCH vs src/loader.ts: ${s1Population.join('; ')}`
        : `${hashFailures.length} hash mismatches out of ${compared} comparisons`,
    {
      seedRecords: seeds.length,
      revealed,
      compared,
      phaseBoundarySkips,
      unrevealed,
      hashMismatches: hashFailures.length,
      populationIssues: s1Population,
      failures: hashFailures.slice(0, 10),
    },
  );

  // ── Step 2: Next-Seed Promotion + Forward Commitment Chain ──────────────────
  // Set membership proves a bet was served under SOME captured seed. It says nothing
  // about ORDER: an operator who can pick which of the committed seeds to activate next
  // has a free hand. This capture records a nextServerSeedHash on every seed row and a
  // promotion record whose previousNextHash is the hash read before the rotation, and
  // until this release nothing read either. The step read the capture script's own
  // `match` boolean, which is the script marking its own homework.
  //
  // Three checks, all recomputed here from raw hex:
  //   (a) promotion: previousNextHash === newActiveHash at every rotation;
  //   (b) forward chain: seeds[i].nextServerSeedHash === seeds[i+1].serverSeedHashed;
  //   (c) pre-capture link: the first epoch's active hash equals the "next" hash read
  //       before the first rotation — an ABSENT link fails, it does not pass.
  // They are NOT independent in this capture: the capture scripts copied each rotation's
  // next_server_seed_hash into both seeds[i].nextServerSeedHash and seeds[i+1]'s
  // previousNextHash (capture/beef-capture.reference.js:294, :299, :304), so (a) at row i
  // is (b) at link i-1→i, and (c) is (a) at row 0. Hash equality is consistency; that a
  // "next" hash was shown before the rotation that activated it rests on the capture's
  // write order (MANIFEST, Limitations and trust; premise P1), not on the hashes.
  const chainFailures: string[] = [];
  let promoChecked = 0, promoOk = 0;
  for (const s of seeds) {
    if (!s.nextSeedPromotion) {
      chainFailures.push(`${s.context}: no promotion record — rotation not observable`);
      continue;
    }
    promoChecked++;
    if (s.nextSeedPromotion.previousNextHash === s.nextSeedPromotion.newActiveHash) promoOk++;
    else chainFailures.push(
      `${s.context}: previousNextHash ${s.nextSeedPromotion.previousNextHash.substring(0, 16)}… ≠ newActiveHash ${s.nextSeedPromotion.newActiveHash.substring(0, 16)}…`,
    );
  }

  let linksChecked = 0, linksOk = 0;
  for (let i = 0; i < seeds.length - 1; i++) {
    linksChecked++;
    if (seeds[i].seed.nextServerSeedHash === seeds[i + 1].seed.serverSeedHashed) linksOk++;
    else chainFailures.push(
      `link ${i}→${i + 1}: seeds[${i}].nextServerSeedHash ≠ seeds[${i + 1}].serverSeedHashed — forward link broken`,
    );
  }

  const first = seeds[0];
  const preCaptureLink =
    first !== undefined
    && first.nextSeedPromotion !== undefined
    && first.nextSeedPromotion.previousNextHash === first.seed.serverSeedHashed;
  if (!preCaptureLink) {
    chainFailures.push(
      'pre-capture link absent: the first epoch\'s serverSeedHashed is not the hash that was outstanding as "next" before capture opened — the first epoch could have been chosen after observation began',
    );
  }

  // PHASE E CHAIN (2026-09-26). The supplementary multi-step capture is a second, separately pinned
  // run with its own 14 seed records; until today Step 2 read only the primary file, so the Phase E
  // commitment chain was never checked. The same three checks are recomputed on it — promotion,
  // forward links, and its own pre-capture link — bound to EXPECTED_PHASE_E_SEEDS.
  const eSeeds = ctx.phaseESeeds;
  let ePromoChecked = 0, ePromoOk = 0, eLinksChecked = 0, eLinksOk = 0;
  for (const s of eSeeds) {
    if (!s.nextSeedPromotion) { chainFailures.push(`Phase E ${s.context}: no promotion record`); continue; }
    ePromoChecked++;
    if (s.nextSeedPromotion.previousNextHash === s.nextSeedPromotion.newActiveHash) ePromoOk++;
    else chainFailures.push(`Phase E ${s.context}: previousNextHash ≠ newActiveHash`);
  }
  for (let i = 0; i < eSeeds.length - 1; i++) {
    eLinksChecked++;
    if (eSeeds[i].seed.nextServerSeedHash === eSeeds[i + 1].seed.serverSeedHashed) eLinksOk++;
    else chainFailures.push(`Phase E link ${i}→${i + 1}: nextServerSeedHash ≠ next serverSeedHashed`);
  }
  const ePre = eSeeds[0] !== undefined && eSeeds[0].nextSeedPromotion !== undefined
    && eSeeds[0].nextSeedPromotion.previousNextHash === eSeeds[0].seed.serverSeedHashed;
  if (!ePre) chainFailures.push('Phase E pre-capture link absent');

  const s2Population: string[] = [];
  if (promoChecked !== EXPECTED_SEEDS) s2Population.push(`promotion records ${promoChecked} != ${EXPECTED_SEEDS}`);
  if (linksChecked !== EXPECTED_SEED_TRANSITIONS) s2Population.push(`forward links ${linksChecked} != ${EXPECTED_SEED_TRANSITIONS}`);
  if (ePromoChecked !== EXPECTED_PHASE_E_SEEDS) s2Population.push(`Phase E promotion records ${ePromoChecked} != ${EXPECTED_PHASE_E_SEEDS}`);
  if (eLinksChecked !== EXPECTED_PHASE_E_SEEDS - 1) s2Population.push(`Phase E forward links ${eLinksChecked} != ${EXPECTED_PHASE_E_SEEDS - 1}`);

  const s2Ok = chainFailures.length === 0 && s2Population.length === 0;
  const s2 = step(2, 'Next-Seed Promotion + Forward Commitment Chain',
    s2Ok ? 'PASS' : 'FAIL',
    s2Ok
      ? `${promoOk}/${EXPECTED_SEEDS} rotations recomputed from raw hex (previousNextHash === newActiveHash), `
        + `${linksOk}/${EXPECTED_SEED_TRANSITIONS} forward links verified (seeds[i].nextServerSeedHash === seeds[i+1].serverSeedHashed), `
        + `pre-capture link present — consistency checks: in this capture a promotion and the forward link before it are one comparison, and that each "next" hash was shown before the rotation that activated it rests on the capture's write order, not on the hashes; Phase E file: `
        + `${ePromoOk}/${EXPECTED_PHASE_E_SEEDS} promotions, ${eLinksOk}/${EXPECTED_PHASE_E_SEEDS - 1} forward links, pre-capture link present`
      : s2Population.length > 0
        ? `POPULATION MISMATCH vs src/loader.ts: ${s2Population.join('; ')}`
        : `${chainFailures.length} commitment-chain breaks: ${chainFailures.slice(0, 3).join('; ')}`,
    {
      promotionsChecked: promoChecked,
      promotionsOk: promoOk,
      forwardLinksChecked: linksChecked,
      forwardLinksOk: linksOk,
      preCaptureLink,
      phaseE: { promotionsChecked: ePromoChecked, promotionsOk: ePromoOk, forwardLinksChecked: eLinksChecked, forwardLinksOk: eLinksOk, preCaptureLink: ePre },
      populationIssues: s2Population,
      failures: chainFailures.slice(0, 10),
    },
  );

  // ── Step 3: Hash consistency within epoch ────────────────────────────────────
  // The epoch is NOT taken from the bets. This step used to group bets BY serverSeedHashed and
  // then assert that each group had one serverSeedHashed — true by construction, so the FAIL
  // branch was unreachable. An epoch is defined here by the rotation TIMELINE instead: each seed
  // record opens a window at its `at`, and a bet belongs to the window of the latest rotation at
  // or before its own `at`. Every bet must then carry that rotation's serverSeedHashed AND
  // clientSeed. A bet served under a seed other than the one active at the time, a bet before
  // the first rotation (orphan), or bets that do not arrive in time order all fail.
  // Since 2026-09-26 the same timeline check runs on the separately pinned Phase E file (its own
  // 14 seed records and 450 bets), bound to EXPECTED_PHASE_E_EPOCHS.
  const timelineCheck = (label: string, recs: SeedEntry[], betList: BeefGame[], expectedWindows: number) => {
    const timeline = recs.map((x, i) => ({ i, t: Date.parse(x.at), hash: x.seed.serverSeedHashed, cs: x.seed.clientSeed }));
    const issues: string[] = [];
    const badSeedTimes = timeline.filter(w => !Number.isFinite(w.t)).length;
    if (badSeedTimes > 0) issues.push(`${label}: ${badSeedTimes} seed records without a parseable timestamp`);
    for (let i = 1; i < timeline.length; i++) {
      if (timeline[i].t < timeline[i - 1].t) { issues.push(`${label}: seed records out of time order at ${i}`); break; }
    }
    const windowBets = new Map<number, number>();
    const hashes = new Set<string>();
    let orphans = 0, wrongHash = 0, wrongClient = 0, outOfOrder = 0, lastT = -Infinity;
    let w = -1;
    for (const b of betList) {
      hashes.add(b.seed.serverSeedHashed);
      const t = Date.parse(b.at);
      if (!Number.isFinite(t) || t < lastT) outOfOrder++;
      lastT = Number.isFinite(t) ? t : lastT;
      while (w + 1 < timeline.length && timeline[w + 1].t <= t) w++;
      if (w < 0) { orphans++; continue; }
      const win = timeline[w];
      if (b.seed.serverSeedHashed !== win.hash) wrongHash++;
      if (b.seed.clientSeed !== win.cs) wrongClient++;
      windowBets.set(win.i, (windowBets.get(win.i) ?? 0) + 1);
    }
    if (orphans > 0)     issues.push(`${label}: ${orphans} bets before the first rotation record`);
    if (outOfOrder > 0)  issues.push(`${label}: ${outOfOrder} bets out of time order`);
    if (wrongHash > 0)   issues.push(`${label}: ${wrongHash} bets carry a serverSeedHashed other than the rotation active at their timestamp`);
    if (wrongClient > 0) issues.push(`${label}: ${wrongClient} bets carry a clientSeed other than the rotation active at their timestamp`);
    if (windowBets.size !== hashes.size) issues.push(`${label}: ${windowBets.size} bet-bearing rotation windows != ${hashes.size} distinct serverSeedHashed values in the bets`);
    if (windowBets.size !== expectedWindows) issues.push(`${label}: ${windowBets.size} bet-bearing windows != ${expectedWindows} declared in src/loader.ts`);
    const emptyWindows = timeline.filter(x => !windowBets.has(x.i)).map(x => x.i);
    return { issues, windows: windowBets.size, emptyWindows, orphans, wrongHash, wrongClient, outOfOrder };
  };
  const t3 = timelineCheck('primary', seeds, bets, EXPECTED_EPOCHS);
  const t3e = timelineCheck('Phase E', ctx.phaseESeeds, ctx.phaseE, EXPECTED_PHASE_E_EPOCHS);
  const s3Issues = [...t3.issues, ...t3e.issues];
  const s3 = step(3, 'Hash Consistency Within Epoch',
    s3Issues.length === 0 ? 'PASS' : 'FAIL',
    s3Issues.length === 0
      ? `Epochs taken from the rotation timeline, not from the bets: ${bets.length} bets fall in ${t3.windows} bet-bearing windows `
        + `(${t3.emptyWindows.length} rotation records with no bets: indices ${t3.emptyWindows.join(', ')}; 0 orphans), and every bet carries `
        + `the serverSeedHashed and clientSeed of the rotation active at its timestamp; Phase E file: ${ctx.phaseE.length} bets in `
        + `${t3e.windows} bet-bearing windows (${t3e.emptyWindows.length} rotation records with no bets), same result`
      : `EPOCH/SEED MISMATCH vs the rotation timeline: ${s3Issues.join('; ')}`,
    { betBearingWindows: t3.windows, emptyWindows: t3.emptyWindows, orphans: t3.orphans, wrongHash: t3.wrongHash,
      wrongClient: t3.wrongClient, outOfOrder: t3.outOfOrder,
      phaseE: { betBearingWindows: t3e.windows, emptyWindows: t3e.emptyWindows, orphans: t3e.orphans, wrongHash: t3e.wrongHash,
        wrongClient: t3e.wrongClient, outOfOrder: t3e.outOfOrder } },
  );

  // ── Step 4: Nonce Audit (sequential continuity + declared capture-retry gap) ──
  // Every epoch must start at nonce 0, hold no duplicate nonce, stay inside 0..EPOCH_SIZE−1,
  // and use one client seed. A gap is a hard FAIL unless it is a gap src/loader.ts declares BY
  // IDENTITY (epoch hash, nonce) — and a declared gap going missing is a FAIL too, because then the
  // data is not the capture the plan describes.
  //
  // What the missed round IS, is stated honestly: the gap's outcome can be RECONSTRUCTED from the
  // revealed seed (it is printed in the data block), but nothing in the capture records what the
  // operator served for it, so it is reconstructed, not verified.
  //
  // Duel video-poker / plinko standard (2026-09-23): the gap count is bound, a gap under a seed that
  // is unrevealed or does not hash to the commitment FAILs, and the planned gap is a capture-origin
  // FLAG rather than a PASS — the round was not captured, so it is disclosed on every run,
  // verdict-neutral (decision-13: never an operator finding).
  //
  // PHASE E (2026-09-26, MANIFEST DL-4). The separately pinned multi-step file was never nonce-audited.
  // It is now, by the same rule: 10 bet-bearing epochs (EXPECTED_PHASE_E_EPOCHS), and its one gap —
  // epoch 1dfe6dcf… (E4) nonce 31, followed by a 1-bet epoch, the same retry shape as the primary
  // file's — is declared by identity in EXPECTED_PHASE_E_NONCE_GAPS.
  const hardFailures: string[] = [];
  const observedGaps: string[] = [];
  const reconstructed: { file: string; epoch: string; nonce: number; deathPointsByDifficulty: Record<string, number[]> }[] = [];
  const auditNonces = (label: string, epochs: Map<string, BeefGame[]>, declared: Set<string>) => {
    for (const [hash, epochBets] of epochs) {
      const sorted = [...epochBets].sort((a, b) => a.seed.nonce - b.seed.nonce);
      const shortHash = `${label} ${hash.substring(0, 16)}`;
      const nonces = sorted.map(b => b.seed.nonce);

      const clientSeeds = new Set(sorted.map(b => b.seed.clientSeed));
      if (clientSeeds.size !== 1) hardFailures.push(`epoch ${shortHash}: ${clientSeeds.size} distinct client seeds`);
      if (nonces[0] !== 0)        hardFailures.push(`epoch ${shortHash}: first nonce is ${nonces[0]} (expected 0)`);
      const bad = nonces.filter(n => !Number.isInteger(n) || n < 0 || n > EXPECTED_EPOCH_SIZE - 1);
      if (bad.length > 0)         hardFailures.push(`epoch ${shortHash}: nonces outside 0..${EXPECTED_EPOCH_SIZE - 1}: ${bad.slice(0, 3).join(', ')}`);
      const dups = nonces.filter((n, i) => i > 0 && n === nonces[i - 1]);
      if (dups.length > 0)        hardFailures.push(`epoch ${shortHash}: duplicate nonce(s) ${[...new Set(dups)].slice(0, 3).join(', ')}`);

      const nonceSet = new Set(nonces);
      const maxNonce = Math.max(...nonces);
      for (let n = 0; n <= maxNonce; n++) {
        if (nonceSet.has(n)) continue;
        const key = `${hash}#${n}`;
        observedGaps.push(key);
        if (!declared.has(key)) { hardFailures.push(`epoch ${shortHash}: undeclared nonce gap at ${n}`); continue; }
        const ss = seedMap.get(hash);
        if (!ss) { hardFailures.push(`epoch ${shortHash}: declared gap at ${n} but the seed is unrevealed`); continue; }
        if (!verifyHash(ss, hash)) { hardFailures.push(`epoch ${shortHash}: declared gap at ${n} but the revealed seed does not hash to the commitment`); continue; }
        const byDiff: Record<string, number[]> = {};
        for (const d of [1, 2, 3, 4]) byDiff[String(d)] = computeDeathPoints(ss, sorted[0].seed.clientSeed, n, DEATH_POINTS_BY_DIFFICULTY[d]);
        reconstructed.push({ file: label, epoch: hash, nonce: n, deathPointsByDifficulty: byDiff });
      }
    }
  };
  const declaredGaps = new Set(EXPECTED_NONCE_GAPS.map(g => `${g.epochHash}#${g.nonce}`));
  const declaredEGaps = new Set(EXPECTED_PHASE_E_NONCE_GAPS.map(g => `${g.epochHash}#${g.nonce}`));
  const byHashE = new Map<string, BeefGame[]>();
  for (const b of ctx.phaseE) { const arr = byHashE.get(b.seed.serverSeedHashed) ?? []; arr.push(b); byHashE.set(b.seed.serverSeedHashed, arr); }
  auditNonces('primary', byHash, declaredGaps);
  auditNonces('Phase E', byHashE, declaredEGaps);
  const observedSet = new Set(observedGaps);
  for (const g of [...declaredGaps, ...declaredEGaps]) {
    if (!observedSet.has(g)) hardFailures.push(`declared gap ${g.substring(0, 16)}…#${g.split('#')[1]} not present in the data`);
  }
  const totalDeclared = EXPECTED_CAPTURE_RETRY_GAPS + EXPECTED_PHASE_E_NONCE_GAPS.length;
  if (observedGaps.length !== totalDeclared) {
    hardFailures.push(`${observedGaps.length} nonce gap(s) != ${totalDeclared} capture-retry gap(s) in the capture plan`);
  }
  if (declaredGaps.size !== EXPECTED_CAPTURE_RETRY_GAPS) {
    hardFailures.push(`EXPECTED_NONCE_GAPS lists ${declaredGaps.size} gap(s) != EXPECTED_CAPTURE_RETRY_GAPS ${EXPECTED_CAPTURE_RETRY_GAPS}`);
  }
  if (byHashE.size !== EXPECTED_PHASE_E_EPOCHS) hardFailures.push(`Phase E epochs ${byHashE.size} != ${EXPECTED_PHASE_E_EPOCHS}`);

  const s4Data = { epochs: byHash.size, phaseEEpochs: byHashE.size, observedGaps: observedGaps.length, declaredGaps: totalDeclared,
    expectedGaps: totalDeclared, reconstructed, failures: hardFailures.slice(0, 10) };
  const s4Head = `${byHash.size} primary + ${byHashE.size} Phase E epochs: nonces from 0, no duplicates, all within 0..${EXPECTED_EPOCH_SIZE - 1}, one client seed per epoch; `;
  const allDeclared = [...EXPECTED_NONCE_GAPS.map(g => `${g.epochHash.substring(0, 16)}…#${g.nonce}`),
    ...EXPECTED_PHASE_E_NONCE_GAPS.map(g => `Phase E ${g.epochHash.substring(0, 16)}…#${g.nonce}`)];
  const s4 = hardFailures.length > 0
    ? step(4, 'Nonce Audit', 'FAIL',
        `${hardFailures.length} nonce violation(s): ${hardFailures.slice(0, 4).join('; ')}`, s4Data)
    : observedGaps.length === 0
      ? step(4, 'Nonce Audit', 'PASS', s4Head + 'no nonce gaps', s4Data)
      : step(4, 'Nonce Audit', 'FLAG',
          s4Head
          + `${observedGaps.length} nonce gap(s), matching the ${totalDeclared} capture-retry gap(s) declared by identity in src/loader.ts `
          + `(${allDeclared.join(', ')}). Each revealed server seed `
          + `hashes to the commitment its epoch's bets were served under, so the missed rounds' death points are reconstructed in this step's data block — but `
          + `the rounds themselves were not captured and are NOT verified. Capture-origin FLAG: disclosed, verdict-neutral.`,
          s4Data, 'capture');

  return [s1, s2, s3, s4];
}
