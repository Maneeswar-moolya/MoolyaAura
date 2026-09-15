// Focused checks only. Each fixture owns guarded isolation; no application execution.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const checks = {
  focused: ['ai/autocode/user-confirmed-auth.fixture.ts', 'ai/dashboard/explicit-authoring.fixture.ts',
    'ai/autocode/ownership-reuse.fixture.ts', 'ai/autocode/recorded-flow.fixture.ts', 'ai/dashboard/authoring-browser.fixture.ts'],
  mutations: ['ai/testing/user-confirmed-auth-mutations.ts', 'ai/testing/explicit-authoring-mutations.ts', 'ai/testing/recorded-flow-mutations.ts'],
};
(async () => {
  const phase = process.argv[2]; if (!checks[phase]) throw Error('Use focused or mutations');
  const results = [];
  for (const file of checks[phase]) {
    const start = Date.now();
    const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    const log = `docs/validation/auth-binding-${path.basename(file).replace(/\.ts$/, '')}.log`; fs.writeFileSync(log, output);
    const result = { file, exitCode, seconds: (Date.now() - start) / 1000, log }; results.push(result);
    console.log(JSON.stringify(result));
    if (exitCode !== 0) console.log(output.slice(-5000));
  }
  fs.writeFileSync(`docs/validation/auth-binding-${phase}-results.json`, JSON.stringify(results, null, 2));
  if (results.some(result => result.exitCode !== 0)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
