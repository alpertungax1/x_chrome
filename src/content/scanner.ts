import { parseUserFromElement } from './parser';
import { logger } from '../utils/logger';
import { XUser } from '../types/user';

interface ScanProgress {
  count: number;
  lastUsername?: string;
  debug?: string;
}

export class XScanner {
  private isScanning = false;
  private collectedUsers = new Map<string, Partial<XUser>>();

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
    this.collectedUsers.clear();
    logger.log('Scanner', '=== SCAN STARTED ===', location.href);

    // Liste DOM'unun gelmesini bekle
    const ready = await this.waitForUserCells(15000);
    if (!this.isScanning) {
      return { users: Array.from(this.collectedUsers.values()), stopped: true };
    }

    onProgress({
      count: 0,
      debug: ready
        ? `Liste hazır (${document.querySelectorAll('[data-testid="UserCell"]').length} hücre)`
        : 'UserCell henüz yok — yine de taranıyor',
    });

    let consecutiveNoNewUsers = 0;
    const MAX_CONSECUTIVE_EMPTY = 60; // ~60 * 700ms ≈ 42 sn
    let lastProgressReport = 0;
    let scrollIteration = 0;

    while (this.isScanning) {
      scrollIteration++;

      const cellsInDOM = document.querySelectorAll('[data-testid="UserCell"]').length;
      const usersFoundThisRound = this.scanCurrentPage();

      let newCount = 0;
      for (const user of usersFoundThisRound) {
        if (user.id && !this.collectedUsers.has(user.id)) {
          this.collectedUsers.set(user.id, user);
          newCount++;
        }
      }

      if (newCount > 0) {
        consecutiveNoNewUsers = 0;
      } else {
        consecutiveNoNewUsers++;
      }

      const now = Date.now();
      if (now - lastProgressReport > 1000 || newCount > 0) {
        lastProgressReport = now;
        onProgress({
          count: this.collectedUsers.size,
          debug: `Scroll#${scrollIteration} | DOM: ${cellsInDOM} | +${newCount} | boş: ${consecutiveNoNewUsers}/${MAX_CONSECUTIVE_EMPTY}`,
        });
      }

      if (consecutiveNoNewUsers >= MAX_CONSECUTIVE_EMPTY) {
        break;
      }

      this.performScroll();
      await this.wait(700);
    }

    // stopScan çağrıldıysa isScanning false; bayrak ile ayırt et
    const wasStopped = this._stopRequested;
    this._stopRequested = false;
    this.isScanning = false;

    onProgress({
      count: this.collectedUsers.size,
      debug: wasStopped ? 'Tarama durduruldu.' : 'Tarama tamamlandı.',
    });
    logger.log(
      'Scanner',
      `=== SCAN ${wasStopped ? 'STOPPED' : 'FINISHED'} === Total: ${this.collectedUsers.size}`
    );
    return {
      users: Array.from(this.collectedUsers.values()),
      stopped: wasStopped,
    };
  }

  private _stopRequested = false;

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
      // SPA geçişlerinde biraz kaydırarak tetikle
      window.scrollBy(0, 200);
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

  private performScroll(): void {
    try {
      const cells = document.querySelectorAll('[data-testid="UserCell"]');

      // 1) Son hücreye kaydır (virtualized list)
      if (cells.length > 0) {
        const lastCell = cells[cells.length - 1] as HTMLElement;
        lastCell.scrollIntoView({ behavior: 'auto', block: 'end' });
      }

      // 2) Window
      window.scrollBy(0, 800);

      // 3) scrollingElement
      const scrollingEl = document.scrollingElement;
      if (scrollingEl) {
        scrollingEl.scrollTop += 800;
      }

      // 4) Scroll parent
      if (cells.length > 0) {
        let parent = cells[0].parentElement;
        while (parent && parent !== document.body) {
          if (parent.scrollHeight > parent.clientHeight + 50) {
            parent.scrollTop += 800;
            break;
          }
          parent = parent.parentElement;
        }
      }

      // 5) primaryColumn içindeki scrollable
      const primary =
        document.querySelector('[data-testid="primaryColumn"]') ||
        document.querySelector('main[role="main"]');
      if (primary) {
        let el: HTMLElement | null = primary as HTMLElement;
        while (el && el !== document.body) {
          if (el.scrollHeight > el.clientHeight + 50) {
            el.scrollTop += 800;
            break;
          }
          el = el.parentElement;
        }
      }
    } catch (err) {
      logger.warn('Scanner', 'performScroll error', err);
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
