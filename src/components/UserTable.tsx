import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { XUser } from '../types/user';
import { UserMinus, UserPlus, CheckSquare, Square, MinusSquare, Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 50;

interface UserTableProps {
  users: XUser[];
  title: string;
  onUnfollow?: (username: string) => Promise<boolean>;
  onFollow?: (username: string) => Promise<boolean>;
  onBulkUnfollow?: (usernames: string[]) => Promise<void>;
  onBulkFollow?: (usernames: string[]) => Promise<void>;
  actionInProgress?: string | null;
  bulkProgress?: { current: number; total: number } | null;
}

export const UserTable: React.FC<UserTableProps> = ({ 
  users, 
  title, 
  onUnfollow, 
  onFollow,
  onBulkUnfollow,
  onBulkFollow,
  actionInProgress,
  bulkProgress
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced arama (300ms)
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value);
      setCurrentPage(1); // Aramada sayfa 1'e dön
    }, 300);
  }, []);

  // Sayfa değiştiğinde seçimleri sıfırla
  useEffect(() => {
    setCurrentPage(1);
  }, [users.length]);

  // Filtrelenmiş kullanıcılar
  const filteredUsers = useMemo(() => {
    if (!debouncedQuery.trim()) return users;
    const q = debouncedQuery.toLowerCase();
    return users.filter(u => 
      u.username.toLowerCase().includes(q) || 
      u.displayName.toLowerCase().includes(q)
    );
  }, [users, debouncedQuery]);

  // Sayfalama
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredUsers.slice(start, start + PAGE_SIZE);
  }, [filteredUsers, currentPage]);

  const allPageSelected = paginatedUsers.length > 0 && paginatedUsers.every(u => selectedIds.has(u.id));
  const someSelected = paginatedUsers.some(u => selectedIds.has(u.id));

  const toggleSelectAll = () => {
    if (allPageSelected) {
      // Sadece bu sayfadakileri kaldır
      const newSet = new Set(selectedIds);
      paginatedUsers.forEach(u => newSet.delete(u.id));
      setSelectedIds(newSet);
    } else {
      const newSet = new Set(selectedIds);
      paginatedUsers.forEach(u => newSet.add(u.id));
      setSelectedIds(newSet);
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  // Tüm seçili kullanıcılar (tüm sayfalardan)
  const allSelectedUsers = users.filter(u => selectedIds.has(u.id));
  const selectedFollowing = allSelectedUsers.filter(u => u.isFollowing);
  const selectedNotFollowing = allSelectedUsers.filter(u => !u.isFollowing);

  const handleBulkUnfollow = () => {
    if (onBulkUnfollow && selectedFollowing.length > 0) {
      const confirmed = confirm(`${selectedFollowing.length} kişiyi takipten çıkarmak istediğinize emin misiniz?`);
      if (confirmed) {
        onBulkUnfollow(selectedFollowing.map(u => u.username));
        setSelectedIds(new Set());
      }
    }
  };

  const handleBulkFollow = () => {
    if (onBulkFollow && selectedNotFollowing.length > 0) {
      const confirmed = confirm(`${selectedNotFollowing.length} kişiyi takip etmek istediğinize emin misiniz?`);
      if (confirmed) {
        onBulkFollow(selectedNotFollowing.map(u => u.username));
        setSelectedIds(new Set());
      }
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <span className="bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1 rounded-full">
            {filteredUsers.length} Kullanıcı
          </span>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Kullanıcı ara..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>
      </div>

      {/* Toplu İşlem Barı */}
      {selectedIds.size > 0 && (
        <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
          <span className="text-sm font-medium text-blue-800">
            {selectedIds.size} kullanıcı seçildi
          </span>
          <div className="flex gap-2">
            {selectedFollowing.length > 0 && onBulkUnfollow && (
              <button
                onClick={handleBulkUnfollow}
                disabled={!!bulkProgress}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UserMinus size={14} />
                Takipten Çık ({selectedFollowing.length})
              </button>
            )}
            {selectedNotFollowing.length > 0 && onBulkFollow && (
              <button
                onClick={handleBulkFollow}
                disabled={!!bulkProgress}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UserPlus size={14} />
                Takip Et ({selectedNotFollowing.length})
              </button>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 bg-white text-gray-600 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              Seçimi Kaldır
            </button>
          </div>
        </div>
      )}

      {/* Toplu İşlem İlerleme */}
      {bulkProgress && (
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
              <Loader2 size={14} className="animate-spin" />
              İşlem devam ediyor... {bulkProgress.current}/{bulkProgress.total}
            </div>
          </div>
          <div className="w-full bg-amber-200 rounded-full h-1.5">
            <div 
              className="bg-amber-600 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Tablo */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-gray-600">
          <thead className="bg-gray-50/80 text-gray-500 font-medium border-b border-gray-100">
            <tr>
              <th className="pl-6 pr-2 py-4 w-10">
                <button onClick={toggleSelectAll} className="text-gray-400 hover:text-gray-700 transition-colors">
                  {allPageSelected ? <CheckSquare size={18} className="text-blue-600" /> : 
                   someSelected ? <MinusSquare size={18} className="text-blue-400" /> : 
                   <Square size={18} />}
                </button>
              </th>
              <th className="px-4 py-4">Kullanıcı</th>
              <th className="px-4 py-4">Durum</th>
              <th className="px-4 py-4 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginatedUsers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  {searchQuery ? 'Aramanızla eşleşen kullanıcı bulunamadı.' : 'Bu listede gösterilecek kimse yok.'}
                </td>
              </tr>
            ) : (
              paginatedUsers.map((user) => {
                const isSelected = selectedIds.has(user.id);
                const isProcessing = actionInProgress === user.username;

                return (
                  <tr 
                    key={user.id} 
                    className={`transition-colors ${isSelected ? 'bg-blue-50/50' : 'hover:bg-gray-50/50'} ${isProcessing ? 'opacity-60' : ''}`}
                  >
                    <td className="pl-6 pr-2 py-3">
                      <button onClick={() => toggleSelect(user.id)} className="text-gray-400 hover:text-gray-700 transition-colors">
                        {isSelected ? <CheckSquare size={18} className="text-blue-600" /> : <Square size={18} />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-3">
                        <img 
                          src={user.avatarUrl || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'} 
                          alt={user.displayName} 
                          className="w-9 h-9 rounded-full border border-gray-200 flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-gray-900 truncate text-sm">{user.displayName}</div>
                          <a 
                            href={`https://x.com/${user.username}`} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="text-blue-600 hover:underline text-xs"
                          >
                            @{user.username}
                          </a>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {user.isFollowing && (
                          <span className="bg-green-50 text-green-700 text-xs px-2 py-0.5 rounded font-medium border border-green-100">
                            Takip Ediyorsun
                          </span>
                        )}
                        {user.isFollower && (
                          <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded font-medium border border-blue-100">
                            Seni Takip Ediyor
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isProcessing ? (
                        <Loader2 size={16} className="animate-spin text-gray-400 inline-block" />
                      ) : (
                        <div className="flex gap-1.5 justify-end">
                          {user.isFollowing && onUnfollow && (
                            <button
                              onClick={() => onUnfollow(user.username)}
                              disabled={!!actionInProgress}
                              title="Takipten Çık"
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-30"
                            >
                              <UserMinus size={16} />
                            </button>
                          )}
                          {!user.isFollowing && onFollow && (
                            <button
                              onClick={() => onFollow(user.username)}
                              disabled={!!actionInProgress}
                              title="Takip Et"
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
            {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, filteredUsers.length)} / {filteredUsers.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            
            {/* Sayfa numaraları */}
            {generatePageNumbers(currentPage, totalPages).map((page, i) => (
              page === '...' ? (
                <span key={`dots-${i}`} className="px-1 text-gray-400 text-sm">...</span>
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
            ))}

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
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
