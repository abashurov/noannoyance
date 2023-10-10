// SPDX-FileCopyrightText: 2012 Giovanni Campagna <gcampagna@src.gnome.org>
// SPDX-FileCopyrightText: 2014 Florian Müllner <fmuellner@gnome.org>
//
// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Mostly, a copy of the following:
// https://gitlab.gnome.org/GNOME/gnome-shell-extensions/-/blob/main/extensions/auto-move-windows/prefs.js

const IGNORELIST_APPS = 'ignored-apps';
const IGNORELIST_ENABLED = 'enable-ignorelist';

class NewItem extends GObject.Object {}
GObject.registerClass(NewItem);

class NewItemModel extends GObject.Object {
    static [GObject.interfaces] = [Gio.ListModel];
    static {
        GObject.registerClass(this);
    }

    #item = new NewItem();

    vfunc_get_item_type() {
        return NewItem;
    }

    vfunc_get_n_items() {
        return 1;
    }

    vfunc_get_item(_pos) {
        return this.#item;
    }
}

class Rule extends GObject.Object {
    static [GObject.properties] = {
        'app-info': GObject.ParamSpec.object(
            'app-info',
            'app-info',
            'app-info',
            GObject.ParamFlags.READWRITE,
            Gio.DesktopAppInfo,
        ),
    };

    static {
        GObject.registerClass(this);
    }
}

class RulesList extends GObject.Object {
    static [GObject.interfaces] = [Gio.ListModel];
    static {
        GObject.registerClass(this);
    }

    #settings;
    #rules = [];
    #changedId;

    constructor(settings) {
        super();

        this.#settings = settings;
        this.#changedId = this.#settings.connect(
            `changed::${IGNORELIST_APPS}`,
            () => this.#sync(),
        );
        this.#sync();
    }

    append(appInfo) {
        const pos = this.#rules.length;

        this.#rules.push(new Rule({ appInfo }));
        this.#saveRules();

        this.items_changed(pos, 0, 1);
    }

    remove(id) {
        const pos = this.#rules.findIndex((r) => r.appInfo.get_id() === id);
        if (pos < 0) {
            return;
        }

        this.#rules.splice(pos, 1);
        this.#saveRules();

        this.items_changed(pos, 1, 0);
    }

    #saveRules() {
        this.#settings.block_signal_handler(this.#changedId);
        this.#settings.set_strv(
            IGNORELIST_APPS,
            this.#rules.map((r) => `${r.app_info.get_id()}`),
        );
        this.#settings.unblock_signal_handler(this.#changedId);
    }

    #sync() {
        const removed = this.#rules.length;

        this.#rules = [];
        for (const id of this.#settings.get_strv(IGNORELIST_APPS)) {
            const appInfo = Gio.DesktopAppInfo.new(id);
            if (appInfo) {
                this.#rules.push(new Rule({ appInfo }));
            } else {
                log(`Invalid ID ${id}`);
            }
        }
        this.items_changed(0, removed, this.#rules.length);
    }

    vfunc_get_item_type() {
        return Rule;
    }

    vfunc_get_n_items() {
        return this.#rules.length;
    }

    vfunc_get_item(pos) {
        return this.#rules[pos] ?? null;
    }
}

class NoAnnoyanceSettingsWidget extends Adw.PreferencesGroup {
    static {
        GObject.registerClass(this);

        this.install_action('rules.add', null, (self) => self._addNewRule());
        this.install_action('rules.remove', 's', (self, name, param) =>
            self._rules.remove(param.unpack()),
        );
    }

    constructor(settings) {
        super({
            title: 'Workspace Rules',
        });

        this._settings = settings;
        this._rules = new RulesList(this._settings);

        const store = new Gio.ListStore({ item_type: Gio.ListModel });
        const listModel = new Gtk.FlattenListModel({ model: store });
        store.append(this._rules);
        store.append(new NewItemModel());

        const row = new Adw.SwitchRow({
            title: 'Enable Ignorelist',
            subtitle: 'Whether to exclude some windows based on WM__CLASS',
        });
        this.add(row);

        // Create a settings object and bind the row to the `show-indicator` key
        this._settings.bind(
            IGNORELIST_ENABLED,
            row,
            'active',
            Gio.SettingsBindFlags.DEFAULT,
        );

        this._list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        this.add(this._list);

        this._list.bind_model(listModel, (item) => {
            return item instanceof NewItem
                ? new NewRuleRow()
                : new RuleRow(item);
        });
    }

    _addNewRule() {
        const dialog = new NewRuleDialog(this.get_root(), this._settings);
        dialog.connect('response', (dlg, id) => {
            const appInfo =
                id === Gtk.ResponseType.OK
                    ? dialog.get_widget().get_app_info()
                    : null;
            if (appInfo) {
                this._rules.append(appInfo);
            }
            dialog.destroy();
        });
        dialog.show();
    }
}

class RuleRow extends Adw.ActionRow {
    static {
        GObject.registerClass(this);
    }

    constructor(rule) {
        const { appInfo } = rule;
        const id = appInfo.get_id();

        super({
            activatable: false,
            title: rule.appInfo.get_display_name(),
        });

        const icon = new Gtk.Image({
            css_classes: ['icon-dropshadow'],
            gicon: appInfo.get_icon(),
            pixel_size: 32,
        });
        this.add_prefix(icon);

        const button = new Gtk.Button({
            action_name: 'rules.remove',
            action_target: new GLib.Variant('s', id),
            icon_name: 'edit-delete-symbolic',
            has_frame: false,
            valign: Gtk.Align.CENTER,
        });
        this.add_suffix(button);
    }
}

class NewRuleRow extends Gtk.ListBoxRow {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            action_name: 'rules.add',
            child: new Gtk.Image({
                icon_name: 'list-add-symbolic',
                pixel_size: 16,
                margin_top: 12,
                margin_bottom: 12,
                margin_start: 12,
                margin_end: 12,
            }),
        });

        this.update_property([Gtk.AccessibleProperty.LABEL], ['Add Rule']);
    }
}

class NewRuleDialog extends Gtk.AppChooserDialog {
    static {
        GObject.registerClass(this);
    }

    constructor(parent, settings) {
        super({
            transient_for: parent,
            modal: true,
        });

        this._settings = settings;

        this.get_widget().set({
            show_all: true,
            show_other: true, // hide more button
        });

        this.get_widget().connect(
            'application-selected',
            this._updateSensitivity.bind(this),
        );

        this._updateSensitivity();
    }

    _updateSensitivity() {
        const rules = this._settings.get_strv(IGNORELIST_APPS);
        const appInfo = this.get_widget().get_app_info();
        this.set_response_sensitive(
            Gtk.ResponseType.OK,
            appInfo && !rules.some((i) => i.startsWith(appInfo.get_id())),
        );
    }
}

export default class NoAnnoyancePrefs extends ExtensionPreferences {
    getPreferencesWidget() {
        return new NoAnnoyanceSettingsWidget(this.getSettings());
    }
}
