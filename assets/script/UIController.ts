import { _decorator, Component, Button, Node, Vec2, Color, input, Input, EventKeyboard, KeyCode } from 'cc';
import { Player, BodyPart } from './Player';
import { Joystick } from './Joystick';

const { ccclass, property } = _decorator;

@ccclass('UIController')
export class UIController extends Component {
    @property([Button]) partButtons: Button[] = [];
    @property(Joystick) joystick: Joystick = null!;
    @property(Player) player: Player = null!;
    @property({ tooltip: '摇杆在边界时的移动速度 (像素/秒)' })
    moveSpeed: number = 200;

    private wasTouching: boolean = false;
    private lastValidThumb: Vec2 = new Vec2();
    private selectedIndex: number = 0;

    // 双击检测
    private lastClickTimes: number[] = [];
    private readonly doubleClickDelay = 0.3;
    private keyTimers: Map<string, any> = new Map();

    onLoad() {
        const partIds: BodyPart[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'torso'];

        // 初始化时间戳
        for (let i = 0; i < this.partButtons.length; i++) {
            this.lastClickTimes[i] = 0;
        }

        // ========== 按钮事件 ==========
        for (let i = 0; i < this.partButtons.length; i++) {
            const idx = i;
            this.partButtons[i].node.on(Button.EventType.CLICK, () => {
                const now = Date.now();
                const diff = now - (this.lastClickTimes[idx] || 0);

                if (diff < this.doubleClickDelay * 1000) {
                    // 双击
                    if (idx === 4) {
                        if (this.player.activePart !== 'torso') {
                            this.selectPart(4);
                        }
                        this.player.toggleBodyFollow();
                        this.updateFollowButtonAppearance();
                    } else {
                        this.player.releaseHoldAndCooldown(partIds[idx]);
                    }
                    this.lastClickTimes[idx] = 0;
                    return;
                }

                // 单击：摇杆触摸时不切换选中
                if (!this.joystick.isTouching) {
                    this.selectPart(idx);
                }
                this.lastClickTimes[idx] = now;
            });
        }

        this.selectPart(0);

        // 键盘监听（使用新的 input API）
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        this.keyTimers.forEach((timer) => clearTimeout(timer));
        this.keyTimers.clear();
    }

    private onKeyDown(event: EventKeyboard) {
        // 摇杆触摸时，键盘直接取消吸附
        if (this.joystick && this.joystick.isTouching) {
            const partId = this.getPartIdByKeyCode(event.keyCode);
            if (partId) this.player.releaseHoldAndCooldown(partId);
            return;
        }

        // 重置/特殊操作
        switch (event.keyCode) {
            case KeyCode.KEY_R:
                this.resetUI();
                return;
            case KeyCode.KEY_W:
                this.player.resetTorsoLeanIfPossible();
                return;
        }

        // 部件选择
        const index = this.getIndexByKeyCode(event.keyCode);
        if (index === -1) return;

        const partIds: BodyPart[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'torso'];
        const part = partIds[index];
        const timerKey = event.keyCode.toString();

        if (this.keyTimers.has(timerKey)) {
            // 双击
            clearTimeout(this.keyTimers.get(timerKey));
            this.keyTimers.delete(timerKey);

            if (index === 4) {
                if (this.player.activePart !== 'torso') this.selectPart(4);
                this.player.toggleBodyFollow();
                this.updateFollowButtonAppearance();
            } else {
                this.selectPart(index);
                this.player.releaseHoldAndCooldown(part);
            }
        } else {
            // 单击：延迟选中
            this.keyTimers.set(timerKey, setTimeout(() => {
                this.selectPart(index);
                this.keyTimers.delete(timerKey);
            }, this.doubleClickDelay * 1000));
        }
    }

    private getIndexByKeyCode(keyCode: KeyCode): number {
        switch (keyCode) {
            case KeyCode.KEY_Q: return 0;  // 左手
            case KeyCode.KEY_E: return 1;  // 右手
            case KeyCode.KEY_A: return 2;  // 左脚
            case KeyCode.KEY_D: return 3;  // 右脚
            case KeyCode.KEY_S: return 4;  // 躯干
            default: return -1;
        }
    }

    private getPartIdByKeyCode(keyCode: KeyCode): BodyPart | null {
        const index = this.getIndexByKeyCode(keyCode);
        if (index === -1) return null;
        const partIds: BodyPart[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'torso'];
        return partIds[index];
    }

    selectPart(index: number) {
        this.selectedIndex = index;
        const partIds: BodyPart[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'torso'];
        this.player.activePart = partIds[index];
        this.player.resetAllHoldCooldowns();

        const highlightColor = new Color(100, 200, 100);
        const defaultColor = Color.WHITE;
        for (let i = 0; i < this.partButtons.length; i++) {
            const btnNode = this.partButtons[i].node;
            if (i === index) {
                btnNode.setScale(1.1, 1.1, 1);
                const label = btnNode.getComponentInChildren('cc.Label');
                if (label) (label as any).color = highlightColor;
            } else {
                btnNode.setScale(1, 1, 1);
                const label = btnNode.getComponentInChildren('cc.Label');
                if (label) (label as any).color = defaultColor;
            }
        }
        if (index === 4) this.updateFollowButtonAppearance();
    }

    private updateFollowButtonAppearance() {
        const idx = 4;
        const btnNode = this.partButtons[idx].node;
        const label = btnNode.getComponentInChildren('cc.Label');
        if (label) {
            (label as any).color = this.player.followBodyWithArm
                ? new Color(100, 200, 100)
                : (this.selectedIndex === idx ? new Color(100, 200, 100) : Color.WHITE);
        }
    }

    update(dt: number) {
        if (!this.joystick || !this.player) return;

        const touching = this.joystick.isTouching;
        if (touching) {
            const currentThumb = this.joystick.thumbPosition;
            const radius = this.joystick.radius;

            if (!this.wasTouching) {
                this.lastValidThumb.set(currentThumb);
                this.wasTouching = true;
                this.player.resetDragOffset();
                return;
            }

            let delta = new Vec2(
                currentThumb.x - this.lastValidThumb.x,
                currentThumb.y - this.lastValidThumb.y
            );

            // 摇杆在边界且持续推着，增加额外速度
            const atEdge = currentThumb.length() >= radius - 0.5;
            const hasDirection = this.joystick.direction.length() > 0.1;
            if (atEdge && hasDirection) {
                const dir = this.joystick.direction.clone().normalize();
                const extra = dir.multiplyScalar(this.moveSpeed * dt);
                delta.add(extra);
            }

            const moved = this.player.moveActivePart(delta.x, delta.y);

            if (moved) {
                this.lastValidThumb.set(currentThumb);
            }
        } else {
            this.wasTouching = false;
        }
    }

    public resetUI() {
        // 1. 将角色恢复到初始姿势（清除吸附、偏移、侧身等）
        this.player.resetToInitialPose();

        // 2. UI 选中第一个部件
        this.selectPart(0);
        this.updateFollowButtonAppearance();
    }
}