const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
let CLIENT_ID = process.env.IGDB_CLIENT_ID || '';
let CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET || '';
let ACCESS_TOKEN = process.env.IGDB_ACCESS_TOKEN || '';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const igdbCache = new Map();
const fileCache = new Map();
const CACHE_TTL = 60000;

let tokenExpiry = 0;

function cacheGet(map, key) {
  const entry = map.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.val;
  if (entry) map.delete(key);
  return null;
}
function cacheSet(map, key, val) { map.set(key, { val, ts: Date.now() }); }

async function refreshTwitchToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;
  if (Date.now() < tokenExpiry && ACCESS_TOKEN) return ACCESS_TOKEN;
  try {
    const url = `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`;
    const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      ACCESS_TOKEN = data.access_token;
      tokenExpiry = Date.now() + ((data.expires_in || 7200) * 1000) - 60000;
      return ACCESS_TOKEN;
    }
  } catch (err) {}
  return null;
}

async function igdbGames(token, cId, where, limit, offset) {
  const body = `fields name, slug, url, summary, storyline, first_release_date, rating, aggregated_rating, genres.name, platforms.name, cover.image_id, videos.name, videos.video_id, involved_companies.developer, involved_companies.publisher, involved_companies.company.name; ${where}; limit ${limit}; offset ${offset};`;
  const cached = cacheGet(igdbCache, body);
  if (cached !== null) return cached;

  let res = await fetch(`https://api.igdb.com/v4/games`, {
    method: 'POST',
    headers: { 'Client-ID': cId, 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body
  });
  if (res.status === 401 && CLIENT_SECRET) {
    const newToken = await refreshTwitchToken();
    if (newToken) {
      token = newToken;
      res = await fetch(`https://api.igdb.com/v4/games`, {
        method: 'POST',
        headers: { 'Client-ID': cId, 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/plain' },
        body
      });
    }
  }
  if (!res.ok) return null;
  const data = await res.json();
  cacheSet(igdbCache, body, data);
  return data;
}

async function pickRandomGame(token, cId, where, exclude, signal) {
  const fallbackGames = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) return null;
    const off = attempt * 10;
    const games = await igdbGames(token, cId, where, 10, off);
    if (!games || !games.length) continue;

    const cand = exclude ? games.filter(g => g.id != exclude) : games;
    if (cand.length) {
      const g = cand[Math.floor(Math.random() * cand.length)];
      const r = Math.max(g.rating || 0, g.aggregated_rating || 0);
      return { ...g, metaScore: Math.round(r / 10) };
    }
    fallbackGames.push(...cand);
  }

  if (fallbackGames.length) {
    const g = fallbackGames[Math.floor(Math.random() * fallbackGames.length)];
    return { ...g };
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Client-ID');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      online: true,
      clientId: CLIENT_ID,
      hasToken: Boolean(ACCESS_TOKEN)
    }));
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        if (data.clientId) CLIENT_ID = data.clientId;
        if (data.accessToken) ACCESS_TOKEN = data.accessToken;
        if (data.clientSecret) CLIENT_SECRET = data.clientSecret;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, hasToken: Boolean(ACCESS_TOKEN) }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON invalido' }));
      }
    });
    return;
  }

  if (url.pathname === '/api/random' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const { where, exclude = null } = JSON.parse(body || '{}');

        let token = req.headers['authorization']?.replace('Bearer ', '') || ACCESS_TOKEN;
        let cId = req.headers['client-id'] || CLIENT_ID;

        const game = await pickRandomGame(token, cId, where, exclude, controller.signal);

        clearTimeout(timeout);
        if (controller.signal.aborted) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Tempo esgotado ao buscar jogo.' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!game) {
          res.end(JSON.stringify({ error: 'Nenhum jogo encontrado com esses filtros.' }));
        } else {
          res.end(JSON.stringify({ game }));
        }
      } catch (error) {
        clearTimeout(timeout);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Falha na comunicação', details: error.message }));
      }
    });
    return;
  }

  if (url.pathname.startsWith('/api/igdb/')) {
    const endpoint = url.pathname.replace('/api/igdb/', '');
    const targetUrl = `https://api.igdb.com/v4/${endpoint}`;

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        let token = req.headers['authorization']?.replace('Bearer ', '') || ACCESS_TOKEN;
        let cId = req.headers['client-id'] || CLIENT_ID;

        let igdbResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Client-ID': cId,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'text/plain'
          },
          body: body || 'fields name; limit 10;'
        });

        if (igdbResponse.status === 401 && CLIENT_SECRET) {
          const newToken = await refreshTwitchToken();
          if (newToken) {
            token = newToken;
            igdbResponse = await fetch(targetUrl, {
              method: 'POST',
              headers: {
                'Client-ID': cId,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'text/plain'
              },
              body: body || 'fields name; limit 10;'
            });
          }
        }

        const data = await igdbResponse.text();
        res.writeHead(igdbResponse.status, { 'Content-Type': 'application/json' });
        res.end(data);
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Falha na comunicacao com o IGDB', details: error.message }));
      }
    });
    return;
  }

  let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const cached = fileCache.get(filePath);
  if (cached !== undefined) {
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(cached);
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 - Arquivo nao encontrado');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 - Erro interno');
      }
    } else {
      fileCache.set(filePath, content);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Nexus Picker rodando em http://localhost:${PORT}`);
});
