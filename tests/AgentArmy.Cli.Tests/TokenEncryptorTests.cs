using Xunit;

namespace AgentArmy.Cli.Tests;

public class TokenEncryptorTests
{
  private const string KeyB64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 zero bytes

  [Fact]
  public void RoundTrip_EncryptDecrypt_Matches()
  {
    var plain = "meta_test_token_abc123";
    var cipher = TokenEncryptor.Encrypt(plain, KeyB64);
    var back   = TokenEncryptor.Decrypt(cipher, KeyB64);
    Assert.Equal(plain, back);
    Assert.DoesNotContain(plain, cipher);
  }

  [Fact]
  public void Decrypt_PlainPrefix_DevFallback()
  {
    Assert.Equal("tok", TokenEncryptor.Decrypt("plain:tok", KeyB64));
  }
}
