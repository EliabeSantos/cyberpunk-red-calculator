-- F1.13.2 — ID ESTÁVEL do item dentro de `mesa_combatants.supplies.inventory`.
--
-- O modelo passa a ser `{ itemId, item, quantity }`: `item` continua sendo o
-- rótulo de apresentação e `itemId` a identidade. Nada quebrou para quem já
-- lê só `item`/`quantity` (inimigo, reload, characterSync continuam iguais).
--
-- A regra de id é a MESMA de `src/data/supplyItems.ts` (`stableItemId`):
--
--   1. nome no catálogo do jogador (src/data/items.json) → o `CatalogItem.id`
--      REAL ("Stim" → stim, "Pistol Ammunition" → pistol_ammo). O CASE abaixo
--      cobre os 18 itens do catálogo cujo slug NÃO é igual ao id; os outros 94
--      já caem no fallback e produzem exatamente o id do catálogo.
--   2. qualquer outro nome (bestiário, ex.: "Trauma Patch") → slug
--      determinístico.
--
-- SEGUNDA TAXONOMIA? Não: o CASE é um retrato GERADO do próprio
-- `items.json`, usado só porque o SQL não lê o JSON do catálogo. Quando o
-- servidor deriva o id (que é sempre), ele consulta o catálogo diretamente.

-- ---------------------------------------------------------------------------
-- 1. A identidade: nome → id estável (idêntica a `stableItemId`/`slugify…`)
-- ---------------------------------------------------------------------------
create or replace function public.mesa_supply_item_id(p_name text)
returns text
language sql
immutable
as $$
  select case
    -- `regexp_replace(..., '^\s+|\s+$')` é o espelho do `.trim()` do TS.
    when regexp_replace(coalesce(p_name, ''), '^\s+|\s+$', '', 'g') = '' then ''
    else coalesce(
      (case lower(regexp_replace(p_name, '^\s+|\s+$', '', 'g'))
         when 'combat awareness processor' then 'combat_awareness'
         when 'smart weapon link'          then 'smart_link'
         when 'nano repair system'         then 'nano_repair'
         when 'pistol ammunition'          then 'pistol_ammo'
         when 'smg ammunition'             then 'smg_ammo'
         when 'rifle ammunition'           then 'rifle_ammo'
         when 'armor piercing ammunition'  then 'ap_ammo'
         when 'incendiary ammunition'      then 'incendiary_ammo'
         when 'smart ammunition'           then 'smart_ammo'
         when 'utility rope'               then 'rope'
         when 'prepak food'                then 'food_pack'
         when 'combat stimulant'           then 'stimulant'
         when 'focus'                      then 'focus_drug'
         when 'berserk stim'               then 'berserk_implant_drug'
         when 'quick weapon holster'        then 'weapon_holster'
         when 'encrypted data shard'        then 'encrypted_shard'
         when 'corporate access card'       then 'corp_access_card'
         when 'forged id'                   then 'fake_id'
       end),
      left(
        regexp_replace(
          regexp_replace(lower(regexp_replace(p_name, '^\s+|\s+$', '', 'g')), '[^a-z0-9]+', '_', 'g'),
          '^_+|_+$', '', 'g'
        ),
        60
      ),
      ''
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Normalização de uma mochila: id em todas as entradas, pilhas de mesmo
--    id somadas, quantidades inválidas descartadas, ordem estável.
--    Espelho exato de `normalizeSupplyInventory` (src/data/supplyItems.ts).
-- ---------------------------------------------------------------------------
create or replace function public.normalize_mesa_supplies(p_supplies jsonb)
returns jsonb
language sql
as $$
  select case
    when p_supplies is null
      or jsonb_typeof(p_supplies) <> 'object'
      or p_supplies -> 'inventory' is null
      or jsonb_typeof(p_supplies -> 'inventory') <> 'array'
      then p_supplies
    else p_supplies || jsonb_build_object('inventory', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'itemId',   g.item_id,
            'item',     g.name,
            'quantity', g.quantity
          )
          order by g.ord
        ),
        '[]'::jsonb
      )
      from (
        select
          min(x.ord)           as ord,
          x.item_id            as item_id,
          -- nome da PRIMEIRA ocorrência (ordem do array), nunca `min(name)`:
          -- collation decidiria quem vence quando o caixa difere.
          (array_agg(x.name order by x.ord))[1] as name,
          sum(x.quantity)::int  as quantity
        from (
          select
            elem.ord                                                as ord,
            public.mesa_supply_item_id(coalesce(elem.value ->> 'item', '')) as item_id,
            regexp_replace(coalesce(elem.value ->> 'item', ''), '^\s+|\s+$', '', 'g') as name,
            floor(coalesce((elem.value ->> 'quantity')::numeric, 0))::int as quantity
          from jsonb_array_elements(p_supplies -> 'inventory')
               with ordinality as elem(value, ord)
        ) x
        where x.name <> '' and x.item_id <> '' and x.quantity > 0
        group by x.item_id
      ) g
    ))
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill das mochilas JÁ GRAVADAS: toda entrada legada ganha o id e as
--    pilhas duplicadas do mesmo item são somadas. Idempotente — rodar de novo
--    devolve o mesmo JSON.
-- ---------------------------------------------------------------------------
update public.mesa_combatants
set supplies = public.normalize_mesa_supplies(supplies)
where supplies is not null
  and jsonb_typeof(supplies) = 'object'
  and jsonb_typeof(supplies -> 'inventory') = 'array'
  and exists (
    -- marcador de dado LEGADO: entrada sem identidade estável.
    select 1
    from jsonb_array_elements(supplies -> 'inventory') as entries(value)
    where jsonb_typeof(entries.value) = 'object'
      and coalesce(entries.value ->> 'itemId', '') = ''
  );
