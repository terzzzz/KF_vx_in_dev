/* js/training_worker.js
 * Kamen Fight
 * Build: v5-state256-action17
 * Matrix: v8-8riders-9backup (Sequential 1-Cell-at-a-Time Low-Memory Worker)
 * Patch: charge1-reset1
 */
"use strict";

const BUILD = "v5-state256-action17";
const VERSION = "kf-soul-ddqn-v5-state256-action17";
const PATCH = "charge1-reset1";
const CACHE_TAG = BUILD + "-" + PATCH + "-v8";

const EXPECTED_SCHEMA =
  "kf-state256-action17-v2-charge1-reset1";

const MIXED_CPU_SEQUENCE = [
  "easy",
  "balanced",
  "defensive",
  "master"
];
const MAX_WINS_PER_DIFF_OPP = 4;
const MAX_REPLAY_ITEMS = 2048;

const YIELD_INTERVAL_MS = 350;
const PROGRESS_INTERVAL_MS = 1500;
const CHECKPOINT_GAME_INTERVAL = 120;
const CHECKPOINT_MIN_INTERVAL_MS = 15000;

const MIXED_MODE_LABELS = {
  easy: "mixed:tree-hopper",
  balanced: "mixed:cricket",
  defensive: "mixed:beetle",
  master: "mixed:bullet-ant"
};

importScripts(...[
  "common.js",
  "combat_core.js",
  "rider_brains.js",
  "foresee_engine.js",
  "charge_env.js",
  "neural_core.js",
  "soul_sim.js",
  "soul_agent.js",
  "ai.js"
].map(file => file + "?v=" + CACHE_TAG));

// Quantize JSON floats to 4 decimals (~200KB per matrix instead of ~850KB)
function compactNetValue(val) {
  if (typeof val === "number") {
    return Number.isFinite(val) ? Math.round(val * 10000) / 10000 : 0;
  }
  if (Array.isArray(val) || ArrayBuffer.isView(val)) {
    const out = new Array(val.length);
    for (let i = 0; i < val.length; i++) out[i] = compactNetValue(val[i]);
    return out;
  }
  if (val && typeof val === "object") {
    const out = {};
    for (const k of Object.keys(val)) out[k] = compactNetValue(val[k]);
    return out;
  }
  return val;
}

if (typeof SoulNN !== "undefined" && SoulNN.Network?.prototype?.toJSON) {
  const _origToJSON = SoulNN.Network.prototype.toJSON;
  SoulNN.Network.prototype.toJSON = function () {
    return compactNetValue(_origToJSON.call(this));
  };
}

const ACTION_PARTS_CACHE = Object.create(null);
if (typeof SoulEnv !== "undefined" && Array.isArray(SoulEnv.ACTION_MAP)) {
  for (const actKey of SoulEnv.ACTION_MAP) {
    const parts = String(actKey).split("+");
    const stance = ["W", "A", "S", "D"].includes(parts[0]) ? parts[0] : "IDLE";
    const button = ["J", "K", "I", "L"].includes(parts[1]) ? parts[1] : "NONE";
    ACTION_PARTS_CACHE[actKey] = { stance, button };
  }
}

function getActionParts(key) {
  let cached = ACTION_PARTS_CACHE[key];
  if (!cached) {
    const parts = String(key).split("+");
    const stance = ["W", "A", "S", "D"].includes(parts[0]) ? parts[0] : "IDLE";
    const button = ["J", "K", "I", "L"].includes(parts[1]) ? parts[1] : "NONE";
    cached = { stance, button };
    ACTION_PARTS_CACHE[key] = cached;
  }
  return cached;
}

let busy = false;
let cancelled = false;

const channel = new MessageChannel();
let resume = null;

channel.port1.onmessage = () => {
  const callback = resume;
  resume = null;
  if (callback) callback();
};

function pause() {
  return new Promise(resolve => {
    resume = resolve;
    channel.port2.postMessage(null);
  });
}

function send(type, payload = {}) {
  self.postMessage({
    type,
    build: BUILD,
    patch: PATCH,
    schema: EXPECTED_SCHEMA,
    ...payload
  });
}

function assertRuntime() {
  if (
    SoulEnv.SCHEMA !== EXPECTED_SCHEMA ||
    typeof CombatCore.chargePercent !== "function" ||
    typeof CombatCore.cpuReadyAtMs !== "function" ||
    typeof CombatCore.lastInputMs !== "function"
  ) {
    throw new Error("Training worker loaded incompatible charging rules.");
  }

  if (
    KF_AI.VERSION !== BUILD ||
    SoulSim.BUILD !== BUILD ||
    SoulNN.BUILD !== BUILD ||
    SoulAgent.VERSION !== BUILD
  ) {
    throw new Error("Training worker module build mismatch.");
  }

  SoulEnv.assertSpec(SoulEnv.makeSpec());
}

function validateJob(job) {
  assertRuntime();

  if (
    job?.build !== BUILD ||
    job.patch !== PATCH ||
    job.schema !== EXPECTED_SCHEMA ||
    !["train", "evaluate"].includes(job.kind)
  ) {
    throw new Error("Invalid job or mismatched training UI/worker patch.");
  }

  if (!job.data || !Array.isArray(job.data.riders) || !job.data.moves) {
    throw new Error("Training job is missing combat data.");
  }

  SoulAgent.syncRosterCodes(job.data.riders);

  if (!Number.isInteger(job.matches) || job.matches < 2 || job.matches > 100000) {
    throw new Error("Match count must be from 2 to 100000.");
  }

  if (job.kind === "evaluate" && job.matches % 2 !== 0) {
    throw new Error("Evaluation count must be even for slot pairing.");
  }

  if (!Number.isSafeInteger(job.seed) || job.seed < 0 || job.seed > 4294967295) {
    throw new Error("Invalid job seed.");
  }

  if (!["standard", "terminal_only"].includes(job.rewardMode)) {
    throw new Error("Invalid reward mode.");
  }

  if (!job.learner || !job.opponent) {
    throw new Error("Select a learner and opponent.");
  }

  const aliases = {
    novice: "easy",
    "tree-hopper": "easy",
    tree_hopper: "easy",
    treehopper: "easy",
    balance: "balanced",
    cricket: "balanced",
    defense: "defensive",
    beetle: "defensive",
    "bullet-ant": "master",
    bullet_ant: "master",
    bulletant: "master",
    soul: "master",
    mcts: "rider"
  };

  job.mode = aliases[String(job.mode || "").toLowerCase()] || job.mode;
  job.teacher = aliases[String(job.teacher || "master").toLowerCase()] || job.teacher;

  if (!["mixed", "easy", "balanced", "defensive", "master", "rider"].includes(job.mode)) {
    throw new Error("Invalid opponent controller.");
  }
}

function validateTransition(transition) {
  const index = transition?.a;
  if (!Number.isInteger(index) || index < 0 || index >= SoulEnv.ACTION_MAP.length) {
    throw new Error("Episode returned an invalid action index.");
  }

  const key = SoulEnv.ACTION_MAP[index];
  const charge = transition.selectedCharge;
  const validCharge = key === "DO_NOTHING"
    ? charge === 0
    : Number.isFinite(charge) && charge >= 1 && charge <= 100;

  if (
    !validCharge ||
    !transition.m?.[index] ||
    !Number.isFinite(transition.r) ||
    transition.actionKey !== key ||
    transition.selectedActionKey !== key ||
    transition.resolvedActionKey !== key ||
    transition.charge !== charge ||
    transition.resolvedCharge !== charge ||
    transition.coreAdjustedAction === true
  ) {
    throw new Error("Episode action/charge mismatch.");
  }
}

function blendParameter(oldAvg, oldGames, newVal) {
  if (!Number.isFinite(newVal)) return oldAvg || 0;
  if (oldGames <= 0 || !Number.isFinite(oldAvg)) return newVal;
  const alpha = Math.max(0.02, 1 / (oldGames + 1));
  return oldAvg * (1 - alpha) + newVal * alpha;
}

function updateMatchParameters(params, prevTotalGames, metrics, wasdCounts, jkilCounts) {
  const updated = params || SoulAgent.createDefaultMatchParameters();
  if (!metrics) return updated;

  updated.avgRounds = blendParameter(updated.avgRounds, prevTotalGames, metrics.rounds);
  updated.avgFinalLpRatio = blendParameter(updated.avgFinalLpRatio, prevTotalGames, metrics.finalLpRatio);
  updated.avgEnemyFinalLpRatio = blendParameter(updated.avgEnemyFinalLpRatio, prevTotalGames, metrics.enemyFinalLpRatio);
  updated.avgDamageDealtRatio = blendParameter(updated.avgDamageDealtRatio, prevTotalGames, metrics.damageDealtRatio);
  updated.avgDamageTakenRatio = blendParameter(updated.avgDamageTakenRatio, prevTotalGames, metrics.damageTakenRatio);
  updated.avgChiEarned = blendParameter(updated.avgChiEarned, prevTotalGames, metrics.chiEarnedPerRound);
  updated.avgChiSpent = blendParameter(updated.avgChiSpent, prevTotalGames, metrics.chiSpentPerRound);
  updated.avgNetChiAdvantage = blendParameter(updated.avgNetChiAdvantage, prevTotalGames, metrics.netChiAdvantage);
  updated.avgExecutionCharge = blendParameter(updated.avgExecutionCharge, prevTotalGames, metrics.avgExecutionCharge);
  updated.priorityWinRate = blendParameter(updated.priorityWinRate, prevTotalGames, metrics.priorityWinRate);
  updated.sMoveUsageRate = blendParameter(updated.sMoveUsageRate, prevTotalGames, metrics.sMoveUsageRate);
  updated.aGuardSuccessRate = blendParameter(updated.aGuardSuccessRate, prevTotalGames, metrics.aGuardSuccessRate);
  updated.wBuffCastRate = blendParameter(updated.wBuffCastRate, prevTotalGames, metrics.wBuffCastRate);
  updated.evasionTriggerRate = blendParameter(updated.evasionTriggerRate, prevTotalGames, metrics.evasionTriggerRate);
  updated.faintInflictedRate = blendParameter(updated.faintInflictedRate, prevTotalGames, metrics.faintInflicted);
  updated.faintSufferedRate = blendParameter(updated.faintSufferedRate, prevTotalGames, metrics.faintSuffered);

  if (Number.isFinite(metrics.armorBreakAppliedRate)) {
    updated.armorBreakAppliedRate = blendParameter(updated.armorBreakAppliedRate, prevTotalGames, metrics.armorBreakAppliedRate);
  }
  if (Number.isFinite(metrics.chiDrainedPerRound)) {
    updated.avgChiDrained = blendParameter(updated.avgChiDrained, prevTotalGames, metrics.chiDrainedPerRound);
  }

  const stanceTotal = Math.max(
    1,
    (wasdCounts.W || 0) + (wasdCounts.A || 0) + (wasdCounts.S || 0) + (wasdCounts.D || 0) + (wasdCounts.IDLE || 0)
  );
  for (const k of ["W", "A", "S", "D", "IDLE"]) {
    updated.stanceDistribution[k] = Math.round(((wasdCounts[k] || 0) / stanceTotal) * 10000) / 10000;
  }

  const buttonTotal = Math.max(
    1,
    (jkilCounts.J || 0) + (jkilCounts.K || 0) + (jkilCounts.I || 0) + (jkilCounts.L || 0) + (jkilCounts.NONE || 0)
  );
  for (const k of ["J", "K", "I", "L", "NONE"]) {
    updated.buttonDistribution[k] = Math.round(((jkilCounts[k] || 0) / buttonTotal) * 10000) / 10000;
  }

  return updated;
}

function acceptWithCap(learner, transition, imitation) {
  learner.accept(transition, imitation);
  const items = learner?.replay?.items;
  if (Array.isArray(items) && items.length > MAX_REPLAY_ITEMS) {
    items.splice(0, items.length - MAX_REPLAY_ITEMS);
  }
}

async function run(job) {
  validateJob(job);

  const training = job.kind === "train";
  const data = job.data;
  const spec = SoulEnv.makeSpec();
  const hiddenSizes = spec.hidden.slice();
  const seed = job.seed >>> 0;

  const activeRowRiders = data.riders.slice(0, 8);
  const learnerRider = activeRowRiders.find(rider => rider.id === job.learner);
  if (!learnerRider) {
    throw new Error("Selected learner rider is absent from the active 8-rider roster.");
  }

  const isMultiOpponent = job.opponent === "*";
  const targetOpponentRiders = isMultiOpponent
    ? activeRowRiders.filter(r => {
        if (training) return true;
        const key = SoulAgent.getCanonicalKey(job.learner, r.id);
        return Boolean(job.checkpointsByMatchup?.[key]);
      })
    : [activeRowRiders.find(r => r.id === job.opponent)].filter(Boolean);

  if (targetOpponentRiders.length === 0) {
    throw new Error(
      training
        ? "No opponent riders found in active 8-rider roster."
        : "No checkpoints exist to evaluate for this learner."
    );
  }

  // Allocate matches per opponent cell so each cell runs sequentially and frees RAM immediately
  const numOpps = targetOpponentRiders.length;
  const perOppAllocations = targetOpponentRiders.map((oppRider, idx) => {
    if (!training) {
      const totalPairs = Math.floor(job.matches / 2);
      const basePairs = Math.floor(totalPairs / numOpps);
      const extraPair = idx < (totalPairs % numOpps) ? 1 : 0;
      return { oppRider, count: (basePairs + extraPair) * 2 };
    }
    const base = Math.floor(job.matches / numOpps);
    const extra = idx < (job.matches % numOpps) ? 1 : 0;
    return { oppRider, count: base + extra };
  }).filter(item => item.count > 0);

  const totalPlannedMatches = perOppAllocations.reduce((s, x) => s + x.count, 0);

  const riderDistillation = training && job.learnerPolicy === "rider";
  const riderImitationCoefficient = 0.02;
  const initialEpsilonBase = job.initialEpsilon / 100;
  const winOnly = job.winOnly;

  const started = performance.now();
  let lastProgress = started;
  let lastYield = started;
  let lastCheckpointSent = started;

  let games = 0;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let rounds = 0;
  let transitions = 0;
  let qSum = 0;
  let qCount = 0;
  let totalUpdates = 0;
  let latestLoss = 0;
  let singleBaseGames = 0;
  let singleWeightsID = null;
  let singleLoadedWeightsID = null;
  let singleCellParams = null;
  const aggUpdateStats = { win: 0, damage: 0, loss: 0, neutral: 0 };

  let guideProbability = 0;
  let imitation = 0;
  let epsilon = 0;

  const breakdown = {};
  const firstWinningGames = [];
  let lastReportedWinsCount = 0;
  const winCountsByDiffOpp = {};
  const matchupReports = [];

  const wasdCounts = { W: 0, A: 0, S: 0, D: 0, IDLE: 0 };
  const jkilCounts = { J: 0, K: 0, I: 0, L: 0, NONE: 0 };
  const moveMatrix = Object.fromEntries(
    Object.keys(wasdCounts).map(stance => [stance, { J: 0, K: 0, I: 0, L: 0, NONE: 0 }])
  );

  const modeDisplayNames = {
    easy: "Tree-hopper (easy)",
    balanced: "Cricket (balanced)",
    defensive: "Beetle (defensive)",
    master: "Bullet Ant (master)",
    rider: "Rider"
  };

  const effectiveOpponent = job.mode === "rider"
    ? "Rider (reverse active matchup checkpoint)"
    : job.mode === "mixed"
      ? "MIXED cycle (Tree-hopper -> Cricket -> Beetle -> Bullet Ant)"
      : modeDisplayNames[job.mode] || job.mode;

  const fastTeachers = ["balanced", "defensive", "balanced", "master"];

  // Train/Evaluate ONE opponent cell at a time and release its memory before the next cell
  for (let cellIdx = 0; cellIdx < perOppAllocations.length && !cancelled; cellIdx++) {
    const { oppRider, count: cellMatches } = perOppAllocations[cellIdx];
    const key = SoulAgent.getCanonicalKey(job.learner, oppRider.id);

    const old = isMultiOpponent
      ? (job.checkpointsByMatchup?.[key] || null)
      : (job.checkpoint || job.checkpointsByMatchup?.[key] || null);

    if (old) {
      const validation = SoulAgent.validateCheckpoint(old, job.learner, oppRider.id);
      if (!validation.valid) {
        throw new Error(`Checkpoint ${key} rejected: ${validation.error}`);
      }
    }

    if (!training && !old) {
      throw new Error(`No checkpoint exists to evaluate for ${key}.`);
    }

    let net = old
      ? SoulNN.Network.fromJSON(old.net)
      : new SoulNN.Network(spec.input, ...spec.hidden, spec.output);

    const revKey = SoulAgent.getCanonicalKey(oppRider.id, job.learner);
    const revCheckpoint = isMultiOpponent
      ? (job.opponentCheckpointsByMatchup?.[revKey] || null)
      : (job.opponentCheckpoint || job.opponentCheckpointsByMatchup?.[revKey] || null);

    let opponentNet = null;
    if (revCheckpoint) {
      const revValidation = SoulAgent.validateCheckpoint(revCheckpoint, oppRider.id, job.learner);
      if (!revValidation.valid) {
        throw new Error(`Reverse checkpoint ${revKey} rejected: ${revValidation.error}`);
      }
      opponentNet = SoulNN.Network.fromJSON(revCheckpoint.net);
    }

    const baseGames = old?.games || 0;
    const baseSteps = old?.steps || 0;

    let learner = training
      ? new SoulNN.Learner(
          net,
          KF.hash(seed, "replay", key),
          baseSteps,
          job.warmStart
            ? { interval: 8, warmup: 64, batchSize: 16, capacity: MAX_REPLAY_ITEMS, maxSize: MAX_REPLAY_ITEMS }
            : { interval: 12, warmup: 160, batchSize: 16, capacity: MAX_REPLAY_ITEMS, maxSize: MAX_REPLAY_ITEMS }
        )
      : null;

    const weightsID = old ? SoulAgent.fingerprint(old) : null;
    const loadedWeightsID = !training
      ? String(KF.hash(JSON.stringify(net.toJSON())))
      : weightsID;

    if (!isMultiOpponent) {
      singleBaseGames = baseGames;
      singleWeightsID = weightsID;
      singleLoadedWeightsID = loadedWeightsID;
    }

    let cellGames = 0;
    let cellWins = 0;
    let cellLosses = 0;
    let cellDraws = 0;
    let cellRounds = 0;
    const cellRecent = [];
    const cellWasd = { W: 0, A: 0, S: 0, D: 0, IDLE: 0 };
    const cellJkil = { J: 0, K: 0, I: 0, L: 0, NONE: 0 };
    let cellParams = SoulAgent.createDefaultMatchParameters(old?.matchParameters);

    const buildCellCheckpoint = () => ({
      version: VERSION,
      trainerBuild: BUILD,
      trainerPatch: PATCH,
      spec,
      net: net.toJSON(),
      canonicalKey: key,
      learnerId: job.learner,
      opponentId: oppRider.id,
      games: baseGames + cellGames,
      steps: learner ? learner.steps : baseSteps,
      savedAt: new Date().toISOString(),
      seed,
      rewardMode: job.rewardMode,
      evaluation: null,
      evaluated: false,
      matchParameters: SoulAgent.createDefaultMatchParameters(cellParams),
      trainingTask: {
        opponentController: job.mode,
        warmStart: job.warmStart,
        initialEpsilon: job.initialEpsilon,
        winOnly,
        learnerPolicy: job.learnerPolicy,
        riderDistillation,
        riderImitationCoefficient: riderDistillation ? riderImitationCoefficient : 0
      }
    });

    const buildProgressReport = (forceFullLogs = false) => {
      const seconds = Math.max(0.001, (performance.now() - started) / 1000);
      const includeWinLogs = forceFullLogs || firstWinningGames.length !== lastReportedWinsCount;
      if (includeWinLogs) lastReportedWinsCount = firstWinningGames.length;

      return {
        build: BUILD,
        patch: PATCH,
        schema: EXPECTED_SCHEMA,
        kind: job.kind,
        target: job.target || "candidate",
        games,
        requested: totalPlannedMatches,
        wins,
        losses,
        draws,
        winRate: games ? (100 * wins) / games : 0,
        averageRounds: games ? rounds / games : 0,
        seconds,
        matchesPerMinute: (60 * games) / seconds,
        decisionsPerSecond: transitions / seconds,
        transitions,
        loss: learner?.loss || latestLoss || 0,
        replaySize: learner?.replay?.items?.length || 0,
        updates: totalUpdates + (learner?.updates || 0),
        updateStats: training ? aggUpdateStats : null,
        avgQ: qCount ? qSum / qCount : 0,
        totalTrainingGames: baseGames + (training ? cellGames : 0),
        weightsID: !isMultiOpponent ? weightsID : key,
        loadedWeightsID: !isMultiOpponent ? loadedWeightsID : key,
        teacher: training ? job.teacher : null,
        guidePct: Number.isFinite(job.guidePct) ? job.guidePct : null,
        guideProbability,
        imitationCoefficient: imitation,
        epsilon,
        initialEpsilon: job.initialEpsilon,
        winOnly,
        rewardMode: job.rewardMode,
        seed,
        learner: job.learner,
        opponent: isMultiOpponent
          ? `ROW (${cellIdx + 1}/${perOppAllocations.length}: ${key})`
          : job.opponent,
        activeOpponentId: oppRider.id,
        learnerPolicy: job.learnerPolicy,
        riderDistillation,
        riderImitationCoefficient: riderDistillation ? riderImitationCoefficient : 0,
        mode: job.mode,
        effectiveOpponent,
        warmStart: job.warmStart,
        hiddenSizes,
        cancelled,
        matchParameters: cellParams,
        matchupReports: forceFullLogs ? matchupReports : null,
        breakdown,
        firstWinningGames: includeWinLogs ? firstWinningGames : null,
        firstWinningGamesCount: firstWinningGames.length,
        wasdRatio: { counts: { ...wasdCounts } },
        moveBreakdown: { jkilCounts: { ...jkilCounts }, moveMatrix }
      };
    };

    const span = Math.max(1, Math.min(30, Math.floor(cellMatches / MIXED_CPU_SEQUENCE.length) || 1));
    const fullCycleLen = span * MIXED_CPU_SEQUENCE.length;

    for (let i = 0; i < cellMatches && !cancelled; i++) {
      const mixedCycleIndex = training && job.mode === "mixed"
        ? Math.floor(i / fullCycleLen)
        : 0;

      const learnerSlot = (i + mixedCycleIndex) % 2 === 0 ? "p1" : "p2";

      const matchOpponentMode = job.mode === "mixed"
        ? MIXED_CPU_SEQUENCE[Math.floor(i / span) % MIXED_CPU_SEQUENCE.length]
        : job.mode;

      const bucketKey = `${key}|${matchOpponentMode}`;
      const needDemoMoves = (winCountsByDiffOpp[bucketKey] || 0) < MAX_WINS_PER_DIFF_OPP;

      const cellPair = Math.floor(cellGames / 2);
      const matchSeed = KF.hash(
        seed,
        key,
        training ? "training" : "evaluation",
        training ? baseGames + cellPair : cellPair
      );

      const cellProgress = (100 * i) / cellMatches;
      guideProbability = 0;
      epsilon = 0;
      imitation = 0;

      let matchGuideProbability = 0;
      let effectiveTeacher = "easy";

      if (training) {
        if (job.warmStart) {
          guideProbability = 1;
          matchGuideProbability = 1;
          imitation = 1;
          effectiveTeacher = job.teacher === "master"
            ? fastTeachers[i % fastTeachers.length]
            : job.teacher;
          epsilon = Math.max(0.02, initialEpsilonBase * (1 - (cellProgress / 100) * 0.8));
        } else {
          if (Number.isFinite(job.guidePct)) {
            const totalCtxExp = baseGames + cellGames;
            const expDecay = totalCtxExp > 60 ? Math.max(0.25, 60 / totalCtxExp) : 1.0;
            const batchDecay = 1 - (cellProgress / 100) * 0.5;
            guideProbability = (job.guidePct / 100) * expDecay * batchDecay;
          }

          const rollingWinRate = cellRecent.length
            ? cellRecent.reduce((sum, value) => sum + value, 0) / cellRecent.length
            : 0.2;

          const targetFloor = Math.max(0.01, initialEpsilonBase * 0.1);
          const adaptiveRatio = Math.max(0.2, 1 + (0.5 - rollingWinRate) / 0.3);

          epsilon = Math.max(
            targetFloor,
            Math.min(
              initialEpsilonBase,
              initialEpsilonBase * (1 - (cellProgress / 100) * 0.7) * adaptiveRatio
            )
          );

          const guideRoll = (KF.hash(matchSeed, "guide_gate", i) >>> 0) / 4294967296;
          const guidedMatch = guideProbability >= 1 || (guideProbability > 0 && guideRoll < guideProbability);
          matchGuideProbability = guidedMatch ? 1 : 0;

          if (guidedMatch) {
            effectiveTeacher = job.teacher === "master"
              ? fastTeachers[i % fastTeachers.length]
              : job.teacher;
          }

          const masterImitation = guidedMatch ? Math.max(0.01, 0.05 * guideProbability) : 0;
          imitation = Math.max(masterImitation, riderDistillation ? riderImitationCoefficient : 0);
        }
      }

      let matchTransitions = winOnly ? [] : null;
      let matchRoundMoves = needDemoMoves ? [] : null;

      const generator = SoulSim.episode({
        data,
        spec,
        net,
        learnerSlot,
        learnerId: job.learner,
        opponent: oppRider,
        opponentMode: matchOpponentMode,
        opponentNet,
        seed: matchSeed,
        epsilon,
        guideProbability: matchGuideProbability,
        teacher: effectiveTeacher,
        rewardMode: job.rewardMode,
        learnerMode: job.learnerPolicy,
        distillRider: riderDistillation,
        isEvaluation: !training
      });

      let result = null;

      for (const event of generator) {
        if (cancelled) break;

        if (event.type === "transition") {
          validateTransition(event.transition);
          transitions++;

          if (training) {
            if (winOnly) {
              matchTransitions.push({ transition: event.transition, imitation });
            } else {
              acceptWithCap(learner, event.transition, imitation);
            }
          }

          const actKey = event.transition.resolvedActionKey;
          const learnerCharge = event.transition.resolvedCharge;
          const { stance, button } = getActionParts(actKey);

          wasdCounts[stance]++;
          jkilCounts[button]++;
          moveMatrix[stance][button]++;
          cellWasd[stance]++;
          cellJkil[button]++;

          if (needDemoMoves && matchRoundMoves.length < 120) {
            matchRoundMoves.push({
              round: matchRoundMoves.length + 1,
              learnerMove: actKey,
              learnerCharge,
              learnerLp: event.transition.learnerLp,
              learnerChi: event.transition.learnerChi,
              learnerFaint: event.transition.learnerFaint,
              oppMove: event.transition.opponentActionKey,
              oppCharge: event.transition.opponentCharge,
              oppLp: event.transition.oppLp,
              oppChi: event.transition.oppChi,
              oppFaint: event.transition.oppFaint
            });
          }
        } else if (event.type === "round") {
          if (Number.isFinite(event.qSumDelta) && event.qCountDelta > 0) {
            qSum += event.qSumDelta;
            qCount += event.qCountDelta;
          }
        } else if (event.type === "end") {
          result = event.result;
        }
      }

      if (!result || cancelled) {
        matchTransitions = null;
        matchRoundMoves = null;
        break;
      }

      const prevTotalCellGames = baseGames + cellGames;
      games++;
      rounds += result.rounds;
      cellGames++;
      cellRounds += result.rounds;

      cellParams = updateMatchParameters(
        cellParams,
        prevTotalCellGames,
        result.matchMetrics,
        cellWasd,
        cellJkil
      );

      let outcome;
      if (result.state.winner === learnerSlot) {
        wins++;
        cellWins++;
        outcome = "wins";

        const currentBucketWins = winCountsByDiffOpp[bucketKey] || 0;
        if (currentBucketWins < MAX_WINS_PER_DIFF_OPP && matchRoundMoves) {
          winCountsByDiffOpp[bucketKey] = currentBucketWins + 1;
          firstWinningGames.push({
            gameNumber: games,
            matchupKey: key,
            opponentId: oppRider.id,
            opponentName: oppRider.name || oppRider.id,
            difficulty: matchOpponentMode,
            difficultyLabel: modeDisplayNames[matchOpponentMode] || matchOpponentMode,
            learnerSlot,
            bucketWinIndex: currentBucketWins + 1,
            bucketMaxWins: MAX_WINS_PER_DIFF_OPP,
            totalRounds: result.rounds,
            moves: matchRoundMoves
          });
        }

        if (training && winOnly && matchTransitions) {
          for (const item of matchTransitions) {
            acceptWithCap(learner, item.transition, item.imitation);
          }
        }
      } else if (result.state.winner === "draw") {
        draws++;
        cellDraws++;
        outcome = "draws";
      } else if (result.state.winner) {
        losses++;
        cellLosses++;
        outcome = "losses";
      } else {
        throw new Error("Episode ended without a winner or draw.");
      }

      matchTransitions = null;
      matchRoundMoves = null;

      cellRecent.push(outcome === "wins" ? 1 : 0);
      if (cellRecent.length > 30) cellRecent.shift();

      const matchOpponentLabel = job.mode === "mixed"
        ? (MIXED_MODE_LABELS[matchOpponentMode] || `mixed:${matchOpponentMode}`)
        : matchOpponentMode;

      const label = `${key} (${oppRider.id}) / ${matchOpponentLabel} / ${learnerSlot}`;
      let row = breakdown[label];
      if (!row) {
        row = { games: 0, wins: 0, losses: 0, draws: 0 };
        breakdown[label] = row;
      }
      row.games++;
      row[outcome]++;

      const now = performance.now();

      if (
        training &&
        cellGames % CHECKPOINT_GAME_INTERVAL === 0 &&
        now - lastCheckpointSent >= CHECKPOINT_MIN_INTERVAL_MS
      ) {
        send("checkpoint", { checkpoint: buildCellCheckpoint() });
        lastCheckpointSent = performance.now();
      }

      if (now - lastProgress >= PROGRESS_INTERVAL_MS) {
        send("progress", { report: buildProgressReport(false) });
        lastProgress = performance.now();
      }

      if (now - lastYield >= YIELD_INTERVAL_MS) {
        await pause();
        lastYield = performance.now();
      }
    }

    if (training && cellGames > 0) {
      send("checkpoint", { checkpoint: buildCellCheckpoint() });
    }

    if (!isMultiOpponent) {
      singleCellParams = SoulAgent.createDefaultMatchParameters(cellParams);
    }

    if (!training && cellGames >= 2 && cellGames % 2 === 0) {
      const seconds = Math.max(0.001, (performance.now() - started) / 1000);
      matchupReports.push({
        build: BUILD,
        patch: PATCH,
        schema: EXPECTED_SCHEMA,
        kind: "evaluate",
        target: job.target || "candidate",
        learner: job.learner,
        opponent: oppRider.id,
        learnerPolicy: job.learnerPolicy,
        games: cellGames,
        requested: cellMatches,
        wins: cellWins,
        losses: cellLosses,
        draws: cellDraws,
        winRate: cellGames ? (100 * cellWins) / cellGames : 0,
        averageRounds: cellGames ? cellRounds / cellGames : 0,
        seconds,
        weightsID,
        loadedWeightsID,
        cancelled
      });
    }

    if (learner) {
      totalUpdates += learner.updates || 0;
      if (learner.loss) latestLoss = learner.loss;
      if (learner.updateStats) {
        aggUpdateStats.win += learner.updateStats.win || 0;
        aggUpdateStats.damage += learner.updateStats.damage || 0;
        aggUpdateStats.loss += learner.updateStats.loss || 0;
        aggUpdateStats.neutral += learner.updateStats.neutral || 0;
      }
      if (learner.replay?.items) {
        learner.replay.items.length = 0;
      }
    }

    // Explicitly release cell network & learner memory before moving to the next cell in the row
    learner = null;
    net = null;
    opponentNet = null;
  }

  const finalSeconds = Math.max(0.001, (performance.now() - started) / 1000);
  if (firstWinningGames.length !== lastReportedWinsCount) {
    lastReportedWinsCount = firstWinningGames.length;
  }

  send("done", {
    report: {
      build: BUILD,
      patch: PATCH,
      schema: EXPECTED_SCHEMA,
      kind: job.kind,
      target: job.target || "candidate",
      games,
      requested: totalPlannedMatches,
      wins,
      losses,
      draws,
      winRate: games ? (100 * wins) / games : 0,
      averageRounds: games ? rounds / games : 0,
      seconds: finalSeconds,
      matchesPerMinute: (60 * games) / finalSeconds,
      decisionsPerSecond: transitions / finalSeconds,
      transitions,
      loss: latestLoss,
      replaySize: 0,
      updates: totalUpdates,
      updateStats: training ? aggUpdateStats : null,
      avgQ: qCount ? qSum / qCount : 0,
      totalTrainingGames: !isMultiOpponent ? singleBaseGames + (training ? games : 0) : games,
      weightsID: !isMultiOpponent ? singleWeightsID : "ROW-SEQUENTIAL",
      loadedWeightsID: !isMultiOpponent ? singleLoadedWeightsID : "ROW-SEQUENTIAL",
      teacher: training ? job.teacher : null,
      guidePct: Number.isFinite(job.guidePct) ? job.guidePct : null,
      guideProbability,
      imitationCoefficient: imitation,
      epsilon,
      initialEpsilon: job.initialEpsilon,
      winOnly,
      rewardMode: job.rewardMode,
      seed,
      learner: job.learner,
      opponent: isMultiOpponent ? `ALL OPPONENTS IN ROW (${perOppAllocations.length} cells)` : job.opponent,
      learnerPolicy: job.learnerPolicy,
      riderDistillation,
      riderImitationCoefficient: riderDistillation ? riderImitationCoefficient : 0,
      mode: job.mode,
      effectiveOpponent,
      warmStart: job.warmStart,
      hiddenSizes,
      cancelled,
      matchParameters: !isMultiOpponent ? singleCellParams : null,
      matchupReports,
      breakdown,
      firstWinningGames,
      firstWinningGamesCount: firstWinningGames.length,
      wasdRatio: { counts: { ...wasdCounts } },
      moveBreakdown: { jkilCounts: { ...jkilCounts }, moveMatrix }
    }
  });
}

self.onmessage = async event => {
  if (event.data?.type === "stop") {
    cancelled = true;
    return;
  }

  if (event.data?.type !== "start" || busy) {
    return;
  }

  busy = true;
  cancelled = false;

  try {
    await run(event.data.job);
  } catch (error) {
    send("error", {
      error: error?.stack || error?.message || String(error)
    });
  } finally {
    busy = false;
  }
};
