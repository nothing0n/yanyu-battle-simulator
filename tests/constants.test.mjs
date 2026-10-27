import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LuaVM, firstResult} from '../dist/runtime/lua-vm.mjs';
const json = relative => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
test('original JHAIConfig VM agrees with independently extracted global assignments', () => {
  const bundle = json('../dist/engine/bundles/JHAIConfig.json');
  const expected = json('../dist/integration/constants.json');
  const vm = new LuaVM();
  vm.call(vm.load(bundle));
  for (const [key, value] of Object.entries(expected.values)) assert.deepEqual(vm.unwrap(vm.globals[key]), value, key);
  for (const [key, fn] of Object.entries(expected.functions)) assert.equal(firstResult(vm.call(vm.globals[key])), fn.returns, key);
});
