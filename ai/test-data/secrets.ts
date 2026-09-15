/** Runtime-only redaction registrations. Never serialized or returned to dashboard clients. */
const values = new Set<string>();
export function registerCredentialSecrets(username: string, password: string): void {
  for (const value of [username,password]) if(value) values.add(value);
}
export function credentialSecrets(): string[] { return [...values]; }
