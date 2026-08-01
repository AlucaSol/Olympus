/* ==========================================================================
   Local preview server.

       npm run serve       ->  http://localhost:8080

   Port 8080 on purpose: it is the origin listed in the Edge Functions' CORS
   allow-list and in Supabase's redirect URLs, so signup, login and Stripe
   checkout all work locally exactly as they do in production. Serving from a
   different port will get you CORS failures that look like bugs but are not.

   Do not open the .html files directly from disk — see docs/deployment.md.
   ========================================================================== */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/index.html";

  const file = path.join(ROOT, rel);

  // Refuse anything that climbs out of the project, and anything holding
  // credentials — this server has no auth and should never hand those out
  // even to someone on the same machine.
  const blocked = /(^|[\\/])(secrets\.local|env|\.env.*|node_modules)([\\/]|$)/i;
  if (!file.startsWith(ROOT) || blocked.test(rel)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      // Mirror what GitHub Pages does with an unknown path.
      fs.readFile(path.join(ROOT, "404.html"), (fallbackErr, page) => {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fallbackErr ? "Not found" : page);
      });
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Triarchs of Olympus — serving ${ROOT}`);
  console.log(`  http://localhost:${PORT}/index.html   (splash)`);
  console.log(`  http://localhost:${PORT}/home.html`);
  console.log(`  http://localhost:${PORT}/emporion.html`);
  console.log("\nCtrl+C to stop.");
});
