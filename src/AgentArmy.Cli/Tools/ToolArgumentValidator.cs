using System.Text.Json;

namespace AgentArmy.Cli;

/// <summary>
/// D0c: Minimal JSON Schema doğrulayıcı (required + type + enum).
/// Tam draft-07 / harici NuGet yok.
/// </summary>
public static class ToolArgumentValidator
{
    public static string? Validate(JsonElement args, JsonElement schema)
    {
        if (args.ValueKind is JsonValueKind.Undefined)
            args = JsonDocument.Parse("{}").RootElement;

        if (args.ValueKind != JsonValueKind.Object)
            return "Argümanlar bir JSON nesnesi olmalı.";

        if (schema.ValueKind != JsonValueKind.Object)
            return null;

        if (schema.TryGetProperty("required", out var reqEl) && reqEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var r in reqEl.EnumerateArray())
            {
                if (r.ValueKind != JsonValueKind.String) continue;
                var name = r.GetString();
                if (string.IsNullOrWhiteSpace(name)) continue;
                if (!args.TryGetProperty(name, out var prop) || IsMissing(prop))
                    return $"Zorunlu alan eksik: '{name}'.";
            }
        }

        if (!schema.TryGetProperty("properties", out var props) || props.ValueKind != JsonValueKind.Object)
            return null;

        foreach (var prop in args.EnumerateObject())
        {
            if (!props.TryGetProperty(prop.Name, out var propSchema) || propSchema.ValueKind != JsonValueKind.Object)
                continue;

            var err = ValidateValue(prop.Name, prop.Value, propSchema);
            if (err is not null) return err;
        }

        return null;
    }

    private static bool IsMissing(JsonElement el) =>
        el.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
        || (el.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(el.GetString()));

    private static string? ValidateValue(string name, JsonElement value, JsonElement schema)
    {
        if (!schema.TryGetProperty("type", out var typeEl) || typeEl.ValueKind != JsonValueKind.String)
            return null;

        var type = typeEl.GetString() ?? "string";
        switch (type)
        {
            case "string":
                if (value.ValueKind != JsonValueKind.String)
                    return $"'{name}' string olmalı.";
                if (schema.TryGetProperty("enum", out var enumEl) && enumEl.ValueKind == JsonValueKind.Array)
                {
                    var s = value.GetString();
                    var ok = enumEl.EnumerateArray().Any(e =>
                        e.ValueKind == JsonValueKind.String
                        && string.Equals(e.GetString(), s, StringComparison.Ordinal));
                    if (!ok) return $"'{name}' izin verilen enum değerlerinden biri değil.";
                }
                break;
            case "integer":
            case "number":
                if (value.ValueKind != JsonValueKind.Number)
                    return $"'{name}' sayı olmalı.";
                break;
            case "boolean":
                if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    return $"'{name}' boolean olmalı.";
                break;
            case "array":
                if (value.ValueKind != JsonValueKind.Array)
                    return $"'{name}' dizi olmalı.";
                if (schema.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Object
                    && items.TryGetProperty("type", out var itemType) && itemType.GetString() == "string")
                {
                    foreach (var item in value.EnumerateArray())
                    {
                        if (item.ValueKind != JsonValueKind.String)
                            return $"'{name}' öğeleri string olmalı.";
                    }
                }
                break;
            case "object":
                if (value.ValueKind != JsonValueKind.Object)
                    return $"'{name}' nesne olmalı.";
                break;
        }

        return null;
    }
}
