/** Ordinary contract fixtures only; repository and self-isolated checks route directly. */
import './isolated-checkout';
import path from 'node:path';
import { fixtureRoute } from './fixture-routing';
const fixture = process.argv[2];
if (!/^ai[\\/][\w/\\.-]+\.fixture\.ts$/.test(fixture ?? '') || fixture.includes('..')) throw Error('Invalid fixture path.');
if (fixtureRoute(fixture).kind !== 'synthetic') throw Error('This fixture requires its native regression route.');
require(path.resolve(fixture));
