export interface Env {
  // Add any environment variables here
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const shortId = url.searchParams.get('meow') || 'NUGGET';

    // Cache for price values (in-memory, resets on each request but fine for worker)
    const skinValueCache = new Map<string, number>();
    let itemsData: Record<string, any> = {};
    let badgesMap: Record<string, any> = {};

    function esc(str: string): string {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtShort(num: number): string {
      if (num == null) return '0';
      if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
      if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
      return String(num);
    }

    function fmtValue(val: number): string {
      if (!val && val !== 0) return 'N/A';
      const n = parseFloat(String(val));
      if (isNaN(n)) return String(val);
      if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
      return String(n);
    }

    function getSkinItem(skin: any): any {
      if (!skin) return null;
      return itemsData[skin.id] || itemsData[(skin.name || '').toLowerCase()] || null;
    }

    try {
      // Fetch all data in parallel
      const [skins, badges, profileRes] = await Promise.all([
        fetch('https://raw.githubusercontent.com/OBS-Akuma/KirkaSkins/refs/heads/main/AllItemData.json').then(r => r.json()).catch(() => []),
        fetch('https://raw.githubusercontent.com/OBS-Akuma/KirkaBadges/refs/heads/main/Json/badge.json').then(r => r.json()).catch(() => []),
        fetch('https://www.smudgy.store/api/getprofile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: `#${shortId}`, isShortId: true })
        }).then(r => r.json())
      ]);

      // Build items map
      (Array.isArray(skins) ? skins : []).forEach((item: any) => {
        if (item.id) itemsData[item.id] = item;
        if (item.name) itemsData[item.name.toLowerCase()] = item;
      });

      // Build badges map
      const entries = Array.isArray(badges) ? badges : Object.values(badges);
      entries.forEach((e: any) => {
        if (e?.shortId) badgesMap[e.shortId.toUpperCase()] = e;
      });

      if (!profileRes.success || !profileRes.data) {
        return errorResponse('Profile not found');
      }

      const d = profileRes.data;
      const badge = badgesMap[(d.shortId || '').toUpperCase()] || null;

      // Fetch inventory value with caching
      let invValue: number | null = null;
      let invLoading = true;
      
      try {
        const invRes = await fetch('https://www.smudgy.store/api/getinventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: `#${shortId}`, isShortId: true })
        });
        const invData = await invRes.json();
        
        if (invData.success && invData.data?.length) {
          const items = invData.data;
          const uniqueNames = [...new Set(items.map((i: any) => i.item.name))];
          const uncached = uniqueNames.filter((n: string) => !skinValueCache.has(n.toLowerCase()));
          
          if (uncached.length > 0) {
            try {
              const priceRes = await fetch(`https://www.smudgy.store/api/pricecalc?price=${encodeURIComponent(uncached.join(','))}`);
              const priceData = await priceRes.json();
              if (priceData.breakdown) {
                for (const [name, val] of Object.entries(priceData.breakdown)) {
                  skinValueCache.set(name.toLowerCase(), val as number);
                }
              }
            } catch (e) {
              console.error('Price fetch failed:', e);
            }
          }
          
          let total = 0;
          items.forEach((item: any) => {
            total += (skinValueCache.get(item.item.name.toLowerCase()) || 0) * (item.amount || 1);
          });
          invValue = total;
        }
        invLoading = false;
      } catch (e) {
        invLoading = false;
      }

      // Generate SVG
      const xpPct = d.xpUntilNextLevel ? Math.min(100, (d.xpSinceLastLevel / d.xpUntilNextLevel) * 100) : 0;
      const bodySkinItem = getSkinItem(d.activeBodySkin);
      const avatarRender = bodySkinItem?.renderUrl || null;
      const invDisplay = invLoading ? '...' : fmtValue(invValue || 0);

      const discordBadge = d.discord ? 'https://raw.githubusercontent.com/OBS-Akuma/KirkaSkins/refs/heads/main/img/linked.webp' : null;
      let badgesList = [...(badge?.badges || [])];
      if (discordBadge) badgesList.push(discordBadge);

      let usernameGradientStyle = '';
      let animatedStyle = '';
      if (badge?.gradient) {
        const stops = badge.gradient.stops.join(', ');
        const rot = badge.gradient.rot || '90deg';
        usernameGradientStyle = `background: linear-gradient(${rot}, ${stops}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;`;
        if (badge.animated) animatedStyle = '@keyframes spin { 100% { transform: rotate(360deg); } } .animated { animation: spin 3s linear infinite; }';
      }

      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="750" height="80" viewBox="0 0 750 80">
  <defs>
    <style>
      ${animatedStyle}
      @keyframes spin {
        100% { transform: rotate(360deg); }
      }
      @font-face {
        font-family: 'Pixelogist';
        src: url('https://raw.githubusercontent.com/imnotkoolkid/KCH/main/resources/obs-page/Pixelogist.ttf');
      }
      @font-face {
        font-family: 'Minecraft';
        src: url('https://raw.githubusercontent.com/imnotkoolkid/KCH/main/resources/obs-page/Minecraft.ttf');
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      .card-container {
        width: 750px;
        height: 80px;
        background: linear-gradient(135deg, #1a1a2e, #0d0d1a);
        border-radius: 12px;
        display: flex;
        align-items: center;
        padding: 0 12px;
        gap: 12px;
        font-family: 'Pixelogist', 'Minecraft', Arial, sans-serif;
      }
      .avatar {
        width: 64px;
        height: 64px;
        background: linear-gradient(90deg, #1A8E50, #2aae60);
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        position: relative;
        flex-shrink: 0;
      }
      .avatar img {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        height: 160px;
        width: auto;
        image-rendering: pixelated;
      }
      .avatar span {
        font-size: 28px;
        font-family: 'Minecraft', monospace;
        color: white;
      }
      .info {
        flex-shrink: 0;
      }
      .name {
        font-size: 14px;
        font-weight: bold;
        font-family: 'Minecraft', monospace;
        ${usernameGradientStyle || 'color: white;'}
        white-space: nowrap;
      }
      .short-id {
        background: rgba(26,142,80,0.2);
        border: 1px solid #1A8E50;
        padding: 2px 8px;
        border-radius: 5px;
        font-size: 9px;
        color: #1A8E50;
        font-family: monospace;
        font-weight: bold;
        display: inline-block;
        margin-top: 4px;
      }
      .stats {
        display: flex;
        gap: 16px;
        margin-left: 8px;
        flex: 1;
      }
      .stat {
        text-align: center;
        flex-shrink: 0;
      }
      .stat-label {
        font-size: 7px;
        color: #aaa;
        text-transform: uppercase;
      }
      .stat-value {
        font-size: 14px;
        font-weight: bold;
        font-family: 'Minecraft', monospace;
        color: #1A8E50;
      }
      .stat-value.gold { color: #ffd700; }
      .xp-bar {
        width: 40px;
        height: 3px;
        background: rgba(255,255,255,0.2);
        border-radius: 1.5px;
        margin-top: 4px;
        overflow: hidden;
      }
      .xp-fill {
        height: 100%;
        background: #1A8E50;
        border-radius: 1.5px;
        width: ${xpPct}%;
      }
      .right-section {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
      }
      .badge-icon {
        width: 22px;
        height: 22px;
        object-fit: contain;
      }
      .clan {
        font-size: 10px;
        color: #2aae60;
        font-family: 'Minecraft', monospace;
      }
      .views {
        font-size: 7px;
        color: #444;
        font-family: monospace;
      }
    </style>
  </defs>
  <foreignObject width="750" height="80">
    <div xmlns="http://www.w3.org/1999/xhtml">
      <div class="card-container">
        <div class="avatar">
          ${avatarRender ? `<img src="${esc(avatarRender)}" alt="avatar"/>` : `<span>${esc(d.name?.[0]?.toUpperCase() || '?')}</span>`}
        </div>
        <div class="info">
          <div class="name">${esc(d.name && d.name.length > 15 ? d.name.substring(0, 12) + '...' : (d.name || 'Unknown'))}</div>
          <div class="short-id">${esc(d.shortId || '???')}</div>
        </div>
        <div class="stats">
          <div class="stat">
            <div class="stat-label">LVL</div>
            <div class="stat-value">${d.level || 0}</div>
            <div class="xp-bar"><div class="xp-fill"></div></div>
          </div>
          <div class="stat">
            <div class="stat-label">KLO</div>
            <div class="stat-value">${d.klo?.toFixed(0) || 0}</div>
          </div>
          <div class="stat">
            <div class="stat-label">COINS</div>
            <div class="stat-value gold">${fmtShort(d.coins)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">DIAMONDS</div>
            <div class="stat-value">${d.diamonds || 0}</div>
          </div>
          <div class="stat">
            <div class="stat-label">INV VALUE</div>
            <div class="stat-value gold">${invDisplay}</div>
          </div>
        </div>
        <div class="right-section">
          ${badgesList.map(url => `<img class="badge-icon" src="${esc(url)}" onerror="this.style.display='none'"/>`).join('')}
          ${d.clan ? `<div class="clan">${esc(d.clan)}</div>` : ''}
          <div class="views">${d.viewCount || 0} views</div>
        </div>
      </div>
    </div>
  </foreignObject>
</svg>`;

      return new Response(svg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : 'Unknown error');
    }
  }
};

function errorResponse(message: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="50" viewBox="0 0 400 50">
  <rect width="400" height="50" fill="#1a1a2e" rx="8"/>
  <text x="200" y="30" fill="#ff4444" font-family="monospace" font-size="11" text-anchor="middle">Error: ${message}</text>
</svg>`, {
    headers: { 'Content-Type': 'image/svg+xml' }
  });
}
