using System.Security.Cryptography;
using System.Text;

namespace AgentArmy.Cli;

/// <summary>
/// PR-S7a: AES-256-GCM — portal/api/lib/tokenEncryptor.ts ile aynı wire format.
/// base64(nonce[12] + ciphertext + tag[16])
/// </summary>
public static class TokenEncryptor
{
    private const int NonceLen = 12;
    private const int TagLen   = 16;

    public static string Encrypt(string plaintext, string? keyBase64 = null)
    {
        var key = LoadKey(keyBase64);
        var nonce = RandomNumberGenerator.GetBytes(NonceLen);
        var plain = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[plain.Length];
        var tag = new byte[TagLen];
        using var aes = new AesGcm(key, TagLen);
        aes.Encrypt(nonce, plain, cipher, tag);
        var packed = new byte[NonceLen + cipher.Length + TagLen];
        Buffer.BlockCopy(nonce, 0, packed, 0, NonceLen);
        Buffer.BlockCopy(cipher, 0, packed, NonceLen, cipher.Length);
        Buffer.BlockCopy(tag, 0, packed, NonceLen + cipher.Length, TagLen);
        return Convert.ToBase64String(packed);
    }

    public static string Decrypt(string ciphertextB64, string? keyBase64 = null)
    {
        if (ciphertextB64.StartsWith("plain:", StringComparison.Ordinal))
            return ciphertextB64["plain:".Length..];

        var key  = LoadKey(keyBase64);
        var buf  = Convert.FromBase64String(ciphertextB64);
        if (buf.Length < NonceLen + TagLen + 1)
            throw new InvalidOperationException("Geçersiz token ciphertext");

        var nonce      = buf.AsSpan(0, NonceLen);
        var tag        = buf.AsSpan(buf.Length - TagLen, TagLen);
        var cipher     = buf.AsSpan(NonceLen, buf.Length - NonceLen - TagLen);
        var plain      = new byte[cipher.Length];
        using var aes = new AesGcm(key, TagLen);
        aes.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }

    private static byte[] LoadKey(string? keyBase64)
    {
        var raw = keyBase64 ?? Environment.GetEnvironmentVariable("SOCIAL_TOKEN_ENC_KEY");
        if (string.IsNullOrWhiteSpace(raw))
            throw new InvalidOperationException("SOCIAL_TOKEN_ENC_KEY eksik");

        var key = Convert.FromBase64String(raw.Trim());
        if (key.Length != 32)
            throw new InvalidOperationException("SOCIAL_TOKEN_ENC_KEY 32 byte olmalı");
        return key;
    }
}
