import { _decorator, Component, Vec2, UITransform, Enum, Color } from 'cc';
const { ccclass, property } = _decorator;

export enum HoldType { JUG, POCKET, CRIMP, VOLUME }

@ccclass('HoldBase')
export class HoldBase extends Component {
    @property({ type: Enum(HoldType) })
    type: HoldType = HoldType.JUG;

    // 点吸附参数（非 Volume 使用）
    @property({ tooltip: '点吸附半径', visible() { return this.type !== HoldType.VOLUME; } })
    adsorbRadius: number = 40;

    @property({ tooltip: '释放半径' })
    releaseRadius: number = 60;

    @property({ tooltip: '冷却时间（秒）' })
    cooldownTime: number = 2.0;

    // Volume 额外边距
    @property({ tooltip: 'Volume 吸附额外边距（扩大矩形）', visible() { return this.type === HoldType.VOLUME; } })
    volumeMargin: number = 10;

    @property({ tooltip: '从中心方向（向下）向下扩展的角度（度）' })
    forceAngleDown: number = 45;

    @property({ tooltip: '从中心方向（向下）向上扩展的角度（度）' })
    forceAngleUp: number = 45;

    // 脚的使用权限（会在 start 中根据 type 自动覆盖）
    @property({ tooltip: '脚是否可以踩（站立/推力）' })
    allowFootStand: boolean = true;

    @property({ tooltip: '脚是否可以勾（钩挂/拉力）' })
    allowFootHook: boolean = true;

    // 在 forceAngleRange 属性下方添加
    @property({ type: Color, tooltip: '力方向扇形颜色' })
    forceSectorColor: Color = new Color(255, 200, 0, 200);  // 黄色半透明

    public localPos: Vec2 = new Vec2();
    public cooldownTimer: number = 0;

    onLoad() { this.updateLocalPos(); }
    start() {
        this.updateLocalPos();
        this.applyTypeDefaults();   // 根据岩点类型设置默认属性
    }

    updateLocalPos() {
        const pos = this.node.position;
        this.localPos.set(pos.x, pos.y);
    }

    // 根据 type 设置 forceDirection, forceAngleRange, allowFootStand, allowFootHook
    private applyTypeDefaults() {
        switch (this.type) {
            case HoldType.JUG:
                this.allowFootStand = true;
                this.allowFootHook = true;
                break;
            case HoldType.POCKET:
                this.allowFootStand = true;
                this.allowFootHook = false;
                break;
            case HoldType.CRIMP:
                this.allowFootStand = true;
                this.allowFootHook = false;
                break;
            case HoldType.VOLUME:
                this.allowFootStand = true;
                this.allowFootHook = true;
                break;
        }
    }

    // ========== 统一吸附接口 ==========
    getAdsorbedPosition(worldTarget: Vec2): Vec2 | null {
        if (this.type === HoldType.VOLUME) {
            return this.getVolumeAdsorbPos(worldTarget);
        } else {
            return this.getPointAdsorbPos(worldTarget);
        }
    }

    private getPointAdsorbPos(worldTarget: Vec2): Vec2 | null {
        const dist = Vec2.distance(worldTarget, this.localPos);
        if (dist < this.adsorbRadius) return this.localPos.clone();
        return null;
    }

    private getVolumeAdsorbPos(worldTarget: Vec2): Vec2 | null {
        const uiTransform = this.node.getComponent(UITransform);
        if (!uiTransform) return null;

        const pos = this.node.position;
        const angle = this.node.angle * Math.PI / 180;
        const scale = this.node.scale;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const w = uiTransform.width * scale.x;
        const h = uiTransform.height * scale.y;
        const ax = uiTransform.anchorX;
        const ay = uiTransform.anchorY;

        const offsetX = (0.5 - ax) * w;
        const offsetY = (0.5 - ay) * h;
        const centerX = pos.x + cos * offsetX - sin * offsetY;
        const centerY = pos.y + sin * offsetX + cos * offsetY;

        const halfW = w / 2 + this.volumeMargin;
        const halfH = h / 2 + this.volumeMargin;

        const dx = worldTarget.x - centerX;
        const dy = worldTarget.y - centerY;
        const localX = dx * cos + dy * sin;
        const localY = -dx * sin + dy * cos;

        if (Math.abs(localX) > halfW || Math.abs(localY) > halfH) {
            return null;
        }

        const lineStartLocalX = -halfW;
        const lineEndLocalX = halfW;
        const worldStartX = centerX + cos * lineStartLocalX - sin * 0;
        const worldStartY = centerY + sin * lineStartLocalX + cos * 0;
        const worldEndX = centerX + cos * lineEndLocalX - sin * 0;
        const worldEndY = centerY + sin * lineEndLocalX + cos * 0;
        const worldStart = new Vec2(worldStartX, worldStartY);
        const worldEnd = new Vec2(worldEndX, worldEndY);

        return this.closestPointOnSegment(worldTarget, worldStart, worldEnd);
    }

    // ========== 脱离判断 ==========
    isInAdsorbRange(target: Vec2): boolean {
        if (this.type === HoldType.VOLUME) {
            return this.getVolumeAdsorbPos(target) !== null;
        } else {
            return Vec2.distance(target, this.localPos) < this.adsorbRadius;
        }
    }

    isInReleaseRange(target: Vec2): boolean {
        if (this.type === HoldType.VOLUME) {
            const uiTransform = this.node.getComponent(UITransform);
            if (!uiTransform) return true;

            const pos = this.node.position;
            const angle = this.node.angle * Math.PI / 180;
            const scale = this.node.scale;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const w = uiTransform.width * scale.x;
            const h = uiTransform.height * scale.y;
            const ax = uiTransform.anchorX;
            const ay = uiTransform.anchorY;

            const offsetX = (0.5 - ax) * w;
            const offsetY = (0.5 - ay) * h;
            const centerX = pos.x + cos * offsetX - sin * offsetY;
            const centerY = pos.y + sin * offsetX + cos * offsetY;

            const halfW = w / 2 + this.volumeMargin;
            const halfH = h / 2 + this.volumeMargin;

            const dx = target.x - centerX;
            const dy = target.y - centerY;
            const localX = dx * cos + dy * sin;
            const localY = -dx * sin + dy * cos;

            if (Math.abs(localX) > halfW || Math.abs(localY) > halfH) return true;

            const lineStartLocalX = -halfW;
            const lineEndLocalX = halfW;
            const worldStart = new Vec2(
                centerX + cos * lineStartLocalX,
                centerY + sin * lineStartLocalX
            );
            const worldEnd = new Vec2(
                centerX + cos * lineEndLocalX,
                centerY + sin * lineEndLocalX
            );
            const closest = this.closestPointOnSegment(target, worldStart, worldEnd);
            return Vec2.distance(target, closest) > this.releaseRadius;
        } else {
            return Vec2.distance(target, this.localPos) > this.releaseRadius;
        }
    }

    private closestPointOnSegment(point: Vec2, start: Vec2, end: Vec2): Vec2 {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return start.clone();
        let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return new Vec2(start.x + t * dx, start.y + t * dy);
    }

    public getBestGripForShoulder(shoulderPos: Vec2, maxArmLen: number): Vec2 | null {
        if (this.type !== HoldType.VOLUME) return null;
        // ... 保持原有实现 ...
        const uiTransform = this.node.getComponent(UITransform);
        if (!uiTransform) return null;
        const pos = this.node.position;
        const angle = this.node.angle * Math.PI / 180;
        const scale = this.node.scale;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const w = uiTransform.width * scale.x;
        const ax = uiTransform.anchorX, ay = uiTransform.anchorY;
        const offsetX = (0.5 - ax) * w, offsetY = (0.5 - ay) * (uiTransform.height * scale.y);
        const centerX = pos.x + cos * offsetX - sin * offsetY;
        const centerY = pos.y + sin * offsetX + cos * offsetY;
        const halfW = w / 2 + this.volumeMargin;
        const lineStartX = centerX + cos * (-halfW);
        const lineStartY = centerY + sin * (-halfW);
        const lineEndX = centerX + cos * halfW;
        const lineEndY = centerY + sin * halfW;
        const closest = this.closestPointOnSegment(shoulderPos, new Vec2(lineStartX, lineStartY), new Vec2(lineEndX, lineEndY));
        if (closest && Vec2.distance(shoulderPos, closest) <= maxArmLen) return closest;
        return null;
    }

    public getClosestPointOnVolumeLine(shoulderPos: Vec2): Vec2 | null {
        if (this.type !== HoldType.VOLUME) return null;
        const uiTransform = this.node.getComponent(UITransform);
        if (!uiTransform) return null;
        const pos = this.node.position;
        const angle = this.node.angle * Math.PI / 180;
        const scale = this.node.scale;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const w = uiTransform.width * scale.x;
        const ax = uiTransform.anchorX, ay = uiTransform.anchorY;
        const offsetX = (0.5 - ax) * w, offsetY = (0.5 - ay) * (uiTransform.height * scale.y);
        const centerX = pos.x + cos * offsetX - sin * offsetY;
        const centerY = pos.y + sin * offsetX + cos * offsetY;
        const halfW = w / 2 + this.volumeMargin;
        const lineStartX = centerX + cos * (-halfW);
        const lineStartY = centerY + sin * (-halfW);
        const lineEndX = centerX + cos * halfW;
        const lineEndY = centerY + sin * halfW;
        return this.closestPointOnSegment(shoulderPos, new Vec2(lineStartX, lineStartY), new Vec2(lineEndX, lineEndY));
    }

    public getReachableGrip(shoulderPos: Vec2, maxArmLen: number): Vec2 {
        if (this.type !== HoldType.VOLUME) return this.localPos.clone();
        const closest = this.getClosestPointOnVolumeLine(shoulderPos);
        return closest ? closest.clone() : this.localPos.clone();
    }

    public getWorldForceDirection(): Vec2 {
        const angleRad = this.node.angle * Math.PI / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        // 局部向下方向 (0, -1) 旋转
        const worldX = 0 * cos - (-1) * sin; // sin
        const worldY = 0 * sin + (-1) * cos; // -cos
        const len = Math.sqrt(worldX * worldX + worldY * worldY);
        if (len < 0.001) return new Vec2(0, -1);
        return new Vec2(worldX / len, worldY / len);
    }

    public isForceInRange(worldPullDir: Vec2): boolean {
        const centerDir = this.getWorldForceDirection(); // 默认向下
        const cross = centerDir.x * worldPullDir.y - centerDir.y * worldPullDir.x;
        const dot = centerDir.x * worldPullDir.x + centerDir.y * worldPullDir.y;
        let angle = Math.atan2(cross, dot) * 180 / Math.PI;
        return angle >= -this.forceAngleUp && angle <= this.forceAngleDown;
    }
}