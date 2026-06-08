import { _decorator, Component, Node, Button, Label, Sprite, Color, UITransform, Size, Vec3, isValid } from 'cc';
import { GameManager } from '../level/GameManager';
const { ccclass, property } = _decorator;

/**
 * MainMenuUI - 主菜单界面
 * 包含背景图、游戏标题 "RockPro"、开始游戏和设置按钮
 */
@ccclass('MainMenuUI')
export class MainMenuUI extends Component {

    @property({ type: Node, tooltip: '背景图节点' })
    backgroundNode: Node = null!;

    @property({ type: Node, tooltip: '标题文字节点' })
    titleLabel: Node = null!;

    @property({ type: Node, tooltip: '开始游戏按钮' })
    startButton: Node = null!;

    @property({ type: Node, tooltip: '设置按钮' })
    settingsButton: Node = null!;

    @property({ type: Node, tooltip: '设置面板（默认隐藏）' })
    settingsPanel: Node = null!;

    @property({ type: Node, tooltip: '音效开关按钮' })
    soundToggleBtn: Node = null!;

    @property({ type: Node, tooltip: '音效开关标签' })
    soundToggleLabel: Node = null!;

    @property({ type: Node, tooltip: '关闭设置按钮' })
    closeSettingsBtn: Node = null!;

    private soundEnabled: boolean = true;

    onLoad() {
        // 绑定按钮事件
        if (this.startButton) {
            this.startButton.on(Button.EventType.CLICK, this.onStartGame, this);
        }
        if (this.settingsButton) {
            this.settingsButton.on(Button.EventType.CLICK, this.onOpenSettings, this);
        }
        if (this.closeSettingsBtn) {
            this.closeSettingsBtn.on(Button.EventType.CLICK, this.onCloseSettings, this);
        }
        if (this.soundToggleBtn) {
            this.soundToggleBtn.on(Button.EventType.CLICK, this.onToggleSound, this);
        }

        // 初始隐藏设置面板
        if (this.settingsPanel) {
            this.settingsPanel.active = false;
        }

        this.updateSoundLabel();
    }

    onDestroy() {
        if (this.startButton && isValid(this.startButton)) {
            this.startButton.off(Button.EventType.CLICK, this.onStartGame, this);
        }
        if (this.settingsButton && isValid(this.settingsButton)) {
            this.settingsButton.off(Button.EventType.CLICK, this.onOpenSettings, this);
        }
        if (this.closeSettingsBtn && isValid(this.closeSettingsBtn)) {
            this.closeSettingsBtn.off(Button.EventType.CLICK, this.onCloseSettings, this);
        }
        if (this.soundToggleBtn && isValid(this.soundToggleBtn)) {
            this.soundToggleBtn.off(Button.EventType.CLICK, this.onToggleSound, this);
        }
    }

    private onStartGame() {
        const gm = GameManager.instance;
        if (gm) {
            gm.goToLevelSelect();
        }
    }

    private onOpenSettings() {
        if (this.settingsPanel) {
            this.settingsPanel.active = true;
        }
    }

    private onCloseSettings() {
        if (this.settingsPanel) {
            this.settingsPanel.active = false;
        }
    }

    private onToggleSound() {
        this.soundEnabled = !this.soundEnabled;
        this.updateSoundLabel();
    }

    private updateSoundLabel() {
        if (this.soundToggleLabel) {
            const label = this.soundToggleLabel.getComponent(Label);
            if (label) {
                label.string = this.soundEnabled ? '音效：开' : '音效：关';
            }
        }
    }
}