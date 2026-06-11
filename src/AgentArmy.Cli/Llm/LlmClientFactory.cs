namespace AgentArmy.Cli;

/// <summary>
/// PR10: LlmProviderRecord → ILlmClient fabrikası.
/// kind alanını okur (URL koklamak yerine); AnthropicMessagesClient veya OpenAiResponsesClient döner.
/// api_key_env: env değişkenini okur — yok ise InvalidOperationException.
/// </summary>
public static class LlmClientFactory
{
    /// <param name="http">Paylaşılan HttpClient — BaseAddress bu metot içinde set edilir.</param>
    /// <param name="provider">llm_providers tablosundan çözümlenen kayıt.</param>
    /// <param name="enableWebSearch">Yalnızca OpenAI provider için web search açık mı.</param>
    public static ILlmClient Create(HttpClient http, LlmProviderRecord provider, bool enableWebSearch = false)
    {
        var apiKey = Environment.GetEnvironmentVariable(provider.ApiKeyEnv);
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException(
                $"[LlmClientFactory] '{provider.ApiKeyEnv}' env değişkeni bulunamadı (provider: {provider.Slug})");

        return provider.Kind switch
        {
            "anthropic" => new AnthropicMessagesClient(http, apiKey, provider.ModelId, provider.ApiBase),
            _           => new OpenAiResponsesClient(http, apiKey, provider.ModelId, enableWebSearch, apiBase: provider.ApiBase),
        };
    }
}
