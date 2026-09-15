/** Navigation intent is recorded, never inferred from generated goto order. */
export type NavigationCause = 'intentional' | 'observed' | 'unknown';
const REASONS = ['explicit-entry', 'http-redirect', 'script-initiator', 'browser-script',
  'link-navigation', 'form-navigation', 'meta-refresh', 'http-refresh', 'history-api',
  'no-browser-evidence', 'unattributed-request', 'ambiguous-destination',
  'unsafe-destination', 'invalid-metadata'] as const;
export type NavigationReason = typeof REASONS[number];
export interface NavigationCounts { documents: number; history: number; other: number; unresolved: number }

export function navigationMetadata(line: string): {
  navigationCause: NavigationCause; navigationId?: string; navigationReason?: NavigationReason; navigationCounts?: NavigationCounts;
} {
  const match = /\/\/ @aura-navigation (intentional|observed|unknown)(?: id=(nav-\d+) reason=([a-z-]+)(?: documents=(\d{1,6}) history=(\d{1,6}) other=(\d{1,6}) unresolved=(\d{1,6}))?)?\s*$/.exec(line);
  if (!match) return { navigationCause: 'unknown' };
  if (match[3] && !REASONS.includes(match[3] as NavigationReason))
    return { navigationCause: 'unknown', navigationReason: 'invalid-metadata' };
  const counts = match[4] === undefined ? undefined : { documents: Number(match[4]),
    history: Number(match[5]), other: Number(match[6]), unresolved: Number(match[7]) };
  if (match[1] === 'observed' && counts && counts.unresolved > 0)
    return { navigationCause: 'unknown', navigationReason: 'invalid-metadata', navigationCounts: counts };
  return { navigationCause: match[1] as NavigationCause, navigationId: match[2],
    navigationReason: match[3] as NavigationReason | undefined, navigationCounts: counts };
}
export function navigationCause(line: string): NavigationCause {
  return navigationMetadata(line).navigationCause;
}

/** Query/fragment values may carry credentials even when their parameter name looks harmless. */
export function replayableNavigation(url: string): boolean {
  try {
    const value = new URL(url);
    return /^https?:$/.test(value.protocol) && !value.username && !value.password
      && !value.search && !value.hash
      && !/(?:\/saml(?:\/|$)|\/frontdoor\.jsp$|\/authn-request\.jsp$|\/response\/login$|\/(?:oauth2?|oidc)\/(?:callback|authorize|token)$)/i.test(value.pathname);
  } catch { return false; }
}

/** Fragments belong to document navigation; they are absent from HTTP request URLs. */
function requestKey(url: string): string {
  try { const parsed = new URL(url); parsed.hash = ''; return parsed.href; } catch { return url; }
}
const BROWSER_CAUSES: Record<string, NavigationReason> = {
  scriptInitiated: 'browser-script', anchorClick: 'link-navigation',
  formSubmissionGet: 'form-navigation', formSubmissionPost: 'form-navigation',
  metaTagRefresh: 'meta-refresh', httpHeaderRefresh: 'http-refresh',
};
interface Visit {
  kind: 'document' | 'history-api' | 'same-document';
  entry?: boolean;
  urls: Set<string>; key: string; loaderId?: string; requestId?: string;
  cause: 'observed' | 'unknown'; reason: NavigationReason;
}

/** Raw URLs are held only in memory. Persist only cause, local event ID and allowlisted reason. */
export class NavigationJournal {
  private readonly visits: Visit[] = [];
  private drain: (() => Promise<unknown>) | null = null;
  private readonly requested: Array<{ url: string; reason: NavigationReason }> = [];
  private readonly commits: Array<{ url: string; loaderId: string }> = [];
  private entryCapture: { url: string; awaiting: boolean } | null = null;

  /** Bind the framework's one explicit entry command to its first document request. */
  async navigateEntry(page: any, url: string): Promise<void> {
    if (this.entryCapture) throw new Error('Recording entry navigation is already established');
    this.entryCapture = { url: requestKey(url), awaiting: true };
    try { await page.goto(url); }
    finally { this.entryCapture.awaiting = false; }
  }

  private claimEntry(url: string, redirected: boolean): boolean {
    const capture = this.entryCapture;
    if (!capture?.awaiting) return false;
    capture.awaiting = false;
    return !redirected && requestKey(url) === capture.url;
  }

  async attach(page: any): Promise<void> {
    try {
      const session = await page.context().newCDPSession(page);
      await session.send('Page.enable');
      const tree = await session.send('Page.getFrameTree');
      let mainFrameId = tree.frameTree.frame.id;
      session.on('Page.frameRequestedNavigation', (event: any) => {
        if (event.frameId !== mainFrameId) return;
        const reason = BROWSER_CAUSES[event.reason];
        if (reason) this.requested.push({ url: event.url, reason });
      });
      session.on('Network.requestWillBeSent', (event: any) => {
        if (event.frameId !== mainFrameId || event.type !== 'Document') return;
        const url = event.request.url;
        const urls = new Set<string>([url]);
        if (event.request.urlFragment) urls.add(url + event.request.urlFragment);
        if (event.documentURL && requestKey(event.documentURL) === requestKey(url)) urls.add(event.documentURL);
        const reason: NavigationReason = event.redirectResponse ? 'http-redirect'
          : event.initiator?.type === 'script' ? 'script-initiator' : 'unattributed-request';
        this.visits.push({ kind: 'document', entry: this.claimEntry(url, Boolean(event.redirectResponse)),
          urls, key: requestKey(url), loaderId: event.loaderId, requestId: event.requestId,
          cause: reason === 'unattributed-request' ? 'unknown' : 'observed', reason });
      });
      session.on('Page.frameNavigated', (event: any) => {
        if (event.frame.parentId) return;
        mainFrameId = event.frame.id;
        this.commits.push({ url: event.frame.url + (event.frame.urlFragment ?? ''), loaderId: event.frame.loaderId });
      });
      session.on('Page.navigatedWithinDocument', (event: any) => {
        if (event.frameId !== mainFrameId) return;
        const history = event.navigationType === 'historyApi';
        this.visits.push({ kind: history ? 'history-api' : 'same-document', urls: new Set([event.url]), key: requestKey(event.url),
          cause: history ? 'observed' : 'unknown', reason: history ? 'history-api' : 'unattributed-request' });
      });
      await session.send('Network.enable');
      this.drain = () => session.send('Page.getFrameTree');
      return;
    } catch { /* Other engines prove HTTP redirects; unavailable initiators remain unknown. */ }
    page.on('request', (request: any) => {
      if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
      const redirected = Boolean(request.redirectedFrom());
      this.visits.push({ kind: 'document', entry: this.claimEntry(request.url(), redirected),
        urls: new Set([request.url()]), key: requestKey(request.url()),
        cause: redirected ? 'observed' : 'unknown', reason: redirected ? 'http-redirect' : 'unattributed-request' });
    });
  }

  /** Protocol reply is a barrier for events already emitted before finalization. */
  async settle(): Promise<void> {
    try { await this.drain?.(); } catch { /* Closed browser: keep only evidence already received. */ }
  }

  private reconciled(): Visit[] {
    // The initial request is already represented by the explicit entry action. It must
    // neither compete for a later visit's cause nor grant proof to a later unknown visit.
    const visits = this.visits.filter(visit => !visit.entry)
      .map(visit => ({ ...visit, urls: new Set(visit.urls) }));
    // Commits bind the full document URL (including fragment) to its network loader.
    for (const commit of this.commits) {
      const matches = visits.filter(v => v.loaderId && v.loaderId === commit.loaderId && v.key === requestKey(commit.url));
      if (matches.length === 1) matches[0].urls.add(commit.url);
    }
    // Resolve after capture: Page and Network events can arrive through different turns.
    // A unique match is required. A repeated destination never borrows an earlier visit's cause.
    for (const requested of this.requested) {
      // pushState/replaceState emits its own history event, not a document request.
      // It is independently proven and cannot consume a Page requested-navigation cause.
      const eligible = visits.filter(v => v.kind !== 'history-api');
      const exact = eligible.filter(v => v.urls.has(requested.url));
      const matches = exact.length ? exact : eligible.filter(v => v.key === requestKey(requested.url));
      if (matches.length !== 1) continue;
      const visit = matches[0];
      visit.urls.add(requested.url); visit.cause = 'observed'; visit.reason = requested.reason;
    }
    return visits;
  }

  finish(source: string, entryUrl: string): { source: string; insertedActions: number } {
    const visits = this.reconciled();
    const used = new Map<string, number>();
    let entryUsed = false, firstAction = true, eventId = 0;
    const marker = (url: string, cause: NavigationCause, reason: NavigationReason, counts: NavigationCounts = { documents: 0, history: 0, other: 0, unresolved: 0 }) => {
      const safe = cause === 'intentional' && replayableNavigation(url);
      return `  await page.goto(${JSON.stringify(safe ? url : '[navigation withheld]')}); // @aura-navigation ${cause} id=nav-${++eventId} reason=${cause === 'intentional' && !safe ? 'unsafe-destination' : reason} documents=${counts.documents} history=${counts.history} other=${counts.other} unresolved=${counts.unresolved}`;
    };
    const output = source.split('\n').map(line => {
      if (!/^\s*await /.test(line)) return line;
      const first = firstAction; firstAction = false;
      const match = /^\s*await page\.goto\((['"])(.*?)\1/.exec(line);
      if (!match) return line;
      const url = match[2];
      if (first && url === entryUrl) { entryUsed = true; return marker(url, 'intentional', 'explicit-entry'); }
      const matches = visits.filter(v => v.urls.has(url));
      const counts = { documents: matches.filter(v => v.kind === 'document').length,
        history: matches.filter(v => v.kind === 'history-api').length,
        other: matches.filter(v => v.kind === 'same-document').length,
        unresolved: matches.filter(v => v.cause === 'unknown').length };
      const offset = used.get(url) ?? 0; used.set(url, offset + 1);
      if (!matches.length) return marker(url, 'unknown', 'no-browser-evidence');
      if (matches.some(v => v.cause === 'unknown') || offset >= matches.length)
        return marker(url, 'unknown', matches.length > 1 || offset >= matches.length ? 'ambiguous-destination' : 'unattributed-request', counts);
      return marker(url, 'observed', matches[offset].reason, counts);
    });
    if (!entryUsed) {
      const at = output.findIndex(line => /^\s*await /.test(line));
      if (at < 0) return { source: output.join('\n'), insertedActions: 0 };
      output.splice(at, 0, marker(entryUrl, 'intentional', 'explicit-entry'));
    }
    return { source: output.join('\n'), insertedActions: entryUsed ? 0 : 1 };
  }
}
