import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { diagnosticData, type DiagnosticStep } from './artifacts';

/** Parsed source locations, with explicit generation provenance where available. */
export function sourceSteps(file: string, text = fs.readFileSync(file,'utf8'), resolveSymbols=false): DiagnosticStep[] {
  const options:ts.CompilerOptions={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,esModuleInterop:true,skipLibCheck:true};
  const host=ts.createCompilerHost(options),read=host.readFile;host.readFile=name=>path.resolve(name)===path.resolve(file)?text:read(name);
  const program=resolveSymbols?ts.createProgram([file],options,host):undefined,checker=program?.getTypeChecker();
  const source = program?.getSourceFile(file)??ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true), steps: DiagnosticStep[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'step'
        && node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[0])) {
      const body = node.arguments[1];
      if (ts.isArrowFunction(body) || ts.isFunctionExpression(body)) {
        let statement: ts.Node = node;
        while (statement.parent && !ts.isExpressionStatement(statement)) statement = statement.parent;
        const comments = ts.getLeadingCommentRanges(text,statement.getFullStart()) ?? [];
        let metadata: Partial<DiagnosticStep> = {};
        for (const comment of comments) {
          const marker = /^\/\/ @aura-step (\{.+\})\s*$/.exec(text.slice(comment.pos,comment.end));
          if (marker) { try { metadata = JSON.parse(marker[1]); } catch { /* Broken metadata is unavailable, never inferred. */ } }
        }
        const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const end = source.getLineAndCharacterOfPosition(node.end).line + 1;
        if(checker){
          const calls:Array<{pageObject:string;method:string;implementation:string;implementationLine:number;implementationSource:string}>=[];
          const inspect=(part:ts.Node)=>{
            if(ts.isCallExpression(part)&&ts.isPropertyAccessExpression(part.expression)){
              const declaration=checker.getSymbolAtLocation(part.expression.name)?.declarations?.find(ts.isMethodDeclaration);
              if(declaration&&ts.isClassDeclaration(declaration.parent)&&declaration.parent.name){
                const implementation=declaration.getSourceFile();
                if(!implementation.fileName.includes('node_modules'))calls.push({pageObject:checker.getTypeAtLocation(part.expression.expression).getSymbol()?.name??declaration.parent.name.text,
                  method:declaration.name.getText(implementation),implementation:path.relative(process.cwd(),implementation.fileName).replace(/\\/g,'/'),implementationLine:implementation.getLineAndCharacterOfPosition(declaration.getStart(implementation)).line+1,implementationSource:declaration.getText(implementation)});
              }
            }
            ts.forEachChild(part,inspect);
          };inspect(body.body);
          if(calls.length){metadata={...metadata,...calls[0]};(metadata as any).calls=calls;}
        }
        steps.push(diagnosticData({ ...metadata,recordingStepKey:metadata.recordingStepKey ?? `generated:${start}`,
          label:node.arguments[0].text,generatedFile:path.relative(process.cwd(),file).replace(/\\/g,'/'),
          generatedLineStart:start,generatedLineEnd:end,statement:body.body.getText(source) }));
      }
    }
    ts.forEachChild(node,visit);
  };
  visit(source); return steps;
}
/** Resolve the actual callsite, not its title or a guessed ordinal. */
const runtimeManifests = new Map<string, DiagnosticStep[]>();
export function runtimeStep(file: string, stack: string): Partial<DiagnosticStep> {
  const normalized = file.replace(/\\/g,'/');
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const location = new RegExp(escaped+':(\\d+):\\d+').exec(stack.replace(/\\/g,'/'));
  if (!location || !fs.existsSync(file)) return {};
  const line = Number(location[1]);
  const manifest=process.env.AURA_DIAGNOSTIC_MANIFEST;
  let steps:DiagnosticStep[];
  try{
    const key = `${file}:${fs.statSync(file).mtimeMs}:${manifest ? manifest + ':' + fs.statSync(manifest).mtimeMs : ''}`;
    steps = runtimeManifests.get(key) ?? (manifest ? JSON.parse(fs.readFileSync(manifest,'utf8')).steps : sourceSteps(file, undefined, true));
    runtimeManifests.set(key, steps);
  }catch{return {};}
  return steps.find(step => line >= step.generatedLineStart! && line <= step.generatedLineEnd!) ?? {};
}
