# Bulk Font Replacer — Agent Guide

Figma plugin that lets users replace fonts across multiple text layers in bulk. Published on the Figma Community (ID: `1406204255843371488`).

## Project layout

| File | Purpose |
|---|---|
| `code.ts` | Plugin backend — runs inside Figma's sandbox. Compiled to `code.js` by `tsc`. |
| `ui.html` | Plugin UI — a single self-contained HTML file with inline CSS and JS. No bundler; loaded directly by Figma. |
| `manifest.json` | Figma plugin manifest (entry points, permissions, relaunch buttons). |
| `tsconfig.json` | TypeScript config. Figma globals (`figma`, `TextNode`, `FontName`, …) come from `@figma/plugin-typings` via `typeRoots`. The file also needs `/// <reference types="@figma/plugin-typings" />` at the top of `code.ts` for IDE resolution. |

## Build

```
npm run build   # tsc -p tsconfig.json  →  code.js
npm run watch   # same with --watch
```

There is no bundler. The compiled `code.js` and `ui.html` are loaded directly by Figma.

## Architecture

### Message protocol (postMessage)

`code.ts` ↔ `ui.html` communicate via `figma.ui.postMessage` / `parent.postMessage`.

| Direction | `type` | Payload | When |
|---|---|---|---|
| plugin → UI | `load-fonts` | `{ allFonts, fontsUsed }` | UI sends `ready` on DOMContentLoaded |
| plugin → UI | `selected-fonts` | `{ allFonts, fontsUsed }` | Figma selection changes |
| UI → plugin | `ready` | — | UI is mounted |
| UI → plugin | `replace-fonts` | `{ allFonts: fontSelectors[] }` | User clicks Replace |
| UI → plugin | `go-to` | `{ nodeID }` | User clicks the target icon on a font row |

`fontSelectors` is an array of `{ family, style, value, nodeID }` where `value` is a JSON string `{ family, style }` representing the chosen replacement font (`family: "None"` means skip).

### Plugin backend (`code.ts`)

Key functions:

- **`getAvailableFonts()`** — calls `figma.listAvailableFontsAsync()` once and caches the result for the session. Deduplicates by `family+style` with a `Map`.
- **`getFontRunEnd(node, start, font, len)`** — binary search for the end of a contiguous font run. O(log n) per run.
- **`getFontNamesFromTextNode(node)`** — synchronous. Uses `getFontRunEnd` to collect unique font runs in O(k log n) where k = number of runs.
- **`getSelectedTextLayers()`** — synchronous recursive traversal of `figma.currentPage.selection`. Returns `{ node: TextNode, fonts: FontName[] }[]`.
- **`deduplicateFontsUsed(textLayers)`** — returns the unique `{ family, style, nodeID }` list sent to the UI.
- **`sendFontsToUI(type)`** — async; calls `getAvailableFonts()` then `getSelectedTextLayers()`, posts result to UI.

Font replacement loop (inside `figma.ui.onmessage`):
1. Filter `allFonts` to replacements where `value.family !== "None"`.
2. For each replacement, load the new font with a cached `ensureFontLoaded` helper.
3. For each affected text layer, load all existing fonts, then:
   - If the layer has a single font: set `node.fontName` directly.
   - Otherwise: walk font runs with `getFontRunEnd` and call `setRangeFontName` per matching run.

### Plugin UI (`ui.html`)

Pure vanilla JS, no framework.

- **`ICONS`** — module-level object with SVG strings. Created once.
- **`fontSelectors`** — module-level array tracking each font row's current state. Mutated in-place by dropdown selections; sent to the plugin on Replace.
- **`createDropdown(font, allFonts, index)`** — builds a full-screen overlay dropdown with a search input. Uses **virtual scrolling**: only ~15 DOM nodes exist at a time regardless of font list size. `currentSelectedValue` lives at `createDropdown` scope so it survives search re-renders.
- **`createFontRow(font, allFonts, index)`** — builds one row (current font → arrow → dropdown).
- **`window.addEventListener("message", ...)`** — handles `load-fonts` and `selected-fonts` by rebuilding all font rows.

#### Virtual scroll details

`createOptions(fonts)` inside `createDropdown`:
- Builds a flat `items` array (None option + filtered fonts).
- Creates a single tall `inner` div (`items.length × 47px`) to give the scrollbar the right proportions.
- `renderVisible()` — called on scroll and on initial open — computes visible range `[first, last]` using `ITEM_HEIGHT = 47` and `OVERSCAN = 3`, then adds/removes absolutely-positioned item elements into a `pool` Map.
- The scroll listener from the previous call is removed before each `createOptions` call (important for search re-renders).

## Editing guidelines

- **`code.ts` only** — never edit `code.js` directly; it is the compiled output.
- **No bundler** — `ui.html` is a single file. Keep all CSS and JS inline.
- **Figma API is sync except where noted** — `getRangeFontName`, `setRangeFontName`, node traversal are all synchronous. Only `loadFontAsync`, `listAvailableFontsAsync`, `getNodeByIdAsync` are async.
- **Test by loading unpublished in Figma** — open Figma desktop → Plugins → Development → Import plugin from manifest → select `manifest.json`.
- **`ITEM_HEIGHT = 47`** matches `.option { padding: 12px 15px; font-size: 18px; border-bottom: 1px }`. If you change the option row CSS, update this constant.
