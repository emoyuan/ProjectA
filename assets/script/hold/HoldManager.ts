import { _decorator, Component, UITransform, Vec2, Sprite, Color } from 'cc';
import { HoldBase, HoldType } from './HoldBase';
const { ccclass, property } = _decorator;

@ccclass('HoldManager')
export class HoldManager extends Component {
    private holds: HoldBase[] = [];
    // 游戏起步/结束状态控制
    public started: boolean = false;
    public finished: boolean = false;
    @property({ tooltip: '起步前非起步点的透明度 (0-255)，越小越透明' })
    public preStartAlpha: number = 120;

    onLoad() {
        this.holds = this.getComponentsInChildren(HoldBase);
        console.log('岩点数量:', this.holds.length);
        for (const h of this.holds) {
            console.log('岩点类型:', h.type, '位置:', h.localPos, '尺寸:', h.node.getComponent(UITransform)?.contentSize);
        }
        // 应用初始视觉状态（依据 started）
        this.applyPreStartVisuals();
    }

    update(dt: number) {
        for (const hold of this.holds) {
            if (hold.cooldownTimer > 0) {
                hold.cooldownTimer -= dt;
            }
        }
    }

    findNearestHold(target: Vec2, excludeCooldown: boolean = false, isFoot: boolean = false): HoldBase | null {
        if (this.finished) return null;
        let bestHold: HoldBase = null;
        let bestDist = Infinity;
        for (const hold of this.holds) {
            // 起步前仅允许起步点被交互
            if (!this.started && !hold.isStartPoint) continue;
            if (excludeCooldown && hold.cooldownTimer > 0) continue;
            // FOOTHOLD 只能被脚锁定
            if (!hold.canBeGrabbedBy(isFoot)) continue;
            const adsorbPos = hold.getAdsorbedPosition(target);
            if (adsorbPos) {
                const dist = Vec2.distance(target, adsorbPos);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestHold = hold;
                }
            }
        }
        return bestHold;
    }

    /**
     * 查找磁力范围内最近的非冷却岩点（用于磁力减速）。
     * 返回吸附距离最小的那个，距离用于确定磁力强度。
     */
    findBestMagnetHold(target: Vec2, isFoot: boolean = false): { hold: HoldBase; dist: number } | null {
        if (this.finished) return null;
        let bestHold: HoldBase = null;
        let bestDist = Infinity;
        for (const hold of this.holds) {
            if (!this.started && !hold.isStartPoint) continue;
            if (hold.cooldownTimer > 0) continue;
            if (hold.magnetRadius <= 0) continue;
            // FOOTHOLD 只能被脚锁定
            if (!hold.canBeGrabbedBy(isFoot)) continue;

            if (hold.type === HoldType.VOLUME) {
                // Volume: 计算到线段最近点的距离
                const segment = (hold as any).getVolumeLineSegment?.();
                if (!segment) continue;
                const closestPoint = hold.getClosestPointOnVolumeLine(target);
                if (!closestPoint) continue;
                const dist = Vec2.distance(target, closestPoint);
                if (dist < hold.magnetRadius && dist >= hold.adsorbRadius && dist < bestDist) {
                    bestDist = dist;
                    bestHold = hold;
                }
            } else {
                const dist = Vec2.distance(target, hold.localPos);
                if (dist < hold.magnetRadius && dist >= hold.adsorbRadius && dist < bestDist) {
                    bestDist = dist;
                    bestHold = hold;
                }
            }
        }
        return bestHold ? { hold: bestHold, dist: bestDist } : null;
    }

    public setStarted(v: boolean) {
        this.started = v;
        // 结束状态复位
        if (!v) this.finished = false;
        this.applyPreStartVisuals();
    }

    public setFinished(v: boolean) {
        this.finished = v;
    }

    private applyPreStartVisuals() {
        for (const hold of this.holds) {
            const sprite = hold.node.getComponent(Sprite) as Sprite | null;
            if (!sprite) continue;
            if (!this.started) {
                // 起步前：只有起步点保持不变，其他置为半透明
                if (!hold.isStartPoint) {
                    const c = sprite.color || new Color(255, 255, 255, 255);
                    sprite.color = new Color(c.r, c.g, c.b, Math.max(0, Math.min(255, this.preStartAlpha)));
                } else {
                    const c = sprite.color || new Color(255, 255, 255, 255);
                    sprite.color = new Color(c.r, c.g, c.b, 255);
                }
            } else {
                // 起步后：恢复所有岩点颜色为不透明
                const c = sprite.color || new Color(255, 255, 255, 255);
                sprite.color = new Color(c.r, c.g, c.b, 255);
            }
        }
    }

    shouldRelease(hold: HoldBase, currentPos: Vec2): boolean {
        return hold.isInReleaseRange(currentPos);
    }

    startCooldown(hold: HoldBase) {
        hold.cooldownTimer = hold.cooldownTime;
    }

    getHolds(): HoldBase[] {
        return this.holds;
    }

    public resetAllCooldowns() {
        for (const hold of this.holds) {
            hold.cooldownTimer = 0;
        }
    }
}