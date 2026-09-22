"use client";

import { type ChangeEvent, useMemo, useState } from "react";

import AttributeAllocation from "@/components/character/AttributeAllocation";
import CreationSummary from "@/components/character/CreationSummary";
import SkillAllocation from "@/components/character/SkillAllocation";
import { changeAttributeAtCreation, changeSkillAtCreation, finalizeCharacterCreation, validateCharacterCreation, validateCharacterEdit, canIncreaseAttribute, canIncreaseSkill, getAttributePointsRemaining, getSkillPointsRemaining } from "@/lib/characterCreation";
import { setActiveCharacterId, upsertCharacter } from "@/lib/storage";
import { createEmptyCharacter, statNames, type AttributeName, type Character } from "@/types/character";
import { skillDefinitions } from "@/data/skills";
import { roleDefinitions } from "@/data/roles";
import { addPrimaryRole } from "@/lib/roles";

interface CharacterCreatorProps { initialCharacter?: Character; onSaved?: (character: Character) => void; }

export default function CharacterCreator({ initialCharacter, onSaved }: CharacterCreatorProps) {
  const [character, setCharacter] = useState<Character>(() => initialCharacter ?? createEmptyCharacter());
  const [photoSource, setPhotoSource] = useState(""); const [photoError, setPhotoError] = useState("");
  const isEditing = Boolean(initialCharacter);
  const validation = useMemo(() => isEditing ? validateCharacterEdit(character) : validateCharacterCreation(character), [character, isEditing]);
  const update = (change: (current: Character) => Character) => setCharacter((current) => change(current));
  const setIdentity = (field: "name" | "player" | "role" | "level", value: string | number) => update((current) => ({ ...current, identity: { ...current.identity, [field]: value } }));
  function usePhotoUrl() { update((current) => ({ ...current, identity: { ...current.identity, photoUrl: photoSource.trim() || undefined } })); setPhotoSource(""); setPhotoError(""); }
  function handlePhotoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("O arquivo deve ser uma imagem.");
      return;
    }

    // Redimensiona e comprime a imagem antes de salvar (máx. 512x512, qualidade 0.85)
    const image = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      image.onload = () => {
        const maxSize = 512;
        let { width, height } = image;
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(image, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        update((current) => ({
          ...current,
          identity: { ...current.identity, photoUrl: dataUrl },
        }));
        setPhotoError("");
      };
      const target = e.target as FileReader;
      image.src = target.result as string;
    };
    reader.readAsDataURL(file);
  }
  function randomAllocate() {
    // 1) Randomize attributes: 62 points total, each starts at 2 (min), max 8
    let char = { ...character };
    const attrNames = [...statNames];
    // Shuffle attributes for random distribution
    for (let i = attrNames.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [attrNames[i], attrNames[j]] = [attrNames[j], attrNames[i]];
    }
    // First, reset all attributes to minimum
    for (const attr of statNames) {
      while (char.stats[attr] > 2) {
        char = changeAttributeAtCreation(char, attr, -1);
      }
    }
    // Then randomly distribute remaining points
    let remaining = getAttributePointsRemaining(char);
    while (remaining > 0) {
      const eligible = attrNames.filter((attr) => canIncreaseAttribute(char, attr));
      if (eligible.length === 0) break;
      const attr = eligible[Math.floor(Math.random() * eligible.length)];
      char = changeAttributeAtCreation(char, attr, 1);
      remaining = getAttributePointsRemaining(char);
    }

    // 2) Randomize skills: 86 points total, 13 required skills at level 2 (26 pre-allocated)
    // Reset all skills to their minimums first
    const skillIds = Object.keys(skillDefinitions);
    for (const id of skillIds) {
      const skill = char.skills[id];
      const minLevel = skillDefinitions[id].creation.minimumLevel;
      if (skill && skill.level > minLevel) {
        while (char.skills[id].level > minLevel) {
          char = changeSkillAtCreation(char, id, -1);
        }
      }
    }
    // Shuffle skills for random distribution
    const shuffledSkills = [...skillIds];
    for (let i = shuffledSkills.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledSkills[i], shuffledSkills[j]] = [shuffledSkills[j], shuffledSkills[i]];
    }
    // Distribute remaining skill points randomly
    let skillRemaining = getSkillPointsRemaining(char);
    let iterations = 0;
    while (skillRemaining > 0 && iterations < 500) {
      iterations++;
      const eligible = shuffledSkills.filter((id) => canIncreaseSkill(char, id));
      if (eligible.length === 0) break;
      const id = eligible[Math.floor(Math.random() * eligible.length)];
      char = changeSkillAtCreation(char, id, 1);
      skillRemaining = getSkillPointsRemaining(char);
    }

    setCharacter(char);
  }
  function saveCharacter() { if (!validation.valid) return; const trimmed = { ...character, identity: { ...character.identity, name: character.identity.name.trim() } }; const finalized = isEditing ? trimmed : finalizeCharacterCreation(trimmed); setCharacter(finalized); upsertCharacter(finalized); setActiveCharacterId(finalized.id); onSaved?.(finalized); }
  const roleIcon = character.primaryRole ? Object.values(roleDefinitions).find(r => r.id === character.primaryRole)?.name?.charAt(0) ?? '?' : '?';
  
  return <main className="creator-shell"><header className="creator-header"><p className="eyebrow">Cyberpunk RED Toolkit</p><h1>Crie sua ficha.</h1><p>Distribua os pontos de criação. Eles deixam de existir quando a ficha é finalizada.</p></header><CreationSummary character={character} mode={isEditing ? "edit" : "creation"} /><section className="creator-grid"><div className="creator-card identity-card"><div className="section-heading"><span>01</span><h2>Identidade</h2></div><div className="identity-hero"><div className="identity-avatar">{character.identity.photoUrl ? <img src={character.identity.photoUrl} alt="Prévia do personagem" /> : <div className="avatar-placeholder"><span>{roleIcon}</span></div>}<label className="avatar-upload-overlay"><input type="file" accept="image/*" onChange={handlePhotoFile} hidden /><span>📷</span></label></div><div className="identity-main-fields"><div className="identity-name-input"><input id="char-name" value={character.identity.name} onChange={(event) => setIdentity("name", event.target.value)} placeholder="Nome do Personagem" /></div><div className="identity-role-select"><select id="char-role" value={character.primaryRole ?? ""} onChange={(event) => update((current) => event.target.value ? addPrimaryRole(current, event.target.value as keyof typeof roleDefinitions) : current)}><option value="">Selecione uma Role</option>{Object.values(roleDefinitions).map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></div></div></div><div className="identity-secondary"><div className="identity-field"><label htmlFor="player-name">Jogador</label><input id="player-name" value={character.identity.player} onChange={(event) => setIdentity("player", event.target.value)} placeholder="Seu nome" /></div><div className="identity-url-field"><label>Foto URL</label><div className="photo-url-row"><input id="photo-url" value={photoSource} onChange={(event) => setPhotoSource(event.target.value)} placeholder="Cole a URL da imagem..." /><button type="button" onClick={usePhotoUrl}>Aplicar</button></div>{photoError && <p className="form-error">{photoError}</p>}</div></div></div><div className="creator-card attributes-card"><div className="section-heading"><span>02</span><h2>Atributos</h2></div><AttributeAllocation character={character} onChange={(attribute: AttributeName, delta) => update((current) => changeAttributeAtCreation(current, attribute, delta))} /></div></section><section className="creator-card skills-card"><div className="section-heading"><span>03</span><h2>Perícias</h2></div><p className="helper-text">As 13 Basic Skills começam no nível 2: 26 pontos obrigatórios já descontados dos 86; restam 60 pontos livres. Perícias x2 custam 2 pontos por nível.</p><SkillAllocation character={character} onChange={(id, delta) => update((current) => changeSkillAtCreation(current, id, delta))} /></section><footer className="creator-footer"><p>{validation.valid ? "Ficha válida para criação." : "Corrija as pendências acima para criar o personagem."}</p><div className="creator-footer-actions"><button type="button" className="secondary-button" onClick={randomAllocate}>🎲 Distribuir Aleatório</button><button type="button" className="save-button" onClick={saveCharacter} disabled={!validation.valid}>Criar personagem</button></div></footer></main>;
}