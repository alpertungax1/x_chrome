/**
 * MAIN world, document_start — X GraphQL yanıtlarından followers_count yakalar
 * ve 0xAnubiss/x-unfollowers köprüsüyle Bearer token / GraphQL Following parametrelerini kaydeder.
 */
(() => {
  const w = window as Window & {
    __XRM_META__?: Record<
      string,
      { followersCount?: number; followingCount?: number; displayName?: string; numericId?: string }
    >;
    __XRM_HOOK__?: boolean;
    __XRM_CREDS__?: {
      bearer?: string;
      queryId?: string;
      features?: string;
      fieldToggles?: string;
      userId?: string;
      csrf?: string;
    };
  };

  if (w.__XRM_HOOK__) return;
  w.__XRM_HOOK__ = true;
  if (!w.__XRM_META__) w.__XRM_META__ = {};
  if (!w.__XRM_CREDS__) w.__XRM_CREDS__ = {};

  const FOLLOWING_RE = /\/i\/api\/graphql\/[A-Za-z0-9_-]+\/Following(?!\w)/;

  function postCreds() {
    const csrf = getCookie('ct0');
    const uid = w.__XRM_CREDS__?.userId || userIdFromCookie();
    if (csrf) w.__XRM_CREDS__!.csrf = csrf;
    if (uid) w.__XRM_CREDS__!.userId = uid;

    window.postMessage(
      {
        source: 'xrm-bridge',
        type: 'CREDENTIALS_CAPTURED',
        creds: w.__XRM_CREDS__,
      },
      '*'
    );
  }

  function getCookie(name: string): string | null {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function userIdFromCookie(): string | null {
    const m = document.cookie.match(/(?:^|;\s*)twid=u(?:%3D|=)"?(\d+)/i);
    return m ? m[1] : null;
  }

  function captureBearer(value: string | null | undefined) {
    const v = String(value || '');
    if (!v.startsWith('Bearer ')) return;
    if (w.__XRM_CREDS__!.bearer !== v) {
      w.__XRM_CREDS__!.bearer = v;
      postCreds();
    }
  }

  function extractFromUrl(url: string) {
    try {
      const queryMatch = String(url).match(/\/graphql\/([A-Za-z0-9_-]+)\//);
      if (!queryMatch) return null;
      const u = new URL(url, location.href);
      const rawVars = u.searchParams.get('variables');
      let parsedUserId = null;
      if (rawVars) {
        try {
          parsedUserId = JSON.parse(rawVars).userId || null;
        } catch (_) {}
      }
      return {
        queryId: queryMatch[1],
        features: u.searchParams.get('features'),
        fieldToggles: u.searchParams.get('fieldToggles'),
        userId: parsedUserId,
      };
    } catch (_) {
      return null;
    }
  }

  function handleFollowingUrl(url: string) {
    const extracted = extractFromUrl(url);
    if (!extracted) return;
    w.__XRM_CREDS__!.queryId = extracted.queryId;
    if (extracted.features) w.__XRM_CREDS__!.features = extracted.features;
    if (extracted.fieldToggles) w.__XRM_CREDS__!.fieldToggles = extracted.fieldToggles;
    if (extracted.userId) w.__XRM_CREDS__!.userId = extracted.userId;
    postCreds();
  }

  const ingest = (root: unknown) => {
    const walk = (node: unknown, depth: number) => {
      if (!node || depth > 40 || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      const obj = node as Record<string, unknown>;
      const rawRestId = String(obj.rest_id || obj.id_str || (obj.legacy as Record<string, unknown> | undefined)?.id_str || '');
      const parsedNumericId = /^\d+$/.test(rawRestId) ? rawRestId : undefined;

      const legacy = obj.legacy as Record<string, unknown> | undefined;
      if (legacy && (typeof legacy.screen_name === 'string' || typeof legacy.screenName === 'string')) {
        const id = String(legacy.screen_name || legacy.screenName).toLowerCase();
        let fc = legacy.followers_count ?? legacy.followersCount;
        let fr = legacy.friends_count ?? legacy.friendsCount;
        if (typeof fc === 'string') fc = parseInt(fc, 10);
        if (typeof fr === 'string') fr = parseInt(fr, 10);

        const prev = w.__XRM_META__![id] || {};
        w.__XRM_META__![id] = {
          ...prev,
          ...(typeof fc === 'number' && !isNaN(fc) ? { followersCount: fc } : {}),
          ...(typeof fr === 'number' && !isNaN(fr) ? { followingCount: fr } : {}),
          ...(typeof legacy.name === 'string' ? { displayName: legacy.name } : {}),
          ...(parsedNumericId ? { numericId: parsedNumericId } : {}),
        };
      }

      const objFc = obj.followers_count ?? obj.followersCount;
      const objFr = obj.friends_count ?? obj.friendsCount;
      const objSn = obj.screen_name ?? obj.screenName;

      if (typeof objSn === 'string') {
        let fc = objFc;
        let fr = objFr;
        if (typeof fc === 'string') fc = parseInt(fc, 10);
        if (typeof fr === 'string') fr = parseInt(fr, 10);

        const id = String(objSn).toLowerCase();
        const prev = w.__XRM_META__![id] || {};
        w.__XRM_META__![id] = {
          ...prev,
          ...(typeof fc === 'number' && !isNaN(fc) ? { followersCount: fc } : {}),
          ...(typeof fr === 'number' && !isNaN(fr) ? { followingCount: fr } : {}),
          ...(parsedNumericId ? { numericId: parsedNumericId } : {}),
        };
      }
      for (const key of Object.keys(obj)) {
        if (key === 'profile_image_url_https' || key === 'description') continue;
        walk(obj[key], depth + 1);
      }
    };
    walk(root, 0);
  };

  // Header hook
  const nativeSet = Headers.prototype.set;
  Headers.prototype.set = function (name: string, value: string) {
    if (String(name).toLowerCase() === 'authorization') captureBearer(value);
    return nativeSet.apply(this, [name, value] as any);
  };

  const nativeAppend = Headers.prototype.append;
  Headers.prototype.append = function (name: string, value: string) {
    if (String(name).toLowerCase() === 'authorization') captureBearer(value);
    return nativeAppend.apply(this, [name, value] as any);
  };

  function readAuthFromArgs(args: any[]) {
    try {
      const init = args[1] || {};
      const hdrs = init.headers || (typeof args[0] === 'object' ? args[0].headers : null);
      if (!hdrs) return;
      if (typeof hdrs.get === 'function') {
        captureBearer(hdrs.get('authorization') || hdrs.get('Authorization'));
        return;
      }
      captureBearer(hdrs.authorization || hdrs.Authorization);
    } catch (_) {}
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const req = args[0];
    const url =
      typeof req === 'string'
        ? req
        : req instanceof Request
          ? req.url
          : req instanceof URL
            ? req.toString()
            : String(req ?? '');

    readAuthFromArgs(args);
    if (FOLLOWING_RE.test(url)) {
      handleFollowingUrl(url);
    }

    const res = await origFetch(...args);
    try {
      if (/graphql|Followers|Following|UserBy|UserResult/i.test(url)) {
        const clone = res.clone();
        void clone
          .json()
          .then((data) => ingest(data))
          .catch(() => {});
      }
    } catch {
      // ignore
    }
    return res;
  };

  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  const XSH = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    (this as XMLHttpRequest & { __xrmUrl?: string; __xrmFollowing?: boolean }).__xrmUrl = String(url);
    const isFollowing = FOLLOWING_RE.test(String(url || ''));
    (this as any).__xrmFollowing = isFollowing;
    if (isFollowing) handleFollowingUrl(String(url));
    return XO.apply(this, [method, url, ...rest] as never);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
    if (String(name).toLowerCase() === 'authorization') captureBearer(value);
    return XSH.apply(this, [name, value] as any);
  };

  XMLHttpRequest.prototype.send = function (
    ...args: Parameters<typeof XMLHttpRequest.prototype.send>
  ) {
    this.addEventListener('load', function () {
      try {
        const url = (this as XMLHttpRequest & { __xrmUrl?: string }).__xrmUrl || '';
        if (!/graphql|Followers|Following|UserBy|UserResult/i.test(url)) return;
        if (this.responseType && this.responseType !== 'text') return;
        const text = this.responseText;
        if (!text || text.length < 20 || text.length > 8_000_000) return;
        if (text[0] !== '{' && text[0] !== '[') return;
        ingest(JSON.parse(text));
      } catch {
        // ignore
      }
    });
    return XS.apply(this, args);
  };

  // Açılışta varsa cookie bilgilerini gönder
  setTimeout(postCreds, 500);
})();
