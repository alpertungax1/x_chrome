/**
 * Akıllı Arama & Anahtar Kelime Eşleştirici
 * 
 * Yetenekler:
 * 1. Bio (biyografi/açıklama), isim (displayName/name) ve kullanıcı adı (@username) üzerinde arama yapar.
 * 2. Virgülle ayrılmış terimlerde VEYA (OR) mantığı ("nft, web3, crypto").
 * 3. Boşlukla ayrılmış kelimelerde VE (AND) mantığı ("solana dev" -> her ikisi de bulunmalı).
 * 4. Çift tırnak içi tam öbek eşleşmesi ('"crypto trader"').
 * 5. Türkçe karakter duyarlı küçük harfe dönüştürme (İ/i, I/ı).
 */

export interface SmartSearchTarget {
  username: string;
  name?: string;
  displayName?: string;
  bio?: string;
  id?: string;
}

export interface SmartSearchPreset {
  id: string;
  labelTr: string;
  labelEn: string;
  icon: string;
  query: string;
}

export const SMART_SEARCH_PRESETS: SmartSearchPreset[] = [
  {
    id: 'nft',
    labelTr: 'NFT / Web3',
    labelEn: 'NFT / Web3',
    icon: '💎',
    query: 'nft, web3, mint, opensea, ordinals, pfp, metaverse',
  },
  {
    id: 'crypto',
    labelTr: 'Kripto',
    labelEn: 'Crypto',
    icon: '⚡',
    query: 'crypto, btc, bitcoin, eth, trader, defi, binance, memecoin',
  },
  {
    id: 'ai',
    labelTr: 'Yapay Zeka',
    labelEn: 'AI / Tech',
    icon: '🤖',
    query: 'ai, artificial intelligence, llm, gpt, machine learning, yapay zeka',
  },
  {
    id: 'dev',
    labelTr: 'Yazılım / Dev',
    labelEn: 'Software / Dev',
    icon: '💻',
    query: 'developer, software, engineer, yazılım, code, dev, github',
  },
  {
    id: 'founder',
    labelTr: 'Kurucu / CEO',
    labelEn: 'Founder / CEO',
    icon: '👔',
    query: 'founder, ceo, co-founder, kurucu, builder, entrepreneur',
  },
  {
    id: 'marketing',
    labelTr: 'Pazarlama / Ajans',
    labelEn: 'Marketing / Agency',
    icon: '📢',
    query: 'marketing, growth, ajans, agency, e-commerce, dijital',
  },
];

/**
 * Kullanıcı nesnesinin arama sorgusu ile eşleşip eşleşmediğini denetler.
 */
export function matchSmartSearch(user: SmartSearchTarget, query: string): boolean {
  if (!query || !query.trim()) return true;

  // Aranabilir metin havuzu: kullanıcı adı, isim ve bio
  const pool = [
    user.username || '',
    user.displayName || user.name || '',
    user.bio || '',
  ]
    .join(' ')
    .toLocaleLowerCase('tr-TR');

  // Virgülle ayrılmış bloklar OR (VEYA) olarak değerlendirilir
  const orSegments = query
    .split(',')
    .map((s) => s.trim().toLocaleLowerCase('tr-TR'))
    .filter(Boolean);

  if (orSegments.length === 0) return true;

  return orSegments.some((segment) => {
    // Çift tırnakla çevrili ise tam öbek eşleşmesi yap
    if (segment.startsWith('"') && segment.endsWith('"') && segment.length > 2) {
      const phrase = segment.slice(1, -1).trim();
      return phrase ? pool.includes(phrase) : true;
    }

    // Boşlukla ayrılmış kelimeler AND (VE) olarak değerlendirilir
    const andTokens = segment.split(/\s+/).filter(Boolean);
    if (andTokens.length === 0) return true;

    return andTokens.every((token) => pool.includes(token));
  });
}
