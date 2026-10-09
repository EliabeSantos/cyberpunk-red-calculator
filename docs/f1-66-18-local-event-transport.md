# F1.66.18 — `MesaEventTransport` local

## Implementação

`LocalMesaEventTransport` implementa `MesaEventTransport` como um barramento de
invalidações em memória do processo. Cada sessão possui seu próprio conjunto de
assinantes. A entrega contém somente:

```text
{ sessionId, publishedAt }
```

Não há snapshot, combatants, ficha, token, papel ou qualquer projeção privada
no evento. A reconciliação continua sendo feita por GET autenticado; polling
permanece o fallback quando o canal não está disponível ou um listener falha.

## Segurança operacional

- sessões diferentes não compartilham listeners;
- `close()` é idempotente e remove o listener do conjunto;
- listeners são copiados antes da entrega;
- exceção de um listener não interrompe os demais;
- o evento é congelado antes de ser entregue;
- callbacks inválidos ou sessão vazia não criam assinatura.

A factory local agora usa esse transporte por padrão. O pool local continua
sendo validado pelo lifecycle; se o banco estiver ausente ou indisponível, a
factory falha explicitamente.

## Limitação de implantação

O barramento é compartilhado entre clientes dentro da mesma instância/processo
Node (inclusive hot reload via `globalThis`). Ele não atravessa múltiplas
instâncias de produção, workers ou processos. Para isso será necessário um
broker/pub-sub local compartilhado ou manter polling como transporte suportado.

Nenhuma dependência Supabase foi adicionada ao transporte local e nenhuma
migration foi alterada.

`tests/mesa-local-event-transport.test.ts` cobre isolamento, publicação,
cancelamento, listeners com falha e ausência de payload privado.

**Nenhum teste, TypeScript, build ou lint foi executado.**
