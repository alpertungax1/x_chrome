console.log('Background service worker initialized.');

// Dashboard port'ları — progress canlı iletilir
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

/**
 * Liste yazma yetkisi Dashboard'da (replaceAll).
 * SW sadece progress/badge ve mesaj iletimi yapar — eski merge kaydı yapmaz.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SCAN_PROGRESS') {
    broadcastToDashboards({ type: 'SCAN_PROGRESS', payload: message.payload });
    const n = message.payload?.foundUsersCount;
    if (typeof n === 'number') {
      void chrome.action.setBadgeText({ text: n > 999 ? '999+' : String(n) });
      void chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    }
    return false;
  }

  if (message?.type === 'SCAN_COMPLETED') {
    void chrome.action.setBadgeText({ text: '' });
    broadcastToDashboards({ type: 'SCAN_COMPLETED', payload: message.payload });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'SCAN_ERROR') {
    console.warn('Service worker: scan error', message.payload?.error);
    void chrome.action.setBadgeText({ text: '!' });
    broadcastToDashboards({ type: 'SCAN_ERROR', payload: message.payload });
  }

  return false;
});
