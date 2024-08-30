// Show the UI with an initial size
figma.showUI(__html__, { width: 600, height: 400 });
let textLayers = <any>[];

// Get all selected text layers
function getSelectedTextLayers() {
  const selection = figma.currentPage.selection;

  function findTextNodes(node: any) {
    if (node.type === "TEXT") {
      textLayers.push(node);
    } else if ("children" in node) {
      for (const child of node.children) {
        findTextNodes(child);
      }
    }
  }

  selection.forEach((node) => findTextNodes(node));
  return textLayers;
}

// Load all available fonts and send them to the UI
async function loadFonts() {
  const fonts = await figma.listAvailableFontsAsync();
  const textLayers = getSelectedTextLayers();
  const fontsUsed = [
    ...new Set(textLayers.map((text: any) => text.fontName.family)),
  ];

  figma.ui.postMessage({
    type: "load-fonts",
    allFonts: fonts,
    fontsUsed: fontsUsed,
  });
}

// Start by loading fonts
loadFonts();

function loadSelectedFonts() {
  const textLayers = getSelectedTextLayers();
  const fontsUsed = [
    ...new Set(textLayers.map((text: any) => text.fontName.family)),
  ];

  figma.ui.postMessage({
    type: "selected-fonts",
    fontsUsed: fontsUsed,
  });
}

//loadSelectedFonts();

// Handle messages from the UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === "replace-fonts") {
    const { originalFont, newFont } = msg;

    if (newFont.family != "None") {
      await figma.loadFontAsync(newFont);

      for (const layer of textLayers) {
        if (layer.fontName.family === originalFont) {
          layer.fontName = newFont;
        }
      }
    }

    figma.notify("Fonts replaced successfully!");
    //figma.closePlugin();
  }
};
