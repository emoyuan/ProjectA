import { _decorator, Component, UITransform, Vec2 } from 'cc';
import { HoldBase } from './HoldBase';
const { ccclass } = _decorator;

@ccclass('HoldManager')
export class HoldManager extends Component {
    private holds: HoldBase[] = [];

    onLoad() {
        this.holds = this.getComponentsInChildren(HoldBase);
        console.log('岩点数量:', this.holds.length);
        for (const h of this.holds) {
            console.log('岩点类型:', h.type, '位置:', h.localPos, '尺寸:', h.node.getComponent(UITransform)?.contentSize);
        }
    }

    update(dt: number) {
        for (const hold of this.holds) {
            if (hold.cooldownTimer > 0) {
                hold.cooldownTimer -= dt;
            }
        }
    }

    findNearestHold(target: Vec2, excludeCooldown: boolean = false): HoldBase | null {
        let bestHold: HoldBase = null;
        let bestDist = Infinity;
        for (const hold of this.holds) {
            if (excludeCooldown && hold.cooldownTimer > 0) continue;
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