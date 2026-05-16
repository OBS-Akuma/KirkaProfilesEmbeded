addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const shortId = url.searchParams.get('meow') || 'WERWER';

  let itemsData = {};
  let badgesMap = {};
  const skinValueCache = new Map();

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function fmtShort(num) {
    if (num == null) return '0';
    if (num >= 1000000) return (num/1000000).toFixed(1)+'M';
    if (num >= 1000) return (num/1000).toFixed(1)+'K';
    return String(num);
  }

  function fmtValue(val) {
    if (!val && val !== 0) return 'N/A';
    const n = parseFloat(val);
    if (isNaN(n)) return String(val);
    if (n >= 1000000000) return (n/1000000000).toFixed(2)+'B';
    if (n >= 1000000) return (n/1000000).toFixed(2)+'M';
    if (n >= 1000) return (n/1000).toFixed(1)+'K';
    return String(n);
  }

  function getSkinItem(skin) {
    if (!skin) return null;
    return itemsData[skin.id] || itemsData[(skin.name || '').toLowerCase()] || null;
  }

  async function imageToBase64(imageUrl) {
    try {
      const response = await fetch(imageUrl, {
        headers: { 'Referer': 'https://kirka.io/' }
      });
      const blob = await response.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(blob)));
      const contentType = response.headers.get('Content-Type') || 'image/png';
      return `data:${contentType};base64,${base64}`;
    } catch(e) {
      return null;
    }
  }

  try {
    const [skins, badges, profileRes] = await Promise.all([
      fetch('https://raw.githubusercontent.com/OBS-Akuma/KirkaSkins/refs/heads/main/AllItemData.json').then(r => r.json()).catch(() => []),
      fetch('https://raw.githubusercontent.com/OBS-Akuma/KirkaBadges/refs/heads/main/Json/badge.json').then(r => r.json()).catch(() => []),
      fetch('https://www.smudgy.store/api/getprofile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: `#${shortId}`, isShortId: true })
      }).then(r => r.json())
    ]);

    (Array.isArray(skins) ? skins : []).forEach(item => {
      if (item.id) itemsData[item.id] = item;
      if (item.name) itemsData[item.name.toLowerCase()] = item;
    });

    const entries = Array.isArray(badges) ? badges : Object.values(badges);
    entries.forEach(e => {
      if (e && e.shortId) badgesMap[e.shortId.toUpperCase()] = e;
    });

    if (!profileRes.success || !profileRes.data) {
      return errorResponse('Profile not found');
    }

    const d = profileRes.data;
    const badge = badgesMap[(d.shortId || '').toUpperCase()] || null;

    let invValue = null;
    let invLoading = true;
    
    try {
      const invRes = await fetch('https://www.smudgy.store/api/getinventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: `#${shortId}`, isShortId: true })
      });
      const invData = await invRes.json();
      
      if (invData.success && invData.data && invData.data.length) {
        const items = invData.data;
        const uniqueNames = [...new Set(items.map(i => i.item.name))];
        const uncached = uniqueNames.filter(n => !skinValueCache.has(n.toLowerCase()));
        
        if (uncached.length > 0) {
          try {
            const priceRes = await fetch(`https://www.smudgy.store/api/pricecalc?price=${encodeURIComponent(uncached.join(','))}`);
            const priceData = await priceRes.json();
            if (priceData.breakdown) {
              for (const [name, val] of Object.entries(priceData.breakdown)) {
                skinValueCache.set(name.toLowerCase(), val);
              }
            }
          } catch(e) {}
        }
        
        let total = 0;
        items.forEach(item => {
          total += (skinValueCache.get(item.item.name.toLowerCase()) || 0) * (item.amount || 1);
        });
        invValue = total;
      }
      invLoading = false;
    } catch(e) {
      invLoading = false;
    }

    const xpPct = d.xpUntilNextLevel ? Math.min(100, (d.xpSinceLastLevel / d.xpUntilNextLevel) * 100) : 0;
    const bodySkinItem = getSkinItem(d.activeBodySkin);
    
    let avatarDataUrl = null;
    if (bodySkinItem && bodySkinItem.renderUrl) {
      let imgUrl = bodySkinItem.renderUrl;
      if (imgUrl.startsWith('/')) {
        imgUrl = `https://kirka.io${imgUrl}`;
      }
      avatarDataUrl = await imageToBase64(imgUrl);
    }
    
    const invDisplay = invLoading ? '...' : fmtValue(invValue);

    const discordBadge = d.discord ? 'https://raw.githubusercontent.com/OBS-Akuma/KirkaSkins/refs/heads/main/img/linked.webp' : null;
    let badgeUrls = (badge && badge.badges) ? [...badge.badges] : [];
    if (discordBadge) badgeUrls.push(discordBadge);
    
    let badgesList = [];
    for (const badgeUrl of badgeUrls) {
      const base64Badge = await imageToBase64(badgeUrl);
      if (base64Badge) {
        badgesList.push(base64Badge);
      }
    }

    // Handle gradient from badge config
    let usernameGradientStyle = '';
    let gradientStops = '';
    let gradientRotation = 90;
    let gradientFill = 'white';
    
    if (badge && badge.gradient) {
      let rotDeg = 90;
      const rot = badge.gradient.rot || '90deg';
      
      if (rot === 'to top') rotDeg = -90;
      else if (rot === 'to bottom') rotDeg = 90;
      else if (rot === 'to left') rotDeg = 0;
      else if (rot === 'to right') rotDeg = 180;
      else if (rot.includes('deg')) rotDeg = parseInt(rot);
      else rotDeg = parseInt(rot) || 90;
      
      const stops = badge.gradient.stops.map((stop, idx) => {
        let color = stop;
        let offset = idx * (100 / (badge.gradient.stops.length - 1));
        
        if (stop.includes(' ')) {
          const parts = stop.split(' ');
          color = parts[0];
          const offsetStr = parts[1].replace('%', '');
          offset = parseFloat(offsetStr);
        }
        
        return `<stop offset="${offset}%" stop-color="${color}"/>`;
      }).join('');
      
      gradientStops = stops;
      gradientRotation = rotDeg;
      usernameGradientStyle = `fill="url(#nameGrad)"`;
      gradientFill = 'url(#nameGrad)';
    }

    // Bio text
    const bio = d.bio || '';
    const displayBio = bio.length > 45 ? bio.substring(0, 42) + '...' : bio;
    
    // Badges position (top right)
    const badgesStartY = 12;
    
    // Views position (top right, after badges)
    const viewsX = 620 + (badgesList.length * 34) + 10;
    const viewsY = 27;

    // Get display name (truncate if too long)
    const displayName = d.name && d.name.length > 12 ? d.name.substring(0, 9) + '...' : (d.name || 'Unknown');
    const nameWidth = (displayName.length + d.shortId.length + 1) * 7.5;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="750" height="80" viewBox="0 0 750 80">
  <defs>
    <style>
      @font-face {
        font-family: 'Pixelogist';
        src: url('https://raw.githubusercontent.com/imnotkoolkid/KCH/main/resources/obs-page/Pixelogist.ttf');
      }
      @font-face {
        font-family: 'Minecraft';
        src: url('https://raw.githubusercontent.com/imnotkoolkid/KCH/main/resources/obs-page/Minecraft.ttf');
      }
      text { font-family: 'Pixelogist', 'Minecraft', Arial, sans-serif; }
    </style>
    ${gradientStops ? `<linearGradient id="nameGrad" x1="0%" y1="0%" x2="100%" y2="0%" gradientTransform="rotate(${gradientRotation}, 0.5, 0.5)">${gradientStops}</linearGradient>` : ''}
    <clipPath id="avatarClip"><rect x="8" y="8" width="64" height="64" rx="10"/></clipPath>
  </defs>

  <!-- Background -->
  <rect width="750" height="80" fill="#1a1a2e" rx="12"/>
  <rect x="0" y="8" width="4" height="64" fill="#1A8E50" rx="2" opacity="0.3"/>

  <!-- Avatar -->
  <rect x="8" y="8" width="64" height="64" rx="10" fill="#1A8E50"/>
  ${avatarDataUrl ? `<image x="8" y="8" width="64" height="160" href="${esc(avatarDataUrl)}" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMin slice"/>` : `<text x="40" y="48" text-anchor="middle" fill="white" font-size="28" font-family="Minecraft, monospace">${esc(d.name ? d.name[0].toUpperCase() : '?')}</text>`}

  <!-- Clan Tag (above username) -->
  ${d.clan ? `<text x="82" y="22" fill="#2aae60" font-size="9" font-family="Minecraft, monospace">${esc(d.clan)}</text>` : ''}

  <!-- Username + ShortID as one text with same color -->
  <text x="82" y="38" font-size="14" font-weight="bold" font-family="Minecraft, monospace" ${usernameGradientStyle || 'fill="white"'}>${esc(displayName)}</text>
  <text x="${82 + displayName.length * 7.5}" y="38" font-size="14" font-weight="bold" font-family="Minecraft, monospace" ${usernameGradientStyle || 'fill="white"'}>#${esc(d.shortId || '???')}</text>

  <!-- Bio (lowered by 5px) -->
  ${displayBio ? `<text x="82" y="62" fill="#ffcc80" font-size="9" font-family="Pixelogist, monospace">${esc(displayBio)}</text>` : ''}

  <!-- Stats -->
  <g transform="translate(210, 0)">
    <text x="20" y="28" fill="#aaa" font-size="7" text-anchor="middle">LVL</text>
    <text x="20" y="48" fill="#1A8E50" font-size="14" font-weight="bold" font-family="Minecraft, monospace" text-anchor="middle">${d.level || 0}</text>
    <rect x="5" y="55" width="30" height="3" fill="rgba(255,255,255,0.2)" rx="1.5"/>
    <rect x="5" y="55" width="${xpPct * 0.3}" height="3" fill="#1A8E50" rx="1.5"/>

    <text x="75" y="28" fill="#aaa" font-size="7" text-anchor="middle">KLO</text>
    <text x="75" y="48" fill="#1A8E50" font-size="14" font-weight="bold" font-family="Minecraft, monospace" text-anchor="middle">${d.klo ? d.klo.toFixed(0) : 0}</text>

    <text x="140" y="28" fill="#aaa" font-size="7" text-anchor="middle">COINS</text>
    <text x="140" y="48" fill="#ffd700" font-size="13" font-weight="bold" font-family="Minecraft, monospace" text-anchor="middle">${fmtShort(d.coins)}</text>

    <text x="205" y="28" fill="#aaa" font-size="7" text-anchor="middle">DIAMONDS</text>
    <text x="205" y="48" fill="#1A8E50" font-size="13" font-weight="bold" font-family="Minecraft, monospace" text-anchor="middle">${d.diamonds || 0}</text>

    <text x="275" y="28" fill="#aaa" font-size="7" text-anchor="middle">INV VALUE</text>
    <text x="275" y="48" fill="#ffd700" font-size="11" font-weight="bold" font-family="Minecraft, monospace" text-anchor="middle">${invDisplay}</text>
  </g>

  <!-- Right section - Badges (top right) -->
  <g transform="translate(620, ${badgesStartY})">
    ${badgesList.map((base64Badge, i) => `<image x="${i * 34}" y="0" width="30" height="30" href="${esc(base64Badge)}"/>`).join('')}
  </g>

  <!-- Views (top right, after badges) -->
  <text x="${viewsX}" y="${viewsY}" fill="#444" font-size="8" font-family="monospace">${d.viewCount || 0} views</text>
</svg>`;

    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch(err) {
    return errorResponse(err.message || 'Unknown error');
  }
}

function errorResponse(message) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="50" viewBox="0 0 400 50">
  <rect width="400" height="50" fill="#1a1a2e" rx="8"/>
  <text x="200" y="30" fill="#ff4444" font-family="monospace" font-size="11" text-anchor="middle">Error: ${message}</text>
</svg>`, {
    headers: { 'Content-Type': 'image/svg+xml' }
  });
}
