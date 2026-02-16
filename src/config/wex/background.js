// Service Worker (MV3)
// Handles dynamic content script injection for custom self-hosted instances.

async function registerDynamicScripts() {
  // Unregister existing dynamic scripts
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const ids = existing
      .filter(function(s) { return s.id.startsWith('octotree-custom-'); })
      .map(function(s) { return s.id; });
    if (ids.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: ids });
    }
  } catch (e) {
    // Ignore errors during unregistration
  }

  // Read custom instances from chrome.storage.local
  // The key is 'octotree.custom_instances' (stored via chrome.storage.local API)
  let result;
  try {
    result = await chrome.storage.local.get('octotree.custom_instances');
  } catch (e) {
    return;
  }

  const raw = result['octotree.custom_instances'];
  let instances;
  if (Array.isArray(raw)) {
    instances = raw;
  } else if (typeof raw === 'string') {
    try { instances = JSON.parse(raw); } catch (e) { instances = []; }
  } else {
    instances = [];
  }

  // Build content script registrations for each custom instance
  const scripts = instances
    .filter(function(inst) { return inst && inst.url; })
    .map(function(inst, i) {
      try {
        var parsed = new URL(inst.url);
        return {
          id: 'octotree-custom-' + i,
          matches: [parsed.origin + '/*'],
          js: ['content.js'],
          css: ['content.css'],
          runAt: 'document_start'
        };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);

  if (scripts.length > 0) {
    try {
      await chrome.scripting.registerContentScripts(scripts);
    } catch (e) {
      console.error('Failed to register content scripts', e);
    }
  }
}

// Register on extension install/update and browser startup
chrome.runtime.onInstalled.addListener(function() {
  registerDynamicScripts();
});

chrome.runtime.onStartup.addListener(function() {
  registerDynamicScripts();
});

// Re-register when custom instances change in storage
chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'local' && changes['octotree.custom_instances']) {
    registerDynamicScripts();
  }
});
