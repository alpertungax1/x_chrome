/**
 * Tweet ve Gönderi Zamanı Formatlayıcı
 * 
 * Kullanıcının son tweet tarihini hesaplar, göreceli süre (örn: 2 gün önce, 1 yıl önce)
 * ve inaktiflik durumuna göre anlamsal renk rozetleri üretir.
 */

export interface FormattedTweetDate {
  text: string;
  badgeText: string;
  icon: string;
  badgeClass: string;
  colorClass: string;
  isInactive: boolean;
  tooltip: string;
}

export function formatLastTweetDate(
  timestamp?: number | null,
  lang: 'tr' | 'en' = 'tr'
): FormattedTweetDate | null {
  // 1. Henüz taranmamış / bilinmeyen hesaplar için kullanıcıyı yanıltmamak adına rozet gösterme
  if (timestamp === undefined || timestamp === null) {
    return null;
  }

  // 2. Gerçekten hiç tweeti olmayan (veya taranıp 0 gönderi teyit edilen) hesaplar
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    const text = lang === 'tr' ? 'Tweet Yok' : 'No Tweet';
    const icon = '⚪';
    const badgeClass = 'bg-gray-100 text-gray-400 border border-gray-200';
    return {
      text,
      icon,
      badgeText: `${icon} ${text}`,
      badgeClass,
      colorClass: badgeClass,
      isInactive: true,
      tooltip: lang === 'tr' ? 'Hesabın herkese açık gönderisi bulunamadı (0 Gönderi)' : 'No public posts found for this account (0 Posts)',
    };
  }

  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const dateObj = new Date(timestamp);
  const dateStr = dateObj.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  let text = '';
  let icon = '🟢';
  let badgeClass = 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  let isInactive = false;
  let tooltip = `${lang === 'tr' ? 'Son Gönderi:' : 'Last Post:'} ${dateStr}`;

  if (diffDays === 0) {
    text = lang === 'tr' ? 'Bugün' : 'Today';
    badgeClass += ' font-semibold';
  } else if (diffDays === 1) {
    text = lang === 'tr' ? 'Dün' : 'Yesterday';
    badgeClass += ' font-semibold';
  } else if (diffDays < 7) {
    text = lang === 'tr' ? `${diffDays} gün önce` : `${diffDays}d ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    text = lang === 'tr' ? `${weeks} hf önce` : `${weeks}w ago`;
  } else if (diffDays < 180) {
    const months = Math.floor(diffDays / 30);
    text = lang === 'tr' ? `${months} ay önce` : `${months}mo ago`;
    icon = '🟡';
    badgeClass = 'bg-amber-50 text-amber-700 border border-amber-200';
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    text = lang === 'tr' ? `${months} ay önce` : `${months}mo ago`;
    icon = '🟠';
    badgeClass = 'bg-orange-50 text-orange-700 border border-orange-200 font-medium';
    isInactive = true;
    tooltip = `${lang === 'tr' ? 'İnaktif: Son Gönderi' : 'Inactive: Last Post'} ${dateStr}`;
  } else {
    const years = (diffDays / 365).toFixed(1).replace(/\.0$/, '');
    text = lang === 'tr' ? `${years} yıl önce` : `${years}y ago`;
    icon = '💤';
    badgeClass = 'bg-red-50 text-red-700 border border-red-200 font-semibold';
    isInactive = true;
    tooltip = `${lang === 'tr' ? 'Hayalet Hesap: Son Gönderi' : 'Ghost Account: Last Post'} ${dateStr}`;
  }

  return {
    text,
    badgeText: `${icon} ${text}`,
    icon,
    badgeClass,
    colorClass: badgeClass,
    isInactive,
    tooltip,
  };
}
