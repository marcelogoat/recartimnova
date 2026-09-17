const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Carregar variáveis de ambiente de .env se existir
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of envLines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [k, ...v] = trimmed.split('=');
      if (k && !process.env[k.trim()]) {
        process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  }
}

const PORT = process.env.PORT || 3001;
const BLACKCAT_API_KEY = process.env.BLACKCAT_API_KEY || Buffer.from('c2tfbGl2ZV9lODNlYjc3OTJlOThkNzRlY2Q4ZmJlMThkNWY4MTZmYzAzMWYwYTVhY2IxMjc4ZTBhMGUwYjY4MmZhMTBmMGMz', 'base64').toString('utf8');
const BLACKCAT_BASE_URL = 'https://api.blackcatoficial.com/api';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function generateValidCPF() {
  const rnd = (n) => Math.round(Math.random() * n);
  const mod = (base, div) => Math.round(base - Math.floor(base / div) * div);
  const n = Array(9).fill(0).map(() => rnd(9));
  let d1 = n.reduce((total, num, i) => total + (num * (10 - i)), 0);
  d1 = 11 - mod(d1, 11);
  if (d1 >= 10) d1 = 0;
  let d2 = n.reduce((total, num, i) => total + (num * (11 - i)), 0) + (d1 * 2);
  d2 = 11 - mod(d2, 11);
  if (d2 >= 10) d2 = 0;
  return [...n, d1, d2].join('');
}

function normalizeName(name) {
  return (name || 'Cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function generateRandomEmail(name) {
  const cleanName = normalizeName(name || 'cliente');
  const suffix = Math.floor(Math.random() * 900000) + 100000;
  return `${cleanName}${suffix}@gmail.com`;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. Endpoint: /api/create-pix
  if (pathname === '/api/create-pix' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const rawAmount = parseInt(data.amount, 10) || 30;
        // Se já vier em centavos (>= 1000) mantém, se vier em reais (ex: 20, 30) converte para centavos
        const amountCents = rawAmount >= 1000 ? rawAmount : rawAmount * 100;
        const amountReais = Math.round(amountCents / 100);

        const rawPhone = (data.phone || '11999998888').toString().replace(/\D/g, '');
        const phone = rawPhone.length >= 10 ? rawPhone : '11999998888';
        const customerName = data.name || `Cliente TIM ${phone.slice(-4)}`;
        const customerEmail = data.email || generateRandomEmail(customerName);
        const customerCpf = data.cpf ? data.cpf.replace(/\D/g, '') : generateValidCPF();

        const payload = JSON.stringify({
          amount: amountCents,
          currency: 'BRL',
          paymentMethod: 'pix',
          items: [
            {
              title: 'oferta 1',
              unitPrice: amountCents,
              quantity: 1,
              tangible: false
            }
          ],
          customer: {
            name: customerName,
            email: customerEmail,
            phone: phone,
            document: {
              number: customerCpf,
              type: 'cpf'
            }
          },
          pix: {
            expiresInDays: 1
          },
          metadata: `Recarga Linha ${phone}`
        });

        const blackcatReq = https.request({
          hostname: 'api.blackcatoficial.com',
          path: '/api/sales/create-sale',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': BLACKCAT_API_KEY,
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (blackcatRes) => {
          let responseData = '';
          blackcatRes.on('data', chunk => { responseData += chunk; });
          blackcatRes.on('end', () => {
            try {
              const jsonResponse = JSON.parse(responseData);
              sendJson(res, blackcatRes.statusCode || 200, jsonResponse);
            } catch (err) {
              sendJson(res, 500, { success: false, error: 'Erro ao processar resposta do gateway', raw: responseData });
            }
          });
        });

        blackcatReq.on('error', (err) => {
          console.error('[Blackcat Request Error]:', err.message);
          sendJson(res, 500, { success: false, error: 'Falha na conexão com Blackcat', message: err.message });
        });

        blackcatReq.write(payload);
        blackcatReq.end();
      } catch (e) {
        sendJson(res, 400, { success: false, error: 'JSON inválido no corpo da requisição' });
      }
    });
    return;
  }

  // 2. Endpoint: /api/check-payment?id=TRANSACTION_ID
  if (pathname === '/api/check-payment' && req.method === 'GET') {
    const transactionId = parsedUrl.searchParams.get('id');
    if (!transactionId) {
      return sendJson(res, 400, { success: false, error: 'Parâmetro ?id= obrigatório' });
    }

    const blackcatReq = https.request({
      hostname: 'api.blackcatoficial.com',
      path: `/api/sales/${encodeURIComponent(transactionId)}/status`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': BLACKCAT_API_KEY
      }
    }, (blackcatRes) => {
      let responseData = '';
      blackcatRes.on('data', chunk => { responseData += chunk; });
      blackcatRes.on('end', () => {
        try {
          const jsonResponse = JSON.parse(responseData);
          sendJson(res, blackcatRes.statusCode || 200, jsonResponse);
        } catch (err) {
          sendJson(res, 500, { success: false, error: 'Erro ao processar status', raw: responseData });
        }
      });
    });

    blackcatReq.on('error', (err) => {
      sendJson(res, 500, { success: false, error: 'Falha na consulta do status', message: err.message });
    });

    blackcatReq.end();
    return;
  }

  // 3. Webhook: /api/webhook
  if (pathname === '/api/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      console.log('[Blackcat Webhook Received]:', body);
      sendJson(res, 200, { received: true });
    });
    return;
  }

  // 4. Arquivos estáticos
  let requestedPath = pathname;
  if (requestedPath === '/' || requestedPath === '/index.html') {
    requestedPath = '/timfestival.vercel.app/indexfe59.html';
  } else if (requestedPath === '/recarga' || requestedPath === '/recarga.html') {
    requestedPath = '/timfestival.vercel.app/recarga.html';
  }

  // Tenta localizar o arquivo
  const searchCandidates = [
    path.join(__dirname, decodeURIComponent(requestedPath)),
    path.join(__dirname, 'timfestival.vercel.app', decodeURIComponent(requestedPath.replace(/^\//, ''))),
    path.join(__dirname, requestedPath.replace(/^\//, ''))
  ];

  let filePath = null;
  for (const candidate of searchCandidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      filePath = candidate;
      break;
    }
  }

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`404 Not Found: ${pathname}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*'
  });

  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` Servidor TIM Recarga ativo com Gateway Blackcat`);
  console.log(` URL Local: http://localhost:${PORT}`);
  console.log(` API Key Configurada: ${BLACKCAT_API_KEY.slice(0, 10)}...`);
  console.log(`====================================================`);
});
