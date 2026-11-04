// Copies every image in index.html's IMG map to Cloudinary and rewrites the map to Cloudinary URLs.
// Cloudinary pulls each original from Google Photos server-side; nothing is downloaded locally.
// Usage: CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud> node scripts/migrate-to-cloudinary.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const FILE = new URL("../index.html", import.meta.url);
const FOLDER = "tow-design-kit";
const dry = process.argv.includes("--dry");

const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(process.env.CLOUDINARY_URL || "");
if (!m && !dry) { console.error("Set CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>"); process.exit(1); }
const [, key, secret, cloud] = m || [];

let html = readFileSync(FILE, "utf8");
const block = /const IMG=\{([\s\S]*?)\};/.exec(html);
if (!block) throw new Error("IMG map not found");
const entries = [...block[1].matchAll(/"([^"]+)":"([^"]+)"/g)].map(([, path, url]) => ({ path, url }));
const todo = entries.filter(e => e.url.includes("googleusercontent.com"));
console.log(`${entries.length} images in map, ${todo.length} still on Google Photos`);

const sign = params => createHash("sha1").update(
  Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + secret).digest("hex");

let failed = 0;
for (const e of todo) {
  const public_id = `${FOLDER}/${e.path.replace(/\.[a-z]+$/i, "")}`;
  const source = e.url + "=d"; // =d asks Google for the original file
  if (dry) { console.log(`would upload ${e.path} -> ${public_id}`); continue; }
  const params = { overwrite: "true", public_id, timestamp: Math.floor(Date.now() / 1000) };
  const body = new URLSearchParams({ ...params, file: source, api_key: key, signature: sign(params) });
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: "POST", body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.secure_url) { failed++; console.error(`FAIL ${e.path}: ${res.status} ${j.error?.message || ""}`); continue; }
  html = html.replace(`"${e.path}":"${e.url}"`, `"${e.path}":"${j.secure_url}"`);
  console.log(`ok   ${e.path} -> ${j.secure_url} (${j.width}x${j.height})`);
}
if (!dry) writeFileSync(FILE, html);
console.log(failed ? `${failed} failed; index.html updated for the rest. Re-run to retry.` : "done");
process.exit(failed ? 2 : 0);
