"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { moveMesa, positionCombatant, saveTacticalMap, MesaApiError } from "@/lib/mesa/client";
import { addTacticalDoor, addTacticalWall, coverHPAfterProfileChange, deriveTacticalCoverProfile, removeTacticalGeometrySegment, snapTacticalPosition, stripDerivedTacticalCoverValues, tacticalCoverObstacleId, tacticalCoverTargetId, tacticalGridSpacingPixels, tacticalMovementFeedback, tacticalMovementRadiusPixels, tacticalPositionsOverlap, tacticalWeaponRangeFeedback, toggleTacticalDoor, updateTacticalGeometrySegment, updateTacticalObstacleCover } from "@/lib/mesa/tacticalMap";
import { tacticalTargetSelectable } from "@/lib/mesa/playerScreen";
import { calculateTacticalCover, DEFAULT_TACTICAL_OBSTACLE_THICKNESS, tacticalObstacleArea } from "@/lib/mesa/tacticalGeometry";
import { TACTICAL_COVER_MATERIALS } from "@/lib/mesa/types";
import { TACTICAL_COVER_THICKNESSES } from "@/lib/mesa/tacticalCoverCatalog";
import type { MesaState, TacticalCoverMaterial, TacticalCoverThickness, TacticalGeometry, TacticalMap, TacticalPosition } from "@/lib/mesa/types";
import type { CombatWeapon } from "@/lib/combat/contract";
import { tacticalDistance } from "@/lib/mesa/tacticalMap";

interface Props {
  state: MesaState;
  onNotice: (message: string, kind: "error" | "ok") => void;
  selectedTargetId: string;
  onSelectTarget: (combatantId: string) => void;
  controlledCombatantId?: string | null;
  selectedWeapon: CombatWeapon | null;
}
type MoveStatus = "dragging" | "processing" | "confirmed" | "rejected";
type GeometryMode = "select" | "wall" | "door" | "erase";
interface LocalMove {
  position: TacticalPosition;
  authoritative: TacticalPosition;
  origin: TacticalPosition;
  movementAvailable: number;
  withinMovement: boolean;
  status: MoveStatus;
  resolutionId: string;
  requestVersion?: string;
}

const DEFAULT_MAP: TacticalMap = { imageUrl: "", enabled: false, width: 1000, height: 600, pixelsPerMeter: 50, grid: { enabled: false, size: 1, snap: false } };
const ENEMY_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23301f35'/%3E%3Cpath d='M18 78 28 35 50 18l22 17 10 43H18Z' fill='%23ff695c'/%3E%3Ccircle cx='39' cy='48' r='6' fill='%230b1114'/%3E%3Ccircle cx='61' cy='48' r='6' fill='%230b1114'/%3E%3Cpath d='M35 68h30' stroke='%230b1114' stroke-width='6'/%3E%3C/svg%3E";

function validPosition(position: TacticalPosition): TacticalPosition {
  return { x: Math.max(0, Math.min(1, position.x)), y: Math.max(0, Math.min(1, position.y)) };
}

export default function TacticalView({ state, onNotice, selectedTargetId, onSelectTarget, controlledCombatantId, selectedWeapon }: Props) {
  const map = state.session.tacticalMap ?? DEFAULT_MAP;
  const isGM = state.viewer.role === "gm";
  const combatActive = state.combat?.status === "active";
  const initiativeStarted = state.combat?.initiativeStarted === true;
  const [localMoves, setLocalMoves] = useState<Record<string, LocalMove>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [savingMap, setSavingMap] = useState(false);
  const [mapDraft, setMapDraft] = useState(map);
  const [geometryEditing, setGeometryEditing] = useState(false);
  const [geometryMode, setGeometryMode] = useState<GeometryMode>("select");
  const [selectedGeometryId, setSelectedGeometryId] = useState<string | null>(null);
  const [geometryInteraction, setGeometryInteraction] = useState<{ kind: "draw"; start: TacticalPosition; current: TacticalPosition } | { kind: "handle"; id: string; type: "wall" | "door"; endpoint: "start" | "end" } | null>(null);
  const geometryDraftRef = useRef<TacticalGeometry>({ walls: [], doors: [] });
  const geometryBeforeInteractionRef = useRef<TacticalGeometry>({ walls: [], doors: [] });
  const geometrySavePendingRef = useRef(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const initializedSessionRef = useRef<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const pointerRef = useRef<TacticalPosition | null>(null);
  const frameRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggedPastThresholdRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [surfaceWidth, setSurfaceWidth] = useState(0);

  // O snapshot pode mudar depois de qualquer mutação da Mesa. O formulário do
  // GM não deve perder edições em andamento por causa de Realtime/polling:
  // carrega do servidor somente na primeira montagem desta sessão.
  useEffect(() => {
    if (initializedSessionRef.current === state.session.id) return;
    initializedSessionRef.current = state.session.id;
    setMapDraft(map);
  }, [map, state.session.id]);
  useEffect(() => {
    if (!isGM || geometrySavePendingRef.current || geometryInteraction) return;
    setMapDraft((current) => current.geometry === map.geometry ? current : { ...current, geometry: map.geometry });
  }, [geometryInteraction, isGM, map.geometry]);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const updateSize = () => setSurfaceWidth(surface.getBoundingClientRect().width);
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [map.width, map.height]);
  useEffect(() => {
    setLocalMoves((current) => {
      const known = new Set(state.combatants.map((entry) => entry.id));
      return Object.fromEntries(Object.entries(current).filter(([id]) => known.has(id)));
    });
  }, [state.combatants]);

  useEffect(() => {
    setLocalMoves((current) => {
      let changed = false;
      const next = { ...current };
      for (const [id, move] of Object.entries(current)) {
        const server = state.combatants.find((entry) => entry.id === id)?.position;
        const versionChanged = Boolean(move.requestVersion && state.stateVersion && move.requestVersion !== state.stateVersion);
        if (server && (move.status === "processing" || move.status === "confirmed") && server.x === move.position.x && server.y === move.position.y) {
          delete next[id];
          changed = true;
        } else if (server && versionChanged && (move.status === "processing" || move.status === "confirmed")) {
          // Outro snapshot avançou sem confirmar este destino: o servidor
          // venceu a intenção visual local.
          next[id] = { ...move, position: server, authoritative: server, status: "rejected" };
          changed = true;
          window.setTimeout(() => setLocalMoves((latest) => latest[id]?.status === "rejected" ? (() => { const rollback = { ...latest }; delete rollback[id]; return rollback; })() : latest), 220);
        }
      }
      return changed ? next : current;
    });
  }, [state.combatants]);

  const canDrag = (combatant: MesaState["combatants"][number]) => {
    if (!isGM && combatant.participantId !== state.viewer.participantId) return false;
    if (!combatActive || (isGM && !initiativeStarted)) return isGM;
    if (combatant.id !== state.combat?.activeCombatantId) return false;
    return isGM ? combatant.kind === "enemy" || combatant.participantId === state.viewer.participantId : combatant.participantId === state.viewer.participantId;
  };

  function positionFor(combatant: MesaState["combatants"][number]) {
    return localMoves[combatant.id]?.position ?? combatant.position ?? { x: combatant.kind === "enemy" ? 0.78 : 0.22, y: 0.5 };
  }

  function positionFromPointer(event: React.PointerEvent): TacticalPosition | null {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return validPosition({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height });
  }

  function overlapsAnother(id: string, target: TacticalPosition): boolean {
    return state.combatants.some((entry) => entry.id !== id && tacticalPositionsOverlap(
      positionFor(entry), target, map,
    ));
  }

  function startDrag(id: string, event: React.PointerEvent) {
    if (geometryEditing) return;
    draggedPastThresholdRef.current = false;
    suppressClickRef.current = false;
    const combatant = state.combatants.find((entry) => entry.id === id);
    if (!combatant || !canDrag(combatant)) return;
    if (combatActive && initiativeStarted && combatant.movementRemaining <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    draggedPastThresholdRef.current = false;
    const authoritative = combatant.position ?? { x: combatant.kind === "enemy" ? 0.78 : 0.22, y: 0.5 };
    const resolutionId = crypto.randomUUID();
    draggingRef.current = id;
    setDragging(id);
    setLocalMoves((current) => ({ ...current, [id]: {
      position: authoritative,
      authoritative,
      origin: authoritative,
      movementAvailable: Math.max(0, combatant.movementRemaining),
      withinMovement: true,
      status: "dragging",
      resolutionId,
    } }));
    const next = positionFromPointer(event);
    if (next) setLocalMoves((current) => current[id] ? {
      ...current,
      [id]: { ...current[id], position: snapTacticalPosition(next, map), withinMovement: !combatActive || !initiativeStarted || tacticalMovementFeedback(authoritative, snapTacticalPosition(next, map), combatant.movementRemaining, map).withinMovement },
    } : current);
  }

  function canSelectTarget(combatant: MesaState["combatants"][number]): boolean {
    return tacticalTargetSelectable(state, combatant, controlledCombatantId ?? null);
  }

  function handleTokenPointerUp(id: string, event: React.PointerEvent) {
    if (dragging !== id) return;
    const start = pointerStartRef.current;
    const moved = start ? Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5 : draggedPastThresholdRef.current;
    if (!moved) {
      const combatant = state.combatants.find((entry) => entry.id === id);
      cancelDrag(id);
      if (combatant && canSelectTarget(combatant) && selectedTargetId !== id) onSelectTarget(id);
      return;
    }
    suppressClickRef.current = true;
    void finishDrag(id);
  }

  async function finishDrag(id: string) {
    const combatant = state.combatants.find((entry) => entry.id === id);
    const move = localMoves[id];
    const target = move?.position;
    draggingRef.current = null;
    setDragging(null);
    if (!combatant || !target || !move) return;
    setLocalMoves((current) => current[id] ? { ...current, [id]: { ...current[id], status: "processing", requestVersion: state.stateVersion } } : current);
    try {
      if (overlapsAnother(id, target)) throw new MesaApiError("Esse espaço já está ocupado.", 409, "position_occupied");
      if (combatActive && initiativeStarted && !move.withinMovement) {
        throw new MesaApiError("Movimento excede o disponível.", 400, "movement_exhausted");
      }
      const result = combatActive && initiativeStarted
        ? await moveMesa({ sessionId: state.session.id, actorCombatantId: id, targetPosition: target, resolutionId: move.resolutionId })
        : await positionCombatant(state.session.id, id, target).then(() => ({ position: target }));
      const confirmed = result.position ?? target;
      setLocalMoves((current) => current[id] ? { ...current, [id]: { ...current[id], position: confirmed, authoritative: confirmed, status: "confirmed" } } : current);
      onNotice(combatActive ? "Movimento confirmado." : "Posição salva.", "ok");
    } catch (error) {
      setLocalMoves((current) => current[id] ? { ...current, [id]: { ...current[id], position: current[id].authoritative, status: "rejected" } } : current);
      window.setTimeout(() => setLocalMoves((current) => {
        if (current[id]?.status !== "rejected") return current;
        const next = { ...current }; delete next[id]; return next;
      }), 220);
      onNotice(error instanceof MesaApiError ? error.message : "Movimento não permitido.", "error");
    }
  }

  function cancelDrag(id: string) {
    if (draggingRef.current !== id) return;
    draggingRef.current = null;
    pointerRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setDragging(null);
    setLocalMoves((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function saveMap() {
    setSavingMap(true);
    const savedMap = stripDerivedTacticalCoverValues({ ...mapDraft, enabled: Boolean(mapDraft.imageUrl.trim()), grid: mapDraft.grid ?? { enabled: false, size: 1, snap: false } });
    try { await saveTacticalMap(state.session.id, savedMap); setMapDraft(savedMap); onNotice("Mapa atualizado.", "ok"); }
    catch (error) { onNotice(error instanceof MesaApiError ? error.message : "Não foi possível salvar o mapa.", "error"); }
    finally { setSavingMap(false); }
  }

  function readMapFile(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setMapDraft((current) => ({ ...current, imageUrl: reader.result as string })); };
    reader.readAsDataURL(file);
  }

  function updateGrid(patch: Partial<NonNullable<TacticalMap["grid"]>>) {
    setMapDraft((current) => ({ ...current, grid: { enabled: false, size: 1, snap: false, ...current.grid, ...patch } }));
  }

  function updateLocalGeometry(next: TacticalGeometry): void {
    geometryDraftRef.current = next;
    setMapDraft((current) => ({ ...current, geometry: next }));
  }

  async function persistGeometry(next: TacticalGeometry, previous: TacticalGeometry): Promise<void> {
    geometrySavePendingRef.current = true;
    try {
      await saveTacticalMap(state.session.id, stripDerivedTacticalCoverValues({ ...mapDraft, geometry: next }));
      onNotice("Geometria salva.", "ok");
    } catch (error) {
      updateLocalGeometry(previous);
      onNotice(error instanceof MesaApiError ? error.message : "Não foi possível salvar a geometria.", "error");
    } finally {
      geometrySavePendingRef.current = false;
    }
  }

  function geometryPoint(event: React.PointerEvent): TacticalPosition | null {
    return positionFromPointer(event);
  }

  function startGeometryDraw(event: React.PointerEvent<SVGSVGElement>): void {
    if (!geometryEditing || (geometryMode !== "wall" && geometryMode !== "door")) return;
    const point = geometryPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    geometryBeforeInteractionRef.current = geometry;
    setGeometryInteraction({ kind: "draw", start: point, current: point });
  }

  function selectGeometry(event: React.PointerEvent, id: string): void {
    if (!geometryEditing) return;
    event.stopPropagation();
    if (geometryMode === "erase") {
      const previous = geometry;
      const next = removeTacticalGeometrySegment(previous, id);
      updateLocalGeometry(next);
      void persistGeometry(next, previous);
      setSelectedGeometryId(null);
    } else if (geometryMode === "select") {
      setSelectedGeometryId(id);
    }
  }

  function selectCoverTarget(event: React.PointerEvent, id: string): void {
    if (geometryEditing) return selectGeometry(event, id);
    const obstacle = [...geometry.walls, ...geometry.doors].find((entry) => entry.id === id);
    if (!obstacle || obstacle.destroyed === true || (obstacle.type === "door" && obstacle.state === "open")) return;
    event.stopPropagation();
    onSelectTarget(tacticalCoverTargetId(id));
  }

  function startGeometryHandle(event: React.PointerEvent, id: string, type: "wall" | "door", endpoint: "start" | "end"): void {
    if (!geometryEditing || geometryMode !== "select") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    geometryDraftRef.current = geometry;
    geometryBeforeInteractionRef.current = geometry;
    setSelectedGeometryId(id);
    setGeometryInteraction({ kind: "handle", id, type, endpoint });
  }

  function finishGeometry(): void {
    const interaction = geometryInteraction;
    if (!interaction) return;
    setGeometryInteraction(null);
    if (interaction.kind === "draw") {
      if (Math.hypot(interaction.current.x - interaction.start.x, interaction.current.y - interaction.start.y) < 0.01) return;
      const id = crypto.randomUUID();
      const previous = geometryBeforeInteractionRef.current;
      const next = interaction.current && geometryMode === "door"
        ? addTacticalDoor(previous, { id, type: "door", start: interaction.start, end: interaction.current, thickness: DEFAULT_TACTICAL_OBSTACLE_THICKNESS, state: "closed" })
        : addTacticalWall(previous, { id, type: "wall", start: interaction.start, end: interaction.current, thickness: DEFAULT_TACTICAL_OBSTACLE_THICKNESS });
      updateLocalGeometry(next);
      setSelectedGeometryId(id);
      void persistGeometry(next, previous);
      return;
    }
    void persistGeometry(geometryDraftRef.current, geometryBeforeInteractionRef.current);
  }

  function toggleSelectedDoor(): void {
    if (!selectedGeometryId) return;
    const previous = geometry;
    const next = toggleTacticalDoor(previous, selectedGeometryId);
    updateLocalGeometry(next);
    void persistGeometry(next, previous);
  }

  const mapStyle = useMemo(() => ({ aspectRatio: `${map.height > 0 ? map.width : 1000} / ${map.height > 0 ? map.height : 600}` }), [map.height, map.width]);
  const geometry = (isGM ? mapDraft.geometry : map.geometry) ?? { walls: [], doors: [] };
  const selectedObstacle = [...geometry.walls, ...geometry.doors].find((entry) => entry.id === selectedGeometryId) ?? null;
  const selectedCover = (() => {
    const obstacleId = tacticalCoverObstacleId(selectedTargetId);
    if (!obstacleId) return null;
    const obstacle = [...geometry.walls, ...geometry.doors].find((entry) => entry.id === obstacleId);
    return obstacle && obstacle.destroyed !== true && !(obstacle.type === "door" && obstacle.state === "open") ? obstacle : null;
  })();

  function updateSelectedObstacleCover(patch: { coverMaterial?: TacticalCoverMaterial | null; coverThickness?: TacticalCoverThickness | null }): void {
    if (!selectedObstacle) return;
    const previous = geometry;
    const material = patch.coverMaterial === undefined ? selectedObstacle.coverMaterial : patch.coverMaterial;
    const thickness = patch.coverThickness === undefined ? selectedObstacle.coverThickness : patch.coverThickness;
    const oldProfile = deriveTacticalCoverProfile(selectedObstacle.coverMaterial, selectedObstacle.coverThickness);
    const profile = deriveTacticalCoverProfile(material, thickness);
    const nextPatch = {
      coverMaterial: material ?? null,
      coverThickness: thickness ?? null,
      ...(profile
        ? { coverHP: coverHPAfterProfileChange(selectedObstacle.coverHP, selectedObstacle.destroyed, oldProfile?.hp ?? null, profile.hp), coverDV: profile.dv }
        : { coverHP: null, coverDV: null }),
    };
    const next = updateTacticalObstacleCover(previous, selectedObstacle.id, nextPatch);
    updateLocalGeometry(next);
    void persistGeometry(next, previous);
  }
  const attackFeedback = useMemo(() => {
    if (!combatActive || !selectedWeapon || !selectedTargetId) return null;
    const attacker = isGM
      ? state.combatants.find((entry) => entry.id === controlledCombatantId)
      : state.combatants.find((entry) => entry.participantId === state.viewer.participantId && entry.kind === "character");
    const target = state.combatants.find((entry) => entry.id === selectedTargetId);
    if (!attacker || !target || attacker.id === target.id) return null;
    const result = tacticalWeaponRangeFeedback(positionFor(attacker), positionFor(target), map, selectedWeapon);
    return { attacker, target, ...result };
  }, [combatActive, controlledCombatantId, isGM, map, selectedTargetId, selectedWeapon, state.combatants, state.viewer.participantId, localMoves]);
  const losPair = useMemo(() => {
    if (!combatActive || !selectedTargetId) return null;
    const attacker = isGM
      ? state.combatants.find((entry) => entry.id === controlledCombatantId)
      : state.combatants.find((entry) => entry.participantId === state.viewer.participantId && entry.kind === "character");
    const target = state.combatants.find((entry) => entry.id === selectedTargetId);
    if (!attacker || !target || attacker.id === target.id) return null;
    return { attacker, target };
  }, [combatActive, controlledCombatantId, isGM, selectedTargetId, state.combatants, state.viewer.participantId]);
  const losFeedback = useMemo(() => {
    if (!losPair) return null;
    const cover = calculateTacticalCover(positionFor(losPair.attacker), positionFor(losPair.target), geometry);
    return { visible: cover.lineOfSight === "clear", blockerId: cover.blockerId, blockerType: cover.blockerType, cover, attacker: losPair.attacker, target: losPair.target };
  }, [geometry, localMoves, losPair]);

  return (
    <section className="player-mesa-tactical" aria-label="Mapa tático">
       <div className="tactical-toolbar">
        <span><b>CAMPO TÁTICO</b>{combatActive && initiativeStarted ? " · MOVIMENTO ONLINE" : " · PREPARAÇÃO"}{map.grid?.snap && <i className="tactical-snap-badge">SNAP</i>}</span>
        {isGM && <details className="tactical-map-settings"><summary>Configurar mapa</summary><div>
          <input value={mapDraft.imageUrl} onChange={(event) => setMapDraft({ ...mapDraft, imageUrl: event.target.value })} placeholder="URL da imagem do mapa" aria-label="URL da imagem do mapa" />
          <label>Ou carregar imagem <input type="file" accept="image/*" onChange={(event) => readMapFile(event.target.files?.[0])} /></label>
          <label>Largura lógica <input type="number" min="1" value={mapDraft.width} onChange={(event) => setMapDraft({ ...mapDraft, width: Number(event.target.value) })} /></label>
          <label>Altura lógica <input type="number" min="1" value={mapDraft.height} onChange={(event) => setMapDraft({ ...mapDraft, height: Number(event.target.value) })} /></label>
          <label>Pixels por metro <input type="number" min="1" value={mapDraft.pixelsPerMeter} onChange={(event) => setMapDraft({ ...mapDraft, pixelsPerMeter: Number(event.target.value) })} /></label>
          <label className="tactical-grid-toggle"><input type="checkbox" checked={mapDraft.grid?.enabled ?? false} onChange={(event) => updateGrid({ enabled: event.target.checked })} /> Mostrar grid</label>
          <label>Tamanho da célula (m) <input type="number" min="0.1" step="0.1" value={mapDraft.grid?.size ?? 1} onChange={(event) => updateGrid({ size: Number(event.target.value) })} /></label>
          <label className="tactical-grid-toggle"><input type="checkbox" checked={mapDraft.grid?.snap ?? false} onChange={(event) => updateGrid({ snap: event.target.checked })} /> Snap ao grid</label>
          <button type="button" className="mesa-secondary" disabled={savingMap} onClick={() => void saveMap()}>{savingMap ? "Salvando..." : "Salvar mapa"}</button>
        </div></details>}
       </div>
        {isGM && <div className="tactical-geometry-toolbar" aria-label="Editor de geometria">
          <div className="tactical-geometry-header">
            <div><span className="mesa-eyebrow">GEOMETRIA TÁTICA</span><strong>{geometryEditing ? "Editor de obstáculos" : "Mapa protegido"}</strong></div>
            <button type="button" className={geometryEditing ? "mesa-secondary" : "mesa-ghost"} onClick={() => { setGeometryEditing((value) => !value); setGeometryInteraction(null); }}>{geometryEditing ? "Concluir edição" : "Editar paredes e portas"}</button>
          </div>
          {geometryEditing && <div className="tactical-geometry-workspace">
            <div className="tactical-geometry-tools" aria-label="Ferramentas de geometria">
              <span className="tactical-geometry-tools-label">Ferramenta</span>
              {(["select", "wall", "door", "erase"] as GeometryMode[]).map((mode) => <button key={mode} type="button" className={`tactical-geometry-tool ${geometryMode === mode ? "is-active" : ""}`} aria-pressed={geometryMode === mode} onClick={() => setGeometryMode(mode)}><i aria-hidden="true">{mode === "select" ? "↖" : mode === "wall" ? "━" : mode === "door" ? "▯" : "×"}</i>{mode === "select" ? "Selecionar" : mode === "wall" ? "Parede" : mode === "door" ? "Porta" : "Apagar"}</button>)}
              <small>Clique e arraste no mapa para desenhar ou ajustar.</small>
            </div>
            {selectedObstacle ? <section className="tactical-cover-editor" aria-label="Configuração da Cover">
              <header className="tactical-cover-editor-heading">
                <div><span className="mesa-eyebrow">CONFIGURAÇÃO DA COVER</span><strong>{selectedObstacle.type === "wall" ? "Parede selecionada" : "Porta selecionada"}</strong><small>ID {selectedObstacle.id.slice(0, 8)}{selectedObstacle.type === "door" ? ` · ${selectedObstacle.state === "open" ? "aberta / transparente" : "fechada"}` : ""}</small></div>
                {selectedObstacle.type === "door" && <button type="button" className="mesa-ghost" onClick={toggleSelectedDoor}>{selectedObstacle.state === "open" ? "Fechar porta" : "Abrir porta"}</button>}
              </header>
              <div className="tactical-cover-editor-grid">
                <div className="tactical-cover-field tactical-cover-material-field"><span className="tactical-cover-field-label">Material <small>catálogo oficial</small></span>
                  <span className="tactical-material-picker" role="radiogroup" aria-label="Material da Cover">
                    {TACTICAL_COVER_MATERIALS.map((material) => {
                      const label = material === "ballistic_glass" ? "Vidro balístico" : material === "wood" ? "Madeira" : material === "stone" ? "Pedra" : material === "concrete" ? "Concreto" : "Aço";
                      return <button key={material} type="button" className={`tactical-material-option material-${material} ${selectedObstacle.coverMaterial === material ? "is-selected" : ""}`} role="radio" aria-checked={selectedObstacle.coverMaterial === material} onClick={() => updateSelectedObstacleCover({ coverMaterial: material })}><i aria-hidden="true" /><span><b>{label}</b><small>{material === "ballistic_glass" ? "proteção balística" : material === "steel" ? "estrutura rígida" : material === "concrete" ? "massa estrutural" : material === "stone" ? "alvenaria" : "estrutura leve"}</small></span></button>;
                    })}
                  </span>
                  {(selectedObstacle.coverMaterial === "brick" || selectedObstacle.coverMaterial === "custom") && <small className="tactical-material-legacy">{selectedObstacle.coverMaterial === "brick" ? "Brick" : "Custom"} · material legado. Escolha um material oficial para ativar o catálogo.</small>}
                </div>
                <div className="tactical-cover-field tactical-cover-thickness-field"><span className="tactical-cover-field-label">Espessura <small>define o perfil</small></span><span className="tactical-thickness-picker" role="radiogroup" aria-label="Espessura da Cover">
                  {TACTICAL_COVER_THICKNESSES.map((thickness) => <button key={thickness} type="button" disabled={!selectedObstacle.coverMaterial || !TACTICAL_COVER_MATERIALS.includes(selectedObstacle.coverMaterial as (typeof TACTICAL_COVER_MATERIALS)[number])} className={selectedObstacle.coverThickness === thickness ? "is-selected" : ""} role="radio" aria-checked={selectedObstacle.coverThickness === thickness} onClick={() => updateSelectedObstacleCover({ coverThickness: thickness })}><b>{thickness === "thin" ? "Fina" : "Grossa"}</b><small>{thickness === "thin" ? "perfil leve" : "perfil reforçado"}</small></button>)}
                </span></div>
                {deriveTacticalCoverProfile(selectedObstacle.coverMaterial, selectedObstacle.coverThickness) ? (() => { const profile = deriveTacticalCoverProfile(selectedObstacle.coverMaterial, selectedObstacle.coverThickness)!; return <div className="tactical-cover-derived" aria-label="Valores derivados da Cover"><span><small>HP atual / máximo</small><b>{selectedObstacle.coverHP ?? profile.hp} / {profile.hp}</b></span><span><small>DV para atacar</small><b>{profile.dv}</b></span></div>; })() : <p className="tactical-cover-legacy">Selecione material e espessura para ativar os valores automáticos.</p>}
              </div>
            </section> : <div className="tactical-geometry-empty"><b>Nenhum obstáculo selecionado</b><span>Use Selecionar e toque em uma parede ou porta para configurar a Cover.</span></div>}
          </div>}
        </div>}
       <div className="tactical-surface" ref={surfaceRef} style={mapStyle} onPointerUp={finishGeometry} onPointerMove={(event) => {
         if (geometryInteraction) {
           const point = geometryPoint(event);
           if (point) {
             if (geometryInteraction.kind === "draw") {
               setGeometryInteraction((current) => current?.kind === "draw" ? { ...current, current: point } : current);
             } else {
               const previous = geometryDraftRef.current;
                const next = updateTacticalGeometrySegment(previous, geometryInteraction.id, { [geometryInteraction.endpoint]: point });
               updateLocalGeometry(next);
             }
           }
           return;
         }
         if (!dragging) return;
        const next = positionFromPointer(event);
        if (!next) return;
        const start = pointerStartRef.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5) draggedPastThresholdRef.current = true;
        pointerRef.current = next;
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const id = draggingRef.current;
          const position = pointerRef.current;
          if (id && position && !overlapsAnother(id, position)) {
            setLocalMoves((current) => {
              const move = current[id];
              if (!move) return current;
              const snappedPosition = snapTacticalPosition(position, map);
              return { ...current, [id]: {
                ...move,
                position: snappedPosition,
                withinMovement: !combatActive || !initiativeStarted || tacticalMovementFeedback(move.origin, snappedPosition, move.movementAvailable, map).withinMovement,
              } };
            });
          }
        });
      }}>
         {map.enabled && map.imageUrl ? <img className="tactical-map-image" src={map.imageUrl} alt="Mapa tático da mesa" draggable={false} /> : <div className="tactical-empty"><strong>Mapa não definido</strong><span>O Mestre pode adicionar uma imagem acima.</span></div>}
         <div className="tactical-grid" aria-hidden="true" style={{ backgroundSize: `${tacticalGridSpacingPixels(map, surfaceWidth)}px ${tacticalGridSpacingPixels(map, surfaceWidth)}px`, opacity: map.grid?.enabled ? undefined : 0 }} />
         <svg className={`tactical-geometry-layer ${geometryEditing ? "is-editing" : ""}`} viewBox="0 0 1 1" preserveAspectRatio="none" onPointerDown={startGeometryDraw} aria-label="Geometria do mapa">
            {geometry.walls.filter((wall) => wall.destroyed !== true).map((wall) => <polygon key={wall.id} className={`tactical-wall ${selectedTargetId === tacticalCoverTargetId(wall.id) ? "is-target-selected" : ""} ${selectedGeometryId === wall.id ? "is-selected" : ""}`} points={tacticalObstacleArea(wall).corners.map((point) => `${point.x},${point.y}`).join(" ")} onPointerDown={(event) => selectCoverTarget(event, wall.id)} />)}
            {geometry.doors.filter((door) => door.destroyed !== true).map((door) => <polygon key={door.id} className={`tactical-door ${door.state === "open" ? "is-open" : "is-closed"} ${selectedTargetId === tacticalCoverTargetId(door.id) ? "is-target-selected" : ""} ${selectedGeometryId === door.id ? "is-selected" : ""}`} points={tacticalObstacleArea(door).corners.map((point) => `${point.x},${point.y}`).join(" ")} onPointerDown={(event) => selectCoverTarget(event, door.id)} />)}
            {[...geometry.walls, ...geometry.doors].filter((entry) => entry.destroyed !== true && entry.coverHP !== null && entry.coverHP !== undefined).map((entry) => <text key={`hp-${entry.id}`} className="tactical-cover-hp" x={(entry.start.x + entry.end.x) / 2} y={(entry.start.y + entry.end.y) / 2}>{`HP ${entry.coverHP}`}</text>)}
           {geometryEditing && geometryMode === "select" && [...geometry.walls, ...geometry.doors].filter((entry) => entry.id === selectedGeometryId).map((entry) => <g key={`handles-${entry.id}`} className="tactical-geometry-handles"><circle cx={entry.start.x} cy={entry.start.y} r=".014" onPointerDown={(event) => startGeometryHandle(event, entry.id, entry.type, "start")} /><circle cx={entry.end.x} cy={entry.end.y} r=".014" onPointerDown={(event) => startGeometryHandle(event, entry.id, entry.type, "end")} /></g>)}
            {geometryInteraction?.kind === "draw" && (() => {
              const preview = geometryMode === "door"
                ? tacticalObstacleArea({ id: "preview", type: "door", start: geometryInteraction.start, end: geometryInteraction.current, thickness: DEFAULT_TACTICAL_OBSTACLE_THICKNESS, state: "closed" })
                : tacticalObstacleArea({ id: "preview", type: "wall", start: geometryInteraction.start, end: geometryInteraction.current, thickness: DEFAULT_TACTICAL_OBSTACLE_THICKNESS });
              return <polygon className={geometryMode === "door" ? "tactical-door tactical-geometry-preview" : "tactical-wall tactical-geometry-preview"} points={preview.corners.map((point) => `${point.x},${point.y}`).join(" ")} />;
            })()}
         </svg>
          {dragging && combatActive && initiativeStarted && localMoves[dragging] && (() => {
           const move = localMoves[dragging];
           const invalid = !move.withinMovement;
           return <svg className={`tactical-movement-trail ${invalid ? "is-invalid" : ""}`} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
             <line x1={move.origin.x} y1={move.origin.y} x2={move.position.x} y2={move.position.y} />
           </svg>;
          })()}
           {attackFeedback && (
            <>
              <svg className={`tactical-attack-line ${attackFeedback.withinRange === false ? "is-invalid" : ""}`} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                <line x1={positionFor(attackFeedback.attacker).x} y1={positionFor(attackFeedback.attacker).y} x2={positionFor(attackFeedback.target).x} y2={positionFor(attackFeedback.target).y} />
              </svg>
              <div className={`tactical-attack-readout ${attackFeedback.withinRange === false ? "is-invalid" : attackFeedback.withinRange === true ? "is-valid" : "is-unknown"}`} style={{ left: `${((positionFor(attackFeedback.attacker).x + positionFor(attackFeedback.target).x) / 2) * 100}%`, top: `${((positionFor(attackFeedback.attacker).y + positionFor(attackFeedback.target).y) / 2) * 100}%` }} aria-live="polite">
                <b>{attackFeedback.distance}m</b>
                <span>{attackFeedback.withinRange === true ? "ALCANCE VÁLIDO" : attackFeedback.withinRange === false ? "FORA DO ALCANCE" : "ALCANCE NÃO DEFINIDO"}</span>
              </div>
            </>
           )}
           {selectedCover && (
             <aside className="tactical-cover-readout" aria-label="Informações da Cover selecionada">
               <span className="tactical-cover-readout-title">COVER</span>
               <strong>{deriveTacticalCoverProfile(selectedCover.coverMaterial, selectedCover.coverThickness)?.dv ?? selectedCover.coverDV ?? "DV não definido"}</strong>
               <span>{(() => { const profile = deriveTacticalCoverProfile(selectedCover.coverMaterial, selectedCover.coverThickness); return profile ? `HP ${selectedCover.coverHP ?? profile.hp} / ${profile.hp}` : selectedCover.coverHP === null || selectedCover.coverHP === undefined ? "HP não definido" : `HP ${selectedCover.coverHP}`; })()}</span>
                {selectedCover.coverMaterial && <span>Material: {selectedCover.coverMaterial === "ballistic_glass" ? "Vidro balístico" : selectedCover.coverMaterial === "wood" ? "Madeira" : selectedCover.coverMaterial === "brick" ? "Tijolo" : selectedCover.coverMaterial === "stone" ? "Pedra" : selectedCover.coverMaterial === "concrete" ? "Concreto" : "Aço"}</span>}
             </aside>
           )}
           {losFeedback && (
            <>
              <svg className={`tactical-los-line ${losFeedback.cover.status === "full_cover" ? "is-cover" : losFeedback.cover.lineOfSight === "blocked" ? "is-blocked" : losFeedback.cover.status === "partial_obstruction" ? "is-cover" : "is-clear"}`} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                <line x1={positionFor(losFeedback.attacker).x} y1={positionFor(losFeedback.attacker).y} x2={positionFor(losFeedback.target).x} y2={positionFor(losFeedback.target).y} />
                {losFeedback.cover.lineOfSight === "blocked" && <line className="tactical-los-cross" x1={(positionFor(losFeedback.attacker).x + positionFor(losFeedback.target).x) / 2 - 0.012} y1={(positionFor(losFeedback.attacker).y + positionFor(losFeedback.target).y) / 2 - 0.012} x2={(positionFor(losFeedback.attacker).x + positionFor(losFeedback.target).x) / 2 + 0.012} y2={(positionFor(losFeedback.attacker).y + positionFor(losFeedback.target).y) / 2 + 0.012} />}
                {losFeedback.cover.lineOfSight === "blocked" && <line className="tactical-los-cross" x1={(positionFor(losFeedback.attacker).x + positionFor(losFeedback.target).x) / 2 + 0.012} y1={(positionFor(losFeedback.attacker).y + positionFor(losFeedback.target).y) / 2 - 0.012} x2={(positionFor(losFeedback.attacker).x + positionFor(losFeedback.target).x) / 2 - 0.012} y2={(positionFor(losFeedback.attacker).y + positionFor(losFeedback.target).y) / 2 + 0.012} />}
              </svg>
              <div className={`tactical-los-readout ${losFeedback.cover.lineOfSight === "blocked" ? "is-blocked" : losFeedback.cover.status !== "clear" ? "is-cover" : "is-clear"}`} style={{ left: `${((positionFor(losFeedback.attacker).x + positionFor(losFeedback.target).x) / 2) * 100}%`, top: `${((positionFor(losFeedback.attacker).y + positionFor(losFeedback.target).y) / 2) * 100}%` }} aria-live="polite">
                {losFeedback.cover.status === "full_cover" ? "FULL COVER · LOS BLOCKED" : losFeedback.cover.status === "partial_obstruction" ? `PARTIAL OBSTRUCTION${losFeedback.cover.lineOfSight === "blocked" ? " · LOS BLOCKED" : ""}` : losFeedback.cover.lineOfSight === "blocked" ? `LOS BLOCKED · ${losFeedback.blockerType === "door" ? "DOOR" : "WALL"}` : "LOS CLEAR"}
              </div>
            </>
          )}
         {dragging && combatActive && initiativeStarted && localMoves[dragging]?.movementAvailable > 0 && surfaceWidth > 0 && (() => {
           const dragged = state.combatants.find((entry) => entry.id === dragging);
           if (!dragged) return null;
           // O alcance representa a distância disponível a partir do ponto
           // onde o movimento começou; o token pode se mover dentro dele.
           const position = localMoves[dragging].origin;
           const radius = tacticalMovementRadiusPixels(localMoves[dragging].movementAvailable, map, surfaceWidth);
           return <div className={`tactical-movement-range ${localMoves[dragging].withinMovement ? "" : "is-invalid"}`} aria-hidden="true" style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%`, width: `${radius * 2}px`, height: `${radius * 2}px` }} />;
         })()}
         {dragging && combatActive && initiativeStarted && localMoves[dragging] && (() => {
           const move = localMoves[dragging];
           const dragged = state.combatants.find((entry) => entry.id === dragging);
           if (!dragged) return null;
           const feedback = tacticalMovementFeedback(move.origin, move.position, move.movementAvailable, map);
           return <div className={`tactical-movement-readout ${feedback.withinMovement ? "" : "is-invalid"}`} style={{ left: `${move.position.x * 100}%`, top: `${move.position.y * 100}%` }} aria-live="polite">
             <span>Movido: <b>{feedback.distanceMoved}m</b></span>
             <span>Restante: <b>{feedback.movementRemaining}m</b></span>
           </div>;
         })()}
           {state.combatants.map((combatant) => { const position = positionFor(combatant); const movable = canDrag(combatant); const move = localMoves[combatant.id]; const status = move?.status; const selected = selectedTargetId === combatant.id; return <button key={combatant.id} type="button" className={`tactical-token ${combatant.kind === "enemy" ? "is-enemy" : "is-player"} ${combatant.id === state.combat?.activeCombatantId ? "is-active" : ""} ${selected ? "is-target-selected" : ""} ${movable ? "is-movable" : ""} ${status ? `is-${status}` : ""} ${move && !move.withinMovement ? "is-out-of-range" : ""}`} style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }} onPointerDown={(event) => startDrag(combatant.id, event)} onPointerUp={(event) => handleTokenPointerUp(combatant.id, event)} onPointerCancel={() => cancelDrag(combatant.id)} onClick={(event) => { if (geometryEditing) return; if (suppressClickRef.current) { suppressClickRef.current = false; return; } if (canSelectTarget(combatant) && selectedTargetId !== combatant.id) { event.preventDefault(); onSelectTarget(combatant.id); } }} aria-pressed={selected} aria-label={`${combatant.name}${canSelectTarget(combatant) ? ", selecionar alvo" : movable ? ", arraste para mover" : ""}`}><img src={combatant.kind === "enemy" ? ENEMY_AVATAR : (combatant.avatarUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='38' r='24' fill='%237ee7d7'/%3E%3Cpath d='M15 95c2-28 17-40 35-40s33 12 35 40' fill='%237ee7d7'/%3E%3C/svg%3E")} alt="" draggable={false} /><span>{combatant.name}</span></button>; })}
      </div>
      <div className="tactical-legend"><span><i className="player-dot" /> Players</span><span><i className="enemy-dot" /> Enemies</span>{dragging && <em>Movendo...</em>}</div>
    </section>
  );
}
