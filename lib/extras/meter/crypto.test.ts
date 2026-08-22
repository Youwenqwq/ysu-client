import { describe, expect, it } from "vitest";
import { aes128EcbDecrypt, aes128EcbEncrypt, base64ToBytes, bytesToBase64 } from "./crypto";

const hex = (s: string) => new Uint8Array(s.match(/../g)!.map((b) => parseInt(b, 16)));

// FIPS-197 Appendix B 已知答案
const FIPS_KEY = hex("000102030405060708090a0b0c0d0e0f");
const FIPS_PLAIN = hex("00112233445566778899aabbccddeeff");
const FIPS_CIPHER = hex("69c4e0d86a7b0430d8cdb78070b4c55a");

describe("aes128Ecb", () => {
  it("FIPS-197 已知答案：单分组加密/解密", () => {
    const encrypted = aes128EcbEncrypt(FIPS_KEY, FIPS_PLAIN);
    expect(encrypted.length).toBe(32); // 恰好一块明文 → 追加整块填充
    expect(encrypted.subarray(0, 16)).toEqual(FIPS_CIPHER);
    expect(aes128EcbDecrypt(FIPS_KEY, encrypted)).toEqual(FIPS_PLAIN);
  });

  it("多块（含中文）往返一致", () => {
    const key = new TextEncoder().encode("12345678ABCDEFGH");
    const plain = new TextEncoder().encode('{"param":"{"cmd":"getbindroom"}","customercode":"2036","备注":"燕山大学"}');
    const encrypted = aes128EcbEncrypt(key, plain);
    expect(encrypted.length % 16).toBe(0);
    expect(new TextDecoder().decode(aes128EcbDecrypt(key, encrypted))).toEqual(
      new TextDecoder().decode(plain),
    );
  });

  it("非法 padding 抛错而非静默产出", () => {
    const key = new TextEncoder().encode("12345678ABCDEFGH");
    const bad = aes128EcbEncrypt(key, new TextEncoder().encode("hello"));
    bad[bad.length - 1]! ^= 0xff;
    expect(() => aes128EcbDecrypt(key, bad)).toThrow("padding");
  });

  it("base64 与标准实现互操作", () => {
    const bytes = aes128EcbEncrypt(FIPS_KEY, FIPS_PLAIN);
    const b64 = bytesToBase64(bytes);
    expect(b64).toBe(Buffer.from(bytes).toString("base64"));
    expect(base64ToBytes(b64)).toEqual(bytes);
  });
});
