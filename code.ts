/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 600, height: 400 });

let cachedAvailableFonts: { fontName: { family: string; style: string; both: string } }[] | null = null;

async function getAvailableFonts() {
  if (!cachedAvailableFonts) {
    const raw = await figma.listAvailableFontsAsync();
    const seen = new Map<string, true>();
    cachedAvailableFonts = [];
    for (const f of raw) {
      const key = `${f.fontName.family}\0${f.fontName.style}`;
      if (!seen.has(key)) {
        seen.set(key, true);
        cachedAvailableFonts.push({
          fontName: {
            family: f.fontName.family,
            style: f.fontName.style,
            both: `${f.fontName.family} ${f.fontName.style}`,
          },
        });
      }
    }
  }
  return cachedAvailableFonts;
}

// Binary search for the end of a contiguous font run — O(log n) per run vs O(n) character scan
function getFontRunEnd(node: TextNode, start: number, font: FontName, len: number): number {
  let lo = start + 1, hi = len;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const f = node.getRangeFontName(mid, mid + 1) as FontName;
    if (f.family === font.family && f.style === font.style) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// O(k log n) where k = number of font runs, instead of O(n) character-by-character
function getFontNamesFromTextNode(node: TextNode): FontName[] {
  const len = node.characters.length;
  if (len === 0) return [];
  const fonts: FontName[] = [];
  let i = 0;
  while (i < len) {
    const font = node.getRangeFontName(i, i + 1) as FontName;
    fonts.push(font);
    i = getFontRunEnd(node, i, font, len);
  }
  return fonts;
}

function getSelectedTextLayers(): { node: TextNode; fonts: FontName[] }[] {
  const result: { node: TextNode; fonts: FontName[] }[] = [];

  function traverse(node: SceneNode) {
    if (node.type === "TEXT") {
      result.push({ node, fonts: getFontNamesFromTextNode(node) });
    } else if ("children" in node) {
      for (const child of node.children) traverse(child);
    }
  }

  for (const node of figma.currentPage.selection) traverse(node);
  return result;
}

function deduplicateFontsUsed(
  textLayers: { node: TextNode; fonts: FontName[] }[]
): { family: string; style: string; nodeID: string }[] {
  const seen = new Map<string, true>();
  const result: { family: string; style: string; nodeID: string }[] = [];
  for (const { node, fonts } of textLayers) {
    for (const font of fonts) {
      const key = `${font.family}\0${font.style}`;
      if (!seen.has(key)) {
        seen.set(key, true);
        result.push({ family: font.family, style: font.style, nodeID: node.id });
      }
    }
  }
  return result;
}

async function sendFontsToUI(type: "load-fonts" | "selected-fonts") {
  const allFonts = await getAvailableFonts();
  const textLayers = getSelectedTextLayers();
  figma.ui.postMessage({ type, allFonts, fontsUsed: deduplicateFontsUsed(textLayers) });
}

if (figma.currentPage.selection.length > 0) {
  figma.notify("Loading...", { timeout: 2000 });
}

figma.on("selectionchange", async () => {
  if (figma.currentPage.selection.length > 0) {
    figma.notify("Loading...", { timeout: 1000 });
  }
  await sendFontsToUI("selected-fonts");
});

figma.ui.onmessage = async (msg) => {
  if (msg.type === "ready") {
    await sendFontsToUI("load-fonts");
  } else if (msg.type === "replace-fonts") {
    let notification = figma.notify("Replacing fonts, please wait...", { timeout: 60000 });

    const { allFonts }: { allFonts: { family: string; style: string; value: string }[] } = msg;
    const textLayers = getSelectedTextLayers();
    const loadedFonts = new Set<string>();

    const ensureFontLoaded = async (font: FontName): Promise<boolean> => {
      const key = `${font.family}\0${font.style}`;
      if (loadedFonts.has(key)) return true;
      try {
        await figma.loadFontAsync(font);
        loadedFonts.add(key);
        return true;
      } catch {
        console.warn(`[Bulk Font Replacer] Could not load "${font.family} ${font.style}"`);
        return false;
      }
    };

    const replacements = allFonts.filter((f) => JSON.parse(f.value).family !== "None");
    let layersAffected = 0;

    for (let ri = 0; ri < replacements.length; ri++) {
      const orig = replacements[ri];
      const newFont = JSON.parse(orig.value) as FontName;

      notification.cancel();
      notification = figma.notify(
        `Replacing font ${ri + 1} of ${replacements.length}...`,
        { timeout: 60000 }
      );

      if (!(await ensureFontLoaded(newFont))) continue;

      for (const { node, fonts } of textLayers) {
        if (!fonts.some((f) => f.family === orig.family && f.style === orig.style)) continue;

        for (const f of fonts) await ensureFontLoaded(f);

        layersAffected++;

        if (fonts.length === 1) {
          node.fontName = newFont;
        } else {
          // Replace matching runs using binary search — avoids per-character iteration
          const len = node.characters.length;
          let j = 0;
          while (j < len) {
            const font = node.getRangeFontName(j, j + 1) as FontName;
            const end = getFontRunEnd(node, j, font, len);
            if (font.family === orig.family && font.style === orig.style) {
              node.setRangeFontName(j, end, newFont);
            }
            j = end;
          }
        }
      }
    }

    notification.cancel();
    figma.notify(
      `Done! Replaced fonts in ${layersAffected} layer${layersAffected !== 1 ? "s" : ""}.`,
      { timeout: 3000 }
    );

    figma.root.setRelaunchData({ open: "" });
    figma.closePlugin();
  } else if (msg.type === "go-to") {
    try {
      const layer = (await figma.getNodeByIdAsync(msg.nodeID)) as SceneNode;
      figma.currentPage.selection = [layer];
      figma.viewport.scrollAndZoomIntoView([layer]);
    } catch (err) {
      console.error(`[Bulk Font Replacer] ${err}`);
    }
  }
};
