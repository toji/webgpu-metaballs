// Copyright 2021 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

const MAX_QUERY_COUNT = 1024;

const SYS_TIME = (performance || Date);

// Returned when a particular statistic has been disabled
class NoOpStat {
  constructor(name) {
    this.name = name;
    this.isNoOp = true;
  }

  begin() {}
  end() {}
};

// Tracks JavaScript timing
class CPUStat {
  constructor(name) {
    this.name = name;
    this.timestamps = new Float64Array(MAX_QUERY_COUNT);
    this.nextIndex = 0;
  }

  begin() {
    if (this.nextIndex % 2 != 0) {
      throw new Error('Mismatched timer query begin/end');
    }
    this.timestamps[this.nextIndex++] = SYS_TIME.now();
  }

  end() {
    if (this.nextIndex % 2 != 1) {
      throw new Error('Mismatched timer query begin/end');
    }
    this.timestamps[this.nextIndex++] = SYS_TIME.now();
  }
}

// Tracks WebGPU timing
class WebGPUStat {
  constructor(name, device) {
    this.name = name;
    this.device = device;
    this.nextIndex = 0;

    this.querySet = device.createQuerySet({
      type: 'timestamp',
      count: MAX_QUERY_COUNT
    });

    this.queryResultBuffer = device.createBuffer({
      size: MAX_QUERY_COUNT * 8,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.QUERY_RESOLVE
    });

    this.queryReadBuffer = device.createBuffer({
      size: MAX_QUERY_COUNT * 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
  }

  begin(encoder) {
    if (this.nextIndex % 2 != 0) {
      throw new Error('Mismatched timer query begin/end');
    }
    encoder.writeTimestamp(this.querySet, this.nextIndex++);
  }

  end(encoder) {
    if (this.nextIndex % 2 != 1) {
      throw new Error('Mismatched timer query begin/end');
    }
    encoder.writeTimestamp(this.querySet, this.nextIndex++);
  }

  async report() {
    const resultCount = this.nextIndex;
    this.nextIndex = 0;

    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.writeTimestamp(this.querySet, 1);
    commandEncoder.resolveQuerySet(this.querySet, 0, resultCount, this.queryResultBuffer, 0);
    commandEncoder.copyBufferToBuffer(this.queryResultBuffer, 0, this.queryReadBuffer, 0, resultCount*8);
    this.device.queue.submit([commandEncoder.finish()]);

    await this.queryReadBuffer.mapAsync(GPUMapMode.READ);

    const timestamps = new BigUint64Array(this.queryReadBuffer.getMappedRange());
    let total = 0;
    let readings = 0;
    for(let i = 0; i < resultCount; i+=2) {
      const start = timestamps[i];
      const end = timestamps[i+1];
      if (start == 0n || end == 0n) {
        break;
      }
      if (start > end) {
        continue;
      }
      total += Number(end - start) / 1000000.0; // Convert to ms
      readings++;
    }
    const avg = 0;
    if (readings > 0) {
      avg = total / readings;
    }
    this.queryReadBuffer.unmap();

    return avg;
  }
}

export class GPUStats {
  constructor(allowedStats = {}) {
    this.allowedStats = allowedStats;
    this.activeStats = {};

    this.frameStart = 0;
    this.frameCount = 0;
    this.prevFrameTime = SYS_TIME.now();
  }

  createCPUStat(name) {
    if (this.activeStats[name]) {
      throw new Error(`A stat with the name ${name} already exists`)
    }

    if (this.allowedStats[name] === false) {
      this.activeStats[name] = new NoOpStat(name);
    } else {
      this.activeStats[name] = new CPUStat(name);
    }
    return this.activeStats[name];
  }

  createWebGPUStat(name, device) {
    if (this.activeStats[name]) {
      throw new Error(`A stat with the name ${name} already exists`)
    }

    const hasFeature = device.features.has('timestamp-query');
    if (hasFeature) {
      console.warn('GPUDevice was not created with the "timestamp-query" feature');
      this.activeStats[name] = new NoOpStat(name);
    } else if (this.allowedStats[name] === false) {
      this.activeStats[name] = new NoOpStat(name);
    } else {
      this.activeStats[name] = new WebGPUStat(name, device);
    }

    return this.activeStats[name];
  }

  removeStat(stat) {
    if (typeof stat == 'string') {
      delete this.activeStats[stat];
    } else {
      delete this.activeStats[stat.name];
    }
  }

  begin() {
    this.frameStart = SYS_TIME.now();
  }

  end() {
    const frameEnd = SYS_TIME.now();
    this.frameCount++;

    const frameDuration = frameEnd - this.frameStart;

    if (frameEnd > this.prevFrameTime + 1000) {
      const avgFPS = (this.frameCount * 1000) / (frameEnd - this.prevFrameTime);
      //console.log(`FPS: ${avgFPS}`);

      for (const name in this.activeStats) {
        const stat = this.activeStats[name];
        if (!stat.isNoOp) {
          stat.report().then((value) => {
            console.log(`${stat.name}: ${value}`);
          });
        }
      }

      this.prevFrameTime = frameEnd;
      this.frameCount = 0;
    }

    return frameDuration;
  }
}