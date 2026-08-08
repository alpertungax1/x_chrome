console.log('Background service worker initialized.');

// Dashboard port'ları
const dashboardPorts = new Set<chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'dashboard') return;
  dashboardPorts.add(port);
  port.onDisconnect.addListener(() => {
    dashboardPorts.delete(port);
  });
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

/**
 * Donmuş dashboard sekmesinde bile DOM güncelle.
 * React JS dursa bile #xrm-scan-live (root dışı) güncellenir.
 */
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
          // MAIN: extension sayfasındaki React ile aynı world — DOM + CustomEvent
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

            // React uyanıksa state'i de güncellesin
            window.dispatchEvent(
              new CustomEvent('xrm-scan-progress', {
                detail: { text: statusText, count: n },
              })
            );
          },
          args: [text, count],
        });
      } catch {
        // Sekme kapalı / henüz yüklenmemiş olabilir
      }
    })
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SCAN_PROGRESS') {
    void pushLiveProgressToDashboards(message.payload || null, 'progress');
    return false;
  }

  if (message?.type === 'SCAN_COMPLETED') {
    void pushLiveProgressToDashboards(null, 'clear');
    broadcastToDashboards({ type: 'SCAN_COMPLETED', payload: message.payload });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'SCAN_ERROR') {
    console.warn('Service worker: scan error', message.payload?.error);
    void chrome.action.setBadgeText({ text: '!' });
    void pushLiveProgressToDashboards(null, 'clear');
    broadcastToDashboards({ type: 'SCAN_ERROR', payload: message.payload });
  }

  return false;
});

// sendMessage kaçsa bile storage değişince dashboard DOM'unu güncelle
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.scanProgress) {
    const v = changes.scanProgress.newValue;
    if (v && v.foundUsersCount != null) {
      void pushLiveProgressToDashboards(v, 'progress');
    } else if (changes.scanProgress.newValue == null) {
      // null yazıldıysa temizle — ama completed sonrası dashboard kendi UI'sını yönetir
      // cancelled/completed sırasında clear
    }
  }

  if (changes.scanStatus?.newValue === 'completed' || changes.scanStatus?.newValue === 'cancelled') {
    void pushLiveProgressToDashboards(null, 'clear');
  }
  if (changes.scanStatus?.newValue === 'error') {
    void chrome.action.setBadgeText({ text: '!' });
    void pushLiveProgressToDashboards(null, 'clear');
  }
});
