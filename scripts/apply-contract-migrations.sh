#!/usr/bin/env bash
#
# Aplica as migrations da Mesa em um PostgreSQL DESCARTÁVEL, em ordem, para a
# suíte de contrato (`tests/mesa-repository-contract-local.test.ts`).
#
# Uso:
#   createdb mesa_contract_test
#   MESA_CONTRACT_DATABASE_URL=postgres:///mesa_contract_test ./scripts/apply-contract-migrations.sh
#
# GARANTIAS DE SEGURANÇA:
#   - só roda com MESA_CONTRACT_DATABASE_URL explícita (nada implícito);
#   - só aceita banco local (socket unix ou localhost) e cujo nome contenha
#     'contract'/'test'/'tmp'/'disposable' — recusa produção, staging e
#     qualquer destino remoto/desconhecido;
#   - aplica TODAS as migrations em ordem lexicográfica (= cronológica),
#     imprimindo cada nome antes de rodá-la (rastreabilidade);
#   - na primeira falha, para e aponta EXATAMENTE qual migration falhou,
#     sem mascarar o erro original e sem tentar rollback manual;
#   - não executa DROP/TRUNCATE, não recria bancos e não imprime a URL
#     (ela pode conter credencial) — apenas o nome do banco, no final.
set -euo pipefail

URL="${MESA_CONTRACT_DATABASE_URL:-}"
if [ -z "$URL" ]; then
  echo "ERRO: defina MESA_CONTRACT_DATABASE_URL apontando para um banco descartável." >&2
  echo "Ex.: createdb mesa_contract_test && MESA_CONTRACT_DATABASE_URL=postgres:///mesa_contract_test $0" >&2
  exit 1
fi

# O nome (sem credencial) é o único pedaço da URL que pode ser impresso.
DB_LABEL="$(printf '%s' "$URL" | sed -E 's#^[^/]*//([^@]*@)?##; s#[?#].*##')"

# 1) Descartável? Nome precisa marcar explicitamente o destino.
case "$DB_LABEL" in
  *contract*|*test*|*tmp*|*disposable*) ;;
  *)
    echo "ERRO: recusado — banco '$DB_LABEL' não está marcado como descartável." >&2
    echo "Use um nome contendo 'contract', 'test', 'tmp' ou 'disposable'." >&2
    exit 1
    ;;
esac

# 2) Local? Só socket unix, localhost ou IP de loopback — nada remoto.
case "$URL" in
  postgresql://localhost/*|postgres://localhost/*|postgresql://127.0.0.1/*|postgres://127.0.0.1/*|postgresql://[::1]/*|postgres://[::1]/*|postgresql:///*|postgres:///*|*/) ;;
  *)
    echo "ERRO: recusado — só é permitido destino local (socket unix ou localhost)." >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/../supabase/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERRO: migrations não encontradas em $MIGRATIONS_DIR" >&2
  exit 1
fi

# Ordem lexicográfica = ordem cronológica dos nomes (YYYYMMDDHHMMSS_*.sql).
CURRENT_MIGRATION=""
trap 'echo "FALHA na migration: ${CURRENT_MIGRATION:-<desconhecida>} (parada aqui; nada foi mascarado nem refeito manualmente)" >&2' ERR

for file in "$MIGRATIONS_DIR"/*.sql; do
  CURRENT_MIGRATION="$(basename "$file")"
  echo "-> $CURRENT_MIGRATION"
  psql "$URL" -v ON_ERROR_STOP=1 --quiet -f "$file"
  CURRENT_MIGRATION=""
done

echo "OK: $(ls -1 "$MIGRATIONS_DIR"/*.sql | wc -l) migrations aplicadas em '$DB_LABEL'"
