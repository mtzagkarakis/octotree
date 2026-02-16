const fs = require('fs');
const path = require('path');

// ---------- Configuration ----------
const ROOT = __dirname;
const TMP = path.join(ROOT, 'tmp');
const DIST = path.join(ROOT, 'dist');

const args = process.argv.slice(2);
const isProduction = args.includes('--production');
const isDist = args.includes('--dist');
const isWatch = args.includes('--watch');

const VERSION = require('./package.json').version;

// JS source files in exact concatenation order (matches gulpfile lines 159-177)
const OCTOTREE_JS_SOURCES = [
  'tmp/template.js',
  'src/util.module.js',
  'src/util.async.js',
  'src/util.misc.js',
  'src/util.deXss.js',
  'src/util.plugins.js',
  'src/core.constants.js',
  'src/core.storage.js',
  'src/core.plugins.js',
  'src/core.api.js',
  'src/adapters/adapter.js',
  'src/adapters/pjax.js',
  'src/adapters/github.js',
  'src/adapters/gitlab.js',
  'src/view.help.js',
  'src/view.error.js',
  'src/view.tree.js',
  'src/view.options.js',
  'src/main.js',
];

// Library files bundled into content.js
const LIB_SOURCES = [
  'libs/file-icons.js',
  'libs/jquery.js',
  'libs/jquery-ui.js',
  'libs/jstree.js',
  'libs/keymaster.js',
  'tmp/ondemand.js',
  'tmp/octotree.js',
];

// ---------- Helpers ----------

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function readFile(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), 'utf8');
}

function writeFile(filePath, content) {
  const full = path.join(ROOT, filePath);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, content, 'utf8');
}

// ---------- Build Steps ----------

function clean() {
  console.log('  Cleaning tmp/...');
  cleanDir(TMP);
  ensureDir(TMP);
}

function buildTemplate() {
  console.log('  Building template...');
  const LOTS_OF_SPACES = new Array(500).join(' ');
  let html = readFile('src/template.html');
  html = html.replace('__SPACES__', LOTS_OF_SPACES);

  // Escape for JS string literal
  const escaped = html
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, "\\n' +\n    '");

  const js = `const TEMPLATE = '${escaped}'`;
  writeFile('tmp/template.js', js);
}

function buildOndemand() {
  console.log('  Building ondemand...');
  const dir = path.join(ROOT, 'libs', 'ondemand');
  if (!fs.existsSync(dir)) {
    writeFile('tmp/ondemand.js', '');
    return;
  }
  const code = fs
    .readdirSync(dir)
    .map((file) => {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      return `window['${file}'] = function () {\n${content}\n};\n`;
    })
    .join('');
  writeFile('tmp/ondemand.js', code);
}

async function buildCss() {
  console.log('  Building CSS...');
  const less = require('less');

  // Compile LESS
  const lessSource = readFile('src/styles/octotree.less');
  const lessResult = await less.render(lessSource, {
    filename: path.join(ROOT, 'src/styles/octotree.less'),
    paths: [path.join(ROOT, 'src/styles'), path.join(ROOT, 'src/adapters')],
    relativeUrls: true,
  });
  writeFile('tmp/octotree.css', lessResult.css);

  // Process file-icons.css
  let fileIconsCss = readFile('libs/file-icons.css');
  fileIconsCss = fileIconsCss.replace(
    /\.\.\/fonts/g,
    'chrome-extension://__MSG_@@extension_id__/fonts'
  );
  writeFile('tmp/file-icons.css', fileIconsCss);

  // Process jstree.css
  let jstreeCss = readFile('libs/jstree.css');
  jstreeCss = jstreeCss.replace(
    /url\("32px\.png"\)/g,
    'url("chrome-extension://__MSG_@@extension_id__/images/32px.png")'
  );
  jstreeCss = jstreeCss.replace(
    /url\("40px\.png"\)/g,
    'url("chrome-extension://__MSG_@@extension_id__/images/40px.png")'
  );
  jstreeCss = jstreeCss.replace(
    /url\("throbber\.gif"\)/g,
    'url("chrome-extension://__MSG_@@extension_id__/images/throbber.gif")'
  );
  writeFile('tmp/jstree.css', jstreeCss);

  // Concatenate CSS
  const combinedCss = [
    readFile('tmp/file-icons.css'),
    readFile('tmp/jstree.css'),
    readFile('tmp/octotree.css'),
  ].join('\n');

  if (isProduction) {
    const esbuild = require('esbuild');
    const result = await esbuild.transform(combinedCss, {
      loader: 'css',
      minify: true,
    });
    writeFile('tmp/content.css', result.code);
  } else {
    writeFile('tmp/content.css', combinedCss);
  }
}

function buildOctotreeJs() {
  console.log('  Building octotree.js...');
  const combined = OCTOTREE_JS_SOURCES.map((f) => readFile(f)).join('\n');
  writeFile('tmp/octotree.js', combined);
}

async function buildContentJs() {
  console.log('  Building content.js...');
  const parts = LIB_SOURCES.map((f) => {
    const content = readFile(f);
    return `(function(){\n${content}\n})();`;
  });
  const combined = parts.join('\n');

  if (isProduction) {
    const esbuild = require('esbuild');
    const result = await esbuild.transform(combined, {
      loader: 'js',
      minify: true,
    });
    writeFile('tmp/content.js', result.code);
  } else {
    writeFile('tmp/content.js', combined);
  }
}

function prepareChromeFolder() {
  console.log('  Preparing Chrome folder...');
  const chromeDir = path.join(TMP, 'chrome');
  ensureDir(chromeDir);

  // Copy icons
  copyDir(path.join(ROOT, 'icons'), path.join(chromeDir, 'icons'));

  // Copy fonts
  copyDir(path.join(ROOT, 'libs', 'fonts'), path.join(chromeDir, 'fonts'));

  // Copy images
  copyDir(path.join(ROOT, 'libs', 'images'), path.join(chromeDir, 'images'));

  // Copy content.js and content.css
  fs.copyFileSync(path.join(TMP, 'content.js'), path.join(chromeDir, 'content.js'));
  fs.copyFileSync(path.join(TMP, 'content.css'), path.join(chromeDir, 'content.css'));

  // Process and copy manifest.json
  let manifest = readFile('src/config/wex/manifest.json');
  manifest = manifest.replace('$VERSION', VERSION);
  fs.writeFileSync(path.join(chromeDir, 'manifest.json'), manifest, 'utf8');

  // Copy background.js
  fs.copyFileSync(
    path.join(ROOT, 'src', 'config', 'wex', 'background.js'),
    path.join(chromeDir, 'background.js')
  );
}

async function createDist() {
  console.log('  Creating distribution ZIP...');
  ensureDir(DIST);

  const archiver = require('archiver');
  const output = fs.createWriteStream(path.join(DIST, 'chrome.zip'));
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log(`  chrome.zip created (${archive.pointer()} bytes)`);
      resolve();
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(path.join(TMP, 'chrome'), false);
    archive.finalize();
  });
}

// ---------- Main Build ----------

async function build() {
  const start = Date.now();
  console.log(`Building v${VERSION}${isProduction ? ' (production)' : ''}...`);

  clean();
  buildTemplate();
  buildOndemand();
  await buildCss();
  buildOctotreeJs();
  await buildContentJs();
  prepareChromeFolder();

  if (isDist) {
    await createDist();
  }

  console.log(`Done in ${Date.now() - start}ms`);
}

// ---------- Watch Mode ----------

async function watch() {
  await build();

  const chokidar = require('chokidar');
  const watchPaths = [
    path.join(ROOT, 'src'),
    path.join(ROOT, 'libs'),
  ];

  console.log('\nWatching for changes...');

  let building = false;
  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200 },
  });

  watcher.on('all', async (event, filePath) => {
    if (building) return;
    building = true;
    console.log(`\nFile changed: ${path.relative(ROOT, filePath)}`);
    try {
      await build();
    } catch (err) {
      console.error('Build error:', err.message);
    }
    building = false;
  });
}

// ---------- Entry Point ----------

if (isWatch) {
  watch().catch(console.error);
} else {
  build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}
