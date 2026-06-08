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

    @property({ tooltip: '是否为起步点（起步前仅允许与此类岩点交互）' })
    isStartPoint: boolean = false;

    @property({ tooltip: '是否为终点（完成条件通常要求双手锁在同一终点）' })
    isFinishPoint: boolean = false;

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

    private getVolumeAdhesionParams(): { center: Vec2; cos: number; sin: number; halfW: number; halfH: number } | null {
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

        return {
            center: new Vec2(centerX, centerY),
            cos,
            sin,
            halfW: w / 2 + this.volumeMargin,
            halfH: h / 2 + this.volumeMargin,
        };
    }

    private getVolumeAdsorbPos(worldTarget: Vec2): Vec2 | null {
        const params = this.getVolumeAdhesionParams();
        if (!params) return null;

        const dx = worldTarget.x - params.center.x;
        const dy = worldTarget.y - params.center.y;
        const localX = dx * params.cos + dy * params.sin;
        const localY = -dx * params.sin + dy * params.cos;

        if (Math.abs(localX) > params.halfW || Math.abs(localY) > params.halfH) {
            return null;
        }

        const segment = this.getVolumeLineSegment();
        if (!segment) return null;
        return this.closestPointOnSegment(worldTarget, segment.start, segment.end);
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
            const params = this.getVolumeAdhesionParams();
            if (!params) return true;

            const dx = target.x - params.center.x;
            const dy = target.y - params.center.y;
            const localX = dx * params.cos + dy * params.sin;
            const localY = -dx * params.sin + dy * params.cos;

            if (Math.abs(localX) > params.halfW || Math.abs(localY) > params.halfH) return true;

            const segment = this.getVolumeLineSegment();
            if (!segment) return true;
            const closest = this.closestPointOnSegment(target, segment.start, segment.end);
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

    public getClosestPointOnVolumeLine(worldTarget: Vec2): Vec2 | null {
        if (this.type !== HoldType.VOLUME) return null;
        const segment = this.getVolumeLineSegment();
        if (!segment) return null;
        return this.closestPointOnSegment(worldTarget, segment.start, segment.end);
    }

    public getReachablePointOnVolumeLine(root: Vec2, desiredTarget: Vec2, maxDist: number): Vec2 | null {
        const segment = this.getVolumeLineSegment();
        if (!segment) return null;

        const desiredOnLine = this.closestPointOnSegment(desiredTarget, segment.start, segment.end);
        const currentDist = Vec2.distance(root, desiredOnLine);
        if (currentDist <= maxDist) return desiredOnLine;

        const rootToStart = new Vec2(segment.start.x - root.x, segment.start.y - root.y);
        const rootToEnd = new Vec2(segment.end.x - root.x, segment.end.y - root.y);
        const startDist = rootToStart.length();
        const endDist = rootToEnd.length();

        const lineDir = new Vec2(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
        const lineLen = lineDir.length();
        if (lineLen < 0.001) {
            return startDist < endDist ? segment.start.clone() : segment.end.clone();
        }
        lineDir.normalize();

        const relRoot = new Vec2(root.x - segment.start.x, root.y - segment.start.y);
        let proj = relRoot.x * lineDir.x + relRoot.y * lineDir.y;
        proj = Math.max(0, Math.min(lineLen, proj));
        const closestOnLine = new Vec2(segment.start.x + lineDir.x * proj, segment.start.y + lineDir.y * proj);
        const perpDist = Vec2.distance(root, closestOnLine);

        if (perpDist >= maxDist) {
            return startDist < endDist ? segment.start.clone() : segment.end.clone();
        }

        const dt = Math.sqrt(maxDist * maxDist - perpDist * perpDist);
        const candidates: Vec2[] = [];
        const t1 = proj - dt;
        const t2 = proj + dt;
        if (t1 >= 0 && t1 <= lineLen) {
            candidates.push(new Vec2(segment.start.x + lineDir.x * t1, segment.start.y + lineDir.y * t1));
        }
        if (t2 >= 0 && t2 <= lineLen) {
            candidates.push(new Vec2(segment.start.x + lineDir.x * t2, segment.start.y + lineDir.y * t2));
        }

        if (candidates.length === 0) {
            return startDist < endDist ? segment.start.clone() : segment.end.clone();
        }

        let best = candidates[0];
        let bestDist = Vec2.distance(best, desiredOnLine);
        for (let i = 1; i < candidates.length; i++) {
            const d = Vec2.distance(candidates[i], desiredOnLine);
            if (d < bestDist) {
                best = candidates[i];
                bestDist = d;
            }
        }
        return best;
    }

    public getVolumeLineSegment(): { start: Vec2; end: Vec2 } | null {
        const uiTransform = this.node.getComponent(UITransform);
        if (!uiTransform) return null;
        const pos = this.node.position;
        const angle = this.node.angle * Math.PI / 180;
        const scale = this.node.scale;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const w = uiTransform.width * scale.x;
        const ax = uiTransform.anchorX;
        const ay = uiTransform.anchorY;
        const offsetX = (0.5 - ax) * w;
        const offsetY = (0.5 - ay) * (uiTransform.height * scale.y);
        const centerX = pos.x + cos * offsetX - sin * offsetY;
        const centerY = pos.y + sin * offsetX + cos * offsetY;
        const halfW = w / 2 + this.volumeMargin;
        const start = new Vec2(centerX + cos * (-halfW), centerY + sin * (-halfW));
        const end = new Vec2(centerX + cos * halfW, centerY + sin * halfW);
        return { start, end };
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