import { _decorator, Component, Node, Graphics, Vec2, Color, UITransform } from 'cc';
import { HoldManager } from './hold/HoldManager';
import { HoldBase, HoldType } from './hold/HoldBase';
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

class BoneChain {
    root: Vec2 = new Vec2();
    mid: Vec2 = new Vec2();
    end: Vec2 = new Vec2();
    upperLen: number;
    lowerLen: number;
    target: Vec2 = new Vec2();
    isLeft: boolean;
    abductionPixels: number = 0;
    preferVertical: boolean = false;
    maxVerticalAngle: number = 0;
    preferredSide: 'left' | 'right' | 'auto' = 'auto';
    isArm: boolean = false;
    desiredElbowUp: boolean | null = null; 

    constructor(root: Vec2, mid: Vec2, end: Vec2, upperLen: number, lowerLen: number, isLeft: boolean) {
        this.root.set(root);
        this.mid.set(mid);
        this.end.set(end);
        this.upperLen = upperLen;
        this.lowerLen = lowerLen;
        this.isLeft = isLeft;
        this.target.set(end);
    }

    solve(): boolean {
        const root = this.root;
        const target = this.target;
        const upper = this.upperLen;
        const lower = this.lowerLen;

        const dx = target.x - root.x;
        const dy = target.y - root.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = upper + lower;
        const minDist = Math.abs(upper - lower);

        if (dist >= maxDist - 1e-3) {
            if (dist < 1e-3) return true;
            const nx = dx / dist;
            const ny = dy / dist;
            this.mid.set(root.x + nx * upper, root.y + ny * upper);
            this.end.set(root.x + nx * maxDist, root.y + ny * maxDist);
            return false;
        }

        if (dist <= minDist + 1e-3) {
            if (dist < 1e-3) return true;
            const nx = dx / dist;
            const ny = dy / dist;
            this.mid.set(root.x + nx * upper, root.y + ny * upper);
            this.end.set(root.x + nx * minDist, root.y + ny * minDist);
            return false;
        }

        const nearStretch = 10.0;
        if (dist >= maxDist - nearStretch) {
            const nx = dx / dist;
            const ny = dy / dist;
            this.mid.set(root.x + nx * upper, root.y + ny * upper);
            this.end.set(target.x, target.y);
            return true;
        }

        const a = upper, b = lower, c = dist;
        const cosInner = (a * a + b * b - c * c) / (2 * a * b);
        const innerAngle = Math.acos(Math.max(-1, Math.min(1, cosInner)));
        const baseDir = new Vec2(dx / dist, dy / dist);
        const rotateRad = (Math.PI - innerAngle) / 2;

        const candidates: Vec2[] = [];
        for (const sign of [1, -1]) {
            const rot = rotateRad * sign;
            const upperDir = new Vec2(
                baseDir.x * Math.cos(rot) - baseDir.y * Math.sin(rot),
                baseDir.x * Math.sin(rot) + baseDir.y * Math.cos(rot)
            );
            const mid = new Vec2(root.x + upperDir.x * upper, root.y + upperDir.y * upper);
            candidates.push(mid);
        }

        let chosenMid: Vec2;

        // 侧身强制方向
        if (this.preferredSide === 'left') {
            chosenMid = candidates[0].x <= candidates[1].x ? candidates[0] : candidates[1];
        } else if (this.preferredSide === 'right') {
            chosenMid = candidates[0].x >= candidates[1].x ? candidates[0] : candidates[1];
        }
        // 自然方向
        else {
            if (this.isArm) {
                const perpX = this.isLeft ? -dy : dy;
                const perpY = this.isLeft ? dx : -dx;
                let bestIdx = 0;
                let bestDot = -Infinity;
                for (let i = 0; i < 2; i++) {
                    const mid = candidates[i];
                    const midVecX = mid.x - root.x;
                    const midVecY = mid.y - root.y;
                    const dot = midVecX * perpX + midVecY * perpY;
                    if (dot > bestDot) {
                        bestDot = dot;
                        bestIdx = i;
                    }
                }
                chosenMid = candidates[bestIdx];
            } else {
                // 腿部原有逻辑：左膝向左，右膝向右
                if (this.isLeft) {
                    chosenMid = candidates[0].x < candidates[1].x ? candidates[0] : candidates[1];
                } else {
                    chosenMid = candidates[0].x > candidates[1].x ? candidates[0] : candidates[1];
                }
            }
        }

        this.mid.set(chosenMid);

        const forearmDir = new Vec2(target.x - this.mid.x, target.y - this.mid.y);
        const forearmDist = forearmDir.length();
        if (forearmDist > 0.001) {
            forearmDir.normalize();
            this.end.set(this.mid.x + forearmDir.x * lower, this.mid.y + forearmDir.y * lower);
        } else {
            this.end.set(target);
        }
        return true;
    }
}

@ccclass('Player')
export class Player extends Component {

    @property(Node)
    gameLayer: Node = null!;

    @property({ type: Node, tooltip: '出生点节点，控制玩家初始X坐标' })
    spawnPoint: Node = null!;

    @property(HoldManager)
    holdManager: HoldManager = null!;

    @property({ tooltip: '角色整体缩放比例' })
    scaleFactor: number = 1.0;

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

    activePart: BodyPart = 'leftHand';
    followBodyWithArm: boolean = false;

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
        const s = this.scaleFactor;

        // 1. 计算初始关节位置（未考虑地面）
        this.initPose();

        // 2. 计算四肢自然垂落/分开的目标位置（基于当前肩髋位置）
        const shoulderHalfW = this.appearance.torsoWidth * 0.9 / 2 * s;
        const hipHalfW = this.appearance.torsoWidth * 0.35 * s;

        // 手臂总长
        const totalArmLen = (this.upperArmLen + this.forearmLen) * s;
        // 手臂与竖直方向夹角 30°（向外）
        const armAngle = 30 * Math.PI / 180;
        const armDx = Math.sin(armAngle) * totalArmLen;
        const armDy = Math.cos(armAngle) * totalArmLen;  // 向下

        const leftHandTarget = new Vec2(
            this.leftShoulder.x - armDx,
            this.leftShoulder.y - armDy
        );
        const rightHandTarget = new Vec2(
            this.rightShoulder.x + armDx,
            this.rightShoulder.y - armDy
        );

        // 腿总长
        const totalLegLen = (this.upperLegLen + this.lowerLegLen) * s;
        // 腿与竖直方向夹角 30°（向外），双脚呈 60°
        const legAngle = 30 * Math.PI / 180;
        const legDx = Math.sin(legAngle) * totalLegLen;
        const legDy = Math.cos(legAngle) * totalLegLen;

        const leftHipX = -hipHalfW;
        const rightHipX = hipHalfW;
        const leftFootTarget = new Vec2(
            this.hip.x + leftHipX - legDx,
            this.hip.y - legDy
        );
        const rightFootTarget = new Vec2(
            this.hip.x + rightHipX + legDx,
            this.hip.y - legDy
        );

        // 3. 自然脚底最低点
        const naturalFootY = Math.min(leftFootTarget.y, rightFootTarget.y);

        // 4. 地平线位置（基于 GameLayer 高度）
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

        // 5. 整体垂直平移，使脚底对齐地平线
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

        // 6. 根据出生点节点调整角色水平位置
        let deltaX = 0;
        if (this.spawnPoint) {
            const spawnX = this.spawnPoint.position.x;  // 假设在同一父节点下
            const currentCenterX = (this.leftShoulder.x + this.rightShoulder.x) / 2; // 以肩中心为准
            deltaX = spawnX - currentCenterX;
        }

        this.shoulder.x += deltaX;
        this.hip.x += deltaX;
        this.head.x += deltaX;
        this.leftShoulder.x += deltaX;
        this.rightShoulder.x += deltaX;

        leftHandTarget.x += deltaX;
        rightHandTarget.x += deltaX;
        leftFootTarget.x += deltaX;
        rightFootTarget.x += deltaX;

        // 7. 保存初始髋部高度
        this.initialHipY = this.hip.y;

        // 8. 使用平移后的坐标初始化骨链
        this.initBoneChains(leftHandTarget, rightHandTarget, leftFootTarget, rightFootTarget);
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
            this.torsoLean = this.clampTorsoLean(this.torsoLean + leanDelta);
            this.updateShoulderPositions();
            const newDist = Vec2.distance(chain.root, new Vec2(desiredX, desiredY));
            return newDist <= maxDist + 1e-3 && Math.abs(this.torsoLean - oldLean) > 0.5;
        }

        const shiftX = dx / dist * Math.min(dist * this.torsoAssistFactor * 0.25, this.maxTorsoLean * 0.5);
        this.moveBodyByDelta(shiftX, 0);
        const newDist = Vec2.distance(chain.root, new Vec2(desiredX, desiredY));
        return newDist <= maxDist + 1e-3;
    }

    resetToInitialPose() {
        const s = this.scaleFactor;

        // 1. 恢复基础关节位置
        this.initPose();

        // 2. 重置吸附与拖拽状态
        this.adsorbedHold.clear();
        this.dragOffset.set(0, 0);
        this.activePart = 'leftHand';

        // 3. 计算地平线位置（与 start 中一致）
        let targetGroundY = -800 * s;
        if (this.gameLayer) {
            const uiTransform = this.gameLayer.getComponent('cc.UITransform') as any;
            if (uiTransform) {
                const height = uiTransform.height;
                const margin = 50 * s;
                targetGroundY = -height / 2 + margin;
            }
        }
        this.groundY = targetGroundY;

        // 4. 计算四肢自然姿态的目标位置（双脚60°，手臂自然垂落30°）
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
        const leftHipX = -hipHalfW;
        const rightHipX = hipHalfW;

        const leftFootTarget = new Vec2(this.hip.x + leftHipX - legDx, this.hip.y - legDy);
        const rightFootTarget = new Vec2(this.hip.x + rightHipX + legDx, this.hip.y - legDy);

        // 5. 根据自然脚底位置与地平线对齐，计算垂直偏移
        const naturalFootY = Math.min(leftFootTarget.y, rightFootTarget.y);
        const deltaY = targetGroundY - naturalFootY;

        // 6. 平移所有身体关键点及目标
        this.shoulder.y += deltaY;
        this.hip.y += deltaY;
        this.head.y += deltaY;
        this.leftShoulder.y += deltaY;
        this.rightShoulder.y += deltaY;
        leftHandTarget.y += deltaY;
        rightHandTarget.y += deltaY;
        leftFootTarget.y += deltaY;
        rightFootTarget.y += deltaY;

        // 7. 根据出生点调整水平位置
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

        // 8. 更新初始髋部高度
        this.initialHipY = this.hip.y;

        // 9. 重新创建骨链（或更新目标）
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
     * 质心水平投影是否在支撑区间内
     */
    private isComOverSupport(): boolean {
        const range = this.getSupportXRange();
        if (!range) return true; // 无支撑时不判定为失衡（由其他机制处理）
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
                    if (!this.tryAdjustTorsoForReach(chain, newTargetX, newTargetY)) {
                        if (this.followBodyWithArm && chain.isArm) {
                            const dirX = ndx / dist;
                            const dirY = ndy / dist;
                            chain.target.set(root.x + dirX * maxDist, root.y + dirY * maxDist);
                            const remainDx = newTargetX - chain.target.x;
                            const remainDy = newTargetY - chain.target.y;
                            const bodyDx = remainDx / 0.6;
                            const bodyDy = remainDy;
                            this.moveBodyByDelta(bodyDx, bodyDy);
                        } else {
                            chain.target.set(root.x + (ndx / dist) * maxDist, root.y + (ndy / dist) * maxDist);
                        }
                    }
                }
                this.constrainTargetToReach(chain);

                // 自动吸附检测
                if (this.holdManager) {
                    const nearest = this.holdManager.findNearestHold(chain.target, true);
                    if (nearest) {
                        const adsorbPos = nearest.getAdsorbedPosition(chain.target);
                        if (adsorbPos) {
                            chain.target.set(adsorbPos);
                            this.adsorbedHold.set(this.activePart, nearest);
                            this.dragOffset.set(0, 0);
                            this.lastAdsorbTime = Date.now();
                            this.forceAngleTimer.delete(this.activePart);
                            if (chain.isArm && nearest.type !== HoldType.VOLUME) {
                                chain.preferVertical = true;
                                chain.maxVerticalAngle = 15;
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
                let newX = this.hip.x + dx * 0.6;
                let newY = this.hip.y + dy;

                let valid = this.clampHipToAdsorbedLegs(newX, newY);
                valid = this.clampHipToAdsorbedArms(valid.x, valid.y);

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

                // 脚高度约束（髋部必须高于最高脚 + footHipOffset）
                const maxFootY = Math.max(this.leftLeg.target.y, this.rightLeg.target.y);
                if (valid.y < maxFootY + this.footHipOffset) {
                    valid.y = maxFootY + this.footHipOffset;
                }

                const delta = new Vec2(valid.x - this.hip.x, valid.y - this.hip.y);
                if (delta.x === 0 && delta.y === 0) return false;

                const limbs: { chain: BoneChain; part: BodyPart }[] = [
                    { chain: this.leftArm, part: 'leftHand' },
                    { chain: this.rightArm, part: 'rightHand' },
                    { chain: this.leftLeg, part: 'leftFoot' },
                    { chain: this.rightLeg, part: 'rightFoot' },
                ];

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
                        if (rel) chain.target.set(chain.root.x + rel.x, chain.root.y + rel.y);
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

    private updateVolumeLockedArmTargets() {
        for (const part of ['leftHand', 'rightHand'] as const) {
            const hold = this.adsorbedHold.get(part);
            if (!hold || hold.type !== HoldType.VOLUME) continue;
            const chain = this.getChainByPart(part);
            if (!chain) continue;
            const desiredTarget = hold.getClosestPointOnVolumeLine(chain.target) ?? chain.target.clone();
            const reachablePoint = hold.getReachablePointOnVolumeLine(chain.root, desiredTarget, chain.upperLen + chain.lowerLen);
            if (reachablePoint) {
                chain.target.set(reachablePoint);
            } else if (desiredTarget) {
                chain.target.set(desiredTarget);
            } else {
                chain.target.set(hold.localPos);
            }
        }
    }

    private moveBodyByDelta(dx: number, dy: number) {
        let newX = this.hip.x + dx * 0.6;
        let newY = this.hip.y + dy;

        let valid = this.clampHipToAdsorbedLegs(newX, newY);
        valid = this.clampHipToAdsorbedArms(valid.x, valid.y);

        // 髋部连线距离限制（与 torso 保持一致）
        const applyHipConstraint = (x: number, y: number): Vec2 => {
            const footA = this.leftLeg.target;
            const footB = this.rightLeg.target;
            const fdx = footB.x - footA.x;
            const fdy = footB.y - footA.y;
            const lenSq = fdx * fdx + fdy * fdy;
            if (lenSq < 0.001) {
                if (y < footA.y + this.minHipToFeetLineDist) {
                    const angle = Math.atan2(y - footA.y, x - footA.x);
                    return new Vec2(
                        footA.x + Math.cos(angle) * this.minHipToFeetLineDist,
                        footA.y + Math.sin(angle) * this.minHipToFeetLineDist
                    );
                }
            } else {
                const len = Math.sqrt(lenSq);
                const signedDist = ((x - footA.x) * fdy - (y - footA.y) * fdx) / len;
                if (signedDist < this.minHipToFeetLineDist) {
                    const nx = -fdy / len;
                    const ny = fdx / len;
                    const moveAmount = this.minHipToFeetLineDist - signedDist;
                    return new Vec2(x + nx * moveAmount, y + ny * moveAmount);
                }
            }
            return new Vec2(x, y);
        };

        const constrained = applyHipConstraint(valid.x, valid.y);
        valid.x = constrained.x;
        valid.y = constrained.y;

        // 新增：髋部必须高于最高脚 + footHipOffset
        const maxFootY = Math.max(this.leftLeg.target.y, this.rightLeg.target.y);
        if (valid.y < maxFootY + this.footHipOffset) {
            valid.y = maxFootY + this.footHipOffset;
        }

        const delta = new Vec2(valid.x - this.hip.x, valid.y - this.hip.y);
        if (delta.x === 0 && delta.y === 0) return;

        this.moveBodyRoots(delta.x, delta.y);

        const limbs: { chain: BoneChain; part: BodyPart }[] = [
            { chain: this.leftArm, part: 'leftHand' },
            { chain: this.rightArm, part: 'rightHand' },
            { chain: this.leftLeg, part: 'leftFoot' },
            { chain: this.rightLeg, part: 'rightFoot' },
        ];

        for (const { chain, part } of limbs) {
            if (!this.adsorbedHold.has(part)) {
                chain.target.add(delta);
            }
        }

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

                let targetX: number, targetY: number;
                // ★ 修改：脚锁定在 Volume 上时，直接使用脚当前的目标位置（固定点）
                if (hold.type === HoldType.VOLUME) {
                    // 脚不滑动，使用当前目标（吸附点）
                    targetX = leg.target.x - hipDx;
                    targetY = leg.target.y;
                } else {
                    targetX = leg.target.x - hipDx;
                    targetY = leg.target.y;
                }

                const dx = hipX - targetX;
                const dy = hipY - targetY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > maxLen) {
                    hipX = targetX + (dx / dist) * maxLen;
                    hipY = targetY + (dy / dist) * maxLen;
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
                    this.releaseHoldAndCooldown(part);
                    this.forceAngleTimer.delete(part);
                } else {
                    this.forceAngleTimer.set(part, newTimer);
                }
            } else {
                this.forceAngleTimer.delete(part);
            }
        }
    }
    
    private drawForceSector(gfx: Graphics, center: Vec2, radius: number, centerDir: Vec2, angleDown: number, angleUp: number, color: Color) {
        if (angleDown <= 0 && angleUp <= 0) return;

        const baseAngle = Math.atan2(centerDir.y, centerDir.x);
        const startAngle = baseAngle - angleUp * Math.PI / 180;
        const endAngle = baseAngle + angleDown * Math.PI / 180;
        const totalAngle = endAngle - startAngle;

        if (totalAngle <= 0) return;

        // 填充扇形
        const fillColor = new Color(color.r, color.g, color.b, 50);
        gfx.fillColor = fillColor;
        gfx.moveTo(center.x, center.y);
        const segments = 20;
        for (let i = 0; i <= segments; i++) {
            const a = startAngle + totalAngle * i / segments;
            gfx.lineTo(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius);
        }
        gfx.close();
        gfx.fill();

        // 描边
        gfx.strokeColor = new Color(color.r, color.g, color.b, 180);
        gfx.lineWidth = 3;
        const leftDir = new Vec2(Math.cos(startAngle), Math.sin(startAngle));
        const rightDir = new Vec2(Math.cos(endAngle), Math.sin(endAngle));
        gfx.moveTo(center.x, center.y);
        gfx.lineTo(center.x + leftDir.x * radius, center.y + leftDir.y * radius);
        gfx.stroke();
        gfx.moveTo(center.x, center.y);
        gfx.lineTo(center.x + rightDir.x * radius, center.y + rightDir.y * radius);
        gfx.stroke();

        // 弧线
        let prevX = center.x + Math.cos(startAngle) * radius;
        let prevY = center.y + Math.sin(startAngle) * radius;
        for (let i = 1; i <= segments; i++) {
            const a = startAngle + totalAngle * i / segments;
            const nx = center.x + Math.cos(a) * radius;
            const ny = center.y + Math.sin(a) * radius;
            gfx.moveTo(prevX, prevY);
            gfx.lineTo(nx, ny);
            gfx.stroke();
            prevX = nx;
            prevY = ny;
        }
    }

    private getSupportPoints(): Vec2[] {
        const points: Vec2[] = [];

        // 左脚支撑
        if (this.adsorbedHold.has('leftFoot')) {
            const hold = this.adsorbedHold.get('leftFoot')!;
            if (hold.allowFootStand) {
                points.push(this.leftLeg.target.clone());
            }
        }
        // 右脚支撑
        if (this.adsorbedHold.has('rightFoot')) {
            const hold = this.adsorbedHold.get('rightFoot')!;
            if (hold.allowFootStand) {
                points.push(this.rightLeg.target.clone());
            }
        }
        // 未来可扩展手部支撑（需额外判断）
        return points;
    }

    private onFall() {
        console.warn("失衡掉落！");
        this.resetToInitialPose();
        this.adsorbedHold.clear();
        this.imbalanceTimer = 0;
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

    /**
     * 射线法判断点是否在多边形内（2D）
     */
    private isPointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
        const n = polygon.length;
        if (n === 0) return false;
        if (n === 1) return Vec2.distance(point, polygon[0]) < this.footWidth;
        if (n === 2) {
            const minX = Math.min(polygon[0].x, polygon[1].x);
            const maxX = Math.max(polygon[0].x, polygon[1].x);
            return point.x >= minX && point.x <= maxX;
        }

        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            if ((yi > point.y) !== (yj > point.y) &&
                point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) {
                inside = !inside;
            }
        }
        return inside;
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

                let targetX: number, targetY: number;
                if (hold.type === HoldType.VOLUME) {
                    const desiredTarget = hold.getClosestPointOnVolumeLine(arm.target) ?? arm.target.clone();
                    const currentDist = Vec2.distance(shoulderPos, desiredTarget);
                    let linePoint = desiredTarget;
                    if (currentDist > maxLen) {
                        const reachable = hold.getReachablePointOnVolumeLine(shoulderPos, desiredTarget, maxLen);
                        if (reachable) {
                            linePoint = reachable;
                        } else {
                            const closestOnLine = hold.getClosestPointOnVolumeLine(shoulderPos);
                            if (!closestOnLine) continue;
                            linePoint = closestOnLine;
                        }
                    }
                    targetX = linePoint.x - shoulderDx;
                    targetY = linePoint.y - shoulderOffsetY;
                } else {
                    targetX = arm.target.x - shoulderDx;
                    targetY = arm.target.y - shoulderOffsetY;
                }

                const dx = hipX - targetX;
                const dy = hipY - targetY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > maxLen) {
                    hipX = targetX + (dx / dist) * maxLen;
                    hipY = targetY + (dy / dist) * maxLen;
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
        const hipHalfW = this.appearance.torsoWidth * 0.35;
        this.leftLeg.root.set(this.hip.x - hipHalfW, this.hip.y);
        this.rightLeg.root.set(this.hip.x + hipHalfW, this.hip.y);
    }

    public resetTorsoLeanIfPossible() {
        if (this.torsoLean === 0) return;
        const previousLean = this.torsoLean;
        const safeLean = 0;

        const oldLeftRoot = this.leftArm.root.clone();
        const oldRightRoot = this.rightArm.root.clone();
        const oldShoulderX = this.shoulder.x;

        this.torsoLean = safeLean;
        this.updateShoulderPositions();

        const leftCanReach = this.canRootReachCurrentTarget(this.leftArm, 'leftHand');
        const rightCanReach = this.canRootReachCurrentTarget(this.rightArm, 'rightHand');
        if (!leftCanReach || !rightCanReach) {
            this.torsoLean = previousLean;
            this.shoulder.x = oldShoulderX;
            this.leftArm.root.set(oldLeftRoot);
            this.rightArm.root.set(oldRightRoot);
            this.updateShoulderPositions();
            return;
        }

        // 更新目标与骨链以反映术直躯干状态
        this.solveAllChains();
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

    public releaseHoldAndCooldown(part: BodyPart) {
        const hold = this.adsorbedHold.get(part);
        if (hold) {
            this.adsorbedHold.delete(part);
            this.dragOffset.set(0, 0);
            this.holdManager.startCooldown(hold);       // 岩点冷却
            this.forceAngleTimer.delete(part);          // ★ 清除超限计时
            const chain = this.getChainByPart(part);
            if (chain && chain.isArm) {
                chain.preferVertical = false;
                chain.maxVerticalAngle = 0;
            }
        }
    }

    public toggleBodyFollow() {
        this.followBodyWithArm = !this.followBodyWithArm;
    }


    private updateKneeAbduction() {
        this.leftLeg.preferredSide = 'auto';
        this.rightLeg.preferredSide = 'auto';
    }

    private updateArmAbduction() {
        this.leftArm.abductionPixels = 0;
        this.rightArm.abductionPixels = 0;
        this.leftArm.preferredSide = 'auto';
        this.rightArm.preferredSide = 'auto';
    }

    update(dt: number) {
        this.updateKneeAbduction();
        this.updateArmAbduction();
        this.solveAllChains();
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
        gfx.clear();

        const s = this.scaleFactor;
        const app = this.appearance;
        const limbW = app.limbWidth * s;
        const jointR = app.jointRadius * s;
        const headR = app.headRadius * s;
        const torsoW = app.torsoWidth * s;
        const torsoH = app.torsoHeight * s;

        // 脊柱
        const spineTop = this.shoulder.y + 5 * s;
        const spineBottom = this.hip.y - 5 * s;
        for (let i = 0; i < 5; i++) {
            const t = i / 4, y = spineTop + (spineBottom - spineTop) * t;
            gfx.fillColor = new Color(255, 255, 255, 80);
            gfx.circle(this.shoulder.x, y, 2 * s); gfx.fill();
        }

        // 躯干
        gfx.fillColor = app.clothColor;
        const leftHip = new Vec2(this.hip.x - app.torsoWidth * 0.35 * s, this.hip.y);
        const rightHip = new Vec2(this.hip.x + app.torsoWidth * 0.35 * s, this.hip.y);
        gfx.moveTo(this.leftShoulder.x, this.leftShoulder.y + 5 * s);
        gfx.lineTo(this.rightShoulder.x, this.rightShoulder.y + 5 * s);
        gfx.lineTo(rightHip.x, rightHip.y - 5 * s);
        gfx.lineTo(leftHip.x, leftHip.y - 5 * s);
        gfx.close();
        gfx.fill();

        // 头
        gfx.fillColor = app.hairColor;
        gfx.circle(this.head.x, this.head.y + 2 * s, headR + 2 * s); gfx.fill();
        gfx.fillColor = app.skinColor;
        gfx.circle(this.head.x, this.head.y, headR); gfx.fill();
        gfx.fillColor = new Color(255, 255, 255, 200);
        gfx.circle(this.head.x - 4 * s, this.head.y + 4 * s, 4 * s); gfx.fill();

        // 脖子
        gfx.strokeColor = app.skinColor;
        gfx.lineWidth = 8 * s; gfx.lineCap = Graphics.LineCap.ROUND;
        gfx.moveTo(this.shoulder.x, this.shoulder.y + 15 * s);
        gfx.lineTo(this.head.x, this.head.y - headR); gfx.stroke();

        // 肩髋关节
        gfx.fillColor = app.clothColor;
        gfx.circle(this.leftShoulder.x, this.leftShoulder.y, 8 * s); gfx.fill();
        gfx.circle(this.rightShoulder.x, this.rightShoulder.y, 8 * s); gfx.fill();
        gfx.circle(leftHip.x, leftHip.y, 7 * s); gfx.fill();
        gfx.circle(rightHip.x, rightHip.y, 7 * s); gfx.fill();

        // 四肢（根据锁定和受力状态决定颜色）
        const getLimbColor = (part: BodyPart): Color => {
            if (this.adsorbedHold.has(part)) {
                return this.isPartUnderForce(part) ? this.forceColor : this.noForceColor;
            }
            return app.skinColor;
        };

        gfx.lineWidth = limbW;
        gfx.lineCap = Graphics.LineCap.ROUND;

        gfx.strokeColor = getLimbColor('leftHand');
        this.drawLimb(gfx, this.leftArm.root, this.leftArm.mid, this.leftArm.end);

        gfx.strokeColor = getLimbColor('rightHand');
        this.drawLimb(gfx, this.rightArm.root, this.rightArm.mid, this.rightArm.end);

        gfx.strokeColor = getLimbColor('leftFoot');
        this.drawLimb(gfx, this.leftLeg.root, this.leftLeg.mid, this.leftLeg.end);

        gfx.strokeColor = getLimbColor('rightFoot');
        this.drawLimb(gfx, this.rightLeg.root, this.rightLeg.mid, this.rightLeg.end);

        // 关节
        const jointColor = new Color(app.skinColor.r * 0.7, app.skinColor.g * 0.7, app.skinColor.b * 0.7, 255);
        gfx.fillColor = jointColor;
        gfx.circle(this.leftArm.mid.x, this.leftArm.mid.y, jointR); gfx.fill();
        gfx.circle(this.rightArm.mid.x, this.rightArm.mid.y, jointR); gfx.fill();
        gfx.circle(this.leftLeg.mid.x, this.leftLeg.mid.y, jointR); gfx.fill();
        gfx.circle(this.rightLeg.mid.x, this.rightLeg.mid.y, jointR); gfx.fill();

        // 手脚末端（用可配置的半径和颜色）
        const handEndR = this.handEndRadius * s;
        const footEndR = this.footEndRadius * s;

        gfx.fillColor = this.handEndColor;
        gfx.circle(this.leftArm.end.x, this.leftArm.end.y, handEndR); gfx.fill();
        gfx.circle(this.rightArm.end.x, this.rightArm.end.y, handEndR); gfx.fill();

        gfx.fillColor = this.footEndColor;
        gfx.circle(this.leftLeg.end.x, this.leftLeg.end.y, footEndR); gfx.fill();
        gfx.circle(this.rightLeg.end.x, this.rightLeg.end.y, footEndR); gfx.fill();

        // 质心
        const com = this.getCenterOfMass();
        gfx.fillColor = new Color(255, 255, 0, 255);
        gfx.circle(com.x, com.y, 8 * s); gfx.fill();

        // 失衡警告：质心处红色闪烁
        if (this.imbalanceTimer > 0) {
            const warnAlpha = Math.abs(Math.sin(Date.now() * 0.01)) * 200 + 55;
            gfx.fillColor = new Color(255, 0, 0, warnAlpha);
            gfx.circle(com.x, com.y, 12 * s); // 比质心大一点
            gfx.fill();
            // 可选：绘制一个 X
            gfx.strokeColor = new Color(255, 0, 0, 255);
            gfx.lineWidth = 3 * s;
            gfx.moveTo(com.x - 6 * s, com.y - 6 * s);
            gfx.lineTo(com.x + 6 * s, com.y + 6 * s);
            gfx.moveTo(com.x + 6 * s, com.y - 6 * s);
            gfx.lineTo(com.x - 6 * s, com.y + 6 * s);
            gfx.stroke();
        }

        // 地面线（保持原样，可选缩放）
        gfx.strokeColor = new Color(180, 180, 180, 255);
        gfx.lineWidth = 4 * s;

        // 获取 GameLayer 宽度
        let groundWidth = 700 * s; // 默认值
        if (this.gameLayer) {
            const uiTransform = this.gameLayer.getComponent('cc.UITransform') as any;
            if (uiTransform) {
                groundWidth = uiTransform.width;
            }
        }
        const halfGround = groundWidth / 2;
        gfx.moveTo(-halfGround, this.groundY);
        gfx.lineTo(halfGround, this.groundY);
        gfx.stroke();

        // 选中高亮
        let highlightPos: Vec2 | null = null;
        switch (this.activePart) {
            case 'leftHand': highlightPos = this.leftArm.end; break;
            case 'rightHand': highlightPos = this.rightArm.end; break;
            case 'leftFoot': highlightPos = this.leftLeg.end; break;
            case 'rightFoot': highlightPos = this.rightLeg.end; break;
            case 'torso': highlightPos = com; break;
        }
        if (highlightPos) {
            gfx.strokeColor = new Color(255, 215, 0, 255);
            gfx.lineWidth = 3 * s;
            gfx.circle(highlightPos.x, highlightPos.y, 13 * s); gfx.stroke();
        }

        // ========== 绘制所有非 Volume 岩点的力方向扇形 ==========
        // 绘制所有非 Volume 岩点的力方向扇形
        if (this.holdManager) {
            const allHolds = this.holdManager.getHolds();
            for (const hold of allHolds) {
                if (hold.type === HoldType.VOLUME) continue;
                if (hold.forceAngleDown <= 0 && hold.forceAngleUp <= 0) continue; // 无角度限制不显示
                const centerDir = hold.getWorldForceDirection(); // 向下方向
                const center = hold.localPos;
                const radius = hold.adsorbRadius * s * 1.5;
                this.drawForceSector(gfx, center, radius, centerDir, hold.forceAngleDown, hold.forceAngleUp, hold.forceSectorColor);
            }
        }

        // 调试：在双脚位置画大红点
        if (this.adsorbedHold.has('leftFoot')) {
            gfx.fillColor = new Color(255, 0, 0, 255);
            gfx.circle(this.leftLeg.target.x, this.leftLeg.target.y, 15 * s);
            gfx.fill();
        }
        if (this.adsorbedHold.has('rightFoot')) {
            gfx.fillColor = new Color(255, 0, 0, 255);
            gfx.circle(this.rightLeg.target.x, this.rightLeg.target.y, 15 * s);
            gfx.fill();
        }

        // ========== 绘制支撑区域 ==========
        // 绘制支撑区域
        const range = this.getSupportXRange();
        if (range) {
            let baseY = this.groundY;
            if (this.adsorbedHold.has('leftFoot')) baseY = Math.max(baseY, this.leftLeg.target.y);
            if (this.adsorbedHold.has('rightFoot')) baseY = Math.max(baseY, this.rightLeg.target.y);

            const leftX = range.min;
            const rightX = range.max;

            gfx.strokeColor = this.supportPolygonColor;
            gfx.lineWidth = 4 * s;
            gfx.moveTo(leftX, baseY);
            gfx.lineTo(rightX, baseY);
            gfx.stroke();

            // 绘制手支撑点标记
            for (const part of ['leftHand', 'rightHand'] as BodyPart[]) {
                if (this.adsorbedHold.has(part) && this.isPartUnderForce(part)) {
                    const handX = this.getChainByPart(part)!.target.x;
                    gfx.strokeColor = new Color(0, 100, 255, 200);
                    gfx.lineWidth = 3 * s;
                    gfx.moveTo(handX, baseY - 8 * s);
                    gfx.lineTo(handX, baseY + 8 * s);
                    gfx.stroke();
                }
            }

            // 失衡警告闪烁（保持不变）
            if (this.imbalanceTimer > 0) {
                const warnAlpha = Math.abs(Math.sin(Date.now() * 0.01)) * 150 + 50;
                gfx.fillColor = new Color(255, 0, 0, warnAlpha);
                gfx.rect(leftX, baseY - 10 * s, rightX - leftX, 10 * s);
                gfx.fill();
                gfx.strokeColor = new Color(255, 0, 0, 255);
                gfx.lineWidth = 6 * s;
                gfx.moveTo(leftX, baseY);
                gfx.lineTo(rightX, baseY);
                gfx.stroke();
            }
        }

        if (range) {
            // 先画一条从左脚到右脚的粗红线，确保可见
            gfx.strokeColor = new Color(255, 0, 0, 255);
            gfx.lineWidth = 6 * s;
            gfx.moveTo(range.min, this.leftLeg.target.y);
            gfx.lineTo(range.max, this.rightLeg.target.y);
            gfx.stroke();

            // 再覆盖绘制绿色支撑线
            gfx.strokeColor = this.supportPolygonColor; // 绿色半透明
            gfx.lineWidth = 4 * s;
            gfx.moveTo(range.min, Math.max(this.leftLeg.target.y, this.rightLeg.target.y));
            gfx.lineTo(range.max, Math.max(this.leftLeg.target.y, this.rightLeg.target.y));
            gfx.stroke();
        }
    }

    private drawLimb(gfx: Graphics, from: Vec2, mid: Vec2, to: Vec2) {
        gfx.moveTo(from.x, from.y);
        gfx.lineTo(mid.x, mid.y);
        gfx.lineTo(to.x, to.y);
        gfx.stroke();
    }
}