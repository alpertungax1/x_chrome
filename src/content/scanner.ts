import { parseUserFromElement } from './parser';
import { logger } from '../utils/logger';
import { XUser } from '../types/user';

interface ScanProgress {
  count: number;
  lastUsername?: string;
  debug?: string;
}

/**
 * X following/followers sanal listesini agresif kaydırarak tarar.
 * 5k–10k+ listelerde erken kesilmemesi için:
 * - uzun "boş" toleransı
 * - doğru scroll container
 * - takılınca kurtarma (alta zıpla, yukarı-aşağı, End tuşu)
 * - yavaş ağda bekleme backoff
 */
export class XScanner {
  private isScanning = false;
  private collectedUsers = new Map<string, Partial<XUser>>();
  private _stopRequested = false;
  private scrollRoot: HTMLElement | null = null;

  public async startScan(onProgress: (progress: ScanProgress) => void): Promise<{
    users: Partial<XUser>[];
    stopped: boolean;
  }> {
    if (this.isScanning) {
      logger.warn('Scanner', 'Previous scan still running — stopping it first');
      this.isScanning = false;
      await this.wait(300);
    }

    this.isScanning = true;
    this._stopRequested = false;
    this.collectedUsers.clear();
    this.scrollRoot = null;
    logger.log('Scanner', '=== SCAN STARTED ===', location.href);

    const ready = await this.waitForUserCells(20000);
    if (!this.isScanning) {
      return this.finish(true, onProgress);
    }

    this.scrollRoot = this.findScrollRoot();
    onProgress({
      count: 0,
      debug: ready
        ? `Liste hazır | scroll=${this.describeRoot(this.scrollRoot)}`
        : 'UserCell yok — taranıyor',
    });

    let consecutiveNoNewUsers = 0;
    // ~150 * ~0.6–1.5s ≈ 2–4 dk hiç yeni kullanıcı gelmezse dur
    // (büyük listelerde ara ara X yavaşlar; 42 sn çok kısaydı)
    const MAX_CONSECUTIVE_EMPTY = 150;
    let lastProgressReport = 0;
    let scrollIteration = 0;
    let lastCount = 0;
    let stagnantRounds = 0;
    let lastScrollHeight = 0;
    let recoveryLevel = 0;

    while (this.isScanning) {
      scrollIteration++;

      // Her 25 iterasyonda scroll root'u yeniden bul (SPA layout değişebilir)
      if (scrollIteration % 25 === 0 || !this.scrollRoot?.isConnected) {
        this.scrollRoot = this.findScrollRoot();
      }

      const cellsInDOM = document.querySelectorAll('[data-testid="UserCell"]').length;
      const usersFoundThisRound = this.scanCurrentPage();

      let newCount = 0;
      for (const user of usersFoundThisRound) {
        if (user.id && !this.collectedUsers.has(user.id)) {
          this.collectedUsers.set(user.id, user);
          newCount++;
        }
      }

      // Link tabanlı ek toplama (UserCell parse kaçırırsa)
      const extra = this.scanProfileLinksInTimeline();
      for (const user of extra) {
        if (user.id && !this.collectedUsers.has(user.id)) {
          this.collectedUsers.set(user.id, user);
          newCount++;
        }
      }

      if (newCount > 0) {
        consecutiveNoNewUsers = 0;
        recoveryLevel = 0;
        stagnantRounds = 0;
      } else {
        consecutiveNoNewUsers++;
      }

      if (this.collectedUsers.size === lastCount) {
        stagnantRounds++;
      } else {
        stagnantRounds = 0;
        lastCount = this.collectedUsers.size;
      }

      const root = this.scrollRoot;
      const scrollHeight = root?.scrollHeight ?? 0;
      const scrollGrew = scrollHeight > lastScrollHeight + 20;
      if (scrollGrew) lastScrollHeight = scrollHeight;

      const now = Date.now();
      if (now - lastProgressReport > 800 || newCount > 0) {
        lastProgressReport = now;
        onProgress({
          count: this.collectedUsers.size,
          debug: `Scroll#${scrollIteration} | DOM:${cellsInDOM} | +${newCount} | boş:${consecutiveNoNewUsers}/${MAX_CONSECUTIVE_EMPTY} | sh:${scrollHeight}`,
        });
      }

      // "Retry" / hata paneli varsa tıkla
      this.clickRetryIfPresent();

      if (consecutiveNoNewUsers >= MAX_CONSECUTIVE_EMPTY) {
        // Son bir kurtarma denemesi
        if (recoveryLevel < 4) {
          recoveryLevel++;
          await this.recoverStuck(recoveryLevel);
          consecutiveNoNewUsers = Math.floor(MAX_CONSECUTIVE_EMPTY * 0.6);
          continue;
        }
        break;
      }

      // Takılma: bir süre yeni yoksa kademeli kurtarma
      if (consecutiveNoNewUsers > 0 && consecutiveNoNewUsers % 20 === 0) {
        recoveryLevel = Math.min(4, recoveryLevel + 1);
        await this.recoverStuck(recoveryLevel);
      } else {
        this.performScroll(consecutiveNoNewUsers);
      }

      // Yeni kullanıcı yoksa daha uzun bekle (ağ / rate limit)
      const delay =
        newCount > 0
          ? 350
          : scrollGrew
            ? 600
            : Math.min(2200, 500 + consecutiveNoNewUsers * 40);
      await this.wait(delay);
    }

    return this.finish(this._stopRequested, onProgress);
  }

  private finish(
    stopped: boolean,
    onProgress: (progress: ScanProgress) => void
  ): { users: Partial<XUser>[]; stopped: boolean } {
    this._stopRequested = false;
    this.isScanning = false;
    onProgress({
      count: this.collectedUsers.size,
      debug: stopped ? 'Tarama durduruldu.' : `Tarama tamamlandı (${this.collectedUsers.size}).`,
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

  private async waitForUserCells(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs && this.isScanning) {
      if (document.querySelectorAll('[data-testid="UserCell"]').length > 0) {
        return true;
      }
      window.scrollBy(0, 300);
      this.performScroll(0);
      await this.wait(400);
    }
    return false;
  }

  private scanCurrentPage(): Partial<XUser>[] {
    const userCells = document.querySelectorAll('[data-testid="UserCell"]');
    const users: Partial<XUser>[] = [];
    userCells.forEach((cell) => {
      const user = parseUserFromElement(cell as HTMLElement);
      if (user) users.push(user);
    });
    return users;
  }

  /**
   * Timeline içindeki profil linklerinden kullanıcı topla (UserCell parse yedek).
   */
  private scanProfileLinksInTimeline(): Partial<XUser>[] {
    const root =
      document.querySelector('[data-testid="primaryColumn"]') ||
      document.querySelector('main[role="main"]') ||
      document.body;

    const links = root.querySelectorAll('a[href^="/"]');
    const skip = new Set([
      'home',
      'explore',
      'search',
      'notifications',
      'messages',
      'settings',
      'i',
      'compose',
      'following',
      'followers',
      'verified_followers',
      'likes',
      'lists',
      'communities',
      'premium',
      'jobs',
      'connect',
      'intent',
      'hashtag',
      'tos',
      'privacy',
      'login',
      'signup',
      'logout',
      'grok',
      'bookmarks',
      'topics',
    ]);

    const found = new Map<string, Partial<XUser>>();
    const pageIsFollowing = /\/following\/?$/i.test(location.pathname);
    const pageIsFollowers = /\/followers|verified_followers\/?$/i.test(location.pathname);

    for (const a of Array.from(links)) {
      const href = (a as HTMLAnchorElement).getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$|\?)/);
      if (!m) continue;
      const username = m[1];
      if (skip.has(username.toLowerCase())) continue;
      // Sadece UserCell içindeki veya cell yakınındaki linkler
      const cell = (a as HTMLElement).closest('[data-testid="UserCell"]');
      if (!cell) continue;

      const id = username.toLowerCase();
      if (found.has(id) || this.collectedUsers.has(id)) continue;

      const displayName =
        cell.querySelector('div[dir="auto"] span')?.textContent?.trim() || username;

      found.set(id, {
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

    return Array.from(found.values());
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
        // X bazen overflow gizli tutar ama yine de scroll edilebilir
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
    const tag = root.tagName.toLowerCase();
    const testid = root.getAttribute('data-testid') || '';
    return `${tag}${testid ? '#' + testid : ''} sh=${root.scrollHeight}`;
  }

  private performScroll(emptyStreak: number): void {
    try {
      const root = this.scrollRoot || this.findScrollRoot();
      this.scrollRoot = root;
      const cells = document.querySelectorAll('[data-testid="UserCell"]');
      const step = emptyStreak > 10 ? 1400 : emptyStreak > 5 ? 1100 : 900;

      // 1) Son hücreye scrollIntoView — virtualized list tetikleyici
      if (cells.length > 0) {
        const last = cells[cells.length - 1] as HTMLElement;
        last.scrollIntoView({ behavior: 'auto', block: 'end' });
        // Birkaç hücre geriye de dokun (intersection observer)
        const mid = cells[Math.max(0, cells.length - 5)] as HTMLElement;
        mid?.scrollIntoView({ behavior: 'auto', block: 'nearest' });
      }

      // 2) Scroll root
      const before = root.scrollTop;
      root.scrollTop = Math.min(root.scrollTop + step, root.scrollHeight);
      if (root.scrollTop === before) {
        // takıldıysa doğrudan alta
        root.scrollTop = root.scrollHeight;
      }

      // 3) Window yedek
      window.scrollBy(0, step);
      const se = document.scrollingElement;
      if (se && se !== root) {
        se.scrollTop += step;
      }

      // 4) Wheel event (bazı virtual list'ler bunu dinler)
      root.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: step,
          bubbles: true,
          cancelable: true,
        })
      );

      // 5) primaryColumn alt ağacı
      const primary = document.querySelector('[data-testid="primaryColumn"]') as HTMLElement | null;
      if (primary && primary !== root) {
        let el: HTMLElement | null = primary;
        while (el && el !== document.body) {
          if (el.scrollHeight > el.clientHeight + 50) {
            el.scrollTop += step;
            break;
          }
          el = el.parentElement;
        }
      }
    } catch (err) {
      logger.warn('Scanner', 'performScroll error', err);
    }
  }

  /** Takılınca kademeli kurtarma */
  private async recoverStuck(level: number): Promise<void> {
    if (!this.isScanning) return;
    const root = this.scrollRoot || this.findScrollRoot();
    this.scrollRoot = root;
    logger.log('Scanner', `Recovery level ${level}`, this.collectedUsers.size);

    try {
      if (level >= 1) {
        // Alta zıpla
        root.scrollTop = root.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
        await this.wait(1200);
      }
      if (level >= 2 && this.isScanning) {
        // Yukarı çıkıp tekrar in (virtual list yenile)
        const mid = Math.max(0, root.scrollTop - root.clientHeight * 2);
        root.scrollTop = mid;
        await this.wait(600);
        root.scrollTop = root.scrollHeight;
        await this.wait(1200);
      }
      if (level >= 3 && this.isScanning) {
        // Klavye: PageDown / End
        const target = (document.activeElement as HTMLElement) || document.body;
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'PageDown', code: 'PageDown', bubbles: true })
        );
        await this.wait(400);
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'End', code: 'End', bubbles: true })
        );
        root.scrollTop = root.scrollHeight;
        await this.wait(1500);
      }
      if (level >= 4 && this.isScanning) {
        // Son hücreyi tekrar görünür kıl + uzun bekle
        const cells = document.querySelectorAll('[data-testid="UserCell"]');
        if (cells.length > 0) {
          (cells[cells.length - 1] as HTMLElement).scrollIntoView({
            behavior: 'auto',
            block: 'center',
          });
        }
        this.clickRetryIfPresent();
        await this.wait(2500);
        root.scrollTop = root.scrollHeight;
        await this.wait(1500);
      }
    } catch (err) {
      logger.warn('Scanner', 'recoverStuck error', err);
    }
  }

  private clickRetryIfPresent(): void {
    const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
    for (const btn of buttons) {
      const t = (btn.textContent || '').trim().toLowerCase();
      if (
        t === 'retry' ||
        t === 'try again' ||
        t === 'yeniden dene' ||
        t === 'tekrar dene' ||
        t.includes('something went wrong') ||
        t.includes('bir hata oluştu')
      ) {
        (btn as HTMLElement).click();
        logger.log('Scanner', 'Clicked retry button');
        break;
      }
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
