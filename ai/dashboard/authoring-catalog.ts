/** Explicit application authoring. These declarations are never locator evidence. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { ApplicationScope } from '../projects/scope';
import { buildIndex } from '../knowledge/index';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';
import { commitTexts, type AuthoringPage } from '../knowledge/authoring-owners';
import { manualMethods, manualStatusPath, manualStatusText } from '../knowledge/manual-authoring';
import { registerFixture, appendElement, pageObjectSkeleton } from '../autocode/abstraction/writer';
import { parse as parseYaml } from '../knowledge/yaml';
import { hashContent } from '../knowledge/authoring-owners';
import { forbiddenMechanisms } from '../autocode/abstraction/validate';
import { credentialsIn } from '../excel/readiness';

export interface AuthoringBinding {
  applicationId: string; page: string; pageObject: string; method: string | null;
  /** Missing mode with no method is Auto; confirming Page context is not an execution choice. */
  executionMode?: 'AUTO' | 'PAGE_OBJECT_METHOD' | 'RECORDED_LOCATOR';
  locatorOverride?: string;
  arguments?: string[];
}
export type OwnerSelection = string | AuthoringBinding;
interface Catalog { applicationId: string; pages: AuthoringPage[]; objects: { className: string; page: string }[] }
export const authoringCatalogPath = (scope: ApplicationScope) => path.join(scope.paths.knowledgePageDir, '.authoring-catalog.json');
function stored(scope: ApplicationScope): Catalog {
  const file = authoringCatalogPath(scope);
  if (!fs.existsSync(file)) return { applicationId: scope.applicationId, pages: [], objects: [] };
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Catalog;
  if (data.applicationId !== scope.applicationId) throw Error('Foreign authoring catalog.');
  return data;
}
export function authoringCatalog(scope: ApplicationScope, query = '') {
  const data = stored(scope), index = buildIndex(scope), knowledge = readAllPageKnowledge(scope.paths.knowledgePageDir, true);
  const manual = manualMethods(scope);
  const pages: Array<AuthoringPage & { file?: string }> = [...data.pages];
  const documents = knowledge.map(page => ({ page, document: parseYaml(page.raw) as any }));
  for (const { page, document } of documents) {
    if (document.page?.application_id && document.page.application_id !== scope.applicationId) throw Error('Foreign authoring knowledge.');
    const name = document.page?.logical_name || page.id;
    const item = { name, route: page.route, description: page.purpose || page.name, file: page.file };
    const at = pages.findIndex(item => item.name === name);
    if (at < 0) pages.push(item); else pages[at] = item;
  }
  const objects = Object.entries(index.pages).map(([className, item]) => {
    const declared = data.objects.find(object => object.className === className);
    const associations = documents.filter(({ page, document }) => (document.page_objects ?? []).includes(className)
      || page.elements.some(element => element.page_object === className)).map(({ page, document }) => document.page?.logical_name || page.id);
    const page = associations[0] ?? declared?.page ?? '';
    const logical = pages.find(item => item.name === page);
    // EACH METHOD'S DECLARED LOCATOR, joined from knowledge by (page_object, method).
    //
    // Recording Review needs a truthful basis for recommending one capability over another.
    // Matching a method NAME against the recorded target is guessing, and a guess dressed as a
    // recommendation is how the wrong control gets bound. The declared expression is a fact the
    // application already states about itself, so "this method's declared locator IS the one
    // that was recorded" is evidence. It informs the ORDER only - the person may still choose
    // any valid method, because this is user-confirmed authoring, not inference.
    const declaredLocators = new Map<string, string>();
    for (const { page: known } of documents)
      for (const element of known.elements)
        if (element.page_object === className && element.page_object_method && element.locator_strategy)
          declaredLocators.set(element.page_object_method, element.locator_strategy);
    return { className, page, pages: associations.length ? associations : page ? [page] : [], route: logical?.route ?? '', description: item.purpose,
      methods: item.methods.map(method => ({ ...method,
        declaredLocator: declaredLocators.get(method.name),
        authoringStatus: manual.find(entry => entry.owner === className && entry.method === method.name)?.status })), file: item.file };
  });
  const term = query.toLowerCase().trim();
  return { applicationId: scope.applicationId,
    pages: pages.filter(page => `${page.name} ${page.route} ${page.description}`.toLowerCase().includes(term)),
    objects: objects.filter(object => `${object.className} ${object.page} ${object.route} ${object.methods.map(method => method.name).join(' ')}`.toLowerCase().includes(term)) };
}
export function writableAuthoringPath(scope: ApplicationScope, file: string, sidecar?: string) {
  const allowed = [scope.paths.pagesDir, scope.paths.knowledgePageDir];
  if (file !== scope.paths.fixturesFile && file !== sidecar && !allowed.some(root => path.dirname(file) === root)) throw Error('Authoring path is outside this application.');
  for (let current = file; path.dirname(current) !== current; current = path.dirname(current))
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Authoring through a symbolic link is not allowed.');
}
export function validateAuthoringChanges(scope: ApplicationScope, texts: Map<string, string>, sidecar?: string) {
  for (const file of texts.keys()) writableAuthoringPath(scope, file, sidecar);
  const options: ts.CompilerOptions = { noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, skipLibCheck: true, strictNullChecks: true };
  const roots = [...texts.keys()].filter(file => file.endsWith('.ts'));
  if (roots.length) {
    const host = ts.createCompilerHost(options), originalRead = host.readFile, originalExists = host.fileExists;
    host.readFile = file => texts.get(path.resolve(file)) ?? originalRead(file);
    host.fileExists = file => texts.has(path.resolve(file)) || originalExists(file);
    const diagnosticKey = (d: ts.Diagnostic) => `${d.file?.fileName}|${d.code}|${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    const baseline = new Map<string, number>();
    for (const d of ts.getPreEmitDiagnostics(ts.createProgram(roots.filter(file => fs.existsSync(file)), options))) baseline.set(diagnosticKey(d), (baseline.get(diagnosticKey(d)) ?? 0) + 1);
    const program = ts.createProgram(roots, options, host);
    const errors = ts.getPreEmitDiagnostics(program).filter(d => { if (d.category !== ts.DiagnosticCategory.Error) return false; const key = diagnosticKey(d), remaining = baseline.get(key) ?? 0; if (remaining) { baseline.set(key, remaining - 1); return false; } return true; });
    if (errors.length) throw Error(errors.map(d => { const at = d.file?.getLineAndCharacterOfPosition(d.start ?? 0); return `${d.file?.fileName}:${(at?.line ?? 0) + 1}:${(at?.character ?? 0) + 1} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`; }).join('\n'));
  }
}
function commit(scope: ApplicationScope, texts: Map<string, string>) { validateAuthoringChanges(scope, texts); commitTexts(texts); }
type PageDraft={name:string;route?:string;description?:string};
export function validateLogicalPage(input: PageDraft): AuthoringPage {
  const name = String(input.name ?? '').trim(), route = String(input.route ?? '').trim(), description = String(input.description ?? '').trim();
  if (!name || name.length > 80 || /[\r\n]/.test(name) || description.length > 240 || /[\r\n]/.test(description)) throw Error('Page name and description must be short, single-line text.');
  if (route && (!route.startsWith('/') || /[?#\\\r\n]/.test(route))) throw Error('Use a route path without query or session values, or leave it empty.');
  if (credentialsIn(name + ' ' + description).length) throw Error('Keep credentials out of authoring metadata.');
  return { name, route, description };
}
/** Logical identity is the application + authored name, never its optional route. */
export function prepareLogicalPage(scope: ApplicationScope, input: PageDraft, texts: Map<string, string>, existing = false): string {
  const page = validateLogicalPage(input), catalog = authoringCatalog(scope);
  const found = catalog.pages.find(item => item.name === page.name);
  if (found && !existing) throw Error(`Page already exists: ${page.name}. Use Existing Page or choose a different name.`);
  if (found?.file) return path.resolve(found.file);
  const id = `${scope.applicationId}__authored_${hashContent(page.name).slice(0, 20)}`;
  const file = path.join(scope.paths.knowledgePageDir, id + '.yaml');
  if (fs.existsSync(file)) throw Error('Logical Page knowledge path already exists.');
  texts.set(file, `# User-authored logical Page. Route is context, not identity.\npage:\n  id: ${id}\n  application_id: ${JSON.stringify(scope.applicationId)}\n  logical_name: ${JSON.stringify(page.name)}\n  name: ${JSON.stringify(page.name)}\n  route: ${JSON.stringify(page.route)}\n  purpose: ${JSON.stringify(page.description)}\npage_objects:\nelements:\n`);
  return file;
}
export function createLogicalPage(scope: ApplicationScope, input: PageDraft) {
  const texts = new Map<string, string>(); prepareLogicalPage(scope, input, texts); commit(scope, texts);
  return authoringCatalog(scope);
}
export function validatePageObjectName(className: string) {
  if (!/^[A-Z][A-Za-z0-9_]{1,70}$/.test(className) || ['BasePage', 'Base'].includes(className)) throw Error('Enter a unique PascalCase application class name.');
}
export function preparePageObject(scope: ApplicationScope, className: string, knowledgeFile: string, texts: Map<string, string>): string {
  validatePageObjectName(className);
  if (authoringCatalog(scope).objects.some(item => item.className === className)) throw Error('This application already has that Page Object class.');
  const file = path.join(scope.paths.pagesDir, className + '.ts');
  if (fs.existsSync(file)) throw Error('A file already exists at the requested class path.');
  // One skeleton for every NEW Page Object, wherever it is created from. This path used to
  // emit its own bare `class X extends BasePage {}` against a hard-coded base.page path, so
  // a manually created class looked nothing like a generated one and only resolved its import
  // for a single directory layout. The shape is owned by the abstraction writer.
  const source = pageObjectSkeleton(className, file,
    ['/** User-authored Page Object. No deterministic capabilities claimed. */']);
  const fixture = texts.get(scope.paths.fixturesFile) ?? fs.readFileSync(scope.paths.fixturesFile, 'utf8');
  const registration = registerFixture(fixture, className, { pageFile: file, fixtureFile: scope.paths.fixturesFile });
  if ('problem' in registration) throw Error(registration.problem);
  texts.set(file, source); texts.set(scope.paths.fixturesFile, registration.source);
  const yaml = texts.get(knowledgeFile) ?? fs.readFileSync(knowledgeFile, 'utf8');
  const document = parseYaml(yaml) as any;
  const objects = [...new Set([...(document.page_objects ?? []), className])];
  const block = `page_objects:\n${objects.map(name => `  - ${JSON.stringify(name)}`).join('\n')}\n`;
  texts.set(knowledgeFile, /^page_objects:/m.test(yaml) ? yaml.replace(/^page_objects:[^\n]*(?:\n[ \t]+[^\n]*)*\n?/m, block) : yaml + '\n' + block);
  return file;
}
export function createPageObject(scope: ApplicationScope, page: string, className: string) {
  const logical = authoringCatalog(scope).pages.find(item => item.name === page);
  if (!logical) throw Error('Unknown Page in this application.');
  const texts = new Map<string, string>(), file = prepareLogicalPage(scope, logical, texts, true);
  preparePageObject(scope, className, file, texts); commit(scope, texts);
  return authoringCatalog(scope);
}
/**
 * Why an authored locator is refused - as a category, not as one sentence.
 *
 * WHY THIS EXISTS
 *
 * Five independent rules used to share a single message: "Enter a supported Playwright
 * locator expression beginning with page." Four of them have nothing to do with the
 * prefix. A recorded chain like
 * `page.locator('div').filter({ hasText: '...' }).nth(1)` begins with `page.` - the
 * reader can SEE that it does - and was refused for its `.nth(1)`, so the screen told
 * them to fix the one thing that was already correct. A refusal nobody can act on is
 * not a safety gate doing its job; it is a safety gate the person routes around.
 *
 * Every rule below is the rule that was already here. None is relaxed, none is added,
 * and the order is the order that was already evaluated. Only the answer changes.
 */
export type AuthoringLocatorCode =
  | 'LOCATOR_NOT_TEXT'
  | 'LOCATOR_TOO_LONG'
  | 'UNSUPPORTED_LOCATOR_ROOT'
  | 'POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN'
  | 'FORBIDDEN_MECHANISM'
  | 'CREDENTIAL_IN_LOCATOR'
  | 'MALFORMED_LOCATOR_EXPRESSION'
  | 'EXECUTABLE_LOCATOR_EXPRESSION'
  | 'UNSUPPORTED_LOCATOR_CALL';
export interface AuthoringLocatorProblem { code: AuthoringLocatorCode; message: string }

/** Positional mechanisms, which have an evidence answer, and the rest, which do not. */
const POSITIONAL = /\.(?:first|last|nth)\s*\(/;

/**
 * Judge an authored locator and NAME the first rule it breaks, without throwing.
 *
 * Returns `null` for an acceptable expression. Exported so the review can show the same
 * verdict beside the locator BEFORE a save is attempted: one rule, evaluated in one
 * place, reported in two. A second copy of it in the browser would be a second rule.
 */
export function authoringLocatorProblem(locator: string): AuthoringLocatorProblem | null {
  if (typeof locator !== 'string' || !locator.trim())
    return { code: 'LOCATOR_NOT_TEXT', message: 'This step has no recorded locator to author from. Choose a Page Object capability instead.' };
  if (locator.length > 4000)
    return { code: 'LOCATOR_TOO_LONG', message: `The locator is ${locator.length} characters; the limit is 4000. Scope it to the element rather than to the page.` };
  if (!/^page\.(getBy\w+|locator)\(/.test(locator))
    return { code: 'UNSUPPORTED_LOCATOR_ROOT', message: 'A locator must start at the page - page.getByRole(), page.getByTestId(), page.locator() and the other page.getBy... roots. This one does not.' };
  // POSITION IS ITS OWN ANSWER, because it is the only one with an evidence route.
  // `.nth()` is admitted by the locator contract where the browser measured, at the
  // interaction and in the interaction's own document, WHICH of several matches was the
  // element acted on. Authoring carries no such measurement, so here it is always a
  // position nobody chose - and saying that is what tells a person what to do instead.
  const positional = forbiddenMechanisms(locator).filter(mechanism => /first\(|last\(|nth\(|positional/.test(mechanism));
  if (positional.length || POSITIONAL.test(locator))
    return { code: 'POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN', message: `The recorded locator selects by position (${(POSITIONAL.exec(locator) ?? ['a positional selector'])[0].replace(/\s*\($/, '()')}), and this recording proves no measurement of that position. Choose a Page Object capability, or author a locator that names the element - a role and accessible name, a test id, or a stable attribute.` };
  const forbidden = forbiddenMechanisms(locator);
  if (forbidden.length)
    return { code: 'FORBIDDEN_MECHANISM', message: `The locator uses ${forbidden.join(', ')}. That makes it resolve, not makes it correct, so it cannot become a capability.` };
  if (credentialsIn(locator).length)
    return { code: 'CREDENTIAL_IN_LOCATOR', message: 'The locator contains a credential value. Keep account values out of Page Objects and knowledge.' };
  const expression = ts.createSourceFile('locator.ts', `const target = ${locator};`, ts.ScriptTarget.Latest, true);
  const statement = expression.statements[0];
  if ((expression as any).parseDiagnostics.length || expression.statements.length !== 1 || !ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1)
    return { code: 'MALFORMED_LOCATOR_EXPRESSION', message: 'The locator must be one TypeScript expression. Check the quotes and brackets.' };
  // A locator declaration cannot execute arbitrary statements, callbacks or assignments.
  let problem: AuthoringLocatorProblem | null = null;
  const visit = (node: ts.Node) => {
    if (problem) return;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isBinaryExpression(node) || ts.isNewExpression(node))
      problem = { code: 'EXECUTABLE_LOCATOR_EXPRESSION', message: 'A locator cannot contain callbacks, assignments or constructors. It names an element; it does not run.' };
    else if (ts.isCallExpression(node) && (!ts.isPropertyAccessExpression(node.expression) || !/^(getBy\w+|locator|filter|and|or)$/.test(node.expression.name.text)))
      problem = { code: 'UNSUPPORTED_LOCATOR_CALL', message: `The locator calls ${ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) ? `.${node.expression.name.text}()` : 'something'}, which is not a supported locator step. Supported: getBy..., locator, filter, and, or.` };
    else ts.forEachChild(node, visit);
  }; visit(statement.declarationList.declarations[0].initializer!);
  return problem;
}

export function validateAuthoringLocator(locator: string): string {
  const problem = authoringLocatorProblem(locator);
  // The code travels in the message so a refusal is greppable and a reader is told which
  // rule spoke. The sentence after it is the part they can act on.
  if (problem) throw Error(`${problem.code}: ${problem.message}`);
  return locator;
}
/** Existing manual authoring writer, prepared in memory for a multi-artifact save. */
export function prepareAuthoringMethod(className: string, name: string, locator: string, file: string, before: string): string {
  if (!/^[a-zA-Z_$][\w$]{1,70}$/.test(name) || ['constructor', 'resolve', 'page', 'healing'].includes(name)) throw Error('Enter a unique method name.');
  validateAuthoringLocator(locator);
  const parsed = ts.createSourceFile(file, before, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className) as ts.ClassDeclaration | undefined;
  if (!declaration) throw Error('USER BINDING BROKEN: Page Object class disappeared.');
  if (declaration.members.some(member => member.name?.getText(parsed) === name)) throw Error('That member already exists.');
  const method = `\n  /** USER AUTHORED — NOT VALIDATED */\n  ${name}() { const page = this.page; return ${locator}; }\n`;
  return before.slice(0, declaration.end - 1) + method + before.slice(declaration.end - 1);
}
export function authoringKnowledgeEntry(className: string, method: string, locator: string, role: 'action' | 'assertion', target: string): string {
  return `  ${className}_${method}:\n    usage: ${role}\n    description: ${JSON.stringify(target)}\n    page_object: ${className}\n    page_object_method: ${method}\n${locator ? `    locator_strategy: ${JSON.stringify(locator)}\n` : ''}    provenance: USER_CONFIRMED\n    validation_status: USER AUTHORED — NOT VALIDATED\n`;
}
export function createAuthoringMethod(scope: ApplicationScope, className: string, name: string, locator: string) {
  const object = authoringCatalog(scope).objects.find(item => item.className === className);
  if (!object) throw Error('Unknown Page Object in this application.');
  if (object.methods.some(method => method.name === name)) throw Error('That method already exists; select it or edit it in Code Workspace.');
  const file = path.resolve(object.file), texts = new Map<string, string>();
  const logical = authoringCatalog(scope).pages.find(page => page.name === object.page);
  if (!logical) throw Error('Select a logical Page for this Page Object.');
  const yaml = prepareLogicalPage(scope, logical, texts, true);
  texts.set(file, prepareAuthoringMethod(className, name, locator, file, fs.readFileSync(file, 'utf8')));
  texts.set(yaml, appendElement(texts.get(yaml) ?? fs.readFileSync(yaml, 'utf8'), authoringKnowledgeEntry(className, name, locator, 'action', name)));
  texts.set(manualStatusPath(scope), manualStatusText(scope, [{ owner: className, method: name, status: 'USER AUTHORED — NOT VALIDATED' }]));
  commit(scope, texts);
  return authoringCatalog(scope);
}
