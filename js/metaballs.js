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

import { vec3 } from 'gl-matrix';

const TMP_VEC3 = vec3.create();

export class Metaballs {
  constructor() {
    this.balls = [];
  }

  updateBalls(timestamp) {
    this.clearBalls();

    // Stolen and tweaked from https://www.clicktorelease.com/code/bumpy-metaballs/
    const t = timestamp * 0.0005;
    const numblobs = 16;
    const subtract = 12;
    const strength = 5 / ( ( Math.sqrt( numblobs ) - 1 ) / 4 + 1 );
    
    for (let i = 0; i < numblobs; i++) {
      const position = [
        Math.cos(i + 1.12 * t * 0.21 * Math.sin((0.72 + 0.83 * i))) * 0.5,
        (Math.sin(i + 1.26 * t * (1.03 + 0.5 * Math.cos(0.21 * i))) + 1.0) * 1.0,
        Math.cos(i + 1.32 * t * 0.1 * Math.sin((0.92 + 0.53 * i))) * 0.5,
      ];
      
      this.addBall(position, strength, subtract);
    }
  }

  clearBalls() {
    this.balls = [];
  }

  addBall(position, strength, subtract) {
    let ball = {
      position,
      radius: Math.sqrt(strength / subtract),
      strength,
      subtract,
    };
    this.balls.push(ball);
    return ball;
  }

  surfaceFunc(x, y, z) {
    // No surfaces outside "the tube"
    /*if(x*x + z*z > 1.1) {
      return 0;
    }*/
    // Always render geometry on the floor
    /*if (y < 0) {
      return 100;
    }*/

    vec3.set(TMP_VEC3, x, y, z);
    let result = 0;
    for (const ball of this.balls) {
      const val = ball.strength / (0.000001 + vec3.sqrDist(TMP_VEC3, ball.position)) - ball.subtract;
      if (val > 0.0) {
        result += val;
      }
    }
    return result;
  }
}
