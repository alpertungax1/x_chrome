# X Relationship Manager - Chrome Extension
## Ayrıntılı AI Coding Agent Geliştirme Promptu

Sen kıdemli bir Chrome Extension, React, TypeScript ve browser automation geliştiricisisin.

Görevin, **X.com üzerinde kullanıcının takipçi ve takip ilişkilerini analiz etmesini, geçmiş değişiklikleri görmesini ve takipten çıkarma işlemlerini kolayca yönetmesini sağlayan profesyonel bir Chrome Extension** geliştirmektir.

Projenin çalışma adı:

**X Relationship Manager**

Amaç, kullanıcıya X üzerinde:

- Kendisini takip etmeyenleri,
- Daha önce takip edip sonradan takipten çıkanları,
- Karşılıklı takip ettiği kişileri,
- Ortak bağlantıları,
- Yeni takipçileri,
- Takip ettiği kişileri,
- Takipçilerini

tek bir modern ve kullanımı kolay arayüz üzerinden göstermek ve gerektiğinde tekli veya toplu takipten çıkarma işlemi yapabilmektir.

---

# 1. TEMEL TEKNOLOJİLER

Projeyi aşağıdaki teknoloji stack'i ile geliştir:

- Chrome Extension Manifest V3
- React
- TypeScript
- Vite
- Tailwind CSS
- IndexedDB
- Zustand veya benzeri hafif state management
- Modern component architecture
- ESLint
- Prettier

Gereksiz dependency kullanma.

Extension mümkün olduğunca bağımsız çalışmalı.

Backend gerektirmeyen bir mimari tercih et.

Kullanıcı verileri mümkün olduğunca cihaz üzerinde tutulmalı.

---

# 2. TEMEL MİMARİ

Mimari aşağıdaki yapıya sahip olmalı:

```text
Chrome Extension
│
├── Background Service Worker
│
├── Content Script
│   │
│   ├── X Page Scanner
│   ├── DOM Parser
│   └── X Action Handler
│
├── React UI
│   │
│   ├── Dashboard
│   ├── Followers
│   ├── Following
│   ├── Not Following
│   ├── Unfollowed
│   ├── Mutuals
│   ├── Connections
│   ├── Changes
│   └── Settings
│
├── Data Layer
│   │
│   ├── IndexedDB
│   ├── User Repository
│   ├── Snapshot Repository
│   └── Relationship History
│
└── Analysis Engine
    │
    ├── Relationship Analyzer
    ├── Mutual Analyzer
    ├── Unfollow Detection
    └── Connection Analyzer
```

Kod modüler olmalı.

UI ile X DOM manipülasyonu birbirinden kesinlikle ayrılmalı.

---

# 3. MANIFEST V3

Manifest V3 kullan.

Gerekli izinleri minimumda tut.

Muhtemel permission'lar:

```json
{
  "permissions": [
    "storage"
  ],
  "host_permissions": [
    "https://x.com/*",
    "https://twitter.com/*"
  ]
}
```

Gereksiz permission ekleme.

Extension sadece gerekli olduğu zaman X sayfasına müdahale etmeli.

---

# 4. X VERİSİYLE ÇALIŞMA

X web uygulaması SPA yapısındadır.

DOM sürekli değişebilir.

Bu nedenle:

- Sabit CSS selector'lara aşırı bağımlı olma.
- Mümkün olduğunca semantik DOM yapısını analiz et.
- `data-testid`
- `aria-label`
- `role`
- kullanıcı profil URL'leri
- kullanıcı adı pattern'leri

gibi daha stabil işaretleri tercih et.

Örneğin kullanıcıları tespit ederken:

```text
https://x.com/username
```

profil linklerini analiz edebilirsin.

Ancak X'in DOM yapısının değişebileceğini varsay.

Parser katmanını ayrı bir modül yap:

```text
src/content/x-parser.ts
```

Bu modülün görevi:

```typescript
parseUserFromElement()
parseUserFromProfile()
parseUserList()
extractUsername()
extractUserId()
extractFollowerCount()
extractFollowingCount()
```

gibi fonksiyonlar sağlamaktır.

---

# 5. VERİ MODELİ

Temel kullanıcı modeli:

```typescript
interface XUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;

  followersCount?: number;
  followingCount?: number;

  isFollowing: boolean;
  isFollower: boolean;

  firstSeenAt: number;
  lastSeenAt: number;

  followedAt?: number;
  unfollowedAt?: number;

  followerSince?: number;

  mutualCount?: number;
}
```

İlişki snapshot modeli:

```typescript
interface RelationshipSnapshot {
  id: string;
  userId: string;

  timestamp: number;

  isFollowing: boolean;
  isFollower: boolean;
}
```

Değişiklik modeli:

```typescript
interface RelationshipChange {
  id: string;
  userId: string;

  type:
    | "FOLLOWED_ME"
    | "UNFOLLOWED_ME"
    | "I_FOLLOWED"
    | "I_UNFOLLOWED";

  timestamp: number;
}
```

Tarama modeli:

```typescript
interface ScanSession {
  id: string;
  startedAt: number;
  finishedAt?: number;

  followersScanned: number;
  followingScanned: number;

  status:
    | "pending"
    | "running"
    | "completed"
    | "failed";
}
```

---

# 6. INDEXEDDB

Kullanıcı verilerini IndexedDB'de sakla.

Önerilen object store'lar:

```text
users
relationships
snapshots
changes
scanSessions
settings
```

IndexedDB wrapper oluştur.

Örneğin:

```text
src/db/
├── database.ts
├── users.ts
├── relationships.ts
├── snapshots.ts
├── changes.ts
└── scans.ts
```

Database işlemleri UI komponentlerinin içine yazılmamalı.

Repository pattern kullan.

---

# 7. ANA DASHBOARD

Dashboard modern, temiz ve profesyonel olmalı.

Dark mode varsayılan olabilir.

Üst bölüm:

```text
X Relationship Manager

Last scan:
8 Aug 2026 09:42

[ Scan Now ]
```

İstatistik kartları:

```text
Followers
2,431

Following
1,248

Not Following
386

Unfollowed
17
```

İkinci satır:

```text
Mutuals
862

New Followers
12

Common Connections
214

Tracked Users
3,679
```

---

# 8. SIDEBAR

Sol tarafta navigation:

```text
Dashboard

Followers
Following

Not Following
Unfollowed Me

Mutuals
Connections

Changes

Settings
```

Her bölümde ilgili kullanıcı sayısını badge olarak göster.

Örneğin:

```text
Not Following       386
Unfollowed Me        17
```

---

# 9. FOLLOWERS SAYFASI

Kullanıcının takipçilerini göster.

Her satır:

```text
[checkbox]

Avatar

Display Name
@username

Followers: 2.431
Following: 487

Relationship:
✓ Follows you

[Open Profile]
```

Desteklenen sıralamalar:

```text
Newest
Oldest
Username A-Z
Username Z-A
Most Followers
Least Followers
Most Following
Least Following
```

---

# 10. TAKİPÇİLERİ SONDAN BAŞA / BAŞTAN SONA SIRALAMA

Özellikle bu özellik düzgün çalışmalı.

Kullanıcı:

```text
Newest → Oldest
```

seçtiğinde `firstSeenAt` veya `followerSince` üzerinden sırala.

Ancak ilk kurulumda gerçek takip tarihinin bilinmediğini açıkça kabul et.

İlk taramada:

```text
firstSeenAt
```

kullan.

Sonraki taramalarda gerçek geçmiş oluştur.

UI'da gerekiyorsa:

```text
First seen by extension
```

ibaresi göster.

Gerçek takip tarihi bilinmiyorsa kesinmiş gibi gösterme.

---

# 11. FOLLOWING SAYFASI

Kullanıcının takip ettiği hesapları göster.

Filtreler:

```text
All

Not following me
Following me
Mutual

Recently followed
Long-term followed
```

Sıralama:

```text
Newest
Oldest
Followers
Following
Username
```

---

# 12. "SENİ TAKİP ETMEYENLER"

Bu uygulamanın ana özelliğidir.

Şu mantık kullanılmalı:

```text
I follow user = true
user follows me = false
```

sonucu:

```text
Not Following Me
```

olarak sınıflandır.

Sayfanın üstünde:

```text
386 people don't follow you back
```

göster.

Kullanıcı satırı:

```text
☐

Avatar
@username

2,431 followers
487 following

You follow them
They don't follow you

[Unfollow]
```

---

# 13. TOPLU SEÇİM

Her listede checkbox sistemi bulunmalı.

Üst toolbar:

```text
☐ Select All

386 selected

[Unfollow Selected]
```

Seçim sadece o sayfadaki kullanıcılarla sınırlı kalmamalı.

Pagination/virtualized list varsa selection state korunmalı.

---

# 14. TOPLU TAKİPTEN ÇIKARMA

Toplu işlem doğrudan yüzlerce isteği arka arkaya çalıştırmamalı.

Bir action queue sistemi oluştur:

```text
ActionQueue
```

Örneğin:

```typescript
interface ActionTask {
  id: string;
  userId: string;
  type: "UNFOLLOW";
  status:
    | "queued"
    | "processing"
    | "success"
    | "failed";
}
```

İşlem ekranı:

```text
Unfollowing...

@user1        ✓
@user2        ✓
@user3        Processing...
@user4        Waiting
@user5        Waiting

3 / 37
```

İşlem sırasında:

- hata yakala
- tekrar deneme mekanizması ekle
- kullanıcıya ilerleme göster
- işlem durdurma butonu ekle
- başarısız kullanıcıları ayrıca göster

Buton:

```text
[Pause]
[Cancel]
```

olmalı.

---

# 15. GÜVENLİ İŞLEM HIZI

X üzerinde aşırı hızlı otomasyon yapma.

Action queue kontrollü çalışmalı.

İşlemler arasında değişken gecikmeler kullanılabilir.

Ancak:

- CAPTCHA aşma
- rate-limit aşma
- güvenlik sistemlerini atlatma
- X'in anti-bot mekanizmalarını bypass etme

gibi özellikler geliştirme.

Eğer X işlemi engeller veya kullanıcı doğrulaması isterse işlemi durdur.

UI:

```text
X requires verification.

Automation paused.

Please complete verification on X.
```

göstermeli.

---

# 16. "YENİ TAKİPTEN ÇIKANLAR"

Bu özellik geçmiş snapshot'larına dayanmalı.

Örneğin:

Snapshot 1:

```text
@ahmet
isFollower = true
```

Snapshot 2:

```text
@ahmet
isFollower = false
```

ise:

```text
UNFOLLOWED_ME
```

event'i oluştur.

Sayfa:

```text
17 people recently unfollowed you
```

Her kullanıcı:

```text
@ahmet

Previously followed you
Last seen following:
Aug 7, 18:42

[Unfollow]
```

---

# 17. İLK KURULUM DAVRANIŞI

Extension ilk çalıştırıldığında geçmiş verisi olmadığını unutma.

İlk tarama:

```text
Initial Scan
```

olarak işaretlenmeli.

Kullanıcıya:

```text
Your first scan creates the baseline used to detect future changes.
```

göster.

İlk taramada hiçbir kullanıcıyı:

```text
"recently unfollowed you"
```

olarak göstermemelisin.

Bu kritik.

---

# 18. DEĞİŞİKLİKLER SAYFASI

Timeline oluştur.

Örnek:

```text
Today

09:42
🟢 @ahmet followed you

09:15
🔴 @mehmet unfollowed you

08:31
🟢 @ayse followed you

Yesterday

18:42
🔴 @fatma unfollowed you
```

Filtre:

```text
All
New Followers
Unfollowers
New Following
Unfollowed
```

---

# 19. MUTUALS

Mutual kullanıcı:

```text
isFollowing === true
AND
isFollower === true
```

olarak kabul edilmeli.

Sayfa:

```text
862 Mutual Connections
```

Her kullanıcı:

```text
@username

You follow each other

2,431 followers

[Open Profile]
[Unfollow]
```

---

# 20. ORTAK BAĞLANTILAR

Kullanıcıların ortak takip ilişkilerini analiz et.

Örneğin:

```text
You
│
├── @ahmet
├── @mehmet
└── @ayse

@x
│
├── @ahmet
├── @mehmet
└── @fatma
```

Sonuç:

```text
@x

2 common connections

@ahmet
@mehmet
```

Kullanıcıları ortak bağlantı sayısına göre sıralama:

```text
Most Common Connections
```

desteklenmeli.

---

# 21. ORTAK BAĞLANTI SKORU

Bir kullanıcı için:

```typescript
interface ConnectionStats {
  userId: string;
  mutualFollowingCount: number;
  mutualFollowerCount: number;
}
```

hesapla.

UI:

```text
@username

Common connections: 43

Mutual followers: 27
Mutual following: 16
```

Ancak erişilemeyen veriler için tahmin üretme.

---

# 22. ARAMA

Global search ekle.

Kullanıcı:

```text
@username
```

arama yaptığında local database'de ara.

Sonuç:

```text
@username

✓ You follow them
✓ They follow you

First seen:
Aug 2

Last seen:
Aug 8

Mutual connections:
17
```

---

# 23. PROFİL AÇMA

Her kullanıcıda:

```text
Open Profile
```

butonu olsun.

Tıklandığında:

```text
https://x.com/{username}
```

adresini yeni sekmede aç.

---

# 24. TARAYICI SAYFASIYLA SENKRONİZASYON

Content script X sayfalarında çalışmalı.

Scanner:

```text
Followers page
Following page
Profile page
```

gibi sayfaları ayırt etmeli.

Örneğin:

```text
/x/{username}/followers
```

ve

```text
/x/{username}/following
```

gibi URL pattern'lerini dikkate al.

Ancak URL yapısı değişebileceğinden parser sadece URL'ye bağımlı olmamalı.

---

# 25. INFINITE SCROLL

X listeleri infinite scroll kullanabilir.

Scanner:

```text
scanCurrentPage()
```

ile görünür kullanıcıları bulmalı.

Ardından:

```text
scrollAndCollect()
```

fonksiyonu oluştur.

Mantık:

```text
1. Görünür kullanıcıları topla
2. Duplicate'leri kaldır
3. Liste sonuna yaklaş
4. Scroll
5. Yeni kullanıcıları bekle
6. Tekrar tara
7. Yeni kullanıcı gelmiyorsa tamamla
```

Sonsuz döngüye karşı güvenlik mekanizması koy.

Örneğin belirli sayıda ardışık scroll'da yeni kullanıcı bulunmuyorsa dur.

---

# 26. DUPLICATE ÖNLEME

Aynı kullanıcı farklı DOM elementlerinde birden fazla kez görünebilir.

Primary key:

```text
X User ID
```

bulunabiliyorsa onu kullan.

Bulunamıyorsa:

```text
normalized username
```

kullan.

Database'de duplicate kullanıcı oluşmasına izin verme.

---

# 27. SCANNER PROGRESS

Tarama sırasında UI'a progress gönder.

Örneğin:

```text
Scanning followers...

1,284 users found

████████████░░░░

Last username:
@username
```

Service Worker / Content Script / React UI arasında message passing kullan.

Örneğin:

```typescript
SCAN_STARTED
SCAN_PROGRESS
SCAN_USER_FOUND
SCAN_COMPLETED
SCAN_ERROR
```

message type'ları oluştur.

---

# 28. HATA YÖNETİMİ

X DOM değişebilir.

Bu nedenle parser hiçbir zaman tüm extension'ı crash ettirmemeli.

Örneğin:

```typescript
try {
  parseUser(element)
} catch (error) {
  logger.warn(...)
}
```

kullan.

Hata olduğunda:

```text
Some users could not be read.
```

gibi kullanıcı dostu mesaj göster.

Console'a detaylı debug bilgisi yaz.

---

# 29. LOGGING

Development modunda:

```text
[Scanner]
[Parser]
[Database]
[ActionQueue]
[Analyzer]
[UI]
```

prefix'leri kullan.

Örneğin:

```text
[Scanner] Found 42 users
[Database] Saved 42 users
[Analyzer] 12 not-following users detected
```

Production modunda debug logging kapatılabilsin.

---

# 30. UI TASARIMI

Arayüz modern SaaS dashboard görünümünde olsun.

Tasarım prensipleri:

- temiz
- minimal
- hızlı
- responsive
- dark/light mode
- iyi spacing
- okunabilir typography
- belirgin butonlar
- tablo + kart kombinasyonu

Kullanıcı yüzlerce hatta binlerce hesabı yönetebileceği için tablo görünümü öncelikli olsun.

---

# 31. USER TABLE

User table component oluştur:

```text
UserTable
```

Özellikleri:

- checkbox
- avatar
- display name
- username
- follower count
- following count
- relationship
- first seen
- last seen
- actions

Column sorting destekle.

---

# 32. FILTER SYSTEM

Reusable filter component:

```text
FilterBar
```

Filtreler:

```text
Relationship
Follower Count
Following Count
First Seen
Last Seen
Username
```

Örnek:

```text
Followers > 1000

Following < 500

Relationship = Not Following Me
```

---

# 33. PAGINATION / VIRTUALIZATION

Binlerce kullanıcı olduğunda tüm DOM'u render etme.

Virtualized list kullan.

Örneğin uygun bir lightweight virtualization library kullanılabilir.

React state performansını koru.

10.000 kullanıcıda UI donmamalı.

---

# 34. DASHBOARD İSTATİSTİKLERİ

Dashboard istatistikleri IndexedDB'den hesaplanmalı.

Örneğin:

```text
Followers = isFollower true
Following = isFollowing true

Not Following =
isFollowing true
AND
isFollower false

Mutual =
isFollowing true
AND
isFollower true
```

---

# 35. DATA REFRESH

Kullanıcı:

```text
[Scan Now]
```

butonuna bastığında:

1. X sekmesini kontrol et
2. Kullanıcı X'te login mi kontrol et
3. Gerekli sayfaya yönlendirme gerekiyorsa kullanıcıya bildir
4. Scanner başlat
5. Verileri IndexedDB'ye kaydet
6. Relationship diff oluştur
7. Dashboard'u güncelle

---

# 36. LOGIN DURUMU

Extension X hesabına giriş yapılmamışsa:

```text
Please log in to X before scanning your account.
```

göster.

Kullanıcı adı/şifre isteme.

Cookie/session bilgilerini kendin toplamaya çalışma.

---

# 37. PRIVACY

Extension kullanıcı verilerini mümkün olduğunca lokal tutmalı.

Harici sunucuya kullanıcı listesini gönderme.

API key gerektirmeyen yapı tercih et.

Analytics/telemetry ekleme.

Kullanıcı verilerinin üçüncü taraflara aktarılmadığını UI'da açıklayabilirsin.

---

# 38. EXPORT / IMPORT

Settings'e:

```text
Export Data
Import Data
Clear Data
```

ekle.

Export:

```text
JSON
CSV
```

destekle.

CSV örneği:

```text
username,displayName,followers,following,isFollower,isFollowing,firstSeenAt,lastSeenAt
```

JSON export tüm database snapshotlarını içerebilir.

---

# 39. DATABASE RESET

Settings:

```text
Danger Zone

Clear all stored data

[Delete All Data]
```

Butona basıldığında confirmation modal göster.

Örneğin:

```text
This will permanently delete all local relationship history.

Cancel
Delete Everything
```

---

# 40. SETTINGS

Settings:

```text
Appearance
├── System
├── Light
└── Dark

Scan Settings
├── Scan followers automatically
├── Scan following automatically
└── Scan interval

Notifications
├── New follower
└── Unfollow detected
```

Otomatik tarama özelliği varsayılan olarak kapalı olabilir.

---

# 41. BROWSER NOTIFICATION

İsteğe bağlı:

```text
You lost 3 followers since your last scan.
```

Ancak gereksiz notification spam'i yapma.

---

# 42. ACTION CONFIRMATION

Tekli unfollow için:

```text
Unfollow @username?

[Cancel]
[Unfollow]
```

Toplu işlem için:

```text
You are about to unfollow 37 accounts.

This action cannot be automatically reversed.

[Cancel]
[Continue]
```

---

# 43. ACTION HISTORY

Kullanıcının extension üzerinden yaptığı işlemleri kaydet.

Örneğin:

```text
Action History

08 Aug 09:42
Unfollowed @ahmet

08 Aug 09:41
Unfollowed @mehmet

08 Aug 09:39
Unfollowed @ayse
```

Bu işlem geçmişi ayrıca IndexedDB'de tutulmalı.

---

# 44. UNDO

Gerçek anlamda otomatik undo yapmaya çalışma.

Ancak işlemden hemen sonra:

```text
Unfollowed 12 accounts.

[View Results]
```

göster.

Yanlışlıkla takipten çıkarılanların listesini sun.

---

# 45. X DOM DEĞİŞİKLİĞİNE KARŞI TASARIM

X'in DOM'u değişirse tüm extension'ın çalışmaz hale gelmesini önlemek için:

```text
XParser
XScanner
XActionHandler
```

ayrı katmanlar olmalı.

Örneğin parser selector'ları tek bir yerde tanımla:

```typescript
const selectors = {
  userCell: "...",
  profileLink: "...",
  followButton: "...",
  unfollowButton: "..."
}
```

Selector değişirse tek bir yerde güncellenebilsin.

Mümkün olduğunca fallback selector'lar kullan.

---

# 46. ACCESSIBILITY

UI:

- keyboard navigation
- aria-label
- focus state
- screen reader uyumluluğu
- yeterli contrast

özelliklerine sahip olmalı.

---

# 47. RESPONSIVE DESIGN

Extension popup küçük olabilir.

Ancak dashboard yeni sekmede açılabilmeli.

Önerilen yapı:

```text
Popup
↓
Open Dashboard
↓
chrome-extension://.../dashboard.html
```

Ana yönetim ekranı full-page dashboard olarak çalışsın.

---

# 48. POPUP

Popup minimal olsun:

```text
X Relationship Manager

Followers
2,431

Following
1,248

Not Following
386

Unfollowed
17

[Scan Now]

[Open Dashboard]
```

---

# 49. SECURITY

Extension:

- eval kullanmamalı
- unsafe inline script kullanmamalı
- remote JavaScript yüklememeli
- kullanıcı credential'larını saklamamalı
- X şifrelerini istememeli
- token/cookie çalmamalı

Manifest V3 CSP kurallarına uy.

---

# 50. TESTLER

En azından:

### Unit tests

Test edilmesi gerekenler:

```text
relationship analyzer
snapshot diff
not-following detection
unfollow detection
mutual detection
sorting
filtering
duplicate removal
```

Örneğin:

```text
User follows me = false
I follow user = true

Expected:
NOT_FOLLOWING
```

ve:

```text
Previous:
isFollower = true

Current:
isFollower = false

Expected:
UNFOLLOWED_ME
```

---

# 51. MOCK DATA

Development sırasında X'e bağlı olmadan UI test edebilmek için mock dataset oluştur.

Örneğin:

```text
100 users
1000 users
5000 users
10000 users
```

ile performans testi yapılabilsin.

---

# 52. ERROR STATES

Her ekran için:

```text
Loading
Empty
Error
Success
```

durumlarını tasarla.

Örneğin:

```text
No users found.

Run a scan to populate your relationship data.
```

---

# 53. EMPTY STATE

"Not Following" boşsa:

```text
Everyone follows you back!

A rare and beautiful moment on the internet.
```

gibi küçük, zararsız bir metin kullanılabilir.

Ancak uygulamanın genel UI metinleri profesyonel kalmalı.

---

# 54. PERFORMANCE

Öncelikler:

- IndexedDB batch writes
- debounce
- throttling
- virtualized lists
- memoized React components
- incremental scanning
- duplicate prevention

Her kullanıcıyı database'e tek tek yazmak yerine mümkün olduğunca batch transaction kullan.

---

# 55. SCAN ALGORITHM

Scanner genel mantığı:

```text
START
 ↓
Detect X page
 ↓
Detect logged-in user
 ↓
Detect list type
 ↓
Collect visible users
 ↓
Normalize users
 ↓
Deduplicate
 ↓
Save batch
 ↓
Scroll
 ↓
Wait for DOM update
 ↓
Collect again
 ↓
No new users?
 ├── NO → continue
 └── YES → finish
 ↓
Generate snapshot
 ↓
Compare previous snapshot
 ↓
Generate changes
 ↓
Update statistics
 ↓
DONE
```

---

# 56. RELATIONSHIP ANALYZER

Analyzer aşağıdaki fonksiyonları sağlamalı:

```typescript
findNotFollowingMe()
findMutuals()
findNewFollowers()
findUnfollowers()
findNewFollowing()
findCommonConnections()
```

Pure functions tercih et.

---

# 57. SORTING

Sorting fonksiyonlarını ayrı modülde tut:

```text
sortByNewest()
sortByOldest()
sortByFollowers()
sortByFollowing()
sortByUsername()
sortByMutualCount()
```

Stable sorting kullan.

---

# 58. FILTERING

Filtering de ayrı modül:

```text
filterNotFollowing()
filterMutual()
filterFollowers()
filterNewFollowers()
filterUnfollowed()
filterByFollowerCount()
```

---

# 59. INTERNATIONALIZATION

İlk sürüm Türkçe + İngilizce destekleyebilir.

Tüm UI metinlerini hard-code etme.

Örneğin:

```text
src/i18n/
├── tr.json
└── en.json
```

Varsayılan dil:

Browser language.

---

# 60. README

README oluştur.

Şunları anlat:

- Projenin amacı
- Kurulum
- Development
- Build
- Chrome'a yükleme
- Kullanım
- Mimari
- Privacy
- Limitations
- Known issues

Chrome'a manuel yükleme:

```text
chrome://extensions
```

→ Developer Mode

→ Load unpacked

→ dist/

---

# 61. BUILD

Komutlar:

```bash
npm install

npm run dev

npm run build
```

Build sonunda:

```text
dist/
```

oluşmalı.

Extension Chrome'da doğrudan `dist` klasöründen yüklenebilmeli.

---

# 62. KOD KALİTESİ

Kod:

- TypeScript strict mode
- açık interface'ler
- küçük fonksiyonlar
- dependency injection gerektiğinde kullan
- magic number kullanma
- magic string kullanma
- error handling
- typed messages

ile yazılmalı.

`any` kullanımını minimuma indir.

---

# 63. DOSYA YAPISI

Önerilen yapı:

```text
src/
├── background/
│   └── service-worker.ts
│
├── content/
│   ├── content.ts
│   ├── scanner.ts
│   ├── parser.ts
│   └── actions.ts
│
├── db/
│   ├── database.ts
│   ├── users.repository.ts
│   ├── snapshots.repository.ts
│   ├── changes.repository.ts
│   └── actions.repository.ts
│
├── analysis/
│   ├── relationship-analyzer.ts
│   ├── connection-analyzer.ts
│   └── diff-engine.ts
│
├── services/
│   ├── scan-service.ts
│   ├── action-queue.ts
│   └── export-service.ts
│
├── components/
│   ├── UserTable.tsx
│   ├── UserRow.tsx
│   ├── StatsCard.tsx
│   ├── FilterBar.tsx
│   ├── SortDropdown.tsx
│   ├── BulkActionBar.tsx
│   └── ConfirmModal.tsx
│
├── pages/
│   ├── Dashboard.tsx
│   ├── Followers.tsx
│   ├── Following.tsx
│   ├── NotFollowing.tsx
│   ├── Unfollowed.tsx
│   ├── Mutuals.tsx
│   ├── Connections.tsx
│   ├── Changes.tsx
│   └── Settings.tsx
│
├── store/
│   └── app-store.ts
│
├── types/
│   ├── user.ts
│   ├── relationship.ts
│   ├── scan.ts
│   └── messages.ts
│
└── utils/
    ├── logger.ts
    ├── date.ts
    ├── normalize.ts
    └── sorting.ts
```

---

# 64. GELİŞTİRME STRATEJİSİ

Projeyi tek seferde devasa şekilde yazma.

Aşağıdaki aşamalarla geliştir:

## Phase 1

- Vite
- React
- TypeScript
- Manifest V3
- Popup
- Dashboard
- Tailwind
- Chrome extension build

## Phase 2

- X content script
- X kullanıcı parser
- Followers scanner
- Following scanner

## Phase 3

- IndexedDB
- User repository
- Snapshot system

## Phase 4

- Relationship analyzer
- Not Following
- Mutuals
- Followers / Following

## Phase 5

- Unfollow detection
- Changes
- Historical data

## Phase 6

- Single unfollow
- Action queue
- Bulk unfollow
- Confirmation modal

## Phase 7

- Common connections
- Advanced filtering
- Sorting
- Search

## Phase 8

- Export/import
- Settings
- Dark/light mode
- Notifications

## Phase 9

- Tests
- Performance
- Error handling
- Production polish

---

# 65. KRİTİK KURAL

Kod yazmaya başlamadan önce mevcut repository'yi analiz et.

Önce:

```text
package.json
vite.config
tsconfig
manifest
src/
```

dosyalarını incele.

Mevcut kod varsa gereksiz yere silme.

Mevcut çalışan özellikleri bozma.

Sonra uygulanacak mimariyi belirle.

---

# 66. IMPLEMENTATION KURALI

Her phase tamamlandığında:

1. TypeScript compile et
2. Lint çalıştır
3. Testleri çalıştır
4. Build al
5. Hataları düzelt
6. Sonraki phase'e geç

Broken code bırakma.

---

# 67. X İLE İLGİLİ KRİTİK SINIRLAR

X'in web uygulamasının davranışları değişebilir.

Bu nedenle:

- undocumented API'lere gereksiz bağımlılık oluşturma
- kullanıcı session bilgilerini ele geçirmeye çalışma
- credential isteme
- CAPTCHA bypass yapma
- anti-bot mekanizmalarını aşmaya çalışma
- rate limit bypass yapma

Extension normal kullanıcı oturumunun içinden, sayfada kullanıcı tarafından gerçekleştirilebilen işlemleri yönetmeye odaklanmalı.

X tarafından bir işlem engellenirse kullanıcıya açık şekilde bildir ve otomasyonu durdur.

---

# 68. SONUÇTA BEKLENEN ÜRÜN

Son ürün kullanıcıya şu deneyimi vermeli:

```text
Chrome'a extension kur
        ↓
X'e giriş yap
        ↓
Extension'ı aç
        ↓
Scan Now
        ↓
Followers + Following taranır
        ↓
Dashboard oluşur
        ↓
"386 kişi beni takip etmiyor"
        ↓
Not Following sayfası
        ↓
Filtrele / sırala
        ↓
Kullanıcıları seç
        ↓
Unfollow Selected
        ↓
İşlem kuyruğu
        ↓
Sonuç
```

Ayrıca birkaç gün sonra:

```text
Changes

17 kişi seni takipten çıkardı.

12 kişi seni takip etmeye başladı.

34 yeni ilişki değişikliği tespit edildi.
```

görülebilmeli.

---

# 69. SON GELİŞTİRME TALİMATI

Şimdi projeyi geliştir.

Önce repository'yi analiz et.

Ardından mevcut yapıyı yukarıdaki mimariye uygun hale getir.

Eksik dosyaları oluştur.

Her phase'i sırayla uygula.

Her phase sonunda build/test yap.

Kod çalışmadan sonraki phase'e geçme.

UI'ı sadece placeholder olarak bırakma.

Gerçek çalışan:

- X scanner
- IndexedDB
- relationship analysis
- history
- sorting
- filtering
- single unfollow
- bulk unfollow
- dashboard

özelliklerini implement et.

Özellikle **"Seni takip etmeyenler"**, **"Yeni takipten çıkanlar"**, **"Karşılıklı bağlantılar"**, **"Ortak bağlantılar"**, **"Takipçileri baştan sona / sondan başa sıralama"** ve **tekli/toplu takipten çıkarma** özellikleri projenin birinci sınıf özellikleri olmalıdır.

Kod üretirken varsayımsal sahte verilerle çalışan bir demo yerine gerçek Chrome Extension mimarisini kur.

Herhangi bir X DOM/API davranışı kesin olarak bilinmiyorsa bunu varsayım olarak kodun içine gömmek yerine ilgili parser/action katmanını izole et ve kolayca değiştirilebilir yap.

Son aşamada:

```bash
npm run build
```

başarılı olmalı ve Chrome'a `dist` klasörü yüklenerek extension çalıştırılabilmelidir.