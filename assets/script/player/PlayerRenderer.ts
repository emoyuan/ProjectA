import { Graphics, Vec2, Color } from 'cc';
import { BodyPart, CharacterAppearance } from './Player';
import { BoneChain } from './BoneChain';
import { HoldBase, HoldType } from '../hold/HoldBase';
import { HoldManager } from '../hold/HoldManager';

/**
 * Player 的绘制渲染辅助函数，从 Player.ts 中抽离以减少单个文件长度。
 * 所有绘制逻辑依赖 Player 的公开状态，通过参数传入。
 */
export class PlayerRenderer {

    /**
     * 绘制力方向扇形区域
     */
    static drawForceSector(
        gfx: Graphics,
        center: Vec2,
        radius: number,
        centerDir: Vec2,
        angleDown: number,
        angleUp: number,
        color: Color
    ) {
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

    /**
     * 绘制单条肢体（两段折线）
     */
    static drawLimb(gfx: Graphics, from: Vec2, mid: Vec2, to: Vec2) {
        gfx.moveTo(from.x, from.y);
        gfx.lineTo(mid.x, mid.y);
        gfx.lineTo(to.x, to.y);
        gfx.stroke();
    }

    /**
     * 根据锁定和受力状态决定肢体绘制颜色
     */
    static getLimbColor(
        part: BodyPart,
        adsorbedHold: Map<BodyPart, HoldBase>,
        isPartUnderForce: (part: BodyPart) => boolean,
        app: CharacterAppearance,
        forceColor: Color,
        noForceColor: Color
    ): Color {
        if (adsorbedHold.has(part)) {
            return isPartUnderForce(part) ? forceColor : noForceColor;
        }
        return app.skinColor;
    }

    /**
     * 绘制完整的角色
     */
    static drawCharacter(
        gfx: Graphics,
        scaleFactor: number,
        appearance: CharacterAppearance,
        head: Vec2,
        shoulder: Vec2,
        hip: Vec2,
        leftShoulder: Vec2,
        rightShoulder: Vec2,
        leftArm: BoneChain,
        rightArm: BoneChain,
        leftLeg: BoneChain,
        rightLeg: BoneChain,
        activePart: BodyPart,
        groundY: number,
        handEndRadius: number,
        footEndRadius: number,
        handEndColor: Color,
        footEndColor: Color,
        forceColor: Color,
        noForceColor: Color,
        supportPolygonColor: Color,
        footWidth: number,
        imbalanceTimer: number,
        adsorbedHold: Map<BodyPart, HoldBase>,
        isPartUnderForce: (part: BodyPart) => boolean,
        getCenterOfMass: () => Vec2,
        getSupportXRange: () => { min: number; max: number } | null,
        getForceVector: (part: BodyPart) => Vec2 | null,
        lastAllocation: Map<BodyPart, number>,
        holdManager: HoldManager | null,
        gameLayer: any,
    ) {
        gfx.clear();

        const s = scaleFactor;
        const app = appearance;
        const limbW = app.limbWidth * s;
        const jointR = app.jointRadius * s;
        const headR = app.headRadius * s;

        // 脊柱
        const spineTop = shoulder.y + 5 * s;
        const spineBottom = hip.y - 5 * s;
        for (let i = 0; i < 5; i++) {
            const t = i / 4, y = spineTop + (spineBottom - spineTop) * t;
            gfx.fillColor = new Color(255, 255, 255, 80);
            gfx.circle(shoulder.x, y, 2 * s); gfx.fill();
        }

        // 躯干
        gfx.fillColor = app.clothColor;
        const leftHip = new Vec2(hip.x - app.torsoWidth * 0.35 * s, hip.y);
        const rightHip = new Vec2(hip.x + app.torsoWidth * 0.35 * s, hip.y);
        gfx.moveTo(leftShoulder.x, leftShoulder.y + 5 * s);
        gfx.lineTo(rightShoulder.x, rightShoulder.y + 5 * s);
        gfx.lineTo(rightHip.x, rightHip.y - 5 * s);
        gfx.lineTo(leftHip.x, leftHip.y - 5 * s);
        gfx.close();
        gfx.fill();

        // 头
        gfx.fillColor = app.hairColor;
        gfx.circle(head.x, head.y + 2 * s, headR + 2 * s); gfx.fill();
        gfx.fillColor = app.skinColor;
        gfx.circle(head.x, head.y, headR); gfx.fill();
        gfx.fillColor = new Color(255, 255, 255, 200);
        gfx.circle(head.x - 4 * s, head.y + 4 * s, 4 * s); gfx.fill();

        // 脖子
        gfx.strokeColor = app.skinColor;
        gfx.lineWidth = 8 * s; gfx.lineCap = Graphics.LineCap.ROUND;
        gfx.moveTo(shoulder.x, shoulder.y + 15 * s);
        gfx.lineTo(head.x, head.y - headR); gfx.stroke();

        // 肩髋关节
        gfx.fillColor = app.clothColor;
        gfx.circle(leftShoulder.x, leftShoulder.y, 8 * s); gfx.fill();
        gfx.circle(rightShoulder.x, rightShoulder.y, 8 * s); gfx.fill();
        gfx.circle(leftHip.x, leftHip.y, 7 * s); gfx.fill();
        gfx.circle(rightHip.x, rightHip.y, 7 * s); gfx.fill();

        // 四肢（根据锁定和受力状态决定颜色）
        gfx.lineWidth = limbW;
        gfx.lineCap = Graphics.LineCap.ROUND;

        gfx.strokeColor = PlayerRenderer.getLimbColor('leftHand', adsorbedHold, isPartUnderForce, app, forceColor, noForceColor);
        PlayerRenderer.drawLimb(gfx, leftArm.root, leftArm.mid, leftArm.end);

        gfx.strokeColor = PlayerRenderer.getLimbColor('rightHand', adsorbedHold, isPartUnderForce, app, forceColor, noForceColor);
        PlayerRenderer.drawLimb(gfx, rightArm.root, rightArm.mid, rightArm.end);

        gfx.strokeColor = PlayerRenderer.getLimbColor('leftFoot', adsorbedHold, isPartUnderForce, app, forceColor, noForceColor);
        PlayerRenderer.drawLimb(gfx, leftLeg.root, leftLeg.mid, leftLeg.end);

        gfx.strokeColor = PlayerRenderer.getLimbColor('rightFoot', adsorbedHold, isPartUnderForce, app, forceColor, noForceColor);
        PlayerRenderer.drawLimb(gfx, rightLeg.root, rightLeg.mid, rightLeg.end);

        // 关节
        const jointColor = new Color(app.skinColor.r * 0.7, app.skinColor.g * 0.7, app.skinColor.b * 0.7, 255);
        gfx.fillColor = jointColor;
        gfx.circle(leftArm.mid.x, leftArm.mid.y, jointR); gfx.fill();
        gfx.circle(rightArm.mid.x, rightArm.mid.y, jointR); gfx.fill();
        gfx.circle(leftLeg.mid.x, leftLeg.mid.y, jointR); gfx.fill();
        gfx.circle(rightLeg.mid.x, rightLeg.mid.y, jointR); gfx.fill();

        // 手脚末端（用可配置的半径和颜色）
        const handEndR = handEndRadius * s;
        const footEndR = footEndRadius * s;

        gfx.fillColor = handEndColor;
        gfx.circle(leftArm.end.x, leftArm.end.y, handEndR); gfx.fill();
        gfx.circle(rightArm.end.x, rightArm.end.y, handEndR); gfx.fill();

        gfx.fillColor = footEndColor;
        gfx.circle(leftLeg.end.x, leftLeg.end.y, footEndR); gfx.fill();
        gfx.circle(rightLeg.end.x, rightLeg.end.y, footEndR); gfx.fill();

        // 质心
        const com = getCenterOfMass();
        gfx.fillColor = new Color(255, 255, 0, 255);
        gfx.circle(com.x, com.y, 8 * s); gfx.fill();

        // 可视化：绘制手/脚产生的力向量（箭头）并计算总力矩
        let totalTorque = 0;
        const drawArrow = (start: Vec2, vec: Vec2, color: Color, opts?: {thick?: boolean}) => {
            // 缩放显示用，避免太长；放大以便调试更清晰
            const scale = 0.12;
            const endX = start.x + vec.x * scale;
            const endY = start.y + vec.y * scale;
            gfx.strokeColor = color;
            gfx.lineWidth = (opts && opts.thick) ? 5 * s : 3 * s;
            gfx.moveTo(start.x, start.y);
            gfx.lineTo(endX, endY);
            gfx.stroke();
            // 箭头头部（三角形，填充更醒目）
            const dirX = endX - start.x;
            const dirY = endY - start.y;
            const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
            const ux = dirX / len, uy = dirY / len;
            const headLen = 16 * s;
            const headWidth = 10 * s;
            const leftX = endX - ux * headLen + -uy * headWidth;
            const leftY = endY - uy * headLen + ux * headWidth;
            const rightX = endX - ux * headLen + uy * headWidth;
            const rightY = endY - uy * headLen + -ux * headWidth;
            gfx.fillColor = new Color(color.r, color.g, color.b, 220);
            gfx.moveTo(endX, endY);
            gfx.lineTo(leftX, leftY);
            gfx.lineTo(rightX, rightY);
            gfx.close();
            gfx.fill();
            // 端点圆点提高可见性
            gfx.fillColor = new Color(color.r, color.g, color.b, 255);
            gfx.circle(endX, endY, 6 * s); gfx.fill();
        };

        for (const part of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as BodyPart[]) {
            const force = getForceVector(part);
            if (!force) continue;
            const chain = part === 'leftHand' ? leftArm : part === 'rightHand' ? rightArm : part === 'leftFoot' ? leftLeg : rightLeg;
            const pos = chain.target;
            // 绘制箭头（手臂为绿色，脚为蓝色）
            drawArrow(pos, force, part === 'leftHand' || part === 'rightHand' ? new Color(0,200,0,255) : new Color(0,120,255,255));
            // 计算力矩（r x F）
            const rx = pos.x - com.x;
            const ry = pos.y - com.y;
            totalTorque += rx * force.y - ry * force.x;
        }

        // 绘制总力矩条（在质心右侧）
        const torqueScale = 0.06; // 可视缩放
        const barLen = Math.max(-80, Math.min(80, totalTorque * torqueScale));
        const barX = com.x + 30 * s;
        const barY = com.y + 40 * s;
        const barColor = Math.abs(barLen) < 8 ? new Color(0,200,0,200) : new Color(255,60,60,200);
        gfx.fillColor = barColor;
        gfx.rect(barX, barY, barLen, 8 * s);
        gfx.fill();
        // 如果提供了分配信息（lastAllocation），绘制被分配的额外箭头（黄色）
        if (lastAllocation) {
            for (const part of ['leftHand','rightHand','leftFoot','rightFoot'] as BodyPart[]) {
                const alloc = lastAllocation.get(part) || 0;
                if (alloc <= 0) continue;
                const chain = part === 'leftHand' ? leftArm : part === 'rightHand' ? rightArm : part === 'leftFoot' ? leftLeg : rightLeg;
                const f = getForceVector(part);
                if (!f) continue;
                const dir = f.clone(); dir.normalize();
                const allocVec = new Vec2(dir.x * alloc, dir.y * alloc);
                drawArrow(chain.target, allocVec, new Color(255,200,0,255), {thick: true});
            }
        }
        // 中心线
        gfx.strokeColor = new Color(0,0,0,120);
        gfx.lineWidth = 1 * s;
        gfx.moveTo(barX, barY); gfx.lineTo(barX + 1, barY + 8 * s); gfx.stroke();

        // 失衡警告：质心处红色闪烁
        if (imbalanceTimer > 0) {
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

        // 地面线
        gfx.strokeColor = new Color(180, 180, 180, 255);
        gfx.lineWidth = 4 * s;

        // 获取 GameLayer 宽度
        let groundWidth = 700 * s; // 默认值
        if (gameLayer) {
            const uiTransform = gameLayer.getComponent('cc.UITransform') as any;
            if (uiTransform) {
                groundWidth = uiTransform.width;
            }
        }
        const halfGround = groundWidth / 2;
        gfx.moveTo(-halfGround, groundY);
        gfx.lineTo(halfGround, groundY);
        gfx.stroke();

        // 选中高亮
        let highlightPos: Vec2 | null = null;
        switch (activePart) {
            case 'leftHand': highlightPos = leftArm.end; break;
            case 'rightHand': highlightPos = rightArm.end; break;
            case 'leftFoot': highlightPos = leftLeg.end; break;
            case 'rightFoot': highlightPos = rightLeg.end; break;
            case 'torso': highlightPos = com; break;
        }
        if (highlightPos) {
            gfx.strokeColor = new Color(255, 215, 0, 255);
            gfx.lineWidth = 3 * s;
            gfx.circle(highlightPos.x, highlightPos.y, 13 * s); gfx.stroke();
        }

        // ========== 绘制所有非 Volume 岩点的力方向扇形 ==========
        if (holdManager) {
            const allHolds = holdManager.getHolds();
            for (const hold of allHolds) {
                if (hold.type === HoldType.VOLUME) continue;
                if (hold.forceAngleRange <= 0) continue;
                const centerDir = hold.getWorldForceDirection();
                const center = hold.localPos;
                const radius = hold.adsorbRadius * s * 1.5;
                const halfRange = hold.forceAngleRange / 2;
                PlayerRenderer.drawForceSector(gfx, center, radius, centerDir, halfRange, halfRange, hold.forceSectorColor);
            }
            // 额外：为 Volume 岩点绘制线段
            for (const hold of allHolds) {
                if (hold.type !== HoldType.VOLUME) continue;
                const seg = hold.getVolumeLineSegment();
                if (!seg) continue;
                gfx.lineWidth = 3 * s;
                gfx.strokeColor = new Color(0, 120, 255, 200);
                gfx.moveTo(seg.start.x, seg.start.y);
                gfx.lineTo(seg.end.x, seg.end.y);
                gfx.stroke();
                gfx.fillColor = new Color(0, 120, 255, 200);
                gfx.circle(seg.start.x, seg.start.y, 6 * s); gfx.fill();
                gfx.circle(seg.end.x, seg.end.y, 6 * s); gfx.fill();
                const center = new Vec2((seg.start.x + seg.end.x) / 2, (seg.start.y + seg.end.y) / 2);
                gfx.fillColor = new Color(0, 200, 120, 180);
                gfx.circle(center.x, center.y, 5 * s); gfx.fill();
            }
        }

        // 调试：在双脚位置画大红点
        if (adsorbedHold.has('leftFoot')) {
            gfx.fillColor = new Color(255, 0, 0, 255);
            gfx.circle(leftLeg.target.x, leftLeg.target.y, 15 * s);
            gfx.fill();
        }
        if (adsorbedHold.has('rightFoot')) {
            gfx.fillColor = new Color(255, 0, 0, 255);
            gfx.circle(rightLeg.target.x, rightLeg.target.y, 15 * s);
            gfx.fill();
        }

        // ========== 绘制支撑区域 ==========
        const range = getSupportXRange();
        if (range) {
            let baseY = groundY;
            if (adsorbedHold.has('leftFoot')) baseY = Math.max(baseY, leftLeg.target.y);
            if (adsorbedHold.has('rightFoot')) baseY = Math.max(baseY, rightLeg.target.y);

            const leftX = range.min;
            const rightX = range.max;

            gfx.strokeColor = supportPolygonColor;
            gfx.lineWidth = 4 * s;
            gfx.moveTo(leftX, baseY);
            gfx.lineTo(rightX, baseY);
            gfx.stroke();

            // 绘制手支撑点标记
            for (const part of ['leftHand', 'rightHand'] as BodyPart[]) {
                if (adsorbedHold.has(part) && isPartUnderForce(part)) {
                    const chain = part === 'leftHand' ? leftArm : rightArm;
                    const handX = chain.target.x;
                    gfx.strokeColor = new Color(0, 100, 255, 200);
                    gfx.lineWidth = 3 * s;
                    gfx.moveTo(handX, baseY - 8 * s);
                    gfx.lineTo(handX, baseY + 8 * s);
                    gfx.stroke();
                }
            }

            // 失衡警告闪烁
            if (imbalanceTimer > 0) {
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
            gfx.moveTo(range.min, leftLeg.target.y);
            gfx.lineTo(range.max, rightLeg.target.y);
            gfx.stroke();

            // 再覆盖绘制绿色支撑线
            gfx.strokeColor = supportPolygonColor;
            gfx.lineWidth = 4 * s;
            gfx.moveTo(range.min, Math.max(leftLeg.target.y, rightLeg.target.y));
            gfx.lineTo(range.max, Math.max(leftLeg.target.y, rightLeg.target.y));
            gfx.stroke();
        }
    }
}