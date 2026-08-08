import { userRepository } from '../db/users.repository';

console.log('Background service worker initialized.');

/**
 * Content script tarama sonucunu hem runtime mesaj hem storage ile bildirir.
 * Dashboard donmuş/kapalı olsa bile sonuç IndexedDB'ye yazılsın.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SCAN_COMPLETED' && message.payload?.users) {
    const users = message.payload.users;
    userRepository
      .saveBatch(users)
      .then(() => {
        console.log(`Service worker: saved ${users.length} users`);
        // Dashboard'un uyanınca fark etmesi için bayrak
        return chrome.storage.local.set({
          usersUpdatedAt: Date.now(),
          lastSavedUserCount: users.length,
        });
      })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('Service worker: failed to save users', err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // async response
  }

  if (message?.type === 'SCAN_ERROR') {
    console.warn('Service worker: scan error', message.payload?.error);
  }

  return false;
});

// Content script sadece storage yazdıysa (mesaj kaçtıysa) yine kaydet
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  const result = changes.scanResult?.newValue;
  if (!result || result.status !== 'completed' || !result.users?.length) return;

  // Aynı sonucu tekrar kaydetmemek için timestamp kontrolü
  const completedAt = result.completedAt as number | undefined;
  chrome.storage.local.get(['lastProcessedScanAt'], async (data) => {
    if (completedAt && data.lastProcessedScanAt === completedAt) return;

    try {
      await userRepository.saveBatch(result.users);
      await chrome.storage.local.set({
        lastProcessedScanAt: completedAt ?? Date.now(),
        usersUpdatedAt: Date.now(),
        lastSavedUserCount: result.users.length,
      });
      console.log(`Service worker (storage): saved ${result.users.length} users`);
    } catch (err) {
      console.error('Service worker (storage): failed to save users', err);
    }
  });
});
