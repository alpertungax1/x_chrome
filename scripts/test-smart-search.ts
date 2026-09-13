import assert from 'node:assert';
import { matchSmartSearch, SMART_SEARCH_PRESETS } from '../src/utils/smart-search';

const sampleUsers = [
  {
    username: 'nft_whale',
    displayName: 'Bored Ape King',
    bio: 'Building the next gen NFT ecosystem on Solana and Ethereum. Web3 builder.',
  },
  {
    username: 'crypto_trader',
    displayName: 'Satoshist',
    bio: 'Daily BTC & ETH analysis. Defi yield farmer. Memecoin enthusiast.',
  },
  {
    username: 'ahmet_dev',
    displayName: 'Ahmet Yılmaz',
    bio: 'Frontend developer & AI prompt engineer. React, TypeScript, Python yazılımcısı.',
  },
  {
    username: 'saliha_ceo',
    displayName: 'Saliha Demir',
    bio: 'Founder & CEO at TechVenture. Angel investor and serial entrepreneur.',
  },
  {
    username: 'regular_user',
    displayName: 'Canan',
    bio: 'Doğa aşığı, kahve ve kitap kurdu.',
  },
];

// Test 1: Boş arama hepsiyle eşleşir
assert.strictEqual(sampleUsers.filter((u) => matchSmartSearch(u, '')).length, 5);

// Test 2: Tekil kelime (NFT)
const nftResults = sampleUsers.filter((u) => matchSmartSearch(u, 'nft'));
assert.strictEqual(nftResults.length, 1);
assert.strictEqual(nftResults[0].username, 'nft_whale');

// Test 3: Virgüllü çoklu VEYA (OR) araması ("nft, btc")
const orResults = sampleUsers.filter((u) => matchSmartSearch(u, 'nft, btc'));
assert.strictEqual(orResults.length, 2);

// Test 4: Boşluklu VE (AND) araması ("web3 builder")
const andResults = sampleUsers.filter((u) => matchSmartSearch(u, 'web3 builder'));
assert.strictEqual(andResults.length, 1);
assert.strictEqual(andResults[0].username, 'nft_whale');

// Test 5: Türkçe karakter desteği ("YAZILIM", "yazılımcısı")
const trResults = sampleUsers.filter((u) => matchSmartSearch(u, 'YAZILIM'));
assert.strictEqual(trResults.length, 1);
assert.strictEqual(trResults[0].username, 'ahmet_dev');

// Test 6: Tırnak içi tam öbek araması
const quoteResults = sampleUsers.filter((u) => matchSmartSearch(u, '"Bored Ape"'));
assert.strictEqual(quoteResults.length, 1);
assert.strictEqual(quoteResults[0].username, 'nft_whale');

// Test 7: Hazır ön ayarların çalışması
const nftPreset = SMART_SEARCH_PRESETS.find((p) => p.id === 'nft')!;
const presetMatches = sampleUsers.filter((u) => matchSmartSearch(u, nftPreset.query));
assert.strictEqual(presetMatches.length, 1);
assert.strictEqual(presetMatches[0].username, 'nft_whale');

console.log('✅ Tüm akıllı arama kontrolleri başarıyla geçti!');
