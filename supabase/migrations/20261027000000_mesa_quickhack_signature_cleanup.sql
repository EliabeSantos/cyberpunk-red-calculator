-- Paridade de schema local: remove a sobrecarga obsoleta de Quickhack.
--
-- A migration F1.51 criou a assinatura sem supplies; F1.61.1 adicionou os
-- dois parâmetros de supplies com CREATE OR REPLACE, que no PostgreSQL cria uma
-- nova sobrecarga quando a lista de argumentos muda. O adapter local e o
-- gateway atual usam somente a assinatura de 19 argumentos. Remover a antiga
-- evita que instalações com introspecção/RPC por nome encontrem um contrato
-- legado diferente do contrato vigente.
drop function if exists public.commit_mesa_quickhack_resolution(
  uuid, uuid, text, uuid, uuid, uuid, integer, integer,
  jsonb, jsonb, integer, boolean, jsonb, jsonb, jsonb, jsonb, text
);
