import { Vec2 } from 'cc';

/**
 * 两段骨链 IK 求解器。
 * 用于手臂（上臂+前臂）和腿部（大腿+小腿）的逆向运动学计算。
 */
export class BoneChain {
    root: Vec2 = new Vec2();
    mid: Vec2 = new Vec2();
    end: Vec2 = new Vec2();
    upperLen: number;
    lowerLen: number;
    target: Vec2 = new Vec2();
    isLeft: boolean;
    preferVertical: boolean = false;
    maxVerticalAngle: number = 0;
    isArm: boolean = false;

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
            // 接近完全伸展：使用余弦定理精确求解，计算两个候选并使用自然方向选择
            const a = upper, b = lower, c = Math.min(dist, maxDist);
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
                candidates.push(new Vec2(root.x + upperDir.x * upper, root.y + upperDir.y * upper));
            }

            let chosenMid: Vec2;
            if (this.isArm) {
                const perpX = this.isLeft ? -dy : dy;
                const perpY = this.isLeft ? dx : -dx;
                let bestIdx = 0;
                let bestDot = -Infinity;
                for (let i = 0; i < 2; i++) {
                    const mid = candidates[i];
                    const dot = (mid.x - root.x) * perpX + (mid.y - root.y) * perpY;
                    if (dot > bestDot) { bestDot = dot; bestIdx = i; }
                }
                chosenMid = candidates[bestIdx];
            } else {
                if (this.isLeft) {
                    chosenMid = candidates[0].x < candidates[1].x ? candidates[0] : candidates[1];
                } else {
                    chosenMid = candidates[0].x > candidates[1].x ? candidates[0] : candidates[1];
                }
            }

            this.mid.set(chosenMid);
            const lowerDir = new Vec2(target.x - this.mid.x, target.y - this.mid.y);
            const lowerDist = lowerDir.length();
            if (lowerDist > 0.001) {
                lowerDir.normalize();
                this.end.set(this.mid.x + lowerDir.x * lower, this.mid.y + lowerDir.y * lower);
            } else {
                this.end.set(target);
            }
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

        // 自然方向：左臂/左腿向左弯，右臂/右腿向右弯
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
            // 左膝向左，右膝向右
            if (this.isLeft) {
                chosenMid = candidates[0].x < candidates[1].x ? candidates[0] : candidates[1];
            } else {
                chosenMid = candidates[0].x > candidates[1].x ? candidates[0] : candidates[1];
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