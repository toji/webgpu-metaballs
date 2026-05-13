class TimestampQueryData {
  #recycleCallback = null;
  #maxQueryCount = 0;
  #nextQueryIndex = 0;
  #querySet;
  #resolveBuffer;
  #readbackBuffer;
  #queriesUsed = new Map();

  constructor(device, maxQueryCount, recycleCallback) {
    this.#maxQueryCount = maxQueryCount;
    this.#recycleCallback = recycleCallback;

    this.#querySet = device.createQuerySet({
      label: 'Timestamp Helper',
      type: 'timestamp',
      count: maxQueryCount,
    });
    this.#resolveBuffer = device.createBuffer({
      label: 'Timestamp Resolve Buffer',
      size: BigUint64Array.BYTES_PER_ELEMENT * maxQueryCount,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
   this.#readbackBuffer = device.createBuffer({
      label: 'Timestamp Readback Buffer',
      size: this.#resolveBuffer.size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
  }

  hasQueries() {
    return this.#nextQueryIndex > 0;
  }

  getTimestampWrites(name) {
    if (this.#nextQueryIndex >= this.#maxQueryCount) {
      console.Error("Exceeded the number of passes that can be queried in a single resolve.");
      return undefined;
    }
    if (this.#queriesUsed.has(name)) {
      console.Error("Cannot use the came query name twice in a single resolve.");
      return undefined;
    }
    const timestampWrites = {
      querySet: this.#querySet,
      beginningOfPassWriteIndex: this.#nextQueryIndex,
      endOfPassWriteIndex: this.#nextQueryIndex + 1,
    };
    this.#queriesUsed.set(name, {
      begin: timestampWrites.beginningOfPassWriteIndex,
      end: timestampWrites.endOfPassWriteIndex,
    });
    this.#nextQueryIndex += 2;
    return timestampWrites;
  }

  resolve(commandEncoder) {
    commandEncoder.resolveQuerySet(
      this.#querySet,
      0,
      this.#nextQueryIndex,
      this.#resolveBuffer,
      0,
    );
    commandEncoder.copyBufferToBuffer(
      this.#resolveBuffer,
      0,
      this.#readbackBuffer,
      0,
      this.#resolveBuffer.size,
    );
  }

  async read() {
    const results = {};

    await this.#readbackBuffer.mapAsync(GPUMapMode.READ);
    const mappedArray = new BigUint64Array(this.#readbackBuffer.getMappedRange());

    for (const [name, query] of this.#queriesUsed.entries()) {
      const passTime = Number(mappedArray[query.end] - mappedArray[query.begin]);
      if (passTime >= 0) {
        // Return pass timings in µs
        results[name] = passTime / 1000;
      } else {
        // Discard negative times
        results[name] = 0;
      }
    }

    this.#readbackBuffer.unmap();

    // Now that the readback is complete, recycle the data for use in a future frame.
    this.#queriesUsed.clear();
    this.#nextQueryIndex = 0;
    this.#recycleCallback(this);

    return results;
  }
}

class TimestampResults {
  #queryData;
  #resultPromise;

  constructor(queryData) {
    this.#queryData = queryData;
  }

  read() {
    if (!this.#resultPromise) {
      this.#resultPromise = this.#queryData?.read() ?? Promise.Resolve({});
      this.#queryData = null;
    }
    return this.#resultPromise
  }
}

/**
 * A utility that makes it a bit easier to gather timings from WebGPU compute and render passes.
 */
export class TimestampHelper {
  device;
  #timestampsSupported = false;

  #readyQueryData = [];
  #currentQueryData = null;

  #maxQueryCount = 0;

  constructor(device, maxPassCount = 16) {
    this.device = device;
    this.#maxQueryCount = maxPassCount * 2;
    this.#timestampsSupported = this.device.features.has("timestamp-query");
    if (this.#timestampsSupported) {
      this.#currentQueryData = this.#getOrCreateQueryData();
    }
  }

  #getOrCreateQueryData() {
    if (this.#readyQueryData.length) {
      return this.#readyQueryData.pop();
    }
    return new TimestampQueryData(this.device, this.#maxQueryCount, (queryData) => {
      // Recycle the query data buffers once they've been read back.
      this.#readyQueryData.push(queryData);
    });
  }

  get timestampsSupported() {
    return this.#timestampsSupported;
  }

  timestampWrites(name) {
    if (!this.#timestampsSupported) {
      return undefined;
    }
    return this.#currentQueryData.getTimestampWrites(name);
  }

  resolve(commandEncoder) {
    if (!this.#timestampsSupported || !this.#currentQueryData?.hasQueries()) {
      return new TimestampResults(null);
    }

    const queryData = this.#currentQueryData;
    this.#currentQueryData = this.#getOrCreateQueryData();
    queryData.resolve(commandEncoder);
    return new TimestampResults(queryData);
  }
}
