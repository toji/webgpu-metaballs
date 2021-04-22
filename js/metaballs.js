// Copyright 2021 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { Isosurface } from './marching-cubes.js'
import { vec3 } from 'gl-matrix';

const TMP_VEC3 = vec3.create();

export class Metaballs extends Isosurface {
  constructor() {
    const volume = {
      xMin: -1,
      xMax: 1,
      xStep: 0.1,
      yMin: -0.1,
      yMax: 4,
      yStep: 0.1,
      zMin: -1,
      zMax: 1,
      zStep: 0.1,
    };
    super(volume);

    this.balls = [];

    for (let i = 0; i < 10; ++i) {
      this.addBall([
        (Math.random() * 2.0 - 1.0) * 0.8,
        (Math.random() * 2),
        (Math.random() * 2.0 - 1.0) * 0.8,
      ],
      Math.random() * 0.5,
      Math.random() * 0.5 + 0.5);
    }
  }

  updateBalls(timestamp) {
    for (const ball of this.balls) {
      ball.position[1] = (Math.sin((timestamp / 1000) * ball.speed + ball.yOffset) * 0.5 + 0.5) * 3.8;
    }
  }

  addBall(position, radius, speed) {
    let ball = {
      position,
      yOffset: position[1],
      radius,
      speed,
      sqrRadius: radius * radius,
    };
    this.balls.push(ball);
    return ball;
  }

  surfaceFunc(x, y, z) {
    vec3.set(TMP_VEC3, x, y, z);

    let result = 0;

    // No surfaces outside "the tube"
    if(x*x + z*z > 1.1) {
      return 0;
    }
    // Always render geometry on the floor
    if (y < 0) {
      return 1;
    }

    for (const ball of this.balls) {
      const val = vec3.sqrDist(TMP_VEC3, ball.position) / ball.sqrRadius;
      if (val < 0.5) {
        result += (0.25 - val + val*val);
      }
    }
    return result;
  }
}
