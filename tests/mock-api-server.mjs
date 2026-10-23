// Local stand-in for the deployed Apps Script web app, for trying the app without Google:
//   node tests/mock-api-server.mjs   then open http://localhost:8080/?api=http://localhost:8081/exec
import http from 'node:http';
import { loadAppsScript } from './fake-apps-script.mjs';

const backend = loadAppsScript();
const port = +process.env.PORT || 8081;

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = req.method === 'POST' ? backend.post(JSON.parse(body || '{}')) : backend.get();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(json));
      if (req.method === 'POST') console.log(JSON.parse(body).action, '->', JSON.stringify(json).slice(0, 80));
    });
  })
  .listen(port, () => console.log(`mock Apps Script API on http://localhost:${port}/exec`));
