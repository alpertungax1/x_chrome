# 🚀 X Relationship & Unfollower Manager

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-5.x-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/TailwindCSS-3.x-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Privacy-100%25%20Local-success?style=for-the-badge&logo=shield" alt="Privacy First" />
</p>

---

## 📌 Genel Bakış / Overview

**TR:**  
**X Relationship Manager**, [X.com](https://x.com) (eski adıyla Twitter) üzerinde takipçi ve takip listenizi derinlemesine analiz eden, sizi geri takip etmeyenleri, karşılıklı takipleri ve inaktif (hareketsiz) hesapları tespit eden, yapay zeka destekli güvenlik mekanizmalarıyla hesabınızı riske atmadan güvenli toplu takipten çıkarma (batch unfollow) imkanı sunan modern bir Chrome eklentisidir.

**EN:**  
**X Relationship Manager** is an advanced Chrome Extension (Manifest V3, React 18, TypeScript) designed for X.com (Twitter). It provides comprehensive relationship analytics, non-follower detection, inactive user tracking by latest tweet date, and safe automated batch unfollowing powered by anti-ban safety presets and rate-limit controls.

---

## ✨ Temel Özellikler / Key Features

### 🔍 1. Gelişmiş İlişki Analizi & Filtreleme (Relationship Analytics)
- **Geri Takip Etmeyenler (Not Following Back):** Sizin takip ettiğiniz fakat sizi takip etmeyen tüm hesapları tek tıkla listeleyin.
- **Karşılıklı Takipler (Mutuals):** Birbirinizi karşılıklı takip ettiğiniz aktif çevrenizi görüntüleyin.
- **Takipçiler & Takip Edilenler:** Tüm ağınızı sade, hızlı ve responsive bir arayüzde inceleyin.
- **Akıllı Sıralama:** Takipçileri en eski, en yeni, takipçi sayısı (artan/azalan), isim veya **son gönderi tarihine göre** anında sıralayın.

### 🛡️ 2. Akıllı Güvenlik & Anti-Ban Motoru (Safety & Rate-Limit Engine)
Hesabınızın kısıtlanmasını veya askıya alınmasını önlemek için çok katmanlı güvenlik parametreleri:
- **Güvenlik Önayarları (Safety Presets):**
  - 🛡️ **Dengeli (Balanced):** Günlük kullanım ve standart hesaplar için optimize edilmiş dengeli bekleme aralıkları.
  - 🐢 **Muhafazakar (Conservative):** Maksimum güvenlik, uzun bekleme süreleri ve sık dinlenme periyotları.
  - ⚡ **Hızlı / X Premium (Fast):** X Premium (mavi tikli) ve yüksek limitli hesaplar için optimize edilmiş hızlı ve güvenli mod.
- **Akıllı Jitter (Rastgele Gecikme):** İşlemler arasına rastgele milisaniyeler ekleyerek bot algılama algoritmalarını bertaraf eder, insan davranışını simüle eder.
- **Toplu İşlem Molası (Batch Cooldown / Coffee Break):** Belirlenen işlem adedine (örn: her 20 kişide bir) ulaşıldığında otomatik dinlenme moduna geçer.
- **Günlük Limit Koruması:** Belirlediğiniz günlük takipten çıkarma sınırına ulaşıldığında işlemleri otomatik durdurur.

### 📅 3. İnaktif Hesap Tespiti & Son Tweet Analizi (Inactive User Detection)
- X.com API ve GraphQL ağ trafiğini dinleyen hafif yakalayıcı (`network-hook`) sayesinde kullanıcıların **son paylaşım tarihlerini** arka planda otomatik toplar.
- Taranmamış hesaplar için tek tıkla hızlı REST/GraphQL taraması yapar.
- Uzun süredir paylaşım yapmayan hesaplara **İnaktif Rozetleri** atar; böylece ölü hesapları takip listenizden kolayca ayıklayabilirsiniz.

### 🛡️ 4. Whitelist (Güvenli Liste) Koruması
- Arkadaşlarınızı, önemli figürleri veya takipten çıkarmak istemediğiniz hesapları **Yıldızlayarak (Whitelist)** koruma altına alın.
- Toplu seçim veya "Tümünü Seç" işlemlerinde Whitelist'teki hesaplar otomatik olarak hariç tutulur.

### 🔒 5. %100 Yerel ve Gizlilik Odaklı (Privacy-First)
- **Sıfır Dış Sunucu:** Hiçbir veri harici sunuculara veya üçüncü şahıslara aktarılmaz.
- **Şifresiz Çalışma:** Kullanıcı adı veya parola istemez; doğrudan tarayıcınızın aktif X oturumu üzerinden çalışır.
- **Sınırsız Yerel Depolama:** Veriler tarayıcınızın `IndexedDB` ve `chrome.storage.local` veritabanında saklanır (`unlimitedStorage`).

### 🌐 6. Çift Dil Desteği (i18n)
- Tek tıkla Türkçe ve İngilizce dil seçenekleri arasında geçiş.

---

## 🏗️ Mimari & Çalışma Prensibi / Architecture

```text
Chrome Extension (Manifest V3)
│
├── 🌐 Content Script (MAIN World: network-hook.ts)
│   └── X.com GraphQL & REST çağrılarını dinler (kullanıcı profilleri & son tweet tarihleri)
│
├── ⚙️ Content Script (ISOLATED World: content.ts)
│   ├── X DOM Parser ve UI entegrasyonu
│   └── Güvenli DOM Action Handler (Takipten çıkma / Takip etme eylemleri)
│
├── 🧠 Background Service Worker (service-worker.ts)
│   ├── Sekme yönetimi & yetkilendirme kontrolü
│   └── Uzun süreli görev koordinasyonu
│
├── 💻 Modern React 18 UI (Popup / Dashboard)
│   ├── Zustand State Management
│   ├── Tailwind CSS + Lucide Icons
│   └── IndexedDB Veri Katmanı (idb)
```

---

## 📦 Kurulum & Geliştirme / Installation & Build

### Gereksinimler
- [Node.js](https://nodejs.org/) (v18 veya üzeri önerilir)
- [npm](https://www.npmjs.com/) veya [pnpm](https://pnpm.io/)
- Google Chrome, Brave, Microsoft Edge veya Opera tarayıcı

### 1. Projeyi Klonlayın ve Bağımlılıkları Yükleyin:
```bash
git clone https://github.com/alpertungax1/x_chrome.git
cd x_chrome
npm install
```

### 2. Projeyi Derleyin (Build):
```bash
npm run build
```
Bu komut TypeScript denetimini gerçekleştirir ve `dist/` klasörü içerisine yayına hazır Manifest V3 eklenti dosyalarını üretir.

### 3. Tarayıcıya Yükleme (Load Unpacked):
1. Chromium tabanlı tarayıcınızı açın (Chrome, Edge, Brave, Opera).
2. Adres çubuğuna `chrome://extensions` (Edge için `edge://extensions`) yazıp Enter'a basın.
3. Sağ üst köşedeki **Geliştirici Modu (Developer Mode)** anahtarını aktif hale getirin.
4. Sol üstteki **Paketlenmemiş Öğe Yükle (Load unpacked)** butonuna tıklayın.
5. Proje dizinindeki **`dist`** klasörünü seçin.
6. Eklenti simgesini tarayıcınızın araç çubuğuna sabitleyin.

---

## 🚀 Kullanım Rehberi / How to Use

1. [x.com](https://x.com) adresine gidin ve hesabınıza giriş yapın.
2. Tarayıcı araç çubuğundaki **X Relationship Manager** simgesine tıklayın.
3. **"Tara" (Scan Now)** butonuna tıklayarak takipçi ve takip ettikleriniz listesini taratın.
4. Tarama tamamlandığında **"Geri Takip Etmeyenler"** veya **"X Unfollowers"** sekmesine geçin.
5. Filtreleri kullanarak inaktif hesapları veya belirli takipçi sayısındaki kişileri süzün.
6. Korumak istediğiniz kullanıcıları yıldızlayarak Whitelist'e ekleyin.
7. Çıkarmak istediğiniz hesapları seçin ve güvenlik presetini belirledikten sonra **"Takipten Çık"** butonuna basın.

---

## ⚙️ Güvenlik Önerileri & Limitler (Best Practices)

> [!IMPORTANT]
> X (Twitter) otomasyon algoritmaları ani ve anormal hareketleri izlemektedir. Hesabınızın güvenliği için aşağıdaki kurallara dikkat ediniz:

| Hesap Türü | Önerilen Günlük Limit | Önerilen Güvenlik Profili | Önerilen Mola (Batch Cooldown) |
| :--- | :--- | :--- | :--- |
| **Yeni / Standart Hesaplar** | 50 – 100 işlem / gün | `Conservative` veya `Balanced` | Her 15 işlemde 30-45 sn mola |
| **X Premium (Onaylı Hesaplar)** | 150 – 300 işlem / gün | `Fast / X Premium` veya `Balanced` | Her 25 işlemde 20-30 sn mola |

- İşlemler sırasında tarayıcı sekmesini arka planda kendi haline bırakın, sayfayı manuel olarak zorlamayın.
- Bekleme sürelerini (delay) 2 saniyenin altına çekmemeniz tavsiye edilir.

---

## 🛠️ Teknoloji Yığını / Tech Stack

- **Framework & UI:** [React 18](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/)
- **Build Tool:** [Vite 5](https://vitejs.dev/) + [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin)
- **Icons:** [Lucide React](https://lucide.dev/)
- **State & Storage:** [Zustand](https://github.com/pmndrs/zustand), [IndexedDB (idb)](https://github.com/jakearchibald/idb), Chrome Storage API
- **Internationalization:** Built-in lightweight i18n (TR / EN)

---

## 📄 Lisans / License

Bu proje [MIT Lisansı](LICENSE) kapsamında açık kaynak olarak sunulmaktadır.

---

<p align="center">
  Geliştirici: <a href="https://github.com/alpertungax1">@alpertungax1</a>
</p>
