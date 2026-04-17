# AgentArmy (.NET)

Bu repo, “meslek/persona ajanları + fonksiyonel çekirdek” yaklaşımıyla çalışan bir **MVP ajan-ordu** iskeleti içerir.

## Gereksinimler

- .NET SDK 8+
- OpenAI anahtarı: `OPENAI_API_KEY` veya `agentarmy.local.json`

Opsiyonel:

- `OPENAI_MODEL` (varsayılan: `gpt-4.1`)

## Çalıştırma

Playbook listesi:

```bash
dotnet run --project src/AgentArmy.Cli -- list
```

Domain-pack içindeki playbook’ları da listelemek için:

```bash
dotnet run --project src/AgentArmy.Cli -- list --domainPack market-intel
```

Bundle (birden fazla playbook’u arka arkaya çalıştırma):

```bash
dotnet run --project src/AgentArmy.Cli -- bundles --domainPack market-intel
dotnet run --project src/AgentArmy.Cli -- bundle --domainPack market-intel --id weekly --topic "AI agent platforms" --web true --model gpt-5
```

Bundle çıktısı `runs/bundles/...` altında, her playbook için ayrı klasörler ve bir `bundle.json` manifesti ile oluşur.

Facts (bilgi tabanı) çıkarımı:

- `market-intel` domain-pack ile çalışırken varsayılan olarak her run sonunda `facts.json` (run klasörü içinde) üretilir.
- Ayrıca global olarak `knowledge/market-intel/facts.jsonl` dosyasına (append-only) benzersiz kayıtlar eklenir.
- Kapatmak için: `--facts false`

Örnek çalıştırma:

```bash
dotnet run --project src/AgentArmy.Cli -- run --playbook market-research --topic "Yapay zeka ajan platformları" --risk R1
```

Web kaynaklı (RAG/grounding) mod:

```bash
dotnet run --project src/AgentArmy.Cli -- run --playbook mi-trend-radar --topic "Yapay zeka ajan platformları" --risk R1 --web true --domainPack market-intel
```

Bu mod, OpenAI Responses API içindeki `web_search` aracını kullanır ve raporun sonuna URL kaynakları ekler. Web araması ayrı bir ücret kalemi olabilir.

Dry-run (LLM çağrısı yapmadan boru hattını test etmek için):

```bash
dotnet run --project src/AgentArmy.Cli -- run --playbook tech-design --topic "Basit CLI" --dryRun true
```

Yerel config dosyası (repo dışı):

- Otomatik kurulum:

```bash
dotnet run --project src/AgentArmy.Cli -- setup --model gpt-4.1
```

- Eğer `OPENAI_API_KEY` zaten ortamda tanımlıysa (anahtarı elle girmeden):

```bash
dotnet run --project src/AgentArmy.Cli -- setup-env --model gpt-4.1
```

Model seçimi:

- Daha yüksek kalite için `--model gpt-5` kullanabilirsin (daha yüksek maliyet/gecikme olabilir).
- Varsayılan model: `gpt-4.1`

- Manuel kurulum:
  - `config-examples/agentarmy.local.example.json` dosyasını `agentarmy.local.json` olarak kopyalayıp `openAI.apiKey` alanını doldur.

Çıktılar `runs/` altında oluşturulur.

## Doküman

- [ai-ajan-ordusu-piramit.md](docs/ai-ajan-ordusu-piramit.md)
