/**
 * npm run excel:index          refresh ai/knowledge/framework/framework.yaml
 * npm run excel:index -- --show   print it without writing
 *
 * The index is rebuilt in memory on every generation, so this command is for
 * humans: it makes the metadata the generator sees inspectable, and diffable when
 * a Page Object changes.
 */

import { buildIndex, toYaml, writeIndex } from './index';

function main(): void {
  const argv = process.argv.slice(2);
  const index = buildIndex();

  if (argv.includes('--show')) {
    process.stdout.write(toYaml(index));
    return;
  }

  const { file, changed } = writeIndex(index);
  const pages = Object.keys(index.pages).length;
  const methods = Object.values(index.pages).reduce((total, entry) => total + entry.methods.length, 0);
  const sourceTokens = Object.values(index.pages).reduce((total, entry) => total + entry.approxTokens, 0);
  const indexTokens = Math.round(toYaml(index).length / 3.7);

  process.stdout.write(
      `\n${changed ? 'updated' : 'unchanged'} ${file}\n` +
      `  ${pages} Page Object(s), ${methods} method(s), ${index.fixtures.length} fixture export(s)\n` +
      `  index is ~${indexTokens} tokens; the same Page Objects as source are ~${sourceTokens} tokens\n\n`);
}

main();
