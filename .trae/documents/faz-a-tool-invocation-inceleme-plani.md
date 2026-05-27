# Faz A (Tool Invocation) — İnceleme ve Uygulama Planı

Bu plan, iki dokümanın (“operasyonel özerklik yol haritası” ve “Faz A tool invocation tasarım”) repodaki mevcut durumla karşılaştırmalı incelemesini ve Faz A’yı düşük riskli şekilde hayata geçirmek için uygulanabilir adımları içerir.

## 1) Özet

Amaç: Sistemi **OA0 (üretici)** seviyesinden **OA1→OA2 kapısını açacak** şekilde, kontrollü biçimde “araç çağırabilir” hale getirmek (Faz A). Faz A’nın güvenlik vaadi: **salt-okunur** veya **geri-alınabilir** araçlar; RiskGate + audit zorunlu; geri-alınamaz yan etkiler (R3) Faz A’da yasak.

İnceleme kaynakları:
- [operasyonel-ozerklik-yol-haritasi.md](file:///Users/kadirogreten/Desktop/Source/ai_agent/docs/operasyonel-ozerklik-yol-haritasi.md)
- [faz-a-tool-invocation-tasarim.md](file:///Users/kadirogreten/Desktop/Source/ai_agent/docs/faz-a-tool-invocation-tasarim.md)

## 2) Mevcut Durum Analizi (Kod Gerçekleri)

### 2.1 DB: Tool Registry / Audit / RiskGate altyapısı
- Tool registry tablosu ve seed araçlar mevcut: [0017_tool_registry.sql](file:///Users/kadirogreten/Desktop/Source/ai_agent/supabase/migrations/0017_tool_registry.sql)
- Audit log ve immutable append RPC mevcut: [0014_audit_log.sql](file:///Users/kadirogreten/Desktop/Source/ai_agent/supabase/migrations/0014_audit_log.sql)
- RiskGate mevcut ve R2/R3 için approval_queue kullanıyor: [RiskGate.cs](file:///Users/kadirogreten/Desktop/Source/ai_agent/src/AgentArmy.Cli/Cli/RiskGate.cs)

### 2.2 CLI runtime: Orchestrator + LLM client
- Orchestrator adım döngüsü tek tur LLM output ile bitiyor; tool-call döngüsü yok: [Orchestrator.cs](file:///Users/kadirogreten/Desktop/Source/ai_agent/src/AgentArmy.Cli/Runtime/Orchestrator.cs)
- LLM arayüzü sadece metin cevaplıyor: [ILlmClient.cs](file:///Users/kadirogreten/Desktop/Source/ai_agent/src/AgentArmy.Cli/Llm/ILlmClient.cs)
- OpenAI “tools” payload alanı kısmen var ama yalnız web_search gibi kullanım; function-call parse ve multi-turn tool exchange yok: [OpenAiResponsesClient.cs](file:///Users/kadirogreten/Desktop/Source/ai_agent/src/AgentArmy.Cli/Llm/OpenAiResponsesClient.cs)

### 2.3 Portal: görünürlük var, invocation yok
- ToolsPage yalnızca registry listeleme / enabled toggle yapıyor: [ToolsPage.tsx](file:///Users/kadirogreten/Desktop/Source/ai_agent/portal/src/pages/ToolsPage.tsx)
- AuditLogPage var: [AuditLogPage.tsx](file:///Users/kadirogreten/Desktop/Source/ai_agent/portal/src/pages/AuditLogPage.tsx)
- Tool invocation geçmişini gösteren sayfa/sekme yok.

## 3) Dokümanlarla Karşılaştırmalı Gap Listesi

### 3.1 En kritik gap’ler (Faz A’nın “biten tanımı”nı engelliyor)
- ToolExecutor / ITool modeli yok (core runtime eksik).
- Tool-call döngüsü yok (Orchestrator tek LLM çağrısı ile bitiyor).
- LLM tool-aware API yok (CompleteWithToolsAsync, ToolCall parse, ToolExchange yok).
- `tools` tablosunda sözleşme alanları yok; `tool_invocations` tablosu yok.

### 3.2 Güvenlik uyumsuzluğu (Faz A vaadine ters)
- RiskGate bugün bazı koşullarda **dev-mode bypass ile approved** dönebiliyor (fail-open). Faz A tasarımında yan etkili çağrılar için “DB yoksa fail-closed” şartı var. Bu, Faz A’ya geçişte özel olarak ele alınmalı.

## 4) Önerilen Uygulama Stratejisi (PR’lara Bölünmüş)

Bu bölüm, dokümandaki PR bölümlendirmesini repodaki gerçek dosya yollarına bağlar. Uygulama sırasında “gereksiz refactor yok, yalnız Faz A kapsamı” kuralı uygulanır.

### PR1 — DB sözleşmesi + tool_invocations (migration)
- Hedef: `tools` sözleşmesini genişletmek ve her çağrı için kalıcı `tool_invocations` tablosunu eklemek.
- Değişiklikler:
  - Yeni migration (dokümanda `0027_tool_invocation.sql`): `tools` tablosuna `input_schema`, `output_schema`, `side_effect`, `reversible`, `min_risk`, `compensation` alanları; `tool_invocations` tablosu; seed update.
  - RLS/policy: authenticated SELECT, service_role INSERT/UPDATE.
- Doğrulama:
  - SQL Editor’da migration uygulanır.
  - `tools` satırlarında side_effect/min_risk alanları görünür.

### PR2 — CLI: ToolDescriptor/ToolResult + ITool + ToolExecutor iskeleti
- Hedef: Araç sözleşmesini modellemek ve tek giriş noktası olan executor’u kurmak.
- Dosyalar (öneri):
  - `src/AgentArmy.Cli/Tools/ToolDescriptor.cs` (sözleşme)
  - `src/AgentArmy.Cli/Tools/ToolResult.cs`
  - `src/AgentArmy.Cli/Tools/ITool.cs`
  - `src/AgentArmy.Cli/Tools/ToolExecutor.cs`
- Kurallar:
  - Faz A: `side_effect` write/external ve `reversible=false` ise hard-block.
  - “Görünmez=çağrılamaz”: izin matrisi kesişiminden geçmeyen tool LLM’e sunulmaz.

### PR3 — LLM: tool-aware turn (OpenAiResponsesClient genişletme)
- Hedef: `CompleteWithToolsAsync` benzeri yeni API ile tool definitions + tool calls parse.
- Karar noktası (plan varsayımı):
  - Mevcut `OpenAiResponsesClient` korunur ve tools desteği Responses API üstünden genişletilir.
- Doğrulama:
  - Fake client ile deterministik tool-call senaryosu (unit test).

### PR4 — Orchestrator: tool-call döngüsü (maxToolCalls)
- Hedef: “düşün → tool iste → çalıştır → sonucu geri besle” while döngüsünü eklemek.
- Dosya:
  - [Orchestrator.cs](file:///Users/kadirogreten/Desktop/Source/ai_agent/src/AgentArmy.Cli/Runtime/Orchestrator.cs)
- Kısıt:
  - Sonsuz döngü koruması (maxToolCalls).
  - Tool-call yalnız `agent.behaviors.CanUseTools=true` için.

### PR5 — RiskGate: tool-call seviyesinde sarmalayıcı + fail-closed
- Hedef: `GateForToolAsync` eklemek, yan etkili araçlarda bypass’ı kapatmak (fail-closed).
- Dosyalar:
  - [RiskGate.cs](file:///Users/kadirogreten/Desktop/Source/ai_agent/src/AgentArmy.Cli/Cli/RiskGate.cs)
  - `SupabaseWriter` (audit RPC çağrısı / tool_invocations insert)

### PR6 — İlk araç seti (read + reversible write)
- Hedef: En az 1 read araç + 1 reversible write araçla E2E kanıt.
- Öneri:
  - `web_scrape` (read) ve `file_store` (write, reversible) ile dogfood min senaryo.
- Doğrulama:
  - `tool_invocations` satırları oluşuyor (succeeded/failed).
  - `audit_log` tool.* aksiyonlarını içeriyor.

### PR7 — Portal görünürlük (ToolsPage rozetleri + ToolInvocations görünümü)
- Hedef: Operatörün tool çağrılarını UI’dan görebilmesi.
- Dosyalar:
  - ToolsPage: `side_effect/reversible/min_risk` rozetleri.
  - Yeni sayfa veya RunDetail sekmesi: `tool_invocations` liste.

## 5) Varsayımlar ve Kararlar

- Uygulama Faz A kapsamıyla sınırlı kalacak; geri-alınamaz yan etkiler (email_send, calendar_write, code_exec) Faz A’da çalıştırılmayacak.
- Tool invocation “tek doğrulama/gate noktası” olacak; Orchestrator tool’ları doğrudan çalıştırmayacak.
- RiskGate: yan etkili tool çağrısı için DB/owner yoksa “approved” dönmek yerine **blocked** dönecek.

## 6) Kabul Kriterleri (Faz A “Biten Tanımı”)

- Bir playbook adımı, izinli bir aracı çağırabiliyor ve sonucu sonraki LLM turuna geri besleyebiliyor.
- Her tool-call için:
  - `tool_invocations` kaydı var,
  - `audit_log` kayıtları var (invoked + succeeded/failed/blocked),
  - RiskGate R2/R3’te onay kuyruğuna düşüyor.
- Reversible=false yan etkili araçlar Faz A’da çalıştırılamıyor.

## 7) Doğrulama Planı

- CLI unit test: FakeLlmClient ile 1 tool-call + final response.
- Entegrasyon: `web_scrape`→`file_store` senaryosu (R0/R1) ve `approval_queue` akışı (R2).
- Portal: ToolsPage rozetleri + tool_invocations listesi görüntüleniyor.

## 8) Açık Sorular (Uygulamaya Geçmeden Netleştirilecek)

- Tool çağrıları için OpenAI tarafında tercih: mevcut Responses API üzerinde mi kalınacak, yoksa Chat Completions tool-calling mi kullanılacak?
- ToolPermissions grameri: dokümandaki basit format mı, yoksa doğrudan JSON mu?

