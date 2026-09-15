import { spawnSync } from 'node:child_process';
import path from 'node:path';

export interface SecretPayload { provider: 'WINDOWS_DPAPI_CURRENT_USER'; ciphertext: string; }
// Code is constant. Secret bytes travel through anonymous pipes, never argv, environment or a file.
const bridge = `$ErrorActionPreference='Stop'
try {
 Add-Type -AssemblyName System.Security
 $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
 $bytes=[Convert]::FromBase64String($request.bytes)
 $entropy=[Text.Encoding]::UTF8.GetBytes($request.context)
 if($request.operation -eq 'protect') {
  $result=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 } else {
  $result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 }
 [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { [Console]::Error.Write('Secure local credential operation failed.'); exit 1 }`;
function crypt(operation: 'protect'|'unprotect', bytes: string, context: string): string {
  if(process.platform!=='win32') throw Error('SECURE_STORAGE_UNAVAILABLE: this host has no configured secure local credential provider. Passwords were not saved.');
  const executable=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const result=spawnSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bridge,'utf16le').toString('base64')],{
    input:JSON.stringify({operation,bytes,context}),encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:128*1024,
  });
  if(result.status!==0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.stdout.trim()))
    throw Error('SECURE_STORAGE_UNAVAILABLE: Windows could not protect or unlock this credential for the current OS account. No plaintext fallback is permitted.');
  return result.stdout.trim();
}
export function encryptPassword(password: string, context: string): SecretPayload {
  return {provider:'WINDOWS_DPAPI_CURRENT_USER',ciphertext:crypt('protect',Buffer.from(password,'utf8').toString('base64'),context)};
}
export function decryptPassword(payload: SecretPayload, context: string): string {
  if(payload.provider!=='WINDOWS_DPAPI_CURRENT_USER') throw Error('Unsupported credential encryption provider.');
  return Buffer.from(crypt('unprotect',payload.ciphertext,context),'base64').toString('utf8');
}
