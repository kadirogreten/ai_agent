# Domain pack: `e-ticaret` (Faz 2 — P0)

## İçerik özeti

| Öğe | Açıklama |
| ----- | --------- |
| `allowed-domains.txt` | Araştırmada öncelikli domainler |
| `glossary.md` | PDP, AOV, CVR vb. |
| **`regulatory_notes.md`** | Kırmızı çizgi özetleri (yanıltıcı pazarlama, sahte yorum, KVKK, tüketici hakları) |
| `rubrics/verifier.md` | Güncellenmiş verifier (abartılı söylem + içerik yasakları) |
| **`playbooks/`** | Toplam **6** playbook; her birinde **`version`: 1**, `defaultRisk`, `defaultPersona` |

## Playbook şema sürümü

Tüm pack playbook JSON’ları **`"version": 1`** ile etiketlenir. CLI `Playbook.ResolvedVersion` ile yok sayılan / 0 değerleri **1** olarak yorumlar (`Playbook.cs`; kök `playbooks/*.json` için geriye dönük uyum).
| **`bundles/`** | `weekly-starter`, `monthly-merchandiser` |

## Personalar (kök `personas/` — Strateji §4.1)

| Dosya | Rol |
| ----- | ----- |
| `e-ticaret-pm.md` | Genel ürün/büyüme |
| `merchandiser.md` | Ürün ve koleksiyon |
| `growth-marketer.md` | Performans pazarlığı |
| `customer-insights-analyst.md` | Yorum / sinyal |
| `seo-specialist.md` | Teknik+içerik SEO |
| **(ops.)** `campaign-planner.md` | Kampanya planlama |

`personas/` altındaki `README.md`, CLI’nın persona kök klasör kullandığını açıklar.

## Varsayılan risk özeti (`defaultRisk`)

| Playbook | Risk |
| --------- | ------ |
| `e-ticaret-pazar-genel` | R1 |
| `e-ticaret-urun-aciklama-uret` | R0 |
| `e-ticaret-seo-optimize-toplu` | R0 |
| `e-ticaret-rakip-fiyat-takip` | R1 |
| `e-ticaret-kampanya-tasarla` | **R2** (yüksek risk kampanya taslağı) |
| `e-ticaret-yorum-ozetle` | R1 |

`monthly-merchandiser` bundle’ında **kampanya playbook’u yok** → `--risk` verilmezse birleştirilmiş risk **`R1`**. Kampanya playbook’unu ekler veya **`--risk R2`/`R3`** kullanırsanız **`--allowHighRisk true`** gerekir.

## Örnekler

```bash
dotnet run --project src/AgentArmy.Cli -- list --domainPack e-ticaret
dotnet run --project src/AgentArmy.Cli -- bundles --domainPack e-ticaret
dotnet run --project src/AgentArmy.Cli -- run --domainPack e-ticaret --playbook e-ticaret-urun-aciklama-uret --topic "Örnek ürün özellikleri" --dryRun true
dotnet run --project src/AgentArmy.Cli -- bundle --domainPack e-ticaret --id monthly-merchandiser --topic "Aylık yenileme" --dryRun true --web true
```
## Sonraki adımlar

- `knowledge/e-ticaret/facts.jsonl` + portal/importer bağlantısı
- Varsayılan R2 playbook’unu onay kapısı ile üret ortamına alma doğrulaması
