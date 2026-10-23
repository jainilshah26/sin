/* Bundles the app into dist/ with content-hashed file names, so a phone can never mix old and new files. */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const out = "dist";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "assets"), { recursive: true });

const common = { bundle: true, minify: true, outdir: path.join(out, "assets"), entryNames: "[name]-[hash]", metafile: true, logLevel: "warning" };
const js = await build({ ...common, entryPoints: { app: "js/main.js" }, format: "esm", target: "es2020" });
const css = await build({ ...common, entryPoints: { style: "css/style.css" } });
const file = meta => path.basename(Object.keys(meta.outputs).find(k => !k.endsWith(".map")));
const jsFile = file(js.metafile), cssFile = file(css.metafile);

let html = fs.readFileSync("index.html", "utf8");
html = html.replace('href="css/style.css"', `href="/assets/${cssFile}"`).replace('src="js/main.js"', `src="/assets/${jsFile}"`);
if (!html.includes(jsFile) || !html.includes(cssFile)) throw new Error("index.html was not rewritten");
fs.writeFileSync(path.join(out, "index.html"), html);
fs.cpSync("icons", path.join(out, "icons"), { recursive: true });
fs.copyFileSync("manifest.webmanifest", path.join(out, "manifest.webmanifest"));
const kb = f => (fs.statSync(path.join(out, "assets", f)).size / 1024).toFixed(1);
console.log(`built dist/: ${jsFile} (${kb(jsFile)} KB), ${cssFile} (${kb(cssFile)} KB)`);
