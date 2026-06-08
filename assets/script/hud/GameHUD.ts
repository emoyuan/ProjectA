import { _decorator, Component, Node, Button, Label, director, isValid } from 'cc';
import { GameManager } from '../level/GameManager';
const { ccclass, property } = _decorator;

/**
 * GameHUD - 游戏内 HUD 界面
 * 显示关卡信息、暂停按钮、暂停菜单
 */
@ccclass('GameHUD')
export class GameHUD extends Component {

    @property({ type: Node, tooltip: '关卡名称标签' })
    levelNameLabel: Node = null!;

    @property({ type: Node, tooltip: '暂停按钮' })
    pauseButton: Node = null!;

    @property({ type: Node, tooltip: '暂停面板（默认隐藏）' })
    pausePanel: Node = null!;

    @property({ type: Node, tooltip: '继续游戏按钮' })
    resumeButton: Node = null!;

    @property({ type: Node, tooltip: '重新开始按钮' })
    restartButton: Node = null!;

    @property({ type: Node, tooltip: '返回主菜单按钮' })
    mainMenuButton: Node = null!;

    private isPaused: boolean = false;

    onLoad() {
        // 显示关卡名称
        this.updateLevelName();

        // 绑定按钮事件
        if (this.pauseButton) {
            this.pauseButton.on(Button.EventType.CLICK, this.onPause, this);
        }
        if (this.resumeButton) {
            this.resumeButton.on(Button.EventType.CLICK, this.onResume, this);
        }
        if (this.restartButton) {
            this.restartButton.on(Button.EventType.CLICK, this.onRestart, this);
        }
        if (this.mainMenuButton) {
            this.mainMenuButton.on(Button.EventType.CLICK, this.onMainMenu, this);
        }

        // 初始隐藏暂停面板
        if (this.pausePanel) {
            this.pausePanel.active = false;
        }
    }

    onDestroy() {
        if (this.pauseButton && isValid(this.pauseButton)) {
            this.pauseButton.off(Button.EventType.CLICK, this.onPause, this);
        }
        if (this.resumeButton && isValid(this.resumeButton)) {
            this.resumeButton.off(Button.EventType.CLICK, this.onResume, this);
        }
        if (this.restartButton && isValid(this.restartButton)) {
            this.restartButton.off(Button.EventType.CLICK, this.onRestart, this);
        }
        if (this.mainMenuButton && isValid(this.mainMenuButton)) {
            this.mainMenuButton.off(Button.EventType.CLICK, this.onMainMenu, this);
        }
    }

    private updateLevelName() {
        const gm = GameManager.instance;
        if (gm && this.levelNameLabel) {
            const label = this.levelNameLabel.getComponent(Label);
            if (label && gm.currentLevel < gm.levels.length) {
                label.string = gm.levels[gm.currentLevel].name;
            }
        }
    }

    private onPause() {
        this.isPaused = true;
        if (this.pausePanel) {
            this.pausePanel.active = true;
        }
        director.pause();
    }

    private onResume() {
        this.isPaused = false;
        if (this.pausePanel) {
            this.pausePanel.active = false;
        }
        director.resume();
    }

    private onRestart() {
        director.resume(); // 先恢复，否则 loadScene 可能不工作
        const gm = GameManager.instance;
        if (gm) {
            gm.restartLevel();
        }
    }

    private onMainMenu() {
        director.resume();
        const gm = GameManager.instance;
        if (gm) {
            gm.goToMainMenu();
        }
    }
}