const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const htmlPath = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(html);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Official Product Website running on http://0.0.0.0:${PORT}`);
});
