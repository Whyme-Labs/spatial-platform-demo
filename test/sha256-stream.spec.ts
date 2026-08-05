import { describe, expect, it } from "vitest";
import { Sha256Stream, sha256HexOfBlob } from "../src/client/sha256-stream";

const encoder = new TextEncoder();

function oneShotHex(bytes: Uint8Array): string {
  const hash = new Sha256Stream();
  hash.update(bytes);
  return hash.digestHex();
}

function chunkedHex(bytes: Uint8Array, boundaries: number[]): string {
  const hash = new Sha256Stream();
  let cursor = 0;
  for (const boundary of boundaries) {
    hash.update(bytes.subarray(cursor, boundary));
    cursor = boundary;
  }
  hash.update(bytes.subarray(cursor));
  return hash.digestHex();
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function webCryptoHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Sha256Stream", () => {
  it("matches the NIST vector for the empty message", () => {
    expect(new Sha256Stream().digestHex()).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the NIST vector for \"abc\"", () => {
    expect(oneShotHex(encoder.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches the NIST two-block vector", () => {
    expect(oneShotHex(encoder.encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("matches the NIST vector for one million 'a' characters streamed in chunks", () => {
    const hash = new Sha256Stream();
    const chunk = new Uint8Array(4096).fill(0x61);
    let remaining = 1_000_000;
    while (remaining > 0) {
      const take = Math.min(remaining, chunk.length);
      hash.update(chunk.subarray(0, take));
      remaining -= take;
    }
    expect(hash.digestHex()).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  it("is invariant across block-aligned and unaligned split points", () => {
    const message = encoder.encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq");
    const expected = oneShotHex(message);
    for (const boundaries of [[1], [55], [56], [63], [64], [1, 2, 3], [32, 64], [7, 19, 40, 41]]) {
      expect(chunkedHex(message, boundaries)).toBe(expected);
    }
  });

  it("produces the one-shot digest for random inputs split at random boundaries", async () => {
    const random = mulberry32(0x5eed);
    for (let round = 0; round < 24; round += 1) {
      const length = Math.floor(random() * 1_500);
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        bytes[index] = Math.floor(random() * 256);
      }
      const boundaries = Array.from(
        { length: Math.floor(random() * 6) },
        () => Math.floor(random() * (length + 1)),
      ).sort((left, right) => left - right);
      const expected = oneShotHex(bytes);
      expect(chunkedHex(bytes, boundaries)).toBe(expected);
      expect(expected).toBe(await webCryptoHex(bytes));
    }
  });

  it("rejects further updates after the digest is finalised", () => {
    const hash = new Sha256Stream();
    hash.update(encoder.encode("abc"));
    const digest = hash.digestHex();
    expect(hash.digestHex()).toBe(digest);
    expect(() => hash.update(encoder.encode("more"))).toThrow(
      "Sha256Stream cannot accept more data after digestHex()",
    );
  });
});

describe("sha256HexOfBlob", () => {
  it("streams a blob sequentially and reports monotonic progress", async () => {
    const payload = new Uint8Array(300_000);
    for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
    const observed: number[] = [];
    const digest = await sha256HexOfBlob(new Blob([payload.slice().buffer]), {
      onProgress: (hashedBytes, totalBytes) => {
        observed.push(hashedBytes);
        expect(totalBytes).toBe(payload.length);
      },
    });
    expect(digest).toBe(oneShotHex(payload));
    expect(observed.at(-1)).toBe(payload.length);
    expect([...observed].sort((left, right) => left - right)).toEqual(observed);
  });

  it("rejects when the abort signal is already raised", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      sha256HexOfBlob(new Blob([encoder.encode("abc").slice().buffer]), { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
