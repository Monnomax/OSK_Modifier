import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Keyboard } from "resource:///org/gnome/shell/ui/keyboard.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";

const ORIG_KEYBOARD_INIT = Keyboard.prototype._init;

export default class OskModifierExtension {
    constructor(metadata) {
        this._uuid = metadata.uuid;
        this._modifiedKeyboards = new Map();
        this._virtualKeyboard = null;
    }

    enable() {
        const self = this;

        // Ініціалізуємо віртуальний пристрій введення для Wayland
        const seat = Clutter.get_default_backend().get_default_seat();
        this._virtualKeyboard = seat.create_virtual_device(
            Clutter.InputDeviceType.KEYBOARD_DEVICE,
        );

        // Перехоплюємо створення клавіатури
        Keyboard.prototype._init = function (params) {
            ORIG_KEYBOARD_INIT.call(this, params);
            self._injectCustomBlocks(this);
        };

        // Якщо клавіатура вже існує в пам'яті
        if (Main.keyboard && Main.keyboard._keyboard) {
            this._injectCustomBlocks(Main.keyboard._keyboard);
        }
    }

    disable() {
        Keyboard.prototype._init = ORIG_KEYBOARD_INIT;

        // Відновлюємо оригінальну структуру для всіх модифікованих клавіатур
        for (const [keyboardInstance, containers] of this._modifiedKeyboards.entries()) {
            try {
                const { leftZone, mainKeysBox, rightZone } = containers;

                // 1. Видаляємо всі три наші зони
                if (keyboardInstance.contains(leftZone)) {
                    keyboardInstance.remove_child(leftZone);
                }
                if (keyboardInstance.contains(mainKeysBox)) {
                    keyboardInstance.remove_child(mainKeysBox);
                }
                if (keyboardInstance.contains(rightZone)) {
                    keyboardInstance.remove_child(rightZone);
                }

                // 2. Повертаємо оригінальні рядки клавіш назад у головний віджет
                const originalChildren = [...mainKeysBox.get_children()];
                for (let child of originalChildren) {
                    mainKeysBox.remove_child(child);
                    keyboardInstance.add_child(child);
                }

                // 3. Відновлюємо вертикальну орієнтацію клавіатури (використовуючи актуальний синтаксис)
                if ('orientation' in keyboardInstance) {
                    keyboardInstance.orientation = Clutter.Orientation.VERTICAL;
                } else {
                    keyboardInstance.vertical = true;
                }

                // 4. Очищуємо пам'ять
                leftZone.destroy();
                mainKeysBox.destroy();
                rightZone.destroy();
            } catch (e) {
                console.error(`[${this._uuid}] Помилка очищення: ${e.message}`);
            }
        }
        this._modifiedKeyboards.clear();

        if (this._virtualKeyboard) {
            this._virtualKeyboard = null;
        }
    }

    _injectCustomBlocks(keyboardInstance) {
        if (this._modifiedKeyboards.has(keyboardInstance)) return;

        // Змінюємо орієнтацію самої клавіатури на горизонтальну
        if ('orientation' in keyboardInstance) {
            keyboardInstance.orientation = Clutter.Orientation.HORIZONTAL;
        } else {
            keyboardInstance.vertical = false;
        }

        // 1. ЛІВА ЗОНА (Блок спецсимволів)
        const leftZone = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.FILL,
        });
        
        const specialCharsLayout = [
            ['"', '(', ')'],
            ["'", '!', '?'],
            ['-', '_', '/'],
            ['+', ':', ';']
        ];
        leftZone.add_child(this._buildExtraBlockUI(specialCharsLayout));

        // 2. ЦЕНТРАЛЬНА ЗОНА (Стандартна клавіатура)
        const mainKeysBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL, // Замінено vertical: true
            x_expand: false, 
            y_expand: true,
        });

        const children = [...keyboardInstance.get_children()];
        for (let child of children) {
            keyboardInstance.remove_child(child);
            mainKeysBox.add_child(child);
        }

        // 3. ПРАВА ЗОНА (Цифровий блок)
        const rightZone = new St.BoxLayout({
            x_expand: true, 
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER, 
            y_align: Clutter.ActorAlign.FILL,
        });
        
        const numpadLayout = [
            ['7', '8', '9'],
            ['4', '5', '6'],
            ['1', '2', '3'],
            ['0']
        ];
        rightZone.add_child(this._buildExtraBlockUI(numpadLayout));

        // Додаємо всі три зони по порядку
        keyboardInstance.add_child(leftZone);
        keyboardInstance.add_child(mainKeysBox);
        keyboardInstance.add_child(rightZone);

        // Зберігаємо посилання для відновлення
        this._modifiedKeyboards.set(keyboardInstance, { leftZone, mainKeysBox, rightZone });
    }

    // Універсальний метод для побудови будь-якої розкладки
    _buildExtraBlockUI(layoutMatrix) {
        const blockContainer = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL, // Замінено vertical: true
            // Комбінуємо системний клас та наш кастомний клас з stylesheet.css
            style_class: 'keyboard-layout custom-osk-layout',
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            x_expand: false, 
        });

        for (let rowKeys of layoutMatrix) {
            const rowBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL, // Замінено vertical: false
                // Комбінуємо системний клас та наш кастомний клас
                style_class: 'key-container custom-osk-container',
                x_expand: true,
                y_expand: true,
            });

            for (let keyChar of rowKeys) {
                const btn = new St.Button({
                    label: keyChar,
                    // Системний 'keyboard-key' дає дизайн, 'custom-osk-key' дає min-width
                    style_class: 'keyboard-key custom-osk-key',
                    can_focus: true,
                    x_expand: true, 
                    y_expand: true,
                    x_align: Clutter.ActorAlign.FILL, 
                    y_align: Clutter.ActorAlign.FILL, 
                });

                btn.connect('clicked', () => {
                    this._emitVirtualKeyPress(keyChar);
                });

                rowBox.add_child(btn);
            }
            blockContainer.add_child(rowBox);
        }

        return blockContainer;
    }

    _emitVirtualKeyPress(keyChar) {
        if (!this._virtualKeyboard) return;

        // Розширений маппінг символів на системні коди Clutter
        const keymap = {
            '0': Clutter.KEY_0,
            '1': Clutter.KEY_1,
            '2': Clutter.KEY_2,
            '3': Clutter.KEY_3,
            '4': Clutter.KEY_4,
            '5': Clutter.KEY_5,
            '6': Clutter.KEY_6,
            '7': Clutter.KEY_7,
            '8': Clutter.KEY_8,
            '9': Clutter.KEY_9,
            '"': Clutter.KEY_quotedbl,
            '(': Clutter.KEY_parenleft,
            ')': Clutter.KEY_parenright,
            "'": Clutter.KEY_apostrophe,
            '!': Clutter.KEY_exclam,
            '?': Clutter.KEY_question,
            '-': Clutter.KEY_minus,
            '_': Clutter.KEY_underscore,
            '/': Clutter.KEY_slash,
            '+': Clutter.KEY_plus,
            ':': Clutter.KEY_colon,
            ';': Clutter.KEY_semicolon
        };

        const keyval = keymap[keyChar];
        if (!keyval) {
            console.warn(`[${this._uuid}] Ключ для символу "${keyChar}" не знайдено.`);
            return;
        }

        // Для Wayland час має бути переданий у мікросекундах
        const timeUs = GLib.get_monotonic_time();

        // Імітуємо повний цикл: натискання і відпускання клавіші
        this._virtualKeyboard.notify_keyval(
            timeUs,
            keyval,
            Clutter.KeyState.PRESSED,
        );
        this._virtualKeyboard.notify_keyval(
            timeUs,
            keyval,
            Clutter.KeyState.RELEASED,
        );
    }
}