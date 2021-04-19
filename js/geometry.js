export const AttributeLocation = {
  position: 0,
  normal: 1,
  tangent: 2,
  texcoord: 3,
  color: 4
};

const DefaultAttributeType = {
  position: 'float32x3',
  normal: 'float32x3',
  tangent: 'float32x3',
  texcoord: 'float32x2',
  color: 'float32x4'
};

const DefaultStride = {
  uint8x2: 2,
  uint8x4: 4,
  sint8x2: 2,
  sint8x4: 4,
  unorm8x2: 2,
  unorm8x4: 4,
  snorm8x2: 2,
  snorm8x4: 4,
  uint16x2: 4,
  uint16x4: 8,
  sint16x2: 4,
  sint16x4: 8,
  unorm16x2: 4,
  unorm16x4: 8,
  snorm16x2: 4,
  snorm16x4: 8,
  float16x2: 4,
  float16x4: 8,
  float32: 4,
  float32x2: 8,
  float32x3: 12,
  float32x4: 16,
  uint32: 4,
  uint32x2: 8,
  uint32x3: 12,
  uint32x4: 16,
  sint32: 4,
  sint32x2: 8,
  sint32x3: 12,
  sint32x4: 16,
};

export class VertexInterleavedAttributes {
  constructor(values, stride) {
    this.values = values;
    this.stride = stride;
    this.attributes = [];
    this.maxVertexCount = Math.floor(values.length * values.BYTES_PER_ELEMENT) / stride;
    this.minAttributeLocation = Number.MAX_SAFE_INTEGER;
  }

  addAttribute(location, offset = 0, format) {
    if (!format) {
      format = DefaultAttributeType[location];
    }
    if (typeof location == 'string') {
      location = AttributeLocation[location];
    }
    this.minAttributeLocation = Math.min(this.minAttributeLocation, location);
    this.attributes.push({location, offset, format});
    return this;
  }
};

export class VertexAttribute extends VertexInterleavedAttributes {
  constructor(location, values, format, stride) {
    if (!format) {
      format = DefaultAttributeType[location];
    }
    if (!stride) {
      stride = DefaultStride[format];
    }
    super(values, stride);
    super.addAttribute(location, 0, format);
  }

  addAttribute() {
    throw new Error('Cannot add attributes to a VertexAttribute. Use VertexInterleavedAttributes instead.');
  }
};

export class Geometry {
  constructor(desc = {}) {
    this.vertices = desc.vertices || [];
    this.indices = desc.indices || null;
    this.drawCount = desc.drawCount || 0;
    this.topology = desc.topology || 0;
  }
};
