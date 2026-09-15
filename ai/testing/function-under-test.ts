/** Execute a parsed production unit with explicit dependency doubles. No source files are rewritten. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

export function functionUnderTest(file: string, name: string, bindings: Record<string, unknown>): (...args: any[]) => any {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing production function ${name}`);
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), 'exports', code + `\nreturn ${name};`)(...Object.values(bindings), {});
}

export function actionResolverUnderTest(bindings: Record<string, unknown>): () => unknown {
  const file = 'ai/autocode/from-recording.ts';
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'match' && node.initializer) {
      let actionLookup = false;
      function find(call: ts.Node) {
        if (ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === 'findMethod') {
          const arg = call.arguments[0];
          actionLookup = ts.isPropertyAccessExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === 'action' && arg.name.text === 'target';
        }
        ts.forEachChild(call, find);
      }
      find(node.initializer); if (actionLookup) expression = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(expression, 'Missing action resolver expression');
  return new Function(...Object.keys(bindings), `return (${expression.getText(source)});`).bind(null, ...Object.values(bindings)) as () => unknown;
}
