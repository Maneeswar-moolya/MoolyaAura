/** Declared route templates share one matcher across ownership and reuse. */
export function routeMatches(declared: string, actual: string): boolean {
  const left = declared.split('?')[0].replace(/\/$/, '').split('/');
  const right = actual.replace(/\/$/, '').split('/');
  if (left.length !== right.length)
    return false;
  return left.every((segment, index) => segment.startsWith(':') || segment === right[index]);
}
