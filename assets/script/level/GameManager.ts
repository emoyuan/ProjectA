import { _decorator, Component, Node, director } from 'cc';
const { ccclass, property } = _decorator;

/**
 * GameManager - 游戏全局管理器（单例）
 * 负责场景切换、游戏状态管理、关卡数据
 */
@ccclass('GameManager')
export class GameManager extends Component {
    private static _instance: GameManager | null = null;

    public static get instance(): GameManager {
        return GameManager._instance!;
    }

    @property({ tooltip: '主菜单场景名' })
    mainMenuScene: string = 'MainMenuScene';

    @property({ tooltip: '关卡选择场景名' })
    levelSelectScene: string = 'LevelSelectScene';

    @property({ tooltip: '游戏主场景名' })
    gameScene: string = 'MainScene';

    /** 当前选中的关卡索引 */
    public currentLevel: number = 0;

    /** 关卡数据 */
    public levels: LevelInfo[] = [
        {
            id: 0,
            name: '第一关',
            description: '初识攀岩',
            sceneName: 'MainScene',
            unlocked: true,
        },
    ];

    onLoad() {
        if (GameManager._instance && GameManager._instance !== this) {
            this.node.destroy();
            return;
        }
        GameManager._instance = this;
        director.addPersistRootNode(this.node);
    }

    start() {
        // 启动后自动进入主菜单
        director.loadScene(this.mainMenuScene);
    }

    /** 进入主菜单 */
    public goToMainMenu() {
        director.loadScene(this.mainMenuScene);
    }

    /** 进入关卡选择 */
    public goToLevelSelect() {
        director.loadScene(this.levelSelectScene);
    }

    /** 开始指定关卡 */
    public startLevel(levelIndex: number) {
        if (levelIndex < 0 || levelIndex >= this.levels.length) return;
        if (!this.levels[levelIndex].unlocked) return;

        this.currentLevel = levelIndex;
        director.loadScene(this.levels[levelIndex].sceneName);
    }

    /** 解锁下一关 */
    public unlockNextLevel() {
        const next = this.currentLevel + 1;
        if (next < this.levels.length) {
            this.levels[next].unlocked = true;
        }
    }

    /** 重新开始当前关卡 */
    public restartLevel() {
        director.loadScene(this.levels[this.currentLevel].sceneName);
    }
}

/** 关卡信息 */
export interface LevelInfo {
    id: number;
    name: string;
    description: string;
    sceneName: string;
    unlocked: boolean;
}