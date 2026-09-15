/** Scoped child entry point: deterministic draft rebuilding never writes a generated suite. */
import fs from 'node:fs';
import { pinActiveScope } from '../projects/scope';
import { workbookOwner } from '../projects/registry';
import { parseWorkbook } from '../excel/parser';
import { quarantineDetails, quarantineMappingDraft } from './quarantine-workspace';
import { diagnosticText, containedFile, diagnosticRoot } from '../diagnostics/artifacts';
async function main(){
  const [applicationId,environmentId,id,workbook,output]=process.argv.slice(2);
  const scope=pinActiveScope({applicationId,environmentId});
  if(workbookOwner(workbook)!==scope.applicationId)throw Error('Foreign workbook.');
  const destination=containedFile(diagnosticRoot(scope),output),details=quarantineDetails(scope,id),draft=quarantineMappingDraft(scope,id);
  const parsed=await parseWorkbook(workbook),testCase=parsed.testCases.find(item=>item.testCaseId===details.testCaseId);
  if(!testCase)throw Error('The retained test case is absent from this application workbook.');
  const {mapRecording,assembleSpec}=await import('../autocode/from-recording');
  const mapping=mapRecording(draft.recording);
  if(mapping.unresolved.length||mapping.needsReview.length)throw Error([...mapping.unresolved,...mapping.needsReview].map(item=>item.why).join('\n'));
  fs.writeFileSync(destination,JSON.stringify({source:assembleSpec(testCase,mapping,workbook)}),{flag:'wx'});
}
main().catch(error=>{process.stderr.write(diagnosticText(error instanceof Error?error.message:error)+'\n');process.exitCode=1;});
