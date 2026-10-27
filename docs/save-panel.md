# Importing a private local save for offline analysis

The save adapter accepts an already decoded role object in memory. It calls the original `JHBattleData.initWithConver`, retains equipment attachments, talents, meridians, learned skills, original Zhao replacements, Jingjin records, formation fields, life skills, and HeDao records, then runs the original PvP normalization and battle reset. It does not replace those effects with a few panel numbers.

No save, account name, item instance ID, private source path, or stored random cursor is bundled with the application. Keep private inputs and reports outside the source tree.

```text
node tools/inspect-save-panel.mjs --save <private-decoded.json> --output <private-panel-summary.json>
node tools/inspect-save-panel.mjs --save <private-decoded.json> --now-seconds <unix-seconds>
node tests/save-panel.mjs
```

The CLI freezes the host clock at the historical `save.RealTime` value. `--now-seconds` explicitly overrides it. Both the summary and each role's metadata record the clock and its source. An unavailable or implausible saved clock requires an explicit override. The runtime's general default clock remains deterministic; a saved-state research run should always provide its chosen clock.

The output contains numeric original getter results, numeric detail contributions, selected public skill IDs/options, formation ID/level, and generic character labels. It excludes the original raw role. These getter results have not been compared with a matching in-game screenshot. The original scheduler still applies party and battle auras when combat starts, so a prebattle role getter summary can differ from the initial battle maximum HP or attack.

## Full-state battle factory

```js
import {runOriginalBattle} from './dist/engine/battle-runner.mjs';
import {createSavedBattleRole, savedPartyRows} from './dist/integration/save-panel.mjs';

const ally = savedPartyRows(privateDecodedSave, {
  pvp: true,
  freezeTimeSource: 'historical save.RealTime',
});
// Supply an explicitly chosen enemy team, and an ordinary local JSON reader.
const result = await runOriginalBattle({seed, maxRounds: 50, teams: {ally, enemy}}, {
  readJSON,
  nowSeconds: privateDecodedSave.data.RealTime,
  createBattleRole: createSavedBattleRole,
});
```

Each row contains `{uid, name, position, savedState, pvp}`. The factory copies `savedState`; it does not mutate the caller's object. `position` is 0–6. Original role type and AI priorities are retained. The supplied simulation seed replaces the actor's battle RNG cursor, and the original reset runs after the chosen state is installed.

An optional `skills: {nei: id}` selects an already owned inner skill. Selection deactivates all other skills of the same category, activates the chosen one, and verifies the result. Existing Zhao/Jingjin/SpecialProp data remains unchanged unless `skillOptions` explicitly requests a supported change. This preserves advanced variants recorded in a real save rather than reconstructing them from the skill name or Chong level.

An unowned skill requires an explicit assumption with `id`, `chong`, `level: 3`, and `jingjins`. Use `learnedAssumptions: {nei: [assumption]}` to add the same inactive hypothetical learned set to every comparison arm, then select a different active inner skill in each arm. `assumedSkills` is also accepted for a single explicitly selected unowned skill. A hypothetical record does not invent a progression history or increase the stored cultivation totals. Report these assumptions separately from the account's actual ownership.

The runtime retains its default instruction guard of five million instructions per top-level VM call. Research can supply a larger positive `instructionBudget` after investigating a guarded failure. This option does not remove call-depth or frame limits; a guarded failure is not a battle loss.

Source execution and synthetic tests are evidence of the local model's behavior. `originalBattleValidated` remains false until matching game replays provide an external comparison. Unused missing imports remain visible in diagnostics; a newly touched missing dependency stops execution rather than supplying a guessed result.
