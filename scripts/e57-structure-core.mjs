// ASTM E57 (E2807) is a public container standard. Parsing its header, its
// CRC-paged physical layout, and its XML section invents nothing: every field
// read here is named by the published standard. Vendor extension fields are
// recorded verbatim as evidence and are deliberately NOT interpreted.

export const E57_SIGNATURE = "ASTM-E57";
export const E57_HEADER_BYTES = 48;
export const E57_PAGE_BYTES = 1024;
export const E57_PAGE_CHECKSUM_BYTES = 4;
export const E57_LOGICAL_PAGE_BYTES = E57_PAGE_BYTES - E57_PAGE_CHECKSUM_BYTES;
export const E57_MAXIMUM_XML_LOGICAL_BYTES = 64 * 1024 * 1024;

const maximumXmlDepth = 64;
const maximumXmlNodes = 500_000;
const maximumAttributeCount = 64;

// ASTM E57 defines this point-record prototype vocabulary. Anything else in a
// prototype is an extension field: it is preserved by name and never decoded.
export const standardE57PointFieldNames = new Set([
  "cartesianX",
  "cartesianY",
  "cartesianZ",
  "cartesianInvalidState",
  "sphericalRange",
  "sphericalAzimuth",
  "sphericalElevation",
  "sphericalInvalidState",
  "rowIndex",
  "columnIndex",
  "returnIndex",
  "returnCount",
  "timeStamp",
  "isTimeStampInvalid",
  "intensity",
  "isIntensityInvalid",
  "colorRed",
  "colorGreen",
  "colorBlue",
  "isColorInvalid",
]);

export const e57StructureLimitations = [
  "Only the public ASTM E57 container structure is read: scan poses, bounds, point-field inventory, image representation types, and coordinate metadata.",
  "Vendor extension field names are recorded verbatim as evidence; their meaning is not decoded and no vendor schema is assumed.",
  "FJD classification and mesh semantics — indoor wall, floor, and ceiling labels — are NOT parsed. This report derives no structural claim, and none can be qualified before a registered indoor FJD corpus is available.",
  "No point, image, or mesh payload is decoded; this report does not verify capture accuracy, registration, calibration, or reconstruction quality.",
];

export class E57StructureError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "E57StructureError";
    this.code = code;
    this.details = details;
  }
}

const crc32cTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32c(bytes) {
  const source = asBytes(bytes, "CRC-32C input");
  let crc = 0xffffffff;
  for (let index = 0; index < source.byteLength; index += 1) {
    crc = (crc >>> 8) ^ crc32cTable[(crc ^ source[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function parseE57Header(bytes) {
  const source = asBytes(bytes, "E57 header");
  if (source.byteLength < E57_HEADER_BYTES) {
    throw new E57StructureError(
      "E57_HEADER_TRUNCATED",
      `E57 header requires ${E57_HEADER_BYTES} bytes, received ${source.byteLength}`,
      { receivedBytes: source.byteLength },
    );
  }
  const signature = new TextDecoder("ascii").decode(source.subarray(0, 8));
  if (signature !== E57_SIGNATURE) {
    throw new E57StructureError(
      "E57_SIGNATURE_INVALID",
      `E57 file signature is ${JSON.stringify(signature)}, expected ${E57_SIGNATURE}`,
      { signature },
    );
  }
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const header = {
    signature,
    versionMajor: view.getUint32(8, true),
    versionMinor: view.getUint32(12, true),
    filePhysicalLength: readUint64(view, 16, "filePhysicalLength"),
    xmlPhysicalOffset: readUint64(view, 24, "xmlPhysicalOffset"),
    xmlLogicalLength: readUint64(view, 32, "xmlLogicalLength"),
    pageSize: readUint64(view, 40, "pageSize"),
  };
  if (header.pageSize !== E57_PAGE_BYTES) {
    throw new E57StructureError(
      "E57_PAGE_SIZE_UNSUPPORTED",
      `E57 declares a ${header.pageSize}-byte page; this reader implements the standard ${E57_PAGE_BYTES}-byte CRC page only`,
      { pageSize: header.pageSize },
    );
  }
  if (header.filePhysicalLength <= 0 || header.filePhysicalLength % header.pageSize !== 0) {
    throw new E57StructureError(
      "E57_FILE_LENGTH_INVALID",
      `E57 filePhysicalLength ${header.filePhysicalLength} is not a positive multiple of the ${header.pageSize}-byte page`,
      { filePhysicalLength: header.filePhysicalLength },
    );
  }
  if (header.xmlLogicalLength <= 0) {
    throw new E57StructureError(
      "E57_XML_SECTION_EMPTY",
      "E57 declares an empty XML section",
      { xmlLogicalLength: header.xmlLogicalLength },
    );
  }
  if (header.xmlLogicalLength > E57_MAXIMUM_XML_LOGICAL_BYTES) {
    throw new E57StructureError(
      "E57_XML_SECTION_TOO_LARGE",
      `E57 XML section is ${header.xmlLogicalLength} logical bytes, above the ${E57_MAXIMUM_XML_LOGICAL_BYTES}-byte bound`,
      {
        xmlLogicalLength: header.xmlLogicalLength,
        maximumBytes: E57_MAXIMUM_XML_LOGICAL_BYTES,
      },
    );
  }
  if (header.xmlPhysicalOffset < E57_HEADER_BYTES || header.xmlPhysicalOffset >= header.filePhysicalLength) {
    throw new E57StructureError(
      "E57_XML_OFFSET_INVALID",
      `E57 xmlPhysicalOffset ${header.xmlPhysicalOffset} is outside the declared ${header.filePhysicalLength}-byte file`,
      {
        xmlPhysicalOffset: header.xmlPhysicalOffset,
        filePhysicalLength: header.filePhysicalLength,
      },
    );
  }
  if (header.xmlPhysicalOffset % header.pageSize >= E57_LOGICAL_PAGE_BYTES) {
    throw new E57StructureError(
      "E57_XML_OFFSET_INVALID",
      `E57 xmlPhysicalOffset ${header.xmlPhysicalOffset} starts inside a page checksum`,
      { xmlPhysicalOffset: header.xmlPhysicalOffset },
    );
  }
  return header;
}

// The XML section is stored as logical bytes interleaved with a per-page
// CRC-32C. Reading it back therefore needs the whole aligned page range, not
// just the logical byte count.
export function e57XmlPhysicalSpan(header) {
  const offsetInPage = header.xmlPhysicalOffset % header.pageSize;
  const firstPageLogicalBytes = E57_LOGICAL_PAGE_BYTES - offsetInPage;
  let physicalDataBytes;
  if (header.xmlLogicalLength <= firstPageLogicalBytes) {
    physicalDataBytes = header.xmlLogicalLength;
  } else {
    const remainingLogicalBytes = header.xmlLogicalLength - firstPageLogicalBytes;
    const wholePages = Math.floor(remainingLogicalBytes / E57_LOGICAL_PAGE_BYTES);
    const tailLogicalBytes = remainingLogicalBytes % E57_LOGICAL_PAGE_BYTES;
    physicalDataBytes = firstPageLogicalBytes + E57_PAGE_CHECKSUM_BYTES +
      wholePages * header.pageSize + tailLogicalBytes;
  }
  const physicalStart = header.xmlPhysicalOffset - offsetInPage;
  const physicalEnd = header.xmlPhysicalOffset + physicalDataBytes;
  const pageCount = Math.ceil((physicalEnd - physicalStart) / header.pageSize);
  const physicalLength = pageCount * header.pageSize;
  if (physicalStart + physicalLength > header.filePhysicalLength) {
    throw new E57StructureError(
      "E57_XML_SECTION_OUT_OF_RANGE",
      `E57 XML section spans ${physicalStart + physicalLength} bytes, beyond the declared ${header.filePhysicalLength}-byte file`,
      { physicalStart, physicalLength, filePhysicalLength: header.filePhysicalLength },
    );
  }
  return { physicalStart, physicalLength, pageCount, offsetInPage };
}

export function readE57XmlSection(header, physicalBytes, physicalStart) {
  const span = e57XmlPhysicalSpan(header);
  if (physicalStart !== span.physicalStart) {
    throw new E57StructureError(
      "E57_XML_SPAN_MISALIGNED",
      `E57 XML page span starts at ${span.physicalStart}, received bytes from ${physicalStart}`,
      { expectedStart: span.physicalStart, receivedStart: physicalStart },
    );
  }
  const source = asBytes(physicalBytes, "E57 XML section");
  if (source.byteLength < span.physicalLength) {
    throw new E57StructureError(
      "E57_XML_SECTION_TRUNCATED",
      `E57 XML section requires ${span.physicalLength} physical bytes, received ${source.byteLength}`,
      { requiredBytes: span.physicalLength, receivedBytes: source.byteLength },
    );
  }
  const logical = new Uint8Array(header.xmlLogicalLength);
  let written = 0;
  for (let page = 0; page < span.pageCount; page += 1) {
    const pageStart = page * header.pageSize;
    const pageBytes = source.subarray(pageStart, pageStart + header.pageSize);
    const computed = crc32c(pageBytes.subarray(0, E57_LOGICAL_PAGE_BYTES));
    const stored = new DataView(
      pageBytes.buffer,
      pageBytes.byteOffset + E57_LOGICAL_PAGE_BYTES,
      E57_PAGE_CHECKSUM_BYTES,
    ).getUint32(0, true);
    if (computed !== stored) {
      throw new E57StructureError(
        "E57_PAGE_CHECKSUM_MISMATCH",
        `E57 page ${page} CRC-32C mismatch: stored ${hex32(stored)}, computed ${hex32(computed)}`,
        {
          pageIndex: page,
          physicalOffset: span.physicalStart + pageStart,
          stored: hex32(stored),
          computed: hex32(computed),
        },
      );
    }
    const readFrom = page === 0 ? span.offsetInPage : 0;
    const available = E57_LOGICAL_PAGE_BYTES - readFrom;
    const take = Math.min(available, header.xmlLogicalLength - written);
    if (take <= 0) continue;
    logical.set(pageBytes.subarray(readFrom, readFrom + take), written);
    written += take;
  }
  if (written !== header.xmlLogicalLength) {
    throw new E57StructureError(
      "E57_XML_SECTION_TRUNCATED",
      `E57 XML section reassembled ${written} of ${header.xmlLogicalLength} logical bytes`,
      { reassembledBytes: written, expectedBytes: header.xmlLogicalLength },
    );
  }
  return {
    xml: new TextDecoder("utf-8", { fatal: false }).decode(logical),
    logicalBytes: header.xmlLogicalLength,
    pageCount: span.pageCount,
    physicalStart: span.physicalStart,
    physicalLength: span.physicalLength,
  };
}

// A purpose-built, bounded XML reader. It refuses DOCTYPE outright, so no
// entity expansion, external entity, or DTD path exists at all.
export function parseBoundedXml(text) {
  if (typeof text !== "string") {
    throw new E57StructureError("E57_XML_INVALID", "E57 XML section is not decodable text");
  }
  const stack = [];
  let root = null;
  let nodeCount = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("<", cursor);
    if (open < 0) break;
    if (stack.length) {
      const chunk = text.slice(cursor, open);
      if (chunk) stack[stack.length - 1].text += chunk;
    }
    if (text.startsWith("<!--", open)) {
      const close = text.indexOf("-->", open + 4);
      if (close < 0) throw xmlError("E57 XML comment is unterminated", open);
      cursor = close + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", open)) {
      const close = text.indexOf("]]>", open + 9);
      if (close < 0) throw xmlError("E57 XML CDATA section is unterminated", open);
      if (stack.length) stack[stack.length - 1].text += text.slice(open + 9, close);
      cursor = close + 3;
      continue;
    }
    if (text.startsWith("<!DOCTYPE", open)) {
      throw xmlError("E57 XML declares a DOCTYPE; this reader refuses DTD processing", open);
    }
    if (text.startsWith("<?", open)) {
      const close = text.indexOf("?>", open + 2);
      if (close < 0) throw xmlError("E57 XML processing instruction is unterminated", open);
      cursor = close + 2;
      continue;
    }
    const close = text.indexOf(">", open + 1);
    if (close < 0) throw xmlError("E57 XML tag is unterminated", open);
    const raw = text.slice(open + 1, close);
    cursor = close + 1;
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      const current = stack.pop();
      if (!current || current.name !== name) {
        throw xmlError(`E57 XML close tag ${JSON.stringify(name)} does not match its open tag`, open);
      }
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([A-Za-z_][\w.:-]*)/.exec(body);
    if (!nameMatch) throw xmlError("E57 XML element name is not a valid XML name", open);
    nodeCount += 1;
    if (nodeCount > maximumXmlNodes) {
      throw new E57StructureError(
        "E57_XML_TOO_COMPLEX",
        `E57 XML declares more than ${maximumXmlNodes} elements`,
        { maximumNodes: maximumXmlNodes },
      );
    }
    const node = {
      name: nameMatch[1],
      attributes: parseXmlAttributes(body.slice(nameMatch[1].length), open),
      children: [],
      text: "",
    };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (root) throw xmlError("E57 XML declares more than one root element", open);
    else root = node;
    if (!selfClosing) {
      stack.push(node);
      if (stack.length > maximumXmlDepth) {
        throw new E57StructureError(
          "E57_XML_TOO_DEEP",
          `E57 XML nests deeper than ${maximumXmlDepth} elements`,
          { maximumDepth: maximumXmlDepth },
        );
      }
    }
  }
  if (stack.length) {
    throw new E57StructureError(
      "E57_XML_INVALID",
      `E57 XML element ${JSON.stringify(stack[stack.length - 1].name)} is never closed`,
    );
  }
  if (!root) throw new E57StructureError("E57_XML_INVALID", "E57 XML section has no root element");
  return root;
}

export function extractE57Structure(header, section) {
  const root = parseBoundedXml(section.xml);
  if (localName(root.name) !== "e57Root") {
    throw new E57StructureError(
      "E57_ROOT_UNEXPECTED",
      `E57 XML root element is ${JSON.stringify(root.name)}, expected e57Root`,
      { rootName: root.name },
    );
  }
  const data3D = childElement(root, "data3D");
  const images2D = childElement(root, "images2D");
  const scans = vectorChildren(data3D).map(readData3D);
  const images = vectorChildren(images2D).map(readImage2D);
  const vendorFieldNames = [
    ...new Set(
      scans.flatMap((scan) =>
        scan.pointFields.filter((field) => field.extension).map((field) => field.name)
      ),
    ),
  ].sort();
  return {
    schemaVersion: "whymelabs.e57-structure.v1",
    method: "e57-structure-parser-v1",
    standard: "ASTM E2807 E57 public container structure",
    header: {
      signature: header.signature,
      versionMajor: header.versionMajor,
      versionMinor: header.versionMinor,
      filePhysicalLength: header.filePhysicalLength,
      xmlPhysicalOffset: header.xmlPhysicalOffset,
      xmlLogicalLength: header.xmlLogicalLength,
      pageSize: header.pageSize,
    },
    xml: {
      logicalBytes: section.logicalBytes,
      pageCount: section.pageCount,
      pageSizeBytes: header.pageSize,
      checksum: "crc-32c",
      checksumVerified: true,
    },
    root: {
      formatName: childText(root, "formatName"),
      guid: childText(root, "guid"),
      versionMajor: childNumber(root, "versionMajor"),
      versionMinor: childNumber(root, "versionMinor"),
    },
    coordinateMetadata: childText(root, "coordinateMetadata"),
    summary: {
      scanCount: scans.length,
      imageCount: images.length,
      hasPerScanPoses: scans.length > 0 && scans.every((scan) => scan.pose !== null),
      vendorFieldNames,
    },
    data3D: scans,
    images2D: images,
    limitations: [...e57StructureLimitations],
  };
}

export function inspectE57Structure(bytes) {
  const source = asBytes(bytes, "E57 file");
  const header = parseE57Header(source);
  const span = e57XmlPhysicalSpan(header);
  const section = readE57XmlSection(
    header,
    source.subarray(span.physicalStart, span.physicalStart + span.physicalLength),
    span.physicalStart,
  );
  return extractE57Structure(header, section);
}

export function e57StructureSummary(report) {
  return {
    method: report.method,
    scanCount: report.summary.scanCount,
    imageCount: report.summary.imageCount,
    hasPerScanPoses: report.summary.hasPerScanPoses,
    vendorFieldNames: [...report.summary.vendorFieldNames],
  };
}

export function serializeE57StructureReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function readData3D(node, index) {
  const points = childElement(node, "points");
  const prototype = points ? childElement(points, "prototype") : null;
  return {
    index,
    name: childText(node, "name"),
    guid: childText(node, "guid"),
    pose: readPose(childElement(node, "pose")),
    cartesianBounds: readCartesianBounds(childElement(node, "cartesianBounds")),
    pointCount: points ? integerAttribute(points, "recordCount") : null,
    pointFields: (prototype?.children ?? []).map((field) => ({
      name: field.name,
      type: field.attributes.type ?? null,
      precision: field.attributes.precision ?? null,
      extension: !standardE57PointFieldNames.has(field.name),
    })),
  };
}

function readImage2D(node, index) {
  return {
    index,
    name: childText(node, "name"),
    guid: childText(node, "guid"),
    associatedData3DGuid: childText(node, "associatedData3DGuid"),
    pose: readPose(childElement(node, "pose")),
    representations: node.children
      .filter((child) => localName(child.name).endsWith("Representation"))
      .map((child) => child.name),
  };
}

function readPose(node) {
  if (!node) return null;
  const translation = childElement(node, "translation");
  const rotation = childElement(node, "rotation");
  if (!translation || !rotation) return null;
  const values = {
    translation: {
      x: childNumber(translation, "x"),
      y: childNumber(translation, "y"),
      z: childNumber(translation, "z"),
    },
    rotation: {
      w: childNumber(rotation, "w"),
      x: childNumber(rotation, "x"),
      y: childNumber(rotation, "y"),
      z: childNumber(rotation, "z"),
    },
  };
  const complete = [
    ...Object.values(values.translation),
    ...Object.values(values.rotation),
  ].every((value) => value !== null);
  return complete ? values : null;
}

function readCartesianBounds(node) {
  if (!node) return null;
  const bounds = {
    xMinimum: childNumber(node, "xMinimum"),
    yMinimum: childNumber(node, "yMinimum"),
    zMinimum: childNumber(node, "zMinimum"),
    xMaximum: childNumber(node, "xMaximum"),
    yMaximum: childNumber(node, "yMaximum"),
    zMaximum: childNumber(node, "zMaximum"),
  };
  return Object.values(bounds).every((value) => value !== null) ? bounds : null;
}

function vectorChildren(node) {
  if (!node) return [];
  return node.children.filter((child) => localName(child.name) === "vectorChild");
}

function childElement(node, name) {
  return node.children.find((child) => localName(child.name) === name) ?? null;
}

function childText(node, name) {
  const child = childElement(node, name);
  if (!child) return null;
  const value = decodeXmlEntities(child.text).trim();
  return value.length ? value : null;
}

function childNumber(node, name) {
  const value = childText(node, name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerAttribute(node, name) {
  const value = node.attributes[name];
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseXmlAttributes(text, offset) {
  const attributes = {};
  const pattern = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let count = 0;
  for (const match of text.matchAll(pattern)) {
    count += 1;
    if (count > maximumAttributeCount) {
      throw new E57StructureError(
        "E57_XML_TOO_COMPLEX",
        `E57 XML element declares more than ${maximumAttributeCount} attributes`,
        { maximumAttributes: maximumAttributeCount },
      );
    }
    attributes[match[1]] = decodeXmlEntities(match[3] ?? match[4] ?? "");
  }
  const residue = text.replace(pattern, "").trim();
  if (residue) throw xmlError(`E57 XML attribute list is malformed near ${JSON.stringify(residue.slice(0, 40))}`, offset);
  return attributes;
}

function decodeXmlEntities(value) {
  return value.replace(/&(#x?[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const codePoint = entity.startsWith("#x") || entity.startsWith("#X")
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
    return String.fromCodePoint(codePoint);
  });
}

function localName(name) {
  const separator = name.indexOf(":");
  return separator < 0 ? name : name.slice(separator + 1);
}

function xmlError(message, offset) {
  return new E57StructureError("E57_XML_INVALID", `${message} at character ${offset}`, { offset });
}

function readUint64(view, offset, field) {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new E57StructureError(
      "E57_HEADER_FIELD_TOO_LARGE",
      `E57 ${field} ${value} exceeds the safe integer range`,
      { field, value: value.toString() },
    );
  }
  return Number(value);
}

function hex32(value) {
  return value.toString(16).padStart(8, "0");
}

function asBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new E57StructureError("E57_INPUT_INVALID", `${label} must be binary bytes`);
}
