// Incremental SHA-256 (FIPS 180-4). WebCrypto's subtle.digest requires the
// whole message in memory, so multi-gigabyte capture files are hashed here in
// fixed-size chunks instead.

const INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256Stream {
  private readonly state = new Uint32Array(INITIAL_STATE);
  private readonly buffer = new Uint8Array(64);
  private readonly schedule = new Uint32Array(64);
  private bufferedBytes = 0;
  private totalBytes = 0;
  private finalDigest: string | null = null;

  update(chunk: Uint8Array): void {
    if (this.finalDigest !== null) {
      throw new Error("Sha256Stream cannot accept more data after digestHex()");
    }
    if (this.totalBytes + chunk.length > Number.MAX_SAFE_INTEGER) {
      throw new Error("Sha256Stream input exceeds the supported message length");
    }
    this.totalBytes += chunk.length;
    let offset = 0;
    if (this.bufferedBytes > 0) {
      const take = Math.min(64 - this.bufferedBytes, chunk.length);
      this.buffer.set(chunk.subarray(0, take), this.bufferedBytes);
      this.bufferedBytes += take;
      offset = take;
      if (this.bufferedBytes < 64) return;
      this.compress(this.buffer, 0);
      this.bufferedBytes = 0;
    }
    while (offset + 64 <= chunk.length) {
      this.compress(chunk, offset);
      offset += 64;
    }
    if (offset < chunk.length) {
      this.buffer.set(chunk.subarray(offset), 0);
      this.bufferedBytes = chunk.length - offset;
    }
  }

  digestHex(): string {
    if (this.finalDigest !== null) return this.finalDigest;
    const tail = new Uint8Array(this.bufferedBytes < 56 ? 64 : 128);
    tail.set(this.buffer.subarray(0, this.bufferedBytes));
    tail[this.bufferedBytes] = 0x80;
    const bitLength = this.totalBytes * 8;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, Math.floor(bitLength / 4294967296));
    view.setUint32(tail.length - 4, bitLength >>> 0);
    this.compress(tail, 0);
    if (tail.length === 128) this.compress(tail, 64);
    this.finalDigest = Array.from(
      this.state,
      (word) => word.toString(16).padStart(8, "0"),
    ).join("");
    return this.finalDigest;
  }

  private compress(block: Uint8Array, offset: number): void {
    const schedule = this.schedule;
    for (let index = 0; index < 16; index += 1) {
      const cursor = offset + index * 4;
      schedule[index] = (
        (block[cursor]! << 24) |
        (block[cursor + 1]! << 16) |
        (block[cursor + 2]! << 8) |
        block[cursor + 3]!
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const early = schedule[index - 15]!;
      const late = schedule[index - 2]!;
      const sigma0 = (rotateRight(early, 7) ^ rotateRight(early, 18) ^ (early >>> 3)) >>> 0;
      const sigma1 = (rotateRight(late, 17) ^ rotateRight(late, 19) ^ (late >>> 10)) >>> 0;
      schedule[index] = (schedule[index - 16]! + sigma0 + schedule[index - 7]! + sigma1) >>> 0;
    }
    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
      const choose = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + bigSigma1 + choose + ROUND_CONSTANTS[index]! + schedule[index]!) >>> 0;
      const bigSigma0 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0]! + a) >>> 0;
    this.state[1] = (this.state[1]! + b) >>> 0;
    this.state[2] = (this.state[2]! + c) >>> 0;
    this.state[3] = (this.state[3]! + d) >>> 0;
    this.state[4] = (this.state[4]! + e) >>> 0;
    this.state[5] = (this.state[5]! + f) >>> 0;
    this.state[6] = (this.state[6]! + g) >>> 0;
    this.state[7] = (this.state[7]! + h) >>> 0;
  }
}

function rotateRight(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

export type Sha256BlobOptions = {
  onProgress?: (hashedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
};

// Streams a Blob or File sequentially through Sha256Stream so arbitrarily
// large capture uploads can be fingerprinted without buffering the file.
export async function sha256HexOfBlob(
  blob: Blob,
  options: Sha256BlobOptions = {},
): Promise<string> {
  const hash = new Sha256Stream();
  const reader = blob.stream().getReader();
  let hashedBytes = 0;
  try {
    while (true) {
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException("SHA-256 streaming was aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      hashedBytes += value.length;
      options.onProgress?.(hashedBytes, blob.size);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return hash.digestHex();
}
