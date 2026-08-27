export interface UnfollowerUser {
  id: string;
  username: string;
  name: string;
  avatar: string;
  followers: number;
  followingCount: number;
  followedBy: boolean | null;
  verified: boolean;
  isWhitelisted?: boolean;
}

export type SafetyPreset = 'safe' | 'balanced' | 'fast' | 'custom';

export interface UnfollowersSettings {
  delaySeconds: number; // Eski uyumluluk için
  minDelaySeconds: number; // Min rastgele saniye
  maxDelaySeconds: number; // Max rastgele saniye
  jitter: boolean; // ±%15-20 insansı sapma
  safetyPreset: SafetyPreset; // 'safe' | 'balanced' | 'fast' | 'custom'
  enableBatchCooldown: boolean; // Belirli işlem sayısından sonra güvenlik molası
  batchSize: number; // Her X işlemde bir (ör. 15)
  cooldownSeconds: number; // Dinlenme molası süresi (ör. 180 sn)
  dailyLimit: number; // Günlük maksimum çıkarma limiti (0 = limitsiz)
  whitelist: string[]; // List of whitelisted user IDs
  dailyDate: string; // YYYY-MM-DD
  dailyCount: number;
}

export interface UnfollowersProgress {
  total: number;
  current: number;
  username?: string;
  countdownSeconds?: number;
  isResting?: boolean;
  statusText: string;
  statusType?: 'info' | 'warn' | 'ok' | 'err';
}
