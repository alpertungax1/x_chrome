import assert from 'node:assert';
import { formatLastTweetDate } from '../src/utils/date-format';

console.log('Testing formatLastTweetDate & sorting logic...');

// 1. Tweet Yok / Inactive
const noTweet = formatLastTweetDate(undefined, 'tr');
assert.strictEqual(noTweet.isInactive, true);
assert.strictEqual(noTweet.icon, '⚪');
assert.strictEqual(noTweet.text, 'Tweet Yok');

// 2. Bugün atılan tweet
const today = formatLastTweetDate(Date.now() - 1000 * 60 * 30, 'tr'); // 30 dk önce
assert.strictEqual(today.isInactive, false);
assert.strictEqual(today.icon, '🟢');
assert.strictEqual(today.text, 'Bugün');

// 3. 2 gün önce
const twoDays = formatLastTweetDate(Date.now() - 1000 * 60 * 60 * 24 * 2, 'tr');
assert.strictEqual(twoDays.isInactive, false);
assert.strictEqual(twoDays.icon, '🟢');
assert.strictEqual(twoDays.text, '2 gün önce');

// 4. 2 ay önce
const twoMonths = formatLastTweetDate(Date.now() - 1000 * 60 * 60 * 24 * 65, 'tr');
assert.strictEqual(twoMonths.isInactive, false);
assert.strictEqual(twoMonths.icon, '🟡');
assert.strictEqual(twoMonths.text, '2 ay önce');

// 5. 2 yıl önce (İnaktif / Hayalet)
const twoYears = formatLastTweetDate(Date.now() - 1000 * 60 * 60 * 24 * 730, 'tr');
assert.strictEqual(twoYears.isInactive, true);
assert.strictEqual(twoYears.icon, '💤');
assert.strictEqual(twoYears.text, '2 yıl önce');

// 6. Sıralama Mantığı Testi
const mockUsers = [
  { id: '1', name: 'Aktif', lastTweetAt: Date.now() - 1000 * 60 * 60 }, // 1 saat önce
  { id: '2', name: 'Hayalet', lastTweetAt: undefined }, // Hiç tweet atmamış
  { id: '3', name: 'Eski', lastTweetAt: Date.now() - 1000 * 60 * 60 * 24 * 500 }, // 500 gün önce
  { id: '4', name: 'Dün', lastTweetAt: Date.now() - 1000 * 60 * 60 * 24 * 1 }, // 1 gün önce
];

// last_tweet_desc (Yeniden Eskiye): Aktif -> Dün -> Eski -> Hayalet
const sortedDesc = [...mockUsers].sort((a, b) => (b.lastTweetAt || 0) - (a.lastTweetAt || 0));
assert.strictEqual(sortedDesc[0].id, '1');
assert.strictEqual(sortedDesc[1].id, '4');
assert.strictEqual(sortedDesc[2].id, '3');
assert.strictEqual(sortedDesc[3].id, '2');

// last_tweet_asc (İnaktifler / Hayaletler En Üstte): Hayalet -> Eski -> Dün -> Aktif
const sortedAsc = [...mockUsers].sort((a, b) => (a.lastTweetAt || 0) - (b.lastTweetAt || 0));
assert.strictEqual(sortedAsc[0].id, '2');
assert.strictEqual(sortedAsc[1].id, '3');
assert.strictEqual(sortedAsc[2].id, '4');
assert.strictEqual(sortedAsc[3].id, '1');

console.log('✅ ALL TWEET SORT AND FORMAT TESTS PASSED SUCCESSFULLY!');
