// Stamps every local script/stylesheet link with the commit id so browsers always load the newest files.
const fs = require('fs'), path = require('path');
const dir = process.argv[2], v = process.argv[3];
const local = (p) => !/^(https?:)?\/\//.test(p);
for (const f of fs.readdirSync(dir)) {
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, 'utf8');
  if (f.endsWith('.html')) {
    s = s.replace(/((?:src|href)=")([^"?#]+\.(?:js|css))(\?v=[^"]*)?"/g, (m, a, u) => local(u) ? `${a}${u}?v=${v}"` : m);
    s = s.replace(/<meta name="bbl-version" content="[^"]*">/g, `<meta name="bbl-version" content="${v}">`);
  } else if (f.endsWith('.js')) {
    s = s.replace(/(from\s*|import\s*\(\s*)(['"])(\.\/[^'"?]+\.js)(\?v=[^'"]*)?\2/g, (m, a, q, u) => `${a}${q}${u}?v=${v}${q}`);
  } else continue;
  fs.writeFileSync(p, s);
}
fs.writeFileSync(path.join(dir, 'version.txt'), v + '\n');
