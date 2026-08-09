export type Language = 'tr' | 'en';

export const translations = {
  tr: {
    // Sidebar
    appName: 'X Manager',
    nav: {
      dashboard: 'Kontrol Paneli',
      followers: 'Takipçilerim',
      following: 'Takip Ettiklerim',
      notFollowingMe: 'Geri Takip Etmeyenler',
      mutuals: 'Karşılıklı Takipler',
    },
    // Dashboard header
    welcomeText: 'Hoş geldin. İşte hesap özetin.',
    scanningText: 'Tarama sürüyor...',
    scanNow: 'Tara',
    scanning: 'Taranıyor...',
    stop: 'Durdur',
    // Stats
    stats: {
      followers: 'Takipçiler',
      following: 'Takip Edilenler',
      notFollowing: 'Geri Takip Etmeyenler',
      mutuals: 'Karşılıklı Takipler',
    },
    // Page titles
    pageTitle: {
      dashboard: 'Kontrol Paneli',
      followers: 'Takipçilerim',
      following: 'Takip Ettiklerim',
      notFollowingMe: 'Geri Takip Etmeyenler',
      mutuals: 'Karşılıklı Takipler',
    },
    // UserTable
    table: {
      userCount: 'Kullanıcı',
      searchPlaceholder: 'Kullanıcı ara...',
      quick: 'Hızlı:',
      minFollowers: 'Min. takipçi',
      maxFollowers: 'Maks. takipçi (bundan az)',
      hideUnknown: 'Sayısı bilinmeyenleri gizle',
      clearFilter: 'Filtreyi temizle',
      selectAllFiltered: 'Filtrelenenlerin tümünü seç',
      clearSelection: 'Seçimi Kaldır',
      scanNote: 'Takipçi sayısı tarama sırasında GraphQL\'den alınır.',
      scanNoteCount: (known: number, total: number) =>
        `Bu listede ${known}/${total} kişide sayı var`,
      scanNoteRescan: ' — filtre için yeniden Tara çalıştır.',
      selectedCount: (n: number) => `${n} kullanıcı seçildi`,
      unfollow: 'Takipten Çık',
      follow: 'Takip Et',
      processing: 'İşlem devam ediyor...',
      noMatch: 'Filtreyle eşleşen kullanıcı yok.',
      noUsers: 'Bu listede gösterilecek kimse yok.',
      colUser: 'Kullanıcı',
      colFollowers: 'Takipçi',
      colStatus: 'Durum',
      colAction: 'İşlem',
      statusFollowing: 'Takip Ediyorsun',
      statusFollower: 'Seni Takip Ediyor',
      titleUnfollow: 'Takipten Çık',
      titleFollow: 'Takip Et',
      lessThanN: (n: number) => `${n} kişiden az takipçisi olanlar`,
    },
    // Scan status
    scan: {
      starting: 'Başlatılıyor...',
      stopping: 'Durduruluyor...',
      foundUsers: (n: number) => `Bulunan: ${n}`,
      phaseComplete: (n: number) => `Faz tamamlandı (${n} kullanıcı) — devam ediliyor…`,
    },
    // Language toggle
    language: 'Dil',
  },
  en: {
    // Sidebar
    appName: 'X Manager',
    nav: {
      dashboard: 'Dashboard',
      followers: 'Followers',
      following: 'Following',
      notFollowingMe: 'Not Following Me',
      mutuals: 'Mutuals',
    },
    // Dashboard header
    welcomeText: 'Welcome back. Here is your account overview.',
    scanningText: 'Scanning...',
    scanNow: 'Scan Now',
    scanning: 'Scanning...',
    stop: 'Stop',
    // Stats
    stats: {
      followers: 'Followers',
      following: 'Following',
      notFollowing: 'Not Following You',
      mutuals: 'Mutuals',
    },
    // Page titles
    pageTitle: {
      dashboard: 'Dashboard',
      followers: 'Followers',
      following: 'Following',
      notFollowingMe: 'Not Following You',
      mutuals: 'Mutuals',
    },
    // UserTable
    table: {
      userCount: 'Users',
      searchPlaceholder: 'Search users...',
      quick: 'Quick:',
      minFollowers: 'Min. followers',
      maxFollowers: 'Max. followers (less than)',
      hideUnknown: 'Hide unknown counts',
      clearFilter: 'Clear filter',
      selectAllFiltered: 'Select all filtered',
      clearSelection: 'Clear Selection',
      scanNote: 'Follower counts are fetched from GraphQL during scan.',
      scanNoteCount: (known: number, total: number) =>
        `${known}/${total} users in this list have counts`,
      scanNoteRescan: ' — run Scan Now again to enable filter.',
      selectedCount: (n: number) => `${n} users selected`,
      unfollow: 'Unfollow',
      follow: 'Follow',
      processing: 'Processing...',
      noMatch: 'No users match the filter.',
      noUsers: 'No one to show in this list.',
      colUser: 'User',
      colFollowers: 'Followers',
      colStatus: 'Status',
      colAction: 'Action',
      statusFollowing: 'Following',
      statusFollower: 'Follows You',
      titleUnfollow: 'Unfollow',
      titleFollow: 'Follow',
      lessThanN: (n: number) => `Users with fewer than ${n} followers`,
    },
    // Scan status
    scan: {
      starting: 'Starting...',
      stopping: 'Stopping...',
      foundUsers: (n: number) => `Found: ${n}`,
      phaseComplete: (n: number) => `Phase complete (${n} users) — continuing…`,
    },
    // Language toggle
    language: 'Language',
  },
} as const;

export type Translations = typeof translations['tr'];
