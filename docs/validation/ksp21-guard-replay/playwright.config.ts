import original from '../../../playwright.excel.config';
import path from 'node:path';
export default {...original,testDir:__dirname,testIgnore:[],testMatch:'case.spec.ts',globalSetup:undefined,retries:0,workers:1,outputDir:path.join(__dirname,'artifacts'),reporter:[['json',{outputFile:path.join(__dirname,'results.json')}]],use:{...original.use,trace:'off',video:'off',screenshot:'off'}};
