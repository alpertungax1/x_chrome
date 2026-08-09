/**
 * MAIN world, document_start — X GraphQL yanıtlarından followers_count yakalar.
 * window.__XRM_META__[username] = { followersCount, followingCount }
 */
(() => {
  const w = window as Window & {
    __XRM_META__?: Record<
      string,
      { followersCount?: number; followingCount?: number; displayName?: string }
    >;
    __XRM_HOOK__?: boolean;
  };

  if (w.__XRM_HOOK__) return;
  w.__XRM_HOOK__ = true;
  if (!w.__XRM_META__) w.__XRM_META__ = {};

  const ingest = (root: unknown) => {
    const walk = (node: unknown, depth: number) => {
      if (!node || depth > 40 || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      const obj = node as Record<string, unknown>;
      const legacy = obj.legacy as Record<string, unknown> | undefined;
      if (legacy && typeof legacy.screen_name === 'string') {
        const id = String(legacy.screen_name).toLowerCase();
        const fc = legacy.followers_count;
        const fr = legacy.friends_count;
        if (typeof fc === 'number' || typeof fr === 'number') {
          const prev = w.__XRM_META__![id] || {};
          w.__XRM_META__![id] = {
            ...prev,
            ...(typeof fc === 'number' ? { followersCount: fc } : {}),
            ...(typeof fr === 'number' ? { followingCount: fr } : {}),
            ...(typeof legacy.name === 'string' ? { displayName: legacy.name } : {}),
          };
        }
      }
      if (typeof obj.screen_name === 'string' && typeof obj.followers_count === 'number') {
        const id = String(obj.screen_name).toLowerCase();
        const prev = w.__XRM_META__![id] || {};
        w.__XRM_META__![id] = {
          ...prev,
          followersCount: obj.followers_count as number,
          ...(typeof obj.friends_count === 'number'
            ? { followingCount: obj.friends_count as number }
            : {}),
        };
      }
      for (const key of Object.keys(obj)) {
        if (key === 'profile_image_url_https' || key === 'description') continue;
        walk(obj[key], depth + 1);
      }
    };
    walk(root, 0);
  };

  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await origFetch(...args);
    try {
      const req = args[0];
      const url =
        typeof req === 'string'
          ? req
          : req instanceof Request
            ? req.url
            : String(req ?? '');
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
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    (this as XMLHttpRequest & { __xrmUrl?: string }).__xrmUrl = String(url);
    return XO.apply(this, [method, url, ...rest] as never);
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
})();
