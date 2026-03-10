/**
 * Tests for layout constraints between workbench.css and tutorial.css
 *
 * Ensures sidebar default width >= tutorial modal width,
 * and layout proportions are within reasonable bounds.
 */
const fs = require('fs');
const path = require('path');
const { describe, it, assertTrue, assertEqual } = require('./framework');

// Parse CSS files at module load time
const cssDir = path.join(__dirname, '..', '..', 'static', 'css');
const workbenchCSS = fs.readFileSync(
  path.join(cssDir, 'workbench.css'),
  'utf-8',
);
const tutorialCSS = fs.readFileSync(path.join(cssDir, 'tutorial.css'), 'utf-8');

/**
 * Extract a CSS custom property default value from :root
 * e.g. "--sidebar-width: 25vw;" → "25vw"
 */
function extractCSSVar(css, varName) {
  const re = new RegExp(
    `${varName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*:\\s*([^;]+);`,
  );
  const m = css.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Extract a CSS property value from a selector block.
 * Uses a line-start anchor to avoid matching compound selectors
 * like ".tutorial-overlay .tutorial-modal" when looking for ".tutorial-modal".
 */
function extractPropertyFromBlock(css, selector, property) {
  // Split into lines and find the block that starts with exactly this selector
  const lines = css.split('\n');
  let inBlock = false;
  let braceDepth = 0;
  let blockContent = '';

  for (const line of lines) {
    if (!inBlock) {
      const trimmed = line.trim();
      // Match line that is exactly "selector {" (not part of a compound selector)
      if (trimmed === selector + ' {' || trimmed === selector + '{') {
        inBlock = true;
        braceDepth = 1;
        blockContent = '';
        continue;
      }
    } else {
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      if (braceDepth <= 0) break;
      blockContent += line + '\n';
    }
  }

  if (!blockContent) return null;
  const propRe = new RegExp(`${property}\\s*:\\s*([^;]+);`);
  const propMatch = blockContent.match(propRe);
  return propMatch ? propMatch[1].trim() : null;
}

/**
 * Parse a CSS value with unit, returns { value, unit }
 * e.g. "25vw" → { value: 25, unit: "vw" }
 * e.g. "350px" → { value: 350, unit: "px" }
 */
function parseCSSValue(str) {
  if (!str) return null;
  const m = str.match(/^([\d.]+)(px|vw|vh|%|em|rem)$/);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: m[2] };
}

module.exports = function () {
  /* ===========================
     CSS Variable Extraction
     =========================== */

  describe('Layout - CSS Variables Exist', () => {
    it('workbench.css defines --sidebar-width', () => {
      const val = extractCSSVar(workbenchCSS, '--sidebar-width');
      assertTrue(val !== null, '--sidebar-width not found in workbench.css');
    });

    it('workbench.css defines --panel-height', () => {
      const val = extractCSSVar(workbenchCSS, '--panel-height');
      assertTrue(val !== null, '--panel-height not found in workbench.css');
    });

    it('tutorial.css defines .tutorial-modal width', () => {
      const val = extractPropertyFromBlock(
        tutorialCSS,
        '.tutorial-modal',
        'width',
      );
      assertTrue(val !== null, '.tutorial-modal width not found');
    });

    it('tutorial.css defines .tutorial-modal min-width', () => {
      const val = extractPropertyFromBlock(
        tutorialCSS,
        '.tutorial-modal',
        'min-width',
      );
      assertTrue(val !== null, '.tutorial-modal min-width not found');
    });
  });

  /* ===========================
     Proportional Layout Checks
     =========================== */

  describe('Layout - Sidebar Proportions', () => {
    it('sidebar width uses viewport-relative unit (vw)', () => {
      const val = extractCSSVar(workbenchCSS, '--sidebar-width');
      const parsed = parseCSSValue(val);
      assertTrue(
        parsed !== null && parsed.unit === 'vw',
        `Expected vw unit, got: ${val}`,
      );
    });

    it('sidebar width is between 20vw and 40vw', () => {
      const val = extractCSSVar(workbenchCSS, '--sidebar-width');
      const parsed = parseCSSValue(val);
      assertTrue(parsed !== null, `Cannot parse: ${val}`);
      assertTrue(
        parsed.value >= 20 && parsed.value <= 40,
        `Sidebar ${parsed.value}vw out of [20, 40] range`,
      );
    });
  });

  describe('Layout - Panel Proportions', () => {
    it('panel height uses viewport-relative unit (vh)', () => {
      const val = extractCSSVar(workbenchCSS, '--panel-height');
      const parsed = parseCSSValue(val);
      assertTrue(
        parsed !== null && parsed.unit === 'vh',
        `Expected vh unit, got: ${val}`,
      );
    });

    it('panel height is between 15vh and 40vh', () => {
      const val = extractCSSVar(workbenchCSS, '--panel-height');
      const parsed = parseCSSValue(val);
      assertTrue(parsed !== null, `Cannot parse: ${val}`);
      assertTrue(
        parsed.value >= 15 && parsed.value <= 40,
        `Panel ${parsed.value}vh out of [15, 40] range`,
      );
    });
  });

  /* ===========================
     Sidebar >= Tutorial Constraint
     =========================== */

  describe('Layout - Sidebar >= Tutorial Width', () => {
    it('tutorial modal width is derived from --sidebar-width (not fixed px)', () => {
      const val = extractPropertyFromBlock(
        tutorialCSS,
        '.tutorial-modal',
        'width',
      );
      assertTrue(
        val.includes('var(--sidebar-width)'),
        `Tutorial width should reference --sidebar-width, got: ${val}`,
      );
    });

    it('tutorial modal min-width is less than sidebar min-width', () => {
      // tutorial min-width
      const tutorialMinStr = extractPropertyFromBlock(
        tutorialCSS,
        '.tutorial-modal',
        'min-width',
      );
      const tutorialMin = parseCSSValue(tutorialMinStr);
      assertTrue(
        tutorialMin !== null && tutorialMin.unit === 'px',
        `Cannot parse tutorial min-width: ${tutorialMinStr}`,
      );

      // sidebar min-width from .sidebar block
      const sidebarBlock = workbenchCSS.match(/\.sidebar\s*\{([^}]+)\}/);
      assertTrue(sidebarBlock !== null, '.sidebar block not found');
      const sidebarMinMatch = sidebarBlock[1].match(/min-width\s*:\s*([^;]+);/);
      assertTrue(sidebarMinMatch !== null, 'sidebar min-width not found');
      const sidebarMin = parseCSSValue(sidebarMinMatch[1].trim());
      assertTrue(
        sidebarMin !== null && sidebarMin.unit === 'px',
        `Cannot parse sidebar min-width: ${sidebarMinMatch[1]}`,
      );

      assertTrue(
        tutorialMin.value <= sidebarMin.value,
        `Tutorial min-width (${tutorialMin.value}px) must be <= sidebar min-width (${sidebarMin.value}px)`,
      );
    });

    it('sidebar min-width (CSS) >= sash drag minimum (JS)', () => {
      // sidebar CSS min-width
      const sidebarBlock = workbenchCSS.match(/\.sidebar\s*\{([^}]+)\}/);
      const sidebarMinMatch = sidebarBlock[1].match(/min-width\s*:\s*([^;]+);/);
      const sidebarMin = parseCSSValue(sidebarMinMatch[1].trim());

      // sash.js drag minimum (hardcoded 150)
      const sashJS = fs.readFileSync(
        path.join(__dirname, '..', '..', 'static', 'js', 'ui', 'sash.js'),
        'utf-8',
      );
      const dragMinMatch = sashJS.match(/newWidth\s*>=\s*(\d+)/);
      assertTrue(
        dragMinMatch !== null,
        'Sash drag minimum not found in sash.js',
      );
      const dragMin = parseInt(dragMinMatch[1], 10);

      assertTrue(
        sidebarMin.value >= dragMin,
        `Sidebar CSS min-width (${sidebarMin.value}px) must be >= sash drag min (${dragMin}px)`,
      );
    });
  });
};
