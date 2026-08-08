import { XScanner } from './scanner';
import { XActionHandler } from './actions';
import { logger } from '../utils/logger';
import { AppMessage } from '../types/messages';
import { isValidXUsername, usernameFromUrl } from '../utils/x-username';

// Çift enjeksiyonda ikinci listener eklenmesin (scripting.executeScript / reload)
const g = globalThis as typeof globalThis & { __XRM_CS_INIT__?: boolean };
if (g.__XRM_CS_INIT__) {
  // Zaten yüklü — çık
} else {
  g.__XRM_CS_INIT__ = true;
  initContentScript();
}

function initContentScript() {
  logger.log('ContentScript', 'X Relationship Manager Content Script loaded.');

  const scanner = new XScanner();
  const actionHandler = new XActionHandler();

  /** Tarama popup'ında canlı progress HUD (dashboard donmuş olsa bile görünür). */
  function ensureScanOverlay(): HTMLElement {
    let el = document.getElementById('xrm-scan-overlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'xrm-scan-overlay';
    el.style.cssText = [
      'position:fixed',
      'top:12px',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'padding:10px 18px',
      'border-radius:999px',
      'background:rgba(29,78,216,0.95)',
      'color:#fff',
      'font:600 13px/1.3 system-ui,sans-serif',
      'box-shadow:0 4px 20px rgba(0,0,0,0.35)',
      'pointer-events:none',
      'max-width:90vw',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'display:none',
    ].join(';');
    document.documentElement.appendChild(el);
    return el;
  }

  function showScanOverlay(text: string) {
    const el = ensureScanOverlay();
    el.textContent = text;
    el.style.display = 'block';
  }

  function hideScanOverlay() {
    const el = document.getElementById('xrm-scan-overlay');
    if (el) el.style.display = 'none';
  }

  /**
   * Oturum açmış kullanıcının @username'ini bul.
   * ASLA /home, /explore gibi nav path'lerini kullanıcı adı sanma.
   */
  function getLoggedInUsername(): string | null {
    // 1) Sol menü Profil linki (en güvenilir DOM sinyali)
    const profileCandidates = [
      document.querySelector<HTMLAnchorElement>('a[data-testid="AppTabBar_Profile_Link"]'),
      document.querySelector<HTMLAnchorElement>('a[aria-label="Profile"]'),
      document.querySelector<HTMLAnchorElement>('a[aria-label="Profil"]'),
      // Bazen testid farklı/çevrilmiş olabilir
      ...Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'nav[role="navigation"] a[href^="/"], header a[href^="/"]'
        )
      ).filter((a) => {
        const label = (a.getAttribute('aria-label') || a.textContent || '').toLowerCase();
        return label.includes('profile') || label.includes('profil');
      }),
    ];

    for (const el of profileCandidates) {
      if (!el) continue;
      const href = el.getAttribute('href') || '';
      const seg = href.replace(/^\//, '').split(/[/?#]/)[0];
      if (isValidXUsername(seg)) {
        logger.log('ContentScript', 'Username via profile link', seg);
        return seg;
      }
    }

    // 2) Sayfa JSON'unda screen_name (X initial state)
    const fromJson = extractScreenNameFromPage();
    if (fromJson) {
      logger.log('ContentScript', 'Username via screen_name JSON', fromJson);
      return fromJson;
    }

    // 3) URL zaten /username/following|followers ise
    const fromUrl = usernameFromUrl(location.href);
    if (fromUrl) {
      logger.log('ContentScript', 'Username via URL', fromUrl);
      return fromUrl;
    }

    // 4) Account switcher / avatar container
    // data-testid="UserAvatar-Container-ActualName" bazen kullanılıyor
    const avatar = document.querySelector<HTMLElement>('[data-testid^="UserAvatar-Container-"]');
    if (avatar) {
      const testid = avatar.getAttribute('data-testid') || '';
      const name = testid.replace(/^UserAvatar-Container-/, '');
      if (isValidXUsername(name)) {
        logger.log('ContentScript', 'Username via avatar testid', name);
        return name;
      }
    }

    // 5) @mention metinleri (account menu)
    const switcher = document.querySelector(
      '[data-testid="SideNav_AccountSwitcher_Button"]'
    );
    if (switcher) {
      const text = switcher.textContent || '';
      const at = text.match(/@([A-Za-z0-9_]{1,15})/);
      if (at && isValidXUsername(at[1])) {
        logger.log('ContentScript', 'Username via account switcher', at[1]);
        return at[1];
      }
    }

    // NOT: nav'daki /home, /explore linklerini kullanıcı adı olarak KULLANMA
    return null;
  }

  function extractScreenNameFromPage(): string | null {
    // React query / redux initial state içinde sık görülür
    const patterns = [
      /"screen_name":"([A-Za-z0-9_]{1,15})"/g,
      /"screen_name":\s*"([A-Za-z0-9_]{1,15})"/g,
    ];

    // Önce script etiketleri (daha ucuz / daha isabetli)
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes('screen_name')) continue;
      for (const re of patterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          if (isValidXUsername(m[1])) return m[1];
        }
      }
    }

    // Fallback: body HTML (pahalı ama nadir)
    try {
      const html = document.documentElement.innerHTML.slice(0, 500_000);
      for (const re of patterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) {
          if (isValidXUsername(m[1])) return m[1];
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  function safeSendMessage(message: AppMessage) {
    try {
      chrome.runtime.sendMessage(message, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // ignore
    }
  }

  chrome.runtime.onMessage.addListener((message: AppMessage, _sender, sendResponse) => {
    logger.log('ContentScript', 'Received message', message);

    if (message.type === 'PING') {
      sendResponse({ ok: true, href: location.href });
      return false;
    }

    if (message.type === 'GET_LOGGED_IN_USER') {
      sendResponse({ username: getLoggedInUsername() });
      return false;
    }

    if (message.type === 'SCAN_STOP') {
      scanner.stopScan();
      showScanOverlay('Tarama durduruluyor...');
      safeSendMessage({ type: 'SCAN_SESSION_END' });
      sendResponse({ status: 'stopping' });
      return false;
    }

    // SW overlay metni
    if ((message.type as string) === 'SCAN_OVERLAY') {
      const text = (message.payload as { text?: string })?.text;
      if (text) showScanOverlay(text);
      sendResponse({ ok: true });
      return false;
    }

    // Eski tick — yedek (SW artık ana sürücü)
    if (message.type === 'SCAN_TICK') {
      if (scanner.isRunning()) scanner.backgroundTick();
      sendResponse({ ok: true, running: scanner.isRunning() });
      return false;
    }

    if (message.type === 'SCAN_STARTED') {
      const scanId =
        (message.payload && (message.payload as { scanId?: string }).scanId) ||
        `scan_${Date.now()}`;

      // Hemen ACK
      sendResponse({ status: 'started', scanId });
      showScanOverlay('Tarama başlıyor (arka plan sürücüsü)…');

      // SW keep-alive port — tarama SW'de yürür, CS sadece overlay + port
      let scanPort: chrome.runtime.Port | null = null;
      try {
        scanPort = chrome.runtime.connect({ name: 'scan-worker' });
      } catch {
        scanPort = null;
      }

      const pageHint = /\/following/i.test(location.pathname)
        ? 'following'
        : /\/followers/i.test(location.pathname)
          ? 'followers'
          : 'unknown';

      safeSendMessage({
        type: 'SCAN_SESSION_BEGIN',
        payload: { scanId, pageHint },
      });

      // Storage'dan progress → overlay (SW yazıyor)
      const onStorage = (
        changes: { [key: string]: chrome.storage.StorageChange },
        area: string
      ) => {
        if (area !== 'local') return;
        if (changes.scanProgress?.newValue) {
          const p = changes.scanProgress.newValue;
          if (p.scanId && p.scanId !== scanId) return;
          const debug = p.debug ? ` | ${p.debug}` : '';
          showScanOverlay(`Bulunan: ${p.foundUsersCount ?? 0}${debug}`);
        }
        if (
          changes.scanResult?.newValue &&
          changes.scanResult.newValue.scanId === scanId
        ) {
          const r = changes.scanResult.newValue;
          const n = r.users?.length ?? 0;
          showScanOverlay(
            r.status === 'cancelled'
              ? `Durduruldu · ${n}`
              : r.status === 'error'
                ? `Hata: ${r.error || ''}`
                : `Tamamlandı · ${n}`
          );
          window.setTimeout(() => hideScanOverlay(), 2500);
          chrome.storage.onChanged.removeListener(onStorage);
          try {
            scanPort?.disconnect();
          } catch {
            // ignore
          }
        }
      };
      chrome.storage.onChanged.addListener(onStorage);

      // NOT: Ana tarama döngüsü Artık SW'de (executeScript).
      // Content script arka planda donsa bile tarama devam eder.

      return false;
    }

    if (message.type === 'UNFOLLOW_FROM_PROFILE') {
      actionHandler
        .unfollowFromProfilePage()
        .then((success) => sendResponse({ success }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'FOLLOW_FROM_PROFILE') {
      actionHandler
        .followFromProfilePage()
        .then((success) => sendResponse({ success }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'ACTION_ENQUEUE') {
      const { username, actionType } = message.payload || {};
      if (actionType === 'UNFOLLOW') {
        actionHandler.unfollowUser(username).then((success) => sendResponse({ success }));
        return true;
      }
    }

    return false;
  });
}
