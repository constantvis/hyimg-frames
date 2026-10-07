// Loads the plugin's browser files in node without changing or copying them. editor/colorgrade.js is a plain script that puts
// HyColorGrade on window: it runs in a node:vm context. grade.js is an ES module with browser-only top-level lines: its text is turned
// into a function in memory (imports handed in, `export` dropped, import.meta.url given) and run in the same kind of context.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const read = rel => fs.readFileSync(path.join(REPO, rel), "utf8");
export const url = rel => pathToFileURL(path.join(REPO, rel)).href;
// objects made inside a vm context have that context's prototypes: compare them as plain JSON
export const plain = x => JSON.parse(JSON.stringify(x));

// a window with only what these files touch at load
export function context(extra = {}) {
  const win = Object.assign({ console, URL, setTimeout, clearTimeout, queueMicrotask, performance: { now: () => 0 }, devicePixelRatio: 1,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} } }, extra);
  win.window = win.globalThis = win;
  return vm.createContext(win);
}

export function colorGrade(ctx = context()) {
  vm.runInContext(read("editor/selcolor.js"), ctx, { filename: path.join(REPO, "editor/selcolor.js") });   // Selective Color, loaded first
  vm.runInContext(read("editor/colorgrade.js"), ctx, { filename: path.join(REPO, "editor/colorgrade.js") });
  return ctx.HyColorGrade;
}

// an ES module's text as a function of its imports: returns its exports
export function moduleIn(ctx, rel, imports = {}) {
  let src = read(rel); const names = [];
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/gm, (m, list, from) =>
    `const {${list.replace(/\bas\b/g, ":")}} = __imports[${JSON.stringify(from)}];`);
  src = src.replace(/^import\s*\*\s*as\s+(\w+)\s+from\s*["']([^"']+)["'];?/gm, (m, name, from) => `const ${name} = __imports[${JSON.stringify(from)}];`);
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)\s+([\w$]+)/gm, (m, kind, name) => { names.push(name); return `${kind} ${name}`; });
  src = src.replace(/^export\s*\{([^}]*)\};?/gm, (m, list) => { for (const part of list.split(",")) { const [a, b] = part.trim().split(/\s+as\s+/); if (a) names.push(b ? `${b}: ${a}` : a); } return ""; });
  src = src.replace(/import\.meta\.url/g, "__meta.url");
  const fn = vm.runInContext(`(function (__imports, __meta) {\n${src}\nreturn { ${names.join(", ")} };\n})`, ctx, { filename: path.join(REPO, rel) });
  return fn(imports, { url: url(rel) });
}
