import { UnfollowerUser, UnfollowersSettings } from '../types/unfollowers';

const FALLBACK_BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const FALLBACK_FEATURES = JSON.stringify({
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
});

const FALLBACK_QUERY_IDS = [
  'zx6e-TLzRkeDO_a7p4b3JQ',
  'g5P4cbXR4ta4oCeE7y2vLQ',
  't-BPmIS0UWDrFdYrOxEOdQ',
  '4vh57z89_R779N4-8k-b4g',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export class UnfollowersService {
  private bearer: string | null = null;
  private queryId: string | null = null;
  private features: string | null = null;
  private fieldToggles: string | null = null;
  private userId: string | null = null;
  private csrfToken: string | null = null;

  public async getSettings(): Promise<UnfollowersSettings> {
    try {
      const data = await chrome.storage.local.get('xrm_unfollowers_settings');
      const s = data.xrm_unfollowers_settings || {};
      const today = getTodayString();
      const dailyCount = s.dailyDate === today ? Number(s.dailyCount) || 0 : 0;
      return {
        delaySeconds: Math.min(600, Math.max(2, Number(s.delaySeconds) || 5)),
        minDelaySeconds: Math.min(600, Math.max(1, Number(s.minDelaySeconds) || 3)),
        maxDelaySeconds: Math.min(600, Math.max(2, Number(s.maxDelaySeconds) || 7)),
        jitter: s.jitter !== false,
        safetyPreset: s.safetyPreset || 'balanced',
        enableBatchCooldown: s.enableBatchCooldown !== false,
        batchSize: Math.max(5, Number(s.batchSize) || 20),
        cooldownSeconds: Math.max(5, Number(s.cooldownSeconds) || 25),
        dailyLimit: Number(s.dailyLimit) || 200,
        whitelist: Array.isArray(s.whitelist) ? s.whitelist : [],
        dailyDate: today,
        dailyCount,
      };
    } catch {
      return {
        delaySeconds: 5,
        minDelaySeconds: 3,
        maxDelaySeconds: 7,
        jitter: true,
        safetyPreset: 'balanced',
        enableBatchCooldown: true,
        batchSize: 20,
        cooldownSeconds: 25,
        dailyLimit: 200,
        whitelist: [],
        dailyDate: getTodayString(),
        dailyCount: 0,
      };
    }
  }

  public async saveSettings(settings: Partial<UnfollowersSettings>): Promise<void> {
    try {
      const current = await this.getSettings();
      const updated: UnfollowersSettings = {
        ...current,
        ...settings,
        whitelist: settings.whitelist ? Array.from(new Set(settings.whitelist)) : current.whitelist,
      };
      await chrome.storage.local.set({ xrm_unfollowers_settings: updated });
    } catch (e) {
      console.warn('Failed to save unfollowers settings:', e);
    }
  }

  public async incrementDailyCount(): Promise<number> {
    const settings = await this.getSettings();
    const newCount = settings.dailyCount + 1;
    await this.saveSettings({ dailyCount: newCount, dailyDate: getTodayString() });
    return newCount;
  }

  private waitForTabLoaded(tabId: number, timeoutMs = 15000): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }, timeoutMs);

      const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
        if (id === tabId && info.status === 'complete') {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  /**
   * X sekmesinden doğrudan çerezleri ve kullanıcı kimliğini oku
   */
  public async readCredsFromTab(tabId: number): Promise<{ csrf: string | null; userId: string | null }> {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const getCookie = (name: string) => {
            const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
            return m ? decodeURIComponent(m[1]) : null;
          };
          const ct0 = getCookie('ct0');
          const twid = getCookie('twid') || '';
          const m = twid.match(/(\d{5,})/);
          return {
            csrf: ct0,
            userId: m ? m[1] : null,
          };
        },
      });
      if (result?.result) {
        if (result.result.csrf) this.csrfToken = result.result.csrf;
        if (result.result.userId) this.userId = result.result.userId;
        return result.result;
      }
    } catch (e) {
      console.warn('readCredsFromTab error:', e);
    }
    return { csrf: this.csrfToken, userId: this.userId };
  }

  /**
   * Çoklu sekmeler arasından oturumu en geçerli ve canlı olan X sekmesini bul
   */
  public async ensureXSession(onStatus?: (msg: string) => void): Promise<number> {
    onStatus?.('Açık X sekmeleri taranıyor...');
    const tabs = await chrome.tabs.query({ url: ['*://x.com/*', '*://twitter.com/*'] });

    let bestTabId: number | null = null;

    // 1. Tüm açık X sekmelerini kontrol et ve içinde geçerli ct0 olanı seç
    for (const tab of tabs) {
      if (tab.id && !tab.discarded) {
        const creds = await this.readCredsFromTab(tab.id);
        if (creds.csrf) {
          bestTabId = tab.id;
          // Eğer /following veya /followers sayfasıysa kesinlikle ilk tercihimiz
          if (tab.url && (tab.url.includes('/following') || tab.url.includes('/followers'))) {
            break;
          }
        }
      }
    }

    // 2. Eğer açık sekmelerde ct0 bulunamadıysa ama sekmeler varsa ilkini al
    if (!bestTabId && tabs.length > 0 && tabs[0].id) {
      bestTabId = tabs[0].id;
    }

    // 3. Hiç X sekmesi yoksa yeni bir sekme aç
    if (!bestTabId) {
      onStatus?.('X sekmesi açılıyor...');
      const newTab = await chrome.tabs.create({
        url: 'https://x.com/home',
        active: false,
      });
      if (!newTab.id) throw new Error('X sekmesi açılamadı.');
      bestTabId = newTab.id;
      await this.waitForTabLoaded(bestTabId);
      await sleep(2000);
    }

    // Seçilen sekmede content script'in hazır olduğundan emin ol
    let ready = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const pingRes: any = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(bestTabId, { type: 'PING' }, (res) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res);
          });
        });
        if (pingRes?.ok) {
          ready = true;
          break;
        }
      } catch {
        if (attempt === 0) {
          try {
            const manifest = chrome.runtime.getManifest();
            const cs = manifest.content_scripts?.find((c) => c.js?.some((f) => f.includes('content')));
            if (cs?.js) {
              await chrome.scripting.executeScript({
                target: { tabId: bestTabId },
                files: cs.js,
              });
            }
          } catch {
            try {
              await chrome.tabs.reload(bestTabId);
              await this.waitForTabLoaded(bestTabId);
            } catch (_) {}
          }
        }
        await sleep(1000);
      }
    }

    return bestTabId;
  }

  /**
   * X Unfollowers Taraması (X sekmesindeki content script üzerinden)
   */
  public async scanUnfollowers(
    onStatus: (status: string) => void,
    _onProgressCount: (count: number) => void,
    isAborted: () => boolean
  ): Promise<UnfollowerUser[]> {
    onStatus('X sekmesi ve oturumu kontrol ediliyor...');
    const tabId = await this.ensureXSession(onStatus);

    if (isAborted()) return [];

    const progressListener = (msg: any) => {
      if (msg?.type === 'UNFOLLOWERS_PROGRESS' && msg.payload?.status) {
        onStatus(msg.payload.status);
      }
    };
    chrome.runtime.onMessage.addListener(progressListener);

    try {
      onStatus('Takip listeniz taranıyor...');
      const response: any = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: 'START_UNFOLLOWERS_SCAN' }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        });
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Tarama başarısız oldu.');
      }

      const users: UnfollowerUser[] = response.users || [];
      const settings = await this.getSettings();
      const whitelistSet = new Set(settings.whitelist);

      return users.map((u) => ({
        ...u,
        isWhitelisted: whitelistSet.has(u.id),
      }));
    } finally {
      chrome.runtime.onMessage.removeListener(progressListener);
    }
  }

  /**
   * Tüm Takip Edilenler ve Takipçileri Gerçek Takipçi Sayılarıyla Çeker (Pencere açmaz, %100 Arka Planda)
   */
  public async scanFullRelationshipsDirect(
    onStatus?: (text: string) => void
  ): Promise<{ following: any[]; followers: any[] }> {
    onStatus?.('X oturumu doğrulanıyor...');
    const tabId = await this.ensureXSession(onStatus);

    const progressListener = (msg: any) => {
      if (msg?.type === 'SCAN_PROGRESS' && msg.payload?.debug) {
        onStatus?.(msg.payload.debug);
      }
    };
    chrome.runtime.onMessage.addListener(progressListener);

    try {
      onStatus?.('Hesaplar ve takipçi sayıları taranıyor...');
      const response: any = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: 'START_FULL_SCAN_DIRECT' }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        });
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Tarama başarısız oldu.');
      }

      return {
        following: response.following || [],
        followers: response.followers || [],
      };
    } finally {
      chrome.runtime.onMessage.removeListener(progressListener);
    }
  }

  public async stopFullScanDirect(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({ url: ['*://x.com/*', '*://twitter.com/*'] });
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'STOP_FULL_SCAN_DIRECT' }, () => {
            void chrome.runtime.lastError;
          });
        }
      }
    } catch (e) {
      console.warn('stopFullScanDirect failed:', e);
    }
  }

  public async unfollowUser(user: { id?: string; username: string; numericId?: string }): Promise<boolean> {
    const tabId = await this.ensureXSession();
    const resolvedUserId = user.numericId || (/^\d+$/.test(user.id || '') ? user.id : undefined);
    const response: any = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        {
          type: 'UNFOLLOW_USER_DIRECT',
          payload: {
            userId: resolvedUserId || user.id,
            numericId: user.numericId,
            username: user.username,
          },
        },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        }
      );
    });

    if (!response?.success) {
      throw new Error(response?.error || 'Takipten çıkarma başarısız oldu.');
    }
    return true;
  }

  /**
   * X Oturumu üzerinden 100'erli paketlerle gerçek takipçi sayılarını çeker (Ücretsiz & Hızlı)
   */
  public async fetchFollowerCountsDirect(
    usernamesOrIds: string[]
  ): Promise<{ username: string; followersCount: number; id?: string; avatar?: string; displayName?: string; bio?: string; lastTweetAt?: number; lastTweetText?: string }[]> {
    const tabId = await this.ensureXSession();
    const response: any = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'LOOKUP_USERS_DIRECT', payload: { list: usernamesOrIds } },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        }
      );
    });

    if (!response?.success) {
      throw new Error(response?.error || 'Kullanıcı bilgileri çekilemedi.');
    }

    return response.results || [];
  }

  /**
   * Anti-Ban & Doğal İnsan Davranışı Simülasyonlu Rastgele Süre Hesaplayıcı
   */
  public calculateDelayMs(
    minSeconds?: number,
    maxSeconds?: number,
    jitter: boolean = true
  ): number {
    const rawMin = Number(minSeconds);
    const rawMax = Number(maxSeconds);
    const validMin = (!isNaN(rawMin) && rawMin > 0) ? rawMin : 3;
    const validMax = (!isNaN(rawMax) && rawMax >= validMin) ? rawMax : Math.max(validMin + 4, 7);

    const min = Math.max(1.5, Math.min(validMin, validMax));
    const max = Math.max(min, validMax);

    // Uniform random in range [min, max]
    let chosenSec = min + Math.random() * (max - min);

    // Organik insan jitter'ı (±%15)
    if (jitter) {
      const jitterFactor = 0.85 + Math.random() * 0.3;
      chosenSec = chosenSec * jitterFactor;
    }

    return Math.round(Math.max(1500, chosenSec * 1000));
  }
}

export const unfollowersService = new UnfollowersService();
