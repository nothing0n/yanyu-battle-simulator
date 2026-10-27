import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Combat and input checks require only the published source/runtime tables.
// The complete presentation suite additionally needs assets from the Release.
const root=fileURLToPath(new URL('../',import.meta.url));
const checks=[
 'constants.test.mjs','formula-vectors.mjs','formula-bytecode-differential.mjs',
 'formula-branch-state.mjs','rng-override.mjs','vm-semantics.mjs','vm-iteration.mjs',
 'vm-rng.mjs','vm-native-rng.mjs','actor-smoke.mjs','actor-matrix.mjs',
 'skill-selection.mjs','save-panel.mjs','combat-evaluate.mjs','combat-runner-smoke.mjs',
 'combat-matrix.mjs','combat-repeat.mjs','weapon-adapter.mjs',
 'ui-configuration.test.mjs','inner-benchmark-stats.mjs',
 'presentation-rules-runtime.mjs',
];
const failed=[];
for(const name of checks){
 console.log(`\n[combat] ${name}`);
 const result=spawnSync(process.execPath,['tests/'+name],{cwd:root,stdio:'inherit',windowsHide:true});
 if(result.error||result.signal||result.status!==0){failed.push(name);console.error(result.error?.message||`Exit ${result.status}`);}
}
console.log(`\n${checks.length-failed.length}/${checks.length} combat checks passed.`);
if(failed.length)console.error('Failed: '+failed.join(', '));
process.exitCode=failed.length?1:0;
