import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Play,
  Square,
  UserX,
  UserCheck,
  Star,
  Users,
  Shield,
  Clock,
  Shuffle,
  AlertTriangle,
  ExternalLink,
  Check,
  Trash2,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { UnfollowerUser, UnfollowersSettings } from '../types/unfollowers';
import { unfollowersService } from '../services/unfollowers-service';
import { useAppStore } from '../store/app-store';
import { translations, Language } from '../i18n';

interface UnfollowersViewProps {
  lang: Language;
}

type TabFilter = 'all' | 'selected' | 'whitelisted';

export const UnfollowersView: React.FC<UnfollowersViewProps> = ({ lang }) => {
  const t = translations[lang].unfollowers;
  const { applyUnfollow } = useAppStore();

  // State'ler
  const [accounts, setAccounts] = useState<UnfollowerUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [whitelistIds, setWhitelistIds] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<UnfollowersSettings>({
    delaySeconds: 30,
    jitter: true,
    whitelist: [],
    dailyDate: '',
    dailyCount: 0,
  });

  // İşlem state'leri
  const [isScanning, setIsScanning] = useState(false);
  const [isUnfollowing, setIsUnfollowing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [statusType, setStatusType] = useState<'info' | 'warn' | 'ok' | 'err'>('info');
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Arama & Filtreleme
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Abort refs
  const scanAbortRef = useRef(false);
  const unfollowAbortRef = useRef(false);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ayarları ve önbellekteki veriyi yükle
  useEffect(() => {
    void (async () => {
      const s = await unfollowersService.getSettings();
      setSettings(s);
      setWhitelistIds(new Set(s.whitelist));

      // Önbellekteki son tarama sonucunu yükle
      try {
        const cached = await chrome.storage.local.get('xrm_cached_unfollowers');
        if (Array.isArray(cached.xrm_cached_unfollowers) && cached.xrm_cached_unfollowers.length > 0) {
          const wl = new Set(s.whitelist);
          const mapped = cached.xrm_cached_unfollowers.map((u: UnfollowerUser) => ({
            ...u,
            isWhitelisted: wl.has(u.id),
          }));
          setAccounts(mapped);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  // Ayar değişikliklerini kaydet
  const handleUpdateSettings = async (updates: Partial<UnfollowersSettings>) => {
    const updated = { ...settings, ...updates };
    setSettings(updated);
    await unfollowersService.saveSettings(updates);
  };

  // Yıldız / Koruma listesi toggle
  const toggleWhitelist = async (userId: string) => {
    const next = new Set(whitelistIds);
    if (next.has(userId)) {
      next.delete(userId);
    } else {
      next.add(userId);
      // Whitelist'e eklenince seçimden çıkar
      setSelectedIds((prev) => {
        const p = new Set(prev);
        p.delete(userId);
        return p;
      });
    }
    setWhitelistIds(next);

    // Hesaplar listesinde de güncelle
    setAccounts((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, isWhitelisted: next.has(userId) } : u))
    );

    const wlArray = Array.from(next);
    await handleUpdateSettings({ whitelist: wlArray });
  };

  // Seçim toggle
  const toggleSelect = (userId: string) => {
    if (whitelistIds.has(userId)) return; // Korumalı hesap seçilemez
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  // Toplu seçim fonksiyonları
  const selectAll = () => {
    const selectable = filteredAccounts.filter((u) => !whitelistIds.has(u.id));
    setSelectedIds(new Set(selectable.map((u) => u.id)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const selectNonWhitelisted = () => {
    const nonWl = accounts.filter((u) => !whitelistIds.has(u.id));
    setSelectedIds(new Set(nonWl.map((u) => u.id)));
  };

  // ═══════════════════════════════════════════════════════════
  // TARAMA MOTORU (0xAnubiss Direct API Scan)
  // ═══════════════════════════════════════════════════════════
  const handleStartScan = async () => {
    if (isScanning || isUnfollowing) return;

    setIsScanning(true);
    scanAbortRef.current = false;
    setStatusText(t.scanButton + '...');
    setStatusType('info');
    setProgressPercent(null);
    setSelectedIds(new Set());

    try {
      const nonFollowers = await unfollowersService.scanUnfollowers(
        (msg) => {
          setStatusText(msg);
        },
        (_count) => {
          // progress count update
        },
        () => scanAbortRef.current
      );

      if (scanAbortRef.current) {
        setStatusText(translations[lang].scan.stopping);
        setStatusType('warn');
        return;
      }

      setAccounts(nonFollowers);
      await chrome.storage.local.set({ xrm_cached_unfollowers: nonFollowers });

      if (nonFollowers.length === 0) {
        setStatusText(t.noUnfollowersFound);
        setStatusType('ok');
      } else {
        setStatusText(t.accountsFound(nonFollowers.length));
        setStatusType('ok');
      }
    } catch (err: any) {
      console.error('Scan failed:', err);
      setStatusText(err.message || 'Tarama hatası oluştu.');
      setStatusType('err');
    } finally {
      setIsScanning(false);
    }
  };

  const handleStopScan = () => {
    scanAbortRef.current = true;
    setStatusText(translations[lang].scan.stopping);
    setStatusType('warn');
  };

  // ═══════════════════════════════════════════════════════════
  // TAKİPTEN ÇIKARMA MOTORU (Delayed & Jittered Unfollow)
  // ═══════════════════════════════════════════════════════════
  const handleStartUnfollow = async () => {
    if (isUnfollowing || isScanning) return;

    const targets = accounts.filter(
      (u) => selectedIds.has(u.id) && !whitelistIds.has(u.id)
    );

    if (targets.length === 0) {
      alert('Lütfen takipten çıkarmak için en az bir hesap seçin.');
      return;
    }

    if (settings.delaySeconds < 15) {
      const ok = window.confirm(
        lang === 'tr'
          ? `Aralık süresi ${settings.delaySeconds} saniye olarak ayarlanmış. X kısıtlama riskini önlemek için 30+ saniye önerilir. Yine de devam etmek istiyor musunuz?`
          : `Delay is set to ${settings.delaySeconds}s. 30+ seconds is recommended to reduce restriction risk. Continue anyway?`
      );
      if (!ok) return;
    }

    setIsUnfollowing(true);
    unfollowAbortRef.current = false;
    setStatusType('info');

    let done = 0;
    let failed = 0;

    try {
      for (let i = 0; i < targets.length; i++) {
        if (unfollowAbortRef.current) break;

        const user = targets[i];
        setStatusText(t.unfollowingAccount(user.username, i + 1, targets.length));
        setProgressPercent(Math.round((i / targets.length) * 100));

        try {
          await unfollowersService.unfollowUser(user);
          done++;

          // Günlük sayacı artır
          const newCount = await unfollowersService.incrementDailyCount();
          setSettings((prev) => ({ ...prev, dailyCount: newCount }));

          // UI ve ana DB'den çıkar
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(user.id);
            return next;
          });

          setAccounts((prev) => {
            const next = prev.filter((u) => u.id !== user.id);
            void chrome.storage.local.set({ xrm_cached_unfollowers: next });
            return next;
          });

          // Ana store ile senkronize et
          void applyUnfollow(user.username);
        } catch (err: any) {
          failed++;
          console.warn(`Unfollow @${user.username} failed:`, err);

          if (err?.status === 429) {
            setStatusText(t.rateLimitWarning);
            setStatusType('warn');
            await new Promise((r) => setTimeout(r, 60000));
            i--; // Tekrar dene
            continue;
          }

          setStatusText(`@${user.username} çıkarılamadı: ${err?.message || 'Hata'}`);
          setStatusType('warn');
          await new Promise((r) => setTimeout(r, 1500));
        }

        // Son hesap değilse ve iptal edilmediyse bekle (Jitter ile)
        if (i < targets.length - 1 && !unfollowAbortRef.current) {
          const delayMs = unfollowersService.calculateDelayMs(
            settings.delaySeconds,
            settings.jitter
          );
          const endTime = Date.now() + delayMs;

          while (Date.now() < endTime) {
            if (unfollowAbortRef.current) break;
            const remainingSec = Math.max(1, Math.ceil((endTime - Date.now()) / 1000));
            setCountdown(remainingSec);
            await new Promise((r) => setTimeout(r, 200));
          }
          setCountdown(null);
        }
      }

      setProgressPercent(100);
      setCountdown(null);

      if (unfollowAbortRef.current) {
        setStatusText(t.stoppedMessage(done, failed));
        setStatusType('warn');
      } else {
        setStatusText(t.completedMessage(done, failed));
        setStatusType('ok');
      }
    } catch (e: any) {
      setStatusText('İşlem sırasında hata oluştu: ' + (e.message || String(e)));
      setStatusType('err');
    } finally {
      setIsUnfollowing(false);
      setCountdown(null);
    }
  };

  const handleStopUnfollow = () => {
    unfollowAbortRef.current = true;
    setStatusText(translations[lang].scan.stopping);
    setStatusType('warn');
  };

  // Tekil takipten çıkarma
  const handleSingleUnfollow = async (user: UnfollowerUser) => {
    const confirmMsg =
      lang === 'tr'
        ? `@${user.username} hesabını takipten çıkarmak istediğinize emin misiniz?`
        : `Are you sure you want to unfollow @${user.username}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await unfollowersService.unfollowUser(user);
      await unfollowersService.incrementDailyCount();
      setSettings((prev) => ({ ...prev, dailyCount: prev.dailyCount + 1 }));

      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });

      setAccounts((prev) => {
        const next = prev.filter((u) => u.id !== user.id);
        void chrome.storage.local.set({ xrm_cached_unfollowers: next });
        return next;
      });

      void applyUnfollow(user.username);
    } catch (err: any) {
      alert('Takipten çıkarılamadı: ' + (err?.message || String(err)));
    }
  };

  // ═══════════════════════════════════════════════════════════
  // FİLTRELEME & HESAPLAMA
  // ═══════════════════════════════════════════════════════════
  const filteredAccounts = useMemo(() => {
    return accounts.filter((u) => {
      // Tab filtreleme
      if (activeTab === 'selected' && !selectedIds.has(u.id)) return false;
      if (activeTab === 'whitelisted' && !whitelistIds.has(u.id)) return false;

      // Metin arama
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        u.username.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.id.includes(q)
      );
    });
  }, [accounts, activeTab, selectedIds, whitelistIds, searchQuery]);

  const selectedCount = selectedIds.size;
  const whitelistedCount = whitelistIds.size;

  return (
    <div className="space-y-6">
      {/* ── Üst Başlık ve Tanıtım ── */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white rounded-2xl p-6 shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-500/20 text-blue-400 rounded-xl border border-blue-400/20">
                <Sparkles size={22} />
              </div>
              <h2 className="text-xl font-bold tracking-tight">{t.title}</h2>
            </div>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">{t.subtitle}</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSettingsModal(!showSettingsModal)}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white rounded-xl backdrop-blur-sm border border-white/10 transition-colors"
            >
              <Sliders size={15} />
              {lang === 'tr' ? 'Aralık & Güvenlik' : 'Delay & Safety'}
            </button>

            {isScanning ? (
              <button
                onClick={handleStopScan}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl shadow-sm transition-all"
              >
                <Square size={16} fill="currentColor" />
                {t.stopButton}
              </button>
            ) : (
              <button
                onClick={handleStartScan}
                disabled={isUnfollowing}
                className={`flex items-center gap-2 px-5 py-2.5 font-medium rounded-xl shadow-sm transition-all ${
                  isUnfollowing
                    ? 'bg-blue-400/50 text-white/50 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/25'
                }`}
              >
                <Play size={16} fill="currentColor" />
                {t.scanButton}
              </button>
            )}
          </div>
        </div>

        {/* Güvenlik & Ayar Açılır Paneli */}
        {showSettingsModal && (
          <div className="mt-5 pt-5 border-t border-white/15 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/10">
              <Clock size={18} className="text-blue-400 flex-shrink-0" />
              <div className="flex-1">
                <label className="block text-slate-300 font-medium mb-1">{t.intervalLabel}</label>
                <input
                  type="number"
                  min="5"
                  max="600"
                  value={settings.delaySeconds}
                  onChange={(e) =>
                    handleUpdateSettings({
                      delaySeconds: Math.max(5, Math.min(600, parseInt(e.target.value, 10) || 30)),
                    })
                  }
                  className="w-24 bg-black/40 border border-white/20 rounded-lg px-2.5 py-1 text-white text-sm font-semibold focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/10">
              <div className="flex items-center gap-2.5">
                <Shuffle size={18} className="text-indigo-400 flex-shrink-0" />
                <div>
                  <span className="block text-white font-medium">{t.jitterLabel}</span>
                  <span className="text-slate-400 text-[11px]">{t.jitterTooltip}</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.jitter}
                onChange={(e) => handleUpdateSettings({ jitter: e.target.checked })}
                className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── İstatistik Kartları ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-red-50 text-red-600 rounded-xl">
            <UserX size={20} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">{t.statNonFollowers}</p>
            <p className="text-xl font-bold text-gray-900">{accounts.length}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Check size={20} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">{t.statSelected}</p>
            <p className="text-xl font-bold text-gray-900">{selectedCount}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Star size={20} className="fill-amber-500 text-amber-500" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">{t.statWhitelisted}</p>
            <p className="text-xl font-bold text-gray-900">{whitelistedCount}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">{t.statDaily}</p>
            <p className="text-xl font-bold text-gray-900">{settings.dailyCount}</p>
          </div>
        </div>
      </div>

      {/* ── Canlı Durum & Geri Sayım & İlerleme Çubuğu ── */}
      {(statusText || isScanning || isUnfollowing) && (
        <div
          className={`p-4 rounded-xl border flex flex-col gap-2 transition-all ${
            statusType === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : statusType === 'warn'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : statusType === 'err'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  isScanning || isUnfollowing
                    ? 'animate-ping bg-blue-600'
                    : statusType === 'err'
                    ? 'bg-red-600'
                    : statusType === 'ok'
                    ? 'bg-emerald-600'
                    : 'bg-gray-400'
                }`}
              />
              <span>{statusText}</span>
            </div>

            <div className="flex items-center gap-2">
              {statusType === 'err' && (
                <button
                  type="button"
                  onClick={async () => {
                    await chrome.tabs.create({ url: 'https://x.com/home' });
                    setStatusText('x.com sekmesi açıldı. Giriş yaptıktan sonra tekrar "Taramayı Başlat" düğmesine basın.');
                    setStatusType('info');
                  }}
                  className="px-3 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
                >
                  <ExternalLink size={13} />
                  {lang === 'tr' ? 'x.com Sekmesini Aç' : 'Open x.com Tab'}
                </button>
              )}

              {countdown !== null && (
                <span className="text-xs font-bold px-2.5 py-1 bg-blue-600 text-white rounded-full animate-pulse">
                  {t.nextAccountIn(countdown)}
                </span>
              )}
            </div>
          </div>

          {progressPercent !== null && (
            <div className="w-full bg-blue-200/50 rounded-full h-2 overflow-hidden mt-1">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Eylem ve Filtreleme Araç Çubuğu ── */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
          {/* Arama Kutusu */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          {/* Çıkarma Butonları */}
          <div className="flex items-center gap-2">
            {isUnfollowing ? (
              <button
                onClick={handleStopUnfollow}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
              >
                <Square size={15} fill="currentColor" />
                {t.stopButton}
              </button>
            ) : (
              <button
                onClick={handleStartUnfollow}
                disabled={selectedCount === 0 || isScanning}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg shadow-sm transition-colors ${
                  selectedCount === 0 || isScanning
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
                    : 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/20'
                }`}
              >
                <UserX size={16} />
                {t.unfollowSelectedButton(selectedCount)}
              </button>
            )}
          </div>
        </div>

        {/* Alt Seçim ve Filtreleme Butonları */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 text-xs">
          {/* Sekme Butonları */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'all'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.filterAll} ({accounts.length})
            </button>
            <button
              onClick={() => setActiveTab('selected')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'selected'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.filterSelected} ({selectedCount})
            </button>
            <button
              onClick={() => setActiveTab('whitelisted')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'whitelisted'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.filterWhitelisted} ({whitelistedCount})
            </button>
          </div>

          {/* Hızlı Seçim Aksiyonları */}
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="px-2.5 py-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
            >
              {t.selectAll}
            </button>
            <button
              onClick={selectNonWhitelisted}
              className="px-2.5 py-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
            >
              {t.selectNonWhitelisted}
            </button>
            <button
              onClick={selectNone}
              className="px-2.5 py-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
            >
              {t.selectNone}
            </button>
          </div>
        </div>
      </div>

      {/* ── Hesaplar Tablosu / Listesi ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {filteredAccounts.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <UserCheck size={40} className="mx-auto mb-3 text-gray-300" />
            <p className="text-base font-semibold text-gray-600">
              {accounts.length === 0 ? t.noUnfollowersFound : 'Filtreyle eşleşen hesap bulunamadı.'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {accounts.length === 0
                ? 'Taramayı başlatarak seni geri takip etmeyenleri görebilirsin.'
                : 'Filtreleri veya arama terimini değiştirin.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredAccounts.map((user) => {
              const isSelected = selectedIds.has(user.id);
              const isStarred = whitelistIds.has(user.id);

              return (
                <div
                  key={user.id}
                  className={`p-4 flex items-center justify-between gap-4 transition-colors hover:bg-gray-50/80 ${
                    isSelected ? 'bg-blue-50/40' : isStarred ? 'bg-amber-50/20' : ''
                  }`}
                >
                  {/* Sol: Checkbox + Yıldız + Avatar + Bilgiler */}
                  <div className="flex items-center gap-3.5 min-w-0">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isStarred || isUnfollowing}
                      onChange={() => toggleSelect(user.id)}
                      className={`w-4 h-4 rounded accent-blue-600 transition-colors ${
                        isStarred ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    />

                    {/* Yıldız (Koruma) Butonu */}
                    <button
                      onClick={() => toggleWhitelist(user.id)}
                      title={isStarred ? t.protectTooltipRemove : t.protectTooltipAdd}
                      className={`p-1 rounded-lg transition-colors ${
                        isStarred
                          ? 'text-amber-500 hover:bg-amber-100'
                          : 'text-gray-300 hover:text-amber-500 hover:bg-gray-100'
                      }`}
                    >
                      <Star size={18} className={isStarred ? 'fill-amber-500' : ''} />
                    </button>

                    {/* Avatar */}
                    <img
                      src={user.avatar || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'}
                      alt={user.name}
                      className="w-10 h-10 rounded-full object-cover border border-gray-200 flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
                      }}
                    />

                    {/* İsim ve @username */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm text-gray-900 truncate">
                          {user.name}
                        </span>
                        {user.verified && (
                          <span
                            className="inline-block w-4 h-4 text-blue-500 flex-shrink-0"
                            title="Doğrulanmış Hesap"
                          >
                            ✓
                          </span>
                        )}
                        {isStarred && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full">
                            Koruma Altında
                          </span>
                        )}
                      </div>
                      <a
                        href={`https://x.com/${user.username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-gray-500 hover:text-blue-600 hover:underline flex items-center gap-1"
                      >
                        @{user.username}
                        <ExternalLink size={11} className="opacity-60" />
                      </a>
                    </div>
                  </div>

                  {/* Sağ: İstatistikler ve Tekil Çıkar Butonu */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
                      <span title="Takipçi">
                        <strong className="text-gray-700 font-semibold">{user.followers.toLocaleString()}</strong> Takipçi
                      </span>
                      <span className="text-gray-300">•</span>
                      <span className="px-2 py-0.5 bg-red-50 text-red-600 rounded-md font-medium text-[11px]">
                        {t.notFollowingYouBadge}
                      </span>
                    </div>

                    <button
                      onClick={() => handleSingleUnfollow(user)}
                      disabled={isUnfollowing}
                      className="px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-red-600 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition-colors"
                    >
                      {translations[lang].table.unfollow}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
