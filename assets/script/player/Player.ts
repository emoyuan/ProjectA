import { _decorator, Component, Node, Graphics, Vec2, Color, UITransform } from 'cc';
import { HoldManager } from '../hold/HoldManager';
import { HoldBase, HoldType } from '../hold/HoldBase';
import { BoneChain } from './BoneChain';
import { PlayerRenderer } from './PlayerRenderer';
const { ccclass, property } = _decorator;

export interface CharacterAppearance {
    skinColor: Color;
    hairColor: Color;
    clothColor: Color;
    limbWidth: number;
    jointRadius: number;
    headRadius: number;
    torsoWidth: number;
    torsoHeight: number;
}

export type BodyPart = 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot' | 'torso';

@ccclass('Player')
export class Player extends Component {

    @property(Node)
    gameLayer: Node = null!;

    @property({ type: Node, tooltip: '出生点节点，控制玩家初始X坐标' })
    spawnPoint: Node = null!;

    @property(HoldManager)
    holdManager: HoldManager = null!;

    @property({ tooltip: '角色整体缩放比例' })
    scaleFactor: number = 0.6;

    @property({ tooltip: '手部末端绘制半径' })
    handEndRadius: number = 9;   // 原 jointRadius(7) + 2

    @property({ tooltip: '脚掌宽度（像素，用于单脚支撑显示）' })
    footWidth: number = 30;

    @property({ tooltip: '脚部末端绘制半径' })
    footEndRadius: number = 9;

    @property({ type: Color, tooltip: '支撑多边形填充颜色' })
    supportPolygonColor: Color = new Color(0, 255, 0, 80);

    @property({ type: Color, tooltip: '手部末端颜色' })
    handEndColor: Color = new Color(255, 255, 255, 255);

    @property({ type: Color, tooltip: '脚部末端颜色' })
    footEndColor: Color = new Color(255, 255, 255, 255);

    @property({ type: Color, tooltip: '肢体锁定且受力时的颜色' })
    forceColor: Color = new Color(0, 255, 0, 255);   // 绿色

    @property({ type: Color, tooltip: '肢体锁定但不受力时的颜色' })
    noForceColor: Color = new Color(255, 0, 0, 255);   // 红色

    @property({ tooltip: '吸附后延迟累计偏移的时间（秒），防止刚锁定就被边缘拖拽脱离' })
    dragHoldDelay: number = 0.5;

    @property({ tooltip: '髋部到双脚连线的最小垂直距离（像素）' })
    minHipToFeetLineDist: number = 10;

    @property({ tooltip: '脚与髋部的最小垂直距离（像素）' })
    footHipOffset: number = 30;

    @property({ tooltip: '手臂力方向超出允许角度后，最多容忍的时间（秒）' })
    forceAngleToleranceTime: number = 0.3;
    
    @property({ tooltip: '质心超出支撑多边形最大容忍时间（秒）' })
    balanceToleranceTime: number = 0.5;

    @property({ tooltip: '未吸附脚距离地平线多远以内视为站在地面上（像素）' })
    groundStandTolerance: number = 10;

    shoulder: Vec2 = new Vec2(0, 70);
    hip: Vec2 = new Vec2(0, -70);
    head: Vec2 = new Vec2(0, 155);
    leftShoulder: Vec2 = new Vec2();
    rightShoulder: Vec2 = new Vec2();

    leftArm: BoneChain = null!;
    rightArm: BoneChain = null!;
    leftLeg: BoneChain = null!;
    rightLeg: BoneChain = null!;

    activePart: BodyPart = 'torso';
    followBodyWithArm: boolean = true;

    upperArmLen: number = 98;
    forearmLen: number = 84;
    upperLegLen: number = 127;
    lowerLegLen: number = 113;
    armSpanOffset: number = 10;

    groundY: number = 0;
    private dragOffset: Vec2 = new Vec2(0, 0);
    private initialHipY: number = -70;

    @property({ tooltip: '躯干左右侧倾的最大偏移量（像素）' })
    maxTorsoLean: number = 40;

    @property({ tooltip: '手脚超出可达时躯干辅助移动的比例' })
    torsoAssistFactor: number = 0.5;

    private torsoLean: number = 0;

    private lastAdsorbTime: number = 0;   // 最近一次吸附的时间戳（毫秒）
    // 失衡计时器（毫秒）
    private imbalanceTimer: number = 0;

    private adsorbedHold: Map<BodyPart, HoldBase> = new Map();
    // 记录每个手臂超出角度的累计时间（毫秒）
    private forceAngleTimer: Map<BodyPart, number> = new Map();
    // ★ 记录因超时脱落的岩点（肢体 -> 岩点），该肢体继续操作时可无视冷却重新吸附
    private timeoutReleasedHold: Map<BodyPart, HoldBase> = new Map();

    appearance: CharacterAppearance = {
        skinColor: new Color(255, 210, 170, 255),
        hairColor: new Color(80, 50, 30, 255),
        clothColor: new Color(60, 140, 220, 255),
        limbWidth: 16,
        jointRadius: 7,
        headRadius: 16,
        torsoWidth: 40,
        torsoHeight: 140,
    };

    start() {
        this.computeAndApplyInitialPose();

        // 确保 HoldManager 在开始时处于未起步状态
        if (this.holdManager) {
            this.holdManager.setStarted(false);
            this.holdManager.setFinished(false);
        }
    }

    initPose() {
        const s = this.scaleFactor;
        this.torsoLean = 0;
        this.shoulder.set(0, 70 * s);
        this.hip.set(0, -70 * s);
        this.head.set(0, 155 * s);
        this.updateShoulderPositions();
    }

    private updateShoulderPositions() {
        const shoulderHalfW = this.appearance.torsoWidth * 0.9 / 2 * this.scaleFactor;
        this.shoulder.x = this.hip.x + this.torsoLean;
        this.leftShoulder.set(this.shoulder.x - shoulderHalfW, this.shoulder.y);
        this.rightShoulder.set(this.shoulder.x + shoulderHalfW, this.shoulder.y);
        this.head.x = this.shoulder.x;
        if (this.leftArm) this.leftArm.root.set(this.leftShoulder);
        if (this.rightArm) this.rightArm.root.set(this.rightShoulder);
    }

    private clampTorsoLean(value: number): number {
        return Math.max(-this.maxTorsoLean, Math.min(this.maxTorsoLean, value));
    }

    /**
     * 检查改变 torsoLean 后，另一只锁定的手是否仍能到达其目标。
     * 如果不能，则不允许本次躯干旋转。
     */
    private canOtherLockedArmReachAfterLean(newLean: number, requestingPart: BodyPart): boolean {
        const otherPart: BodyPart = requestingPart === 'leftHand' ? 'rightHand' : 'leftHand';
        const otherHold = this.adsorbedHold.get(otherPart);
        if (!otherHold) return true; // 另一只手没锁定，无限制

        const otherChain = this.getChainByPart(otherPart);
        if (!otherChain) return true;

        // 保存当前状态
        const oldLean = this.torsoLean;
        const oldLeftRoot = this.leftArm.root.clone();
        const oldRightRoot = this.rightArm.root.clone();
        const oldShoulderX = this.shoulder.x;

        // 临时应用新的 torsoLean
        this.torsoLean = newLean;
        this.updateShoulderPositions();

        const canReach = this.canRootReachCurrentTarget(otherChain, otherPart);

        // 恢复原状态
        this.torsoLean = oldLean;
        this.shoulder.x = oldShoulderX;
        this.leftArm.root.set(oldLeftRoot);
        this.rightArm.root.set(oldRightRoot);
        this.updateShoulderPositions();

        return canReach;
    }

    /**
     * 检查改变 torsoLean 后，另一只锁定的脚是否仍能到达其目标。
     * 如果不能，则不允许本次躯干旋转。
     */
    private canOtherLockedLegReachAfterLean(newLean: number, requestingPart: BodyPart): boolean {
        const otherPart: BodyPart = requestingPart === 'leftFoot' ? 'rightFoot' : 'leftFoot';
        const otherHold = this.adsorbedHold.get(otherPart);
        if (!otherHold) return true; // 另一只脚没锁定，无限制

        const otherChain = this.getChainByPart(otherPart);
        if (!otherChain) return true;

        // 保存当前状态
        const oldLean = this.torsoLean;
        const oldLeftRoot = this.leftLeg.root.clone();
        const oldRightRoot = this.rightLeg.root.clone();

        // 临时应用新的 torsoLean
        this.torsoLean = newLean;
        this.updateShoulderPositions();
        // 更新腿部 root（torsoLean 变化不影响髋部位置，但 updateShoulderPositions 不更新腿 root）
        const hipHalfW = this.appearance.torsoWidth * 0.35 * this.scaleFactor;
        this.leftLeg.root.set(this.hip.x - hipHalfW, this.hip.y);
        this.rightLeg.root.set(this.hip.x + hipHalfW, this.hip.y);

        const canReach = this.canRootReachCurrentTarget(otherChain, otherPart);

        // 恢复原状态
        this.torsoLean = oldLean;
        this.leftLeg.root.set(oldLeftRoot);
        this.rightLeg.root.set(oldRightRoot);
        this.updateShoulderPositions();

        return canReach;
    }

    private tryAdjustTorsoForReach(chain: BoneChain, desiredX: number, desiredY: number): boolean {
        const root = chain.root;
        const dx = desiredX - root.x;
        const dy = desiredY - root.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = chain.upperLen + chain.lowerLen;
        if (dist <= maxDist + 1e-3) return false;

        if (chain.isArm) {
            const leanDelta = dx / dist * dist * this.torsoAssistFactor * 0.3;
            const oldLean = this.torsoLean;
            const newLean = this.clampTorsoLean(this.torsoLean + leanDelta);

            // 检查另一只锁定的手是否能承受这次躯干旋转
            if (!this.canOtherLockedArmReachAfterLean(newLean, this.activePart)) {
                return false;
            }

            this.torsoLean = newLean;
            this.updateShoulderPositions();
            const newDist = Vec2.distance(chain.root, new Vec2(desiredX, desiredY));
            return newDist <= maxDist + 1e-3 && Math.abs(this.torsoLean - oldLean) > 0.5;
        }

        // 腿部超出可达范围：沿 X 方向微调肩部位置（躯干侧倾辅助），不移动整个身体
        const shiftX = dx / dist * Math.min(dist * this.torsoAssistFactor * 0.25, this.maxTorsoLean * 0.5);
        const oldLean = this.torsoLean;
        const newLean = this.clampTorsoLean(this.torsoLean + shiftX);

        // 检查另一只锁定的腿是否能承受这次躯干旋转
        if (!this.canOtherLockedLegReachAfterLean(newLean, this.activePart)) {
            return false;
        }

        this.torsoLean = newLean;
        this.updateShoulderPositions();
        const newDist = Vec2.distance(chain.root, new Vec2(desiredX, desiredY));
        return newDist <= maxDist + 1e-3 && Math.abs(this.torsoLean - oldLean) > 0.5;
    }

    resetToInitialPose() {
        // 重置吸附与拖拽状态
        this.adsorbedHold.clear();
        this.timeoutReleasedHold.clear();
        this.dragOffset.set(0, 0);
        this.activePart = 'torso';
        this.imbalanceTimer = 0;

        this.computeAndApplyInitialPose();

        if (this.holdManager) {
            this.holdManager.setStarted(false);
            this.holdManager.setFinished(false);
        }
    }

    /**
     * 计算并应用初始姿态：基础关节 → 四肢自然垂落目标 → 地面/出生点对齐 → 骨链初始化。
     * 由 start() 和 resetToInitialPose() 共用。
     */
    private computeAndApplyInitialPose() {
        const s = this.scaleFactor;

        // 1. 基础关节位置（torsoLean=0，肩/髋/头回原位）
        this.initPose();

        // 2. 计算四肢自然垂落/分开的目标位置（手臂30°向外，双腿60°分开）
        const shoulderHalfW = this.appearance.torsoWidth * 0.9 / 2 * s;
        const hipHalfW = this.appearance.torsoWidth * 0.35 * s;

        const totalArmLen = (this.upperArmLen + this.forearmLen) * s;
        const armAngle = 30 * Math.PI / 180;
        const armDx = Math.sin(armAngle) * totalArmLen;
        const armDy = Math.cos(armAngle) * totalArmLen;

        const leftHandTarget = new Vec2(this.leftShoulder.x - armDx, this.leftShoulder.y - armDy);
        const rightHandTarget = new Vec2(this.rightShoulder.x + armDx, this.rightShoulder.y - armDy);

        const totalLegLen = (this.upperLegLen + this.lowerLegLen) * s;
        const legAngle = 30 * Math.PI / 180;
        const legDx = Math.sin(legAngle) * totalLegLen;
        const legDy = Math.cos(legAngle) * totalLegLen;

        const leftFootTarget = new Vec2(this.hip.x - hipHalfW - legDx, this.hip.y - legDy);
        const rightFootTarget = new Vec2(this.hip.x + hipHalfW + legDx, this.hip.y - legDy);

        // 3. 地平线位置（基于 GameLayer 高度）
        let targetGroundY = -800 * s; // fallback
        if (this.gameLayer) {
            const uiTransform = this.gameLayer.getComponent('cc.UITransform') as any;
            if (uiTransform) {
                const height = uiTransform.height;
                const margin = 50 * s;
                targetGroundY = -height / 2 + margin;
            }
        }
        this.groundY = targetGroundY;

        // 4. 整体垂直平移，使脚底对齐地平线
        const naturalFootY = Math.min(leftFootTarget.y, rightFootTarget.y);
        const deltaY = targetGroundY - naturalFootY;
        this.shoulder.y += deltaY;
        this.hip.y += deltaY;
        this.head.y += deltaY;
        this.leftShoulder.y += deltaY;
        this.rightShoulder.y += deltaY;
        leftHandTarget.y += deltaY;
        rightHandTarget.y += deltaY;
        leftFootTarget.y += deltaY;
        rightFootTarget.y += deltaY;

        // 5. 根据出生点节点调整角色水平位置
        if (this.spawnPoint) {
            const spawnX = this.spawnPoint.position.x;
            const currentCenterX = (this.leftShoulder.x + this.rightShoulder.x) / 2;
            const deltaX = spawnX - currentCenterX;
            this.shoulder.x += deltaX;
            this.hip.x += deltaX;
            this.head.x += deltaX;
            this.leftShoulder.x += deltaX;
            this.rightShoulder.x += deltaX;
            leftHandTarget.x += deltaX;
            rightHandTarget.x += deltaX;
            leftFootTarget.x += deltaX;
            rightFootTarget.x += deltaX;
        }

        // 6. 保存初始髋部高度
        this.initialHipY = this.hip.y;

        // 7. 使用平移后的坐标初始化骨链
        this.initBoneChains(leftHandTarget, rightHandTarget, leftFootTarget, rightFootTarget);
    }

    private initBoneChains(
        leftHandTarget: Vec2,
        rightHandTarget: Vec2,
        leftFootTarget: Vec2,
        rightFootTarget: Vec2
    ) {
        const s = this.scaleFactor;
        const shoulderHalfW = this.appearance.torsoWidth * 0.9 / 2 * s;
        const hipHalfW = this.appearance.torsoWidth * 0.35 * s;

        const upperArmLen = this.upperArmLen * s;
        const forearmLen = this.forearmLen * s;
        const upperLegLen = this.upperLegLen * s;
        const lowerLegLen = this.lowerLegLen * s;

        // 左臂
        this.leftArm = new BoneChain(
            new Vec2(this.leftShoulder.x, this.leftShoulder.y),
            new Vec2(this.leftShoulder.x, this.leftShoulder.y), // 临时 mid，solve 会计算
            leftHandTarget.clone(),
            upperArmLen, forearmLen, true
        );
        this.leftArm.isArm = true;

        // 右臂
        this.rightArm = new BoneChain(
            new Vec2(this.rightShoulder.x, this.rightShoulder.y),
            new Vec2(this.rightShoulder.x, this.rightShoulder.y),
            rightHandTarget.clone(),
            upperArmLen, forearmLen, false
        );
        this.rightArm.isArm = true;

        // 左腿
        this.leftLeg = new BoneChain(
            new Vec2(this.hip.x - hipHalfW, this.hip.y),
            new Vec2(this.hip.x - hipHalfW, this.hip.y),
            leftFootTarget.clone(),
            upperLegLen, lowerLegLen, true
        );

        // 右腿
        this.rightLeg = new BoneChain(
            new Vec2(this.hip.x + hipHalfW, this.hip.y),
            new Vec2(this.hip.x + hipHalfW, this.hip.y),
            rightFootTarget.clone(),
            upperLegLen, lowerLegLen, false
        );

        // 立即求解一次，让 mid 更新到正确位置
        this.solveAllChains();
    }

    private getChainByPart(part: BodyPart): BoneChain | null {
        switch (part) {
            case 'leftHand': return this.leftArm;
            case 'rightHand': return this.rightArm;
            case 'leftFoot': return this.leftLeg;
            case 'rightFoot': return this.rightLeg;
            default: return null;
        }
    }

    public resetAllHoldCooldowns() {
        if (this.holdManager) {
            this.holdManager.resetAllCooldowns();
        }
    }
    
    public resetDragOffset() {
        this.dragOffset.set(0, 0);
        this.lastAdsorbTime = 0;
    }

    public getChainTarget(part: BodyPart): Vec2 | null {
        const chain = this.getChainByPart(part);
        return chain ? chain.target : null;
    }

    /**
     * 获取支撑区域的X范围 [minX, maxX]，若无支撑返回 null
     */
    private getSupportXRange(): { min: number, max: number } | null {
        let minX = Infinity, maxX = -Infinity;
        let hasSupport = false;

        // 处理左脚
        if (this.adsorbedHold.has('leftFoot')) {
            const hold = this.adsorbedHold.get('leftFoot')!;
            if (hold.allowFootStand) {
                const x = this.leftLeg.target.x;
                minX = Math.min(minX, x - this.footWidth / 2);
                maxX = Math.max(maxX, x + this.footWidth / 2);
                hasSupport = true;
            }
        } else {
            if (Math.abs(this.leftLeg.target.y - this.groundY) < this.groundStandTolerance) {
                const x = this.leftLeg.target.x;
                minX = Math.min(minX, x - this.footWidth / 2);
                maxX = Math.max(maxX, x + this.footWidth / 2);
                hasSupport = true;
            }
        }

        // 处理右脚
        if (this.adsorbedHold.has('rightFoot')) {
            const hold = this.adsorbedHold.get('rightFoot')!;
            if (hold.allowFootStand) {
                const x = this.rightLeg.target.x;
                minX = Math.min(minX, x - this.footWidth / 2);
                maxX = Math.max(maxX, x + this.footWidth / 2);
                hasSupport = true;
            }
        } else {
            if (Math.abs(this.rightLeg.target.y - this.groundY) < this.groundStandTolerance) {
                const x = this.rightLeg.target.x;
                minX = Math.min(minX, x - this.footWidth / 2);
                maxX = Math.max(maxX, x + this.footWidth / 2);
                hasSupport = true;
            }
        }

        // ★ 处理手部支撑：锁定且受力良好的手可以提供支撑，将其纳入支撑范围
        const armSupportWidth = this.footWidth * 0.8; // 手点支撑宽度略小于脚
        for (const part of ['leftHand', 'rightHand'] as BodyPart[]) {
            if (this.adsorbedHold.has(part) && this.isPartUnderForce(part)) {
                const x = this.getChainByPart(part)!.target.x;
                minX = Math.min(minX, x - armSupportWidth / 2);
                maxX = Math.max(maxX, x + armSupportWidth / 2);
                hasSupport = true;
            }
        }

        return hasSupport ? { min: minX, max: maxX } : null;
    }

    /**
     * 质心水平投影是否在支撑区间内。
     * 无支撑范围时返回 false（视为失衡）。
     */
    private isComOverSupport(): boolean {
        const range = this.getSupportXRange();
        if (!range) return false; // 没有支撑线 = 失衡
        const comX = this.getCenterOfMass().x;
        return comX >= range.min && comX <= range.max;
    }

    public moveActivePart(dx: number, dy: number): boolean {
        // 辅助函数：计算髋部到双脚连线的有符号距离（正值表示在上方）
        const getSignedDist = (hipX: number, hipY: number): number => {
            const footA = this.leftLeg.target;
            const footB = this.rightLeg.target;
            const fdx = footB.x - footA.x;
            const fdy = footB.y - footA.y;
            const lenSq = fdx * fdx + fdy * fdy;
            if (lenSq < 0.001) return hipY - footA.y;
            const len = Math.sqrt(lenSq);
            const nx = -fdy / len;
            const ny = fdx / len;
            return (hipX - footA.x) * nx + (hipY - footA.y) * ny;
        };

        switch (this.activePart) {
            case 'leftHand':
            case 'rightHand':
            case 'leftFoot':
            case 'rightFoot': {
                const chain = this.getChainByPart(this.activePart);
                if (!chain) return false;

                // 已吸附处理
                if (this.adsorbedHold.has(this.activePart)) {
                    const hold = this.adsorbedHold.get(this.activePart)!;

                    if (hold.type === HoldType.VOLUME) {
                        const newTarget = new Vec2(chain.target.x + dx, chain.target.y + dy);

                        // 若为脚部，需要额外检查约束，不满足则阻止移动
                        if (this.activePart === 'leftFoot' || this.activePart === 'rightFoot') {
                            const volumeTarget = hold.getReachablePointOnVolumeLine(chain.root, newTarget, chain.upperLen + chain.lowerLen);
                            if (!volumeTarget) {
                                this.solveAllChains();
                                return true;
                            }

                            const origTarget = chain.target.clone();
                            chain.target.set(volumeTarget);
                            const signedDist = getSignedDist(this.hip.x, this.hip.y);
                            const footOk = (volumeTarget.y + this.footHipOffset < this.hip.y);
                            chain.target.set(origTarget);

                            if (signedDist < this.minHipToFeetLineDist || !footOk) {
                                return false;
                            }

                            chain.target.set(volumeTarget);
                            this.solveAllChains();
                            return true;
                        } else {
                            // 手部 Volume 滑动（无额外约束）
                            if (chain.isArm) {
                                this.tryAdjustTorsoForReach(chain, newTarget.x, newTarget.y);
                            }
                            const volumeTarget = hold.getReachablePointOnVolumeLine(chain.root, newTarget, chain.upperLen + chain.lowerLen);
                            if (volumeTarget) {
                                chain.target.set(volumeTarget);
                            }
                            this.solveAllChains();
                            return true;
                        }
                    } else {
                        // 点吸附：累计偏移脱离（不变）
                        if (Date.now() - this.lastAdsorbTime < this.dragHoldDelay * 1000) {
                            const lockPos = hold.getAdsorbedPosition(chain.target);
                            if (lockPos) chain.target.set(lockPos);
                            else chain.target.set(hold.localPos);
                            this.solveAllChains();
                            return true;
                        }

                        this.dragOffset.x += dx;
                        this.dragOffset.y += dy;

                        if (this.dragOffset.length() > hold.releaseRadius) {
                            this.adsorbedHold.delete(this.activePart);
                            this.holdManager.startCooldown(hold);
                            const offsetX = this.dragOffset.x;
                            const offsetY = this.dragOffset.y;
                            this.dragOffset.set(0, 0);
                            if (chain.isArm) {
                                chain.preferVertical = false;
                                chain.maxVerticalAngle = 0;
                            }
                            const lockPos = hold.getAdsorbedPosition(chain.target);
                            if (lockPos) {
                                chain.target.set(lockPos.x + offsetX, lockPos.y + offsetY);
                            } else {
                                chain.target.set(hold.localPos.x + offsetX, hold.localPos.y + offsetY);
                            }
                            this.constrainTargetToReach(chain);
                        } else {
                            const lockPos = hold.getAdsorbedPosition(chain.target);
                            if (lockPos) chain.target.set(lockPos);
                            else chain.target.set(hold.localPos);
                        }
                        this.solveAllChains();
                        return true;
                    }
                }

                // ========== 未吸附：正常移动 ==========
                const oldX = chain.target.x, oldY = chain.target.y;
                const newTargetX = chain.target.x + dx;
                const newTargetY = chain.target.y + dy;
                // 保存玩家意图位置（裁剪前），用于 VOLUME 吸附检测
                const intendedX = newTargetX;
                const intendedY = newTargetY;

                // 脚移动限制
                if (this.activePart === 'leftFoot' || this.activePart === 'rightFoot') {
                    const tempFoot = new Vec2(newTargetX, newTargetY);
                    const otherFoot = this.activePart === 'leftFoot' ? this.rightLeg.target : this.leftLeg.target;
                    const footA = this.activePart === 'leftFoot' ? tempFoot : otherFoot;
                    const footB = this.activePart === 'leftFoot' ? otherFoot : tempFoot;
                    const origTarget = chain.target.clone();
                    chain.target.set(tempFoot);
                    const signedDist = getSignedDist(this.hip.x, this.hip.y);
                    chain.target.set(origTarget);
                    if (signedDist < this.minHipToFeetLineDist) return false;
                    if (newTargetY + this.footHipOffset >= this.hip.y) return false;
                }

                chain.target.x = newTargetX;
                chain.target.y = newTargetY;

                // 可达约束及重心跟随
                const root = chain.root;
                const ndx = chain.target.x - root.x;
                const ndy = chain.target.y - root.y;
                const dist = Math.sqrt(ndx * ndx + ndy * ndy);
                const maxDist = chain.upperLen + chain.lowerLen;

                if (dist > maxDist) {
                    // 脚移动不改变身体位置，直接约束到可达范围
                    if (!chain.isArm) {
                        chain.target.set(root.x + (ndx / dist) * maxDist, root.y + (ndy / dist) * maxDist);
                    } else if (!this.tryAdjustTorsoForReach(chain, newTargetX, newTargetY)) {
                        if (this.followBodyWithArm && chain.isArm) {
                            const dirX = ndx / dist;
                            const dirY = ndy / dist;
                            chain.target.set(root.x + dirX * maxDist, root.y + dirY * maxDist);
                            const remainDx = newTargetX - chain.target.x;
                            const remainDy = newTargetY - chain.target.y;
                            const bodyDx = remainDx / 0.6;
                            const bodyDy = remainDy;
                            this.moveBodyByDelta(bodyDx, bodyDy, false);
                        } else {
                            chain.target.set(root.x + (ndx / dist) * maxDist, root.y + (ndy / dist) * maxDist);
                        }
                    }
                }
                this.constrainTargetToReach(chain);

                // 自动吸附检测
                if (this.holdManager) {
                    // ★ 先检查是否有因超时脱落的岩点可重新吸附（无视冷却）
                    const timeoutHold = this.timeoutReleasedHold.get(this.activePart);
                    let nearest: HoldBase | null = null;
                    if (timeoutHold) {
                        // VOLUME 超时岩点：用意图位置检测
                        const timeoutTarget = (timeoutHold.type === HoldType.VOLUME && chain.isArm)
                            ? new Vec2(intendedX, intendedY)
                            : chain.target;
                        const adsorbPos = timeoutHold.getAdsorbedPosition(timeoutTarget);
                        if (adsorbPos) {
                            nearest = timeoutHold;
                        } else {
                            // 超时脱落的岩点已不在吸附范围内，清除记录
                            this.timeoutReleasedHold.delete(this.activePart);
                        }
                    }

                    // 如果没有超时脱落岩点可吸附，走正常吸附流程（排除冷却中的岩点）
                    if (!nearest) {
                        // VOLUME 吸附：用玩家意图位置（裁剪前）检测，避免裁剪后位置偏离线段
                        const searchTarget = chain.isArm ? new Vec2(intendedX, intendedY) : chain.target;
                        nearest = this.holdManager.findNearestHold(searchTarget, true);
                    }

                    if (nearest) {
                        // VOLUME 吸附：用玩家意图位置（裁剪前）计算吸附点，避免裁剪后投影偏移
                        const adsorbTarget = (nearest.type === HoldType.VOLUME && chain.isArm)
                            ? new Vec2(intendedX, intendedY)
                            : chain.target;
                        const adsorbPos = nearest.getAdsorbedPosition(adsorbTarget);
                        if (adsorbPos) {
                            // VOLUME 吸附：意图投影点必须在臂长可达范围内，否则拒绝吸附
                            if (nearest.type === HoldType.VOLUME && chain.isArm) {
                                const maxLen = chain.upperLen + chain.lowerLen;
                                const distToAdsorb = Vec2.distance(chain.root, adsorbPos);
                                if (distToAdsorb <= maxLen) {
                                    chain.target.set(adsorbPos);
                                    this.adsorbedHold.set(this.activePart, nearest);
                                    this.dragOffset.set(0, 0);
                                    this.lastAdsorbTime = Date.now();
                                    this.forceAngleTimer.delete(this.activePart);
                                    this.timeoutReleasedHold.delete(this.activePart);
                                    this.checkStartCondition();
                                    this.checkFinishCondition();
                                }
                                // 意图投影点不可达 → 拒绝吸附，玩家需先移动身体靠近
                            } else {
                                chain.target.set(adsorbPos);
                                this.adsorbedHold.set(this.activePart, nearest);
                                this.dragOffset.set(0, 0);
                                this.lastAdsorbTime = Date.now();
                                this.forceAngleTimer.delete(this.activePart);
                                this.timeoutReleasedHold.delete(this.activePart);
                                if (chain.isArm && nearest.type !== HoldType.VOLUME) {
                                    chain.preferVertical = true;
                                    chain.maxVerticalAngle = 15;
                                }
                                this.checkStartCondition();
                                this.checkFinishCondition();
                            }
                        }
                    }
                }

                if (this.activePart === 'leftFoot' || this.activePart === 'rightFoot') {
                    this.updateKneeAbduction();
                    this.leftLeg.solve();
                    this.rightLeg.solve();
                }
                return (chain.target.x !== oldX || chain.target.y !== oldY);
            }

            case 'torso': {
                // ★ 身体移动限制：没有支撑线则无法移动身体
                const supportRange = this.getSupportXRange();
                if (!supportRange) return false;

                let newX = this.hip.x + dx * 0.6;
                let newY = this.hip.y + dy;

                const valid = this.clampHipPosition(newX, newY);

                const delta = new Vec2(valid.x - this.hip.x, valid.y - this.hip.y);
                if (delta.x === 0 && delta.y === 0) return false;

                const limbs: { chain: BoneChain; part: BodyPart }[] = [
                    { chain: this.leftArm, part: 'leftHand' },
                    { chain: this.rightArm, part: 'rightHand' },
                    { chain: this.leftLeg, part: 'leftFoot' },
                    { chain: this.rightLeg, part: 'rightFoot' },
                ];

                // ★ 需求1：没有任何锁定点时，站在地面上的脚保持Y在地面，但可沿地面水平滑动
                const noHoldsAndFeetOnGround = this.hasNoLockedHolds() && this.hasAnyFootOnGround();

                const savedVectors: Map<BodyPart, Vec2> = new Map();
                for (const { chain, part } of limbs) {
                    if (!this.adsorbedHold.has(part)) {
                        savedVectors.set(part, new Vec2(
                            chain.target.x - chain.root.x,
                            chain.target.y - chain.root.y
                        ));
                    }
                }

                this.moveBodyRoots(delta.x, delta.y);

                for (const { chain, part } of limbs) {
                    if (!this.adsorbedHold.has(part)) {
                        const rel = savedVectors.get(part);
                        if (rel) {
                            chain.target.set(chain.root.x + rel.x, chain.root.y + rel.y);
                        }
                        // 脚在地面上：锁定Y到地面，但允许X随身体滑动
                        if (noHoldsAndFeetOnGround && this.isFootOnGround(part)) {
                            chain.target.y = this.groundY;
                            // 确保脚在腿长可达范围内：如果髋部到地面点的距离超过腿长，沿X拉回
                            this.clampFootToGroundReach(chain);
                        }
                    }
                }

                // 锁定肢体处理：手部 Volume 滑动，脚部保持不动
                for (const [part, hold] of this.adsorbedHold) {
                    const chain = this.getChainByPart(part);
                    if (!chain) continue;
                    if (hold.type === HoldType.VOLUME && (part === 'leftHand' || part === 'rightHand')) {
                        const lineTarget = hold.getClosestPointOnVolumeLine(chain.target) ?? chain.target.clone();
                        chain.target.set(lineTarget);
                    } else if (part === 'leftFoot' || part === 'rightFoot') {
                        // 脚固定
                    } else {
                        const lockPos = hold.getAdsorbedPosition(chain.target);
                        if (lockPos) chain.target.set(lockPos);
                        else chain.target.set(hold.localPos);
                    }
                }

                this.updateKneeAbduction();
                this.updateArmAbduction();
                for (const { chain } of limbs) chain.solve();
                this.tryReduceTorsoLean();
                return true;
            }
        }
        return false;
    }

    private constrainTargetToReach(chain: BoneChain) {
        const root = chain.root;
        const maxDist = chain.upperLen + chain.lowerLen;
        const dx = chain.target.x - root.x;
        const dy = chain.target.y - root.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDist) {
            chain.target.set(
                root.x + (dx / dist) * maxDist,
                root.y + (dy / dist) * maxDist
            );
        }
    }

    /**
     * 检查身体移动 delta 后，所有锁定的肢体是否仍能到达其岩点目标。
     * 如果任何锁定肢体无法到达，返回 false。
     * 注意：此检查在 clampHipToAdsorbedLegs/clampHipToAdsorbedArms 之后执行，
     * 那些函数已经确保了髋部在腿长/臂长范围内，此处做最终验证。
     */
    private canAllLockedLimbsReachAfterBodyMove(deltaX: number, deltaY: number): boolean {
        // 计算移动后的髋部和肩部位置
        const newHipX = this.hip.x + deltaX;
        const newHipY = this.hip.y + deltaY;
        const newShoulderY = this.shoulder.y + deltaY;
        const newShoulderX = newHipX + this.torsoLean;
        const shoulderHalfW = this.appearance.torsoWidth * 0.9 / 2 * this.scaleFactor;
        const hipHalfW = this.appearance.torsoWidth * 0.35 * this.scaleFactor;

        for (const [part, hold] of this.adsorbedHold) {
            const chain = this.getChainByPart(part);
            if (!chain) continue;

            // 计算移动后该肢体的新 root
            let newRoot: Vec2;
            let hipDxForLeg: number = 0;
            if (part === 'leftHand') {
                newRoot = new Vec2(newShoulderX - shoulderHalfW, newShoulderY);
            } else if (part === 'rightHand') {
                newRoot = new Vec2(newShoulderX + shoulderHalfW, newShoulderY);
            } else if (part === 'leftFoot') {
                hipDxForLeg = -hipHalfW;
                newRoot = new Vec2(newHipX + hipDxForLeg, newHipY);
            } else if (part === 'rightFoot') {
                hipDxForLeg = hipHalfW;
                newRoot = new Vec2(newHipX + hipDxForLeg, newHipY);
            } else {
                continue;
            }

            const maxLen = chain.upperLen + chain.lowerLen;

            if (hold.type === HoldType.VOLUME) {
                // Volume：检查新 root 能否到达 Volume 线段上的任意点
                const segment = hold.getVolumeLineSegment();
                if (!segment) return false;
                const distToStart = Vec2.distance(newRoot, segment.start);
                const distToEnd = Vec2.distance(newRoot, segment.end);
                if (Math.min(distToStart, distToEnd) > maxLen + 1e-3) {
                    const closestOnLine = hold.getClosestPointOnVolumeLine(newRoot);
                    if (!closestOnLine || Vec2.distance(newRoot, closestOnLine) > maxLen + 1e-3) {
                        return false;
                    }
                }
            } else {
                // 点吸附：检查新 root 到岩点位置的距离
                // 对于脚，使用与 clampHipToAdsorbedLegs 相同的 target 计算方式
                let targetX: number, targetY: number;
                if (part === 'leftFoot' || part === 'rightFoot') {
                    targetX = chain.target.x;
                    targetY = chain.target.y;
                } else {
                    const lockPos = hold.getAdsorbedPosition(chain.target) ?? hold.localPos;
                    targetX = lockPos.x;
                    targetY = lockPos.y;
                }
                const dist = Vec2.distance(newRoot, new Vec2(targetX, targetY));
                if (dist > maxLen + 1e-3) {
                    return false;
                }
            }
        }
        return true;
    }

    private moveBodyByDelta(dx: number, dy: number, reduceTorsoLean: boolean = true) {
        // ★ 身体移动限制：没有支撑线则无法移动身体
        const supportRange = this.getSupportXRange();
        if (!supportRange) return;

        let newX = this.hip.x + dx * 0.6;
        let newY = this.hip.y + dy;

        const valid = this.clampHipPosition(newX, newY);

        const delta = new Vec2(valid.x - this.hip.x, valid.y - this.hip.y);
        if (delta.x === 0 && delta.y === 0) return;

        // ★ 关键检查：身体移动后，所有锁定的肢体是否仍能到达岩点
        if (!this.canAllLockedLimbsReachAfterBodyMove(delta.x, delta.y)) {
            return;
        }

        this.moveBodyRoots(delta.x, delta.y);

        const limbs: { chain: BoneChain; part: BodyPart }[] = [
            { chain: this.leftArm, part: 'leftHand' },
            { chain: this.rightArm, part: 'rightHand' },
            { chain: this.leftLeg, part: 'leftFoot' },
            { chain: this.rightLeg, part: 'rightFoot' },
        ];

        // ★ 需求1：没有任何锁定点时，站在地面上的脚Y锁定在地面，X可随身体滑动
        const noHoldsAndFeetOnGround = this.hasNoLockedHolds() && this.hasAnyFootOnGround();

        for (const { chain, part } of limbs) {
            if (!this.adsorbedHold.has(part)) {
                chain.target.add(delta);
                // 脚在地面上：锁定Y到地面，但允许X随身体滑动
                if (noHoldsAndFeetOnGround && this.isFootOnGround(part)) {
                    chain.target.y = this.groundY;
                    // 确保脚在腿长可达范围内
                    this.clampFootToGroundReach(chain);
                }
            }
        }

        for (const [part, hold] of this.adsorbedHold) {
            const chain = this.getChainByPart(part);
            if (!chain) continue;
            if (hold.type === HoldType.VOLUME && (part === 'leftHand' || part === 'rightHand')) {
                const lineTarget = hold.getClosestPointOnVolumeLine(chain.target) ?? chain.target.clone();
                const reachable = hold.getReachablePointOnVolumeLine(chain.root, lineTarget, chain.upperLen + chain.lowerLen);
                if (reachable) {
                    chain.target.set(reachable);
                } else {
                    chain.target.set(lineTarget);
                }
            } else if (part === 'leftFoot' || part === 'rightFoot') {
                // 脚固定：重新锁定到岩点位置
                const lockPos = hold.getAdsorbedPosition(chain.target);
                if (lockPos) chain.target.set(lockPos);
                else chain.target.set(hold.localPos);
            } else {
                const lockPos = hold.getAdsorbedPosition(chain.target);
                if (lockPos) chain.target.set(lockPos);
                else chain.target.set(hold.localPos);
            }
        }

        this.updateKneeAbduction();
        this.updateArmAbduction();
        for (const { chain } of limbs) chain.solve();
        if (reduceTorsoLean && this.tryReduceTorsoLean()) {
            // torsoLean 回正导致手臂 root 移动，将未锁定手臂的 target 同步到当前 end
            for (const { chain, part } of limbs) {
                if (!this.adsorbedHold.has(part) && chain.isArm) {
                    chain.target.set(chain.end);
                }
            }
        }
    }

    /**
     * 检查脚是否在地面上（未吸附到岩点，但在接地容忍范围内）
     */
    private isFootOnGround(part: BodyPart): boolean {
        if (part !== 'leftFoot' && part !== 'rightFoot') return false;
        if (this.adsorbedHold.has(part)) return false; // 吸附在岩点上不算"站在地面上"
        const chain = this.getChainByPart(part);
        if (!chain) return false;
        return Math.abs(chain.target.y - this.groundY) < this.groundStandTolerance;
    }

    /**
     * 检查是否有任何脚站在地面上（未吸附）
     */
    private hasAnyFootOnGround(): boolean {
        return this.isFootOnGround('leftFoot') || this.isFootOnGround('rightFoot');
    }

    /**
     * 检查是否没有任何锁定点（手脚都没有吸附到岩点）
     */
    private hasNoLockedHolds(): boolean {
        return this.adsorbedHold.size === 0;
    }

    private isPartUnderForce(part: BodyPart): boolean {
        const hold = this.adsorbedHold.get(part);
        if (!hold) return false;

        const chain = this.getChainByPart(part);
        if (!chain) return false;

        // 脚部不参与角度判定
        if (part === 'leftFoot' || part === 'rightFoot') {
            return hold.allowFootStand || hold.allowFootHook;
        }

        // 拉力方向：小臂方向（肘 → 手），即 mid - end
        const pullDir = new Vec2(chain.mid.x - chain.end.x, chain.mid.y - chain.end.y);
        const len = pullDir.length();
        if (len < 0.001) return false;
        pullDir.normalize();

        return hold.isForceInRange(pullDir);
    }

    /**
     * ★ 需求1：没有任何锁定点时，约束髋部使站在地面上的脚不离开地面。
     * 对于每只在地面上的脚，髋部到该脚的距离不能超过腿长。
     */
    private clampHipToGroundFeet(hipX: number, hipY: number): Vec2 {
        const hipHalfW = this.appearance.torsoWidth * 0.35 * this.scaleFactor;

        const groundFeet: { leg: BoneChain; hipDx: number }[] = [];
        if (this.isFootOnGround('leftFoot')) {
            groundFeet.push({ leg: this.leftLeg, hipDx: -hipHalfW });
        }
        if (this.isFootOnGround('rightFoot')) {
            groundFeet.push({ leg: this.rightLeg, hipDx: hipHalfW });
        }
        if (groundFeet.length === 0) return new Vec2(hipX, hipY);

        for (let iter = 0; iter < 2; iter++) {
            for (const { leg, hipDx } of groundFeet) {
                const maxLen = leg.upperLen + leg.lowerLen;
                // 脚在地面上的目标位置
                const targetX = leg.target.x;
                const targetY = leg.target.y;
                // 髋部连接点 = hip + hipDx
                const rootX = hipX + hipDx;
                const rootY = hipY;

                const dx = rootX - targetX;
                const dy = rootY - targetY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > maxLen) {
                    // 约束髋部使腿能够到达脚
                    const constrainedRootX = targetX + (dx / dist) * maxLen;
                    const constrainedRootY = targetY + (dy / dist) * maxLen;
                    hipX = constrainedRootX - hipDx;
                    hipY = constrainedRootY;
                }
            }
        }
        return new Vec2(hipX, hipY);
    }

    /**
     * 综合髋部位置约束：依次应用腿部吸附、手臂吸附、地面脚、髋部连线、脚高度约束。
     */
    private clampHipPosition(hipX: number, hipY: number): Vec2 {
        let valid = this.clampHipToAdsorbedLegs(hipX, hipY);
        valid = this.clampHipToAdsorbedArms(valid.x, valid.y);

        if (this.hasNoLockedHolds()) {
            valid = this.clampHipToGroundFeet(valid.x, valid.y);
        }

        // 髋部连线距离限制
        const footA = this.leftLeg.target;
        const footB = this.rightLeg.target;
        const fdx = footB.x - footA.x;
        const fdy = footB.y - footA.y;
        const lenSq = fdx * fdx + fdy * fdy;
        if (lenSq < 0.001) {
            if (valid.y < footA.y + this.minHipToFeetLineDist) {
                const angle = Math.atan2(valid.y - footA.y, valid.x - footA.x);
                valid.x = footA.x + Math.cos(angle) * this.minHipToFeetLineDist;
                valid.y = footA.y + Math.sin(angle) * this.minHipToFeetLineDist;
            }
        } else {
            const len = Math.sqrt(lenSq);
            const nx = -fdy / len;
            const ny = fdx / len;
            const signedDist = (valid.x - footA.x) * nx + (valid.y - footA.y) * ny;
            if (signedDist < this.minHipToFeetLineDist) {
                const moveAmount = this.minHipToFeetLineDist - signedDist;
                valid.x += nx * moveAmount;
                valid.y += ny * moveAmount;
            }
        }

        // 髋部必须高于最高脚 + footHipOffset
        const maxFootY = Math.max(this.leftLeg.target.y, this.rightLeg.target.y);
        if (valid.y < maxFootY + this.footHipOffset) {
            valid.y = maxFootY + this.footHipOffset;
        }

        return valid;
    }

    /**
     * ★ 确保脚在地面上的目标点在腿长可达范围内。
     * 脚Y已锁定在groundY，如果髋部到该点的距离超过腿长，沿X方向将脚拉近。
     */
    private clampFootToGroundReach(chain: BoneChain) {
        const maxLen = chain.upperLen + chain.lowerLen;
        const root = chain.root;
        const dx = chain.target.x - root.x;
        const dy = chain.target.y - root.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxLen && dist > 0.001) {
            // 保持Y在地面，沿X方向拉回到可达范围
            // 已知 target.y = groundY，求 target.x 使距离 = maxLen
            // (target.x - root.x)^2 + (groundY - root.y)^2 = maxLen^2
            const dyGround = chain.target.y - root.y;
            const maxDx = Math.sqrt(Math.max(0, maxLen * maxLen - dyGround * dyGround));
            // 保持方向，但限制X偏移
            const sign = dx >= 0 ? 1 : -1;
            chain.target.x = root.x + sign * Math.min(Math.abs(dx), maxDx);
        }
    }

    /**
     * ★ 每帧调用：确保所有未吸附到岩点的脚不低于地面。
     * 如果脚Y低于groundY，将其钳制到groundY，并确保在腿长可达范围内。
     */
    private clampFeetAboveGround() {
        for (const part of ['leftFoot', 'rightFoot'] as BodyPart[]) {
            if (this.adsorbedHold.has(part)) continue; // 吸附在岩点上的脚不受地面限制
            const chain = this.getChainByPart(part);
            if (!chain) continue;
            if (chain.target.y < this.groundY) {
                chain.target.y = this.groundY;
                // 钳制后确保可达
                this.clampFootToGroundReach(chain);
            }
        }
    }

    private clampHipToAdsorbedLegs(hipX: number, hipY: number): Vec2 {
        const hipHalfW = this.appearance.torsoWidth * 0.35 * this.scaleFactor;

        const adsorbedLegs: { leg: BoneChain; hipDx: number; part: BodyPart }[] = [];
        if (this.adsorbedHold.has('leftFoot')) {
            const hold = this.adsorbedHold.get('leftFoot')!;
            adsorbedLegs.push({ leg: this.leftLeg, hipDx: -hipHalfW, part: 'leftFoot' });
        }
        if (this.adsorbedHold.has('rightFoot')) {
            const hold = this.adsorbedHold.get('rightFoot')!;
            adsorbedLegs.push({ leg: this.rightLeg, hipDx: hipHalfW, part: 'rightFoot' });
        }
        if (adsorbedLegs.length === 0) return new Vec2(hipX, hipY);

        for (let iter = 0; iter < 2; iter++) {
            for (const { leg, hipDx, part } of adsorbedLegs) {
                const hold = this.adsorbedHold.get(part)!;
                const maxLen = leg.upperLen + leg.lowerLen;

                // 脚锁定在岩点上，计算髋部连接点到脚目标的距离
                const rootX = hipX + hipDx;
                const rootY = hipY;
                const targetX = leg.target.x;
                const targetY = leg.target.y;

                const dx = rootX - targetX;
                const dy = rootY - targetY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > maxLen) {
                    // 约束髋部连接点，使腿能到达脚目标
                    const constrainedRootX = targetX + (dx / dist) * maxLen;
                    const constrainedRootY = targetY + (dy / dist) * maxLen;
                    hipX = constrainedRootX - hipDx;
                    hipY = constrainedRootY;
                }
            }
        }
        return new Vec2(hipX, hipY);
    }

    private checkArmForceAngles(dt: number) {
        for (const part of ['leftHand', 'rightHand'] as BodyPart[]) {
            const hold = this.adsorbedHold.get(part);
            if (!hold) {
                this.forceAngleTimer.delete(part);
                continue;
            }

            const chain = this.getChainByPart(part);
            if (!chain) continue;

            // 拉力方向：小臂方向（肘 → 手），即 mid - end
            const pullDir = new Vec2(chain.mid.x - chain.end.x, chain.mid.y - chain.end.y);
            const len = pullDir.length();
            if (len < 0.001) continue;
            pullDir.normalize();

            if (!hold.isForceInRange(pullDir)) {
                // 超出范围，累计时间
                const currentTimer = this.forceAngleTimer.get(part) || 0;
                const newTimer = currentTimer + dt * 1000;
                if (newTimer >= this.forceAngleToleranceTime * 1000) {
                    this.releaseHoldAndCooldown(part, true);
                    this.forceAngleTimer.delete(part);
                } else {
                    this.forceAngleTimer.set(part, newTimer);
                }
            } else {
                this.forceAngleTimer.delete(part);
            }
        }
    }

    private onFall() {
        console.warn("失衡掉落！");
        this.resetToInitialPose();
    }

    private checkBalance(dt: number) {
        if (!this.isComOverSupport()) {
            this.imbalanceTimer += dt * 1000;
            if (this.imbalanceTimer >= this.balanceToleranceTime * 1000) {
                this.onFall();
            }
        } else {
            this.imbalanceTimer = 0;
        }
    }

    private clampHipToAdsorbedArms(hipX: number, hipY: number): Vec2 {
        const shoulderOffsetY = this.shoulder.y - this.hip.y;
        const shoulderHalfW = this.appearance.torsoWidth * 0.9 / 2 * this.scaleFactor;

        const adsorbedArms: { arm: BoneChain; shoulderDx: number; part: BodyPart }[] = [];
        if (this.adsorbedHold.has('leftHand')) {
            const hold = this.adsorbedHold.get('leftHand')!;
            adsorbedArms.push({ arm: this.leftArm, shoulderDx: -shoulderHalfW, part: 'leftHand' });
        }
        if (this.adsorbedHold.has('rightHand')) {
            const hold = this.adsorbedHold.get('rightHand')!;
            adsorbedArms.push({ arm: this.rightArm, shoulderDx: shoulderHalfW, part: 'rightHand' });
        }
        if (adsorbedArms.length === 0) return new Vec2(hipX, hipY);

        for (let iter = 0; iter < 2; iter++) {
            for (const { arm, shoulderDx, part } of adsorbedArms) {
                const hold = this.adsorbedHold.get(part)!;
                const shoulderPos = new Vec2(hipX + this.torsoLean + shoulderDx, hipY + shoulderOffsetY);
                const maxLen = arm.upperLen + arm.lowerLen;

                if (hold.type === HoldType.VOLUME) {
                    // Volume：检查肩膀是否能到达 Volume 线段上的任意点
                    // 取线段两端点，看肩膀能否到达其中至少一个
                    const segment = hold.getVolumeLineSegment();
                    if (segment) {
                        const distToStart = Vec2.distance(shoulderPos, segment.start);
                        const distToEnd = Vec2.distance(shoulderPos, segment.end);
                        const minDistToVolume = Math.min(distToStart, distToEnd);
                        // 如果肩膀到 Volume 最近端点的距离超过臂长，需要约束
                        if (minDistToVolume > maxLen) {
                            // 找 Volume 上离肩膀最近的可达点
                            const closestOnLine = hold.getClosestPointOnVolumeLine(shoulderPos);
                            if (closestOnLine) {
                                const dx = shoulderPos.x - closestOnLine.x;
                                const dy = shoulderPos.y - closestOnLine.y;
                                const dist = Math.sqrt(dx * dx + dy * dy);
                                if (dist > maxLen && dist > 0.001) {
                                    // 约束髋部使肩膀能到达 Volume
                                    const constrainedShoulderX = closestOnLine.x + (dx / dist) * maxLen;
                                    const constrainedShoulderY = closestOnLine.y + (dy / dist) * maxLen;
                                    hipX = constrainedShoulderX - this.torsoLean - shoulderDx;
                                    hipY = constrainedShoulderY - shoulderOffsetY;
                                }
                            }
                        }
                        // 如果 minDistToVolume <= maxLen，肩膀能到达 Volume，不约束
                    }
                } else {
                    // 点吸附：基于肩膀实际位置约束髋部
                    const dx = shoulderPos.x - arm.target.x;
                    const dy = shoulderPos.y - arm.target.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > maxLen) {
                        const constrainedShoulderX = arm.target.x + (dx / dist) * maxLen;
                        const constrainedShoulderY = arm.target.y + (dy / dist) * maxLen;
                        hipX = constrainedShoulderX - this.torsoLean - shoulderDx;
                        hipY = constrainedShoulderY - shoulderOffsetY;
                    }
                }
            }
        }
        return new Vec2(hipX, hipY);
    }

    private moveBodyRoots(deltaX: number, deltaY: number) {
        this.hip.x += deltaX; this.hip.y += deltaY;
        this.shoulder.y += deltaY;
        this.head.x += deltaX; this.head.y += deltaY;
        this.updateShoulderPositions();
        const hipHalfW = this.appearance.torsoWidth * 0.35 * this.scaleFactor;
        this.leftLeg.root.set(this.hip.x - hipHalfW, this.hip.y);
        this.rightLeg.root.set(this.hip.x + hipHalfW, this.hip.y);
    }

    /**
     * 按下 W 键时调用：逐步减小 torsoLean 直到双臂仍能到达各自锁定目标的最小角度。
     * 如果双臂均未锁定，则直接回正到 0。
     */
    public resetTorsoLeanIfPossible() {
        if (this.torsoLean === 0) return;

        const originalLean = this.torsoLean;
        const leanSign = Math.sign(this.torsoLean);
        const oldLeftRoot = this.leftArm.root.clone();
        const oldRightRoot = this.rightArm.root.clone();
        const oldShoulderX = this.shoulder.x;

        let bestLean = originalLean;
        const step = 1;
        for (let delta = step; delta <= Math.abs(originalLean); delta += step) {
            const testLean = originalLean - leanSign * delta;
            this.torsoLean = testLean;
            this.updateShoulderPositions();

            const leftCanReach = this.canRootReachCurrentTarget(this.leftArm, 'leftHand');
            const rightCanReach = this.canRootReachCurrentTarget(this.rightArm, 'rightHand');

            if (leftCanReach && rightCanReach) {
                bestLean = testLean;
                if (testLean === 0) break;
            } else {
                break;
            }
        }

        if (bestLean !== originalLean) {
            // 成功减小了角度
            this.torsoLean = bestLean;
            this.updateShoulderPositions();
            this.solveAllChains();
            return;
        }

        // 无法减小，恢复原状
        this.torsoLean = originalLean;
        this.shoulder.x = oldShoulderX;
        this.leftArm.root.set(oldLeftRoot);
        this.rightArm.root.set(oldRightRoot);
        this.updateShoulderPositions();
    }

    private tryReduceTorsoLean(): boolean {
        if (this.torsoLean === 0) return false;
        const originalLean = this.torsoLean;
        const leanSign = Math.sign(this.torsoLean);
        const oldLeftRoot = this.leftArm.root.clone();
        const oldRightRoot = this.rightArm.root.clone();
        const oldShoulderX = this.shoulder.x;

        let bestLean = originalLean;
        const step = 1;
        for (let delta = step; delta <= Math.abs(originalLean); delta += step) {
            const testLean = originalLean - leanSign * delta;
            this.torsoLean = testLean;
            this.updateShoulderPositions();
            const leftCanReach = this.canRootReachCurrentTarget(this.leftArm, 'leftHand');
            const rightCanReach = this.canRootReachCurrentTarget(this.rightArm, 'rightHand');
            if (leftCanReach && rightCanReach) {
                bestLean = testLean;
                if (testLean === 0) break;
            } else {
                break;
            }
        }

        if (bestLean !== originalLean) {
            this.torsoLean = bestLean;
            this.updateShoulderPositions();
            this.solveAllChains();
            return true;
        }

        this.torsoLean = originalLean;
        this.shoulder.x = oldShoulderX;
        this.leftArm.root.set(oldLeftRoot);
        this.rightArm.root.set(oldRightRoot);
        this.updateShoulderPositions();
        return false;
    }

    private canRootReachCurrentTarget(chain: BoneChain, part: BodyPart): boolean {
        if (!chain || !chain.isArm) return true;
        const hold = this.adsorbedHold.get(part);
        if (!hold) return true;

        const maxLen = chain.upperLen + chain.lowerLen;
        const target = chain.target.clone();
        const dist = Vec2.distance(chain.root, target);
        if (dist <= maxLen + 1e-3) return true;

        if (hold.type === HoldType.VOLUME) {
            const reachable = hold.getReachablePointOnVolumeLine(chain.root, target, maxLen);
            return reachable !== null && Vec2.distance(chain.root, reachable) <= maxLen + 1e-3;
        }

        return false;
    }

    public releaseHoldAndCooldown(part: BodyPart, fromTimeout: boolean = false) {
        const hold = this.adsorbedHold.get(part);
        if (hold) {
            this.adsorbedHold.delete(part);
            this.dragOffset.set(0, 0);
            this.holdManager.startCooldown(hold);       // 岩点冷却
            this.forceAngleTimer.delete(part);          // ★ 清除超限计时
            // ★ 只有因超时脱落才记录，允许该肢体继续操作时无视冷却重新吸附
            if (fromTimeout) {
                this.timeoutReleasedHold.set(part, hold);
            }
            const chain = this.getChainByPart(part);
            if (chain && chain.isArm) {
                chain.preferVertical = false;
                chain.maxVerticalAngle = 0;
            }
        }
    }

    /**
     * 检查起步条件：在未起步状态下，若四肢都锁定且都位于起步点且处于合法角度，则触发起步
     */
    private checkStartCondition() {
        if (!this.holdManager) return;
        if (this.holdManager.started) return;

        // 必须有四个肢体都锁定
        const parts: BodyPart[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'];
        for (const p of parts) {
            if (!this.adsorbedHold.has(p)) return;
        }

        // 检查每个锁定点是否为起步点，以及角度是否合法
        for (const p of parts) {
            const hold = this.adsorbedHold.get(p)!;
            if (!hold.isStartPoint) return;
            if (p === 'leftHand' || p === 'rightHand') {
                if (!this.isPartUnderForce(p)) return;
            } else {
                // 脚：至少需要允许站立/钩挂其中一种
                if (!hold.allowFootStand && !hold.allowFootHook) return;
            }
        }

        // 满足起步条件
        this.holdManager.setStarted(true);
        console.log('起步成功');
        // 可在此处发出事件，供 UI/流程逻辑监听
        this.node.emit('gameStart');
    }

    /**
     * 检查结束条件：已起步且未结束时，若双手都锁在同一终点且角度合法，则触发结束
     */
    private checkFinishCondition() {
        if (!this.holdManager) return;
        if (!this.holdManager.started) return;
        if (this.holdManager.finished) return;

        const left = this.adsorbedHold.get('leftHand');
        const right = this.adsorbedHold.get('rightHand');
        if (!left || !right) return;
        if (left !== right) return;
        if (!left.isFinishPoint) return;
        // 双手角度必须合法
        if (!this.isPartUnderForce('leftHand') || !this.isPartUnderForce('rightHand')) return;

        // 满足结束条件
        this.holdManager.setFinished(true);
        console.log('到达终点，游戏结束');
        this.node.emit('gameFinish');
    }

    public toggleBodyFollow() {
        this.followBodyWithArm = !this.followBodyWithArm;
    }


    private updateKneeAbduction() {
        // 预留：未来可根据游戏状态调整膝关节方向偏好
    }

    private updateArmAbduction() {
        // 预留：未来可根据游戏状态调整手臂外展方向偏好
    }

    update(dt: number) {
        this.updateKneeAbduction();
        this.updateArmAbduction();
        this.solveAllChains();
        this.clampFeetAboveGround();  // 确保所有未吸附的脚不低于地面
        this.checkArmForceAngles(dt);
        this.checkBalance(dt);     
        this.drawCharacter();
    }

    private solveAllChains() {
        const chains = [this.leftArm, this.rightArm, this.leftLeg, this.rightLeg];
        for (const chain of chains) chain.solve();
    }

    getCenterOfMass(): Vec2 {
        const headMass = 0.07, torsoMass = 0.43, upperArmMass = 0.03, forearmMass = 0.02, handMass = 0.01;
        const thighMass = 0.1, shankMass = 0.05, footMass = 0.02;
        let totalMass = 0, wx = 0, wy = 0;
        const add = (pos: Vec2, mass: number) => {
            wx += pos.x * mass; wy += pos.y * mass; totalMass += mass;
        };
        add(this.head, headMass);
        const torsoCenter = new Vec2(this.shoulder.x, (this.shoulder.y + this.hip.y) / 2);
        add(torsoCenter, torsoMass);
        add(this.leftArm.root, upperArmMass); add(this.leftArm.mid, forearmMass); add(this.leftArm.end, handMass);
        add(this.rightArm.root, upperArmMass); add(this.rightArm.mid, forearmMass); add(this.rightArm.end, handMass);
        add(this.leftLeg.root, thighMass); add(this.leftLeg.mid, shankMass); add(this.leftLeg.end, footMass);
        add(this.rightLeg.root, thighMass); add(this.rightLeg.mid, shankMass); add(this.rightLeg.end, footMass);
        return new Vec2(wx / totalMass, wy / totalMass);
    }

    drawCharacter() {
        const gfx = this.node.getComponent(Graphics);
        if (!gfx) return;

        PlayerRenderer.drawCharacter(
            gfx,
            this.scaleFactor,
            this.appearance,
            this.head,
            this.shoulder,
            this.hip,
            this.leftShoulder,
            this.rightShoulder,
            this.leftArm,
            this.rightArm,
            this.leftLeg,
            this.rightLeg,
            this.activePart,
            this.groundY,
            this.handEndRadius,
            this.footEndRadius,
            this.handEndColor,
            this.footEndColor,
            this.forceColor,
            this.noForceColor,
            this.supportPolygonColor,
            this.footWidth,
            this.imbalanceTimer,
            this.adsorbedHold,
            this.isPartUnderForce.bind(this),
            this.getCenterOfMass.bind(this),
            this.getSupportXRange.bind(this),
            this.holdManager,
            this.gameLayer,
        );
    }

}