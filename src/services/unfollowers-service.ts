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
        delaySeconds: Math.min(600, Math.max(5, Number(s.delaySeconds) || 30)),
        jitter: s.jitter !== false,
        whitelist: Array.isArray(s.whitelist) ? s.whitelist : [],
        dailyDate: today,
        dailyCount,
      };
    } catch {
      return {
        delaySeconds: 30,
        jitter: true,
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

  /**
   * Çerezleri veya yakalanmış token'ları tespit et
   */
  public async ensureCredentials(): Promise<{ csrf: string; userId: string; bearer: string }> {
    // 1. Storage'dan daha önce network-hook tarafından yakalanan kimlikleri kontrol et
    const stored = await chrome.storage.local.get('xrm_captured_creds');
    if (stored.xrm_captured_creds) {
      const c = stored.xrm_captured_creds;
      if (c.bearer) this.bearer = c.bearer;
      if (c.queryId) this.queryId = c.queryId;
      if (c.features) this.features = c.features;
      if (c.fieldToggles) this.fieldToggles = c.fieldToggles;
      if (c.userId) this.userId = c.userId;
      if (c.csrf) this.csrfToken = c.csrf;
    }

    // 2. chrome.cookies API ile x.com çerezlerini oku
    if (chrome.cookies) {
      try {
        const ct0Cookie = await chrome.cookies.get({ url: 'https://x.com', name: 'ct0' }) ||
                           await chrome.cookies.get({ url: 'https://twitter.com', name: 'ct0' });
        if (ct0Cookie?.value) {
          this.csrfToken = ct0Cookie.value;
        }

        const twidCookie = await chrome.cookies.get({ url: 'https://x.com', name: 'twid' }) ||
                            await chrome.cookies.get({ url: 'https://twitter.com', name: 'twid' });
        if (twidCookie?.value) {
          const m = decodeURIComponent(twidCookie.value).match(/(\d{5,})/);
          if (m) this.userId = m[1];
        }
      } catch (e) {
        console.warn('chrome.cookies get error:', e);
      }
    }

    // 3. Hala yoksa açık x.com sekmesine sor
    if (!this.csrfToken || !this.userId) {
      await this.requestCredentialsFromXTab();
    }

    if (!this.csrfToken) {
      throw new Error('X oturumu bulunamadı. Lütfen x.com sekmesinde giriş yapın.');
    }

    return {
      csrf: this.csrfToken,
      userId: this.userId || '',
      bearer: this.bearer || FALLBACK_BEARER,
    };
  }

  private async requestCredentialsFromXTab(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({ url: ['*://x.com/*', '*://twitter.com/*'] });
      if (tabs.length > 0 && tabs[0].id) {
        const res = await chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_CREDENTIALS' }).catch(() => null);
        if (res) {
          if (res.csrf) this.csrfToken = res.csrf;
          if (res.userId) this.userId = res.userId;
          if (res.bearer) this.bearer = res.bearer;
          if (res.queryId) this.queryId = res.queryId;
          if (res.features) this.features = res.features;
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * X API isteği yap (X oturum çerezleri ile)
   */
  public async xApiRequest(path: string, options: { method?: string; body?: any; headers?: Record<string, string>; _retry?: number } = {}): Promise<any> {
    const creds = await this.ensureCredentials();
    const retry = options._retry || 0;

    const headers: Record<string, string> = {
      authorization: creds.bearer,
      'x-csrf-token': creds.csrf,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'tr',
      accept: '*/*',
      ...(options.headers || {}),
    };

    if (options.body && !headers['content-type']) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }

    const res = await fetch('https://x.com' + path, {
      method: options.method || 'GET',
      headers,
      body: options.body || undefined,
      credentials: 'include',
    });

    if (res.status === 429 && retry < 4) {
      const waitTime = Math.max(Number(res.headers.get('retry-after') || 45) * 1000, 30000);
      console.warn(`X Rate limit (429) hit. Waiting ${waitTime / 1000}s...`);
      await sleep(waitTime);
      return this.xApiRequest(path, { ...options, _retry: retry + 1 });
    }

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // json parse failed
    }

    if (!res.ok) {
      const msg = json?.errors?.[0]?.message || json?.error || `X API Hatası (${res.status})`;
      const err: any = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }

    return json;
  }

  /**
   * GraphQL veya REST yanıtından UnfollowerUser nesnesini çıkar
   */
  private extractUser(raw: any): UnfollowerUser | null {
    if (!raw || typeof raw !== 'object') return null;
    const node = raw.result && raw.result.legacy ? raw.result : raw;
    if (!node || node.__typename === 'UserUnavailable') return null;
    const legacy = node.legacy || {};
    const core = node.core || {};
    const rel = node.relationship_perspectives || {};
    const id = String(node.rest_id || node.id_str || legacy.id_str || '');
    const username = core.screen_name || legacy.screen_name || '';
    if (!id || !username) return null;
    const followedBy = rel.followed_by ?? legacy.followed_by ?? null;
    return {
      id,
      username,
      name: core.name || legacy.name || username,
      avatar: node.avatar?.image_url || legacy.profile_image_url_https || '',
      followers: legacy.followers_count || 0,
      followingCount: legacy.friends_count || 0,
      followedBy: typeof followedBy === 'boolean' ? followedBy : null,
      verified: !!(node.is_blue_verified || legacy.verified),
    };
  }

  private walkGraphQL(json: any): { users: UnfollowerUser[]; cursor: string | null } {
    const users: UnfollowerUser[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;

    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node.cursorType && /bottom/i.test(String(node.cursorType)) && typeof node.value === 'string') {
        cursor = node.value;
      }
      const ur = node.user_results?.result || node.userResults?.result;
      if (ur) {
        const u = this.extractUser(ur);
        if (u && !seen.has(u.id)) {
          seen.add(u.id);
          users.push(u);
        }
      }
      for (const k of Object.keys(node)) visit(node[k]);
    };

    visit(json);
    if (cursor === '0') cursor = null;
    return { users, cursor };
  }

  /**
   * GraphQL üzerinden Following listesini sayfalar halinde çek
   */
  public async fetchFollowingGraphQL(
    queryId: string,
    features: string,
    onProgress?: (count: number) => void,
    isAborted?: () => boolean
  ): Promise<UnfollowerUser[]> {
    const creds = await this.ensureCredentials();
    const uid = creds.userId;
    if (!uid) throw new Error('Kullanıcı kimliği (User ID) okunamadı. Lütfen x.com’a giriş yapın.');

    const all: UnfollowerUser[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;

    while (!isAborted?.()) {
      pages += 1;
      const variables: any = {
        userId: uid,
        count: 100,
        includePromotedContent: false,
      };
      if (cursor) variables.cursor = cursor;

      let path = `/i/api/graphql/${queryId}/Following?variables=${encodeURIComponent(
        JSON.stringify(variables)
      )}&features=${encodeURIComponent(features || FALLBACK_FEATURES)}`;

      if (this.fieldToggles) {
        path += `&fieldToggles=${encodeURIComponent(this.fieldToggles)}`;
      }

      const json = await this.xApiRequest(path);
      const parsed = this.walkGraphQL(json);

      for (const u of parsed.users) {
        if (!seen.has(u.id)) {
          seen.add(u.id);
          all.push(u);
        }
      }

      onProgress?.(all.length);

      if (!parsed.cursor || parsed.users.length === 0) break;
      cursor = parsed.cursor;
      await sleep(700 + Math.floor(Math.random() * 500));
      if (pages > 250) break; // Güvenlik sınırı (25.000 hesap)
    }

    return all;
  }

  /**
   * REST API Fallback ile Following listesini çek
   */
  public async fetchFollowingRest(
    onProgress?: (count: number) => void,
    isAborted?: () => boolean
  ): Promise<UnfollowerUser[]> {
    const all: UnfollowerUser[] = [];
    const seen = new Set<string>();
    let cursor = '-1';
    let pages = 0;

    while (!isAborted?.() && cursor && cursor !== '0') {
      pages += 1;
      const json = await this.xApiRequest(
        `/i/api/1.1/friends/list.json?count=200&cursor=${encodeURIComponent(cursor)}&skip_status=true&include_user_entities=false`
      );
      const users = Array.isArray(json?.users) ? json.users : [];
      for (const raw of users) {
        const u: UnfollowerUser = {
          id: String(raw.id_str || raw.id),
          username: raw.screen_name,
          name: raw.name || raw.screen_name,
          avatar: raw.profile_image_url_https || '',
          followers: raw.followers_count || 0,
          followingCount: raw.friends_count || 0,
          followedBy: typeof raw.followed_by === 'boolean' ? raw.followed_by : null,
          verified: !!raw.verified,
        };
        if (u.id && u.username && !seen.has(u.id)) {
          seen.add(u.id);
          all.push(u);
        }
      }
      onProgress?.(all.length);
      cursor = json?.next_cursor_str || '0';
      if (!users.length) break;
      await sleep(700 + Math.floor(Math.random() * 500));
      if (pages > 250) break;
    }

    return all;
  }

  /**
   * 100'erli paketlerle kullanıcının seni geri takip edip etmediğini kontrol et
   */
  public async lookupFollowedBy(
    accounts: UnfollowerUser[],
    onProgress?: (completed: number, total: number) => void,
    isAborted?: () => boolean
  ): Promise<void> {
    const unknown = accounts.filter((u) => u.followedBy == null);
    for (let i = 0; i < unknown.length; i += 100) {
      if (isAborted?.()) break;
      const batch = unknown.slice(i, i + 100);
      const ids = batch.map((u) => u.id).join(',');
      try {
        const json = await this.xApiRequest(`/i/api/1.1/friendships/lookup.json?user_id=${ids}`);
        const rows = Array.isArray(json) ? json : [];
        const map = new Map<string, boolean>();
        for (const row of rows) {
          const id = String(row.id_str || row.id);
          const connections: string[] = row.connections || [];
          map.set(id, connections.includes('followed_by'));
        }
        for (const u of batch) {
          if (map.has(u.id)) {
            u.followedBy = map.get(u.id)!;
          }
        }
      } catch (e) {
        console.warn('friendships lookup batch failed:', e);
      }
      onProgress?.(Math.min(i + 100, unknown.length), unknown.length);
      if (i + 100 < unknown.length) await sleep(500);
    }
  }

  /**
   * Ana Tarama Fonksiyonu: Seni geri takip etmeyenleri bulur ve döner
   */
  public async scanUnfollowers(
    onStatus: (status: string) => void,
    onProgressCount: (count: number) => void,
    isAborted: () => boolean
  ): Promise<UnfollowerUser[]> {
    onStatus('Oturum bilgileri doğrulanıyor...');
    await this.ensureCredentials();

    if (isAborted()) return [];

    let following: UnfollowerUser[] = [];
    const queryIds = [...new Set([this.queryId, ...FALLBACK_QUERY_IDS].filter(Boolean))] as string[];
    const features = this.features || FALLBACK_FEATURES;
    let lastErr: any = null;

    onStatus('Takip edilen hesaplar taranıyor...');
    for (const qid of queryIds) {
      try {
        following = await this.fetchFollowingGraphQL(
          qid,
          features,
          (count) => {
            onProgressCount(count);
            onStatus(`Takip listesi taranıyor... ${count} hesap`);
          },
          isAborted
        );
        this.queryId = qid;
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err;
        if (err.status && err.status !== 404 && err.status !== 400) throw err;
      }
    }

    if (!following.length && !isAborted()) {
      try {
        onStatus('REST API üzerinden takip edilenler taranıyor...');
        following = await this.fetchFollowingRest(
          (count) => {
            onProgressCount(count);
            onStatus(`Takip listesi taranıyor (REST)... ${count} hesap`);
          },
          isAborted
        );
      } catch (err: any) {
        lastErr = err;
      }
    }

    if (!following.length) {
      throw new Error(
        'Takip listeniz okunamadı: ' + (lastErr?.message || 'Lütfen x.com sekmesini açıp sayfayı biraz kaydırın.')
      );
    }

    if (isAborted()) return [];

    onStatus(`Geri takip durumu kontrol ediliyor... (${following.length} hesap)`);
    await this.lookupFollowedBy(
      following,
      (done, total) => {
        onStatus(`Geri takip kontrolü: ${done} / ${total}`);
      },
      isAborted
    );

    if (isAborted()) return [];

    // Seni takip ETMEYENLERİ filtrele (followedBy === false)
    const settings = await this.getSettings();
    const whitelistSet = new Set(settings.whitelist);

    const nonFollowers = following.filter((u) => u.followedBy === false).map((u) => ({
      ...u,
      isWhitelisted: whitelistSet.has(u.id),
    }));

    return nonFollowers;
  }

  /**
   * Doğrudan X API üzerinden bir hesabı takipten çıkar
   */
  public async unfollowUser(user: { id: string; username: string }): Promise<boolean> {
    await this.xApiRequest('/i/api/1.1/friendships/destroy.json', {
      method: 'POST',
      body: new URLSearchParams({ user_id: user.id }).toString(),
    });
    return true;
  }

  /**
   * Gecikme süresi (Jitter opsiyonu ile) hesapla
   */
  public calculateDelayMs(delaySeconds: number, jitter: boolean): number {
    const base = Math.max(5, delaySeconds) * 1000;
    if (!jitter) return base;
    return Math.round(base * (0.8 + Math.random() * 0.4)); // ±%20 sapma
  }
}

export const unfollowersService = new UnfollowersService();
