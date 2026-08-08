import { parseUserFromElement } from './parser';
import { logger } from '../utils/logger';
import { XUser } from '../types/user';

interface ScanProgress {
  count: number;
  lastUsername?: string;
  debug?: string;
}

/**
 * X following/followers sanal listesi tarayıcısı.
 *
 * 2k civarında erken kesilme genelde:
 *  - rate limit / yavaş API → kısa "boş tur" limitine takılma
 *  - scroll container yanlış → liste yüklenmiyor
 *  - sanal listede "alta zıplama" yetmez
 *
 * Strateji:
 *  - Sayfadaki hedef sayıyı oku (7500 Following)
 *  - Hedefin %97'sine ulaşmadan SADECE uzun kurtarma + bekleme ile dur
 *  - MutationObserver ile yeni hücre bekle
 *  - Rate-limit molaları (10s / 20s / 40s)
 */
export class XScanner {
  private isScanning = false;
  private collectedUsers = new Map<string, Partial<XUser>>();
  private _stopRequested = false;
  private scrollRoot: HTMLElement | null = null;
  private onProgressCb: ((progress: ScanProgress) => void) | null = null;
  private expectedCount: number | null = null;
  private lastGrowthAt = Date.now();
  private tickBusy = false;

  /**
   * Service worker arka planda her ~1 sn bir çağırır.
   * Sekme throttle olsa bile harici mesaj + SW scroll ile tarama ilerler.
   */
  public backgroundTick(): void {
    if (!this.isScanning || this._stopRequested || this.tickBusy) return;
    this.tickBusy = true;
    try {
      if (!this.scrollRoot?.isConnected) {
        this.scrollRoot = this.findScrollRoot();
      }
      const before = this.collectedUsers.size;
      this.collectFromDom();
      this.performScroll();
      this.collectFromDom();
      if (this.collectedUsers.size > before) {
        this.lastGrowthAt = Date.now();
      }
      this.onProgressCb?.({
        count: this.collectedUsers.size,
        debug: `bg-tick | hedef:${this.expectedCount ?? '?'} | DOM:${document.querySelectorAll('[data-testid="UserCell"]').length}`,
      });
    } catch (err) {
      logger.warn('Scanner', 'backgroundTick error', err);
    } finally {
      this.tickBusy = false;
    }
  }

  public async startScan(onProgress: (progress: ScanProgress) => void): Promise<{
    users: Partial<XUser>[];
    stopped: boolean;
  }> {
    if (this.isScanning) {
      logger.warn('Scanner', 'Previous scan still running — stopping it first');
      this.isScanning = false;
      await this.wait(400);
    }

    this.isScanning = true;
    this._stopRequested = false;
    this.collectedUsers.clear();
    this.scrollRoot = null;
    this.onProgressCb = onProgress;
    this.lastGrowthAt = Date.now();
    logger.log('Scanner', '=== SCAN STARTED ===', location.href);

    const ready = await this.waitForUserCells(25000);
    if (!this.isScanning) return this.finish(true, onProgress);

    this.scrollRoot = this.findScrollRoot();
    const expected = this.readExpectedCount();
    this.expectedCount = expected;
    logger.log('Scanner', 'Expected count from page', expected);

    onProgress({
      count: 0,
      debug: ready
        ? `Liste hazır | hedef≈${expected ?? '?'} | ${this.describeRoot(this.scrollRoot)} | arka-plan tick açık`
        : 'UserCell yok',
    });

    let scrollIteration = 0;
    let lastCount = 0;
    let lastGrowthAt = Date.now();
    let lastScrollHeight = 0;
    let fullRecoveryCycles = 0;
    let lastProgressReport = 0;

    // Sert tavan: güvenlik (saatlerce dönmesin) — 90 dk
    const hardDeadline = Date.now() + 90 * 60 * 1000;

    while (this.isScanning) {
      if (Date.now() > hardDeadline) {
        logger.warn('Scanner', 'Hard deadline reached');
        break;
      }

      scrollIteration++;
      if (scrollIteration % 15 === 0 || !this.scrollRoot?.isConnected) {
        this.scrollRoot = this.findScrollRoot();
      }

      // Periyodik hedef sayıyı yenile (header geç yüklenebilir)
      const expectedNow = this.readExpectedCount() ?? expected;

      const beforeSize = this.collectedUsers.size;
      const newCount = this.collectFromDom();
      const cellsInDOM = document.querySelectorAll('[data-testid="UserCell"]').length;

      if (newCount > 0 || this.collectedUsers.size > lastCount) {
        lastCount = this.collectedUsers.size;
        lastGrowthAt = Date.now();
        this.lastGrowthAt = lastGrowthAt;
        fullRecoveryCycles = 0;
      } else {
        // SW tick büyüttüyse senkronize et
        if (this.collectedUsers.size > lastCount) {
          lastCount = this.collectedUsers.size;
          lastGrowthAt = this.lastGrowthAt;
          fullRecoveryCycles = 0;
        }
      }

      const root = this.scrollRoot!;
      const sh = root.scrollHeight;
      if (sh > lastScrollHeight + 10) lastScrollHeight = sh;

      const noGrowthMs = Date.now() - lastGrowthAt;
      const ratio =
        expectedNow && expectedNow > 0
          ? this.collectedUsers.size / expectedNow
          : null;

      const now = Date.now();
      if (now - lastProgressReport > 700 || newCount > 0) {
        lastProgressReport = now;
        const pct = ratio != null ? ` | ${Math.round(ratio * 100)}%` : '';
        onProgress({
          count: this.collectedUsers.size,
          debug: `Scroll#${scrollIteration} | DOM:${cellsInDOM} | +${newCount} | hedef:${expectedNow ?? '?'}${pct} | durgun:${Math.round(noGrowthMs / 1000)}s | rec:${fullRecoveryCycles}`,
        });
      }

      // Hedefe yeterince yaklaştıysak bitir
      if (expectedNow && expectedNow >= 50 && this.collectedUsers.size >= expectedNow * 0.98) {
        // Son 2 sn daha dene
        await this.gentleScrollAndWait(800);
        this.collectFromDom();
        if (this.collectedUsers.size >= expectedNow * 0.98) break;
      }

      // Gerçek bitiş: uzun süre büyüme yok + kurtarma tükendi
      // Hedef biliniyorsa ve gerideysek ÇOK daha sabırlı ol
      const belowTarget =
        expectedNow != null && expectedNow > 100 && this.collectedUsers.size < expectedNow * 0.95;

      const stagnantSoft = noGrowthMs > 45_000; // 45 sn
      const stagnantHard = noGrowthMs > (belowTarget ? 180_000 : 90_000); // 3 dk / 1.5 dk

      if (stagnantSoft) {
        this.clickRetryIfPresent();
        fullRecoveryCycles++;
        await this.recoverStuck(fullRecoveryCycles, belowTarget);

        // Kurtarma sonrası hemen topla
        this.collectFromDom();
        if (this.collectedUsers.size > lastCount) {
          lastCount = this.collectedUsers.size;
          lastGrowthAt = Date.now();
          fullRecoveryCycles = 0;
          continue;
        }
      }

      if (stagnantHard && fullRecoveryCycles >= (belowTarget ? 8 : 5)) {
        // Hâlâ hedefin altındaysak bir tur daha uzun bekle (rate limit)
        if (belowTarget && fullRecoveryCycles < 12) {
          onProgress({
            count: this.collectedUsers.size,
            debug: `Rate-limit molası 30s… (${this.collectedUsers.size}/${expectedNow})`,
          });
          await this.wait(30000);
          this.clickRetryIfPresent();
          await this.recoverStuck(fullRecoveryCycles + 1, true);
          this.collectFromDom();
          if (this.collectedUsers.size > lastCount) {
            lastCount = this.collectedUsers.size;
            lastGrowthAt = Date.now();
            fullRecoveryCycles = 0;
            continue;
          }
          fullRecoveryCycles++;
          continue;
        }
        logger.log(
          'Scanner',
          `Stopping: stagnant. found=${this.collectedUsers.size} expected=${expectedNow}`
        );
        break;
      }

      // Normal kaydır + yeni hücre bekle
      this.performScroll();
      const grew = await this.waitForDomGrowth(beforeSize, 1200);
      if (!grew) {
        // Kısa ek kaydırma
        this.performScroll();
        await this.waitForDomGrowth(this.collectedUsers.size, 800);
      }

      // Yavaş tempoda da topla
      this.collectFromDom();
    }

    // Bitiş öncesi son tarama
    for (let i = 0; i < 5 && this.isScanning; i++) {
      this.performScroll();
      await this.wait(500);
      this.collectFromDom();
    }

    return this.finish(this._stopRequested, onProgress);
  }

  private finish(
    stopped: boolean,
    onProgress: (progress: ScanProgress) => void
  ): { users: Partial<XUser>[]; stopped: boolean } {
    this._stopRequested = false;
    this.isScanning = false;
    this.onProgressCb = null;
    onProgress({
      count: this.collectedUsers.size,
      debug: stopped
        ? 'Tarama durduruldu.'
        : `Tarama tamamlandı (${this.collectedUsers.size}).`,
    });
    logger.log(
      'Scanner',
      `=== SCAN ${stopped ? 'STOPPED' : 'FINISHED'} === Total: ${this.collectedUsers.size}`
    );
    return {
      users: Array.from(this.collectedUsers.values()),
      stopped,
    };
  }

  public stopScan() {
    this._stopRequested = true;
    this.isScanning = false;
  }

  public isRunning(): boolean {
    return this.isScanning;
  }

  /** DOM'dan kullanıcı topla; yeni eklenen sayısını döndür. */
  private collectFromDom(): number {
    let added = 0;
    const cells = document.querySelectorAll('[data-testid="UserCell"]');
    cells.forEach((cell) => {
      const user = parseUserFromElement(cell as HTMLElement);
      if (user?.id && !this.collectedUsers.has(user.id)) {
        this.collectedUsers.set(user.id, user);
        added++;
      }
    });
    for (const user of this.scanProfileLinksInTimeline()) {
      if (user.id && !this.collectedUsers.has(user.id)) {
        this.collectedUsers.set(user.id, user);
        added++;
      }
    }
    return added;
  }

  /**
   * Header'daki "1,234 Following" / "Following 1234" sayısını oku.
   */
  private readExpectedCount(): number | null {
    try {
      const primary =
        document.querySelector('[data-testid="primaryColumn"]') || document.body;
      const text = primary.textContent || '';

      // "7,543 Following" / "7.543 Following" / "Following 7543"
      const patterns = [
        /([\d.,\s]+)\s*Following\b/i,
        /([\d.,\s]+)\s*Takip\s*edilen/i,
        /Following\s*([\d.,\s]+)/i,
        /Takip\s*edilen\s*([\d.,\s]+)/i,
        /([\d.,\s]+)\s*Followers\b/i,
        /([\d.,\s]+)\s*Takipçi/i,
      ];

      const path = location.pathname.toLowerCase();
      const wantFollowing = path.includes('/following');
      const wantFollowers = path.includes('/followers');

      for (const re of patterns) {
        const m = text.match(re);
        if (!m) continue;
        const label = m[0].toLowerCase();
        if (wantFollowing && label.includes('follower')) continue;
        if (wantFollowers && label.includes('following') && !label.includes('follower'))
          continue;
        if (wantFollowing && !(label.includes('following') || label.includes('takip edilen')))
          continue;

        const n = this.parseCount(m[1]);
        if (n != null && n >= 1 && n < 50_000_000) return n;
      }

      // aria / link title
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href$="/following"], a[href$="/followers"]')
      );
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (wantFollowing && !href.endsWith('/following')) continue;
        if (wantFollowers && !href.includes('followers')) continue;
        const n = this.parseCount(a.textContent || a.getAttribute('title') || '');
        if (n != null && n >= 1) return n;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private parseCount(raw: string): number | null {
    // "7,543" | "7.543" | "7 543" | "7.5K" | "7,5 B"
    let s = raw.trim().replace(/\s/g, '');
    const kMatch = s.match(/^([\d.,]+)([KkMmBb])$/);
    if (kMatch) {
      let n = parseFloat(kMatch[1].replace(',', '.'));
      const u = kMatch[2].toUpperCase();
      if (u === 'K') n *= 1_000;
      if (u === 'M' || u === 'B') n *= 1_000_000;
      return Math.round(n);
    }
    // binlik ayırıcı: 7.543 veya 7,543 → 7543 (3 basamak grup)
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
      return parseInt(s.replace(/[.,]/g, ''), 10);
    }
    s = s.replace(/[^\d]/g, '');
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  }

  private async waitForUserCells(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs && this.isScanning) {
      if (document.querySelectorAll('[data-testid="UserCell"]').length > 0) return true;
      window.scrollBy(0, 240);
      await this.wait(350);
    }
    return false;
  }

  /** Scroll sonrası yeni UserCell / yeni kullanıcı için bekle. */
  private waitForDomGrowth(prevUserCount: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isScanning) {
        resolve(false);
        return;
      }
      if (this.collectedUsers.size > prevUserCount) {
        resolve(true);
        return;
      }

      const root =
        document.querySelector('[data-testid="primaryColumn"]') ||
        document.body;

      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(ok);
      };

      const observer = new MutationObserver(() => {
        this.collectFromDom();
        if (this.collectedUsers.size > prevUserCount) finish(true);
      });

      observer.observe(root, { childList: true, subtree: true });

      const timer = window.setTimeout(() => {
        this.collectFromDom();
        finish(this.collectedUsers.size > prevUserCount);
      }, timeoutMs);
    });
  }

  private async gentleScrollAndWait(ms: number): Promise<void> {
    this.performScroll();
    await this.wait(ms);
    this.collectFromDom();
  }

  private scanProfileLinksInTimeline(): Partial<XUser>[] {
    const root =
      document.querySelector('[data-testid="primaryColumn"]') ||
      document.querySelector('main[role="main"]') ||
      document.body;

    const links = root.querySelectorAll('a[href^="/"]');
    const skip = new Set([
      'home', 'explore', 'search', 'notifications', 'messages', 'settings', 'i',
      'compose', 'following', 'followers', 'verified_followers', 'likes', 'lists',
      'communities', 'premium', 'jobs', 'connect', 'intent', 'hashtag', 'tos',
      'privacy', 'login', 'signup', 'logout', 'grok', 'bookmarks', 'topics',
      'status', 'photo', 'header_photo',
    ]);

    const found: Partial<XUser>[] = [];
    const pageIsFollowing = /\/following\/?$/i.test(location.pathname);
    const pageIsFollowers = /\/followers|verified_followers\/?$/i.test(location.pathname);

    for (const a of Array.from(links)) {
      const href = (a as HTMLAnchorElement).getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$|\?)/);
      if (!m) continue;
      const username = m[1];
      if (skip.has(username.toLowerCase())) continue;
      const cell = (a as HTMLElement).closest('[data-testid="UserCell"]');
      if (!cell) continue;

      const id = username.toLowerCase();
      if (this.collectedUsers.has(id)) continue;

      const displayName =
        cell.querySelector('div[dir="auto"] span')?.textContent?.trim() || username;

      found.push({
        id,
        username,
        displayName,
        isFollowing: pageIsFollowing
          ? true
          : Boolean(cell.querySelector('[data-testid$="-unfollow"]')),
        isFollower: pageIsFollowers
          ? true
          : (cell.textContent || '').includes('Follows you') ||
            (cell.textContent || '').includes('Seni takip ediyor'),
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
      });
    }
    return found;
  }

  private findScrollRoot(): HTMLElement {
    const cell = document.querySelector('[data-testid="UserCell"]') as HTMLElement | null;
    if (cell) {
      let el: HTMLElement | null = cell.parentElement;
      let best: HTMLElement | null = null;
      while (el && el !== document.documentElement) {
        const style = window.getComputedStyle(el);
        const oy = style.overflowY;
        const scrollable =
          (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
          el.scrollHeight > el.clientHeight + 80;
        const tall = el.scrollHeight > el.clientHeight + 200;
        if (scrollable || tall) {
          best = el;
          if (scrollable) break;
        }
        el = el.parentElement;
      }
      if (best) return best;
    }

    const candidates = [
      document.querySelector('[data-testid="primaryColumn"]') as HTMLElement | null,
      document.querySelector('main[role="main"]') as HTMLElement | null,
      document.scrollingElement as HTMLElement | null,
      document.documentElement,
      document.body,
    ].filter(Boolean) as HTMLElement[];

    for (const c of candidates) {
      if (c.scrollHeight > c.clientHeight + 50) return c;
    }
    return (document.scrollingElement || document.documentElement) as HTMLElement;
  }

  private describeRoot(root: HTMLElement | null): string {
    if (!root) return 'none';
    return `${root.tagName.toLowerCase()} sh=${root.scrollHeight}`;
  }

  private performScroll(): void {
    try {
      const root = this.scrollRoot || this.findScrollRoot();
      this.scrollRoot = root;
      const cells = document.querySelectorAll('[data-testid="UserCell"]');
      const step = 1000;

      if (cells.length > 0) {
        const last = cells[cells.length - 1] as HTMLElement;
        last.scrollIntoView({ behavior: 'auto', block: 'end' });
        // virtual list: son birkaç hücreyi de "görünür" yap
        for (let i = Math.max(0, cells.length - 8); i < cells.length; i++) {
          (cells[i] as HTMLElement).scrollIntoView({ behavior: 'auto', block: 'nearest' });
        }
        last.scrollIntoView({ behavior: 'auto', block: 'end' });
      }

      const before = root.scrollTop;
      root.scrollBy({ top: step, left: 0, behavior: 'auto' });
      if (Math.abs(root.scrollTop - before) < 5) {
        root.scrollTop = Math.min(root.scrollTop + step, root.scrollHeight);
      }
      // Küçük bir "overscroll" — intersection observer tetikler
      root.scrollTop = Math.min(root.scrollTop + 80, root.scrollHeight);

      window.scrollBy(0, step);
      const se = document.scrollingElement;
      if (se && se !== root) se.scrollTop += step;

      root.dispatchEvent(
        new WheelEvent('wheel', { deltaY: step, bubbles: true, cancelable: true })
      );

      // Scroll event'i de fırlat
      root.dispatchEvent(new Event('scroll', { bubbles: true }));
    } catch (err) {
      logger.warn('Scanner', 'performScroll error', err);
    }
  }

  private async recoverStuck(level: number, aggressive: boolean): Promise<void> {
    if (!this.isScanning) return;
    const root = this.scrollRoot || this.findScrollRoot();
    this.scrollRoot = root;
    logger.log('Scanner', `Recovery L${level} aggressive=${aggressive}`, this.collectedUsers.size);

    try {
      this.clickRetryIfPresent();

      // L1: alta zıpla + bekle
      root.scrollTop = root.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
      await this.wait(aggressive ? 2000 : 1200);
      this.collectFromDom();
      if (!this.isScanning) return;

      // L2: yukarı çık, tekrar in
      if (level >= 2) {
        const up = Math.max(0, root.scrollTop - root.clientHeight * 3);
        root.scrollTop = up;
        await this.wait(700);
        for (let i = 0; i < 6 && this.isScanning; i++) {
          root.scrollTop += root.clientHeight * 0.8;
          await this.wait(400);
          this.collectFromDom();
        }
        root.scrollTop = root.scrollHeight;
        await this.wait(1500);
      }

      // L3: klavye
      if (level >= 3) {
        const t = document.body;
        for (let i = 0; i < 8 && this.isScanning; i++) {
          t.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'PageDown', code: 'PageDown', bubbles: true })
          );
          await this.wait(350);
          this.collectFromDom();
        }
        t.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'End', code: 'End', bubbles: true })
        );
        root.scrollTop = root.scrollHeight;
        await this.wait(2000);
      }

      // L4+: uzun rate-limit molası
      if (level >= 4) {
        const pause = aggressive ? Math.min(45000, 10000 + level * 4000) : 8000;
        await this.wait(pause);
        this.clickRetryIfPresent();
        root.scrollTop = root.scrollHeight;
        await this.wait(2000);
        // Küçük rastgele yukarı-aşağı
        root.scrollTop = Math.max(0, root.scrollTop - 600);
        await this.wait(500);
        root.scrollTop = root.scrollHeight;
        await this.wait(1500);
      }

      // L6+: sayfayı hafif "salla"
      if (level >= 6) {
        for (let i = 0; i < 10 && this.isScanning; i++) {
          root.scrollTop = Math.max(0, root.scrollHeight - root.clientHeight - i * 200);
          await this.wait(300);
          root.scrollTop = root.scrollHeight;
          await this.wait(500);
          this.collectFromDom();
        }
      }
    } catch (err) {
      logger.warn('Scanner', 'recoverStuck error', err);
    }
  }

  private clickRetryIfPresent(): void {
    const nodes = Array.from(
      document.querySelectorAll('div[role="button"], button, span')
    );
    for (const btn of nodes) {
      const t = (btn.textContent || '').trim().toLowerCase();
      if (
        t === 'retry' ||
        t === 'try again' ||
        t === 'yeniden dene' ||
        t === 'tekrar dene' ||
        t === 'reload' ||
        (t.includes('retry') && t.length < 40)
      ) {
        (btn as HTMLElement).click();
        logger.log('Scanner', 'Clicked retry');
        return;
      }
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
