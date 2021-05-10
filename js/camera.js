import { vec3, mat4 } from 'gl-matrix';

const DIR = vec3.create();

export class FlyingCamera {
  constructor() {
    this._element = null;
    this._angles = vec3.create();
    this._position = vec3.create();
    this._viewMat = mat4.create();
    this._rotMat = mat4.create();
    this._dirty = true;

    this.speed = 3;

    this._pressedKeys = new Array(128);
    window.addEventListener('keydown', (event) => {
      this._pressedKeys[event.keyCode] = true;
    });
    window.addEventListener('keyup', (event) => {
      this._pressedKeys[event.keyCode] = false;
    });

    let moving = false;
    let lastX, lastY;
    this.mousedownCallback = (event) => {
      if (event.isPrimary) {
        moving = true;
      }
      lastX = event.pageX;
      lastY = event.pageY;
    };
    this.mousemoveCallback = (event) => {
      let xDelta, yDelta;

      if(document.pointerLockEnabled) {
          xDelta = event.movementX;
          yDelta = event.movementY;
          this.rotateView(xDelta * 0.025, yDelta * 0.025);
      } else if (moving) {
          xDelta = event.pageX - lastX;
          yDelta = event.pageY - lastY;
          lastX = event.pageX;
          lastY = event.pageY;
          this.rotateView(xDelta * 0.025, yDelta * 0.025);
      }
    };
    this.mouseupCallback = (event) => {
      if (event.isPrimary) {
        moving = false;
      }
    };

    let lastFrameTime = -1;
    this.frameCallback = (timestamp) => {
      if (lastFrameTime == -1) {
        lastFrameTime = timestamp;
      } else {
        this.update(timestamp - lastFrameTime);
        lastFrameTime = timestamp;
      }
      requestAnimationFrame(this.frameCallback);
    }
    requestAnimationFrame(this.frameCallback);
  }

  set element(value) {
    if (this._element && this._element != value) {
      this._element.removeEventListener('pointerdown', this.mousedownCallback);
      this._element.removeEventListener('pointermove', this.mousemoveCallback);
      this._element.removeEventListener('pointerup', this.mouseupCallback);
    }

    this._element = value;
    if (this._element) {
      this._element.addEventListener('pointerdown', this.mousedownCallback);
      this._element.addEventListener('pointermove', this.mousemoveCallback);
      this._element.addEventListener('pointerup', this.mouseupCallback);
    }
  }

  get element() {
    return this._element;
  }

  rotateView(xDelta, yDelta) {
    let rot = this._rotMat;

    if(xDelta || yDelta) {
      this._angles[1] += xDelta;
      // Keep our rotation in the range of [0, 2*PI]
      // (Prevents numeric instability if you spin around a LOT.)
      while (this._angles[1] < 0) {
        this._angles[1] += Math.PI * 2.0;
      }
      while (this._angles[1] >= Math.PI * 2.0) {
        this._angles[1] -= Math.PI * 2.0;
      }

      this._angles[0] += yDelta;
      // Clamp the up/down rotation to prevent us from flipping upside-down
      if (this._angles[0] < -Math.PI * 0.5) {
        this._angles[0] = -Math.PI * 0.5;
      }
      if (this._angles[0] > Math.PI * 0.5) {
        this._angles[0] = Math.PI * 0.5;
      }

      // Update the directional matrix
      mat4.identity(rot);

      mat4.rotateY(rot, rot, -this._angles[1]);
      mat4.rotateX(rot, rot, -this._angles[0]);

      this._dirty = true;
    }
  }

  set position(value) {
    vec3.copy(this._position, value);
    this._dirty = true;
  }

  get position() {
    return this._position;
  }

  get viewMatrix() {
    if (this._dirty) {
      let mv = this._viewMat;
      mat4.identity(mv);

      //mat4.rotateX(mv, mv, -Math.PI * 0.5);
      mat4.rotateX(mv, mv, this._angles[0]);
      mat4.rotateY(mv, mv, this._angles[1]);
      mat4.translate(mv, mv, [-this._position[0], -this._position[1], -this._position[2]]);
      this._dirty = false;
    }

    return this._viewMat;
  }

  update(frameTime) {
    if (!this._element) return;

    const speed = (this.speed / 1000) * frameTime;

    vec3.set(DIR, 0, 0, 0);

    // This is our first person movement code. It's not really pretty, but it works
    if (this._pressedKeys['W'.charCodeAt(0)]) {
      DIR[2] -= speed;
    }
    if (this._pressedKeys['S'.charCodeAt(0)]) {
      DIR[2] += speed;
    }
    if (this._pressedKeys['A'.charCodeAt(0)]) {
      DIR[0] -= speed;
    }
    if (this._pressedKeys['D'.charCodeAt(0)]) {
      DIR[0] += speed;
    }
    if (this._pressedKeys[32]) { // Space, moves up
      DIR[1] += speed;
    }
    if (this._pressedKeys[16]) { // Shift, moves down
      DIR[1] -= speed;
    }

    if (DIR[0] !== 0 || DIR[1] !== 0 || DIR[2] !== 0) {
        // Move the camera in the direction we are facing
        vec3.transformMat4(DIR, DIR, this._rotMat);
        vec3.add(this._position, this._position, DIR);

        this._dirty = true;
    }
  }
}

export class OrbitCamera {
  constructor() {
    this._element = null;

    this._distance = vec3.create([0, 0, 5]);
    this._target = vec3.create();
    this._viewMat = mat4.create();
    this._cameraMat = mat4.create();
    this._position = vec3.create();

    this.orbitX = 0;
    this.orbitY = 0;
    this.maxOrbitX = Math.PI * 0.5;
    this.minOrbitX = -Math.PI * 0.5;
    this.maxOrbitY = Math.PI;
    this.minOrbitY = -Math.PI;
    this.constrainXOrbit = true;
    this.constrainYOrbit = false;
    
    this.maxDistance = 10;
    this.minDistance = 1;
    this.distanceStep = 0.005;
    this.constrainDistance = true;

    this._dirty = true;

    let moving = false;
    let lastX, lastY;
    this.mousedownCallback = (event) => {
      if (event.isPrimary) {
        moving = true;
      }
      lastX = event.pageX;
      lastY = event.pageY;
    };
    this.mousemoveCallback = (event) => {
      let xDelta, yDelta;

      if(document.pointerLockEnabled) {
          xDelta = event.movementX;
          yDelta = event.movementY;
          this.orbit(xDelta * 0.025, yDelta * 0.025);
      } else if (moving) {
          xDelta = event.pageX - lastX;
          yDelta = event.pageY - lastY;
          lastX = event.pageX;
          lastY = event.pageY;
          this.orbit(xDelta * 0.025, yDelta * 0.025);
      }
    };
    this.mouseupCallback = (event) => {
      if (event.isPrimary) {
        moving = false;
      }
    };
    this.mousewheelCallback = (event) => {
      this.distance = this._distance[2] + (-event.wheelDeltaY * this.distanceStep);
      event.preventDefault();
    };
  }

  set element(value) {
    if (this._element && this._element != value) {
      this._element.removeEventListener('pointerdown', this.mousedownCallback);
      this._element.removeEventListener('pointermove', this.mousemoveCallback);
      this._element.removeEventListener('pointerup', this.mouseupCallback);
      this._element.removeEventListener('mousewheel', this.mousewheelCallback);
    }

    this._element = value;
    if (this._element) {
      this._element.addEventListener('pointerdown', this.mousedownCallback);
      this._element.addEventListener('pointermove', this.mousemoveCallback);
      this._element.addEventListener('pointerup', this.mouseupCallback);
      this._element.addEventListener('mousewheel', this.mousewheelCallback);
    }
  }

  get element() {
    return this._element;
  }

  orbit(xDelta, yDelta) {
    if(xDelta || yDelta) {
      this.orbitY += xDelta;
      if(this.constrainYOrbit) {
          this.orbitY = Math.min(Math.max(this.orbitY, this.minOrbitY), this.maxOrbitY);
      } else {
          while (this.orbitY < -Math.PI) {
              this.orbitY += Math.PI * 2;
          }
          while (this.orbitY >= Math.PI) {
              this.orbitY -= Math.PI * 2;
          }
      }

      this.orbitX += yDelta;
      if(this.constrainXOrbit) {
          this.orbitX = Math.min(Math.max(this.orbitX, this.minOrbitX), this.maxOrbitX);
      } else {
          while (this.orbitX < -Math.PI) {
              this.orbitX += Math.PI * 2;
          }
          while (this.orbitX >= Math.PI) {
              this.orbitX -= Math.PI * 2;
          }
      }

      this._dirty = true;
    }
  }

  get target() {
    return [this._target[0], this._target[1], this._target[2]];
  }

  set target(value) {
    this._target[0] = value[0];
    this._target[1] = value[1];
    this._target[2] = value[2];
    this._dirty = true;
  };

  get distance() {
    return -this._distance[2];
  };

  set distance(value) {
    this._distance[2] = value;
    if(this.constrainDistance) {
      this._distance[2] = Math.min(Math.max(this._distance[2], this.minDistance), this.maxDistance);
    }
    this._dirty = true;
  };

  updateMatrices() {
    if (this._dirty) {
      var mv = this._cameraMat;
      mat4.identity(mv);

      mat4.translate(mv, mv, this._target);
      mat4.rotateY(mv, mv, -this.orbitY);
      mat4.rotateX(mv, mv, -this.orbitX);
      mat4.translate(mv, mv, this._distance);
      mat4.invert(this._viewMat, this._cameraMat);

      this._dirty = false;
    }
  }

  get position() {
    this.updateMatrices();
    vec3.set(this._position, 0, 0, 0);
    vec3.transformMat4(this._position, this._position, this._cameraMat);
    return this._position;
  }

  get viewMatrix() {
    this.updateMatrices();
    return this._viewMat;
  }
}
