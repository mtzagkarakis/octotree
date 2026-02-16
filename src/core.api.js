const GH_RESERVED_USER_NAMES = [
  'about',
  'account',
  'blog',
  'business',
  'contact',
  'dashboard',
  'developer',
  'explore',
  'features',
  'gist',
  'integrations',
  'issues',
  'join',
  'login',
  'marketplace',
  'mirrors',
  'new',
  'notifications',
  'open-source',
  'organizations',
  'orgs',
  'personal',
  'pricing',
  'pulls',
  'search',
  'security',
  'sessions',
  'settings',
  'showcases',
  'site',
  'sponsors',
  'stars',
  'styleguide',
  'topics',
  'trending',
  'watching',
];
const GH_RESERVED_REPO_NAMES = ['followers', 'following', 'repositories'];
const GH_404_SEL = '#parallax_wrapper';
const GH_RAW_CONTENT = 'body > pre';

const GL_RESERVED_USER_NAMES = [
  'admin', 'dashboard', 'explore', 'groups', 'help',
  'projects', 'search', 'snippets', 'users', '-'
];

class CodeTreeService {
  constructor() {
    this.reset();
    this._migrated = false;
  }

  // Hooks
  activate(inputs, opts) {}

  applyOptions(opts) {
    return false;
  }

  // Public
  load(loadFn) {
    loadFn();
  }

  reset() {
    this.getAccessToken = this._getAccessToken;
    this.shouldShowSidebar = this._shouldShowSidebar;
    this.getInvalidTokenMessage = this._getInvalidTokenMessage;
    this.setNodeIconAndText = this._setNodeIconAndText;
  }

  // Private
  async _getAccessToken() {
    // One-time migration: old TOKEN → GITHUB_TOKEN
    if (!this._migrated) {
      this._migrated = true;
      const oldToken = await window.extStore.get(window.STORE.TOKEN);
      const newGHToken = await window.extStore.get(window.STORE.GITHUB_TOKEN);
      if (oldToken && !newGHToken) {
        await window.extStore.set(window.STORE.GITHUB_TOKEN, oldToken);
      }
    }

    const host = window.location.hostname;

    // Check custom instances first
    const instances = await window.extStore.get(window.STORE.CUSTOM_INSTANCES) || [];
    const custom = instances.find(function(inst) {
      try { return new URL(inst.url).hostname === host; }
      catch (e) { return false; }
    });
    if (custom && custom.token) return custom.token;

    // Built-in instances
    if (host === 'github.com') {
      return (await window.extStore.get(window.STORE.GITHUB_TOKEN)) ||
             (await window.extStore.get(window.STORE.TOKEN));  // Legacy fallback
    }
    if (host === 'gitlab.com') {
      return await window.extStore.get(window.STORE.GITLAB_TOKEN);
    }

    // GitHub Enterprise or unknown -- try legacy token
    return await window.extStore.get(window.STORE.TOKEN);
  }

  _getInvalidTokenMessage({responseStatus, requestHeaders}) {
    return (
      'The access token is invalid. ' +
      'Please go to <a class="settings-btn">Settings</a> and update the token.'
    );
  }

  async _setNodeIconAndText(context, item) {
    if (item.type === 'blob') {
      if (await extStore.get(STORE.ICONS)) {
        const className = FileIcons.getClassWithColor(item.text);
        item.icon += ' ' + (className || 'file-generic');
      } else {
        item.icon += ' file-generic';
      }
    }
  }

  async _shouldShowSidebar() {
    // GitLab detection
    const isGitLab = document.querySelector('meta[content="GitLab"]');
    if (isGitLab) {
      const segments = window.location.pathname.split('/').filter(Boolean);
      if (segments.length < 2) return false;
      if (~GL_RESERVED_USER_NAMES.indexOf(segments[0])) return false;
      return true;
    }

    // GitHub detection (default)
    if ($(GH_404_SEL).length) {
      return false;
    }

    // Skip raw page
    if ($(GH_RAW_CONTENT).length) {
      return false;
    }

    // (username)/(reponame)[/(type)][/(typeId)]
    const match = window.location.pathname.match(/([^\/]+)\/([^\/]+)(?:\/([^\/]+))?(?:\/([^\/]+))?/);
    if (!match) {
      return false;
    }

    const username = match[1];
    const reponame = match[2];

    // Not a repository, skip
    if (~GH_RESERVED_USER_NAMES.indexOf(username) || ~GH_RESERVED_REPO_NAMES.indexOf(reponame)) {
      return false;
    }

    return true;
  }
}

window.codeTree = new CodeTreeService();
