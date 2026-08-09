/**
 * Tarama sürücüsü — service worker.
 * Stabilite öncelikli: çift session yok, tick kilidi, yavaş tempo, reload yok.
 */
console.log('Background service worker initialized.');

const dashboardPorts = new Set<chrome.runtime.Port>();

interface ScrapedUser {
  id: string;
  username: string;
  displayName: string;
  isFollowing: boolean;
  isFollower: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  avatarUrl?: string;
  followersCount?: number;
  followingCount?: number;
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
  lastRecoveryAt: number;
  consecutiveInjectFails: number;
  finishing: boolean;
  tickRunning: boolean;
}

let active: ActiveScan | null = null;
let scanTickTimer: ReturnType<typeof setInterval> | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

/** Büyük listelerde storage kotası / donma için: tamamlanan tarama sonuçları bellek + port ile. */
const completedScanCache = new Map<
  string,
  {
    status: 'completed' | 'cancelled' | 'error';
    users: ScrapedUser[];
    error?: string;
    completedAt: number;
    abortedByUser?: boolean;
  }
>();

function slimUsers(users: ScrapedUser[]): ScrapedUser[] {
  // avatarUrl storage'ı şişirir (7.5k+ listede kota/donma) — DB için de gerekmez
  return users.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    isFollowing: u.isFollowing,
    isFollower: u.isFollower,
    firstSeenAt: u.firstSeenAt,
    lastSeenAt: u.lastSeenAt,
    ...(typeof u.followersCount === 'number'
      ? { followersCount: u.followersCount }
      : {}),
    ...(typeof u.followingCount === 'number'
      ? { followingCount: u.followingCount }
      : {}),
  }));
}

/**
 * X GraphQL yanıtlarından followers_count yakala.
 * Liste DOM'unda sayı yok; API yanıtında legacy.followers_count var.
 */
function installUserMetaHookInPage(): { ok: boolean; metaSize: number } {
  const w = window as Window & {
    __XRM_META__?: Record<
      string,
      { followersCount?: number; followingCount?: number; displayName?: string }
    >;
    __XRM_HOOK__?: boolean;
  };

  if (!w.__XRM_META__) w.__XRM_META__ = {};

  const ingest = (root: unknown) => {
    const walk = (node: unknown, depth: number) => {
      if (!node || depth > 40) return;
      if (typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      const obj = node as Record<string, unknown>;
      const legacy = obj.legacy as Record<string, unknown> | undefined;
      if (legacy && (typeof legacy.screen_name === 'string' || typeof legacy.screenName === 'string')) {
        const id = String(legacy.screen_name || legacy.screenName).toLowerCase();
        let fc = legacy.followers_count ?? legacy.followersCount;
        let fr = legacy.friends_count ?? legacy.friendsCount;
        if (typeof fc === 'string') fc = parseInt(fc, 10);
        if (typeof fr === 'string') fr = parseInt(fr, 10);
        
        if (typeof fc === 'number' || typeof fr === 'number') {
          const prev = w.__XRM_META__![id] || {};
          w.__XRM_META__![id] = {
            ...prev,
            ...(typeof fc === 'number' && !isNaN(fc) ? { followersCount: fc } : {}),
            ...(typeof fr === 'number' && !isNaN(fr) ? { followingCount: fr } : {}),
            ...(typeof legacy.name === 'string' ? { displayName: legacy.name } : {}),
          };
        }
      }
      
      const objFc = obj.followers_count ?? obj.followersCount;
      const objFr = obj.friends_count ?? obj.friendsCount;
      const objSn = obj.screen_name ?? obj.screenName;
      
      if (typeof objSn === 'string') {
        let fc = objFc;
        let fr = objFr;
        if (typeof fc === 'string') fc = parseInt(fc, 10);
        if (typeof fr === 'string') fr = parseInt(fr, 10);
        
        if (typeof fc === 'number' && !isNaN(fc)) {
          const id = String(objSn).toLowerCase();
          const prev = w.__XRM_META__![id] || {};
          w.__XRM_META__![id] = {
            ...prev,
            followersCount: fc,
            ...(typeof fr === 'number' && !isNaN(fr) ? { followingCount: fr } : {}),
          };
        }
      }
      for (const key of Object.keys(obj)) {
        // Çok büyük binary/string alanları atla
        if (key === 'profile_image_url_https' || key === 'description') continue;
        walk(obj[key], depth + 1);
      }
    };
    walk(root, 0);
  };

  if (!w.__XRM_HOOK__) {
    w.__XRM_HOOK__ = true;
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await origFetch(...args);
      try {
        const req = args[0];
        const url =
          typeof req === 'string'
            ? req
            : req instanceof Request
              ? req.url
              : String(req ?? '');
        if (
          /graphql|Followers|Following|UserBy|UserResult|BlueVerified/i.test(url)
        ) {
          const clone = res.clone();
          void clone
            .json()
            .then((data) => ingest(data))
            .catch(() => {});
        }
      } catch {
        // ignore
      }
      return res;
    };

    const XO = XMLHttpRequest.prototype.open;
    const XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      (this as XMLHttpRequest & { __xrmUrl?: string }).__xrmUrl = String(url);
      return XO.apply(this, [method, url, ...rest] as never);
    };
    XMLHttpRequest.prototype.send = function (
      ...args: Parameters<typeof XMLHttpRequest.prototype.send>
    ) {
      this.addEventListener('load', function () {
        try {
          const url = (this as XMLHttpRequest & { __xrmUrl?: string }).__xrmUrl || '';
          if (!/graphql|Followers|Following|UserBy|UserResult/i.test(url)) return;
          if (this.responseType && this.responseType !== 'text') return;
          const text = this.responseText;
          if (!text || text.length < 20 || text.length > 8_000_000) return;
          if (text[0] !== '{' && text[0] !== '[') return;
          ingest(JSON.parse(text));
        } catch {
          // ignore
        }
      });
      return XS.apply(this, args);
    };
  }

  return {
    ok: true,
    metaSize: Object.keys(w.__XRM_META__).length,
  };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'dashboard' || port.name === 'scan-worker') {
    // Port SW'yi uyanık tutar
    port.onDisconnect.addListener(() => {
      // no-op
    });
    if (port.name === 'dashboard') {
      dashboardPorts.add(port);
      port.onDisconnect.addListener(() => dashboardPorts.delete(port));
    }
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

async function pushLiveProgress(
  payload: { foundUsersCount?: number; debug?: string; scanId?: string } | null,
  mode: 'progress' | 'clear' = 'progress'
) {
  const text =
    mode === 'clear' || !payload || payload.foundUsersCount == null
      ? ''
      : `Tarama sürüyor... Bulunan: ${payload.foundUsersCount}${
          payload.debug ? ` | ${payload.debug}` : ''
        }`;

  if (mode === 'clear') {
    void chrome.action.setBadgeText({ text: '' });
  } else if (payload?.foundUsersCount != null) {
    const n = payload.foundUsersCount;
    void chrome.action.setBadgeText({ text: n > 999 ? '999+' : String(n) });
    void chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    broadcastToDashboards({ type: 'SCAN_PROGRESS', payload });
  }

  const extPrefix = `chrome-extension://${chrome.runtime.id}/`;
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }

  for (const tab of tabs) {
    if (!tab.id || !tab.url?.startsWith(extPrefix)) continue;
    if (!tab.url.includes('index.html') && !tab.url.endsWith('/')) continue;
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
        args: [
          text,
          mode === 'clear' || payload?.foundUsersCount == null
            ? null
            : payload.foundUsersCount,
        ],
      });
    } catch {
      // ignore
    }
  }
}

/** Tek inject: scrape + nazik scroll. Self-contained. */
function scrapeAndScrollInPage(): {
  users: Array<{
    id: string;
    username: string;
    displayName: string;
    isFollowing: boolean;
    isFollower: boolean;
    avatarUrl?: string;
    followersCount?: number;
    followingCount?: number;
  }>;
  expected: number | null;
  cellCount: number;
  metaSize: number;
  // Tüm meta - DOM'da olmayan kullanıcıların sayılarını da güncellemek için
  fullMeta: Record<string, { followersCount?: number; followingCount?: number }>;
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
    const k = s.match(/^([\d.,]+)([KkMmBb])$/);
    if (k) {
      let n = parseFloat(k[1].replace(',', '.'));
      if (k[2].toUpperCase() === 'K') n *= 1000;
      if (k[2].toUpperCase() === 'M') n *= 1_000_000;
      if (k[2].toUpperCase() === 'B') n *= 1_000_000_000;
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
      const isFollowerLabel =
        label.includes('follower') || label.includes('takipçi');
      const isFollowingLabel =
        label.includes('following') || label.includes('takip edilen');
      // Following sayfasında followers sayısını hedef sanma (TR/EN)
      if (pageFollowing && isFollowerLabel && !isFollowingLabel) continue;
      if (pageFollowers && isFollowingLabel && !isFollowerLabel) continue;
      const n = parseCount(m[1]);
      if (n != null && n >= 1 && n < 50_000_000) return n;
    }
    return null;
  }

  const found: Array<{
    id: string;
    username: string;
    displayName: string;
    isFollowing: boolean;
    isFollower: boolean;
    avatarUrl?: string;
    followersCount?: number;
    followingCount?: number;
  }> = [];
  const seen = new Set<string>();
  const cells = document.querySelectorAll('[data-testid="UserCell"]');
  const meta =
    (
      window as Window & {
        __XRM_META__?: Record<
          string,
          { followersCount?: number; followingCount?: number; displayName?: string }
        >;
      }
    ).__XRM_META__ || {};

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
    if (seen.has(id)) return;
    seen.add(id);

    let displayName = username;
    const nameSpan = cell.querySelector(
      `a[href="/${username}"] div[dir="auto"] span`
    );
    if (nameSpan?.textContent) displayName = nameSpan.textContent.trim();

    const inner = (cell as HTMLElement).innerText || '';
    const isFollower =
      pageFollowers ||
      inner.includes('Follows you') ||
      inner.includes('Seni takip ediyor');
    const isFollowing =
      pageFollowing || Boolean(cell.querySelector('[data-testid$="-unfollow"]'));
    const avatarImg = cell.querySelector(
      'img[src*="profile_images"]'
    ) as HTMLImageElement | null;

    const m = meta[id];
    if (m?.displayName && displayName === username) {
      displayName = m.displayName;
    }

    found.push({
      id,
      username,
      displayName,
      isFollowing,
      isFollower,
      avatarUrl: avatarImg?.src,
      ...(typeof m?.followersCount === 'number'
        ? { followersCount: m.followersCount }
        : {}),
      ...(typeof m?.followingCount === 'number'
        ? { followingCount: m.followingCount }
        : {}),
    });
  });

  // Nazik scroll — sayfayı çökertmeyecek kadar yavaş
  const step = 900;
  if (cells.length > 0) {
    const last = cells[cells.length - 1] as HTMLElement;
    try {
      last.scrollIntoView({ behavior: 'auto', block: 'end' });
    } catch {
      // ignore
    }
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

  return {
    users: found,
    expected: readExpected(),
    cellCount: cells.length,
    metaSize: Object.keys(meta).length,
    // Tüm meta'yı SW'ye gönder: DOM'da görünmeyen eski kullanıcılar da güncellensin
    fullMeta: meta as Record<string, { followersCount?: number; followingCount?: number }>,
  };
}

function softRecoverInPage() {
  const se = document.scrollingElement || document.documentElement;
  const cells = document.querySelectorAll('[data-testid="UserCell"]');
  if (cells.length > 0) {
    try {
      (cells[cells.length - 1] as HTMLElement).scrollIntoView({
        behavior: 'auto',
        block: 'end',
      });
    } catch {
      // ignore
    }
  }
  // hafif yukarı-aşağı
  const cur = se.scrollTop;
  se.scrollTop = Math.max(0, cur - 400);
  se.scrollTop = se.scrollHeight;
}

function ensureScanDriver() {
  if (scanTickTimer != null) return;

  if (keepAliveTimer == null) {
    keepAliveTimer = setInterval(() => {
      void chrome.storage.local.get(['activeScanId']);
    }, 20000);
  }

  // 1.5 sn — sayfayı boğmamak için
  scanTickTimer = setInterval(() => {
    void runScanTick();
  }, 1500);

  void runScanTick();
}

function stopScanDriver() {
  if (scanTickTimer != null) {
    clearInterval(scanTickTimer);
    scanTickTimer = null;
  }
  if (keepAliveTimer != null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

async function publishProgress(debug: string) {
  if (!active) return;
  const payload = {
    scanId: active.scanId,
    foundUsersCount: active.users.size,
    debug,
    updatedAt: Date.now(),
  };
  try {
    await chrome.storage.local.set({
      scanProgress: payload,
      scanStatus: 'running',
      activeScanId: active.scanId,
    });
  } catch {
    // quota vs.
  }
  await pushLiveProgress(payload, 'progress');
}

async function completeScan(status: 'completed' | 'cancelled' | 'error', error?: string) {
  if (!active || active.finishing) return;
  active.finishing = true;

  const scanId = active.scanId;
  const rawUsers =
    status === 'error'
      ? []
      : Array.from(active.users.values()).map((u) => ({
          ...u,
          firstSeenAt: u.firstSeenAt || Date.now(),
          lastSeenAt: Date.now(),
        }));
  const users = slimUsers(rawUsers);
  const completedAt = Date.now();
  const abortedByUser = status === 'cancelled';

  console.log(`Scan ${status}: ${users.length} users`, scanId);

  stopScanDriver();
  active = null;

  // Bellek cache — storage yazılamasa bile dashboard GET_SCAN_RESULT ile alır
  completedScanCache.set(scanId, {
    status,
    users,
    error,
    completedAt,
    abortedByUser,
  });
  // Eski cache birikmesin
  if (completedScanCache.size > 6) {
    const oldest = completedScanCache.keys().next().value;
    if (oldest) completedScanCache.delete(oldest);
  }

  const baseResult = {
    status,
    scanId,
    users,
    userCount: users.length,
    error,
    completedAt,
    abortedByUser,
  };

  // 1) Önce hafif meta yaz — waitForScanResult hemen açılsın (users sonra / port ile)
  try {
    await chrome.storage.local.set({
      scanProgress: null,
      scanStatus: status,
      activeScanId: null,
      scanResultMeta: {
        status,
        scanId,
        userCount: users.length,
        error,
        completedAt,
        abortedByUser,
      },
    });
  } catch (err) {
    console.error('Failed to write scanResultMeta', err);
  }

  // 2) Tam sonuç (slim users) — kota patlarsa meta + cache yeter
  let storedUsers = false;
  try {
    await chrome.storage.local.set({ scanResult: baseResult });
    storedUsers = true;
  } catch (err) {
    console.warn('Full scanResult failed, trying without users', err);
    try {
      await chrome.storage.local.set({
        scanResult: {
          ...baseResult,
          users: [],
          usersPending: true,
        },
      });
    } catch (err2) {
      console.error('Failed to write scanResult even without users', err2);
    }
  }

  await pushLiveProgress(null, 'clear');

  // 3) Port — dashboard arka planda donmuş olsa bile SW→port genelde çalışır
  broadcastToDashboards({
    type: 'SCAN_COMPLETED',
    payload: {
      status,
      scanId,
      users,
      userCount: users.length,
      error,
      completedAt,
      abortedByUser,
      storedUsers,
    },
  });

  console.log('Scan handoff done', {
    scanId,
    status,
    n: users.length,
    storedUsers,
  });
}

async function runScanTick() {
  if (!active || active.finishing || active.tickRunning) return;
  active.tickRunning = true;

  try {
    const { tabId } = active;
    active.tick++;

    let pageResult: {
      users: Array<{
        id: string;
        username: string;
        displayName: string;
        isFollowing: boolean;
        isFollower: boolean;
        avatarUrl?: string;
        followersCount?: number;
        followingCount?: number;
      }>;
      expected: number | null;
      cellCount: number;
      metaSize?: number;
      fullMeta?: Record<string, { followersCount?: number; followingCount?: number }>;
    } | null = null;

    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: scrapeAndScrollInPage,
      });
      pageResult = injected?.[0]?.result ?? null;
      active.consecutiveInjectFails = 0;
    } catch (err) {
      active.consecutiveInjectFails++;
      console.warn('inject fail', active.consecutiveInjectFails, err);
      // Reload YAPMA — döngüye sokar. Sadece bekle.
      if (active.consecutiveInjectFails >= 80) {
        await completeScan(
          active.users.size > 0 ? 'completed' : 'error',
          active.users.size > 0
            ? undefined
            : 'Tarama sekmesine uzun süre erişilemedi.'
        );
      }
      return;
    }

    if (!pageResult || !active) return;
    const currentActive = active;

    const now = Date.now();
    let added = 0;
    let withCounts = 0;
    for (const u of pageResult.users) {
      if (!u?.id) continue;
      if (!currentActive.users.has(u.id)) {
        currentActive.users.set(u.id, {
          ...u,
          firstSeenAt: now,
          lastSeenAt: now,
        });
        added++;
      } else {
        const prev = currentActive.users.get(u.id)!;
        currentActive.users.set(u.id, {
          ...prev,
          ...u,
          isFollowing: prev.isFollowing || u.isFollowing,
          isFollower: prev.isFollower || u.isFollower,
          followersCount:
            typeof u.followersCount === 'number'
              ? u.followersCount
              : prev.followersCount,
          followingCount:
            typeof u.followingCount === 'number'
              ? u.followingCount
              : prev.followingCount,
          lastSeenAt: now,
        });
      }
    }
    for (const u of currentActive.users.values()) {
      if (typeof u.followersCount === 'number') withCounts++;
    }

    // fullMeta: DOM'da artık görünmeyen ama daha önce toplanan kullanıcıların
    // sayılarını da güncelle (sanal liste sorununun çözümü)
    if (pageResult.fullMeta) {
      for (const [id, m] of Object.entries(pageResult.fullMeta)) {
        const existing = currentActive.users.get(id);
        if (!existing) continue;
        let changed = false;
        if (typeof m.followersCount === 'number' && typeof existing.followersCount !== 'number') {
          existing.followersCount = m.followersCount;
          changed = true;
        }
        if (typeof m.followingCount === 'number' && typeof existing.followingCount !== 'number') {
          existing.followingCount = m.followingCount;
          changed = true;
        }
        if (changed) currentActive.users.set(id, existing);
      }
      // withCounts'u yeniden hesapla
      withCounts = 0;
      for (const u of currentActive.users.values()) {
        if (typeof u.followersCount === 'number') withCounts++;
      }
    }

    if (pageResult.expected != null) currentActive.expected = pageResult.expected;

    if (currentActive.users.size > currentActive.lastCount) {
      currentActive.lastCount = currentActive.users.size;
      currentActive.lastGrowthAt = now;
      currentActive.recovery = 0;
    }

    const expected = currentActive.expected;
    const noGrowthMs = now - active.lastGrowthAt;
    const ratio =
      expected && expected > 0 ? active.users.size / expected : null;
    const pct = ratio != null ? `${Math.round(ratio * 100)}%` : '?';
    const debug = `SW#${active.tick} | +${added} | DOM:${pageResult.cellCount} | hedef:${expected ?? '?'} | ${pct} | sayı:${withCounts} | meta:${pageResult.metaSize ?? 0} | durgun:${Math.round(noGrowthMs / 1000)}s`;

    if (added > 0 || active.tick % 2 === 0) {
      await publishProgress(debug);
    }

    // Overlay (opsiyonel, hata yut)
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'SCAN_OVERLAY',
        payload: { text: `Bulunan: ${active.users.size} | ${debug}` },
      });
    } catch {
      // ignore
    }

    // Bitiş: hedefe ulaştı / çok yakın — following bittiğinde takılmayı önle
    if (expected && expected >= 20) {
      const ratioNow = active.users.size / expected;
      // %100+ veya tam hedef: 4 sn durgunluk yeterli
      if (ratioNow >= 1.0 && noGrowthMs > 4_000) {
        await publishProgress(
          `Following tamam (~${active.users.size}/${expected}) — kapanıyor…`
        );
        await completeScan('completed');
        return;
      }
      // %97+: 8 sn
      if (ratioNow >= 0.97 && noGrowthMs > 8_000) {
        await publishProgress(
          `Hedefe ulaşıldı (${Math.round(ratioNow * 100)}%) — kapanıyor…`
        );
        await completeScan('completed');
        return;
      }
      // %94+ ve 25 sn hiç büyüme yok (son birkaç hesap sanal listede kaybolabilir)
      if (ratioNow >= 0.94 && noGrowthMs > 25_000) {
        await completeScan('completed');
        return;
      }
    }

    // Hard deadline 3 saat
    if (now - active.startedAt > 3 * 60 * 60 * 1000) {
      await completeScan('completed');
      return;
    }

    // Durgunluk + yumuşak kurtarma (seyrek)
    const belowTarget =
      expected != null && expected > 50 && active.users.size < expected * 0.95;
    const stagnantFor = belowTarget ? 75_000 : 40_000;
    const sinceRecovery = now - active.lastRecoveryAt;

    if (noGrowthMs > stagnantFor && sinceRecovery > 45_000) {
      active.recovery++;
      active.lastRecoveryAt = now;
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: softRecoverInPage,
        });
      } catch {
        // ignore
      }
      await publishProgress(
        `Kurtarma #${active.recovery} | ${active.users.size}/${expected ?? '?'}`
      );
    }

    // Çok uzun durgunluk → eldekiyle bitir (following bitince followers'a geçilebilsin)
    const minRec = belowTarget ? 8 : 4;
    const minStag = belowTarget ? 4 * 60_000 : 2 * 60_000;
    if (active.recovery >= minRec && noGrowthMs > minStag) {
      await completeScan('completed');
    }
    // expected yoksa: 90 sn hiç büyüme yoksa bitir
    if (expected == null && noGrowthMs > 90_000 && active.users.size > 0) {
      await completeScan('completed');
    }
  } finally {
    if (active) active.tickRunning = false;
  }
}

function beginScanSession(tabId: number, scanId: string) {
  // Aynı session tekrar gelirse SIFIRLAMA
  if (active && !active.finishing && active.scanId === scanId && active.tabId === tabId) {
    console.log('Scan session already active, ignore duplicate begin', scanId);
    ensureScanDriver();
    // Hook yeniden dene (SPA navigasyon sonrası)
    void chrome.scripting
      .executeScript({
        target: { tabId },
        world: 'MAIN',
        func: installUserMetaHookInPage,
      })
      .catch(() => {});
    return;
  }

  // Farklı session: eskisini iptal etmeden yenisine geç (öncekini completed sayma)
  if (active && !active.finishing) {
    console.warn('Replacing scan session', active.scanId, '→', scanId);
    stopScanDriver();
  }

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
    lastRecoveryAt: 0,
    consecutiveInjectFails: 0,
    finishing: false,
    tickRunning: false,
  };

  // GraphQL'den followers_count yakalamak için fetch/XHR hook
  void chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'MAIN',
      func: installUserMetaHookInPage,
    })
    .then((r) => {
      console.log('User meta hook installed', r?.[0]?.result);
    })
    .catch((err) => {
      console.warn('User meta hook failed', err);
    });

  ensureScanDriver();
  console.log('Scan session begin', { tabId, scanId });
  void publishProgress('SW tarama başladı…');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SCAN_SESSION_BEGIN') {
    const tabId = message.payload?.tabId ?? sender.tab?.id;
    const scanId = message.payload?.scanId || `scan_${Date.now()}`;
    if (typeof tabId === 'number') {
      beginScanSession(tabId, scanId);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'no tabId' });
    }
    return false;
  }

  if (message?.type === 'SCAN_SESSION_END' || message?.type === 'SCAN_STOP') {
    if (active && !active.finishing) {
      void completeScan('cancelled');
    } else {
      stopScanDriver();
      active = null;
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'SCAN_PROGRESS' && message.payload) {
    // Content yedek progress — SW zaten yazıyorsa üzerine yazma şart değil
    void pushLiveProgress(message.payload, 'progress');
    return false;
  }

  // Content'in complete'ini yok say — SW yönetir (çift complete / restart önler)
  if (message?.type === 'SCAN_COMPLETED' && sender.tab) {
    sendResponse({ ok: true, ignored: true });
    return false;
  }

  // Dashboard: storage'da users boşsa bellek cache'den al
  if (message?.type === 'GET_SCAN_RESULT') {
    const scanId = message.payload?.scanId as string | undefined;
    if (!scanId) {
      sendResponse({ ok: false, error: 'no scanId' });
      return false;
    }
    const cached = completedScanCache.get(scanId);
    if (cached) {
      sendResponse({
        ok: true,
        status: cached.status,
        scanId,
        users: cached.users,
        userCount: cached.users.length,
        error: cached.error,
        completedAt: cached.completedAt,
        abortedByUser: cached.abortedByUser,
      });
    } else {
      sendResponse({ ok: false, error: 'not_in_cache', scanId });
    }
    return false;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.scanResult?.newValue?.abortedByUser && active && !active.finishing) {
    void completeScan('cancelled');
  }
});
