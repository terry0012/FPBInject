/**
 * Tests for detecting unreferenced CSS selectors.
 *
 * Scans all CSS files and checks that every class/ID selector
 * is referenced in at least one HTML template or JS source file.
 */
const fs = require('fs');
const path = require('path');
const { describe, it, assertTrue } = require('./framework');

module.exports = function () {
  const ROOT = path.join(__dirname, '..', '..');
  const CSS_DIR = path.join(ROOT, 'static', 'css');
  const TEMPLATE_DIR = path.join(ROOT, 'templates');
  const JS_DIR = path.join(ROOT, 'static', 'js');

  /* ===========================
   FILE COLLECTION
   =========================== */

  function collectFiles(dir, ext) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFiles(full, ext));
      } else if (entry.name.endsWith(ext)) {
        results.push(full);
      }
    }
    return results;
  }

  /* ===========================
   CSS SELECTOR EXTRACTION
   =========================== */

  /**
   * Extract all class names and IDs from a CSS file.
   * Returns { classes: Set<string>, ids: Set<string> }
   */
  function extractSelectors(cssContent) {
    const classes = new Set();
    const ids = new Set();

    // Remove comments
    const cleaned = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove @keyframes blocks (their names are not selectors)
    const noKeyframes = cleaned.replace(
      /@keyframes\s+[\w-]+\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g,
      '',
    );

    // Remove @media / @supports wrappers (keep inner content)
    // We just need to extract selectors from rule blocks

    // Match selectors before { ... }
    const ruleRegex = /([^{}@]+)\{/g;
    let match;
    while ((match = ruleRegex.exec(noKeyframes)) !== null) {
      const selectorGroup = match[1].trim();
      if (!selectorGroup || selectorGroup.startsWith('@')) continue;

      // Split comma-separated selectors
      for (const selector of selectorGroup.split(',')) {
        const trimmed = selector.trim();

        // Extract class names: .foo-bar
        const classMatches = trimmed.match(/\.([a-zA-Z_][\w-]*)/g);
        if (classMatches) {
          for (const c of classMatches) {
            classes.add(c.slice(1)); // remove leading dot
          }
        }

        // Extract IDs: #foo-bar
        const idMatches = trimmed.match(/#([a-zA-Z_][\w-]*)/g);
        if (idMatches) {
          for (const id of idMatches) {
            ids.add(id.slice(1)); // remove leading #
          }
        }
      }
    }

    return { classes, ids };
  }

  /* ===========================
   REFERENCE SCANNING
   =========================== */

  function buildReferenceCorpus() {
    const htmlFiles = collectFiles(TEMPLATE_DIR, '.html');
    const jsFiles = collectFiles(JS_DIR, '.js');

    let corpus = '';
    for (const f of [...htmlFiles, ...jsFiles]) {
      corpus += fs.readFileSync(f, 'utf-8') + '\n';
    }
    return corpus;
  }

  function isReferenced(name, corpus) {
    // Direct string match — covers class="foo", classList.add('foo'),
    // getElementById('foo'), querySelector('.foo' / '#foo'), etc.
    return corpus.includes(name);
  }

  /* ===========================
   KNOWN EXCEPTIONS
   =========================== */

  // Pseudo-element / state suffixes that CSS generates but aren't in source
  // e.g. .tab:hover — "tab" is the real class, ":hover" is pseudo
  // These are classes that only appear as part of pseudo-selectors or
  // are injected by third-party libraries / browser defaults.
  const WHITELIST = new Set([
    // Codicon font classes (loaded from external font, referenced by prefix)
    // Browser/OS scrollbar styling
    'webkit-scrollbar',
    'webkit-scrollbar-thumb',
    'webkit-scrollbar-track',
  ]);

  /* ===========================
   TESTS
   =========================== */

  const cssFiles = collectFiles(CSS_DIR, '.css');
  const corpus = buildReferenceCorpus();

  // Also include CSS files themselves as reference (cross-file references like var())
  let cssCorpus = '';
  for (const f of cssFiles) {
    cssCorpus += fs.readFileSync(f, 'utf-8') + '\n';
  }

  describe('CSS Unused Selectors', () => {
    for (const cssFile of cssFiles) {
      const basename = path.basename(cssFile);
      const content = fs.readFileSync(cssFile, 'utf-8');
      const { classes, ids } = extractSelectors(content);

      it(`${basename}: all class selectors are referenced`, () => {
        const unreferenced = [];
        for (const cls of classes) {
          if (WHITELIST.has(cls)) continue;
          if (!isReferenced(cls, corpus) && !isReferenced(cls, cssCorpus)) {
            unreferenced.push(`.${cls}`);
          }
        }
        assertTrue(
          unreferenced.length === 0,
          `Unreferenced classes in ${basename}:\n  ${unreferenced.join('\n  ')}`,
        );
      });

      it(`${basename}: all ID selectors are referenced`, () => {
        const unreferenced = [];
        for (const id of ids) {
          if (WHITELIST.has(id)) continue;
          if (!isReferenced(id, corpus) && !isReferenced(id, cssCorpus)) {
            unreferenced.push(`#${id}`);
          }
        }
        assertTrue(
          unreferenced.length === 0,
          `Unreferenced IDs in ${basename}:\n  ${unreferenced.join('\n  ')}`,
        );
      });
    }
  });
};
