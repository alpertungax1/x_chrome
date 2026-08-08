console.log('Background service worker initialized.');

// Dashboard port'ları
const dashboardPorts = new Set<chrome.runtime.Port>();
// Tarama keep-alive port'ları (content script açık tutar → SW uyumaz)
const scanPorts = new Set<chrome.runtime.Port>();

let activeScanTabId: number | null = null;
let scanTickTimer: ReturnType<typeof setInterval> | null = null;
let swKeepAliveTimer: ReturnType<typeof setInterval> | null = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'dashboard') {
    dashboardPorts.add(port);
    port.onDisconnect.addListener(() => {
      dashboardPorts.delete(port);
    });
    return;
  }

  if (port.name === 'scan-worker') {
    scanPorts.add(port);
    if (activeScanTabId != null) {
      ensureScanDriver();
    }
    port.onDisconnect.addListener(() => {
      scanPorts.delete(port);
    });
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

/** Donmuş dashboard sekmesinde bile DOM güncelle. */
async function pushLiveProgressToDashboards(
  payload: { foundUsersCount?: number; debug?: string } | null,
  mode: 'progress' | 'clear' = 'progress'
) {
  const text = mode === 'clear' ? '' : formatProgressText(payload);
  const count =
    mode === 'clear' || payload?.foundUsersCount == null
      ? null
      : payload.foundUsersCount;

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
              if (n != null) {
                document.title = `Tarama (${n}) · X Manager`;
              }
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

/** X listesini sayfada kaydır — content script donmuş olsa bile SW inject eder. */
function scrollXListInPage() {
  const cells = document.querySelectorAll('[data-testid="UserCell"]');
  const step = 1200;
  if (cells.length > 0) {
    const last = cells[cells.length - 1] as HTMLElement;
    last.scrollIntoView({ behavior: 'auto', block: 'end' });
    for (let i = Math.max(0, cells.length - 6); i < cells.length; i++) {
      (cells[i] as HTMLElement).scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
    last.scrollIntoView({ behavior: 'auto', block: 'end' });

    let el: HTMLElement | null = cells[0].parentElement;
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
}

function ensureScanDriver() {
  if (scanTickTimer != null) return;

  // SW uyumasın
  if (swKeepAliveTimer == null) {
    swKeepAliveTimer = setInterval(() => {
      void chrome.storage.local.get(['activeScanId']);
    }, 20000);
  }

  scanTickTimer = setInterval(() => {
    void runScanTick();
  }, 900);

  void runScanTick();
}

function stopScanDriver() {
  if (scanTickTimer != null) {
    clearInterval(scanTickTimer);
    scanTickTimer = null;
  }
  if (swKeepAliveTimer != null) {
    clearInterval(swKeepAliveTimer);
    swKeepAliveTimer = null;
  }
  activeScanTabId = null;
}

async function runScanTick() {
  const tabId = activeScanTabId;
  if (tabId == null) return;

  // 1) Sayfaya doğrudan scroll (arka planda da)
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: scrollXListInPage,
    });
  } catch {
    return;
  }

  // 2) Content script tick → toplama + progress
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SCAN_TICK' });
  } catch {
    // throttle / yok
  }
}

function beginScanSession(tabId: number | null | undefined) {
  if (typeof tabId !== 'number') return;
  activeScanTabId = tabId;
  ensureScanDriver();
  console.log('Scan driver started for tab', tabId);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SCAN_SESSION_BEGIN') {
    const tabId = sender.tab?.id ?? message.payload?.tabId;
    beginScanSession(tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'SCAN_SESSION_END') {
    console.log('Scan driver stopped');
    stopScanDriver();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'SCAN_PROGRESS') {
    void pushLiveProgressToDashboards(message.payload || null, 'progress');
    return false;
  }

  if (message?.type === 'SCAN_COMPLETED') {
    stopScanDriver();
    void pushLiveProgressToDashboards(null, 'clear');
    broadcastToDashboards({ type: 'SCAN_COMPLETED', payload: message.payload });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'SCAN_ERROR') {
    console.warn('Service worker: scan error', message.payload?.error);
    stopScanDriver();
    void chrome.action.setBadgeText({ text: '!' });
    void pushLiveProgressToDashboards(null, 'clear');
    broadcastToDashboards({ type: 'SCAN_ERROR', payload: message.payload });
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.scanProgress) {
    const v = changes.scanProgress.newValue;
    if (v && v.foundUsersCount != null) {
      void pushLiveProgressToDashboards(v, 'progress');
    }
  }

  if (
    changes.scanStatus?.newValue === 'completed' ||
    changes.scanStatus?.newValue === 'cancelled'
  ) {
    stopScanDriver();
    void pushLiveProgressToDashboards(null, 'clear');
  }
  if (changes.scanStatus?.newValue === 'error') {
    stopScanDriver();
    void chrome.action.setBadgeText({ text: '!' });
    void pushLiveProgressToDashboards(null, 'clear');
  }
});
