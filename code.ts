// Show the UI with an initial size
figma.showUI(__html__, { width: 600, height: 400 });
let textLayers: { node: any; fonts: any[] }[] = [];

// Function to get font names from a text node, including handling multiple styles
async function getFontNamesFromTextNode(textNode: any) {
  const fontNames = [];
  let previousFontName = null;

  for (let i = 0; i < textNode.characters.length; i++) {
    const fontName = await textNode.getRangeFontName(i, i + 1);
    if (
      !previousFontName ||
      fontName.family !== previousFontName.family ||
      fontName.style !== previousFontName.style
    ) {
      fontNames.push(fontName);
      previousFontName = fontName;
    }
  }
  return fontNames;
}

async function getSelectedTextLayers() {
  const selection = figma.currentPage.selection;
  const textLayers: any = [];

  async function findTextNodes(node: any) {
    if (node.type === "TEXT") {
      const fonts = await getFontNamesFromTextNode(node);
      textLayers.push({ node, fonts });
    } else if ("children" in node) {
      for (const child of node.children) {
        await findTextNodes(child);
      }
    }
  }

  for (const node of selection) {
    await findTextNodes(node);
  }

  return textLayers;
}

let loadingNotification: any;

if (figma.currentPage.selection.length !== 0) {
  loadingNotification = figma.notify("Loading...", { timeout: 2000 });
}

// Load all available fonts and send them to the UI
async function loadFonts() {
  const fonts = await figma.listAvailableFontsAsync();
  const textLayers = await getSelectedTextLayers();

  const allAvailableFonts = [
    ...new Set(
      fonts.map((text: any) => {
        return {
          fontName: {
            family: text.fontName.family,
            style: text.fontName.style,
            both: `${text.fontName.family} ${text.fontName.style}`,
          },
        };
      })
    ),
  ];

  const fontsUsed = textLayers
    .flatMap((textLayer: any) => {
      return textLayer.fonts.map((font: any) => {
        return {
          family: font.family,
          style: font.style,
          nodeID: textLayer.node.id, // Include nodeID here
        };
      });
    })
    .filter(
      (font: any, index: any, self: any) =>
        index ===
        self.findIndex(
          (f: any) => f.family === font.family && f.style === font.style
        )
    );

  figma.ui.postMessage({
    type: "load-fonts",
    allFonts: allAvailableFonts,
    fontsUsed: fontsUsed,
  });
}

async function loadSelectedFonts() {
  const fonts = await figma.listAvailableFontsAsync();
  const textLayers = await getSelectedTextLayers();

  const allAvailableFonts = [
    ...new Set(
      fonts.map((text: any) => {
        return {
          fontName: {
            family: text.fontName.family,
            style: text.fontName.style,
            both: `${text.fontName.family} ${text.fontName.style}`,
          },
        };
      })
    ),
  ];

  const fontsUsed = textLayers
    .flatMap((textLayer: any) => {
      return textLayer.fonts.map((font: any) => {
        return {
          family: font.family,
          style: font.style,
          nodeID: textLayer.node.id, // Include nodeID here
        };
      });
    })
    .filter(
      (font: any, index: any, self: any) =>
        index ===
        self.findIndex(
          (f: any) => f.family === font.family && f.style === font.style
        )
    );

  figma.ui.postMessage({
    type: "selected-fonts",
    allFonts: allAvailableFonts,
    fontsUsed: fontsUsed,
  });
}

async function notifyAndLoadSelectedFonts() {
  if (figma.currentPage.selection.length !== 0) {
    loadingNotification = figma.notify("Loading...", { timeout: 1000 });
  }

  setTimeout(async () => {
    await loadSelectedFonts();
  }, 0);
}

figma.on("selectionchange", notifyAndLoadSelectedFonts);

figma.ui.onmessage = async (msg) => {
  if (msg.type === "replace-fonts") {
    let notification = figma.notify("Loading layers, please wait...", {
      timeout: 60000,
    });

    const { allFonts } = msg;
    let fontCount = 0;
    let replaceableFonts = 0;
    let textCount = 0;
    let replaceableTexts = 0;

    const textLayers = await getSelectedTextLayers();

    for (const font of allFonts) {
      const originalFont = font;
      const newFont = JSON.parse(font.value);

      if (newFont.family !== "None") {
        replaceableFonts++;
        for (let i = 0; i < textLayers.length; i++) {
          const { node, fonts } = textLayers[i];
          for (const font of fonts) {
            if (
              font.family === originalFont.family &&
              font.style === originalFont.style
            ) {
              replaceableTexts++;
              break; // No need to count further fonts in this layer
            }
          }
        }
      }
    }

    for (const font of allFonts) {
      const originalFont = font;
      const newFont = JSON.parse(font.value);

      if (newFont.family !== "None") {
        fontCount++;
        try {
          await figma.loadFontAsync({
            family: newFont.family,
            style: newFont.style,
          });
        } catch (err) {
          console.warn(
            `[Bulk Font Replacer] The font "${newFont.family} ${newFont.style}" could not be loaded. Figma may use a fallback font.`
          );
          continue;
        }

        for (let i = 0; i < textLayers.length; i++) {
          // Update the notification with progress
          notification.cancel(); // Cancel the previous notification
          notification = figma.notify(
            `Replacing font ${fontCount}/${replaceableFonts} in text layer ${
              i + 1
            } of ${textLayers.length}`,
            { timeout: 60000 }
          );

          const { node, fonts } = textLayers[i];

          let layerUpdated = false;
          for (const font of fonts) {
            if (
              font.family === originalFont.family &&
              font.style === originalFont.style
            ) {
              if (!layerUpdated) {
                textCount++; // Count this layer as being replaced
                layerUpdated = true;
              }
            }
            try {
              await figma.loadFontAsync({
                family: font.family,
                style: font.style,
              });
            } catch (err) {
              console.warn(
                `[Bulk Font Replacer] The font "${font.family} ${font.style}" could not be loaded. Figma may use a fallback font.`
              );
              continue;
            }
          }

          if (
            fonts.length === 1 &&
            fonts[0].family === originalFont.family &&
            fonts[0].style === originalFont.style
          ) {
            node.fontName = { family: newFont.family, style: newFont.style };
          } else {
            for (let j = 0; j < node.characters.length; j++) {
              const fontName = node.getRangeFontName(j, j + 1);

              if (
                fontName.family === originalFont.family &&
                fontName.style === originalFont.style
              ) {
                // Set the range font name with only the required properties
                node.setRangeFontName(j, j + 1, {
                  family: newFont.family,
                  style: newFont.style,
                });
              }
            }
          }
        }
      }
    }

    // Cancel the progress notification and show a success message
    notification.cancel();
    figma.notify("Fonts replaced successfully!", { timeout: 3000 });
    figma.closePlugin();
  } else if (msg.type === "ready") {
    await loadFonts();
  } else {
    const { nodeID } = msg;

    try {
      const layer: any = await figma.getNodeByIdAsync(nodeID);
      figma.currentPage.selection = [layer];
      figma.viewport.scrollAndZoomIntoView([layer]);
    } catch (err) {
      console.error(`[Bulk Font Replacer] ${err}`);
    }
  }
};
