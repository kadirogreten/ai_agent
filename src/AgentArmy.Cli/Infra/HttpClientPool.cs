using System.Net;

namespace AgentArmy.Cli;

/// <summary>
/// Paylaşılan HttpClient havuzu. .NET'te <c>new HttpClient()</c> her seferinde TCP
/// handshake + SSL renegotiation üretir; production'da socket exhaustion riski.
///
/// Tüm CLI bileşenleri (Supabase, OpenAI, DomainPackDbLoader, vs.) buradaki
/// önceden yapılandırılmış SocketsHttpHandler üzerine kurulu HttpClient'ları kullanır.
///
/// Önemli: Dönen HttpClient'ları DISPOSE ETMEYİN (paylaşılan handler ölür).
/// </summary>
public static class HttpClientPool
{
    internal static readonly SocketsHttpHandler SharedHandler = new SocketsHttpHandler
    {
        PooledConnectionLifetime    = TimeSpan.FromMinutes(5),
        PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2),
        MaxConnectionsPerServer     = 32,
        AutomaticDecompression      = DecompressionMethods.All,
    };

    /// <summary>Varsayılan: 60sn timeout — genel REST çağrıları.</summary>
    public static readonly HttpClient Shared = new HttpClient(SharedHandler, disposeHandler: false)
    {
        Timeout = TimeSpan.FromSeconds(60)
    };

    /// <summary>15sn timeout — Supabase fire-and-forget INSERT/SELECT.</summary>
    public static readonly HttpClient FastWrite = new HttpClient(SharedHandler, disposeHandler: false)
    {
        Timeout = TimeSpan.FromSeconds(15)
    };

    /// <summary>5dk timeout — LLM ve image generation gibi uzun süren çağrılar.</summary>
    public static readonly HttpClient LongRunning = new HttpClient(SharedHandler, disposeHandler: false)
    {
        Timeout = TimeSpan.FromMinutes(5)
    };
}
