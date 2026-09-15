/** Read-only fresh-process reconstruction in an isolated authoring contract worker. */
import assert from 'node:assert/strict';
import { resolveScope } from '../projects/scope';
import { authoringCatalog } from '../dashboard/authoring-catalog';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';
const scope = resolveScope({ applicationId: 'north', environmentId: 'qa' });
const object = authoringCatalog(scope).objects.find(object => object.className === 'HeaderControls');
assert.ok(object?.methods.length); assert.equal(object?.page, 'Home sections');
assert.ok(readAllPageKnowledge(scope.paths.knowledgePageDir, true).some(page => page.elements.some(element => element.page_object === 'HeaderControls')));
console.log('PASS fresh-process HeaderControls source/index/YAML reconstruction');
