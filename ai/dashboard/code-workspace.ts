/** Case-scoped TypeScript workspace. No code is executed by a read or a save. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { type ApplicationScope, isWithinScope } from '../projects/scope';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';
import { parse as parseYaml } from '../knowledge/yaml';
import { commitTexts, hashContent } from '../knowledge/authoring-owners';
import { staticCheck } from '../autocode/verify';
import { replayableNavigation } from './navigation';
import { credentialsIn } from '../excel/readiness';
import { provenMeasurements } from '../autocode/dom-evidence';
import { forbiddenMechanisms } from '../autocode/abstraction/validate';
import { chainHasDynamicIdentifier } from '../autocode/abstraction/classify';
import { manualMethods, manualStatusPath, manualStatusText, type AuthoredStatus } from '../knowledge/manual-authoring';
import { authoringCatalogPath } from './authoring-catalog';

const ROOT = process.cwd();
const relative = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/');
const inside = (base: string, file: string) => { const r = path.relative(base, file); return !r.startsWith('..') && !path.isAbsolute(r); };
const compilerOptions: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, strictNullChecks: true,
  skipLibCheck: true, noEmit: true, types: ['node'], resolveJsonModule: true };
export interface CodeNode { id: string; category: string; editable: boolean; version: string }
export interface CodeGraph { applicationId: string; testCaseId: string; entry: string | null; files: CodeNode[]; edges: { from: string; to: string }[] }
function validCase(id: string) { if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw Error('Invalid test case ID.'); }
function category(scope: ApplicationScope, file: string): string | null {
  if (!inside(ROOT, file)) return null;
  // Resolve symlinks before granting any read/write authority.
  if (fs.existsSync(file) && path.resolve(fs.realpathSync(file)).toLowerCase() !== path.resolve(file).toLowerCase()) return null;
  if (file === path.join(ROOT,'tests-e2e/pages/base.page.ts')) return 'Shared Dependencies';
  if (isWithinScope(scope, file, 'generatedDir') && (!scope.flatLayout || path.dirname(file) === scope.paths.generatedDir)) return 'Generated Spec';
  if (isWithinScope(scope, file, 'pagesDir') && path.dirname(file) === scope.paths.pagesDir) return 'Page Objects Used';
  if (file === scope.paths.fixturesFile) return 'Application Fixture';
  if (isWithinScope(scope, file, 'knowledgePageDir') && path.dirname(file) === scope.paths.knowledgePageDir) return 'Knowledge';
  if (isWithinScope(scope, file, 'recordingsDir') && [scope.paths.recordingsDir, path.join(scope.paths.recordingsDir, 'accepted')].includes(path.dirname(file))) return /\.evidence\.json$/.test(file) ? 'Evidence' : 'Recording';
  const rel = relative(file);
  if (/^ai\/test-data\/(store|execution|encryption|secrets|values|reporter)\.ts$/.test(rel)) return 'Shared Dependencies';
  if (rel === 'tests-e2e/pages/base.page.ts' || /^tests-e2e\/support\/[^/]+\.ts$/.test(rel)) return 'Shared Dependencies';
  if (/^ai\/.+\.ts$/.test(rel) && !/^ai\/(knowledge\/(page|framework)|dashboard\/(recordings|runs|generations)|autocode\/quarantine|test-data|test-mapping|reports)\//.test(rel)
      && !/\.fixture\.ts$/.test(rel)) return 'Shared Dependencies';
  return null;
}
function readable(scope: ApplicationScope, file: string) {
  if (!category(scope, file)) throw Error('Dependency is outside this application or the shared framework allowlist.');
}

/**
 * WHO OWNS A DEPENDENCY - the one question a quarantine rerun must answer per file.
 *
 * Derived from `category()` rather than from a second set of path rules, because two
 * independent classifiers drift and the drift is silent: a file that reads as application
 * code to one and framework code to the other is replayed from the wrong era, and the run
 * then proves nothing about either. There is exactly one ownership contract, and this is a
 * projection of it.
 *
 * `null` means UNKNOWN, and unknown is not a default. A caller that cannot classify a
 * retained dependency must fail closed rather than guess which era to run it from.
 */
export type DependencyOwnership = 'TEST_OWNED' | 'APPLICATION_OWNED' | 'SHARED_FRAMEWORK';
const OWNERSHIP: Record<string, DependencyOwnership> = {
  'Generated Spec': 'TEST_OWNED',
  'Page Objects Used': 'APPLICATION_OWNED',
  'Application Fixture': 'APPLICATION_OWNED',
  'Knowledge': 'APPLICATION_OWNED',
  'Recording': 'APPLICATION_OWNED',
  'Evidence': 'APPLICATION_OWNED',
  'Shared Dependencies': 'SHARED_FRAMEWORK',
};
export function dependencyOwnership(scope: ApplicationScope, file: string): DependencyOwnership | null {
  const kind = category(scope, path.resolve(ROOT, file));
  return kind ? OWNERSHIP[kind] ?? null : null;
}
function programFor(entry: string, staged = new Map<string, string>(), additional: string[] = []) {
  const host = ts.createCompilerHost(compilerOptions);
  const originalRead = host.readFile;
  const originalExists = host.fileExists;
  host.fileExists = file => staged.has(path.resolve(file)) || originalExists(file);
  host.readFile = file => staged.get(path.resolve(file)) ?? originalRead(file);
  host.getSourceFile = (file, language) => { const text = host.readFile(file); return text === undefined ? undefined : ts.createSourceFile(file, text, language, true); };
  return ts.createProgram([entry, ...additional], compilerOptions, host);
}
function imports(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.getText(source) === 'require' || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw Error('Dynamic module paths require review; dependencies cannot be guessed.');
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source); return [...new Set(found)];
}
function importedFile(from: string, name: string): string | null {
  if (!name.startsWith('.')) {
    if (name.startsWith('/') || name.includes('\\') || name.includes(':') && !name.startsWith('node:')) throw Error('Unsupported import path.');
    return null;
  }
  const file = ts.resolveModuleName(name, from, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
  if (!file) throw Error(`Unresolved import ${name} in ${relative(from)}.`);
  return path.resolve(file);
}
function walkImports(scope: ApplicationScope, entry: string, staged = new Map<string, string>()) {
  const visited = new Map<string, ts.SourceFile>();
  const walk = (file: string) => {
    if (visited.has(file)) return;
    readable(scope, file);
    if (visited.size > 240) throw Error('Dependency graph is too large for this workspace.');
    const source = ts.createSourceFile(file, staged.get(file) ?? fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    visited.set(file, source);
    for (const name of imports(source)) { const next = importedFile(file, name); if (next) { readable(scope, next); walk(next); } }
  };
  walk(entry); return visited;
}
function usedPages(program: ts.Program, entry: string): Set<string> {
  const checker = program.getTypeChecker(), found = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const type = checker.getTypeAtLocation(node);
      for (const declaration of type.getSymbol()?.declarations ?? []) if (ts.isClassDeclaration(declaration)) found.add(path.resolve(declaration.getSourceFile().fileName));
      for (const declaration of checker.getSymbolAtLocation(node)?.declarations ?? [])
        if (ts.isMethodDeclaration(declaration)) found.add(path.resolve(declaration.getSourceFile().fileName));
    }
    ts.forEachChild(node, visit);
  };
  const source = program.getSourceFile(entry); if (source) visit(source); return found;
}
/** Full imported dependency snapshot for reproducible execution, including fixture imports
 * omitted from the presentation because the spec does not reference their class. */
export function codeDependencySources(scope:ApplicationScope,id:string,staged=new Map<string,string>()) {
  validCase(id);return new Map([...walkImports(scope,path.join(scope.paths.generatedDir,`${id}.spec.ts`),staged)]
    .map(([file,source])=>[file,source.text]));
}
export function codeGraph(scope: ApplicationScope, testCaseId: string, staged = new Map<string, string>()): CodeGraph {
  validCase(testCaseId);
  const file = path.join(scope.paths.generatedDir, `${testCaseId}.spec.ts`);
  const graph: CodeGraph = { applicationId: scope.applicationId, testCaseId, entry: null, files: [], edges: [] };
  const add = (absolute: string) => {
    readable(scope, absolute); const id = relative(absolute);
    if (!graph.files.some(node => node.id === id)) {
      const kind = category(scope, absolute)!;
      graph.files.push({ id, category: kind, editable: ['Generated Spec', 'Page Objects Used', 'Application Fixture', 'Knowledge'].includes(kind) && /\.(ts|yaml|yml)$/.test(absolute),
        version: hashContent(staged.get(absolute) ?? fs.readFileSync(absolute, 'utf8')) });
    }
    return id;
  };
  const owners = new Set<string>();
  const ownerFiles = new Map<string, string>();
  if (fs.existsSync(file) || staged.has(file)) {
    // Validate the complete import graph, including imports pruned from the presentation.
    const all = walkImports(scope, file, staged), program = programFor(file, staged), wanted = usedPages(program, file);
    graph.entry = add(file);
    const seen = new Set<string>();
    const walk = (current: string) => {
      if (seen.has(current)) return; seen.add(current);
      const source = all.get(current)!; const from = add(current);
      if (category(scope, current) === 'Page Objects Used') {
        source.forEachChild(node => { if (ts.isClassDeclaration(node) && node.name) { owners.add(node.name.text); ownerFiles.set(node.name.text, from); } });
      }
      for (const name of imports(source)) {
        const next = importedFile(current, name); if (!next || !all.has(next)) continue;
        if (current === scope.paths.fixturesFile && category(scope, next) === 'Page Objects Used' && !wanted.has(next)) continue;
        graph.edges.push({ from, to: add(next) }); walk(next);
      }
    };
    walk(file);
    for (const knowledge of readAllPageKnowledge(scope.paths.knowledgePageDir, true))
      if (knowledge.elements.some(element => owners.has(element.page_object ?? ''))) {
        const to = add(path.resolve(knowledge.file));
        for (const owner of owners) if (knowledge.elements.some(element => element.page_object === owner)) {
          const implementation = ownerFiles.get(owner);
          if (implementation) graph.edges.push({ from: implementation, to });
        }
      }
    if (manualMethods(scope).some(method => owners.has(method.owner))) add(manualStatusPath(scope));
    const catalogFile = authoringCatalogPath(scope);
    if (fs.existsSync(catalogFile) && JSON.parse(fs.readFileSync(catalogFile, 'utf8')).objects.some((object: any) => owners.has(object.className))) add(catalogFile);
  }
  for (const dir of [scope.paths.recordingsDir, path.join(scope.paths.recordingsDir, 'accepted')]) {
    if (!fs.existsSync(dir)) continue;
    for (const suffix of ['.spec.ts', '.evidence.json', '.assertions.json', '.owners.json']) {
      const artifact = path.join(dir, testCaseId + suffix);
      if (fs.existsSync(artifact) || staged.has(artifact)) add(artifact);
    }
    if (graph.files.some(node => node.category === 'Recording')) break;
  }
  return graph;
}
function nodeFor(scope: ApplicationScope, id: string, fileId: string, staged = new Map<string,string>()) {
  const graph = codeGraph(scope, id, staged), node = graph.files.find(file => file.id === fileId);
  if (!node) throw Error('This file is not a dependency of the selected application and test case.');
  return { graph, node, file: path.resolve(ROOT, node.id) };
}
export function readCode(scope: ApplicationScope, id: string, fileId: string, staged = new Map<string,string>()) {
  const { node, file } = nodeFor(scope, id, fileId,staged);
  return { ...node, content: staged.get(file) ?? fs.readFileSync(file, 'utf8'), authoring: manualMethods(scope) };
}
export function codeDefinition(scope: ApplicationScope, id: string, fileId: string, position: number, version?: string, staged = new Map<string,string>()) {
  const { graph, file, node } = nodeFor(scope, id, fileId,staged);
  if (version && version !== node.version) throw Error('The source changed outside this viewer. Refresh before navigating definitions.');
  if (!graph.entry) return null;
  const program = programFor(path.resolve(ROOT, graph.entry),staged), source = program.getSourceFile(file);
  if (!source || !Number.isInteger(position) || position < 0 || position > source.text.length) return null;
  let token: ts.Node = source;
  const find = (node: ts.Node) => { if (node.getStart(source) <= position && node.end >= position) { token = node; ts.forEachChild(node, find); } };
  find(source);
  const checker = program.getTypeChecker(); let symbol = checker.getSymbolAtLocation(token);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const allDeclarations = symbol?.declarations ?? [];
  const implementations = allDeclarations.filter(declaration => (ts.isMethodDeclaration(declaration) || ts.isFunctionDeclaration(declaration)) && declaration.body);
  const declarations = implementations.length ? implementations : allDeclarations;
  const targets = declarations.map(declaration => {
    const target = declaration.getSourceFile(), id = relative(path.resolve(target.fileName));
    const start = declaration.getStart(target), location = target.getLineAndCharacterOfPosition(start);
    return { id, start, end: declaration.end, line: location.line + 1, column: location.character + 1 };
  }).filter(target => graph.files.some(node => node.id === target.id));
  return targets.length === 1 ? targets[0] : null;
}
function diagnostics(program: ts.Program) {
  return ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error).map(d => {
    const point = d.file?.getLineAndCharacterOfPosition(d.start ?? 0);
    return { file: d.file ? relative(path.resolve(d.file.fileName)) : '', line: (point?.line ?? 0) + 1,
      column: (point?.character ?? 0) + 1, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') };
  });
}
function normalized(source: string): string {
  const syntax = ts.createSourceFile('expression.ts', source, ts.ScriptTarget.Latest, true);
  const transformed = ts.transform(syntax, [context => file => {
    const visit: ts.Visitor = node => ts.isStringLiteral(node) ? ts.factory.createStringLiteral(node.text) : ts.visitEachChild(node, visit, context);
    return ts.visitNode(file, visit) as ts.SourceFile;
  }]);
  try { return ts.createPrinter({ removeComments: true }).printFile(transformed.transformed[0]).trim(); }
  finally { transformed.dispose(); }
}
function methods(source: string) {
  const file = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true), result = new Map<string, { body: string; expressions: string[] }>();
  file.forEachChild(node => {
    if (!ts.isClassDeclaration(node)) return;
    for (const member of node.members) {
      const body = (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member) || ts.isConstructorDeclaration(member))
        ? member.body : ts.isPropertyDeclaration(member) ? member.initializer : undefined;
      if (!body) continue;
      const expressions: string[] = [];
      const visit = (part: ts.Node) => {
        if (ts.isCallExpression(part)) {
          const text = part.getText(file).replace(/^this\.page\b/, 'page');
          if (/^page\.(getBy\w+|locator)\(/.test(text)) {
            expressions.push(text); return; // Preserve the complete chain, never strip forbidden calls.
          }
        }
        ts.forEachChild(part, visit);
      };
      visit(body);
      const name = member.name?.getText(file) ?? 'constructor';
      result.set(name, { body: normalized(body.getText(file)), expressions });
    }
  }); return result;
}
function locatorChanges(before: string, after: string) {
  const old = methods(before), next = methods(after), changed: { method: string; old: string[]; next: string[] }[] = [];
  for (const [name, original] of old) if (!next.has(name)) throw Error(`Removing established method ${name} requires an explicit capability maintenance operation.`);
  for (const [name, method] of next) {
    const previous = old.get(name);
    if (previous?.body === method.body || (!method.expressions.length && !previous?.expressions.length)) continue;
    changed.push({ method: name, old: previous?.expressions ?? [], next: method.expressions });
  }
  return changed;
}
function proveLocatorEdits(scope: ApplicationScope, graph: CodeGraph, changes: ReturnType<typeof locatorChanges>): boolean {
  const evidenceFiles = graph.files.filter(node => node.category === 'Evidence');
  const targets = evidenceFiles.flatMap(node => {
    const evidence = JSON.parse(fs.readFileSync(path.resolve(ROOT, node.id), 'utf8'));
    return evidence.origin?.applicationId === scope.applicationId ? evidence.targets ?? [] : [];
  });
  return changes.every(change => change.old.length > 0 && change.next.length > 0 && change.next.every(expression =>
    !forbiddenMechanisms(expression).length && !chainHasDynamicIdentifier(expression) && targets.some(target => {
      const role = target.captureTiming === 'assertion-pick' ? 'assertion' : 'action';
      const proven = provenMeasurements(target, role).map(candidate => normalized(candidate.expression));
      return change.old.every(old => proven.includes(normalized(old))) && proven.includes(normalized(expression));
    })));
}
function contractErrors(source: string, kind: string): string[] {
  const errors: string[] = [];
  if (/\b(?:eval|Function)\s*\(|@ts-(?:ignore|nocheck)|\bas\s+any\b/.test(source)) errors.push('Dynamic evaluation and type-check bypasses are not accepted by workspace saves.');
  if (/\b(?:SAMLResponse|saml_request_id|OCIS_REQ|access_token|session_token)\s*[=:]/i.test(source)) errors.push('Session-bearing authentication values must not be saved into code.');
  if (/\bprocess\.env\b/.test(source)) errors.push('Use the scoped framework credential fixture; application code must not select environment secrets directly.');
  if (kind === 'Generated Spec') {
    if (!/\bexpect\s*\(/.test(source)) errors.push('A generated spec must retain an assertion.');
    if (/\btest\.(?:skip|fixme|only)\s*\(/.test(source)) errors.push('Skipping or focusing tests cannot be accepted as a normal spec save.');
  }
  const syntax = ts.createSourceFile('edited.ts', source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if ((ts.isPropertyAssignment(node) || ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node))
        && node.initializer && ts.isStringLiteral(node.initializer)
        && credentialsIn(`${node.name.getText(syntax)}: ${JSON.stringify(node.initializer.text)}`).length)
      errors.push('Literal credential values must not be persisted in application code.');
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === 'goto' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && !replayableNavigation(node.arguments[0].text))
        errors.push('Navigation destination may carry authentication/session state.');
      if (['fill','type'].includes(method) && /password|secret/i.test(node.expression.expression.getText(syntax)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
        errors.push('Credential fields must use the scoped credential fixture.');
      if (['first','last','nth'].includes(method)) { /* The existing positional identity check owns these. */ }
      else if (['dispatchEvent','waitForTimeout'].includes(method)) errors.push(`Framework contract: ${method} is not permitted.`);
    }
    ts.forEachChild(node, visit);
  }; visit(syntax);
  return errors;
}
function protectedKnowledge(text: string): string {
  const value = parseYaml(text);
  const strip = (node: any): any => Array.isArray(node) ? node.map(strip) : node && typeof node === 'object'
    ? Object.fromEntries(Object.entries(node).filter(([key]) => !['description', 'purpose'].includes(key)).map(([key, item]) => [key, strip(item)])) : node;
  return JSON.stringify(strip(value));
}
export function prepareCodeSave(scope: ApplicationScope, id: string, fileId: string, version: string, content: string, overlay = new Map<string,string>()) {
  const { node, graph, file } = nodeFor(scope, id, fileId,overlay);
  if (!node.editable) throw Error('Shared framework files, recordings and evidence are read-only.');
  if (typeof content !== 'string' || content.length > 250_000) throw Error('File content exceeds the workspace limit.');
  const before = overlay.get(file) ?? fs.readFileSync(file, 'utf8');
  if (hashContent(before) !== version) throw Error('The file changed outside this editor. Your draft is retained; reload and merge before saving.');
  let formatted = content.replace(/\r\n/g, '\n');
  const transaction = new Map<string, string>();
  let authoringStatus: AuthoredStatus | undefined;
  if (node.category === 'Knowledge') {
    if (credentialsIn(formatted).length) throw Error('Keep credential values out of knowledge.');
    if (protectedKnowledge(before) !== protectedKnowledge(formatted)) throw Error('Knowledge editing is limited to description and purpose. Ownership, locators and capabilities require the deterministic lifecycle.');
  } else {
    const parsed = ts.createSourceFile(file, formatted, ts.ScriptTarget.Latest, true);
    const syntax = (parsed as any).parseDiagnostics as ts.Diagnostic[];
    if (syntax.length) return { accepted: false, status: 'invalid', errors: syntax.map(d => { const at = parsed.getLineAndCharacterOfPosition(d.start ?? 0); return { message: ts.flattenDiagnosticMessageText(d.messageText, '\n'), line: at.line + 1, column: at.character + 1 }; }) };
    formatted = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(parsed);
    const errors = contractErrors(formatted, node.category);
    if (node.category === 'Generated Spec') {
      const scenario = new RegExp(`['"\x60]${id} - ([^'"\x60]+)`).exec(before)?.[1] ?? '';
      errors.push(...staticCheck(formatted, id, scenario, scope).map(problem => problem.message));
    }
    if (node.category === 'Application Fixture') {
      const base = path.join(ROOT, 'tests-e2e/support/base-fixtures.ts');
      if (!imports(parsed).some(name => importedFile(file, name) === base)) errors.push('Application fixture must extend the shared base-fixtures module.');
    }
    if (errors.length) return { accepted: false, status: 'invalid', errors: errors.map(message => ({ message })) };
    const staged = new Map(overlay); staged.set(file,formatted);
    const entry = path.resolve(ROOT, graph.entry!);
    walkImports(scope, entry, staged);
    const dependents = node.category === 'Generated Spec' || !fs.existsSync(scope.paths.generatedDir) ? [] : fs.readdirSync(scope.paths.generatedDir)
      .filter(name => name.endsWith('.spec.ts')).map(name => path.join(scope.paths.generatedDir, name));
    const baseline = diagnostics(programFor(entry, overlay, dependents)), after = diagnostics(programFor(entry, staged, dependents));
    const old = new Set(baseline.map(d => `${d.file}|${d.code}|${d.message}`));
    const introduced = after.filter(d => graph.files.some(node => node.editable && node.id === d.file) || !old.has(`${d.file}|${d.code}|${d.message}`));
    if (introduced.length) return { accepted: false, status: 'invalid', errors: introduced };
    if (node.category === 'Page Objects Used') {
      const changes = locatorChanges(before, formatted);
      const proven = !changes.length || proveLocatorEdits(scope, graph, changes);
      if (changes.length) {
        authoringStatus = proven ? 'USER AUTHORED — VALIDATED' : 'USER AUTHORED — NOT VALIDATED';
        const parsedClass = ts.createSourceFile(file, formatted, ts.ScriptTarget.Latest, true).statements.find(ts.isClassDeclaration);
        if (!parsedClass?.name) throw Error('A Page Object must declare its class.');
        transaction.set(manualStatusPath(scope), manualStatusText(scope, changes.map(change => ({
          owner: parsedClass.name!.text, method: change.method, status: authoringStatus!,
        }))));
      }
      // Explicit maintenance: update only the matching established locator declaration,
      // in the same transaction as its class. No capability is invented or renamed.
      if (changes.length && proven) {
        const className = [...before.matchAll(/export\s+class\s+(\w+)/g)][0]?.[1];
        const knowledge = readAllPageKnowledge(scope.paths.knowledgePageDir);
        for (const change of changes) {
          const matches = knowledge.flatMap(page => page.elements.filter(element => element.page_object === className
            && element.page_object_method === change.method).map(element => ({ page, element })));
          if (matches.length !== 1 || change.next.length !== 1 || !change.old.some(old => normalized(old) === normalized(matches[0]?.element.locator_strategy ?? '')))
          {
            authoringStatus = 'USER AUTHORED — NOT VALIDATED';
            transaction.set(manualStatusPath(scope), manualStatusText(scope, changes.map(item => ({ owner: className!, method: item.method, status: authoringStatus! }))));
            continue;
          }
          const { page, element } = matches[0], knowledgeFile = path.resolve(page.file);
          const original = transaction.get(knowledgeFile) ?? fs.readFileSync(knowledgeFile, 'utf8');
          const lines = original.split('\n'); let inElement = false, changed = false;
          for (let i = 0; i < lines.length; i++) {
            const key = /^  ([\w-]+):\s*$/.exec(lines[i]); if (key) inElement = key[1] === element.id;
            if (inElement && /^    locator_strategy:/.test(lines[i])) { lines[i] = `    locator_strategy: ${JSON.stringify(change.next[0])}`; changed = true; }
          }
          if (!changed) {
            authoringStatus = 'USER AUTHORED — NOT VALIDATED';
            transaction.set(manualStatusPath(scope), manualStatusText(scope, changes.map(item => ({ owner: className!, method: item.method, status: authoringStatus! }))));
            continue;
          }
          transaction.set(knowledgeFile, lines.join('\n'));
        }
      }
    }
  }
  // Recheck every displayed dependency immediately before the single-file atomic commit.
  for (const dependency of graph.files) if (hashContent(overlay.get(path.resolve(ROOT,dependency.id)) ?? fs.readFileSync(path.resolve(ROOT, dependency.id), 'utf8')) !== dependency.version)
    throw Error('A dependency changed during validation. Your draft is retained; retry after reviewing it.');
  transaction.set(file, formatted);
  return { accepted: true, status: 'saved', content: formatted, version: hashContent(formatted),
    transaction,
    authoringStatus,
    validation: `${authoringStatus ? authoringStatus + '. ' : ''}TypeScript and framework contracts passed. Save does not promote automation status or claim a live execution.` };
}
export function saveCode(scope: ApplicationScope, id: string, fileId: string, version: string, content: string) {
  const result=prepareCodeSave(scope,id,fileId,version,content);
  if(!result.accepted || !result.transaction)return result;
  commitTexts(result.transaction);
  const {transaction,...saved}=result;return saved;
}
