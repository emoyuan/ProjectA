import { _decorator, Component, Node, UITransform, Vec2, Vec3, EventTouch } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('Joystick')
export class Joystick extends Component {
    @property(Node) background: Node = null!;
    @property(Node) thumb: Node = null!;
    @property radius: number = 80;

    private _direction: Vec2 = new Vec2();
    private _thumbLocalPos: Vec2 = new Vec2(0, 0);
    private _touching: boolean = false;

    public get direction(): Vec2 { return this._direction; }
    public get thumbPosition(): Vec2 { return this._thumbLocalPos; }
    public get isTouching(): boolean { return this._touching; }

    onLoad() {
        if (this.thumb) this.thumb.setPosition(0, 0, 0);
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    onTouchStart(event: EventTouch) {
        this._touching = true;
        this.updateThumb(event);
    }

    onTouchMove(event: EventTouch) {
        this.updateThumb(event);
    }

    onTouchEnd(_event: EventTouch) {
        this._touching = false;
        if (this.thumb) this.thumb.setPosition(0, 0, 0);
        this._direction.set(0, 0);
        this._thumbLocalPos.set(0, 0);
    }

    private updateThumb(event: EventTouch) {
        let uiPos: Vec3;
        if (typeof (event as any).getUILocation === 'function') {
            const pos = (event as any).getUILocation();
            uiPos = new Vec3(pos.x, pos.y, 0);
        } else {
            const loc = event.getLocation();
            uiPos = new Vec3(loc.x, loc.y, 0);
        }

        const uiTransform = this.node.getComponent(UITransform)!;
        const localPos = uiTransform.convertToNodeSpaceAR(uiPos);
        const len = localPos.length();

        if (len > this.radius) {
            localPos.normalize();
            localPos.multiplyScalar(this.radius);
        }

        if (this.thumb) this.thumb.setPosition(localPos.x, localPos.y, 0);
        this._thumbLocalPos.set(localPos.x, localPos.y);
        this._direction.set(localPos.x / this.radius, localPos.y / this.radius);
    }
}