/** Explicit authored value tokens. No field is inferred from a control name or recorded value. */
export function dataFieldToken(value:string|null|undefined):string|null {
 const match=/^<data:([A-Za-z][A-Za-z0-9_]*)>$/.exec(value??'');
 if(!match||/^(?:constructor|prototype|password|secret|token|username|email)$/i.test(match[1]))return null;
 return match[1];
}
export function generatedInput(value:string):string {
 const key=dataFieldToken(value);return key?`String(testData.${key})`:JSON.stringify(value);
}
export function requiredData<T extends Record<string,unknown>>(data:T):T {
 return new Proxy(data,{get(target,key,receiver){if(typeof key==='string'&&!Object.prototype.hasOwnProperty.call(target,key))throw Error(`DATA_CONFIGURATION_FAILURE: Required data field "${key}" is unavailable in this execution row.`);return Reflect.get(target,key,receiver);}});
}
