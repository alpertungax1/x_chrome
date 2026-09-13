import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Play,
  Square,
  UserX,
  UserCheck,
  Star,
  Clock,
  Shuffle,
  ExternalLink,
  Check,
  Sliders,
  Sparkles,
  ArrowUpDown,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
  Shield,
  Coffee,
  AlertTriangle,
} from 'lucide-react';
import { UnfollowerUser, UnfollowersSettings, SafetyPreset } from '../types/unfollowers';
import { unfollowersService } from '../services/unfollowers-service';
import { useAppStore } from '../store/app-store';
import { translations, Language } from '../i18n';

interface UnfollowersViewProps {
  lang: Language;
}

type TabFilter = 'all' | 'selected' | 'whitelisted';

type SortOption =
  | 'default'
  | 'oldest'
  | 'followers_desc'
  | 'followers_asc'
  | 'name_asc'
  | 'name_desc';

export const UnfollowersView: React.FC<UnfollowersViewProps> = ({ lang }) => {
  const t = translations[lang].unfollowers;
  const { applyUnfollow } = useAppStore();

  // Ana Veri State'leri
  const [accounts, setAccounts] = useState<UnfollowerUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [whitelistIds, setWhitelistIds] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<UnfollowersSettings>({
    delaySeconds: 30,
    minDelaySeconds: 20,
    maxDelaySeconds: 45,
    jitter: true,
    safetyPreset: 'safe',
    enableBatchCooldown: true,
    batchSize: 15,
    cooldownSeconds: 180,
    dailyLimit: 150,
    whitelist: [],
    dailyDate: '',
    dailyCount: 0,
  });

  // İşlem State'leri
  const [isScanning, setIsScanning] = useState(false);
  const [isUnfollowing, setIsUnfollowing] = useState(false);
  const [isResting, setIsResting] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [statusType, setStatusType] = useState<'info' | 'warn' | 'ok' | 'err'>('info');
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [currentDelayRangeText, setCurrentDelayRangeText] = useState<string>('');

  // Arama, Sekme, Filtre & Sıralama
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>('default');
  const [minFollowers, setMinFollowers] = useState<number | ''>('');
  const [maxFollowers, setMaxFollowers] = useState<number | ''>('');
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>(null);

  // Sayfalama (Pagination)
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50); // 25, 50, 100, 250, 0 (Tümü)

  // Abort Refs
  const scanAbortRef = useRef(false);
  const unfollowAbortRef = useRef(false);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listTopRef = useRef<HTMLDivElement | null>(null);

  // Ayarları ve önbellekteki veriyi yükle
  useEffect(() => {
    void (async () => {
      const s = await unfollowersService.getSettings();
      setSettings(s);
      setWhitelistIds(new Set(s.whitelist));

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

  // Filtreler veya arama değiştiğinde sayfayı 1'e sıfırla
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeTab, sortOption, minFollowers, maxFollowers, activeQuickFilter, pageSize]);

  // Ayar değişikliklerini kaydet
  const handleUpdateSettings = async (updates: Partial<UnfollowersSettings>) => {
    const updated = { ...settings, ...updates };
    setSettings(updated);
    await unfollowersService.saveSettings(updates);
  };

  // Güvenlik profili değiştirme
  const applySafetyPreset = async (preset: SafetyPreset) => {
    let updates: Partial<UnfollowersSettings> = { safetyPreset: preset };
    if (preset === 'safe') {
      updates = {
        ...updates,
        minDelaySeconds: 25,
        maxDelaySeconds: 50,
        jitter: true,
        enableBatchCooldown: true,
        batchSize: 15,
        cooldownSeconds: 180,
      };
    } else if (preset === 'balanced') {
      updates = {
        ...updates,
        minDelaySeconds: 15,
        maxDelaySeconds: 30,
        jitter: true,
        enableBatchCooldown: true,
        batchSize: 20,
        cooldownSeconds: 120,
      };
    } else if (preset === 'fast') {
      updates = {
        ...updates,
        minDelaySeconds: 8,
        maxDelaySeconds: 15,
        jitter: true,
        enableBatchCooldown: false,
      };
    }
    await handleUpdateSettings(updates);
  };

  // Yıldız / Koruma listesi toggle
  const toggleWhitelist = async (userId: string) => {
    const next = new Set(whitelistIds);
    if (next.has(userId)) {
      next.delete(userId);
    } else {
      next.add(userId);
      setSelectedIds((prev) => {
        const p = new Set(prev);
        p.delete(userId);
        return p;
      });
    }
    setWhitelistIds(next);

    setAccounts((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, isWhitelisted: next.has(userId) } : u))
    );

    const wlArray = Array.from(next);
    await handleUpdateSettings({ whitelist: wlArray });
  };

  // Seçim toggle
  const toggleSelect = (userId: string) => {
    if (whitelistIds.has(userId)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  // Toplu seçim fonksiyonları
  const selectAllFiltered = () => {
    const selectable = filteredAndSortedAccounts.filter((u) => !whitelistIds.has(u.id));
    setSelectedIds(new Set(selectable.map((u) => u.id)));
  };

  const selectCurrentPageOnly = () => {
    const selectable = paginatedAccounts.filter((u) => !whitelistIds.has(u.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      selectable.forEach((u) => next.add(u.id));
      return next;
    });
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const selectNonWhitelisted = () => {
    const nonWl = accounts.filter((u) => !whitelistIds.has(u.id));
    setSelectedIds(new Set(nonWl.map((u) => u.id)));
  };

  // Hızlı takipçi filtreleri
  const applyQuickFilter = (type: string, min: number | '', max: number | '') => {
    if (activeQuickFilter === type) {
      setActiveQuickFilter(null);
      setMinFollowers('');
      setMaxFollowers('');
    } else {
      setActiveQuickFilter(type);
      setMinFollowers(min);
      setMaxFollowers(max);
    }
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setMinFollowers('');
    setMaxFollowers('');
    setActiveQuickFilter(null);
    setSortOption('default');
    setActiveTab('all');
  };

  // ═══════════════════════════════════════════════════════════
  // TARAMA MOTORU (Direct API Scan)
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
          // progress count
        },
        () => scanAbortRef.current
      );

      if (nonFollowers.length > 0) {
        setAccounts(nonFollowers);
        await chrome.storage.local.set({ xrm_cached_unfollowers: nonFollowers });

        // Ana IndexedDB kullanıcı tablosundaki takipçi sayılarını da senkronize et
        try {
          const appStore = useAppStore.getState();
          const currentUsers = appStore.users;
          if (currentUsers && currentUsers.length > 0) {
            const map = new Map(nonFollowers.map((u) => [u.username.toLowerCase(), u.followers]));
            const updates: { id: string; followersCount: number }[] = [];
            for (const u of currentUsers) {
              const count = map.get(u.username.toLowerCase());
              if (typeof count === 'number' && u.followersCount !== count) {
                updates.push({ id: u.id, followersCount: count });
              }
            }
            if (updates.length > 0) {
              await appStore.updateUsersBatch(updates);
            }
          }
        } catch (syncErr) {
          console.warn('Sync with main store failed:', syncErr);
        }
      }

      if (scanAbortRef.current) {
        setStatusText(translations[lang].scan.stopping + ` (${nonFollowers.length} hesap kaydedildi)`);
        setStatusType('warn');
        return;
      }

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
    void unfollowersService.stopFullScanDirect();
    setStatusText(translations[lang].scan.stopping);
    setStatusType('warn');
  };

  // ═══════════════════════════════════════════════════════════
  // GELİŞMİŞ TAKİPTEN ÇIKARMA MOTORU (Anti-Ban & Dynamic Jitter)
  // ═══════════════════════════════════════════════════════════
  const handleStartUnfollow = async () => {
    if (isUnfollowing || isScanning) return;

    const targets = accounts.filter(
      (u) => selectedIds.has(u.id) && !whitelistIds.has(u.id)
    );

    if (targets.length === 0) {
      alert(lang === 'tr' ? 'Lütfen takipten çıkarmak için en az bir hesap seçin.' : 'Please select at least one account to unfollow.');
      return;
    }

    // Günlük limit kontrolü
    if (settings.dailyLimit > 0 && settings.dailyCount >= settings.dailyLimit) {
      alert(t.dailyLimitReached(settings.dailyLimit));
      return;
    }

    if (settings.minDelaySeconds < 10) {
      const ok = window.confirm(
        lang === 'tr'
          ? `Minimum bekleme süresi ${settings.minDelaySeconds} saniye olarak ayarlanmış. X kısıtlama riskini önlemek için 20+ saniye önerilir. Yine de devam etmek istiyor musunuz?`
          : `Min delay is set to ${settings.minDelaySeconds}s. 20+ seconds is recommended to prevent restriction risk. Continue anyway?`
      );
      if (!ok) return;
    }

    setIsUnfollowing(true);
    setIsResting(false);
    unfollowAbortRef.current = false;
    setStatusType('info');

    let done = 0;
    let failed = 0;
    let batchConsecutiveCount = 0;

    try {
      // En güncel ayarları doğrudan storage'dan çek
      const currentSettings = await unfollowersService.getSettings();
      setSettings(currentSettings);

      // Doğal Anti-Ban Hazırlık Molası (3 sn)
      setStatusText(
        lang === 'tr'
          ? `🛡️ Anti-Ban koruması aktif (${currentSettings.minDelaySeconds}-${currentSettings.maxDelaySeconds}s). Güvenli oturum hazırlanıyor...`
          : `🛡️ Anti-Ban active (${currentSettings.minDelaySeconds}-${currentSettings.maxDelaySeconds}s). Preparing safe session...`
      );
      const initEnd = Date.now() + 3000;
      while (Date.now() < initEnd) {
        if (unfollowAbortRef.current) break;
        const remainingSec = Math.max(1, Math.ceil((initEnd - Date.now()) / 1000));
        setCountdown(remainingSec);
        await new Promise((r) => setTimeout(r, 200));
      }
      setCountdown(null);

      for (let i = 0; i < targets.length; i++) {
        if (unfollowAbortRef.current) break;

        // Günlük limit kontrolü
        if (currentSettings.dailyLimit > 0 && currentSettings.dailyCount + done >= currentSettings.dailyLimit) {
          setStatusText(t.dailyLimitReached(currentSettings.dailyLimit));
          setStatusType('warn');
          break;
        }

        const user = targets[i];
        setStatusText(t.unfollowingAccount(user.username, i + 1, targets.length));
        setProgressPercent(Math.round((i / targets.length) * 100));

        try {
          await unfollowersService.unfollowUser(user);
          done++;
          batchConsecutiveCount++;

          const newCount = await unfollowersService.incrementDailyCount();
          setSettings((prev) => ({ ...prev, dailyCount: newCount }));

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
          failed++;
          console.warn(`Unfollow @${user.username} failed:`, err);

          if (err?.status === 429) {
            setStatusText(t.rateLimitWarning);
            setStatusType('warn');
            await new Promise((r) => setTimeout(r, 60000));
            i--;
            continue;
          }

          setStatusText(`@${user.username} çıkarılamadı (${err?.message || 'Hata'}). Güvenli süre bekleniyor...`);
          setStatusType('warn');
          await new Promise((r) => setTimeout(r, 3000));
        }

        if (i < targets.length - 1 && !unfollowAbortRef.current) {
          // 1. Periyodik Dinlenme Molası (Anti-Bot Rest Period)
          if (
            currentSettings.enableBatchCooldown &&
            currentSettings.batchSize > 0 &&
            batchConsecutiveCount >= currentSettings.batchSize
          ) {
            batchConsecutiveCount = 0;
            setIsResting(true);
            const cooldownEndTime = Date.now() + currentSettings.cooldownSeconds * 1000;

            while (Date.now() < cooldownEndTime) {
              if (unfollowAbortRef.current) break;
              const remainingCooldown = Math.max(1, Math.ceil((cooldownEndTime - Date.now()) / 1000));
              setCountdown(remainingCooldown);
              setStatusText(t.restingCooldown(remainingCooldown, done));
              setStatusType('warn');
              await new Promise((r) => setTimeout(r, 250));
            }

            setIsResting(false);
            if (unfollowAbortRef.current) break;
          }

          // 2. Rastgele İnsansı Aralık (Dynamic Jittered Delay)
          const delayMs = unfollowersService.calculateDelayMs(
            currentSettings.minDelaySeconds,
            currentSettings.maxDelaySeconds,
            currentSettings.jitter
          );
          setCurrentDelayRangeText(`${currentSettings.minDelaySeconds}-${currentSettings.maxDelaySeconds}s`);
          const endTime = Date.now() + delayMs;

          setStatusText(
            lang === 'tr'
              ? `🛡️ @${user.username} takipten çıkarıldı. Anti-Ban: Sonraki hesap için bekleniyor...`
              : `🛡️ Unfollowed @${user.username}. Anti-Ban: Waiting for next account...`
          );

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
      setIsResting(false);

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
      setIsResting(false);
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
      // Doğal insan ritmi / Anti-Ban mikro beklemesi (1.2 sn)
      setStatusText(lang === 'tr' ? `🛡️ @${user.username} güvenle takipten çıkarılıyor...` : `🛡️ Safely unfollowing @${user.username}...`);
      await new Promise((r) => setTimeout(r, 1200));
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

    } catch (err: any) {
      console.warn(`Unfollow @${user.username} failed:`, err);
      setStatusText(`@${user.username} çıkarılamadı: ${err?.message || 'Hata'}`);
      setStatusType('warn');
    }
  };

  // ═══════════════════════════════════════════════════════════
  // FİLTRELEME & SIRALAMA & SAYFALAMA HESAPLAMALARI
  // ═══════════════════════════════════════════════════════════
  const filteredAndSortedAccounts = useMemo(() => {
    // 1. Filtreleme
    const filtered = accounts.filter((u) => {
      if (activeTab === 'selected' && !selectedIds.has(u.id)) return false;
      if (activeTab === 'whitelisted' && !whitelistIds.has(u.id)) return false;

      if (minFollowers !== '' && u.followers < minFollowers) return false;
      if (maxFollowers !== '' && u.followers > maxFollowers) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        u.username.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.id.includes(q)
      );
    });

    // 2. Sıralama
    const sorted = [...filtered];
    switch (sortOption) {
      case 'default':
        // Varsayılan: #1 en son (en yeni) takip edilenler en üstte
        break;
      case 'oldest':
        // Eskiden yeniye: En ilk (en eski) takip edilenler en üstte
        sorted.reverse();
        break;
      case 'followers_desc':
        sorted.sort((a, b) => b.followers - a.followers);
        break;
      case 'followers_asc':
        sorted.sort((a, b) => a.followers - b.followers);
        break;
      case 'name_asc':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name_desc':
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      default:
        break;
    }

    return sorted;
  }, [accounts, activeTab, selectedIds, whitelistIds, minFollowers, maxFollowers, searchQuery, sortOption]);

  // Sayfalama Dilimi
  const totalFilteredCount = filteredAndSortedAccounts.length;
  const effectivePageSize = pageSize === 0 ? totalFilteredCount || 1 : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / effectivePageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedAccounts = useMemo(() => {
    if (pageSize === 0) return filteredAndSortedAccounts;
    const start = (validCurrentPage - 1) * pageSize;
    return filteredAndSortedAccounts.slice(start, start + pageSize);
  }, [filteredAndSortedAccounts, validCurrentPage, pageSize]);

  const fromIndex = totalFilteredCount === 0 ? 0 : (validCurrentPage - 1) * effectivePageSize + 1;
  const toIndex = Math.min(validCurrentPage * effectivePageSize, totalFilteredCount);

  const selectedCount = selectedIds.size;
  const whitelistedCount = whitelistIds.size;

  const handlePageChange = (newPage: number) => {
    const clamped = Math.min(Math.max(1, newPage), totalPages);
    setCurrentPage(clamped);
    if (listTopRef.current) {
      listTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  return (
    <div className="space-y-6" ref={listTopRef}>
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
              {/* Aktif Güvenlik Profili Rozeti */}
              <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                <Shield size={11} />
                {settings.safetyPreset === 'safe'
                  ? `Anti-Ban (${settings.minDelaySeconds}-${settings.maxDelaySeconds}s)`
                  : settings.safetyPreset === 'balanced'
                  ? `Dengeli (${settings.minDelaySeconds}-${settings.maxDelaySeconds}s)`
                  : settings.safetyPreset === 'fast'
                  ? `Hızlı (${settings.minDelaySeconds}-${settings.maxDelaySeconds}s)`
                  : `Özel (${settings.minDelaySeconds}-${settings.maxDelaySeconds}s)`}
              </span>
            </div>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">{t.subtitle}</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSettingsModal(!showSettingsModal)}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl backdrop-blur-sm border transition-all ${
                showSettingsModal
                  ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                  : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
              }`}
            >
              <Sliders size={15} />
              {t.safety.title}
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

        {/* ── Gelişmiş Anti-Ban & Güvenlik Ayarları Modal Paneli ── */}
        {showSettingsModal && (
          <div className="mt-5 pt-5 border-t border-white/15 space-y-4 text-xs">
            {/* Güvenlik Profili Preset Kartları */}
            <div>
              <label className="block text-slate-300 font-semibold mb-2">{t.safety.presetLabel}</label>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                {[
                  {
                    id: 'safe' as const,
                    title: t.safety.presetSafe,
                    desc: '25-50s rastgele + 3 dk mola',
                    badge: 'Anti-Ban',
                    color: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
                  },
                  {
                    id: 'balanced' as const,
                    title: t.safety.presetBalanced,
                    desc: '15-30s rastgele + 2 dk mola',
                    badge: 'Standart',
                    color: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
                  },
                  {
                    id: 'fast' as const,
                    title: t.safety.presetFast,
                    desc: '8-15s rastgele (molasız)',
                    badge: 'Hızlı',
                    color: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
                  },
                  {
                    id: 'custom' as const,
                    title: t.safety.presetCustom,
                    desc: 'Özel süre & mola ayarları',
                    badge: 'Manuel',
                    color: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
                  },
                ].map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applySafetyPreset(preset.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      settings.safetyPreset === preset.id
                        ? `${preset.color} ring-2 ring-blue-400 font-semibold`
                        : 'bg-white/5 border-white/10 hover:bg-white/10 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{preset.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white">
                        {preset.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">{preset.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Ayrıntılı Süre ve Mola Girişleri */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Min - Max Rastgele Aralık */}
              <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                <label className="block text-slate-300 font-medium mb-1.5 flex items-center gap-1.5">
                  <Clock size={14} className="text-blue-400" />
                  {t.randomRangeLabel}
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <span className="text-[10px] text-slate-400 block mb-0.5">{t.minIntervalLabel}</span>
                    <input
                      type="number"
                      min="3"
                      max="600"
                      value={settings.minDelaySeconds}
                      onChange={(e) => {
                        handleUpdateSettings({
                          safetyPreset: 'custom',
                          minDelaySeconds: Math.max(3, parseInt(e.target.value, 10) || 5),
                        });
                      }}
                      className="w-full bg-black/40 border border-white/20 rounded-lg px-2.5 py-1 text-white text-sm font-semibold focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <span className="text-slate-400 mt-3">-</span>
                  <div className="flex-1">
                    <span className="text-[10px] text-slate-400 block mb-0.5">{t.maxIntervalLabel}</span>
                    <input
                      type="number"
                      min="5"
                      max="600"
                      value={settings.maxDelaySeconds}
                      onChange={(e) => {
                        handleUpdateSettings({
                          safetyPreset: 'custom',
                          maxDelaySeconds: Math.max(5, parseInt(e.target.value, 10) || 10),
                        });
                      }}
                      className="w-full bg-black/40 border border-white/20 rounded-lg px-2.5 py-1 text-white text-sm font-semibold focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </div>
              </div>

              {/* Periyodik Dinlenme Molası */}
              <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-slate-300 font-medium flex items-center gap-1.5">
                    <Coffee size={14} className="text-amber-400" />
                    {t.safety.cooldownTitle}
                  </label>
                  <input
                    type="checkbox"
                    checked={settings.enableBatchCooldown}
                    onChange={(e) => {
                      handleUpdateSettings({
                        safetyPreset: 'custom',
                        enableBatchCooldown: e.target.checked,
                      });
                    }}
                    className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 opacity-95">
                  <div>
                    <span className="text-[10px] text-slate-400 block mb-0.5">Her X Kişide:</span>
                    <input
                      type="number"
                      min="5"
                      max="100"
                      disabled={!settings.enableBatchCooldown}
                      value={settings.batchSize}
                      onChange={(e) => {
                        handleUpdateSettings({
                          safetyPreset: 'custom',
                          batchSize: Math.max(5, parseInt(e.target.value, 10) || 15),
                        });
                      }}
                      className="w-full bg-black/40 border border-white/20 rounded-lg px-2.5 py-1 text-white text-sm font-semibold focus:outline-none focus:border-blue-400 disabled:opacity-40"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block mb-0.5">Mola (sn):</span>
                    <input
                      type="number"
                      min="10"
                      max="600"
                      disabled={!settings.enableBatchCooldown}
                      value={settings.cooldownSeconds}
                      onChange={(e) => {
                        handleUpdateSettings({
                          safetyPreset: 'custom',
                          cooldownSeconds: Math.max(10, parseInt(e.target.value, 10) || 180),
                        });
                      }}
                      className="w-full bg-black/40 border border-white/20 rounded-lg px-2.5 py-1 text-white text-sm font-semibold focus:outline-none focus:border-blue-400 disabled:opacity-40"
                    />
                  </div>
                </div>
              </div>

              {/* Günlük Maksimum Limit & Jitter */}
              <div className="bg-white/5 p-3 rounded-xl border border-white/10 flex flex-col justify-between">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    {t.safety.dailyLimitLabel}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    value={settings.dailyLimit}
                    onChange={(e) => {
                      handleUpdateSettings({
                        dailyLimit: Math.max(0, parseInt(e.target.value, 10) || 0),
                      });
                    }}
                    className="w-full bg-black/40 border border-white/20 rounded-lg px-2.5 py-1 text-white text-sm font-semibold focus:outline-none focus:border-blue-400"
                  />
                </div>

                <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                  <div className="flex items-center gap-1.5">
                    <Shuffle size={13} className="text-indigo-400" />
                    <span className="text-slate-300 text-[11px] font-medium">{t.jitterLabel}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.jitter}
                    onChange={(e) => handleUpdateSettings({ jitter: e.target.checked })}
                    className="w-3.5 h-3.5 accent-blue-500 rounded cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="text-[11px] text-amber-300/90 bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20 flex items-center gap-2">
              <AlertTriangle size={14} className="flex-shrink-0" />
              <span>{t.safetyNotice}</span>
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
            <div className="flex items-baseline gap-1">
              <p className="text-xl font-bold text-gray-900">{settings.dailyCount}</p>
              {settings.dailyLimit > 0 && (
                <span className="text-xs text-gray-400 font-medium">/ {settings.dailyLimit}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Canlı Durum, Geri Sayım & Dinlenme Molası Çubuğu ── */}
      {(statusText || isScanning || isUnfollowing || isResting) && (
        <div
          className={`p-4 rounded-xl border flex flex-col gap-2 transition-all ${
            isResting
              ? 'bg-amber-50 border-amber-300 text-amber-900 shadow-sm'
              : statusType === 'ok'
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
                  isResting
                    ? 'animate-ping bg-amber-600'
                    : isScanning || isUnfollowing
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
                    await chrome.tabs.create({ url: 'https://x.com/following' });
                    setStatusText('x.com /following sekmesi açıldı. Sayfayı biraz aşağı kaydırıp tekrar "Taramayı Başlat" düğmesine basın.');
                    setStatusType('info');
                  }}
                  className="px-3 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
                >
                  <ExternalLink size={13} />
                  {lang === 'tr' ? 'x.com Sekmesini Aç' : 'Open x.com Tab'}
                </button>
              )}

              {countdown !== null && !isResting && (
                <span className="text-xs font-bold px-3 py-1 bg-blue-600 text-white rounded-full animate-pulse flex items-center gap-1.5 shadow-xs">
                  <Clock size={12} />
                  {t.nextAccountIn(countdown, currentDelayRangeText)}
                </span>
              )}

              {isResting && countdown !== null && (
                <span className="text-xs font-bold px-3 py-1 bg-amber-600 text-white rounded-full animate-bounce flex items-center gap-1.5 shadow-xs">
                  <Coffee size={13} />
                  {countdown} sn Mola
                </span>
              )}
            </div>
          </div>

          {progressPercent !== null && (
            <div className="w-full bg-blue-200/50 rounded-full h-2 overflow-hidden mt-1">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  isResting ? 'bg-amber-600' : 'bg-blue-600'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Eylem, Arama, Sıralama ve Filtreleme Araç Çubuğu ── */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
        {/* Üst Satır: Arama, Sıralama ve Çıkarma Butonu */}
        <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3">
          {/* Arama Kutusu */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          {/* Sıralama Seçici */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 flex items-center gap-1">
              <ArrowUpDown size={14} className="text-gray-400" />
              {t.sort.label}
            </span>
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="px-3 py-2 text-xs font-semibold bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer"
            >
              <option value="default">{t.sort.default}</option>
              <option value="oldest">{t.sort.oldest}</option>
              <option value="followers_desc">{t.sort.followersDesc} (↓)</option>
              <option value="followers_asc">{t.sort.followersAsc} (↑)</option>
              <option value="name_asc">{t.sort.nameAsc}</option>
              <option value="name_desc">{t.sort.nameDesc}</option>
            </select>
          </div>

          {/* Çıkarma Butonları */}
          <div className="flex items-center gap-2">
            {isUnfollowing ? (
              <button
                onClick={handleStopUnfollow}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors"
              >
                <Square size={15} fill="currentColor" />
                {t.stopButton}
              </button>
            ) : (
              <button
                onClick={handleStartUnfollow}
                disabled={selectedCount === 0 || isScanning}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl shadow-sm transition-colors ${
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

        {/* Orta Satır: Hızlı Takipçi Filtreleri ve Özel Min / Max Inputları */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-gray-100 text-xs">
          {/* Hızlı Takipçi Butonları */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-gray-400 font-medium mr-1 flex items-center gap-1">
              <Filter size={12} />
              {t.filters.quickLabel}
            </span>
            {(
              [
                { label: '< 50', type: 'lt50', min: '' as const, max: 50 },
                { label: '< 100', type: 'lt100', min: '' as const, max: 100 },
                { label: '< 500', type: 'lt500', min: '' as const, max: 500 },
                { label: '< 1.000', type: 'lt1k', min: '' as const, max: 1000 },
                { label: '< 5.000', type: 'lt5k', min: '' as const, max: 5000 },
                { label: '> 10.000', type: 'gt10k', min: 10000, max: '' as const },
              ] as const
            ).map((btn) => (
              <button
                key={btn.type}
                type="button"
                onClick={() => applyQuickFilter(btn.type, btn.min, btn.max)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  activeQuickFilter === btn.type
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* Özel Min - Max Inputları */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              placeholder={t.filters.minFollowers}
              value={minFollowers}
              onChange={(e) => {
                setActiveQuickFilter(null);
                setMinFollowers(e.target.value === '' ? '' : parseInt(e.target.value, 10));
              }}
              className="w-24 px-2.5 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
            <span className="text-gray-400">-</span>
            <input
              type="number"
              min="0"
              placeholder={t.filters.maxFollowers}
              value={maxFollowers}
              onChange={(e) => {
                setActiveQuickFilter(null);
                setMaxFollowers(e.target.value === '' ? '' : parseInt(e.target.value, 10));
              }}
              className="w-24 px-2.5 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
            />

            {(minFollowers !== '' || maxFollowers !== '' || searchQuery !== '' || activeQuickFilter !== null) && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                title={t.filters.clearFilter}
              >
                <RotateCcw size={12} />
                {t.filters.clearFilter}
              </button>
            )}
          </div>
        </div>

        {/* Teşhis ve Doğrulama Bilgi Rozeti */}
        <div className="flex items-center justify-between text-xs text-gray-500 bg-gray-50/80 px-3 py-1.5 rounded-lg border border-gray-100">
          <div className="flex items-center gap-3">
            <span>Filtrelenen: <strong className="text-gray-800 font-semibold">{totalFilteredCount}</strong> / {accounts.length}</span>
            {(minFollowers !== '' || maxFollowers !== '') && (
              <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60 font-medium">
                Takipçi Filtresi Aktif ({minFollowers || 0} - {maxFollowers || '∞'})
              </span>
            )}
          </div>
          <span className="text-[11px] font-mono text-gray-400">
            Aktif Sıra: {sortOption === 'oldest' ? '⏳ Eskiden Yeniye (İlkler Önde)' : sortOption === 'default' ? 'Varsayılan (En Sonlar Önde)' : sortOption}
          </span>
        </div>

        {/* Alt Satır: Sekmeler, Sayfa Başı Seçici ve Toplu Seçim İşlemleri */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-gray-100 text-xs">
          {/* Sekme Butonları */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'all'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.filterAll} ({accounts.length})
            </button>
            <button
              onClick={() => setActiveTab('selected')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'selected'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.filterSelected} ({selectedCount})
            </button>
            <button
              onClick={() => setActiveTab('whitelisted')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'whitelisted'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.filterWhitelisted} ({whitelistedCount})
            </button>
          </div>

          {/* Sayfa Başı Eleman Sayısı (Page Size) */}
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400 font-medium">{t.pagination.perPage}</span>
            <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
              {[25, 50, 100, 250, 0].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setPageSize(size)}
                  className={`px-2 py-1 rounded-md font-semibold text-[11px] transition-colors ${
                    pageSize === size
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {size === 0 ? t.pagination.all : size}
                </button>
              ))}
            </div>
          </div>

          {/* Hızlı Seçim Aksiyonları */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={selectAllFiltered}
              className="px-2.5 py-1 font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors border border-blue-100"
              title="Filtrelenmiş tüm sayfalardaki hesapları seç"
            >
              {t.selectAllFiltered(filteredAndSortedAccounts.filter((u) => !whitelistIds.has(u.id)).length)}
            </button>
            {pageSize > 0 && totalPages > 1 && (
              <button
                type="button"
                onClick={selectCurrentPageOnly}
                className="px-2.5 py-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                title="Sadece geçerli sayfadakileri seç"
              >
                {lang === 'tr' ? `Bu Sayfayı Seç (${paginatedAccounts.filter((u) => !whitelistIds.has(u.id)).length})` : `Select Page (${paginatedAccounts.filter((u) => !whitelistIds.has(u.id)).length})`}
              </button>
            )}
            <button
              type="button"
              onClick={selectNonWhitelisted}
              className="px-2.5 py-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {t.selectNonWhitelisted}
            </button>
            <button
              type="button"
              onClick={selectNone}
              className="px-2.5 py-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
            >
              {t.selectNone}
            </button>
          </div>
        </div>
      </div>

      {/* ── Hesaplar Tablosu / Listesi ── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Üst Bilgi Barı */}
        <div className="px-5 py-3 bg-gray-50/70 border-b border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <div>
            {t.pagination.pageInfo(fromIndex, toIndex, totalFilteredCount)}
          </div>
          {pageSize > 0 && totalPages > 1 && (
            <div className="font-semibold text-gray-700">
              {t.pagination.pageNumber(validCurrentPage, totalPages)}
            </div>
          )}
        </div>

        {paginatedAccounts.length === 0 ? (
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
            {paginatedAccounts.map((user) => {
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
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isStarred || isUnfollowing}
                      onChange={() => toggleSelect(user.id)}
                      className={`w-4 h-4 rounded accent-blue-600 transition-colors ${
                        isStarred ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    />

                    <button
                      type="button"
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

                    <img
                      src={user.avatar || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'}
                      alt={user.name}
                      className="w-10 h-10 rounded-full object-cover border border-gray-200 flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
                      }}
                    />

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
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`https://x.com/${user.username}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-gray-500 hover:text-blue-600 hover:underline flex items-center gap-1"
                        >
                          @{user.username}
                          <ExternalLink size={11} className="opacity-60" />
                        </a>
                        {(() => {
                          const origIndex = accounts.findIndex((a) => a.id === user.id);
                          return origIndex >= 0 ? (
                            <span
                              className="text-[10px] px-1.5 py-0.2 rounded bg-gray-100 text-gray-500 font-mono"
                              title={`X Takip Sırası: #${origIndex + 1} (Küçük = Yeni, Büyük = Eski)`}
                            >
                              #{origIndex + 1}
                            </span>
                          ) : null;
                        })()}
                      </div>
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
                      type="button"
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

        {/* ── Alt Sayfalama (Pagination Bar) ── */}
        {pageSize > 0 && totalPages > 1 && (
          <div className="px-5 py-4 bg-gray-50/80 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="text-gray-500">
              {t.pagination.pageInfo(fromIndex, toIndex, totalFilteredCount)}
            </div>

            <div className="flex items-center gap-1">
              {/* Başa Dön */}
              <button
                type="button"
                onClick={() => handlePageChange(1)}
                disabled={validCurrentPage === 1}
                className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 transition-colors"
                title={t.pagination.first}
              >
                <ChevronsLeft size={16} />
              </button>

              {/* Önceki */}
              <button
                type="button"
                onClick={() => handlePageChange(validCurrentPage - 1)}
                disabled={validCurrentPage === 1}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 font-medium transition-colors flex items-center gap-1"
              >
                <ChevronLeft size={14} />
                <span>{t.pagination.prev}</span>
              </button>

              {/* Sayfa Numaraları */}
              <div className="flex items-center gap-1 px-1">
                {(() => {
                  const pages: (number | string)[] = [];
                  const maxButtons = 5;
                  if (totalPages <= maxButtons + 2) {
                    for (let i = 1; i <= totalPages; i++) pages.push(i);
                  } else {
                    pages.push(1);
                    const left = Math.max(2, validCurrentPage - 1);
                    const right = Math.min(totalPages - 1, validCurrentPage + 1);

                    if (left > 2) pages.push('...');
                    for (let i = left; i <= right; i++) pages.push(i);
                    if (right < totalPages - 1) pages.push('...');
                    pages.push(totalPages);
                  }

                  return pages.map((p, idx) =>
                    typeof p === 'number' ? (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handlePageChange(p)}
                        className={`w-8 h-8 rounded-lg font-semibold transition-all ${
                          validCurrentPage === p
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {p}
                      </button>
                    ) : (
                      <span key={idx} className="px-1 text-gray-400 font-bold">
                        {p}
                      </span>
                    )
                  );
                })()}
              </div>

              {/* Sonraki */}
              <button
                type="button"
                onClick={() => handlePageChange(validCurrentPage + 1)}
                disabled={validCurrentPage === totalPages}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 font-medium transition-colors flex items-center gap-1"
              >
                <span>{t.pagination.next}</span>
                <ChevronRight size={14} />
              </button>

              {/* Sona Git */}
              <button
                type="button"
                onClick={() => handlePageChange(totalPages)}
                disabled={validCurrentPage === totalPages}
                className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 transition-colors"
                title={t.pagination.last}
              >
                <ChevronsRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
