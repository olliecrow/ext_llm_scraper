export const OFFSCREEN_OPTIONS = {
  url: 'src/offscreen/offscreen.html',
  reasons: ['DOM_PARSER', 'BLOBS'],
  justification: 'Parse fetched pages and create a local blob URL for the Markdown download.',
};

// One extension has at most one offscreen document. Creation and closing run
// one at a time, and the document stays open while any task holds it.
const lifetimes = new WeakMap();

function lifetimeFor(chromeApi) {
  let lifetime = lifetimes.get(chromeApi);
  if (!lifetime) {
    lifetime = { holders: 0, queue: Promise.resolve() };
    lifetimes.set(chromeApi, lifetime);
  }
  return lifetime;
}

function runInOrder(lifetime, step) {
  const run = lifetime.queue.then(step);
  lifetime.queue = run.catch(() => undefined);
  return run;
}

async function documentExists(chromeApi) {
  const contexts = await chromeApi.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chromeApi.runtime.getURL(OFFSCREEN_OPTIONS.url)],
  });
  return contexts.length > 0;
}

export function ensureOffscreenDocument(chromeApi) {
  return runInOrder(lifetimeFor(chromeApi), async () => {
    if (!(await documentExists(chromeApi))) {
      await chromeApi.offscreen.createDocument(OFFSCREEN_OPTIONS);
    }
  });
}

// Keeps the document open while work runs. The last holder closes it.
export async function holdOffscreenDocument(chromeApi, work) {
  const lifetime = lifetimeFor(chromeApi);
  lifetime.holders += 1;
  try {
    return await work();
  } finally {
    lifetime.holders -= 1;
    if (lifetime.holders === 0) {
      await runInOrder(lifetime, async () => {
        if (lifetime.holders === 0 && (await documentExists(chromeApi))) {
          await chromeApi.offscreen.closeDocument();
        }
      }).catch(() => undefined);
    }
  }
}
