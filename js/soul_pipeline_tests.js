/* js/soul_pipeline_tests.js
 * Integration checks for the v8 Rider Matrix Bundle & neural pipeline.
 * Build: v5-state256-action17-charge1-reset1-v8matrix
 *
 * Contracts:
 * - 256 observation inputs and 17 actions (42,257 parameters per matchup).
 * - Action index 16 is DO_NOTHING.
 * - Planning masks use reachable-charge legality.
 * - Missing controller inputs mean WAIT.
 * - Repeating a direction preserves its charge clock.
 * - Changing direction resets the charge clock.
 * - Per-Rider Master Bundle (001.json) packs 18 total slots (active riders +
 *   dynamic backup slots) and reserved match parameter slots without
 *   cross-matchup weight pollution.
 */
(function (g) {
  "use strict";

  async function runSoulPipelineTests() {
    const C = g.CombatCore;
    const E = g.SoulEnv;
    const N = g.SoulNN;

    let passed = 0;
    const lines = [];

    function assert(condition, message) {
      if (!condition) {
        throw new Error(message);
      }
    }

    function test(name, fn) {
      try {
        fn();
        passed++;
        lines.push("PASS: " + name);
      } catch (error) {
        const message = error?.message || String(error);
        throw new Error(name + "\n" + message);
      }
    }

    assert(C, "CombatCore is not loaded.");
    assert(E, "SoulEnv is not loaded.");
    assert(N, "SoulNN is not loaded.");

    assert(
      typeof g.SoulAgent?.ready === "function",
      "SoulAgent.ready is missing."
    );

    assert(
      typeof g.SoulSim?.calculateReward === "function",
      "SoulSim.calculateReward is missing."
    );

    for (const method of [
      "createMatch",
      "copyState",
      "isLegal",
      "maxCharge",
      "chargePercent"
    ]) {
      assert(
        typeof C[method] === "function",
        "CombatCore." + method +
          " is missing. Check the loaded core version."
      );
    }

    for (const method of [
      "makeSpec",
      "create",
      "observe",
      "vector",
      "mask",
      "step"
    ]) {
      assert(
        typeof E[method] === "function",
        "SoulEnv." + method + " is missing."
      );
    }

    assert(
      Array.isArray(E.ACTION_MAP),
      "SoulEnv.ACTION_MAP must be an array."
    );

    assert(
      typeof N.Network === "function" &&
        typeof N.Network.fromJSON === "function",
      "SoulNN.Network or Network.fromJSON is missing."
    );

    assert(
      typeof N.argmax === "function",
      "SoulNN.argmax is missing."
    );

    const ready = await g.SoulAgent.ready();
    const data = ready?.data;

    assert(
      Array.isArray(data?.riders) && data.riders.length > 0,
      "SoulAgent.ready() returned no riders."
    );

    assert(
      data.moves != null,
      "SoulAgent.ready() returned no move data."
    );

    const spec = E.makeSpec();

    const first = data.riders[0];
    const second = data.riders[1] || first;

    const fresh = () => C.createMatch(
      first,
      second,
      data.moves
    );

    test("256 inputs and 17 actions", () => {
      assert(
        spec.input === 256,
        "Wrong input size."
      );

      assert(
        spec.output === 17,
        "Wrong output size."
      );

      assert(
        E.ACTION_MAP.length === 17,
        "Action map must contain 17 actions."
      );

      assert(
        new Set(E.ACTION_MAP).size === E.ACTION_MAP.length,
        "Action map contains duplicate keys."
      );

      assert(
        E.ACTION_MAP[16] === "DO_NOTHING",
        "Idle index missing."
      );
    });

    test("Observation reads actual fighter LP and CHI", () => {
      const state = fresh();

      state.p1.lp = state.p1.maxLp / 2;
      state.p1.chi = 3;

      const env = E.create(state);
      const observation = E.observe(env, "p1");
      const vector = E.vector(observation, spec);

      assert(
        vector.length === spec.input,
        "Wrong observation vector length."
      );

      assert(
        observation.selfChi === 3,
        "CHI came from a control cell."
      );

      assert(
        Math.abs(vector[132] - 0.5) < 1e-6,
        "LP ratio incorrect."
      );

      assert(
        Math.abs(vector[134] - 3 / state.p1.maxChi) < 1e-6,
        "CHI ratio incorrect."
      );

      assert(
        vector.every(Number.isFinite),
        "Non-finite observation."
      );
    });

    test("Execution mode gating and 20-float foresight plan memory (indices 108..127)", () => {
      const prevMode = E.getExecutionMode();
      try {
        const trainState = fresh();
        const trainEnv = E.create(trainState, {}, { mode: "train" });
        const trainVec = E.vector(E.observe(trainEnv, "p1"), spec);

        for (let i = 108; i <= 127; i++) {
          assert(
            trainVec[i] === 0,
            `Expected plan memory index ${i} to be 0 in 'train' mode, got ${trainVec[i]}.`
          );
        }

        const gameState = fresh();
        const gameEnv = E.create(gameState, {}, { mode: "game" });
        const gameVec = E.vector(E.observe(gameEnv, "p1"), spec);

        let oneHotSum = 0;
        for (let i = 108; i <= 124; i++) {
          oneHotSum += gameVec[i];
        }

        assert(
          Math.abs(oneHotSum - 1) < 1e-6,
          `Expected one-hot planned action in indices 108..124 during 'game' mode, got sum=${oneHotSum}.`
        );

        assert(
          gameVec[125] === 1,
          `Expected planned action legality flag (index 125) to be 1, got ${gameVec[125]}.`
        );

        assert(
          gameVec[126] > 0 && gameVec[126] <= 1,
          `Expected remaining plan horizon ratio (index 126) in (0, 1], got ${gameVec[126]}.`
        );
      } finally {
        E.setExecutionMode(prevMode);
      }
    });

    test("Planning mask agrees with reachable-charge legality", () => {
      for (const slot of ["p1", "p2"]) {
        for (const chiCase of ["zero", "maximum"]) {
          const state = fresh();
          const fighter = state[slot];

          assert(
            fighter,
            "Missing fighter: " + slot
          );

          assert(
            Number.isFinite(fighter.maxChi) &&
              fighter.maxChi >= 0,
            "Invalid maxChi for " + slot
          );

          fighter.chi = chiCase === "zero"
            ? 0
            : fighter.maxChi;

          const env = E.create(state);
          const mask = E.mask(env, slot);

          assert(
            mask != null &&
              mask.length === E.ACTION_MAP.length,
            "Wrong mask length for " + slot +
              ": expected " + E.ACTION_MAP.length +
              ", got " + mask?.length
          );

          E.ACTION_MAP.forEach((key, index) => {
            const idle = key === "DO_NOTHING";
            const move = state.moves?.[slot]?.[key];

            assert(
              idle || Boolean(move),
              "Missing move definition: " + slot + " " + key
            );

            const charge = idle
              ? 0
              : C.maxCharge(fighter, move.direction);

            assert(
              Number.isFinite(charge) && charge >= 0,
              "Invalid max charge: slot=" + slot +
                ", key=" + key +
                ", charge=" + charge
            );

            const entry = mask[index];

            assert(
              entry === 0 ||
                entry === 1 ||
                entry === false ||
                entry === true,
              "Invalid mask entry: slot=" + slot +
                ", key=" + key +
                ", value=" + String(entry)
            );

            const legal = Boolean(
              C.isLegal(state, slot, { key, charge })
            );

            assert(
              Boolean(entry) === legal,
              "Mask mismatch: slot=" + slot +
                ", key=" + key +
                ", chi=" + fighter.chi +
                ", charge=" + charge +
                ", mask=" + entry +
                ", coreLegal=" + legal
            );
          });
        }
      }
    });

    test("Active roster fits 18-slot matrix capacity and Skyrider (008) airborne moves require AIR state", () => {
      const agent = g.SoulAgent;
      const activeCodes = agent.getActiveCodes();
      const totalCapacity = Number.isInteger(agent.MATRIX_SLOT_COUNT)
        ? agent.MATRIX_SLOT_COUNT
        : 18;

      assert(
        activeCodes.length >= 1 && activeCodes.length <= totalCapacity,
        `Active roster (${activeCodes.length}) must fit within ${totalCapacity}-slot matrix capacity.`
      );

      const skyrider = data.riders.find(r => r.id === "008");
      if (!skyrider) return;

      const state = C.createMatch(skyrider, first, data.moves);
      state.p1.chi = state.p1.maxChi;
      state.p1.airborneTicks = 0;

      const groundedEnv = E.create(state);
      const groundedMask = E.mask(groundedEnv, "p1");

      const airMoveEntries = Object.entries(state.moves.p1 || {}).filter(
        ([, mv]) => mv && mv.requiresAirborne === true
      );

      assert(
        airMoveEntries.length > 0,
        "Skyrider has no moves marked requiresAirborne: true."
      );

      for (const [key] of airMoveEntries) {
        const idx = E.ACTION_MAP.indexOf(key);
        if (idx >= 0) {
          assert(
            !groundedMask[idx],
            `Grounded Skyrider mask should block airborne move ${key}.`
          );
        }
      }

      // Grant AIR state and confirm airborne moves unlock when CHI permits
      state.p1.airborneTicks = 3;
      const airEnv = E.create(state);
      const airMask = E.mask(airEnv, "p1");

      for (const [key, mv] of airMoveEntries) {
        const idx = E.ACTION_MAP.indexOf(key);
        const charge = C.maxCharge(state.p1, mv.direction);
        const legal = Boolean(C.isLegal(state, "p1", { key, charge }));
        if (idx >= 0) {
          assert(
            Boolean(airMask[idx]) === legal,
            `Airborne Skyrider mask mismatch for ${key}: mask=${airMask[idx]}, legal=${legal}`
          );
        }
      }
    });

    test("Fainted fighter has only explicit idle", () => {
      const state = fresh();
      state.p1.isFainted = true;

      const mask = E.mask(E.create(state), "p1");

      assert(
        mask != null &&
          mask.length === E.ACTION_MAP.length,
        "Wrong fainted-fighter mask length."
      );

      assert(
        Boolean(mask[16]),
        "Forced idle missing."
      );

      assert(
        Array.from(mask).filter(Boolean).length === 1,
        "Fainted fighter has non-idle actions."
      );
    });

    test("Missing inputs mean WAIT, not W+J", () => {
      const env = E.create(fresh());
      E.step(env);

      assert(
        !env.cells.p1.locked,
        "p1 was locked by a missing input."
      );

      assert(
        !env.cells.p2.locked,
        "p2 was locked by a missing input."
      );
    });

    test("Repeating the same direction preserves a time-zero charge clock", () => {
      const env = E.create(fresh());

      const firstRejected = E.step(env, { p1: "W" });

      assert(
        firstRejected.length === 0,
        "Initial W input was rejected."
      );

      assert(
        env.cells.p1.startedAt === 0,
        "Initial direction did not start charging at time zero."
      );

      assert(
        env.t > 0,
        "The first step did not advance the environment clock."
      );

      const secondRejected = E.step(env, { p1: "W" });
      const cell = env.cells.p1;

      assert(
        secondRejected.length === 0,
        "Repeated W input was rejected."
      );

      assert(
        cell.direction === "W",
        "Repeated W input changed the direction."
      );

      assert(
        cell.startedAt === 0 && cell.start === 0,
        "Repeating the same direction reset the time-zero charge clock."
      );

      const expectedCharge = C.chargePercent(
        env.state.p1,
        "W",
        env.t
      );

      assert(
        Number.isFinite(cell.charge) &&
          Math.abs(cell.charge - expectedCharge) < 1e-6,
        "Same-direction charge did not use the original start time."
      );
    });

    test("Switching direction resets the charge clock", () => {
      const env = E.create(fresh());

      const firstRejected = E.step(env, { p1: "W" });

      assert(
        firstRejected.length === 0,
        "Initial W input was rejected."
      );

      const originalStartedAt = env.cells.p1.startedAt;
      const switchedAt = env.t;

      assert(
        switchedAt > originalStartedAt,
        "The clock did not advance before the direction switch."
      );

      const secondRejected = E.step(env, { p1: "D" });
      const cell = env.cells.p1;

      assert(
        secondRejected.length === 0,
        "Direction-switch input was rejected."
      );

      assert(
        cell.direction === "D",
        "Direction did not switch to D."
      );

      assert(
        cell.startedAt === switchedAt &&
          cell.start === switchedAt,
        "Switching direction did not reset both charge timestamps."
      );

      const expectedCharge = C.chargePercent(
        env.state.p1,
        "D",
        env.t - switchedAt
      );

      assert(
        Number.isFinite(cell.charge) &&
          Math.abs(cell.charge - expectedCharge) < 1e-6,
        "Direction-switch charge did not use the new start time."
      );

      assert(
        !cell.locked,
        "Switching direction unexpectedly locked an action."
      );
    });

    test("Faint and status features change the observation", () => {
      const state = fresh();

      const baseline = E.vector(
        E.observe(E.create(state), "p1"),
        spec
      );

      state.p1.faintMeter = 50;

      assert(
        Array.isArray(state.p1.activeBuffs),
        "Fighter activeBuffs must be an array."
      );

      state.p1.activeBuffs.push({
        id: "bleeding",
        duration: 3,
        roundsLeft: 3,
        appliedRound: state.round - 1,
        periodicAppliedRound: state.round - 1,
        effects: { lpBleed: 150 }
      });

      const changed = E.vector(
        E.observe(E.create(state), "p1"),
        spec
      );

      assert(
        changed.some(
          (value, index) => value !== baseline[index]
        ),
        "State changes did not affect the vector."
      );

      assert(
        changed.every(Number.isFinite),
        "Non-finite observation."
      );
    });

    test("Terminal-only reward ignores nonterminal LP/CHI changes", () => {
      const before = fresh();
      const after = C.copyState(before);

      after.p2.lp -= 100;
      after.p1.chi = Math.max(0, after.p1.chi - 2);

      assert(
        g.SoulSim.calculateReward(
          before,
          after,
          "p1",
          "terminal_only"
        ) === 0,
        "Sparse reward leaked dense shaping."
      );

      after.winner = "p1";

      assert(
        g.SoulSim.calculateReward(
          before,
          after,
          "p1",
          "terminal_only"
        ) === 1,
        "Sparse terminal reward incorrect."
      );
    });

    test("Network checkpoint round-trip preserves predictions", () => {
      const net = new N.Network(
        spec.input,
        16,
        spec.output
      );

      const input = E.vector(
        E.observe(E.create(fresh()), "p1"),
        spec
      );

      const before = net.predict(input);
      const restored = N.Network.fromJSON(net.toJSON());
      const after = restored.predict(input);

      assert(
        before.length === spec.output &&
          after.length === spec.output,
        "Wrong prediction output length."
      );

      assert(
        before.every(Number.isFinite) &&
          after.every(Number.isFinite),
        "Non-finite checkpoint prediction."
      );

      assert(
        before.every(
          (value, index) => value === after[index]
        ),
        "Checkpoint round-trip changed weights/predictions."
      );
    });

    test("Basic training update stays finite", () => {
      const state = fresh();
      const env = E.create(state);

      const s = E.vector(
        E.observe(env, "p1"),
        spec
      );

      const m = E.mask(env, "p1");

      const net = new N.Network(
        spec.input,
        16,
        spec.output
      );

      const a = N.argmax(net.predict(s), m);

      assert(
        Number.isInteger(a) &&
          a >= 0 &&
          a < spec.output &&
          Boolean(m[a]),
        "argmax did not select a legal action."
      );

      const loss = net.train(
        [
          {
            s,
            m,
            a,
            y: 0.5,
            demo: true
          }
        ],
        0.0001,
        0.05
      );

      assert(
        Number.isFinite(loss),
        "Training loss is non-finite."
      );

      assert(
        net.predict(s).every(Number.isFinite),
        "Weights diverged."
      );
    });

    test("v8 Rider Matrix Bundle (001.json) 18-slot capacity, dynamic backup slots, and isolated matchup round-trip", () => {
      const agent = g.SoulAgent;
      const totalCapacity = Number.isInteger(agent.MATRIX_SLOT_COUNT)
        ? agent.MATRIX_SLOT_COUNT
        : 18;
      const activeCount = agent.getActiveCodes().length;
      const expectedBackupSlots = Number.isInteger(agent.BACKUP_SLOT_COUNT)
        ? agent.BACKUP_SLOT_COUNT
        : Math.max(0, totalCapacity - activeCount);
      const expectedParamSlots = Number.isInteger(agent.RESERVED_PARAM_SLOTS)
        ? agent.RESERVED_PARAM_SLOTS
        : expectedBackupSlots;

      assert(
        activeCount + expectedBackupSlots === totalCapacity,
        `Expected active (${activeCount}) + backup (${expectedBackupSlots}) slots to equal ${totalCapacity}.`
      );

      const input = E.vector(
        E.observe(E.create(fresh()), "p1"),
        spec
      );

      const existing1 = agent.getSection(first.id, first.id, "candidate");
      const existing2 = agent.getSection(first.id, second.id, "candidate");

      const net1 = new N.Network(spec.input, ...spec.hidden, spec.output);
      const net2 = new N.Network(spec.input, ...spec.hidden, spec.output);

      // Perturb net2 so net1 and net2 have distinct weights
      net2.layers[0].b[0] += 0.25;

      const pred1Before = net1.predict(input);
      const pred2Before = net2.predict(input);

      const makeDummyCp = (oppId, netObj, gamesCount) => ({
        version: agent.WORKER_VERSION,
        trainerBuild: agent.VERSION,
        trainerPatch: agent.PATCH,
        spec,
        net: netObj.toJSON(),
        canonicalKey: agent.getCanonicalKey(first.id, oppId),
        learnerId: first.id,
        opponentId: oppId,
        games: gamesCount,
        steps: gamesCount * 6,
        savedAt: new Date().toISOString(),
        seed: 42,
        rewardMode: "standard",
        matchParameters: agent.createDefaultMatchParameters({
          avgRounds: 5.5,
          priorityWinRate: 0.62
        })
      });

      agent.setCandidate(makeDummyCp(first.id, net1, 12));
      agent.setCandidate(makeDummyCp(second.id, net2, 24));

      const bundle = agent.buildRiderBundle(first.id, "candidate", false);
      const bundleValidation = agent.validateRiderBundle(bundle, first.id);

      assert(bundleValidation.valid, "Bundle validation failed: " + bundleValidation.error);
      assert(
        bundle.backupSlotCount === expectedBackupSlots,
        `Expected ${expectedBackupSlots} backup slots in Rider bundle, got ${bundle.backupSlotCount}.`
      );
      assert(
        Object.keys(bundle.backupSlots).length === expectedBackupSlots,
        `Bundle backupSlots object does not have ${expectedBackupSlots} reserved keys.`
      );

      const imported = agent.importCandidate(bundle);
      assert(imported.isBundle === true, "importCandidate did not recognize v8 Rider bundle.");

      const restored1 = agent.getSection(first.id, first.id, "candidate");
      const restored2 = agent.getSection(first.id, second.id, "candidate");

      assert(
        Array.isArray(restored1.matchParameters?.reservedSlots) &&
          restored1.matchParameters.reservedSlots.length === expectedParamSlots,
        `Match parameters missing ${expectedParamSlots} reserved backup slots.`
      );

      const pred1After = N.Network.fromJSON(restored1.net).predict(input);
      const pred2After = N.Network.fromJSON(restored2.net).predict(input);

      assert(
        pred1Before.every((v, idx) => v === pred1After[idx]),
        "001_001 weights changed or were polluted during bundle round-trip."
      );
      assert(
        pred2Before.every((v, idx) => v === pred2After[idx]),
        "001_002 weights changed or were polluted during bundle round-trip."
      );

      if (existing1) agent.setCandidate(existing1);
      if (existing2) agent.setCandidate(existing2);
    });

    lines.push("", `${passed} pipeline tests passed.`);

    return { passed, lines };
  }

  g.runSoulPipelineTests = runSoulPipelineTests;
})(globalThis);
