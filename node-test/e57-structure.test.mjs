import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  E57_HEADER_BYTES,
  E57_LOGICAL_PAGE_BYTES,
  E57_MAXIMUM_XML_LOGICAL_BYTES,
  E57_PAGE_BYTES,
  crc32c,
  e57StructureSummary,
  inspectE57Structure,
  parseE57Header,
  serializeE57StructureReport,
} from "../scripts/e57-structure-core.mjs";

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<e57Root type="Structure" xmlns="http://www.astm.org/COMMIT/E57/2010-e57-v1.0" xmlns:fjd="http://example.invalid/fjd">
  <formatName type="String">ASTM E57 3D Imaging Data File</formatName>
  <guid type="String">{11111111-1111-4111-8111-111111111111}</guid>
  <versionMajor type="Integer">1</versionMajor>
  <versionMinor type="Integer">0</versionMinor>
  <coordinateMetadata type="String">local indoor frame, metres, Z up</coordinateMetadata>
  <data3D type="Vector" allowHeterogeneousChildren="1">
    <vectorChild type="Structure">
      <guid type="String">{aaaaaaaa-0000-4000-8000-000000000001}</guid>
      <name type="String">Station 1 &amp; lobby</name>
      <pose type="Structure">
        <rotation type="Structure">
          <w type="Float">1</w>
          <x type="Float">0</x>
          <y type="Float">0</y>
          <z type="Float">0</z>
        </rotation>
        <translation type="Structure">
          <x type="Float">1.5</x>
          <y type="Float">-2.25</y>
          <z type="Float">0.75</z>
        </translation>
      </pose>
      <cartesianBounds type="Structure">
        <xMinimum type="Float">-10</xMinimum>
        <yMinimum type="Float">-8</yMinimum>
        <zMinimum type="Float">0</zMinimum>
        <xMaximum type="Float">10</xMaximum>
        <yMaximum type="Float">8</yMaximum>
        <zMaximum type="Float">3.2</zMaximum>
      </cartesianBounds>
      <points type="CompressedVector" fileOffset="8192" recordCount="4210">
        <prototype type="Structure">
          <cartesianX type="Float" precision="single"/>
          <cartesianY type="Float" precision="single"/>
          <cartesianZ type="Float" precision="single"/>
          <intensity type="Integer" minimum="0" maximum="255"/>
          <fjd:surfaceClass type="Integer" minimum="0" maximum="7"/>
        </prototype>
      </points>
    </vectorChild>
    <vectorChild type="Structure">
      <guid type="String">{aaaaaaaa-0000-4000-8000-000000000002}</guid>
      <name type="String">Station 2 corridor</name>
      <pose type="Structure">
        <rotation type="Structure">
          <w type="Float">0.7071067811865476</w>
          <x type="Float">0</x>
          <y type="Float">0</y>
          <z type="Float">0.7071067811865476</z>
        </rotation>
        <translation type="Structure">
          <x type="Float">6.125</x>
          <y type="Float">0.5</y>
          <z type="Float">1.25</z>
        </translation>
      </pose>
      <cartesianBounds type="Structure">
        <xMinimum type="Float">0</xMinimum>
        <yMinimum type="Float">-4</yMinimum>
        <zMinimum type="Float">0</zMinimum>
        <xMaximum type="Float">18</xMaximum>
        <yMaximum type="Float">4</yMaximum>
        <zMaximum type="Float">3.1</zMaximum>
      </cartesianBounds>
      <points type="CompressedVector" fileOffset="65536" recordCount="9915">
        <prototype type="Structure">
          <cartesianX type="Float" precision="double"/>
          <cartesianY type="Float" precision="double"/>
          <cartesianZ type="Float" precision="double"/>
          <fjd:segmentId type="Integer" minimum="0" maximum="4095"/>
        </prototype>
      </points>
    </vectorChild>
  </data3D>
  <images2D type="Vector" allowHeterogeneousChildren="1">
    <vectorChild type="Structure">
      <guid type="String">{bbbbbbbb-0000-4000-8000-000000000001}</guid>
      <name type="String">Lobby panorama</name>
      <associatedData3DGuid type="String">{aaaaaaaa-0000-4000-8000-000000000001}</associatedData3DGuid>
      <pose type="Structure">
        <rotation type="Structure">
          <w type="Float">0</w>
          <x type="Float">1</x>
          <y type="Float">0</y>
          <z type="Float">0</z>
        </rotation>
        <translation type="Structure">
          <x type="Float">1.5</x>
          <y type="Float">-2.25</y>
          <z type="Float">1.6</z>
        </translation>
      </pose>
      <sphericalRepresentation type="Structure">
        <imageWidth type="Integer">8000</imageWidth>
        <imageHeight type="Integer">4000</imageHeight>
      </sphericalRepresentation>
    </vectorChild>
  </images2D>
</e57Root>
`;

function buildE57File(xml, { xmlPhysicalOffset = E57_HEADER_BYTES } = {}) {
  const xmlBytes = Buffer.from(xml, "utf8");
  const pages = [];
  const page = (index) => {
    while (pages.length <= index) pages.push(Buffer.alloc(E57_PAGE_BYTES));
    return pages[index];
  };
  page(0);
  let pageIndex = Math.floor(xmlPhysicalOffset / E57_PAGE_BYTES);
  let cursor = xmlPhysicalOffset % E57_PAGE_BYTES;
  let written = 0;
  while (written < xmlBytes.byteLength) {
    const take = Math.min(E57_LOGICAL_PAGE_BYTES - cursor, xmlBytes.byteLength - written);
    xmlBytes.copy(page(pageIndex), cursor, written, written + take);
    written += take;
    cursor = 0;
    pageIndex += 1;
  }
  const header = page(0);
  header.write("ASTM-E57", 0, "ascii");
  header.writeUInt32LE(1, 8);
  header.writeUInt32LE(0, 12);
  header.writeBigUInt64LE(BigInt(pages.length * E57_PAGE_BYTES), 16);
  header.writeBigUInt64LE(BigInt(xmlPhysicalOffset), 24);
  header.writeBigUInt64LE(BigInt(xmlBytes.byteLength), 32);
  header.writeBigUInt64LE(BigInt(E57_PAGE_BYTES), 40);
  return sealPages(pages);
}

function sealPages(pages) {
  for (const candidate of pages) {
    candidate.writeUInt32LE(crc32c(candidate.subarray(0, E57_LOGICAL_PAGE_BYTES)), E57_LOGICAL_PAGE_BYTES);
  }
  return Buffer.concat(pages);
}

describe("E57 public container structure", () => {
  it("computes the standard CRC-32C check value", () => {
    assert.equal(crc32c(Buffer.from("123456789", "ascii")), 0xe3069283);
  });

  it("extracts per-scan poses, bounds, vendor field names, and image representations", () => {
    const file = buildE57File(sampleXml);
    const report = inspectE57Structure(file);

    assert.equal(report.schemaVersion, "whymelabs.e57-structure.v1");
    assert.equal(report.method, "e57-structure-parser-v1");
    assert.deepEqual(report.header, {
      signature: "ASTM-E57",
      versionMajor: 1,
      versionMinor: 0,
      filePhysicalLength: file.byteLength,
      xmlPhysicalOffset: E57_HEADER_BYTES,
      xmlLogicalLength: Buffer.byteLength(sampleXml, "utf8"),
      pageSize: E57_PAGE_BYTES,
    });
    assert.equal(report.xml.checksumVerified, true);
    assert.equal(report.xml.logicalBytes, Buffer.byteLength(sampleXml, "utf8"));
    assert.ok(report.xml.pageCount > 1, "fixture must span more than one CRC page");
    assert.equal(report.root.formatName, "ASTM E57 3D Imaging Data File");
    assert.equal(report.coordinateMetadata, "local indoor frame, metres, Z up");

    assert.equal(report.data3D.length, 2);
    assert.equal(report.data3D[0].name, "Station 1 & lobby");
    assert.equal(report.data3D[0].guid, "{aaaaaaaa-0000-4000-8000-000000000001}");
    assert.equal(report.data3D[0].pointCount, 4210);
    assert.deepEqual(report.data3D[0].pose, {
      translation: { x: 1.5, y: -2.25, z: 0.75 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
    });
    assert.deepEqual(report.data3D[0].cartesianBounds, {
      xMinimum: -10,
      yMinimum: -8,
      zMinimum: 0,
      xMaximum: 10,
      yMaximum: 8,
      zMaximum: 3.2,
    });
    assert.deepEqual(report.data3D[0].pointFields, [
      { name: "cartesianX", type: "Float", precision: "single", extension: false },
      { name: "cartesianY", type: "Float", precision: "single", extension: false },
      { name: "cartesianZ", type: "Float", precision: "single", extension: false },
      { name: "intensity", type: "Integer", precision: null, extension: false },
      { name: "fjd:surfaceClass", type: "Integer", precision: null, extension: true },
    ]);
    assert.deepEqual(report.data3D[1].pose, {
      translation: { x: 6.125, y: 0.5, z: 1.25 },
      rotation: {
        w: 0.7071067811865476,
        x: 0,
        y: 0,
        z: 0.7071067811865476,
      },
    });
    assert.equal(report.data3D[1].pointCount, 9915);

    assert.equal(report.images2D.length, 1);
    assert.deepEqual(report.images2D[0].representations, ["sphericalRepresentation"]);
    assert.equal(report.images2D[0].associatedData3DGuid, "{aaaaaaaa-0000-4000-8000-000000000001}");
    assert.deepEqual(report.images2D[0].pose.translation, { x: 1.5, y: -2.25, z: 1.6 });

    assert.deepEqual(e57StructureSummary(report), {
      method: "e57-structure-parser-v1",
      scanCount: 2,
      imageCount: 1,
      hasPerScanPoses: true,
      vendorFieldNames: ["fjd:segmentId", "fjd:surfaceClass"],
    });
    assert.ok(report.limitations.some((limitation) =>
      limitation.includes("classification and mesh semantics")
    ));
    assert.equal(
      serializeE57StructureReport(report),
      serializeE57StructureReport(inspectE57Structure(buildE57File(sampleXml))),
    );
  });

  it("rejects a page whose stored CRC-32C no longer matches its bytes", () => {
    const file = buildE57File(sampleXml);
    assert.ok(file.byteLength >= 3 * E57_PAGE_BYTES, "fixture must contain a corruptible second page");
    const corrupted = Buffer.from(file);
    corrupted[E57_PAGE_BYTES + 16] ^= 0xff;
    assert.throws(() => inspectE57Structure(corrupted), (error) => {
      assert.equal(error.code, "E57_PAGE_CHECKSUM_MISMATCH");
      assert.equal(error.details.pageIndex, 1);
      return true;
    });
  });

  it("refuses an XML section declared above the 64 MiB logical bound", () => {
    const file = buildE57File(sampleXml);
    const oversized = Buffer.from(file);
    oversized.writeBigUInt64LE(BigInt(E57_MAXIMUM_XML_LOGICAL_BYTES + 1), 32);
    assert.throws(() => parseE57Header(oversized), (error) => {
      assert.equal(error.code, "E57_XML_SECTION_TOO_LARGE");
      assert.equal(error.details.maximumBytes, E57_MAXIMUM_XML_LOGICAL_BYTES);
      return true;
    });
    const atBound = Buffer.from(file);
    atBound.writeBigUInt64LE(BigInt(E57_MAXIMUM_XML_LOGICAL_BYTES), 32);
    assert.equal(
      parseE57Header(atBound).xmlLogicalLength,
      E57_MAXIMUM_XML_LOGICAL_BYTES,
    );
  });

  it("refuses a non-E57 signature and a DTD-bearing XML section", () => {
    assert.throws(
      () => parseE57Header(Buffer.alloc(E57_HEADER_BYTES)),
      /E57 file signature/,
    );
    const doctype = buildE57File(
      `<!DOCTYPE e57Root SYSTEM "http://example.invalid/e57.dtd">\n${sampleXml}`,
    );
    assert.throws(() => inspectE57Structure(doctype), (error) => {
      assert.equal(error.code, "E57_XML_INVALID");
      assert.match(error.message, /refuses DTD processing/);
      return true;
    });
  });
});
