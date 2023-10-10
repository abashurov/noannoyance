import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class NoAnnoyance extends Extension {
    #ignoreListEnabled = false;
    #ignoreList = [];

    #oldHandler = null;
    #settings;

    constructor(...args) {
        super(...args);

        this.#ignoreList = [];
        this.#settings = this.getSettings();
        this.#settings.connectObject(
            'changed',
            this.updateList.bind(this),
            this,
        );
    }

    updateList = () => {
        this.#ignoreListEnabled =
            this.#settings.get_boolean('enable-ignorelist');
        this.#ignoreList = this.#settings.get_strv('ignored-list');
    };

    onWindowDemandsAttention = (_, window) => {
        if (!window || window.has_focus() || window.is_skip_taskbar()) {
            return;
        }

        if (
            this.#ignoreListEnabled &&
            this.#ignoreList.includes(window.get_application()?.id)
        ) {
            return;
        }

        Main.activateWindow(window);
    };

    enable = () => {
        this.#oldHandler = Main.windowAttentionHandler;
        global.display.disconnectObject(this.#oldHandler);
        global.display.connectObject(
            'window-demands-attention',
            this.onWindowDemandsAttention.bind(this),
            'window-marked-urgent',
            this.onWindowDemandsAttention.bind(this),
            this,
        );
    };

    disable = () => {
        global.display.disconnectObject(this);
        global.display.connectObject(
            'window-demands-attention',
            this.#oldHandler._onWindowDemandsAttention.bind(this.#oldHandler),
            'window-marked-urgent',
            this.#oldHandler._onWindowDemandsAttention.bind(this.#oldHandler),
            this.#oldHandler,
        );

        this.#oldHandler = null;
    };
}
