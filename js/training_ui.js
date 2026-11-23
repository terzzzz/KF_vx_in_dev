/* js/training_ui.js
 * Kamen Fight
 * Build: v5-state256-action17
 * Matrix: v8-8riders-9backup (Row-Isolated 8-File Drive Sync Edition)
 * Patch: charge1-reset1
 */
(function (g) {
  "use strict";

  const BUILD = "v5-state256-action17";
  const PATCH = "charge1-reset1";
  const CACHE_TAG = BUILD + "-" + PATCH + "-v8";

  const EXPECTED_SCHEMA =
    "kf-state256-action17-v2-charge1-reset1";

  const CHECKPOINT_SAVE_THROTTLE_MS = 5000;

  let initialized = false;

  async function initialize() {
    if (initialized) return;
    initialized = true;

    const dedicated =
      document.getElementById("soul-training-root");

    const host = dedicated || document.createElement("dialog");

    if (!dedicated) {
      host.id = "soul-training-dialog";
      document.body.appendChild(host);
    }

    host.classList.add("soul-tools");

    host.innerHTML = `
      <h2>KAMEN FIGHT — v8 RIDER MATRIX TRAINER (ROW-ISOLATED 8×8)</h2>

      <p>
        Build: <strong>${BUILD}</strong> |
        Matrix: <strong>Row-Isolated Mode (1 Rider Row = 8 Matchups at a time)</strong> |
        Patch: <strong>${PATCH}</strong><br>
        256 inputs / 17 actions (42,257 params/matchup | 8 matchups/row | 9 backup slots reserved).
      </p>

      <p>
        Workflow: <strong>1. Pull Row (8 Files) ← Drive</strong> →
        <strong>2. Train / Evaluate Row</strong> →
        <strong>3. Sync Row (8 Files) → Drive</strong> →
        <strong>4. Cut Connection & Purge Row RAM</strong> before switching to the next Rider row.
      </p>

      <div class="soul-fields">
        <label>Learner (Active Row)
          <select data-field="learner"></select>
        </label>

        <label>Opponent
          <select data-field="opponent"></select>
        </label>

        <label>Opponent controller
          <select data-field="mode">
            <option value="mixed">MIXED — Tree-hopper / Cricket / Beetle / Bullet Ant cycle</option>
            <option value="easy">Tree-hopper — Level 1 (Novice)</option>
            <option value="balanced">Cricket — Level 2 (Balance)</option>
            <option value="defensive">Beetle — Level 3 (Defensive)</option>
            <option value="master">Bullet Ant — Level 4 (Master)</option>
            <option value="rider">Rider — Level 5 (Reverse active matchup matrix)</option>
          </select>
        </label>

        <label>Reward
          <select data-field="reward-mode">
            <option value="standard">Dense LP / CHI + terminal</option>
            <option value="terminal_only">Terminal win/loss only</option>
          </select>
        </label>

        <label>Evaluation learner policy
          <select data-field="evaluation-policy">
            <option value="rider">Rider — live EV + Matrix search policy</option>
            <option value="network">Direct network — diagnostic</option>
          </select>
        </label>

        <label>Training matches
          <input data-field="train-count"
                 type="number"
                 min="2"
                 max="100000"
                 step="1"
                 value="480">
        </label>

        <label>Evaluation matches
          <input data-field="eval-count"
                 type="number"
                 min="2"
                 max="100000"
                 step="2"
                 value="160">
        </label>

        <label>Guidance % (0–100)
          <input data-field="guide-pct"
                 type="number"
                 min="0"
                 max="100"
                 step="1"
                 value="25">
        </label>

        <label>Initial Epsilon %
          <input data-field="initial-epsilon"
                 type="number"
                 min="1"
                 max="100"
                 step="1"
                 value="20">
        </label>

        <label class="soul-checkbox-label">
          <input data-field="win-only" type="checkbox">
          <span>Only winning matches update candidate</span>
        </label>

        <label>Seed
          <input data-field="seed"
                 type="number"
                 min="0"
                 max="4294967295"
                 step="1"
                 value="12345">
        </label>
      </div>

      <div class="soul-buttons">
        <button type="button" data-action="train">TRAIN / RESUME ROW</button>
        <button type="button" data-action="warm">GUIDED WARM-START ROW</button>
        <button type="button" data-action="eval-candidate">EVALUATE CANDIDATE</button>
        <button type="button" data-action="eval-active">EVALUATE ACTIVE</button>
        <button type="button" data-action="promote">ACTIVATE CANDIDATE(S)</button>
        <button type="button" data-action="stop" disabled>STOP</button>
        <button type="button" data-action="tests">RUN PIPELINE TESTS</button>
        ${dedicated
          ? ""
          : '<button type="button" data-action="close">CLOSE</button>'}
      </div>

      <pre data-field="status"></pre>
      <pre data-field="output" aria-live="polite">Loading…</pre>
    `;

    if (!document.getElementById("soul-tools-styles")) {
      const style = document.createElement("style");
      style.id = "soul-tools-styles";

      style.textContent = `
        .soul-tools {
          box-sizing: border-box;
          width: min(1100px, 96vw);
          max-height: 92vh;
          overflow: auto;
          padding: 20px;
          color: #e9fff9;
          background: #10151c;
          border: 2px solid #00d9b2;
          border-radius: 12px;
          font: 15px/1.5 system-ui, sans-serif;
        }

        dialog.soul-tools::backdrop {
          background: #000c;
        }

        .soul-tools h2 {
          color: #00ffcc;
        }

        .soul-fields,
        .soul-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin: 14px 0;
        }

        .soul-fields label {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .soul-fields label.soul-checkbox-label {
          flex-direction: row;
          align-items: center;
          gap: 8px;
          margin-top: auto;
          padding-bottom: 8px;
          cursor: pointer;
          user-select: none;
        }

        .soul-fields label.soul-checkbox-label input {
          width: 18px;
          height: 18px;
          cursor: pointer;
          accent-color: #00d9b2;
        }

        .soul-tools input,
        .soul-tools select,
        .soul-tools button {
          padding: 8px;
          font: inherit;
        }

        .soul-tools button {
          cursor: pointer;
          color: white;
          background: #174b43;
          border: 1px solid #00bda0;
          border-radius: 5px;
        }

        .soul-tools button:disabled {
          opacity: .4;
          cursor: default;
        }

        .soul-tools pre {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
      `;

      document.head.appendChild(style);
    }

    const field = name =>
      host.querySelector(`[data-field="${name}"]`);

    const button = name =>
      host.querySelector(`[data-action="${name}"]`);

    const outputEl = field("output");
    const statusEl = field("status");
    const allButtons = Array.from(host.querySelectorAll("button"));
    const allInputs = Array.from(
      host.querySelectorAll("select, input")
    );

    let data = null;
    let busy = false;
    let worker = null;
    let stopping = false;

    let cachedWinsKey = "";
    let cachedWinsBlock = "";

    const pendingCheckpoints = new Map();
    let lastCheckpointSaveTime = 0;

    function output(text) {
      outputEl.textContent = text;
    }

    function pair() {
      return {
        learner: field("learner").value,
        opponent: field("opponent").value
      };
    }

    function getActiveRowRiders() {
      if (!data || !Array.isArray(data.riders)) return [];
      return data.riders.slice(0, 8);
    }

    function triggerHeaderGridRender() {
      if (typeof g.render64MatrixHeaderGrid === "function") {
        g.render64MatrixHeaderGrid();
      }
    }

    function syncHeaderRowDropdown(learnerId) {
      const rowRiders = getActiveRowRiders();
      const idx = rowRiders.findIndex(r => r.id === learnerId);
      if (idx >= 0 && typeof g.switchActiveMatrixRow === "function") {
        if (g.getActiveMatrixRowIndex?.() !== idx) {
          g.switchActiveMatrixRow(idx, true);
        }
      }
    }

    function syncRowSummaryToHeader(learnerId) {
      if (!data || !g.SoulAgent || !learnerId) return;
      const ramPool = (g.__KF_MATRIX64_RAM__ = g.__KF_MATRIX49_RAM__ = g.__KF_MATRIX64_RAM__ || {});
      const lCode = g.SoulAgent.toCode(learnerId);
      const p1Idx = parseInt(lCode, 10) - 1;
      const rowRiders = getActiveRowRiders();

      for (let j = 0; j < rowRiders.length; j++) {
        const oppId = rowRiders[j].id;
        const oCode = g.SoulAgent.toCode(oppId);
        const soulBest =
          g.SoulAgent.getSection(learnerId, oppId, "candidate") ||
          g.SoulAgent.getSection(learnerId, oppId, "active");

        if (p1Idx >= 0 && p1Idx < 8) {
          const mId = `r${p1Idx}_vs_r${j}`;
          if (soulBest) {
            ramPool[mId] = {
              matchupKey: mId,
              canonicalKey: `${lCode}_${oCode}`,
              games: soulBest.games || 0,
              steps: soulBest.steps || 0
            };
          } else {
            delete ramPool[mId];
          }
        }
      }

      triggerHeaderGridRender();
    }

    function flushPendingCheckpoints(selectedLearner) {
      if (pendingCheckpoints.size === 0) return false;

      for (const cp of pendingCheckpoints.values()) {
        const validation = g.SoulAgent.validateCheckpoint(
          cp,
          cp?.learnerId || selectedLearner,
          cp?.opponentId
        );

        if (!validation.valid) {
          throw new Error(validation.error);
        }

        g.SoulAgent.setCandidate(cp);
      }

      pendingCheckpoints.clear();
      lastCheckpointSaveTime = performance.now();
      syncRowSummaryToHeader(selectedLearner);
      return true;
    }

    function refreshStatusOnly() {
      const selected = pair();
      const agent = g.SoulAgent;
      const isMulti = selected.opponent === "*";

      const validSelection = Boolean(
        selected.learner && selected.opponent && agent
      );

      const learnerCode = validSelection
        ? agent.toCode(selected.learner)
        : "---";

      const candidate = validSelection && !isMulti
        ? agent.getSection(
            selected.learner,
            selected.opponent,
            "candidate"
          )
        : null;

      const active = validSelection && !isMulti
        ? agent.getSection(
            selected.learner,
            selected.opponent,
            "active"
          )
        : null;

      const learnerCandidateMap = validSelection
        ? agent.getLearnerSections(selected.learner, "candidate")
        : {};
      const learnerActiveMap = validSelection
        ? agent.getLearnerSections(selected.learner, "active")
        : {};

      const candCount = Object.keys(learnerCandidateMap).length;
      const actCount = Object.keys(learnerActiveMap).length;

      const status = agent?.status?.() || {
        storageWarning: "",
        warnings: []
      };

      const codes = agent ? agent.getActiveCodes() : [];
      const lastCode = codes[codes.length - 1] || "008";

      const lines = [
        validSelection
          ? isMulti
            ? `Active Row: Rider ${learnerCode} (${learnerCode}_001 .. ${learnerCode}_${lastCode} — ${codes.length} matchups in row)`
            : `Selected Cell: ${agent.getCanonicalKey(selected.learner, selected.opponent)}`
          : "Loading matchup data…",

        isMulti
          ? `Row ${learnerCode} Candidate Matchups: ${candCount} / ${codes.length} populated`
          : `Candidate: ${
              candidate
                ? `${candidate.games} games / ${candidate.steps} accepted decisions`
                : "none — fresh training available"
            }`,

        isMulti
          ? `Row ${learnerCode} Active Matchups: ${actCount} / ${codes.length} populated`
          : `Active: ${
              active
                ? `${active.games} games / ${active.steps} accepted decisions`
                : "none"
            }`,

        status.storageWarning,
        ...(status.warnings || [])
      ].filter(Boolean);

      if (data && agent && validSelection) {
        lines.push("", `ACTIVE ROW ${learnerCode} MATRIX (${codes.length} MATCHUPS + 9 BACKUP SLOTS)`);
        lines.push("     " + codes.map(code => code.padStart(7)).join(" "));

        const candRow = codes.map(oppCode => {
          const entry = learnerCandidateMap[`${learnerCode}_${oppCode}`];
          if (!entry) return "-".padStart(7);
          const tag = entry.evaluated ? `${entry.games}*` : String(entry.games);
          return tag.padStart(7);
        }).join(" ");

        const actRow = codes.map(oppCode => {
          const entry = learnerActiveMap[`${learnerCode}_${oppCode}`];
          if (!entry) return "-".padStart(7);
          return String(entry.games).padStart(7);
        }).join(" ");

        lines.push(`CAND ${candRow}`);
        lines.push(`ACTV ${actRow}`);
      }

      statusEl.textContent = lines.join("\n");
      triggerHeaderGridRender();

      return {
        isMulti,
        candidate,
        active,
        learnerCandidateMap,
        candCount,
        actCount
      };
    }

    function refresh() {
      const {
        isMulti,
        candidate,
        active,
        learnerCandidateMap,
        candCount,
        actCount
      } = refreshStatusOnly();

      allButtons.forEach(element => {
        element.disabled = busy || !data;
      });

      allInputs.forEach(element => {
        element.disabled = busy || !data;
      });

      button("stop").disabled = !worker || stopping;

      const close = button("close");
      if (close) close.disabled = busy;

      if (!busy && data) {
        if (isMulti) {
          button("eval-candidate").disabled = candCount === 0;
          button("eval-active").disabled = actCount === 0;

          const anyPromotable = Object.values(learnerCandidateMap).some(cp => {
            const ev = cp?.evaluation;
            return Boolean(
              ev &&
              ev.learnerPolicy === "rider" &&
              !ev.cancelled &&
              ev.games === ev.requested &&
              ev.games >= 2
            );
          });
          button("promote").disabled = !anyPromotable;
        } else {
          button("eval-candidate").disabled = !candidate;
          button("eval-active").disabled = !active;

          const evaluation = candidate?.evaluation;

          button("promote").disabled = !(
            evaluation &&
            evaluation.learnerPolicy === "rider" &&
            !evaluation.cancelled &&
            evaluation.games === evaluation.requested &&
            evaluation.games >= 2
          );
        }
      }
    }

    function integer(name, min, max) {
      const value = Number(field(name).value);

      if (
        !Number.isSafeInteger(value) ||
        value < min ||
        value > max
      ) {
        throw new Error(
          `${name} must be an integer from ${min} to ${max}.`
        );
      }

      return value;
    }

    function formatWinningGamesBlock(firstWinningGames, firstWinningGamesCount = 0) {
      if (!Array.isArray(firstWinningGames)) {
        return firstWinningGamesCount > 0 ? cachedWinsBlock : "";
      }

      if (firstWinningGames.length === 0) {
        return "";
      }

      const lastGame = firstWinningGames[firstWinningGames.length - 1];
      const signature = `${firstWinningGames.length}:${lastGame?.gameNumber ?? 0}:${lastGame?.matchupKey ?? ""}:${lastGame?.difficulty ?? ""}`;

      if (signature === cachedWinsKey && cachedWinsBlock) {
        return cachedWinsBlock;
      }

      const winLines = [
        "",
        "======================================================================",
        "FIRST 4 WINNING GAMES PER DIFFICULTY & PER OPPONENT — MOVE SEQUENCES",
        "======================================================================"
      ];

      const groupedWins = new Map();

      for (const game of firstWinningGames) {
        const mKey = game.matchupKey || "UNKNOWN_MATCHUP";
        const diffKey = game.difficulty || "default";
        const groupKey = `${mKey}|${diffKey}`;

        if (!groupedWins.has(groupKey)) {
          groupedWins.set(groupKey, {
            matchupKey: mKey,
            opponentId: game.opponentId || "",
            opponentName: game.opponentName || game.opponentId || "",
            difficulty: diffKey,
            difficultyLabel: game.difficultyLabel || diffKey,
            games: []
          });
        }

        groupedWins.get(groupKey).games.push(game);
      }

      for (const group of groupedWins.values()) {
        const oppHeader = group.opponentName
          ? `${group.matchupKey} (vs ${group.opponentName})`
          : group.matchupKey;

        winLines.push(
          "",
          `=== [ ${oppHeader} | Difficulty: ${group.difficultyLabel} ] (${group.games.length} / 4 Wins) ===`
        );

        group.games.forEach((game, idx) => {
          const winRank = game.bucketWinIndex || (idx + 1);
          const maxRank = game.bucketMaxWins || 4;
          const gameNum = game.gameNumber || (idx + 1);
          const totalRounds = game.totalRounds || game.moves?.length || 0;
          const slotTag = game.learnerSlot ? `, Slot: ${game.learnerSlot}` : "";

          winLines.push(
            "",
            `--- WIN #${winRank}/${maxRank} [${group.matchupKey} | ${group.difficultyLabel}] (Match #${gameNum}${slotTag}, ${totalRounds} Rounds) ---`
          );

          if (Array.isArray(game.moves) && game.moves.length > 0) {
            game.moves.forEach(m => {
              const rNum = String(m.round || "").padStart(2);
              const lAction = String(m.learnerMove || "DO_NOTHING").padEnd(10);
              const lCharge = String(m.learnerCharge ?? 0).padStart(3) + "%";
              const lLp = m.learnerLp !== undefined
                ? ` (LP:${String(m.learnerLp).padStart(4)} Chi:${String(m.learnerChi).padStart(2)} Fnt:${String(m.learnerFaint).padStart(2)})`
                : "";

              const oAction = String(m.oppMove || "DO_NOTHING").padEnd(10);
              const oCharge = String(m.oppCharge ?? 0).padStart(3) + "%";
              const oLp = m.oppLp !== undefined
                ? ` (LP:${String(m.oppLp).padStart(4)} Chi:${String(m.oppChi).padStart(2)} Fnt:${String(m.oppFaint).padStart(2)})`
                : "";

              winLines.push(`  R${rNum}: Learner [ ${lAction} @ ${lCharge} ]${lLp} vs Opponent [ ${oAction} @ ${oCharge} ]${oLp}`);
            });
          }
        });
      }

      cachedWinsKey = signature;
      cachedWinsBlock = winLines.join("\n");
      return cachedWinsBlock;
    }

    function formatReport(report) {
      const training = report.kind === "train";
      const targetTag = String(report.target || "candidate").toUpperCase();

      const lines = [
        training
          ? report.warmStart
            ? `GUIDED WARM-START [${targetTag}]`
            : `TRAINING [${targetTag}]`
          : `EVALUATION [${targetTag}]`,

        `Build: ${report.build}`,
        `Patch: ${report.patch}`,
        `Matchup: ${report.learner} -> ${report.opponent}`,
        `Target model: ${targetTag}`,
        `Learner policy: ${report.learnerPolicy}`,
        `Opponent: ${report.effectiveOpponent}`,
        `Reward: ${report.rewardMode}`,
        "",
        `Completed: ${report.games} / ${report.requested}`,
        `W / L / D: ${report.wins} / ${report.losses} / ${report.draws}`,
        `Win rate: ${report.winRate.toFixed(1)}%`,
        `Average rounds: ${report.averageRounds.toFixed(1)}`,
        `Matches/minute: ${report.matchesPerMinute.toFixed(1)}`,
        `Recorded round decisions: ${report.transitions}`,
        `Elapsed: ${report.seconds.toFixed(1)}s`,
        `Mean selected Q, this job: ${report.avgQ.toFixed(4)}`
      ];

      if (training) {
        lines.push(
          "",
          `Win-only updates: ${
            report.winOnly
              ? "ENABLED — losses/draws discarded"
              : "DISABLED — all matches update"
          }`,
          `Guidance probability: ${(100 * report.guideProbability).toFixed(1)}%`,
          `Scheduled epsilon: ${(100 * report.epsilon).toFixed(1)}% (Initial: ${report.initialEpsilon}%)`,
          `Imitation coefficient: ${report.imitationCoefficient.toFixed(4)}`,
          `Active learner replay entries: ${report.replaySize}`,
          `Gradient updates: ${report.updates}`,
          `Latest combined training loss: ${report.loss.toFixed(6)}`
        );
      } else {
        const isRowEval =
          Array.isArray(report.matchupReports) &&
          report.matchupReports.length > 1;
        lines.push(
          "",
          isRowEval
            ? `Row cells evaluated: ${report.matchupReports.length}`
            : `Checkpoint fingerprint: ${report.weightsID}`,
          isRowEval
            ? `Policy mode: ${report.learnerPolicy}`
            : `Loaded fingerprint: ${report.loadedWeightsID}`,
          "No gradient updates or epsilon exploration."
        );
      }

      if (
        Array.isArray(report.matchupReports) &&
        report.matchupReports.length > 1
      ) {
        lines.push("", "ROW CELL SUMMARY");
        for (const cell of report.matchupReports) {
          const cKey = g.SoulAgent
            ? g.SoulAgent.getCanonicalKey(cell.learner, cell.opponent)
            : `${cell.learner}_${cell.opponent}`;
          lines.push(
            `${cKey} (${cell.opponent}): ${cell.wins}W ${cell.losses}L ${cell.draws}D (${cell.winRate.toFixed(1)}%, ${cell.games}/${cell.requested})`
          );
        }
      }

      lines.push("", "BREAKDOWN");

      for (const [label, row] of Object.entries(
        report.breakdown || {}
      )) {
        lines.push(
          `${label}: ${row.wins}W ${row.losses}L ${row.draws}D`
        );
      }

      const winsBlock = formatWinningGamesBlock(
        report.firstWinningGames,
        report.firstWinningGamesCount
      );
      if (winsBlock) {
        lines.push(winsBlock);
      }

      if (report.cancelled) {
        lines.push("", "STOPPED — partial job.");
      } else if (stopping) {
        lines.push("", "Stop requested; waiting for the worker.");
      }

      return lines.join("\n");
    }

    function finishWorker(expectedWorker = worker, selectedLearner = null) {
      if (expectedWorker !== worker) return;

      try {
        flushPendingCheckpoints(selectedLearner || field("learner").value);
        g.SoulAgent?.flushStorage?.();
      } catch (err) {
        console.error("[Training UI] Checkpoint flush error:", err);
      }

      worker?.terminate();
      worker = null;
      busy = false;
      stopping = false;
      refresh();
    }

    async function start(
      kind,
      target = "candidate",
      warmStart = false
    ) {
      if (busy) return;
      if (!data) throw new Error("Training data is not ready.");

      if (location.protocol === "file:") {
        throw new Error("Serve the project over HTTP/HTTPS.");
      }

      if (typeof g.Worker !== "function") {
        throw new Error("Web Workers are unavailable.");
      }

      const selected = pair();
      const training = kind === "train";
      const isMulti = selected.opponent === "*";
      const mode = field("mode").value;

      const checkpointsByMatchup = {};
      const opponentCheckpointsByMatchup = {};

      const rowRiders = getActiveRowRiders();
      const opponentList = isMulti
        ? rowRiders.map(r => r.id)
        : [selected.opponent];

      for (const oppId of opponentList) {
        const key = g.SoulAgent.getCanonicalKey(selected.learner, oppId);
        const cp = training
          ? (
              g.SoulAgent.getSection(selected.learner, oppId, "candidate") ||
              g.SoulAgent.getSection(selected.learner, oppId, "active")
            )
          : g.SoulAgent.getSection(selected.learner, oppId, target);

        if (cp) {
          const validation = g.SoulAgent.validateCheckpoint(
            cp,
            selected.learner,
            oppId
          );
          if (!validation.valid) {
            throw new Error(`${key}: ${validation.error}`);
          }
          checkpointsByMatchup[key] = cp;
        }

        if (mode === "rider") {
          const revKey = g.SoulAgent.getCanonicalKey(oppId, selected.learner);
          const revCp = g.SoulAgent.getSection(oppId, selected.learner, "active");
          if (revCp) {
            const revVal = g.SoulAgent.validateCheckpoint(
              revCp,
              oppId,
              selected.learner
            );
            if (!revVal.valid) {
              throw new Error(`Reverse model ${revKey}: ${revVal.error}`);
            }
            opponentCheckpointsByMatchup[revKey] = revCp;
          }
        }
      }

      const checkpoint = !isMulti
        ? checkpointsByMatchup[
            g.SoulAgent.getCanonicalKey(selected.learner, selected.opponent)
          ] || null
        : null;

      const opponentCheckpoint = !isMulti && mode === "rider"
        ? opponentCheckpointsByMatchup[
            g.SoulAgent.getCanonicalKey(selected.opponent, selected.learner)
          ] || null
        : null;

      if (!training && Object.keys(checkpointsByMatchup).length === 0) {
        throw new Error(
          "No checkpoint exists for the selected matchup(s)."
        );
      }

      let matches = integer(
        training ? "train-count" : "eval-count",
        2,
        100000
      );

      if (!training) {
        const evalOpponentsCount = isMulti
          ? Math.max(1, Object.keys(checkpointsByMatchup).length)
          : 1;
        const stepMultiple = 2 * evalOpponentsCount;
        if (matches % stepMultiple !== 0) {
          matches = Math.ceil(matches / stepMultiple) * stepMultiple;
          field("eval-count").value = matches;
        }
      }

      const guidePct = integer("guide-pct", 0, 100);
      const initialEpsilon = integer("initial-epsilon", 1, 100);
      const winOnly = Boolean(field("win-only").checked);

      const teacher =
        warmStart &&
        ["easy", "balanced", "defensive", "master"].includes(mode)
          ? mode
          : "master";

      const job = {
        build: BUILD,
        patch: PATCH,
        schema: EXPECTED_SCHEMA,

        kind,
        target,
        data,
        checkpoint,
        opponentCheckpoint,
        checkpointsByMatchup,
        opponentCheckpointsByMatchup,

        matches,
        seed: integer("seed", 0, 4294967295),

        learner: selected.learner,
        opponent: selected.opponent,
        mode,

        rewardMode: field("reward-mode").value,
        guidePct,
        guideHoldPct: guidePct,
        guideZeroPct: guidePct,
        initialEpsilon,
        winOnly,
        teacher,
        warmStart,

        learnerPolicy: training
          ? "network"
          : field("evaluation-policy").value
      };

      cachedWinsKey = "";
      cachedWinsBlock = "";
      pendingCheckpoints.clear();
      lastCheckpointSaveTime = 0;

      busy = true;
      stopping = false;
      refresh();
      output("Starting sequential row worker…");

      try {
        const url = new URL(
          "js/training_worker.js",
          document.baseURI
        );

        url.searchParams.set("v", CACHE_TAG);

        const currentWorker = new Worker(url);
        worker = currentWorker;
        refresh();

        currentWorker.onerror = event => {
          if (worker !== currentWorker) return;

          output(
            "WORKER ERROR\n" +
            (event.message || "Unknown worker error.")
          );

          finishWorker(currentWorker, selected.learner);
        };

        currentWorker.onmessageerror = () => {
          if (worker !== currentWorker) return;

          output(
            "WORKER ERROR\nCould not deserialize a worker message."
          );

          finishWorker(currentWorker, selected.learner);
        };

        currentWorker.onmessage = event => {
          if (worker !== currentWorker) return;

          try {
            const message = event.data;

            if (
              message?.build !== BUILD ||
              message.patch !== PATCH ||
              message.schema !== EXPECTED_SCHEMA
            ) {
              throw new Error(
                "Worker patch/schema mismatch. " +
                "Reload the updated files and clear stale script caches."
              );
            }

            if (message.type === "checkpoint") {
              const cp = message.checkpoint;
              const cpKey = g.SoulAgent.getCanonicalKey(
                cp?.learnerId || selected.learner,
                cp?.opponentId || selected.opponent
              );

              pendingCheckpoints.set(cpKey, cp);

              const now = performance.now();
              if (now - lastCheckpointSaveTime >= CHECKPOINT_SAVE_THROTTLE_MS) {
                flushPendingCheckpoints(selected.learner);
                refreshStatusOnly();
              }
            } else if (message.type === "progress") {
              output(formatReport(message.report));
            } else if (message.type === "done") {
              flushPendingCheckpoints(selected.learner);

              const report = message.report;

              if (
                !training &&
                !report.cancelled &&
                report.games === report.requested
              ) {
                g.SoulAgent.recordEvaluation(target, report);
                syncRowSummaryToHeader(selected.learner);
              }

              output(
                formatReport(report) +
                (
                  training
                    ? "\n\nRow candidate matchup(s) saved. Click '2. Sync Row (8 Files) → Drive' in the Top Bar, then '3. Cut Connection & Purge Row RAM'."
                    : report.cancelled
                      ? "\n\nIncomplete evaluation was not recorded for activation."
                      : "\n\nEvaluation finished and recorded."
                )
              );

              finishWorker(currentWorker, selected.learner);
            } else if (message.type === "error") {
              throw new Error(message.error);
            } else {
              throw new Error(
                "Unknown training worker message: " + message.type
              );
            }
          } catch (error) {
            output("JOB ERROR\n" + error.message);
            finishWorker(currentWorker, selected.learner);
          }
        };

        currentWorker.postMessage({ type: "start", job });
      } catch (error) {
        finishWorker(worker, selected.learner);
        throw error;
      }
    }

    field("learner").addEventListener("change", () => {
      syncHeaderRowDropdown(field("learner").value);
      syncRowSummaryToHeader(field("learner").value);
      refresh();
    });

    field("opponent").addEventListener("change", refresh);

    if (!dedicated) {
      host.addEventListener("cancel", event => {
        if (busy) event.preventDefault();
      });
    }

    host.addEventListener("click", async event => {
      const clicked = event.target.closest("[data-action]");

      if (!clicked || clicked.disabled) return;

      try {
        const selected = pair();

        switch (clicked.dataset.action) {
          case "train":
            await start("train");
            break;

          case "warm":
            await start("train", "candidate", true);
            break;

          case "eval-candidate":
            await start("evaluate", "candidate");
            break;

          case "eval-active":
            await start("evaluate", "active");
            break;

          case "stop":
            if (worker && !stopping) {
              stopping = true;
              worker.postMessage({ type: "stop" });
              button("stop").disabled = true;

              output(
                "Stop requested.\n" +
                "Waiting for the current synchronous operation to yield…"
              );
            }
            break;

          case "promote": {
            const isMulti = selected.opponent === "*";
            if (!g.confirm(
              isMulti
                ? `Activate all RIDER-evaluated candidates for Rider ${g.SoulAgent.toCode(selected.learner)}?`
                : "Activate this exact-matchup candidate?"
            )) {
              break;
            }

            const promoted = g.SoulAgent.promote(
              selected.learner,
              selected.opponent
            );

            syncRowSummaryToHeader(selected.learner);
            refresh();

            output(
              isMulti
                ? `Activated ${promoted.promotedKeys.length} matchups for Rider ${g.SoulAgent.toCode(selected.learner)}:\n${promoted.promotedKeys.join(", ")}`
                : "Selected candidate activated.\nNew matches can use it."
            );
            break;
          }

          case "tests":
            busy = true;
            refresh();
            output("Running pipeline tests…");

            try {
              if (typeof g.runSoulPipelineTests !== "function") {
                throw new Error(
                  "Load soul_pipeline_tests.js before training_ui.js."
                );
              }

              const result = await g.runSoulPipelineTests();
              output(result.lines.join("\n"));
            } finally {
              busy = false;
              refresh();
            }
            break;

          case "close":
            if (!busy && !dedicated) host.close();
            break;
        }
      } catch (error) {
        output("ERROR\n" + (error?.message || String(error)));
        refresh();
      }
    });

    g.SoulTrainer = {
      open() {
        if (dedicated) {
          host.scrollIntoView({ block: "start" });
        } else if (!host.open) {
          host.showModal();
        }
      },

      isBusy() {
        return busy;
      },

      refreshUI() {
        refresh();
      },

      setLearnerId(riderId) {
        const select = field("learner");
        if (select && select.value !== riderId) {
          select.value = riderId;
          syncRowSummaryToHeader(riderId);
          refresh();
        }
      },

      disconnectAndPurge() {
        if (worker) {
          try { worker.terminate(); } catch (_) {}
          worker = null;
        }
        busy = false;
        stopping = false;
        pendingCheckpoints.clear();
        cachedWinsKey = "";
        cachedWinsBlock = "";
        refresh();
      }
    };

    refresh();

    try {
      if (
        g.SoulAgent?.VERSION !== BUILD ||
        typeof g.SoulAgent?.ready !== "function" ||
        g.SoulEnv?.SCHEMA !== EXPECTED_SCHEMA
      ) {
        throw new Error(
          "Training modules are missing or use incompatible charging rules."
        );
      }

      data = (await g.SoulAgent.ready()).data;

      const codes = g.SoulAgent.getActiveCodes ? g.SoulAgent.getActiveCodes() : [];
      const lastCode = codes[codes.length - 1] || "008";

      const allOption = document.createElement("option");
      allOption.value = "*";
      allOption.textContent = `ALL OPPONENTS IN ROW [001–${lastCode} Sequential]`;
      field("opponent").appendChild(allOption);

      const rowRiders = getActiveRowRiders();
      for (const rider of rowRiders) {
        for (const name of ["learner", "opponent"]) {
          const option = document.createElement("option");
          option.value = rider.id;

          option.textContent =
            `${rider.name} [${g.SoulAgent.toCode(rider.id)}]`;

          field(name).appendChild(option);
        }
      }

      const initialRowIdx = g.getActiveMatrixRowIndex?.() || 0;
      const initialRider = rowRiders[initialRowIdx] || rowRiders[0];
      field("learner").value = initialRider.id;
      field("opponent").value = "*";

      syncRowSummaryToHeader(initialRider.id);

      output(
        `Ready (Row r${initialRowIdx}: ${initialRider.name} — ${rowRiders.length} matchups in row).\n` +
        "Step 1: Click '1. Pull Row (8 Files) ← Drive' to load this row.\n" +
        "Step 2: Click 'TRAIN / RESUME ROW' or 'GUIDED WARM-START ROW'.\n" +
        "Step 3: Click '2. Sync Row (8 Files) → Drive', then '3. Cut Connection & Purge Row RAM' before switching rows."
      );
    } catch (error) {
      data = null;
      output("INITIALIZATION ERROR\n" + error.message);
    }

    refresh();
  }

  function launch() {
    initialize().catch(error => {
      console.error("[Training UI]", error);

      const host =
        document.getElementById("soul-training-root") ||
        document.getElementById("soul-training-dialog");

      if (host) {
        host.textContent =
          "TRAINING UI ERROR\n" +
          (error?.message || String(error));
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", launch, {
      once: true
    });
  } else {
    launch();
  }
})(window);
