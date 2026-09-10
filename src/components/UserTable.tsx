import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { XUser } from '../types/user';
import {
  UserMinus,
  UserPlus,
  CheckSquare,
  Square,
  MinusSquare,
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Key,
  Shield,
  Sliders,
  Clock,
  Coffee,
  Shuffle,
  StopCircle,
  ArrowUpDown,
} from 'lucide-react';
import { translations, Language } from '../i18n';
import { useAppStore } from '../store/app-store';
import { unfollowersService } from '../services/unfollowers-service';
import { UnfollowersSettings, SafetyPreset } from '../types/unfollowers';

const PAGE_SIZE = 50;

export type TableSortOption =
  | 'newest'
  | 'oldest'
  | 'followers_desc'
  | 'followers_asc'
  | 'name_asc'
  | 'name_desc';

interface UserTableProps {
  users: XUser[];
  title: string;
  lang?: Language;
  onUnfollow?: (username: string) => Promise<boolean>;
  onFollow?: (username: string) => Promise<boolean>;
  onBulkUnfollow?: (usernames: string[]) => Promise<void>;
  onBulkFollow?: (usernames: string[]) => Promise<void>;
  actionInProgress?: string | null;
  bulkProgress?: { current: number; total: number } | null;
}

function formatCount(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export const UserTable: React.FC<UserTableProps> = ({
  users,
  title,
  lang = 'tr',
  onUnfollow,
  onFollow,
  onBulkFollow,
  actionInProgress,
}) => {
  const t = translations[lang].table;
  const ut = translations[lang].unfollowers;
  const { updateUsersBatch, applyUnfollow } = useAppStore();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortOption, setSortOption] = useState<TableSortOption>('newest');
  const [maxFollowersInput, setMaxFollowersInput] = useState('');
  const [minFollowersInput, setMinFollowersInput] = useState('');
  const [hideUnknownCounts, setHideUnknownCounts] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Anti-Ban & Güvenlik Ayarları State'i
  const [showSettingsModal, setShowSettingsModal] = useState(false);
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

  // Toplu İşlem & Anti-Ban State'leri
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [isResting, setIsResting] = useState(false);
  const [bulkStatusText, setBulkStatusText] = useState('');
  const [bulkCountdown, setBulkCountdown] = useState<number | null>(null);
  const [bulkProgressState, setBulkProgressState] = useState<{ current: number; total: number } | null>(null);
  const bulkAbortRef = useRef(false);
  const [localProcessingUser, setLocalProcessingUser] = useState<string | null>(null);

  // Sorsa API State'leri
  const [sorsaLoading, setSorsaLoading] = useState(false);
  const [sorsaProgress, setSorsaProgress] = useState<{ fetched: number; total: number } | null>(null);
  const [sorsaError, setSorsaError] = useState('');

  // Doğrudan X API State'leri (Ücretsiz & Anında Takipçi Çekici)
  const [xFetchLoading, setXFetchLoading] = useState(false);
  const [xFetchError, setXFetchError] = useState('');
  const [xFetchProgress, setXFetchProgress] = useState<{ current: number; total: number } | null>(null);

  // Ayarları yükle
  useEffect(() => {
    void (async () => {
      const s = await unfollowersService.getSettings();
      setSettings(s);
    })();
  }, []);

  const handleUpdateSettings = async (updates: Partial<UnfollowersSettings>) => {
    const updated = { ...settings, ...updates };
    setSettings(updated);
    await unfollowersService.saveSettings(updates);
  };

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

  const handleFetchWithSorsa = async () => {
    const sorsaApiKey = localStorage.getItem('sorsaApiKey');
    if (!sorsaApiKey) return;

    const unknownUsers = users.filter((u) => typeof u.followersCount !== 'number');
    if (unknownUsers.length === 0) return;

    const usernames = unknownUsers.map((u) => u.username);
    setSorsaLoading(true);
    setSorsaError('');
    setSorsaProgress({ fetched: 0, total: usernames.length });

    try {
      const { fetchFollowerCounts } = await import('../utils/sorsa');
      const result = await fetchFollowerCounts(usernames, sorsaApiKey, (fetched, total) => {
        setSorsaProgress({ fetched, total });
      });

      if (result.updates.length > 0) {
        await updateUsersBatch(result.updates);
      }

      if (!result.success) {
        setSorsaError(result.error || 'API Error');
      }
    } catch (e: any) {
      setSorsaError(e.message || 'Error occurred');
    } finally {
      setSorsaLoading(false);
      setTimeout(() => setSorsaProgress(null), 2000);
    }
  };

  /**
   * Doğrudan X API üzerinden 100'erli paketlerle ücretsiz ve anında takipçi sayılarını çeker
   */
  const handleFetchFromX = async () => {
    const unknownUsers = users.filter(
      (u) => typeof u.followersCount !== 'number' || !Number.isFinite(u.followersCount) || u.followersCount <= 0
    );
    if (unknownUsers.length === 0) {
      alert(
        lang === 'tr'
          ? 'Tüm kullanıcıların takipçi sayıları zaten mevcut.'
          : 'All users already have follower counts.'
      );
      return;
    }

    setXFetchLoading(true);
    setXFetchError('');
    setXFetchProgress({ current: 0, total: unknownUsers.length });

    try {
      const list = unknownUsers.map((u) => (u.username || u.id).replace(/^@/, '').trim()).filter(Boolean);
      const results = await unfollowersService.fetchFollowerCountsDirect(list);

      if (results && results.length > 0) {
        const resultMap = new Map(results.map((r) => [r.username.toLowerCase(), r.followersCount]));
        const updates: { id: string; followersCount: number }[] = [];

        for (const u of unknownUsers) {
          const count = resultMap.get(u.username.toLowerCase());
          if (typeof count === 'number') {
            updates.push({ id: u.id, followersCount: count });
          }
        }

        if (updates.length > 0) {
          await updateUsersBatch(updates);
          setXFetchProgress({ current: updates.length, total: unknownUsers.length });
          alert(
            lang === 'tr'
              ? `Harika! ${updates.length} kullanıcının gerçek takipçi sayısı doğrudan X'ten çekildi ve güncellendi!`
              : `Success! ${updates.length} users updated directly from X!`
          );
        } else {
          setXFetchError(
            lang === 'tr'
              ? 'X API kullanıcıları döndüremedi. Lütfen açık olan x.com sekmesini yenileyip tekrar deneyin.'
              : 'Failed to fetch users from X API.'
          );
        }
      } else {
        setXFetchError(
          lang === 'tr'
            ? 'X API ile bağlantı kurulamadı. Lütfen açık bir x.com sekmesi olduğundan emin olun.'
            : 'Could not connect to X API.'
        );
      }
    } catch (err: any) {
      console.warn('handleFetchFromX error:', err);
      const msg = err?.message || 'X API Hatası';
      setXFetchError(msg);
      alert(lang === 'tr' ? `Hata: ${msg}` : `Error: ${msg}`);
    } finally {
      setXFetchLoading(false);
      setTimeout(() => setXFetchProgress(null), 3000);
    }
  };

  // 1. Önbellekteki (xrm_cached_unfollowers) veriler ile takipçi sayılarını otomatik eşitle
  useEffect(() => {
    void (async () => {
      try {
        const cached = await chrome.storage.local.get('xrm_cached_unfollowers');
        if (Array.isArray(cached.xrm_cached_unfollowers) && cached.xrm_cached_unfollowers.length > 0) {
          const map = new Map<string, number>();
          for (const u of cached.xrm_cached_unfollowers) {
            if (u.username && typeof u.followers === 'number') {
              map.set(u.username.toLowerCase(), u.followers);
            }
          }

          const updates: { id: string; followersCount: number }[] = [];
          for (const u of users) {
            if (typeof u.followersCount !== 'number' || !Number.isFinite(u.followersCount)) {
              const count = map.get(u.username.toLowerCase());
              if (typeof count === 'number') {
                updates.push({ id: u.id, followersCount: count });
              }
            }
          }

          if (updates.length > 0) {
            await updateUsersBatch(updates);
          }
        }
      } catch (err) {
        console.warn('Cache sync error:', err);
      }
    })();
  }, [users, updateUsersBatch]);

  // 2. Takipçi sayısı bilinmeyen kullanıcıları arka planda otomatik X API'den çek (kullanıcının butona basmasına gerek kalmaz)
  const autoFetchedOnceRef = useRef(false);
  useEffect(() => {
    if (autoFetchedOnceRef.current || users.length === 0) return;
    const unknownUsers = users.filter(
      (u) => typeof u.followersCount !== 'number' || !Number.isFinite(u.followersCount)
    );
    if (unknownUsers.length > 0) {
      autoFetchedOnceRef.current = true;
      void (async () => {
        try {
          const list = unknownUsers.map((u) => u.username || u.id);
          const results = await unfollowersService.fetchFollowerCountsDirect(list);
          if (results && results.length > 0) {
            const map = new Map(results.map((r) => [r.username.toLowerCase(), r.followersCount]));
            const updates: { id: string; followersCount: number }[] = [];
            for (const u of unknownUsers) {
              const count = map.get(u.username.toLowerCase());
              if (typeof count === 'number') {
                updates.push({ id: u.id, followersCount: count });
              }
            }
            if (updates.length > 0) {
              await updateUsersBatch(updates);
            }
          }
        } catch (err) {
          console.warn('Auto fetch follower counts failed:', err);
        }
      })();
    }
  }, [users, updateUsersBatch]);

  const handleSyncFromCache = async () => {
    try {
      const cached = await chrome.storage.local.get('xrm_cached_unfollowers');
      if (Array.isArray(cached.xrm_cached_unfollowers) && cached.xrm_cached_unfollowers.length > 0) {
        const map = new Map<string, number>();
        for (const u of cached.xrm_cached_unfollowers) {
          if (u.username && typeof u.followers === 'number') {
            map.set(u.username.toLowerCase(), u.followers);
          }
        }

        const updates: { id: string; followersCount: number }[] = [];
        for (const u of users) {
          const count = map.get(u.username.toLowerCase());
          if (typeof count === 'number' && u.followersCount !== count) {
            updates.push({ id: u.id, followersCount: count });
          }
        }

        if (updates.length > 0) {
          await updateUsersBatch(updates);
          alert(
            lang === 'tr'
              ? `${updates.length} kullanıcının takipçi sayısı önbellekten güncellendi!`
              : `${updates.length} users synchronized from cache!`
          );
        } else {
          alert(
            lang === 'tr'
              ? 'Tüm kullanıcıların sayıları zaten güncel.'
              : 'All users are already synchronized.'
          );
        }
      } else {
        alert(
          lang === 'tr'
            ? 'Önbellekte veri bulunamadı. "X Unfollowers" menüsünden tarama yaparak tüm hesapların gerçek takipçi sayılarını saniyeler içinde alabilirsiniz.'
            : 'No cached data found. Please run a scan from X Unfollowers.'
        );
      }
    } catch (e: any) {
      console.warn('Sync cache error:', e);
    }
  };

  // Debounced arama
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value);
      setCurrentPage(1);
    }, 300);
  }, []);

  const usersKey = users.map((u) => u.id).join(',');
  useEffect(() => {
    setSelectedIds(new Set());
    setCurrentPage(1);
  }, [usersKey]);

  const maxFollowers = useMemo(() => {
    const t = maxFollowersInput.trim();
    if (!t) return null;
    const n = parseInt(t.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, [maxFollowersInput]);

  const minFollowers = useMemo(() => {
    const t = minFollowersInput.trim();
    if (!t) return null;
    const n = parseInt(t.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, [minFollowersInput]);

  const countStats = useMemo(() => {
    let known = 0;
    for (const u of users) {
      if (typeof u.followersCount === 'number' && Number.isFinite(u.followersCount)) known++;
    }
    return { known, total: users.length };
  }, [users]);

  const hasCountFilter = maxFollowers != null || minFollowers != null;
  const unknownCountInFilter = hasCountFilter
    ? users.filter((u) => typeof u.followersCount !== 'number' || !Number.isFinite(u.followersCount) || u.followersCount <= 0).length
    : 0;

  const filteredUsers = useMemo(() => {
    let list = users;
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      list = list.filter(
        (u) =>
          u.username.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q)
      );
    }

    if (hasCountFilter) {
      list = list.filter((u) => {
        // followersCount yoksa 0 kabul et
        const c = (typeof u.followersCount === 'number' && Number.isFinite(u.followersCount)) ? u.followersCount : 0;
        
        if (maxFollowers != null && c >= maxFollowers) return false;
        if (minFollowers != null && c < minFollowers) return false;
        return true;
      });
    }

    const sorted = [...list];
    switch (sortOption) {
      case 'newest':
      case 'oldest':
        sorted.sort((a, b) => {
          const hasOrderA = typeof a.scanOrder === 'number' && Number.isFinite(a.scanOrder);
          const hasOrderB = typeof b.scanOrder === 'number' && Number.isFinite(b.scanOrder);

          // 1. İkisinde de taranmış gerçek X API sırası (scanOrder) varsa:
          // Kullanıcının verisinde: #1 = En Eski Takip Edilen, #7486 = En Yeni Takip Edilen
          if (hasOrderA && hasOrderB) {
            if (a.scanOrder !== b.scanOrder) {
              return sortOption === 'oldest' ? a.scanOrder! - b.scanOrder! : b.scanOrder! - a.scanOrder!;
            }
          }

          // 2. Birinde scanOrder var diğerinde yoksa:
          // Gerçek taranmış verisi olan hesaplar her zaman önceliklidir
          if (hasOrderA && !hasOrderB) return -1;
          if (!hasOrderA && hasOrderB) return 1;

          // 3. İkisinde de scanOrder yoksa (veya eşitse): followedAt / firstSeenAt / Snowflake ID
          const getTime = (u: XUser): number => {
            if (typeof u.followedAt === 'number' && u.followedAt > 0) return u.followedAt;
            if (typeof u.firstSeenAt === 'number' && u.firstSeenAt > 0) return u.firstSeenAt;
            if (u.numericId && /^\d+$/.test(u.numericId)) {
              try {
                const idBig = BigInt(u.numericId);
                const ts = Number((idBig >> 22n) + 1288834974657n);
                if (Number.isFinite(ts) && ts > 0) return ts;
              } catch (_) {}
            }
            return 0;
          };

          const timeA = getTime(a);
          const timeB = getTime(b);

          if (timeA !== timeB) {
            return sortOption === 'newest' ? timeB - timeA : timeA - timeB;
          }

          return a.displayName.localeCompare(b.displayName);
        });
        break;
      case 'followers_desc':
        sorted.sort((a, b) => {
          const cA = (typeof a.followersCount === 'number' && Number.isFinite(a.followersCount)) ? a.followersCount : 0;
          const cB = (typeof b.followersCount === 'number' && Number.isFinite(b.followersCount)) ? b.followersCount : 0;
          if (cA !== cB) return cB - cA; // Büyük olan üstte
          return a.displayName.localeCompare(b.displayName);
        });
        break;
      case 'followers_asc':
        sorted.sort((a, b) => {
          const cA = (typeof a.followersCount === 'number' && Number.isFinite(a.followersCount)) ? a.followersCount : 0;
          const cB = (typeof b.followersCount === 'number' && Number.isFinite(b.followersCount)) ? b.followersCount : 0;
          if (cA !== cB) return cA - cB; // Küçük olan üstte
          return a.displayName.localeCompare(b.displayName);
        });
        break;
      case 'name_asc':
        sorted.sort((a, b) => a.displayName.localeCompare(b.displayName));
        break;
      case 'name_desc':
        sorted.sort((a, b) => b.displayName.localeCompare(a.displayName));
        break;
      default:
        break;
    }

    return sorted;
  }, [users, debouncedQuery, maxFollowers, minFollowers, hasCountFilter, sortOption]);

  useEffect(() => {
    setCurrentPage(1);
  }, [maxFollowers, minFollowers, debouncedQuery, sortOption]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredUsers.slice(start, start + PAGE_SIZE);
  }, [filteredUsers, currentPage]);

  const allPageSelected =
    paginatedUsers.length > 0 && paginatedUsers.every((u) => selectedIds.has(u.id));
  const someSelected = paginatedUsers.some((u) => selectedIds.has(u.id));
  const allFilteredSelected =
    filteredUsers.length > 0 && filteredUsers.every((u) => selectedIds.has(u.id));

  const toggleSelectAll = () => {
    if (allPageSelected) {
      const newSet = new Set(selectedIds);
      paginatedUsers.forEach((u) => newSet.delete(u.id));
      setSelectedIds(newSet);
    } else {
      const newSet = new Set(selectedIds);
      paginatedUsers.forEach((u) => newSet.add(u.id));
      setSelectedIds(newSet);
    }
  };

  const selectAllFiltered = () => {
    const newSet = new Set(selectedIds);
    filteredUsers.forEach((u) => newSet.add(u.id));
    setSelectedIds(newSet);
  };

  const clearSelection = () => setSelectedIds(new Set());

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const allSelectedUsers = users.filter((u) => selectedIds.has(u.id));
  const selectedFollowing = allSelectedUsers.filter((u) => u.isFollowing);
  const selectedNotFollowing = allSelectedUsers.filter((u) => !u.isFollowing);

  // ═══════════════════════════════════════════════════════════
  // GELİŞMİŞ ANTİ-BAN TOPLU TAKİPTEN ÇIKARMA MOTORU
  // ═══════════════════════════════════════════════════════════
  const handleBulkUnfollowWithAntiBan = async () => {
    if (selectedFollowing.length === 0 || isBulkRunning) return;

    // Günlük limit kontrolü
    if (settings.dailyLimit > 0 && settings.dailyCount >= settings.dailyLimit) {
      alert(ut.dailyLimitReached(settings.dailyLimit));
      return;
    }

    const confirmed = confirm(
      lang === 'tr'
        ? `${selectedFollowing.length} hesabı Anti-Ban korumasıyla (rastgele ${settings.minDelaySeconds}-${settings.maxDelaySeconds}s aralıklarla) takipten çıkarmak istediğinize emin misiniz?`
        : `Unfollow ${selectedFollowing.length} users with Anti-Ban protection (random ${settings.minDelaySeconds}-${settings.maxDelaySeconds}s delays)?`
    );
    if (!confirmed) return;

    setIsBulkRunning(true);
    setIsResting(false);
    bulkAbortRef.current = false;
    setBulkProgressState({ current: 0, total: selectedFollowing.length });

    let done = 0;
    let failed = 0;
    let batchConsecutive = 0;

    try {
      for (let i = 0; i < selectedFollowing.length; i++) {
        if (bulkAbortRef.current) break;

        // Günlük limit kontrolü
        if (settings.dailyLimit > 0 && settings.dailyCount + done >= settings.dailyLimit) {
          setBulkStatusText(ut.dailyLimitReached(settings.dailyLimit));
          break;
        }

        const user = selectedFollowing[i];
        setBulkProgressState({ current: i + 1, total: selectedFollowing.length });
        setBulkStatusText(ut.unfollowingAccount(user.username, i + 1, selectedFollowing.length));

        try {
          // Doğrudan API ile takipten çıkar (Sekme açıp kapatmaz, çok daha hızlı ve stabildir)
          await unfollowersService.unfollowUser({ id: user.id, username: user.username });
          done++;
          batchConsecutive++;

          const newCount = await unfollowersService.incrementDailyCount();
          setSettings((prev) => ({ ...prev, dailyCount: newCount }));

          // Listeden ve Zustand store'dan düş
          await applyUnfollow(user.username);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(user.id);
            return next;
          });
        } catch (err: any) {
          failed++;
          console.warn(`Unfollow @${user.username} failed:`, err);

          if (err?.status === 429) {
            setBulkStatusText(ut.rateLimitWarning);
            await new Promise((r) => setTimeout(r, 60000));
            i--;
            continue;
          }

          // Hata durumunda (hesap silinmiş, askıya alınmış vb.) ASLA pencere veya alert açma
          // Durumu loglayıp otomatik olarak sıradaki hesaba devam et
          setBulkStatusText(`@${user.username} atlandı, diğerine geçiliyor...`);
          await new Promise((r) => setTimeout(r, 600));
        }

        if (i < selectedFollowing.length - 1 && !bulkAbortRef.current) {
          // 1. Dinlenme Molası (Anti-Bot Rest Cooldown)
          if (
            settings.enableBatchCooldown &&
            settings.batchSize > 0 &&
            batchConsecutive >= settings.batchSize
          ) {
            batchConsecutive = 0;
            setIsResting(true);
            const cooldownEndTime = Date.now() + settings.cooldownSeconds * 1000;

            while (Date.now() < cooldownEndTime) {
              if (bulkAbortRef.current) break;
              const rem = Math.max(1, Math.ceil((cooldownEndTime - Date.now()) / 1000));
              setBulkCountdown(rem);
              setBulkStatusText(ut.restingCooldown(rem, done));
              await new Promise((r) => setTimeout(r, 250));
            }

            setIsResting(false);
            if (bulkAbortRef.current) break;
          }

          // 2. Rastgele İnsansı Aralık (Dynamic Jittered Delay)
          const delayMs = unfollowersService.calculateDelayMs(
            settings.minDelaySeconds,
            settings.maxDelaySeconds,
            settings.jitter
          );
          const endTime = Date.now() + delayMs;

          while (Date.now() < endTime) {
            if (bulkAbortRef.current) break;
            const rem = Math.max(1, Math.ceil((endTime - Date.now()) / 1000));
            setBulkCountdown(rem);
            await new Promise((r) => setTimeout(r, 200));
          }
          setBulkCountdown(null);
        }
      }

      if (bulkAbortRef.current) {
        setBulkStatusText(ut.stoppedMessage(done, failed));
      } else {
        setBulkStatusText(ut.completedMessage(done, failed));
      }
    } finally {
      setIsBulkRunning(false);
      setIsResting(false);
      setBulkCountdown(null);
      setTimeout(() => {
        setBulkProgressState(null);
        setBulkStatusText('');
      }, 5000);
    }
  };

  const handleStopBulkUnfollow = () => {
    bulkAbortRef.current = true;
    setBulkStatusText(translations[lang].scan.stopping);
  };

  const handleBulkFollow = () => {
    if (onBulkFollow && selectedNotFollowing.length > 0) {
      const confirmed = confirm(
        `${selectedNotFollowing.length} ${
          lang === 'tr'
            ? 'kişiyi takip etmek istediğinize emin misiniz?'
            : 'users will be followed. Are you sure?'
        }`
      );
      if (confirmed) {
        onBulkFollow(selectedNotFollowing.map((u) => u.username));
        setSelectedIds(new Set());
      }
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <span className="bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1 rounded-full">
              {filteredUsers.length}
              {filteredUsers.length !== users.length ? ` / ${users.length}` : ''} {t.userCount}
            </span>
          </div>

          {/* Sağ Butonlar: Takipçi Sayısı Çekici & Anti-Ban */}
          <div className="flex items-center gap-2">
            {countStats.total - countStats.known > 0 && (
              <button
                type="button"
                onClick={handleFetchFromX}
                disabled={xFetchLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-all disabled:opacity-50"
                title="Açık X oturumunuzdan tüm eksik takipçi sayılarını ücretsiz çeker"
              >
                {xFetchLoading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <span>⚡</span>
                )}
                <span>
                  {xFetchLoading
                    ? lang === 'tr'
                      ? 'Çekiliyor...'
                      : 'Fetching...'
                    : lang === 'tr'
                    ? `Sayıları Çek (${countStats.total - countStats.known})`
                    : `Fetch Counts (${countStats.total - countStats.known})`}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowSettingsModal(!showSettingsModal)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                showSettingsModal
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
              }`}
            >
              <Shield size={14} className={showSettingsModal ? 'text-white' : 'text-blue-600'} />
              <span>{ut.safety.title}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-bold">
                {settings.minDelaySeconds}-{settings.maxDelaySeconds}s
              </span>
            </button>
          </div>
        </div>

        {/* Anti-Ban Güvenlik Açılır Paneli */}
        {showSettingsModal && (
          <div className="mb-4 p-4 bg-slate-900 text-white rounded-xl shadow-md space-y-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <span className="font-bold text-sm text-blue-300 flex items-center gap-1.5">
                <Shield size={16} />
                {ut.safety.title}
              </span>
              <span className="text-[11px] text-slate-400">
                {settings.safetyPreset === 'safe'
                  ? ut.safety.presetSafe
                  : settings.safetyPreset === 'balanced'
                  ? ut.safety.presetBalanced
                  : settings.safetyPreset === 'fast'
                  ? ut.safety.presetFast
                  : ut.safety.presetCustom}
              </span>
            </div>

            {/* Hazır Güvenlik Profilleri */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'safe' as const, title: '🛡️ Ultra Güvenli', desc: '25-50s + 3 dk mola' },
                { id: 'balanced' as const, title: '⚖️ Standart', desc: '15-30s + 2 dk mola' },
                { id: 'fast' as const, title: '⚡ Hızlı', desc: '8-15s (molasız)' },
                { id: 'custom' as const, title: '⚙️ Özel', desc: 'Manuel süreler' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applySafetyPreset(p.id)}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    settings.safetyPreset === p.id
                      ? 'bg-blue-600/30 border-blue-400 text-white font-bold ring-1 ring-blue-400'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <div className="font-semibold text-xs">{p.title}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{p.desc}</div>
                </button>
              ))}
            </div>

            {/* Süre ve Mola Girişleri */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-white/10">
              <div className="bg-white/5 p-2.5 rounded-lg border border-white/10">
                <span className="text-[11px] text-slate-300 font-medium block mb-1">
                  Rastgele Aralık (sn):
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="3"
                    max="600"
                    value={settings.minDelaySeconds}
                    onChange={(e) =>
                      handleUpdateSettings({
                        safetyPreset: 'custom',
                        minDelaySeconds: Math.max(3, parseInt(e.target.value, 10) || 5),
                      })
                    }
                    className="w-16 bg-black/40 border border-white/20 rounded px-2 py-1 text-white font-bold text-xs"
                  />
                  <span>-</span>
                  <input
                    type="number"
                    min="5"
                    max="600"
                    value={settings.maxDelaySeconds}
                    onChange={(e) =>
                      handleUpdateSettings({
                        safetyPreset: 'custom',
                        maxDelaySeconds: Math.max(5, parseInt(e.target.value, 10) || 10),
                      })
                    }
                    className="w-16 bg-black/40 border border-white/20 rounded px-2 py-1 text-white font-bold text-xs"
                  />
                </div>
              </div>

              <div className="bg-white/5 p-2.5 rounded-lg border border-white/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-slate-300 font-medium">Güvenlik Molası:</span>
                  <input
                    type="checkbox"
                    checked={settings.enableBatchCooldown}
                    onChange={(e) =>
                      handleUpdateSettings({
                        safetyPreset: 'custom',
                        enableBatchCooldown: e.target.checked,
                      })
                    }
                    className="w-3.5 h-3.5 accent-blue-500 rounded cursor-pointer"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">Her</span>
                  <input
                    type="number"
                    min="5"
                    max="100"
                    disabled={!settings.enableBatchCooldown}
                    value={settings.batchSize}
                    onChange={(e) =>
                      handleUpdateSettings({
                        safetyPreset: 'custom',
                        batchSize: Math.max(5, parseInt(e.target.value, 10) || 15),
                      })
                    }
                    className="w-12 bg-black/40 border border-white/20 rounded px-1.5 py-1 text-white font-bold text-xs disabled:opacity-30"
                  />
                  <span className="text-[10px] text-slate-400">kişide,</span>
                  <input
                    type="number"
                    min="10"
                    max="600"
                    disabled={!settings.enableBatchCooldown}
                    value={settings.cooldownSeconds}
                    onChange={(e) =>
                      handleUpdateSettings({
                        safetyPreset: 'custom',
                        cooldownSeconds: Math.max(10, parseInt(e.target.value, 10) || 180),
                      })
                    }
                    className="w-14 bg-black/40 border border-white/20 rounded px-1.5 py-1 text-white font-bold text-xs disabled:opacity-30"
                  />
                  <span className="text-[10px] text-slate-400">sn</span>
                </div>
              </div>

              <div className="bg-white/5 p-2.5 rounded-lg border border-white/10 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300 font-medium">Günlük Limit:</span>
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    value={settings.dailyLimit}
                    onChange={(e) =>
                      handleUpdateSettings({
                        dailyLimit: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    className="w-16 bg-black/40 border border-white/20 rounded px-2 py-1 text-white font-bold text-xs"
                  />
                </div>
                <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
                  <span>İnsan sapması (±%15):</span>
                  <input
                    type="checkbox"
                    checked={settings.jitter}
                    onChange={(e) => handleUpdateSettings({ jitter: e.target.checked })}
                    className="w-3.5 h-3.5 accent-blue-500 rounded cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Arama ve Sıralama Çubuğu */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 mb-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>

          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 flex-shrink-0 shadow-2xs">
            <ArrowUpDown size={14} className="text-gray-500" />
            <span className="text-xs font-medium text-gray-500">{t.sort?.label || 'Sıralama:'}</span>
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as TableSortOption)}
              className="bg-transparent text-xs font-semibold text-gray-800 focus:outline-none cursor-pointer"
            >
              <option value="newest">{t.sort?.newest || '⚡ Yeniden Eskiye (En Son)'}</option>
              <option value="oldest">{t.sort?.oldest || '⏳ Eskiden Yeniye (İlk)'}</option>
              <option value="followers_desc">{t.sort?.followersDesc || '👥 En Çok Takipçi'}</option>
              <option value="followers_asc">{t.sort?.followersAsc || '👤 En Az Takipçi'}</option>
              <option value="name_asc">{t.sort?.nameAsc || '🔤 İsim (A → Z)'}</option>
              <option value="name_desc">{t.sort?.nameDesc || '🔤 İsim (Z → A)'}</option>
            </select>
          </div>
        </div>

        {/* Teşhis ve Doğrulama Bilgi Rozeti */}
        <div className="flex items-center justify-between text-xs text-gray-500 bg-gray-50/80 px-3 py-1.5 rounded-lg border border-gray-100 mb-3">
          <div className="flex items-center gap-3">
            <span>Listelenen: <strong className="text-gray-800 font-semibold">{filteredUsers.length}</strong> / {users.length}</span>
            <span>Sırası Taranmış: <strong className="text-blue-600 font-semibold">{users.filter((u) => typeof u.scanOrder === 'number').length}</strong></span>
            {hasCountFilter && (
              <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60 font-medium">
                Takipçi Filtresi Aktif ({minFollowers ?? 0} - {maxFollowers ?? '∞'})
              </span>
            )}
          </div>
          <span className="text-[11px] font-mono text-gray-400">
            Aktif Sıra: {sortOption === 'oldest' ? '⏳ Eskiden Yeniye (İlkler Önde)' : sortOption === 'newest' ? '⚡ Yeniden Eskiye (Sonlar Önde)' : sortOption}
          </span>
        </div>

        {/* Hızlı filtre: N kişiden az takipçi */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs font-medium text-gray-500 mr-0.5">{t.quick}</span>
          {([50, 100, 500, 1000, 5000] as const).map((n) => {
            const active = maxFollowers === n && minFollowers == null;
            return (
              <button
                key={n}
                type="button"
                onClick={() => {
                  if (active) {
                    setMaxFollowersInput('');
                    setMinFollowersInput('');
                  } else {
                    setMaxFollowersInput(String(n));
                    setMinFollowersInput('');
                  }
                }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                }`}
                title={t.lessThanN(n)}
              >
                &lt;{n}
              </button>
            );
          })}
        </div>

        {/* Takipçi sayısı filtresi */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">{t.minFollowers}</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="ör. 0"
              value={minFollowersInput}
              onChange={(e) => setMinFollowersInput(e.target.value)}
              className="w-28 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">{t.maxFollowers}</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="ör. 100"
              value={maxFollowersInput}
              onChange={(e) => setMaxFollowersInput(e.target.value)}
              className="w-28 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </label>
          {(maxFollowers != null || minFollowers != null) && (
            <label className="flex items-center gap-2 pb-2 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideUnknownCounts}
                onChange={(e) => setHideUnknownCounts(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              {t.hideUnknown}
            </label>
          )}
          {(maxFollowers != null || minFollowers != null || maxFollowersInput || minFollowersInput) && (
            <button
              type="button"
              onClick={() => {
                setMaxFollowersInput('');
                setMinFollowersInput('');
              }}
              className="pb-2 text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              {t.clearFilter}
            </button>
          )}
          {filteredUsers.length > 0 && !allFilteredSelected && (
            <button
              type="button"
              onClick={selectAllFiltered}
              className="pb-2 text-xs font-medium text-gray-700 hover:text-gray-900 underline-offset-2 hover:underline"
            >
              {t.selectAllFiltered} ({filteredUsers.length})
            </button>
          )}
          {allFilteredSelected && filteredUsers.length > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              className="pb-2 text-xs font-medium text-gray-700 hover:text-gray-900"
            >
              {t.clearSelection}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          {t.scanNote}
          {countStats.total > 0 && (
            <>
              {' '}
              {t.scanNoteCount(countStats.known, countStats.total)}
              {countStats.known === 0 ? t.scanNoteRescan : '.'}
            </>
          )}
        </p>
      </div>

      {/* Takipçi filtresi aktifken sayısı bilinmeyenler uyarısı */}
      {hasCountFilter && unknownCountInFilter > 0 && (
        <div className="mx-6 mt-3 mb-1 bg-amber-50/80 border border-amber-200 rounded-xl px-4 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-900">
                  {lang === 'tr'
                    ? `Filtre: Sadece takipçi sayısı kesin bilinen ve ${
                        maxFollowers != null ? `< ${maxFollowers}` : ''
                      }${minFollowers != null ? ` > ${minFollowers}` : ''} olan ${
                        filteredUsers.length
                      } kişi listelendi.`
                    : `Filter: Showing ${filteredUsers.length} users with confirmed counts.`}
                </p>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  {lang === 'tr'
                    ? `Takipçi sayısı henüz taranmamış ${unknownCountInFilter} hesap yanlış işlem yapılmaması için filtreye dahil edilmedi.`
                    : `${unknownCountInFilter} users with unknown follower counts were excluded to prevent mistakes.`}
                </p>
                {sorsaError && <p className="text-xs text-red-600 mt-1 font-medium">{sorsaError}</p>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-end sm:self-center flex-shrink-0">
              <button
                type="button"
                onClick={handleFetchFromX}
                disabled={xFetchLoading}
                className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg shadow-sm transition-all whitespace-nowrap flex items-center gap-1.5 disabled:opacity-50"
                title="Açık X oturumunuzdan tüm eksik takipçi sayılarını ücretsiz ve anında çeker"
              >
                {xFetchLoading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <span>⚡</span>
                )}
                <span>
                  {xFetchLoading
                    ? lang === 'tr'
                      ? 'X\'ten Çekiliyor...'
                      : 'Fetching from X...'
                    : lang === 'tr'
                    ? "X'ten Sayıları Çek (Ücretsiz)"
                    : 'Fetch from X'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleSyncFromCache}
                className="text-xs font-semibold bg-white text-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 shadow-xs transition-colors whitespace-nowrap"
                title="X Unfollowers taramasındaki verilerle eşitle"
              >
                {lang === 'tr' ? '🔄 Önbellekten Eşitle' : '🔄 Sync from Cache'}
              </button>

              <button
                type="button"
                onClick={handleFetchWithSorsa}
                disabled={sorsaLoading}
                className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg shadow-xs transition-colors whitespace-nowrap flex items-center gap-1.5 disabled:opacity-50"
              >
                {sorsaLoading && <Loader2 size={12} className="animate-spin" />}
                {sorsaLoading && sorsaProgress
                  ? `${lang === 'tr' ? 'Çekiliyor' : 'Fetching'} (${sorsaProgress.fetched}/${sorsaProgress.total})`
                  : lang === 'tr'
                  ? 'Sorsa API ile Çek'
                  : 'Fetch with Sorsa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toplu İşlem Barı */}
      {selectedIds.size > 0 && (
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
          <span className="text-sm font-medium text-blue-800">
            {t.selectedCount(selectedIds.size)}
          </span>
          <div className="flex items-center gap-2">
            {selectedFollowing.length > 0 && (
              <button
                onClick={handleBulkUnfollowWithAntiBan}
                disabled={isBulkRunning}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
              >
                <UserMinus size={14} />
                {t.unfollow} ({selectedFollowing.length})
                <span className="ml-1 text-[10px] px-1 py-0.2 bg-red-800/60 rounded">Anti-Ban</span>
              </button>
            )}
            {selectedNotFollowing.length > 0 && onBulkFollow && (
              <button
                onClick={handleBulkFollow}
                disabled={isBulkRunning}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UserPlus size={14} />
                {t.follow} ({selectedNotFollowing.length})
              </button>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              disabled={isBulkRunning}
              className="px-3 py-1.5 bg-white text-gray-600 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              {t.clearSelection}
            </button>
          </div>
        </div>
      )}

      {/* Toplu İşlem Anti-Ban İlerleme ve Canlı Geri Sayım Barı */}
      {(isBulkRunning || bulkProgressState || bulkStatusText) && (
        <div
          className={`px-6 py-3 border-b flex flex-col gap-2 transition-all ${
            isResting
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-blue-50 border-blue-200 text-blue-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              {isBulkRunning && <Loader2 size={15} className="animate-spin text-blue-600" />}
              {isResting && <Coffee size={15} className="text-amber-600 animate-bounce" />}
              <span>{bulkStatusText || `${t.processing} ${bulkProgressState?.current || 0}/${bulkProgressState?.total || 0}`}</span>
            </div>

            <div className="flex items-center gap-2">
              {bulkCountdown !== null && (
                <span
                  className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                    isResting
                      ? 'bg-amber-600 text-white animate-pulse'
                      : 'bg-blue-600 text-white'
                  }`}
                >
                  {isResting ? `☕ ${bulkCountdown} sn Mola` : `${bulkCountdown} sn`}
                </span>
              )}

              {isBulkRunning && (
                <button
                  type="button"
                  onClick={handleStopBulkUnfollow}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors shadow-xs"
                >
                  <StopCircle size={13} />
                  <span>{ut.stopButton}</span>
                </button>
              )}
            </div>
          </div>

          {bulkProgressState && bulkProgressState.total > 0 && (
            <div className="w-full bg-blue-200/60 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  isResting ? 'bg-amber-600' : 'bg-blue-600'
                }`}
                style={{
                  width: `${Math.min(100, Math.round((bulkProgressState.current / bulkProgressState.total) * 100))}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Tablo */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-gray-600">
          <thead className="bg-gray-50/80 text-gray-500 font-medium border-b border-gray-100">
            <tr>
              <th className="pl-6 pr-2 py-4 w-10">
                <button
                  onClick={toggleSelectAll}
                  className="text-gray-400 hover:text-gray-700 transition-colors"
                >
                  {allPageSelected ? (
                    <CheckSquare size={18} className="text-blue-600" />
                  ) : someSelected ? (
                    <MinusSquare size={18} className="text-blue-400" />
                  ) : (
                    <Square size={18} />
                  )}
                </button>
              </th>
              <th className="px-4 py-4">{t.colUser}</th>
              <th className="px-4 py-4 whitespace-nowrap">{t.colFollowers}</th>
              <th className="px-4 py-4">{t.colStatus}</th>
              <th className="px-4 py-4 text-right">{t.colAction}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginatedUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  {searchQuery || maxFollowers != null || minFollowers != null
                    ? t.noMatch
                    : t.noUsers}
                </td>
              </tr>
            ) : (
              paginatedUsers.map((user) => {
                const isSelected = selectedIds.has(user.id);
                const isProcessing =
                  actionInProgress === user.username || localProcessingUser === user.username;

                return (
                  <tr
                    key={user.id}
                    className={`transition-colors ${
                      isSelected ? 'bg-blue-50/50' : 'hover:bg-gray-50/50'
                    } ${isProcessing ? 'opacity-60' : ''}`}
                  >
                    <td className="pl-6 pr-2 py-3">
                      <button
                        onClick={() => toggleSelect(user.id)}
                        className="text-gray-400 hover:text-gray-700 transition-colors"
                      >
                        {isSelected ? (
                          <CheckSquare size={18} className="text-blue-600" />
                        ) : (
                          <Square size={18} />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-3">
                        <img
                          src={
                            user.avatarUrl ||
                            'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'
                          }
                          alt={user.displayName}
                          className="w-9 h-9 rounded-full border border-gray-200 flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-gray-900 truncate text-sm">
                            {user.displayName}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <a
                              href={`https://x.com/${user.username}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline text-xs truncate"
                            >
                              @{user.username}
                            </a>
                            {typeof user.scanOrder === 'number' ? (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono flex-shrink-0"
                                title={`X Takip Sırası: #${user.scanOrder + 1} (Küçük = Yeni, Büyük = Eski)`}
                              >
                                #{user.scanOrder + 1}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-sm text-gray-700 whitespace-nowrap">
                      {typeof user.followersCount === 'number' ? (
                        <span title={String(user.followersCount)}>
                          {formatCount(user.followersCount)}
                        </span>
                      ) : (
                        <span className="text-gray-300" title="Tarama sırasında alınamadı">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {user.isFollowing && (
                          <span className="bg-green-50 text-green-700 text-xs px-2 py-0.5 rounded font-medium border border-green-100">
                            {t.statusFollowing}
                          </span>
                        )}
                        {user.isFollower && (
                          <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded font-medium border border-blue-100">
                            {t.statusFollower}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isProcessing ? (
                        <Loader2 size={16} className="animate-spin text-gray-400 inline-block" />
                      ) : (
                        <div className="flex gap-1.5 justify-end">
                          {user.isFollowing && (
                            <button
                              onClick={async () => {
                                const confirmMsg =
                                  lang === 'tr'
                                    ? `@${user.username} hesabını takipten çıkarmak istediğinize emin misiniz?`
                                    : `Are you sure you want to unfollow @${user.username}?`;
                                if (!window.confirm(confirmMsg)) return;

                                setLocalProcessingUser(user.username);
                                try {
                                  await unfollowersService.unfollowUser({
                                    id: user.id,
                                    username: user.username,
                                  });
                                  await applyUnfollow(user.username);
                                } catch (e: any) {
                                  console.warn(`Unfollow @${user.username} failed:`, e);
                                  alert(
                                    lang === 'tr'
                                      ? `@${user.username} takipten çıkarılamadı: ${e?.message || 'Bilinmeyen hata'}`
                                      : `Failed to unfollow @${user.username}: ${e?.message || 'Unknown error'}`
                                  );
                                } finally {
                                  setLocalProcessingUser(null);
                                }
                              }}
                              disabled={!!actionInProgress || isBulkRunning || isProcessing}
                              title={t.titleUnfollow}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-30"
                            >
                              <UserMinus size={16} />
                            </button>
                          )}
                          {!user.isFollowing && onFollow && (
                            <button
                              onClick={() => onFollow(user.username)}
                              disabled={!!actionInProgress || isBulkRunning}
                              title={t.titleFollow}
                              className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-30"
                            >
                              <UserPlus size={16} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Sayfalama */}
      {totalPages > 1 && (
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {(currentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(currentPage * PAGE_SIZE, filteredUsers.length)} / {filteredUsers.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>

            {generatePageNumbers(currentPage, totalPages).map((page, i) =>
              page === '...' ? (
                <span key={`dots-${i}`} className="px-1 text-gray-400 text-sm">
                  ...
                </span>
              ) : (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page as number)}
                  className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${
                    currentPage === page
                      ? 'bg-gray-900 text-white'
                      : 'hover:bg-gray-100 text-gray-600'
                  }`}
                >
                  {page}
                </button>
              )
            )}

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/** Sayfa numarası üretici: 1 ... 4 5 [6] 7 8 ... 150 */
function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | string)[] = [];

  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push('...');
    pages.push(total);
  } else if (current >= total - 3) {
    pages.push(1);
    pages.push('...');
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    pages.push('...');
    for (let i = current - 1; i <= current + 1; i++) pages.push(i);
    pages.push('...');
    pages.push(total);
  }

  return pages;
}
