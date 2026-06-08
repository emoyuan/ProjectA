import { _decorator, Component, Node, Button, Label, Prefab, instantiate, UITransform, Color, Layout, ScrollView, Vec3, isValid } from 'cc';
import { GameManager, LevelInfo } from '../level/GameManager';
const { ccclass, property } = _decorator;

/**
 * LevelSelectUI - 关卡选择界面
 * 展示所有关卡，点击进入对应关卡
 */
@ccclass('LevelSelectUI')
export class LevelSelectUI extends Component {

    @property({ type: Node, tooltip: '关卡列表容器（带 Layout 组件）' })
    levelListContainer: Node = null!;

    @property({ type: Prefab, tooltip: '关卡按钮预制体' })
    levelButtonPrefab: Prefab = null!;

    @property({ type: Node, tooltip: '返回按钮' })
    backButton: Node = null!;

    @property({ type: Node, tooltip: '标题文字' })
    titleLabel: Node = null!;

    onLoad() {
        if (this.backButton) {
            this.backButton.on(Button.EventType.CLICK, this.onBack, this);
        }

        this.populateLevels();
    }

    onDestroy() {
        if (this.backButton && isValid(this.backButton)) {
            this.backButton.off(Button.EventType.CLICK, this.onBack, this);
        }
    }

    /** 根据 GameManager 中的关卡数据生成关卡按钮 */
    private populateLevels() {
        const gm = GameManager.instance;
        if (!gm || !this.levelListContainer) return;

        // 清空已有子节点
        this.levelListContainer.removeAllChildren();

        for (let i = 0; i < gm.levels.length; i++) {
            const level = gm.levels[i];
            const btnNode = this.createLevelButton(level, i);
            this.levelListContainer.addChild(btnNode);
        }
    }

    /** 创建一个关卡按钮 */
    private createLevelButton(level: LevelInfo, index: number): Node {
        let btnNode: Node;

        if (this.levelButtonPrefab) {
            btnNode = instantiate(this.levelButtonPrefab);
        } else {
            // 没有预制体时动态创建
            btnNode = this.createDefaultLevelButton(level, index);
        }

        // 设置按钮点击事件
        const btn = btnNode.getComponent(Button);
        if (btn) {
            btn.node.on(Button.EventType.CLICK, () => {
                this.onLevelClick(index);
            });
        }

        // 如果关卡未解锁，禁用按钮
        if (!level.unlocked) {
            if (btn) btn.interactable = false;
            // 设置灰色外观
            const sprite = btnNode.getComponent('cc.Sprite') as any;
            if (sprite) {
                sprite.color = new Color(100, 100, 100, 200);
            }
        }

        return btnNode;
    }

    /** 动态创建默认关卡按钮（无预制体时使用） */
    private createDefaultLevelButton(level: LevelInfo, index: number): Node {
        const btnNode = new Node(`LevelBtn_${index}`);
        const uiTransform = btnNode.addComponent(UITransform);
        uiTransform.setContentSize(300, 80);

        const btn = btnNode.addComponent(Button);

        // 背景 Sprite
        const bgNode = new Node('Background');
        const bgTransform = bgNode.addComponent(UITransform);
        bgTransform.setContentSize(300, 80);
        const bgSprite = bgNode.addComponent('cc.Sprite') as any;
        bgSprite.type = 1; // SLICED
        bgSprite.color = level.unlocked ? new Color(60, 140, 220, 255) : new Color(100, 100, 100, 200);
        btnNode.addChild(bgNode);

        // 关卡名称
        const nameNode = new Node('LevelName');
        const nameLabel = nameNode.addComponent(Label);
        nameLabel.string = level.name;
        nameLabel.fontSize = 28;
        nameLabel.color = Color.WHITE;
        nameLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        nameLabel.verticalAlign = Label.VerticalAlign.CENTER;
        const nameTransform = nameNode.getComponent(UITransform)!;
        nameTransform.setContentSize(280, 40);
        nameNode.setPosition(0, 10, 0);
        btnNode.addChild(nameNode);

        // 关卡描述
        const descNode = new Node('LevelDesc');
        const descLabel = descNode.addComponent(Label);
        descLabel.string = level.unlocked ? level.description : '🔒 未解锁';
        descLabel.fontSize = 16;
        descLabel.color = level.unlocked ? new Color(200, 220, 255, 255) : new Color(150, 150, 150, 255);
        descLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        descLabel.verticalAlign = Label.VerticalAlign.CENTER;
        const descTransform = descNode.getComponent(UITransform)!;
        descTransform.setContentSize(280, 30);
        descNode.setPosition(0, -20, 0);
        btnNode.addChild(descNode);

        return btnNode;
    }

    private onLevelClick(index: number) {
        const gm = GameManager.instance;
        if (gm) {
            gm.startLevel(index);
        }
    }

    private onBack() {
        const gm = GameManager.instance;
        if (gm) {
            gm.goToMainMenu();
        }
    }
}