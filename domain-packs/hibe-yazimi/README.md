# Hibe yazımı — domain pack

**Hedef**: KOBİ Ar‑Ge projeleri, teknoloji startup’ları, akademik‑sanayi ortak başvuruları (öncelik Türkiye TÜBİTAK çağrıları; seçili AB enstrümanları için iskelet).

## İçindekiler

| Öğe | Açıklama |
| ----- | --------- |
| `allowed-domains.txt` | Teknik ve program kaynakları |
| `glossary.md` | Hibe ve Ar‑Ge terminolojisi |
| `regulatory_notes.md` | Kırmızı çizgiler |
| `rubrics/verifier.md` | Kalite ve doğrulanabilirlik eşikleri |
| `playbooks/` | Her JSON’da **`version`: 1** (Faz 2.5 DB senk öncesi şema); isteğe bağlı alanlar yükseltilebilir |

Personalar kök dizinde: `personas/hibe-yazari.md`, `arge-yoneticisi.md`, `is-paketi-mimari.md`, `butce-analisti.md`.

## Bundles

| Dosya | İçerik | Not (birleşik `defaultRisk`) |
| ----- | ------- | ------------------------------ |
| **`tubitak-1507-tam-paket`** | yenilik → 1501 WP → 1507 iskelet → bütçe | **R2** → `--allowHighRisk true` |
| **`tubitak-1501-tam-paket`** | yenilik → 1501 WP → bütçe | **R2** |
| **`eic-accelerator-mini`** | yenilik → EIC ön pitch | **R2** |

```bash
dotnet run --project src/AgentArmy.Cli -- bundles --domainPack hibe-yazimi
dotnet run --project src/AgentArmy.Cli -- bundle --domainPack hibe-yazimi --id tubitak-1507-tam-paket --topic "Proje özeti" --allowHighRisk true --dryRun true
```
