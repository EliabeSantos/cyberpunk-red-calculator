import type {
  NetArchitecture,
  NetArchitectureProjection,
  NetBasicNode,
  NetBlackIce,
  NetDemon,
  NetDiscoveryState,
  NetFileNode,
  NetFloor,
  NetNode,
  NetPasswordNode,
} from "@/lib/mesa/types";

const NODE_TYPES = new Set(["lobby", "password", "file", "control_node", "black_ice", "demon"]);

function safeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length > 0 && id.length <= 120 ? id : null;
}

function safeText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text.slice(0, max) : undefined;
}

function sanitizeNode(raw: unknown, floorIndex: number, usedIds: Set<string>): NetNode | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const id = safeId(value.id);
  const type = value.type;
  const rawFloor = Number(value.floorIndex);
  if (!id || usedIds.has(id) || !NODE_TYPES.has(type as string) || rawFloor !== floorIndex) return null;
  usedIds.add(id);
  const common = {
    id,
    type: type as NetNode["type"],
    floorIndex,
    ...(safeText(value.name, 120) ? { name: safeText(value.name, 120) } : {}),
    ...(safeText(value.description, 2_000) ? { description: safeText(value.description, 2_000) } : {}),
  };
  if (type === "password") {
    const rawDv = value.dv === undefined || value.dv === null ? undefined : Number(value.dv);
    const dv = rawDv !== undefined && Number.isInteger(rawDv) && rawDv > 0 && rawDv <= 100 ? rawDv : undefined;
    return { ...common, type: "password", ...(dv === undefined ? {} : { dv }), state: value.state === "unlocked" ? "unlocked" : "locked" } as NetPasswordNode;
  }
  if (type === "file") {
    const content = safeText(value.content, 50_000);
    const reference = safeText(value.reference, 500);
    return { ...common, type: "file", ...(content ? { content } : {}), ...(reference ? { reference } : {}) } as NetFileNode;
  }
  if (type === "control_node") {
    const deviceReference = safeText(value.deviceReference, 200);
    const rawDv = value.dv === undefined || value.dv === null ? undefined : Number(value.dv);
    const dv = rawDv !== undefined && Number.isInteger(rawDv) && rawDv > 0 && rawDv <= 100 ? rawDv : undefined;
    const controlState = value.controlState === "controlled" ? "controlled" : "uncontrolled";
    const controlledByNetrunnerId = safeId(value.controlledByNetrunnerId);
    const controlledByDemonId = safeId(value.controlledByDemonId ?? value.demonId);
    return { ...common, type: "control_node", ...(deviceReference ? { deviceReference } : {}), ...(dv === undefined ? {} : { dv }), controlState, ...(controlledByNetrunnerId ? { controlledByNetrunnerId } : {}), ...(controlledByDemonId ? { controlledByDemonId } : {}) };
  }
  if (type === "black_ice") {
    const rawIce = typeof value.blackIce === "object" && value.blackIce !== null && !Array.isArray(value.blackIce)
      ? value.blackIce as Record<string, unknown> : null;
    if (!rawIce) return common as NetBasicNode;
    const numeric = (key: string) => Number(rawIce[key]);
    const typeValue = rawIce.type === "anti_program" || rawIce.type === "anti_personnel" ? rawIce.type : null;
    const fields = ["speed", "per", "def", "rezz", "maxRezz", "attack"];
    if (!typeValue || fields.some((key) => !Number.isInteger(numeric(key)) || numeric(key) < 0 || numeric(key) > 1000) || numeric("maxRezz") < 1) return common as NetBasicNode;
    const name = safeText(rawIce.name, 120) ?? safeText(value.name, 120) ?? "Black ICE";
    const ice: NetBasicNode["blackIce"] = {
      name,
      type: typeValue,
      speed: numeric("speed"),
      per: numeric("per"),
      def: numeric("def"),
      rezz: numeric("rezz"),
      maxRezz: numeric("maxRezz"),
      attack: numeric("attack"),
      ...(Number.isInteger(numeric("damage")) && numeric("damage") >= 0 ? { damage: numeric("damage") } : {}),
      ...(Number.isInteger(numeric("brainDamage")) ? { brainDamage: numeric("brainDamage") } : {}),
    };
    return {
      ...common,
      type: "black_ice",
      blackIce: ice,
      blackIceState: value.blackIceState === "active" || value.blackIceState === "destroyed" ? value.blackIceState : "inactive",
      ...(Number.isInteger(Number(value.blackIceInitiative)) ? { blackIceInitiative: Number(value.blackIceInitiative) } : {}),
      ...(safeId(value.engagedNetrunnerId) ? { engagedNetrunnerId: safeId(value.engagedNetrunnerId)! } : {}),
    } as NetBasicNode;
  }
  if (type === "demon") {
    const rawDemon = typeof value.demon === "object" && value.demon !== null && !Array.isArray(value.demon)
      ? value.demon as Record<string, unknown> : null;
    const demonId = safeId(rawDemon?.id ?? value.demonId) ?? id;
    const demonName = safeText(rawDemon?.name, 120) ?? safeText(value.name, 120) ?? "Demon";
    const state = rawDemon?.state === "inactive" || value.demonState === "inactive" || value.state === "inactive" ? "inactive" : "active";
    const rawControlled = Array.isArray(rawDemon?.controlledNodeIds) ? rawDemon?.controlledNodeIds.filter((entry): entry is string => typeof entry === "string") : [];
    return { ...common, type: "demon", demon: { id: demonId, name: demonName, state, controlledNodeIds: [...new Set(rawControlled)] }, demonState: state } as NetBasicNode;
  }
  return common as NetBasicNode;
}

/** Validação/normalização central; rejeição é feita pelo gateway antes de persistir. */
export function normalizeNetArchitecture(raw: unknown): NetArchitecture | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const id = safeId(value.id);
  const name = safeText(value.name, 160);
  if (!id || !name || !Array.isArray(value.floors) || value.floors.length < 1 || value.floors.length > 100) return null;
  const usedFloorIds = new Set<string>();
  const usedNodeIds = new Set<string>();
  const floors: NetFloor[] = [];
  for (const entry of value.floors) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const floor = entry as Record<string, unknown>;
    const floorId = safeId(floor.id);
    const index = Number(floor.index);
    if (!floorId || usedFloorIds.has(floorId) || !Number.isInteger(index) || index !== floors.length + 1 || !Array.isArray(floor.nodes) || floor.nodes.length > 500) return null;
    usedFloorIds.add(floorId);
    const nodes: NetNode[] = [];
    for (const node of floor.nodes) {
      const normalized = sanitizeNode(node, index, usedNodeIds);
      if (!normalized) return null;
      nodes.push(normalized);
    }
    floors.push({ id: floorId, index, nodes });
  }
  const rawPathfinder = typeof value.pathfinder === "object" && value.pathfinder !== null && !Array.isArray(value.pathfinder) ? value.pathfinder as Record<string, unknown> : null;
  const pathfinderDv = rawPathfinder ? Number(rawPathfinder.dv) : NaN;
  const discoveryDepth = rawPathfinder ? Number(rawPathfinder.discoveryDepth) : NaN;
  const pathfinder = Number.isInteger(pathfinderDv) && pathfinderDv > 0 && pathfinderDv <= 100 && Number.isInteger(discoveryDepth) && discoveryDepth >= 0 && discoveryDepth <= 100
    ? { dv: pathfinderDv, discoveryDepth }
    : undefined;
  const demonIds = new Set(floors.flatMap((floor) => floor.nodes).flatMap((node) => node.type === "demon" && node.demon ? [node.demon.id ?? node.id] : []));
  for (const node of floors.flatMap((floor) => floor.nodes)) {
    if (node.type === "control_node" && node.controlledByDemonId && !demonIds.has(node.controlledByDemonId)) return null;
  }
  const normalizedFloors = floors.map((floor) => ({
    ...floor,
    nodes: floor.nodes.map((node) => {
      if (node.type !== "demon" || !node.demon) return node;
      const controlledNodeIds = floors.flatMap((entry) => entry.nodes).filter((entry) => entry.type === "control_node" && entry.controlledByDemonId === node.demon!.id).map((entry) => entry.id);
      return { ...node, demon: { ...node.demon, id: node.demon.id ?? node.id, controlledNodeIds }, demonState: node.demon.state };
    }),
  }));
  return {
    id,
    name,
    ...(safeText(value.description, 2_000) ? { description: safeText(value.description, 2_000) } : {}),
    floors: normalizedFloors,
    ...(pathfinder ? { pathfinder } : {}),
  };
}

export function normalizeNetArchitectures(raw: unknown): NetArchitecture[] {
  if (!Array.isArray(raw)) return [];
  const result: NetArchitecture[] = [];
  const ids = new Set<string>();
  for (const entry of raw.slice(0, 100)) {
    const architecture = normalizeNetArchitecture(entry);
    if (architecture && !ids.has(architecture.id)) {
      ids.add(architecture.id);
      result.push(architecture);
    }
  }
  return result;
}

export function normalizeNetDiscovery(raw: unknown, architectureId: string): NetDiscoveryState {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const value = raw as Record<string, unknown>;
    const ids = Array.isArray(value.discoveredNodeIds) ? value.discoveredNodeIds.filter((id): id is string => typeof id === "string") : [];
    const revealed = Array.isArray(value.revealedFileIds) ? value.revealedFileIds.filter((id): id is string => typeof id === "string") : undefined;
    return { architectureId: typeof value.architectureId === "string" ? value.architectureId : architectureId, discoveredNodeIds: [...new Set(ids)], ...(revealed ? { revealedFileIds: [...new Set(revealed)] } : {}) };
  }
  return { architectureId, discoveredNodeIds: [] };
}

/**
 * Projeção da Architecture para um viewer.
 *
 * `viewerNetrunnerId` é o combatente do PRÓPRIO Netrunner: somente nesse caso
 * o Control Node revela `controlledByNetrunnerId`. O estado de um Node de
 * terceiros continua privado — o Player vê que o Node está `controlled`, nunca
 * quem o controla.
 */
export function projectNetArchitecture(
  architecture: NetArchitecture,
  currentFloor: number,
  discovery: NetDiscoveryState,
  administrative: boolean,
  viewerNetrunnerId: string | null = null,
): NetArchitectureProjection {
  if (administrative) return { ...architecture, architectureId: architecture.id, currentFloor, nodes: architecture.floors.find((floor) => floor.index === currentFloor)?.nodes ?? [], administrative: true, floors: architecture.floors };
  const discovered = new Set(discovery.discoveredNodeIds);
  const floor = architecture.floors.find((entry) => entry.index === currentFloor);
  const readableFiles = discovery.revealedFileIds === undefined ? discovered : new Set(discovery.revealedFileIds);
  const discoveredDemonIds = new Set(architecture.floors.flatMap((entry) => entry.nodes).filter((node) => node.type === "demon" && discovered.has(node.id) && node.demon).map((node) => node.type === "demon" && node.demon ? node.demon.id : ""));
  const nodes = (floor?.nodes ?? []).filter((node) => discovered.has(node.id)).map((node) => {
    if (node.type !== "file") return node;
    return readableFiles.has(node.id) ? node : { ...node, content: undefined };
  });
  const publicNodes = nodes.map((node) => {
    if (node.type === "control_node") {
      const demonKnown = node.controlledByDemonId ? discoveredDemonIds.has(node.controlledByDemonId) : false;
      const ownedByViewer = Boolean(viewerNetrunnerId) && node.controlledByNetrunnerId === viewerNetrunnerId;
      return { ...node, controlledByNetrunnerId: ownedByViewer ? node.controlledByNetrunnerId : undefined, ...(demonKnown ? {} : { controlledByDemonId: undefined }) };
    }
    if (node.type === "demon" && node.demon) {
      return { ...node, demon: { ...node.demon, controlledNodeIds: (node.demon.controlledNodeIds ?? []).filter((id) => discovered.has(id)) } };
    }
    return node;
  });
  return {
    architectureId: architecture.id,
    name: architecture.name,
    ...(architecture.description ? { description: architecture.description } : {}),
    currentFloor,
    nodes: publicNodes,
  };
}

export function discoverableNodeIds(architecture: NetArchitecture, architectureId: string, discovery: NetDiscoveryState): string[] {
  if (discovery.architectureId !== architectureId) return [];
  const valid = new Set(architecture.floors.flatMap((floor) => floor.nodes.map((node) => node.id)));
  return [...new Set(discovery.discoveredNodeIds.filter((id) => valid.has(id)))];
}

/** Pathfinder usa somente a profundidade configurada pela Architecture. */
export function pathfinderNodeIds(architecture: NetArchitecture, currentFloor: number): string[] {
  const depth = architecture.pathfinder?.discoveryDepth;
  if (depth === undefined) return [];
  const discovered: string[] = [];
  const lockedAt = new Set<number>();
  for (const floor of architecture.floors.filter((entry) => entry.index >= currentFloor && entry.index <= currentFloor + depth)) {
    if (floor.index > currentFloor && lockedAt.has(floor.index - 1)) break;
    discovered.push(...floor.nodes.map((node) => node.id));
    if (floor.nodes.some((node) => node.type === "password" && node.state === "locked")) lockedAt.add(floor.index);
  }
  return discovered;
}

export function nextFloorAfterUnlockedPassword(architecture: NetArchitecture, currentFloor: number): number | null {
  const floor = architecture.floors.find((entry) => entry.index === currentFloor);
  const next = architecture.floors.find((entry) => entry.index === currentFloor + 1);
  if (!floor || !next) return null;
  const lockedPassword = floor.nodes.some((node) => node.type === "password" && node.state === "locked");
  return lockedPassword ? null : next.index;
}
