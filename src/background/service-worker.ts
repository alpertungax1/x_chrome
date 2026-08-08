/**
 * Tarama sürücüsü service worker'da.
 * Content script arka planda donasa bile executeScript ile scroll + scrape yapılır.
 */
console.log('Background service worker initialized.');

const dashboardPorts = new Set<chrome.runtime.Port>();
const scanPorts = new Set<chrome.runtime.Port>();

interface ScrapedUser {
  id: string;
  username: string;
  displayName: string;
  isFollowing: boolean;
  isFollower: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  avatarUrl?: string;
}

interface ActiveScan {
  tabId: number;
  scanId: string;
  users: Map<string, ScrapedUser>;
  startedAt: number;
  lastGrowthAt: number;
  lastCount: number;
  tick: number;
  expected: number | null;
  recovery: number;
  pageHint: 'following' | 'followers' | 'unknown';
  finishing: boolean;
  lastRecoveryAt: number;
}

let active: ActiveScan | null = null;
let scanTickTimer: ReturnType<typeof setInterval> | null = null;
let swKeepAliveTimer: ReturnType<typeof setInterval> | null = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'dashboard') {
    dashboardPorts.add(port);
    port.onDisconnect.addListener(() => dashboardPorts.delete(port));
    return;
  }
  if (port.name === 'scan-worker') {
    scanPorts.add(port);
    if (active) ensureScanDriver();
    port.onDisconnect.addListener(() => scanPorts.delete(port));
  }
});

function broadcastToDashboards(message: object) {
  for (const port of dashboardPorts) {
    try {
      port.postMessage(message);
    } catch {
      dashboardPorts.delete(port);
    }
  }
}

function formatProgressText(payload: {
  foundUsersCount?: number;
  debug?: string;
} | null): string {
  if (!payload || payload.foundUsersCount == null) return '';
  const debug = payload.debug ? ` | ${payload.debug}` : '';
  return `Tarama sürüyor... Bulunan: ${payload.foundUsersCount}${debug}`;
}

async function pushLiveProgressToDashboards(
  payload: { foundUsersCount?: number; debug?: string } | null,
  mode: 'progress' | 'clear' = 'progress'
) {
  const text = mode === 'clear' ? '' : formatProgressText(payload);
  const count =
    mode === 'clear' || payload?.foundUsersCount == null ? null : payload.foundUsersCount;

  if (mode === 'clear') {
    void chrome.action.setBadgeText({ text: '' });
  } else if (typeof count === 'number') {
    void chrome.action.setBadgeText({ text: count > 999 ? '999+' : String(count) });
    void chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  }

  if (mode === 'progress') {
    broadcastToDashboards({ type: 'SCAN_PROGRESS', payload });
  }

  const extPrefix = `chrome-extension://${chrome.runtime.id}/`;
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }

  const dashTabs = tabs.filter(
    (t) =>
      !!t.id &&
      !!t.url &&
      t.url.startsWith(extPrefix) &&
      (t.url.includes('index.html') || t.url.endsWith('/') || t.url.includes('src/'))
  );

  await Promise.all(
    dashTabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: (statusText: string, n: number | null) => {
            const bar = document.getElementById('xrm-scan-live');
            if (!bar) return;
            if (!statusText) {
              bar.style.display = 'none';
              bar.textContent = '';
              document.body.classList.remove('xrm-scanning');
              if (document.title.startsWith('Tarama')) {
                document.title = 'X Relationship Manager';
              }
            } else {
              bar.style.display = 'block';
              bar.textContent = statusText;
              document.body.classList.add('xrm-scanning');
              if (n != null) document.title = `Tarama (${n}) · X Manager`;
            }
            window.dispatchEvent(
              new CustomEvent('xrm-scan-progress', {
                detail: { text: statusText, count: n },
              })
            );
          },
          args: [text, count],
        });
      } catch {
        // ignore
      }
    })
  );
}

/**
 * Sayfada bir tur: kullanıcıları scrape et + kaydır.
 * Self-contained — inject edilebilir, dış scope yok.
 */
function scrapeAndScrollInPage(): {
  users: ScrapedUser[];
  expected: number | null;
  cellCount: number;
  scrollHeight: number;
  href: string;
} {
  const skip = new Set([
    'home', 'explore', 'search', 'notifications', 'messages', 'settings', 'i',
    'compose', 'following', 'followers', 'verified_followers', 'likes', 'lists',
    'communities', 'premium', 'jobs', 'connect', 'intent', 'hashtag', 'tos',
    'privacy', 'login', 'signup', 'logout', 'grok', 'bookmarks', 'topics',
    'status', 'photo', 'header_photo',
  ]);

  const path = location.pathname.toLowerCase();
  const pageFollowing = path.includes('/following');
  const pageFollowers = path.includes('/followers');

  function parseCount(raw: string): number | null {
    let s = raw.trim().replace(/\s/g, '');
    const k = s.match(/^([\d.,]+)([KkMm])$/);
    if (k) {
      let n = parseFloat(k[1].replace(',', '.'));
      if (k[2].toUpperCase() === 'K') n *= 1000;
      if (k[2].toUpperCase() === 'M') n *= 1_000_000;
      return Math.round(n);
    }
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return parseInt(s.replace(/[.,]/g, ''), 10);
    s = s.replace(/[^\d]/g, '');
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  }

  function readExpected(): number | null {
    const primary =
      document.querySelector('[data-testid="primaryColumn"]') || document.body;
    const text = primary.textContent || '';
    const patterns = [
      /([\d.,\s]+)\s*Following\b/i,
      /([\d.,\s]+)\s*Takip\s*edilen/i,
      /([\d.,\s]+)\s*Followers\b/i,
      /([\d.,\s]+)\s*Takipçi/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      const label = m[0].toLowerCase();
      if (pageFollowing && label.includes('follower') && !label.includes('following')) continue;
      if (pageFollowers && label.includes('following') && !label.includes('follower')) continue;
      const n = parseCount(m[1]);
      if (n != null && n >= 1 && n < 50_000_000) return n;
    }
    return null;
  }

  const now = Date.now();
  const found = new Map<string, ScrapedUser>();
  const cells = document.querySelectorAll('[data-testid="UserCell"]');

  cells.forEach((cell) => {
    const links = cell.querySelectorAll('a[href]');
    let username = '';
    for (const link of Array.from(links)) {
      const href = (link as HTMLAnchorElement).getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (m && !skip.has(m[1].toLowerCase())) {
        username = m[1];
        break;
      }
    }
    if (!username) return;
    const id = username.toLowerCase();
    if (found.has(id)) return;

    let displayName = username;
    const nameSpan = cell.querySelector(`a[href="/${username}"] div[dir="auto"] span`);
    if (nameSpan?.textContent) displayName = nameSpan.textContent.trim();

    const inner = (cell as HTMLElement).innerText || '';
    const isFollower =
      pageFollowers ||
      inner.includes('Follows you') ||
      inner.includes('Seni takip ediyor');
    const unfollowBtn = cell.querySelector('[data-testid$="-unfollow"]');
    const isFollowing = pageFollowing || Boolean(unfollowBtn);

    const avatarImg = cell.querySelector(
      'img[src*="profile_images"]'
    ) as HTMLImageElement | null;

    found.set(id, {
      id,
      username,
      displayName,
      isFollowing,
      isFollower,
      avatarUrl: avatarImg?.src,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  });

  // Scroll
  const step = 1400;
  if (cells.length > 0) {
    const last = cells[cells.length - 1] as HTMLElement;
    last.scrollIntoView({ behavior: 'auto', block: 'end' });
    for (let i = Math.max(0, cells.length - 8); i < cells.length; i++) {
      (cells[i] as HTMLElement).scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
    last.scrollIntoView({ behavior: 'auto', block: 'end' });

    let el: HTMLElement | null = (cells[0] as HTMLElement).parentElement;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 40) {
        el.scrollTop += step;
        break;
      }
      el = el.parentElement;
    }
  }

  const se = document.scrollingElement || document.documentElement;
  se.scrollTop += step;
  window.scrollBy(0, step);
  se.dispatchEvent(new Event('scroll', { bubbles: true }));
  window.dispatchEvent(
    new WheelEvent('wheel', { deltaY: step, bubbles: true, cancelable: true })
  );

  // Retry butonu
  const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
  for (const btn of buttons) {
    const t = (btn.textContent || '').trim().toLowerCase();
    if (t === 'retry' || t === 'try again' || t === 'yeniden dene' || t === 'tekrar dene') {
      (btn as HTMLElement).click();
      break;
    }
  }

  // Agresif recovery: ara sıra alta zıpla
  if (Math.random() < 0.15) {
    se.scrollTop = se.scrollHeight;
  }

  return {
    users: Array.from(found.values()),
    expected: readExpected(),
    cellCount: cells.length,
    scrollHeight: se.scrollHeight,
    href: location.href,
  };
}

/** Takılınca daha agresif scroll */
function aggressiveRecoverInPage() {
  const se = document.scrollingElement || document.documentElement;
  const cells = document.querySelectorAll('[data-testid="UserCell"]');
  if (cells.length > 0) {
    (cells[cells.length - 1] as HTMLElement).scrollIntoView({
      behavior: 'auto',
      block: 'end',
    });
  }
  const mid = Math.max(0, se.scrollTop - se.clientHeight * 2);
  se.scrollTop = mid;
  window.scrollTo(0, mid);
  // sonra alta
  se.scrollTop = se.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'End', code: 'End', bubbles: true })
  );
  for (let i = 0; i < 5; i++) {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'PageDown', code: 'PageDown', bubbles: true })
    );
  }
}

function ensureScanDriver() {
  if (scanTickTimer != null) return;

  if (swKeepAliveTimer == null) {
    swKeepAliveTimer = setInterval(() => {
      void chrome.storage.local.get(['activeScanId']);
    }, 15000);
  }

  // 700ms — arka planda da SW timer çalışır
  scanTickTimer = setInterval(() => {
    void runScanTick();
  }, 700);

  void runScanTick();
}

function stopScanDriver(clearActive = true) {
  if (scanTickTimer != null) {
    clearInterval(scanTickTimer);
    scanTickTimer = null;
  }
  if (swKeepAliveTimer != null) {
    clearInterval(swKeepAliveTimer);
    swKeepAliveTimer = null;
  }
  if (clearActive) active = null;
}

async function publishProgress(debug: string) {
  if (!active) return;
  const payload = {
    scanId: active.scanId,
    foundUsersCount: active.users.size,
    debug,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({
    scanProgress: payload,
    scanStatus: 'running',
    activeScanId: active.scanId,
  });
  await pushLiveProgressToDashboards(payload, 'progress');
}

async function completeScan(status: 'completed' | 'cancelled' | 'error', error?: string) {
  if (!active || active.finishing) return;
  active.finishing = true;
  const scanId = active.scanId;
  const users = Array.from(active.users.values());
  const result = {
    status,
    scanId,
    users: status === 'error' ? [] : users,
    error,
    completedAt: Date.now(),
    abortedByUser: status === 'cancelled',
  };

  console.log(`Scan ${status}: ${users.length} users (scanId=${scanId})`);

  stopScanDriver(true);

  await chrome.storage.local.set({
    scanProgress: null,
    scanStatus: status,
    scanResult: result,
    activeScanId: null,
  });

  if (status === 'completed') {
    await pushLiveProgressToDashboards(null, 'clear');
    broadcastToDashboards({ type: 'SCAN_COMPLETED', payload: { users, scanId } });
  } else if (status === 'error') {
    void chrome.action.setBadgeText({ text: '!' });
    await pushLiveProgressToDashboards(null, 'clear');
  } else {
    await pushLiveProgressToDashboards(null, 'clear');
  }
}

async function runScanTick() {
  if (!active || active.finishing) return;
  const { tabId } = active;
  active.tick++;

  let pageResult: {
    users: ScrapedUser[];
    expected: number | null;
    cellCount: number;
    scrollHeight: number;
    href: string;
  } | null = null;

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: scrapeAndScrollInPage,
    });
    pageResult = injected?.[0]?.result ?? null;
  } catch (err) {
    console.warn('Scan tick inject failed', err);
    // sekme kapandıysa bitir
    if (active.tick > 10 && active.users.size === 0) {
      await completeScan('error', 'Tarama sekmesine erişilemedi (kapandı mı?)');
    }
    return;
  }

  if (!pageResult || !active) return;

  // Kullanıcıları birleştir
  let added = 0;
  for (const u of pageResult.users) {
    if (!active.users.has(u.id)) {
      active.users.set(u.id, u);
      added++;
    } else {
      const prev = active.users.get(u.id)!;
      active.users.set(u.id, {
        ...prev,
        ...u,
        isFollowing: prev.isFollowing || u.isFollowing,
        isFollower: prev.isFollower || u.isFollower,
      });
    }
  }

  if (pageResult.expected != null) {
    active.expected = pageResult.expected;
  }

  if (active.users.size > active.lastCount) {
    active.lastCount = active.users.size;
    active.lastGrowthAt = Date.now();
    active.recovery = 0;
  }

  const expected = active.expected;
  const ratio = expected && expected > 0 ? active.users.size / expected : null;
  const noGrowthMs = Date.now() - active.lastGrowthAt;
  const elapsedMin = Math.round((Date.now() - active.startedAt) / 60000);

  const pct = ratio != null ? `${Math.round(ratio * 100)}%` : '?';
  const debug = `SW#${active.tick} | +${added} | DOM:${pageResult.cellCount} | hedef:${expected ?? '?'} | ${pct} | durgun:${Math.round(noGrowthMs / 1000)}s | ${elapsedMin}dk`;

  // Progress'i her 2 tick'te bir yaz (storage kotası)
  if (added > 0 || active.tick % 2 === 0) {
    await publishProgress(debug);
  }

  // Content overlay için mesaj (opsiyonel)
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'SCAN_OVERLAY',
      payload: { text: `Bulunan: ${active.users.size} | ${debug}` },
    });
  } catch {
    // donmuş olabilir — sorun değil
  }

  // —— Bitiş koşulları ——
  // 1) Hedefin %98'i
  if (expected && expected >= 20 && active.users.size >= expected * 0.98) {
    // bir kaç tick daha
    if (noGrowthMs > 8000) {
      await completeScan('completed');
      return;
    }
  }

  // 2) Hard deadline 3 saat (7500+ için)
  if (Date.now() - active.startedAt > 3 * 60 * 60 * 1000) {
    await completeScan('completed');
    return;
  }

  // 3) Durgunluk — hedefin altındaysak çok sabırlı
  // ÖNEMLİ: recovery her tick artmamalı; en az 45 sn arayla
  const belowTarget =
    expected != null && expected > 50 && active.users.size < expected * 0.95;

  const stagnantThreshold = belowTarget ? 90_000 : 50_000;
  const sinceRecovery = Date.now() - active.lastRecoveryAt;

  if (noGrowthMs > stagnantThreshold && sinceRecovery > 45_000) {
    active.recovery++;
    active.lastRecoveryAt = Date.now();
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: aggressiveRecoverInPage,
      });
    } catch {
      // ignore
    }
    await publishProgress(
      `Kurtarma #${active.recovery}… | ${active.users.size}/${expected ?? '?'}`
    );

    // rate-limit molası
    if (active.recovery >= 2) {
      const pause = Math.min(40000, 10000 + active.recovery * 4000);
      await new Promise((r) => setTimeout(r, pause));
    }
  }

  // Yeterince kurtarma + uzun durgunluk → bitir (kısmi sonuç kaydedilir)
  const minRecoveries = belowTarget ? 12 : 8;
  const minStagnant = belowTarget ? 5 * 60_000 : 3 * 60_000;
  if (active.recovery >= minRecoveries && noGrowthMs > minStagnant) {
    console.log(
      `Scan stop stagnant: found=${active.users.size} expected=${expected} recovery=${active.recovery}`
    );
    await completeScan('completed');
  }
}

function beginScanSession(tabId: number, scanId: string, pageHint?: string) {
  // Önceki taramayı temiz kapatma (yarım)
  if (active && !active.finishing) {
    console.warn('Replacing active scan session');
  }
  stopScanDriver(true);

  active = {
    tabId,
    scanId,
    users: new Map(),
    startedAt: Date.now(),
    lastGrowthAt: Date.now(),
    lastCount: 0,
    tick: 0,
    expected: null,
    recovery: 0,
    pageHint:
      pageHint === 'following' || pageHint === 'followers' ? pageHint : 'unknown',
    finishing: false,
    lastRecoveryAt: 0,
  };

  ensureScanDriver();
  console.log('SW scan session begin', { tabId, scanId, pageHint });
  void publishProgress('SW tarama sürücüsü başladı…');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SCAN_SESSION_BEGIN') {
    const tabId = sender.tab?.id ?? message.payload?.tabId;
    const scanId = message.payload?.scanId || `scan_${Date.now()}`;
    if (typeof tabId === 'number') {
      beginScanSession(tabId, scanId, message.payload?.pageHint);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'SCAN_SESSION_END' || message?.type === 'SCAN_STOP') {
    if (active && !active.finishing) {
      void completeScan('cancelled');
    } else {
      stopScanDriver(true);
    }
    sendResponse({ ok: true });
    return false;
  }

  // Content script hâlâ progress gönderebilir (yedek)
  if (message?.type === 'SCAN_PROGRESS' && message.payload) {
    // SW biriktiricisine de ekle
    if (active && Array.isArray(message.payload.users)) {
      // ignore bulk
    }
    void pushLiveProgressToDashboards(message.payload, 'progress');
    return false;
  }

  // Content'in kendi complete'i — SW zaten yönetiyorsa yoksay / birleştir
  if (message?.type === 'SCAN_COMPLETED') {
    if (active && !active.finishing) {
      // Content erken bittiyse kullanıcıları birleştir, SW devam etsin (hedef altındaysa)
      const users = message.payload?.users || [];
      for (const u of users) {
        const id = (u.id || u.username || '').toLowerCase();
        if (!id) continue;
        if (!active.users.has(id)) {
          active.users.set(id, {
            id,
            username: u.username || id,
            displayName: u.displayName || u.username || id,
            isFollowing: Boolean(u.isFollowing),
            isFollower: Boolean(u.isFollower),
            firstSeenAt: u.firstSeenAt || Date.now(),
            lastSeenAt: Date.now(),
            avatarUrl: u.avatarUrl,
          });
        }
      }
      if (active.users.size > active.lastCount) {
        active.lastCount = active.users.size;
        active.lastGrowthAt = Date.now();
      }
      // SW bitişine bırak — content complete scanResult yazmasın diye storage'a dokunma
      sendResponse({ ok: true, takenOver: true });
      return false;
    }
    void pushLiveProgressToDashboards(null, 'clear');
    broadcastToDashboards({ type: 'SCAN_COMPLETED', payload: message.payload });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'SCAN_ERROR') {
    if (!active) {
      void chrome.action.setBadgeText({ text: '!' });
      void pushLiveProgressToDashboards(null, 'clear');
    }
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // Dashboard abort: scanResult cancelled abortedByUser
  if (changes.scanResult?.newValue?.abortedByUser && active && !active.finishing) {
    void completeScan('cancelled');
  }
});
