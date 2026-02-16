const GL_PJAX_CONTAINER_SEL = '#content-body, [data-page]';
const GL_CONTAINERS = '.container-fluid, .container-limited, .content-wrapper';
const GL_MAX_HUGE_REPOS_SIZE = 50;

class GitLab extends PjaxAdapter {
  constructor() {
    super(GL_PJAX_CONTAINER_SEL);
  }

  // @override
  getCssClass() {
    return 'octotree-gitlab-sidebar';
  }

  // @override
  getCreateTokenUrl() {
    return `${location.protocol}//${location.host}/-/user_settings/personal_access_tokens`;
  }

  // @override
  async shouldLoadEntireTree(repo) {
    const isLoadingMR = await extStore.get(STORE.PR) && repo.pullNumber;
    if (isLoadingMR) return true;

    const isGlobalLazyLoad = await extStore.get(STORE.LAZYLOAD);
    if (isGlobalLazyLoad) return false;

    // Check huge repos cache
    const key = `${repo.username}/${repo.reponame}`;
    const hugeRepos = await extStore.get(STORE.HUGE_REPOS);
    if (hugeRepos[key] && isValidTimeStamp(hugeRepos[key])) {
      hugeRepos[key] = new Date().getTime();
      await extStore.set(STORE.HUGE_REPOS, hugeRepos);
    }
    return !hugeRepos[key];
  }

  // @override
  updateLayout(sidebarPinned, sidebarVisible, sidebarWidth) {
    const SPACING = 20;
    const $containers = $(GL_CONTAINERS);
    const shouldPush = sidebarPinned && sidebarVisible;

    if (shouldPush) {
      $('html').css('margin-left', sidebarWidth);
      $containers.each(function() {
        const $el = $(this);
        const autoMarginLeft = ($(document).width() - $el.width()) / 2;
        const marginLeft = Math.max(SPACING, autoMarginLeft - sidebarWidth);
        const paddingLeft = ($el.innerWidth() - $el.width()) / 2;
        $el.css('margin-left', marginLeft - paddingLeft);
      });
    } else {
      $('html').css('margin-left', '');
      $containers.css('margin-left', '');
    }
  }

  // @override
  async getRepoFromPath(currentRepo, token, cb) {
    if (!await codeTree.shouldShowSidebar()) {
      return cb();
    }

    const pathname = window.location.pathname;

    // GitLab URLs: /group[/subgroup]/project[/-/type[/ref[/path]]]
    // Split on /-/ to separate project path from route
    const parts = pathname.replace(/^\//, '').split('/-/');
    const projectPath = parts[0]; // e.g. "group/subgroup/project"
    const route = parts[1] || ''; // e.g. "tree/main/src/file.js"

    const segments = projectPath.split('/').filter(Boolean);
    if (segments.length < 2) return cb();

    // Check reserved names
    if (~GL_RESERVED_USER_NAMES.indexOf(segments[0])) return cb();

    // Username = everything except last segment, reponame = last segment
    const username = segments.slice(0, -1).join('/');
    const reponame = segments[segments.length - 1];

    // Parse route type and ref
    const routeMatch = route.match(/^(tree|blob|merge_requests|commits?)(?:\/(.+))?$/);
    const type = routeMatch ? routeMatch[1] : null;
    const routeRest = routeMatch ? (routeMatch[2] || '') : '';

    const isMR = type === 'merge_requests';
    const mrNumber = isMR ? (routeRest.match(/^(\d+)/) || [])[1] : null;

    // Branch detection
    let branch = null;

    if (type === 'tree' || type === 'blob') {
      // Try DOM first for branch name
      branch = this._getBranchFromDOM();

      // If not found, the rest of the URL after type/ is branch/path
      // but branch can contain slashes, so we need API to resolve
      if (!branch && routeRest) {
        branch = await this._resolveBranch(projectPath, routeRest, token);
      }
    } else if (type === 'commits' || type === 'commit') {
      branch = routeRest.split('/')[0] || null;
    } else if (isMR && mrNumber) {
      // For MR pages, get target branch from API
      branch = await this._getMRTargetBranch(projectPath, mrNumber, token);
    }

    // Fallback: reuse current or get default
    if (!branch) {
      if (currentRepo && currentRepo.username === username && currentRepo.reponame === reponame && currentRepo.branch) {
        branch = currentRepo.branch;
      } else if (this._defaultBranch[projectPath]) {
        branch = this._defaultBranch[projectPath];
      } else {
        branch = await this._getDefaultBranch(projectPath, token);
      }
    }

    const showOnlyChangedInMR = await extStore.get(STORE.PR);
    const pullNumber = isMR && showOnlyChangedInMR ? mrNumber : null;

    const repo = {
      username,
      reponame,
      branch,
      pullNumber,
      displayBranch: null,
      projectPath  // GitLab-specific: full path for API calls
    };

    cb(null, repo);
  }

  get isOnPRPage() {
    return window.location.pathname.includes('/-/merge_requests/');
  }

  // @override
  loadCodeTree(opts, cb) {
    opts.encodedBranch = encodeURIComponent(decodeURIComponent(opts.repo.branch));
    opts.path = opts.encodedBranch;
    this._loadCodeTreeInternal(opts, null, cb);
  }

  // @override
  _getTree(path, opts, cb) {
    if (opts.repo.pullNumber) {
      this._getMRPatch(opts, cb);
    } else {
      const params = `?ref=${opts.encodedBranch}&per_page=100&recursive=true`;

      if (opts.node && opts.node.path) {
        // Lazy load subtree
        const encodedPath = encodeURIComponent(opts.node.path);
        this._get(`/repository/tree${params}&path=${encodedPath}`, opts, (err, res) => {
          if (err) return cb(err);
          cb(null, this._transformTree(res));
        });
      } else {
        this._getAllPages(`/repository/tree${params}`, opts, (err, allItems) => {
          if (err) return cb(err);
          cb(null, this._transformTree(allItems));
        });
      }
    }
  }

  // @override
  _getSubmodules(tree, opts, cb) {
    const item = tree.filter((i) => /^\.gitmodules$/i.test(i.path))[0];
    if (!item) return cb();

    this._get(`/repository/blobs/${item.sha}/raw`, opts, (err, data) => {
      if (err) return cb(err);
      cb(null, parseGitmodules(typeof data === 'string' ? data : ''));
    });
  }

  // @override
  _getItemHref(repo, type, encodedPath, encodedBranch) {
    return `/${repo.username}/${repo.reponame}/-/${type}/${encodedBranch}/${encodedPath}`;
  }

  // @override
  _getPatchHref(repo, patch) {
    return `/${repo.username}/${repo.reponame}/-/merge_requests/${repo.pullNumber}/diffs#diff-content-${patch.diffId}`;
  }

  // Transform GitLab tree response to common format
  _transformTree(items) {
    return items.map((item) => ({
      path: item.path,
      type: item.type === 'tree' ? 'tree' : item.type === 'blob' ? 'blob' : 'commit',
      sha: item.id,
      url: ''
    }));
  }

  // Get MR changed files
  _getMRPatch(opts, cb) {
    this._get(`/merge_requests/${opts.repo.pullNumber}/changes`, opts, (err, res) => {
      if (err) return cb(err);

      const changes = res.changes || [];
      const diffMap = {};

      changes.forEach((file, index) => {
        const action = file.new_file ? 'added'
          : file.deleted_file ? 'removed'
          : file.renamed_file ? 'renamed'
          : 'modified';

        const additions = (file.diff || '').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
        const deletions = (file.diff || '').split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length;

        diffMap[file.new_path] = {
          type: 'blob',
          diffId: index,
          action,
          additions,
          deletions,
          filename: file.new_path,
          sha: file.blob_id || '',
          previous: file.renamed_file ? file.old_path : undefined
        };

        // Ancestor folders
        const folderPath = file.new_path.split('/').slice(0, -1).join('/');
        const split = folderPath.split('/');

        split.reduce((path, curr) => {
          if (path.length) path = `${path}/${curr}`;
          else path = `${curr}`;

          if (!diffMap[path]) {
            diffMap[path] = {
              type: 'tree',
              filename: path,
              filesChanged: 1,
              additions,
              deletions
            };
          } else {
            diffMap[path].additions += additions;
            diffMap[path].deletions += deletions;
            diffMap[path].filesChanged++;
          }
          return path;
        }, '');
      });

      const tree = Object.keys(diffMap).map((fileName) => {
        const patch = diffMap[fileName];
        return {
          patch,
          path: fileName,
          sha: patch.sha,
          type: patch.type,
          url: ''
        };
      });

      tree.sort((a, b) => a.path.localeCompare(b.path));
      cb(null, tree);
    });
  }

  // GitLab API wrapper
  _get(path, opts, cb) {
    const host = `${location.protocol}//${location.host}/api/v4`;
    const projectId = encodeURIComponent(
      opts.repo.projectPath || `${opts.repo.username}/${opts.repo.reponame}`
    );
    const url = path && path.startsWith('http') ? path : `${host}/projects/${projectId}${path}`;

    const cfg = { url, method: 'GET', cache: false };
    if (opts.token) {
      cfg.headers = { 'PRIVATE-TOKEN': opts.token };
    }

    $.ajax(cfg)
      .done((data, textStatus, jqXHR) => cb(null, data, jqXHR))
      .fail((jqXHR) => this._handleError(cfg, jqXHR, cb));
  }

  // Paginated API fetch using GitLab's x-next-page header
  _getAllPages(path, opts, cb, accumulated) {
    accumulated = accumulated || [];
    const host = `${location.protocol}//${location.host}/api/v4`;
    const projectId = encodeURIComponent(
      opts.repo.projectPath || `${opts.repo.username}/${opts.repo.reponame}`
    );
    const url = path && path.startsWith('http') ? path : `${host}/projects/${projectId}${path}`;

    const cfg = { url, method: 'GET', cache: false };
    if (opts.token) {
      cfg.headers = { 'PRIVATE-TOKEN': opts.token };
    }

    $.ajax(cfg)
      .done((data, textStatus, jqXHR) => {
        accumulated = accumulated.concat(data);
        const nextPage = jqXHR.getResponseHeader('x-next-page');
        if (nextPage && nextPage.trim() !== '') {
          // Build next URL with page parameter
          let nextPath = path;
          if (nextPath.includes('page=')) {
            nextPath = nextPath.replace(/page=\d+/, `page=${nextPage}`);
          } else {
            nextPath += (nextPath.includes('?') ? '&' : '?') + `page=${nextPage}`;
          }
          this._getAllPages(nextPath, opts, cb, accumulated);
        } else {
          cb(null, accumulated);
        }
      })
      .fail((jqXHR) => this._handleError(cfg, jqXHR, cb));
  }

  // Branch detection helpers

  _getBranchFromDOM() {
    // Try various GitLab DOM selectors for the branch name
    const selectors = [
      '.ref-selector .gl-button-text',
      '[data-testid="branches-select"] button',
      '.dropdown-toggle-text',
      '.ref-name',
      '[data-ref]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.getAttribute('data-ref') || el.textContent.trim();
        if (text && text !== 'master' && text !== 'main') return text;
        if (text) return text;
      }
    }

    return null;
  }

  async _resolveBranch(projectPath, routeRest, token) {
    // routeRest looks like "branch/name/with/slashes/file/path"
    // We need to figure out where the branch name ends and file path begins.
    // Strategy: try progressively longer prefixes against the API.
    // But for efficiency, first try the DOM, then try common single-segment branches.

    const domBranch = this._getBranchFromDOM();
    if (domBranch) return domBranch;

    // Try the first segment (most common case: main, master, develop, etc.)
    const firstSlash = routeRest.indexOf('/');
    if (firstSlash === -1) return routeRest; // No slash, entire thing is the branch

    const firstSegment = routeRest.substring(0, firstSlash);

    // Verify via API
    const projectId = encodeURIComponent(projectPath);
    return new Promise((resolve) => {
      const url = `${location.protocol}//${location.host}/api/v4/projects/${projectId}/repository/branches/${encodeURIComponent(firstSegment)}`;
      const cfg = { url, method: 'GET', cache: false };
      if (token) cfg.headers = { 'PRIVATE-TOKEN': token };

      $.ajax(cfg)
        .done(() => resolve(firstSegment))
        .fail(() => {
          // First segment isn't a branch, just return the whole thing and let it fail gracefully
          resolve(routeRest.split('/')[0]);
        });
    });
  }

  async _getDefaultBranch(projectPath, token) {
    const projectId = encodeURIComponent(projectPath);
    return new Promise((resolve) => {
      const opts = { repo: { projectPath }, token };
      this._get('', opts, (err, data) => {
        if (err) return resolve('main');
        const branch = data.default_branch || 'main';
        this._defaultBranch[projectPath] = branch;
        resolve(branch);
      });
    });
  }

  async _getMRTargetBranch(projectPath, mrNumber, token) {
    const projectId = encodeURIComponent(projectPath);
    return new Promise((resolve) => {
      const opts = { repo: { projectPath }, token };
      this._get(`/merge_requests/${mrNumber}`, opts, (err, data) => {
        if (err) return resolve(null);
        resolve(data.target_branch || null);
      });
    });
  }
}
