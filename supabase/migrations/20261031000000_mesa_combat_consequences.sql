-- Consolida a ficha da Mesa e o registro persistente do toolkit em uma única
-- transação no modo Supabase. O servidor já valida o payload; esta função
-- repete a associação crítica para que IDs enviados nunca escolham uma ficha
-- fora dos personagens jogadores daquele combate.
create or replace function public.finalize_mesa_combat_consequences(
  p_session_id uuid,
  p_combat_id uuid,
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  v_character_id text;
  v_owner_token text;
  v_expected_sheet jsonb;
  v_sheet jsonb;
  v_expected_version integer;
  updated_count integer;
begin
  if jsonb_typeof(p_updates) <> 'array' then
    raise exception 'invalid combat consequence payload';
  end if;

  perform 1 from public.mesa_combats
   where id = p_combat_id and session_id = p_session_id
   for update;
  if not found then raise exception 'combat not found'; end if;

  for entry in select value from jsonb_array_elements(p_updates) loop
    v_character_id := entry->>'characterId';
    v_owner_token := entry->>'ownerToken';
    v_expected_sheet := entry->'expectedSheet';
    v_sheet := entry->'sheet';
    v_expected_version := case
      when entry->'expectedToolkitVersion' is null or entry->'expectedToolkitVersion' = 'null'::jsonb then null
      else (entry->>'expectedToolkitVersion')::integer
    end;

    if not exists (
      select 1
        from public.mesa_combatants c
        join public.mesa_participants p on p.id = c.participant_id and p.session_id = c.session_id
       where c.combat_id = p_combat_id and c.session_id = p_session_id
         and c.kind = 'character' and c.character_id = v_character_id
         and p.role = 'player' and p.character_id = c.character_id
    ) then
      raise exception 'character is not a player combatant in this combat';
    end if;

    update public.mesa_characters
       set display_name = left(entry->>'name', 60), sheet = v_sheet, updated_at = now()
     where id = v_character_id and public.mesa_characters.owner_token = v_owner_token and public.mesa_characters.sheet = v_expected_sheet;
    get diagnostics updated_count = row_count;
    if updated_count <> 1 then raise exception 'character changed during combat finalization'; end if;

    if v_expected_version is null then
      insert into public.mesa_toolkit_records (id, owner_token, kind, name, payload)
      values (v_character_id, v_owner_token, 'character', left(entry->>'name', 200), v_sheet);
    else
      update public.mesa_toolkit_records
         set name = left(entry->>'name', 200), payload = v_sheet
       where id = v_character_id and public.mesa_toolkit_records.owner_token = v_owner_token and kind = 'character' and version = v_expected_version;
      get diagnostics updated_count = row_count;
      if updated_count <> 1 then raise exception 'persistent character changed during combat finalization'; end if;
    end if;
  end loop;
  return jsonb_build_object('updated', jsonb_array_length(p_updates));
end;
$$;
