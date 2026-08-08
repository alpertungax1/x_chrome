import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../store/app-store';
import { StatsCard } from '../components/StatsCard';
import { UserTable } from '../components/UserTable';
import { relationshipAnalyzer } from '../analysis/relationship-analyzer';
import { Users, UserMinus, UserCheck, Activity, Square } from 'lucide-react';

type ViewMode = 'dashboard' | 'followers' | 'following' | 'notFollowingMe' | 'mutuals';

class ScanAbortedError extends Error {
  constructor(message = 'Tarama kullanıcı tarafından durduruldu.') {
    super(message);
    this.name = 'ScanAbortedError';
  }
}

const Dashboard: React.FC = () => {
  const { users, stats, loadUsers, isLoading } = useAppStore();
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
  const scanningWindowIdRef = React.useRef<number | null>(null);
  const scanningTabIdRef = React.useRef<number | null>(null);
  const dashboardWindowIdRef = React.useRef<number | null>(null);
  // Sadece kullanıcı "Scan Now" bastığında true — açılışta asla tarama UI'sı yok
  const scanSessionActiveRef = React.useRef(false);
  const scanAbortRef = React.useRef(false);
  const activeScanIdRef = React.useRef<string | null>(null);
  const lastSeenUsersUpdatedAtRef = React.useRef<number | null>(null);
  const lastProgressTextRef = React.useRef('');

  // Aksiyon state'leri
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  const applyScanProgress = useCallback((payload: {
    foundUsersCount?: number;
    debug?: string;
    scanId?: string;
  } | null | undefined) => {
    // Kullanıcı başlatmadıysa storage kalıntısı UI'yi "taranıyor"a çekmesin
    if (!scanSessionActiveRef.current) return;
    if (!payload || payload.foundUsersCount == null) return;
    if (payload.scanId && activeScanIdRef.current && payload.scanId !== activeScanIdRef.current) {
      return;
    }
    const debug = payload.debug ? ` | ${payload.debug}` : '';
    const text = `Bulunan: ${payload.foundUsersCount}${debug}`;
    if (text === lastProgressTextRef.current) return;
    lastProgressTextRef.current = text;
    setScanStatus(text);
    setIsScanning(true);
    // Sekme başlığı
    document.title = `Tarama (${payload.foundUsersCount}) · X Manager`;
    // Root-dışı canlı bar (SW de yazar; burada senkron tut)
    const bar = document.getElementById('xrm-scan-live');
    if (bar) {
      bar.style.display = 'block';
      bar.textContent = `Tarama sürüyor... ${text}`;
      document.body.classList.add('xrm-scanning');
    }
  }, []);

  /** Dashboard penceresini öne al — arka planda donmasın, progress canlı kalsın. */
  const focusDashboardWindow = useCallback(async () => {
    const id = dashboardWindowIdRef.current;
    if (id == null) return;
    try {
      await chrome.windows.update(id, { focused: true, drawAttention: false });
    } catch {
      // ignore
    }
  }, []);

  const closeScanningWindow = useCallback(() => {
    if (scanningWindowIdRef.current) {
      chrome.windows.remove(scanningWindowIdRef.current).catch(() => {});
      scanningWindowIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Bu dashboard penceresinin id'sini sakla (tarama popup'ı odağı alınca geri döneceğiz)
    void chrome.windows.getCurrent().then((win) => {
      if (win.id != null) dashboardWindowIdRef.current = win.id;
    });

    // Açılış: sadece DB yükle. Eski scanProgress/scanResult KALINTISINI temizle —
    // aksi halde "tarama sürüyor" görünür ve eski sonuçla anında "bitti" sanılır.
    void (async () => {
      await chrome.storage.local.remove([
        'scanProgress',
        'scanStatus',
        'scanResult',
        'activeScanId',
      ]);
      await loadUsers();
    })();

    const messageListener = (message: any) => {
      if (!scanSessionActiveRef.current) return;
      if (message.type === 'SCAN_PROGRESS') {
        applyScanProgress(message.payload);
      }
    };

    const storageListener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== 'local') return;
      if (!scanSessionActiveRef.current) return;

      if (changes.scanProgress?.newValue) {
        applyScanProgress(changes.scanProgress.newValue);
      }
    };

    // Uzun ömürlü port: SW progress'i doğrudan basar (runtime.sendMessage kaçsa bile)
    let port: chrome.runtime.Port | null = null;
    const connectPort = () => {
      try {
        port = chrome.runtime.connect({ name: 'dashboard' });
        port.onMessage.addListener((message: any) => {
          if (!scanSessionActiveRef.current) return;
          if (message?.type === 'SCAN_PROGRESS') {
            applyScanProgress(message.payload);
          }
        });
        port.onDisconnect.addListener(() => {
          port = null;
          // SW uyku/uyanma sonrası yeniden bağlan
          if (scanSessionActiveRef.current) {
            window.setTimeout(connectPort, 300);
          }
        });
      } catch {
        port = null;
      }
    };
    connectPort();

    // Sekme uyanınca storage'dan son progress'i çek (freeze sonrası)
    const flushProgressFromStorage = () => {
      if (!scanSessionActiveRef.current) return;
      void chrome.storage.local.get(['scanProgress']).then((data) => {
        if (data.scanProgress) applyScanProgress(data.scanProgress);
      });
      if (!port) connectPort();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') flushProgressFromStorage();
    };
    const onFocus = () => flushProgressFromStorage();

    // SW executeScript ile basılan CustomEvent — JS uyanıksa React state de güncellenir
    const onLiveProgress = (ev: Event) => {
      if (!scanSessionActiveRef.current) return;
      const detail = (ev as CustomEvent).detail as { text?: string; count?: number | null };
      if (!detail?.text) return;
      // text: "Tarama sürüyor... Bulunan: N | ..."
      const m = detail.text.match(/Bulunan:\s*(\d+)(.*)$/);
      if (m) {
        applyScanProgress({
          foundUsersCount: Number(m[1]),
          debug: m[2]?.replace(/^\s*\|\s*/, '') || undefined,
        });
      } else {
        setScanStatus(detail.text.replace(/^Tarama sürüyor\.\.\.\s*/, ''));
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    chrome.storage.onChanged.addListener(storageListener);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('xrm-scan-progress', onLiveProgress);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.storage.onChanged.removeListener(storageListener);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('xrm-scan-progress', onLiveProgress);
      try {
        port?.disconnect();
      } catch {
        // ignore
      }
    };
  }, [loadUsers, applyScanProgress]);

  // Tarama aktifken progress'i storage'dan sık poll et
  // (dashboard odaktayken canlı; arka planda da throttle'a rağmen toparlar)
  useEffect(() => {
    if (!isScanning) {
      if (document.title.startsWith('Tarama')) {
        document.title = 'X Relationship Manager';
      }
      return;
    }
    const id = window.setInterval(async () => {
      if (!scanSessionActiveRef.current) return;
      const data = await chrome.storage.local.get(['scanProgress']);
      if (data.scanProgress) applyScanProgress(data.scanProgress);
    }, 500);
    return () => window.clearInterval(id);
  }, [isScanning, applyScanProgress]);

  const throwIfAborted = useCallback(() => {
    if (scanAbortRef.current) {
      throw new ScanAbortedError();
    }
  }, []);

  const handleStopScan = useCallback(async () => {
    if (!scanSessionActiveRef.current) return;
    scanAbortRef.current = true;
    setScanStatus('Durduruluyor...');

    const tabId = scanningTabIdRef.current;
    const scanId = activeScanIdRef.current;

    // Content script'e dur komutu — kısmi kullanıcıları cancelled sonucuyla yazar
    if (tabId != null) {
      try {
        await sendTabMessage(tabId, { type: 'SCAN_STOP' });
      } catch {
        // sekme kapanmış olabilir
      }
    }

    // Content 2 sn içinde cevap vermezse waitForScanResult'ı serbest bırak
    window.setTimeout(() => {
      if (!scanAbortRef.current) return;
      void chrome.storage.local.get(['scanResult']).then((data) => {
        const r = data.scanResult;
        if (r && (r.scanId === scanId || r.status === 'cancelled')) return;
        void chrome.storage.local.set({
          scanStatus: 'cancelled',
          scanResult: {
            status: 'cancelled',
            scanId: scanId || `abort_${Date.now()}`,
            users: [],
            completedAt: Date.now(),
            abortedByUser: true,
          },
        });
      });
    }, 2000);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // SCAN — sadece Scan Now ile; popup + following + followers
  // ═══════════════════════════════════════════════════════════
  const handleScanNow = async () => {
    if (scanSessionActiveRef.current) return;

    scanSessionActiveRef.current = true;
    scanAbortRef.current = false;
    setIsScanning(true);
    setScanStatus('Başlatılıyor...');

    await chrome.storage.local.remove([
      'scanResult',
      'scanProgress',
      'scanStatus',
      'activeScanId',
    ]);

    let followingUsers: any[] = [];
    let followersUsers: any[] = [];
    let listReplaced = false;

    try {
      // Her tarama: eski listeyi sil, sıfırdan kur
      setScanStatus('Eski liste temizleniyor...');
      await useAppStore.getState().clearUsers();

      setScanStatus('X kullanıcı adı alınıyor...');
      const username = await resolveXUsername();
      throwIfAborted();
      if (!username) {
        throw new Error(
          "X kullanıcı adın bulunamadı.\n\nLütfen x.com'da giriş yapılı olduğundan emin ol ve tekrar dene."
        );
      }

      // Dashboard pencere id'sini taze al
      try {
        const cur = await chrome.windows.getCurrent();
        if (cur.id != null) dashboardWindowIdRef.current = cur.id;
      } catch {
        // ignore
      }

      setScanStatus(`Popup açılıyor (@${username})...`);
      const followingUrl = `https://x.com/${username}/following`;
      // focused:true — X sanal listesi arka planda yüklenmez; tarama ilerlemesi için gerekli.
      // Dashboard progress'i SW executeScript ile donmuş sekmeye de yazılır (#xrm-scan-live).
      const { windowId, tabId } = await openScanPopup(followingUrl, true);
      scanningWindowIdRef.current = windowId;
      scanningTabIdRef.current = tabId;
      throwIfAborted();

      setScanStatus('Following sayfası yükleniyor...');
      await waitForTabComplete(tabId);
      throwIfAborted();
      await wait(2500);
      throwIfAborted();
      await ensureContentScript(tabId);
      throwIfAborted();

      // --- Following ---
      setScanStatus('Takip edilenler taranıyor...');
      lastProgressTextRef.current = '';
      const followingScanId = `following_${Date.now()}`;
      activeScanIdRef.current = followingScanId;
      await chrome.storage.local.remove(['scanResult', 'scanProgress', 'scanStatus']);
      await startScanOnTab(tabId, followingScanId);
      // Tarama penceresi odakta kalsın (scroll/DOM için); dashboard bar'ı SW günceller
      try {
        await chrome.windows.update(windowId, { focused: true });
      } catch {
        // ignore
      }
      // 7500+ hesaplar uzun sürer — 60 dk timeout
      const followingResult = await waitForScanResult(
        followingScanId,
        60 * 60 * 1000,
        () => scanAbortRef.current
      );
      if (followingResult.status === 'error') {
        throw new Error(followingResult.error || 'Following taraması başarısız');
      }
      followingUsers = followingResult.users || [];
      if (followingResult.status === 'cancelled' || scanAbortRef.current) {
        // Kısmi: sadece following ile listeyi yaz
        if (followingUsers.length > 0) {
          await useAppStore.getState().replaceWithScan(followingUsers, []);
          listReplaced = true;
        }
        throw new ScanAbortedError();
      }

      // --- Followers ---
      setScanStatus('Takipçiler taranıyor...');
      lastProgressTextRef.current = '';
      const followersUrl = `https://x.com/${username}/followers`;
      await chrome.tabs.update(tabId, { url: followersUrl });
      throwIfAborted();
      await waitForTabComplete(tabId);
      throwIfAborted();
      await wait(2500);
      throwIfAborted();
      await ensureContentScript(tabId);
      throwIfAborted();

      const followersScanId = `followers_${Date.now()}`;
      activeScanIdRef.current = followersScanId;
      await chrome.storage.local.remove(['scanResult', 'scanProgress', 'scanStatus']);
      await startScanOnTab(tabId, followersScanId);
      try {
        if (scanningWindowIdRef.current != null) {
          await chrome.windows.update(scanningWindowIdRef.current, { focused: true });
        }
      } catch {
        // ignore
      }
      const followersResult = await waitForScanResult(
        followersScanId,
        60 * 60 * 1000,
        () => scanAbortRef.current
      );
      if (followersResult.status === 'error') {
        throw new Error(followersResult.error || 'Followers taraması başarısız');
      }
      followersUsers = followersResult.users || [];
      if (followersResult.status === 'cancelled' || scanAbortRef.current) {
        await useAppStore.getState().replaceWithScan(followingUsers, followersUsers);
        listReplaced = true;
        throw new ScanAbortedError();
      }

      // Tam tarama: eski liste yok, birleşik yeni liste
      const totalFound = await useAppStore.getState().replaceWithScan(
        followingUsers,
        followersUsers
      );
      listReplaced = true;

      await chrome.storage.local.remove([
        'scanProgress',
        'scanStatus',
        'scanResult',
        'activeScanId',
      ]);
      closeScanningWindow();
      scanningTabIdRef.current = null;
      alert(
        `Tarama tamamlandı! Liste yenilendi.\n` +
          `Following: ${followingUsers.length}\n` +
          `Followers: ${followersUsers.length}\n` +
          `Toplam benzersiz: ${totalFound}`
      );
    } catch (error: any) {
      console.error('Scan failed:', error);
      closeScanningWindow();
      scanningTabIdRef.current = null;
      await chrome.storage.local.remove([
        'scanProgress',
        'scanStatus',
        'scanResult',
        'activeScanId',
      ]);

      // Abort dışı hata ve henüz yazılmadıysa kısmi sonuçları yine de kaydet
      if (
        !(error instanceof ScanAbortedError || error?.name === 'ScanAbortedError') &&
        !listReplaced &&
        (followingUsers.length > 0 || followersUsers.length > 0)
      ) {
        try {
          await useAppStore.getState().replaceWithScan(followingUsers, followersUsers);
          listReplaced = true;
        } catch {
          // ignore
        }
      }

      if (!listReplaced) {
        await loadUsers();
      }

      if (error instanceof ScanAbortedError || error?.name === 'ScanAbortedError') {
        const n = useAppStore.getState().users.length;
        alert(
          `Tarama durduruldu.\n` +
            (n > 0
              ? `Liste kısmen yenilendi (${n} kullanıcı).`
              : 'Liste boş bırakıldı (yeterli veri yok).')
        );
      } else {
        alert(
          'Tarama başlatılamadı / tamamlanamadı.\n\n' +
            (error?.message || String(error)) +
            "\n\nİpucu: x.com'da giriş yapılı olsun; eklentiyi chrome://extensions üzerinden Reload et."
        );
      }
    } finally {
      scanSessionActiveRef.current = false;
      scanAbortRef.current = false;
      activeScanIdRef.current = null;
      scanningTabIdRef.current = null;
      setIsScanning(false);
      setScanStatus('');
      lastProgressTextRef.current = '';
      document.title = 'X Relationship Manager';
      const bar = document.getElementById('xrm-scan-live');
      if (bar) {
        bar.style.display = 'none';
        bar.textContent = '';
      }
      document.body.classList.remove('xrm-scanning');
      void chrome.action.setBadgeText({ text: '' });
    }
  };

  // ═══════════════════════════════════════════════════════════
  // TEKLİ AKSİYONLAR
  // ═══════════════════════════════════════════════════════════
  
  /**
   * Bir kullanıcının profilini popup'ta açıp, aksiyon gönderer.
   * @returns true ise başarılı
   */
  const executeProfileAction = useCallback(async (
    username: string, 
    actionType: 'UNFOLLOW_FROM_PROFILE' | 'FOLLOW_FROM_PROFILE'
  ): Promise<boolean> => {
    let popupWindowId: number | null = null;
    let tabId: number | null = null;

    try {
      // 1. Profil sayfasını yeni bir sekmede aç
      const tab = await chrome.tabs.create({ 
        url: `https://x.com/${username}`, 
        active: false 
      });
      tabId = tab.id || null;

      if (!tabId) return false;

      // 2. Sekmeyi popup pencereye taşı
      const popup = await chrome.windows.create({
        tabId: tabId,
        type: 'popup',
        width: 420,
        height: 550,
        focused: false
      });
      popupWindowId = popup?.id || null;

      // 3. Sayfanın yüklenmesini bekle
      await waitForTabComplete(tabId);
      
      // 4. Kısa bekleme (content script'in yüklenmesi için)
      await wait(1500);

      // 5. Content script'e mesaj gönder
      const result = await new Promise<{ success: boolean }>((resolve) => {
        chrome.tabs.sendMessage(tabId!, { type: actionType }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('Message error:', chrome.runtime.lastError.message);
            resolve({ success: false });
          } else {
            resolve(response || { success: false });
          }
        });
      });

      return result.success;
    } catch (err) {
      console.error(`Action ${actionType} failed for ${username}:`, err);
      return false;
    } finally {
      // Popup'ı kapat
      if (popupWindowId) {
        try { await chrome.windows.remove(popupWindowId); } catch {}
      }
    }
  }, []);

  const handleUnfollow = useCallback(async (username: string): Promise<boolean> => {
    setActionInProgress(username);
    try {
      const success = await executeProfileAction(username, 'UNFOLLOW_FROM_PROFILE');
      if (success) {
        // Listeden düş: takip etmiyorsan sil; hâlâ takipçiyse sadece isFollowing=false
        await useAppStore.getState().applyUnfollow(username);
      } else {
        alert(`${username} takipten çıkarılamadı. Lütfen manuel olarak deneyin.`);
      }
      return success;
    } finally {
      setActionInProgress(null);
    }
  }, [executeProfileAction]);

  const handleFollow = useCallback(async (username: string): Promise<boolean> => {
    setActionInProgress(username);
    try {
      const success = await executeProfileAction(username, 'FOLLOW_FROM_PROFILE');
      if (success) {
        await loadUsers();
      } else {
        alert(`${username} takip edilemedi. Lütfen manuel olarak deneyin.`);
      }
      return success;
    } finally {
      setActionInProgress(null);
    }
  }, [executeProfileAction, loadUsers]);

  // ═══════════════════════════════════════════════════════════
  // TOPLU AKSİYONLAR
  // ═══════════════════════════════════════════════════════════

  const handleBulkUnfollow = useCallback(async (usernames: string[]) => {
    setBulkProgress({ current: 0, total: usernames.length });
    let successCount = 0;

    for (let i = 0; i < usernames.length; i++) {
      const username = usernames[i];
      setActionInProgress(username);
      setBulkProgress({ current: i + 1, total: usernames.length });

      const success = await executeProfileAction(username, 'UNFOLLOW_FROM_PROFILE');
      if (success) {
        successCount++;
        await useAppStore.getState().applyUnfollow(username);
      }

      // Rate limiting: Her işlem arasında 3 saniye bekle (X'in spam korumasına takılmamak için)
      if (i < usernames.length - 1) {
        await wait(3000);
      }
    }

    setActionInProgress(null);
    setBulkProgress(null);
    alert(`Toplu işlem tamamlandı!\n${successCount}/${usernames.length} kullanıcı başarıyla takipten çıkarıldı.`);
  }, [executeProfileAction]);

  const handleBulkFollow = useCallback(async (usernames: string[]) => {
    setBulkProgress({ current: 0, total: usernames.length });
    let successCount = 0;

    for (let i = 0; i < usernames.length; i++) {
      const username = usernames[i];
      setActionInProgress(username);
      setBulkProgress({ current: i + 1, total: usernames.length });

      const success = await executeProfileAction(username, 'FOLLOW_FROM_PROFILE');
      if (success) successCount++;

      if (i < usernames.length - 1) {
        await wait(3000);
      }
    }

    setActionInProgress(null);
    setBulkProgress(null);
    await loadUsers();
    alert(`Toplu işlem tamamlandı!\n${successCount}/${usernames.length} kullanıcı başarıyla takip edildi.`);
  }, [executeProfileAction, loadUsers]);

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      );
    }

    if (currentView === 'dashboard') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatsCard title="Followers" value={stats.followers} icon={<Users size={22} />} />
          <StatsCard title="Following" value={stats.following} icon={<Users size={22} />} />
          <StatsCard title="Not Following You" value={stats.notFollowing} icon={<UserMinus size={22} />} />
          <StatsCard title="Mutuals" value={stats.mutuals} icon={<UserCheck size={22} />} />
        </div>
      );
    }

    const tableProps = {
      onUnfollow: handleUnfollow,
      onFollow: handleFollow,
      onBulkUnfollow: handleBulkUnfollow,
      onBulkFollow: handleBulkFollow,
      actionInProgress,
      bulkProgress,
    };

    if (currentView === 'followers') {
      return <UserTable users={users.filter(u => u.isFollower)} title="Takipçilerim" {...tableProps} />;
    }
    
    if (currentView === 'following') {
      return <UserTable users={users.filter(u => u.isFollowing)} title="Takip Ettiklerim" {...tableProps} />;
    }

    if (currentView === 'notFollowingMe') {
      return <UserTable users={relationshipAnalyzer.findNotFollowingMe(users)} title="Geri Takip Etmeyenler" {...tableProps} />;
    }

    if (currentView === 'mutuals') {
      return <UserTable users={relationshipAnalyzer.findMutuals(users)} title="Karşılıklı Takipleşilenler" {...tableProps} />;
    }
  };

  const navItemClass = (viewName: ViewMode) => `flex items-center space-x-3 p-3 rounded-lg font-medium transition-colors cursor-pointer ${
    currentView === viewName 
      ? 'bg-blue-50 text-blue-700' 
      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
  }`;

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col">
        <h2 className="text-xl font-bold text-gray-800 mb-8 pl-2">X Manager</h2>
        <nav className="space-y-2 flex-1">
          <div onClick={() => setCurrentView('dashboard')} className={navItemClass('dashboard')}>
            <Activity size={20} />
            <span>Dashboard</span>
          </div>
          <div onClick={() => setCurrentView('followers')} className={navItemClass('followers')}>
            <Users size={20} />
            <span>Followers</span>
          </div>
          <div onClick={() => setCurrentView('following')} className={navItemClass('following')}>
            <Users size={20} />
            <span>Following</span>
          </div>
          <div onClick={() => setCurrentView('notFollowingMe')} className={navItemClass('notFollowingMe')}>
            <UserMinus size={20} />
            <span>Not Following Me</span>
          </div>
          <div onClick={() => setCurrentView('mutuals')} className={navItemClass('mutuals')}>
            <UserCheck size={20} />
            <span>Mutuals</span>
          </div>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 capitalize">
              {currentView === 'notFollowingMe' ? 'Not Following You' : currentView}
            </h1>
            <p className="text-gray-500 mt-1">
              {isScanning ? <span className="text-blue-600 font-medium">Tarama sürüyor... {scanStatus}</span> : 'Welcome back. Here is your account overview.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isScanning && (
              <button
                type="button"
                onClick={() => void handleStopScan()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm bg-red-600 text-white hover:bg-red-700"
              >
                <Square size={16} fill="currentColor" />
                Durdur
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleScanNow()}
              disabled={isScanning || !!actionInProgress}
              className={`px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm ${
                isScanning || actionInProgress
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : 'bg-gray-900 text-white hover:bg-gray-800'
              }`}
            >
              {isScanning ? 'Tarama Yapılıyor...' : 'Scan Now'}
            </button>
          </div>
        </div>

        {renderContent()}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// YARDIMCI FONKSİYONLAR
// ═══════════════════════════════════════════════════════════

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    // Zaten yüklenmiş olabilir
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        resolve();
        return;
      }
      if (tab.status === 'complete') {
        resolve();
        return;
      }

      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 20000);
    });
  });
}

function sendTabMessage<T = any>(tabId: number, message: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response as T);
      }
    });
  });
}

/**
 * Content script hazır mı?
 * Önce PING; yoksa reload (manifest content_scripts yeniden yükler).
 * executeScript ile çift inject ETME — çift listener / boğuk tarama yaratır.
 */
async function ensureContentScript(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await sendTabMessage(tabId, { type: 'PING' });
      return;
    } catch {
      if (attempt === 0) {
        // Bir kez programmatic inject dene (guard çift init'i engeller)
        try {
          const files = chrome.runtime.getManifest().content_scripts?.[0]?.js;
          if (files?.length) {
            await chrome.scripting.executeScript({ target: { tabId }, files });
            await wait(400);
            await sendTabMessage(tabId, { type: 'PING' });
            return;
          }
        } catch {
          // fall through to reload
        }
      }
      await chrome.tabs.reload(tabId);
      await waitForTabComplete(tabId);
      await wait(2000);
    }
  }
  throw new Error('Content script yüklenemedi. X sayfasını yenileyip tekrar dene.');
}

async function openScanPopup(
  url: string,
  focused = false
): Promise<{ windowId: number; tabId: number }> {
  const win = await chrome.windows.create({
    url,
    type: 'popup',
    // Daha yüksek pencere → sanal listede daha fazla hücre yüklenir
    width: 1200,
    height: 1000,
    focused,
  });

  const windowId = win.id;
  const tabId = win.tabs?.[0]?.id;
  if (!windowId || !tabId) {
    throw new Error('Tarama popup penceresi açılamadı.');
  }
  return { windowId, tabId };
}

async function startScanOnTab(tabId: number, scanId: string): Promise<void> {
  const res = await sendTabMessage<{ status?: string; scanId?: string }>(tabId, {
    type: 'SCAN_STARTED',
    payload: { scanId },
  });
  if (res?.status !== 'started' && res?.status !== 'success') {
    throw new Error('Tarama başlatılamadı (content script ACK vermedi).');
  }
}

/**
 * Belirli scanId için storage.scanResult yazılana kadar bekle.
 * completed | cancelled | error kabul edilir. Eski sonuçlar scanId ile elenir.
 * isAborted true olursa ve abortedByUser sonucu gelirse de çıkar.
 */
function waitForScanResult(
  scanId: string,
  timeoutMs: number,
  isAborted?: () => boolean
): Promise<{
  status: 'completed' | 'error' | 'cancelled';
  users?: any[];
  error?: string;
  completedAt?: number;
  scanId?: string;
}> {
  return new Promise((resolve, reject) => {
    let done = false;

    const matches = (result: any) => {
      if (!result) return false;
      const okStatus =
        result.status === 'completed' ||
        result.status === 'error' ||
        result.status === 'cancelled';
      if (!okStatus) return false;
      // Kullanıcı abort ettiyse scanId eşleşmese de (anında iptal) kabul et
      if (result.status === 'cancelled' && result.abortedByUser) return true;
      return result.scanId === scanId;
    };

    const finish = (result: any) => {
      if (done) return;
      done = true;
      chrome.storage.onChanged.removeListener(onChange);
      clearTimeout(timer);
      clearInterval(poll);
      resolve(result);
    };

    const onChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return;
      const result = changes.scanResult?.newValue;
      if (matches(result)) finish(result);
    };

    chrome.storage.onChanged.addListener(onChange);

    const poll = setInterval(() => {
      if (isAborted?.() && !done) {
        // content henüz cancelled yazmadıysa yine de bekle; handleStopScan yazar
      }
      chrome.storage.local.get(['scanResult'], (data) => {
        if (matches(data.scanResult)) finish(data.scanResult);
      });
    }, 400);

    chrome.storage.local.get(['scanResult'], (data) => {
      if (matches(data.scanResult)) finish(data.scanResult);
    });

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.storage.onChanged.removeListener(onChange);
      clearInterval(poll);
      reject(new Error('Tarama zaman aşımına uğradı (60 dk).'));
    }, timeoutMs);
  });
}

/** Açık X sekmelerinden veya geçici pencereden kullanıcı adını çöz. */
async function resolveXUsername(): Promise<string | null> {
  const { isValidXUsername, usernameFromUrl, normalizeXUsername } = await import(
    '../utils/x-username'
  );

  const accept = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const u = normalizeXUsername(raw);
    return isValidXUsername(u) ? u : null;
  };

  // 0) Daha önce başarıyla kaydedilmişse kullan
  try {
    const stored = await chrome.storage.local.get(['xUsername']);
    const saved = accept(stored.xUsername);
    if (saved) return saved;
  } catch {
    // ignore
  }

  // 1) URL'den: yalnızca /user/following|followers (home ASLA değil)
  const xTabs = await chrome.tabs.query({
    url: ['*://x.com/*', '*://*.x.com/*', '*://twitter.com/*', '*://*.twitter.com/*'],
  });
  for (const tab of xTabs) {
    const fromUrl = accept(usernameFromUrl(tab.url));
    if (fromUrl) {
      await chrome.storage.local.set({ xUsername: fromUrl });
      return fromUrl;
    }
  }

  // 2) Açık X sekmelerinde content script'ten sor
  for (const tab of xTabs) {
    if (!tab.id) continue;
    try {
      await ensureContentScript(tab.id);
      const res = await sendTabMessage<{ username?: string | null }>(tab.id, {
        type: 'GET_LOGGED_IN_USER',
      });
      const u = accept(res?.username);
      if (u) {
        await chrome.storage.local.set({ xUsername: u });
        return u;
      }
    } catch {
      // devam
    }
  }

  // 3) Geçici popup: home aç, profil linki / screen_name oku (home'u username sanma)
  let tempWinId: number | null = null;
  try {
    const { windowId, tabId } = await openScanPopup('https://x.com/home');
    tempWinId = windowId;
    await waitForTabComplete(tabId);
    await wait(3000);
    await ensureContentScript(tabId);

    for (let i = 0; i < 8; i++) {
      try {
        const res = await sendTabMessage<{ username?: string | null }>(tabId, {
          type: 'GET_LOGGED_IN_USER',
        });
        const u = accept(res?.username);
        if (u) {
          await chrome.storage.local.set({ xUsername: u });
          await chrome.windows.remove(windowId).catch(() => {});
          tempWinId = null;
          return u;
        }
      } catch {
        // retry
      }
      await wait(1000);
    }
  } catch {
    // fallthrough
  } finally {
    if (tempWinId != null) {
      await chrome.windows.remove(tempWinId).catch(() => {});
    }
  }

  // 4) Son çare: kullanıcıya sor (bir kez, sonra storage'a yaz)
  const typed = window.prompt(
    'X kullanıcı adın otomatik bulunamadı.\n\n@ olmadan kullanıcı adını yaz (örnek: elonmusk):'
  );
  const manual = accept(typed);
  if (manual) {
    await chrome.storage.local.set({ xUsername: manual });
    return manual;
  }

  return null;
}

export default Dashboard;
