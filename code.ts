// Show the UI with an initial size
figma.showUI(__html__, { width: 600, height: 400 });
let textLayers: { node: any; fonts: any[] }[] = [];

// Function to get font names from a text node, including handling multiple styles
function getFontNamesFromTextNode(textNode: any) {
  const fontNames = [];
  let previousFontName = null;

  for (let i = 0; i < textNode.characters.length; i++) {
    const fontName = textNode.getRangeFontName(i, i + 1);
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

// Get all selected text layers
function getSelectedTextLayers() {
  const selection = figma.currentPage.selection;
  textLayers = [];

  function findTextNodes(node: any) {
    if (node.type === "TEXT") {
      const fonts = getFontNamesFromTextNode(node);
      textLayers.push({ node, fonts });
    } else if ("children" in node) {
      for (const child of node.children) {
        findTextNodes(child);
      }
    }
  }

  selection.forEach(findTextNodes);
  return textLayers;
}

// Load all available fonts and send them to the UI
async function loadFonts() {
  const fonts = await figma.listAvailableFontsAsync();
  getSelectedTextLayers();

  const fontsUsed = textLayers
    .flatMap((text) => text.fonts)
    .filter(
      (font, index, self) =>
        index ===
        self.findIndex(
          (f) => f.family === font.family && f.style === font.style
        )
    );

  figma.ui.postMessage({
    type: "load-fonts",
    allFonts: fonts,
    fontsUsed: fontsUsed,
  });
}

// Start by loading fonts
loadFonts();

async function loadSelectedFonts() {
  const fonts = await figma.listAvailableFontsAsync();
  getSelectedTextLayers();

  const fontsUsed = textLayers
    .flatMap((text) => text.fonts)
    .filter(
      (font, index, self) =>
        index ===
        self.findIndex(
          (f) => f.family === font.family && f.style === font.style
        )
    );

  figma.ui.postMessage({
    type: "selected-fonts",
    allFonts: fonts,
    fontsUsed: fontsUsed,
  });
}

figma.on("selectionchange", loadSelectedFonts);

figma.ui.onmessage = async (msg) => {
  if (msg.type === "replace-fonts") {
    // Show the initial notification
    let notification = figma.notify("Replacing fonts, please wait...", {
      timeout: 60000,
    }); // Long timeout

    const { originalFont, newFont } = msg;

    if (newFont.family !== "None") {
      // Ensure the new font is loaded
      await figma.loadFontAsync({
        family: newFont.family,
        style: newFont.style,
      });

      for (let i = 0; i < textLayers.length; i++) {
        // Update the notification with progress
        notification.cancel(); // Cancel the previous notification
        notification = figma.notify(
          `Replacing font in text layer ${i + 1} of ${textLayers.length}`,
          { timeout: 60000 }
        );

        const { node, fonts } = textLayers[i];

        if (
          fonts.length === 1 &&
          fonts[0].family === originalFont.family &&
          fonts[0].style === originalFont.style
        ) {
          // Set the font for the entire node
          node.fontName = { family: newFont.family, style: newFont.style };
        } else {
          // Load the original font for mixed styles
          await figma.loadFontAsync({
            family: originalFont.family,
            style: originalFont.style,
          });

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

    console.log("end");

    // Cancel the progress notification and show a success message
    //notification.cancel();
    //figma.notify("Fonts replaced successfully!", { timeout: 3000 });
    //figma.closePlugin(); // Uncomment if you want to close the plugin after replacement
  }
};
