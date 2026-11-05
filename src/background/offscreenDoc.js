export const OFFSCREEN_OPTIONS = {
  url: 'src/offscreen/offscreen.html',
  reasons: ['BLOBS'],
  justification: 'Create a local blob URL so the Markdown download is not limited by a data URL.',
};

export async function ensureOffscreenDocument(chromeApi) {
  try {
    const contexts = await chromeApi.runtime.getContexts?.({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (Array.isArray(contexts) && contexts.length > 0) {
      return;
    }
  } catch {
    // Fall through and create the document.
  }

  try {
    await chromeApi.offscreen.createDocument(OFFSCREEN_OPTIONS);
  } catch {
    await chromeApi.offscreen.closeDocument();
    await chromeApi.offscreen.createDocument(OFFSCREEN_OPTIONS);
  }
}
