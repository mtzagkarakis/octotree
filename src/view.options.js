class OptionsView {
  constructor($dom, adapter) {
    this.adapter = adapter;
    this.$toggler = $dom.find('.octotree-settings').click(this.toggle.bind(this));
    this.$view = $dom.find('.octotree-settings-view').submit((event) => {
      event.preventDefault();
      this.toggle(false);
    });

    // Set up token generation links
    this.$view.find('.octotree-create-github-classic-token').attr(
      'href',
      'https://github.com/settings/tokens/new?scopes=repo&description=Code+Tree+browser+extension'
    );
    this.$view.find('.octotree-create-github-finegrained-token').attr(
      'href',
      'https://github.com/settings/personal-access-tokens/new?description=Code+Tree+browser+extension&contents=read&pull_requests=read&metadata=read'
    );
    this.$view.find('.octotree-create-gitlab-token').attr(
      'href',
      'https://gitlab.com/-/user_settings/personal_access_tokens'
    );

    // Custom instances UI
    this.$instanceList = this.$view.find('.octotree-custom-instance-list');
    this.$view.find('.octotree-add-instance').click(() => this._addInstanceRow());

    this.loadElements();

    // Hide options view when sidebar is hidden
    $(document).on(EVENT.TOGGLE, (event, visible) => {
      if (!visible) this.toggle(false);
    });
  }

  /**
   * Load elements with [data-store] attributes & attach enforeShowInRule to the
   * elements in the show in section. Invoke this if there are dynamically added
   * elements, so that they can be loaded and saved.
   */
  loadElements() {
    this.elements = this.$view.find('[data-store]').toArray();
  }

  /**
   * Toggles the visibility of this screen.
   */
  toggle(visibility) {
    if (visibility !== undefined) {
      if (this.$view.hasClass('current') === visibility) return;
      return this.toggle();
    }

    if (this.$toggler.hasClass('selected')) {
      this._save();
      this.$toggler.removeClass('selected');
      $(this).trigger(EVENT.VIEW_CLOSE);
    } else {
      this._load();
    }
  }

  _load() {
    this._eachOption(
      ($elm, key, value, cb) => {
        if ($elm.is(':checkbox')) {
          $elm.prop('checked', value);
        } else if ($elm.is(':radio')) {
          $elm.prop('checked', $elm.val() === value);
        } else {
          $elm.val(value);
        }
        cb();
      },
      () => {
        this._loadCustomInstances();
        this.$toggler.addClass('selected');
        $(this).trigger(EVENT.VIEW_READY);
      }
    );
  }

  _save() {
    const changes = {};
    this._eachOption(
      async ($elm, key, value, cb) => {
        if ($elm.is(':radio') && !$elm.is(':checked')) {
          return cb();
        }
        const newValue = $elm.is(':checkbox') ? $elm.is(':checked') : $elm.val();
        if (value === newValue) return cb();
        changes[key] = [value, newValue];
        await extStore.set(key, newValue);
        cb();
      },
      () => {
        this._saveCustomInstances(changes);
      }
    );
  }

  _eachOption(processFn, completeFn) {
    parallel(
      this.elements,
      async (elm, cb) => {
        const $elm = $(elm);
        const key = STORE[$elm.data('store')];
        const value = await extStore.get(key);

        processFn($elm, key, value, () => cb());
      },
      completeFn
    );
  }

  // Custom instance management
  _addInstanceRow(instance) {
    instance = instance || {};
    const $row = $('<div class="octotree-instance-row"></div>');
    $row.append(
      '<input type="text" class="form-control input-block octotree-inst-url" ' +
      'placeholder="https://gitlab.example.com" value="' + (instance.url || '') + '" />'
    );
    $row.append(
      '<select class="form-control octotree-inst-type">' +
      '<option value="github"' + (instance.type === 'github' ? ' selected' : '') + '>GitHub Enterprise</option>' +
      '<option value="gitlab"' + (instance.type === 'gitlab' ? ' selected' : '') + '>GitLab</option>' +
      '</select>'
    );
    $row.append(
      '<input type="text" class="form-control input-block octotree-inst-token" ' +
      'placeholder="Access token" value="' + (instance.token || '') + '" />'
    );
    const $removeBtn = $('<button type="button" class="btn btn-sm octotree-remove-instance">Remove</button>');
    $removeBtn.click(() => $row.remove());
    $row.append($removeBtn);

    this.$instanceList.append($row);
  }

  async _loadCustomInstances() {
    const instances = await extStore.get(STORE.CUSTOM_INSTANCES) || [];
    this.$instanceList.empty();
    instances.forEach((inst) => this._addInstanceRow(inst));
  }

  async _saveCustomInstances(changes) {
    const instances = [];
    this.$instanceList.find('.octotree-instance-row').each(function() {
      const $row = $(this);
      const url = $row.find('.octotree-inst-url').val().trim();
      const type = $row.find('.octotree-inst-type').val();
      const token = $row.find('.octotree-inst-token').val().trim();
      if (url) instances.push({ url, type, token });
    });

    const oldInstances = await extStore.get(STORE.CUSTOM_INSTANCES) || [];
    const instancesChanged = JSON.stringify(oldInstances) !== JSON.stringify(instances);

    if (instancesChanged) {
      changes[STORE.CUSTOM_INSTANCES] = [oldInstances, instances];
      await extStore.set(STORE.CUSTOM_INSTANCES, instances);
    }

    // Request host permissions for custom instance URLs (MV3)
    const origins = instances.filter(function(i) { return i.url; }).map(function(i) {
      try { return new URL(i.url).origin + '/*'; }
      catch (e) { return null; }
    }).filter(Boolean);

    if (origins.length && chrome.permissions) {
      try {
        chrome.permissions.request({ origins: origins });
      } catch (e) {
        // Permission request may fail if not in user gesture context
      }
    }
  }
}
