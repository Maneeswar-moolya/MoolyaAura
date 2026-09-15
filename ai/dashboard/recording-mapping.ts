/** Explicit authoring transaction. Automatic inference and proof are deliberately not changed. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { ApplicationScope } from '../projects/scope';
import type { Recording } from './recorder';
import { authoringCatalog, prepareLogicalPage, preparePageObject, prepareAuthoringMethod, validateAuthoringChanges,
  validateAuthoringLocator, authoringKnowledgeEntry, type AuthoringBinding, type OwnerSelection } from './authoring-catalog';
import { validateLogicalPage } from './authoring-catalog';
import { ownershipReview, ownershipRevision } from './page-ownership';
import { commitTexts, hashContent, loadOwners, type AuthoringOwners, type AuthoringPage } from '../knowledge/authoring-owners';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';
import { manualStatusPath, manualStatusText } from '../knowledge/manual-authoring';
import { appendElement } from '../autocode/abstraction/writer';
import { methodNameForTarget } from '../autocode/abstraction/naming';
import { evidenceFor } from '../autocode/dom-evidence';
import { parse as parseYaml } from '../knowledge/yaml';
import { credentialsIn } from '../excel/readiness';
import { extractFromTemplate, templateOf, rejectValue } from '../autocode/abstraction/parameter';
import { containedFile, diagnosticRoot } from '../diagnostics/artifacts';

export interface MappingDraft { source: string; recording: Recording; ownerOverrides?: Record<string, OwnerSelection>; authoringPages?: AuthoringPage[]; origin?: { applicationId: string };
  /** Internal quarantine integration; never populated from HTTP input. */
  ownersFile?:string; prepareRevision?:(texts:Map<string,string>,owners:AuthoringOwners)=>void;
}
export interface MappingInput {
  applicationId: string; revision: string; mappingVersion: string; stepKey: string;
  page?: AuthoringPage & { create?: boolean }; pageObject?: { name: string; create?: boolean };
  executionMode?: 'AUTO' | 'PAGE_OBJECT_METHOD' | 'RECORDED_LOCATOR'; method?: string; locatorOverride?: string;
}
export const draftOwnersFile = (scope: ApplicationScope, source: string) => path.join(scope.paths.recordingsDir, `.draft-${hashContent(source)}.owners.json`);
function selectedOwnersFile(scope:ApplicationScope,draft:MappingDraft) {
  if(!draft.ownersFile)return draftOwnersFile(scope,draft.source);
  const file=containedFile(path.join(diagnosticRoot(scope),'quarantine'),draft.ownersFile);
  if(!file.endsWith('.owners.json'))throw Error('Invalid quarantine owner sidecar.');return file;
}
function persisted(scope: ApplicationScope, draft: MappingDraft) {
  const file = selectedOwnersFile(scope,draft);
  const owners = loadOwners(scope, file.replace(/\.owners\.json$/, '.spec.ts'), draft.source, ownershipRevision(draft.recording));
  const overrides = owners ? Object.fromEntries(owners.choices.filter(choice => choice.explicit).map(choice => [choice.key, choice.userSelection ?? choice.confirmed ?? ''])) : draft.ownerOverrides ?? {};
  return { file, overrides, version: hashContent(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '') };
}
export function recordingMappingReview(scope: ApplicationScope, draft: MappingDraft) {
  const saved = persisted(scope, draft);
  return { ...ownershipReview(scope, draft.recording, saved.overrides, draft.authoringPages), mappingVersion: saved.version,
    captures:draft.recording.evidence.captures ?? [],
    // Null for a recording made before attribution was recorded: unknown, not attributed.
    captureAttribution:draft.recording.evidence.captureAttribution ?? null };
}
/** Structural equality of expressions: quotes/spacing are syntax, not target identity claims. */
function expressionKey(expression: string): string {
  const source = ts.createSourceFile('expression.ts', `const value = ${expression};`, ts.ScriptTarget.Latest, true);
  const declaration = source.statements[0];
  if ((source as any).parseDiagnostics.length || !ts.isVariableStatement(declaration)) return '';
  const key = (node: ts.Node): unknown => ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === 'page' ? ['name', 'page']
    : ts.isStringLiteralLike(node) ? ['string', node.text] : ts.isIdentifier(node) ? ['name', node.text]
    : ts.isNumericLiteral(node) ? ['number', node.text] : [node.kind, ...node.getChildren(source).map(key)];
  return JSON.stringify(key(declaration.declarationList.declarations[0].initializer!));
}
/** Only declared locator-returning methods; never a name-based guess or automatic proof. */
function compatibleMethods(file: string, owner: string, locator: string, allowed: string[], allowParameters = false): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === owner) as ts.ClassDeclaration | undefined;
  const wanted = expressionKey(locator), found: string[] = [];
  for (const member of declaration?.members ?? []) {
    if (!ts.isMethodDeclaration(member) || !member.body || (!allowParameters && member.parameters.some(p => !p.questionToken && !p.initializer))) continue;
    const name = member.name.getText(source); if (!allowed.includes(name)) continue;
    if (member.body.statements.some(statement => !ts.isReturnStatement(statement) && !(ts.isVariableStatement(statement)
      && statement.declarationList.declarations.length === 1 && statement.declarationList.declarations[0].name.getText(source) === 'page'
      && statement.declarationList.declarations[0].initializer?.getText(source) === 'this.page'))) continue;
    const returned = member.body.statements.filter(ts.isReturnStatement);
    if (returned.length !== 1 || !returned[0].expression) continue;
    const expression = returned[0].expression;
    let expressions = [expression.getText(source)];
    if (ts.isCallExpression(expression) && expression.expression.getText(source) === 'this.resolve') {
      expressions = [];
      const visit = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'build' && ts.isArrowFunction(node.initializer) && !ts.isBlock(node.initializer.body)) expressions.push(node.initializer.body.getText(source)); ts.forEachChild(node, visit); };
      visit(expression);
    }
    if (expressions.some(expression => expressionKey(expression) === wanted)) found.push(name);
  }
  return found;
}
function validateKnowledge(scope: ApplicationScope, texts: Map<string, string>) {
  for (const [file, source] of texts) if (/\.ya?ml$/.test(file)) {
    const document = parseYaml(source) as any;
    const previous = fs.existsSync(file) ? (parseYaml(fs.readFileSync(file, 'utf8')) as any).elements ?? {} : {};
    if (!document.page?.id || (document.page.application_id && document.page.application_id !== scope.applicationId)) throw Error('Invalid application knowledge ownership.');
    for (const [key, value] of Object.entries(previous)) if (JSON.stringify(document.elements?.[key]) !== JSON.stringify(value)) throw Error(`Established knowledge ${key} must not be overwritten.`);
    for (const [key, value] of Object.entries(document.elements ?? {}) as Array<[string, any]>)
      if (!Object.hasOwn(previous, key) && (!value?.page_object || !value?.page_object_method)) throw Error(`Invalid knowledge capability ${key}.`);
  }
}
export function saveRecordingMapping(scope: ApplicationScope, draft: MappingDraft, input: MappingInput) {
  if (input.applicationId !== scope.applicationId) throw Error('Cross-application binding is not allowed.');
  const origin = draft.origin?.applicationId ?? draft.recording.authoringOwners?.applicationId;
  if (origin && origin !== scope.applicationId) throw Error('Recording belongs to another application.');
  // Observe source bytes before preparing changes, not after: another writer may run during preparation.
  const initial = new Map<string, string | null>();
  for (const dir of [scope.paths.pagesDir, scope.paths.knowledgePageDir]) if (fs.existsSync(dir))
    for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name); if (fs.lstatSync(file).isFile()) initial.set(file, fs.readFileSync(file, 'utf8')); }
  for (const file of [scope.paths.fixturesFile, selectedOwnersFile(scope,draft)]) initial.set(file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  const saved = persisted(scope, draft), current = recordingMappingReview(scope, draft);
  if (input.revision !== current.revision || input.mappingVersion !== saved.version) throw Error('Mapping changed. Reload the persisted mapping before retrying; your unsaved choices are retained.');
  const step = current.steps.find(step => step.key === input.stepKey);
  if (!step) throw Error('Select a relevant recorded step.');
  const mode = input.executionMode ?? 'PAGE_OBJECT_METHOD';
  if (!['AUTO', 'PAGE_OBJECT_METHOD', 'RECORDED_LOCATOR'].includes(mode)) throw Error('Invalid execution mode.');
  if (mode === 'RECORDED_LOCATOR' && step.role !== 'action') throw Error('Recorded-locator execution is supported for actions.');
  const texts = new Map<string, string>(), catalog = structuredClone(current.authoring);
  const overrides = { ...saved.overrides };
  let binding: AuthoringBinding | null = null, methodCreated = false, reused = false, yaml: string | undefined;
  if (mode === 'AUTO') overrides[step.key] = '';
  else {
    const locator = input.locatorOverride || step.locator;
    const selectedMethod = mode === 'PAGE_OBJECT_METHOD' && input.method && catalog.objects.find(object => object.className === input.pageObject?.name)?.methods.some(method => method.name === input.method);
    if (!selectedMethod || input.locatorOverride) validateAuthoringLocator(locator);
    if (credentialsIn(step.label).length) throw Error('Keep credential values out of authoring metadata.');
    let logical = input.page?.name ? catalog.pages.find(page => page.name === input.page!.name) : undefined;
    if (input.page?.create && logical) throw Error(`Page already exists: ${logical.name}. Use Existing Page.`);
    if (!logical && input.page?.create) {
      yaml = prepareLogicalPage(scope, input.page, texts);
      logical = { ...validateLogicalPage(input.page), file: path.relative(process.cwd(), yaml).replace(/\\/g, '/') };
      catalog.pages.push(logical);
    } else if (input.page?.name && !logical) throw Error('Unknown Page in this application.');
    let object = input.pageObject?.name ? catalog.objects.find(object => object.className === input.pageObject!.name) : undefined;
    if (input.pageObject?.create && object) throw Error('Page Object already exists. Select the existing Page Object.');
    if (object && !object.pages.includes(logical?.name ?? '')) throw Error('This Page Object belongs to another logical Page. Select its Page explicitly.');
    if (input.pageObject?.create) {
      if (!logical) throw Error('Select or create a Page first.');
      yaml ??= prepareLogicalPage(scope, logical, texts, true);
      const file = preparePageObject(scope, input.pageObject.name, yaml, texts);
      object = { className: input.pageObject.name, page: logical.name, pages: [logical.name], route: logical.route, description: '', methods: [], file: path.relative(process.cwd(), file).replace(/\\/g, '/') };
      catalog.objects.push(object);
    } else if (input.pageObject?.name && !object) throw Error('Unknown Page Object in this application.');
    binding = { applicationId: scope.applicationId, page: logical?.name ?? '', pageObject: object?.className ?? '', method: null, executionMode: mode,
      ...(input.locatorOverride ? { locatorOverride: locator } : {}) };
    if (mode === 'PAGE_OBJECT_METHOD') {
      if (!object || !logical) throw Error('Select a Page and Page Object, or choose recorded-locator execution in Advanced.');
      const file = path.resolve(object.file), source = texts.get(file) ?? fs.readFileSync(file, 'utf8');
      const knowledge = readAllPageKnowledge(scope.paths.knowledgePageDir, true);
      const matches = fs.existsSync(file) ? compatibleMethods(file, object.className, locator, object.methods.filter(method => !method.params?.some(p => !p.optional)).map(method => method.name))
        .filter(name => !knowledge.some(page => page.elements.some(element => element.page_object === object!.className && element.page_object_method === name && element.usage && element.usage !== step.role))) : [];
      const parameterArgs = new Map<string, string[]>();
      if (fs.existsSync(file)) for (const method of object.methods.filter(method => method.params?.some(p => !p.optional))) {
        for (const element of knowledge.flatMap(page => page.elements).filter(element => element.page_object === object!.className && element.page_object_method === method.name && (!element.usage || element.usage === step.role))) {
          const template = templateOf(element, method);
          if (!template || !compatibleMethods(file, object.className, template, [method.name], true).length) continue;
          const names = method.params!.map(parameter => parameter.name), extracted = extractFromTemplate(template, locator, names);
          if (!extracted || extracted.some(value => rejectValue(value.value))) continue;
          const args = names.map(name => extracted.find(value => value.parameterName === name)?.value);
          if (args.some(value => value === undefined)) continue;
          parameterArgs.set(method.name, args as string[]);
        }
      }
      matches.push(...[...parameterArgs.keys()].filter(name => !matches.includes(name)));
      if (!input.method && matches.length > 1) throw Error('Multiple established capabilities match. Choose a method in Advanced; none was overwritten.');
      const at = Number(step.key.split(':')[1]), action = step.role === 'action' ? draft.recording.actions[at] : draft.recording.assertions[at];
      const target = evidenceFor(draft.recording.evidence, step.locator)?.target;
      const method = input.method || matches[0] || methodNameForTarget({ ...target, tag: target?.tag || '', accessibleName: target?.accessibleName || action.target }, step.role, { needsRoleSuffix: true });
      if (!method) throw Error('A method name could not be derived. Enter a method name in Advanced.');
      const existing = object.methods.find(item => item.name === method);
      if (existing) {
        if (existing.params?.some(p => !p.optional) && !parameterArgs.has(method)) throw Error('Selected method requires arguments. Choose a compatible locator method.');
        if (input.locatorOverride && input.method && !matches.includes(method)) throw Error('The existing method uses a different locator. Choose a new method name or recorded-locator mode; established source was not changed.');
        if (!input.method && !matches.includes(method)) throw Error('An established method already uses this name for another capability. Choose a different name in Advanced.');
        reused = true;
      } else {
        texts.set(file, prepareAuthoringMethod(object.className, method, locator, file, source));
        object.methods.push({ name: method, declaredLocator: locator, authoringStatus: 'USER AUTHORED — NOT VALIDATED' }); methodCreated = true;
        texts.set(manualStatusPath(scope), manualStatusText(scope, [{ owner: object.className, method, status: 'USER AUTHORED — NOT VALIDATED' }]));
      }
      binding.method = method;
      if (parameterArgs.has(method)) binding.arguments = parameterArgs.get(method);
      // Existing declarations remain untouched. New declarations are explicit authoring, never proof.
      const declared = knowledge.some(page => page.elements.some(element => element.page_object === object!.className && element.page_object_method === method));
      if (!declared) {
        yaml ??= prepareLogicalPage(scope, logical, texts, true);
        const before = texts.get(yaml) ?? fs.readFileSync(yaml, 'utf8');
        const key = `${object.className}_${method}`;
        if ((parseYaml(before) as any).elements?.[key]) throw Error('An established knowledge key conflicts with this capability.');
        texts.set(yaml, appendElement(before, authoringKnowledgeEntry(object.className, method, methodCreated || matches.includes(method) ? locator : '', step.role, action.target)));
        // Reusing an undeclared method does not establish automatic identity either.
        if (!methodCreated) texts.set(manualStatusPath(scope), manualStatusText(scope, [{ owner: object.className, method, status: 'USER AUTHORED — NOT VALIDATED' }]));
      }
    }
    overrides[step.key] = binding;
  }
  const prepared = ownershipReview(scope, draft.recording, overrides, draft.authoringPages, catalog);
  const owners: AuthoringOwners = { version: 1, applicationId: scope.applicationId, recordingHash: hashContent(draft.source),
    revision: prepared.revision, choices: prepared.steps, pages: draft.authoringPages ?? [] };
  texts.set(saved.file, JSON.stringify(owners, null, 2));
  const before = new Map([...initial, ...[...texts.keys()].filter(file => !initial.has(file)).map(file => [file, null] as [string, null])]);
  validateKnowledge(scope, texts);
  if (binding?.method) {
    const object = catalog.objects.find(object => object.className === binding!.pageObject)!;
    const probe = path.join(scope.paths.pagesDir, '.mapping-validation.ts');
    if (fs.existsSync(probe)) throw Error('The reserved in-memory validation path already exists.');
    const module = './' + path.basename(object.file).replace(/\.ts$/, '');
    const validation = new Map(texts);
    validation.set(path.resolve(object.file), texts.get(path.resolve(object.file)) ?? fs.readFileSync(path.resolve(object.file), 'utf8'));
    validation.set(probe, `import type { Locator } from '@playwright/test';\nimport { ${binding.pageObject} } from ${JSON.stringify(module)};\ndeclare const instance: ${binding.pageObject};\nconst control: Locator | Promise<Locator> = instance.${binding.method}(${(binding.arguments ?? []).map(value => JSON.stringify(value)).join(', ')});\n`);
    validateAuthoringChanges(scope, validation, saved.file);
  } else validateAuthoringChanges(scope, texts, saved.file);
  for (const [file, original] of before) if ((fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null) !== original) throw Error('Artifacts changed during validation. Retry with the latest mapping.');
  draft.prepareRevision?.(texts,owners);
  let result: ReturnType<typeof recordingMappingReview> | undefined;
  commitTexts(texts, () => {
    for (const [file, expected] of texts) if (fs.readFileSync(file, 'utf8') !== expected) throw Error('Persisted authoring artifacts differ from the prepared transaction.');
    for (const [file, original] of initial) if (!texts.has(file) && (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null) !== original) throw Error('Artifacts outside this mapping changed; this mapping was rolled back.');
    result = recordingMappingReview(scope, draft);
    const actual = result.steps.find(item => item.key === step.key);
    if (JSON.stringify(actual?.userSelection) !== JSON.stringify(binding)) throw Error('Persisted binding does not match the requested mapping.');
    if (binding?.method && !result.authoring.objects.some(object => object.className === binding!.pageObject && object.methods.some(method => method.name === binding!.method))) throw Error('Saved capability is missing from the rebuilt index.');
    if (binding?.method && !readAllPageKnowledge(scope.paths.knowledgePageDir, true).some(page => page.elements.some(element => element.page_object === binding!.pageObject && element.page_object_method === binding!.method))) throw Error('Saved capability is missing from reusable YAML knowledge.');
  });
  draft.ownerOverrides = overrides; draft.recording.authoringOwners = owners;
  return { ...result!, saved: { stepKey: step.key, binding, methodCreated, reused, status: mode === 'AUTO' ? 'AUTO' : 'USER_CONFIRMED' } };
}
