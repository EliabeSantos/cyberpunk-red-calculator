/**
 * F1.62 — Hackable Objects como elementos de gameplay.
 *
 * O Hackable Object é a representação FÍSICA/VISUAL no Tactical Map. A
 * autoridade lógica continua sendo o Control Node da NET Architecture, e o
 * efeito concreto continua sendo aplicado na geometria existente
 * (`TacticalGeometry.doors`). Este módulo é puro: cataloga os tipos, declara
 * quais efeitos têm regra definida e resolve a transição de estado. Ele não
 * autentica, não persiste e não publica Realtime — isso pertence ao gateway do
 * servidor (`executeControlDeviceEffect` em `store.ts`).
 *
 * REGRA DE PROJETO: nenhum efeito de gameplay é inventado aqui. As relações
 * SUPPORTED são somente CONTROL → DOOR OPEN/CLOSE (F1.62) e CONTROL → CAMERA
 * ONLINE/DISABLED (F1.63); todos os outros tipos ficam explicitamente
 * UNSUPPORTED até existir regra definida.
 */
import type { NetNode, NetrunnerConnectionState, TacticalHackableObject, TacticalMap } from "@/lib/mesa/types";
import { updateTacticalGeometrySegment } from "@/lib/mesa/tacticalMap";

/** Catálogo tipado e central dos tipos de Hackable Object. */
export const HACKABLE_OBJECT_TYPES = ["door", "camera", "terminal", "console", "access_panel", "security_system", "generic"] as const;

export type HackableObjectType = (typeof HACKABLE_OBJECT_TYPES)[number];

export function isHackableObjectType(value: unknown): value is HackableObjectType {
  return typeof value === "string" && (HACKABLE_OBJECT_TYPES as readonly string[]).includes(value);
}

/**
 * `door_panel` era o nome do tipo de porta antes do catálogo F1.62. O alias
 * existe somente na leitura de dados persistidos: nenhum objeto novo nasce
 * com ele.
 */
export function normalizeHackableObjectType(value: unknown): HackableObjectType | null {
  if (value === "door_panel") return "door";
  return isHackableObjectType(value) ? value : null;
}

export const HACKABLE_OBJECT_LABELS: Record<HackableObjectType, string> = {
  door: "Porta",
  camera: "Câmera",
  terminal: "Terminal",
  console: "Console",
  access_panel: "Painel de acesso",
  security_system: "Sistema de segurança",
  generic: "Genérico",
};

export function hackableObjectTypeLabel(type: unknown): string {
  return isHackableObjectType(type) ? HACKABLE_OBJECT_LABELS[type] : "Desconhecido";
}

/** Ações de dispositivo admitidas pelo projeto; agrupadas por tipo. */
export const HACKABLE_DEVICE_ACTIONS = ["open", "close", "enable", "disable"] as const;
export type HackableDeviceAction = (typeof HACKABLE_DEVICE_ACTIONS)[number];

/** Somente `open`/`close` pertencem ao efeito de porta (F1.62). */
export const DOOR_DEVICE_ACTIONS = ["open", "close"] as const;
/** Somente `enable`/`disable` pertencem ao efeito de câmera (F1.63). */
export const CAMERA_DEVICE_ACTIONS = ["enable", "disable"] as const;

export function isHackableDeviceAction(value: unknown): value is HackableDeviceAction {
  return typeof value === "string" && (HACKABLE_DEVICE_ACTIONS as readonly string[]).includes(value);
}

/**
 * F1.63 — estado autoritativo mínimo da câmera.
 *
 * A câmera NÃO é geometria: ela não vira parede, porta, colisão, movimento,
 * cobertura, distância ou alcance. Por isso o estado vive no próprio objeto
 * Hackable (e não em `TacticalGeometry`), em uma única cópia. `online` é o
 * valor implícito quando nada foi persistido.
 */
export const CAMERA_DEVICE_STATES = ["online", "disabled"] as const;
export type HackableDeviceState = (typeof CAMERA_DEVICE_STATES)[number];
export const DEFAULT_CAMERA_DEVICE_STATE: HackableDeviceState = "online";

export function isHackableDeviceState(value: unknown): value is HackableDeviceState {
  return value === "online" || value === "disabled";
}

export type HackableEffectSupport = "SUPPORTED" | "UNSUPPORTED";

export interface HackableObjectEffectDefinition {
  /** Espelha o vocabulário de suporte exigido pela especificação. */
  status: HackableEffectSupport;
  /** Ações de dispositivo com regra definida; vazio quando UNSUPPORTED. */
  actions: readonly HackableDeviceAction[];
  /** Motivo real de a falta de suporte — nunca um efeito presumido. */
  reason?: string;
}

const UNSUPPORTED_EFFECT = (reason: string): HackableObjectEffectDefinition => ({ status: "UNSUPPORTED", actions: [], reason });

/**
 * Única fonte de verdade sobre o que um Hackable Object pode fazer.
 *
 * Somente `door` (CONTROL → DOOR OPEN/CLOSE, F1.62) e `camera` (CONTROL →
 * CAMERA ONLINE/DISABLED, F1.63) têm efeito concreto. Os demais tipos
 * permanecem estruturalmente prontos (seleção, estado, Control Node,
 * autorização, feedback, persistência e Realtime) sem nenhum efeito de
 * gameplay inventado: sem dano, alarme, bônus, debuff, visão de inimigos ou
 * ataque de segurança.
 */
export const HACKABLE_OBJECT_EFFECTS: Record<HackableObjectType, HackableObjectEffectDefinition> = {
  door: { status: "SUPPORTED", actions: DOOR_DEVICE_ACTIONS },
  camera: { status: "SUPPORTED", actions: CAMERA_DEVICE_ACTIONS },
  terminal: UNSUPPORTED_EFFECT("O projeto não define regra de efeito para terminais."),
  console: UNSUPPORTED_EFFECT("O projeto não define regra de efeito para consoles."),
  access_panel: UNSUPPORTED_EFFECT("O projeto não define regra de efeito para painéis de acesso."),
  security_system: UNSUPPORTED_EFFECT("O projeto não define regra de efeito para sistemas de segurança."),
  generic: UNSUPPORTED_EFFECT("O projeto não define regra de efeito para objetos genéricos."),
};

export function hackableObjectEffect(type: HackableObjectType): HackableObjectEffectDefinition {
  return HACKABLE_OBJECT_EFFECTS[type];
}

/** Motivos reais de indisponibilidade; a UI nunca esconde a ação em silêncio. */
export type HackableObjectControlDenial =
  | "jack_in_required"
  | "object_inactive"
  | "control_node_missing"
  | "control_node_not_discovered"
  | "control_node_unavailable"
  | "control_node_not_controlled"
  | "control_node_demon_controlled"
  | "no_access"
  | "action_unsupported"
  | "door_geometry_missing";

export const HACKABLE_OBJECT_DENIAL_MESSAGES: Record<HackableObjectControlDenial, string> = {
  jack_in_required: "JACK IN necessário",
  object_inactive: "Objeto desativado",
  control_node_missing: "Control Node não vinculado",
  control_node_not_discovered: "Control Node não descoberto",
  control_node_unavailable: "Control Node indisponível",
  control_node_not_controlled: "Control Node não controlado",
  control_node_demon_controlled: "Control Node sob controle de um Demon",
  no_access: "Sem acesso",
  action_unsupported: "Ação indisponível",
  door_geometry_missing: "Porta sem geometria vinculada",
};

export function hackableObjectDenialMessage(denial: HackableObjectControlDenial): string {
  return HACKABLE_OBJECT_DENIAL_MESSAGES[denial];
}

/** Estado efetivo da porta física ligada ao objeto; `null` quando não há porta. */
export function hackableObjectDoorState(map: TacticalMap, object: TacticalHackableObject): "open" | "closed" | null {
  if (object.type !== "door" || !object.geometryDoorId) return null;
  const door = (map.geometry?.doors ?? []).find((entry) => entry.id === object.geometryDoorId);
  return door ? door.state : null;
}

/**
 * Estado autoritativo da câmera; `null` quando o objeto não é câmera.
 *
 * `online` é o valor implícito de uma câmera criada sem estado persistido.
 */
export function hackableObjectCameraState(object: TacticalHackableObject, map?: TacticalMap): HackableDeviceState | null {
  if (object.type !== "camera") return null;
  const persisted = (map?.hackableObjects ?? []).find((entry) => entry.id === object.id);
  const candidate = persisted?.deviceState ?? object.deviceState;
  return isHackableDeviceState(candidate) ? candidate : DEFAULT_CAMERA_DEVICE_STATE;
}

export type DeviceEffectFailure =
  | "object_not_found"
  | "object_inactive"
  | "invalid_object_type"
  | "invalid_action"
  | "effect_unsupported"
  | "door_geometry_missing"
  | "already_open"
  | "already_closed"
  | "already_online"
  | "already_disabled";

/** Ramo `door`: o alvo é a MESMA entidade de `TacticalGeometry.doors`. */
export interface DoorDeviceEffectResolution {
  ok: true;
  kind: "door";
  map: TacticalMap;
  objectId: string;
  objectName: string;
  doorId: string;
  stateBefore: "open" | "closed";
  stateAfter: "open" | "closed";
}

/**
 * Ramo `camera`: o alvo é o PRÓPRIO objeto Hackable (a câmera não é
 * geometria), em uma única cópia de `deviceState`.
 */
export interface CameraDeviceEffectResolution {
  ok: true;
  kind: "camera";
  map: TacticalMap;
  objectId: string;
  objectName: string;
  cameraStateBefore: HackableDeviceState;
  cameraStateAfter: HackableDeviceState;
}

export type DeviceEffectResolution =
  | DoorDeviceEffectResolution
  | CameraDeviceEffectResolution
  | { ok: false; reason: DeviceEffectFailure };

/**
 * Resolve as duas transições de efeito definidas pelo projeto:
 * CONTROL → DOOR OPEN/CLOSE (F1.62) e CONTROL → CAMERA ONLINE/DISABLED
 * (F1.63). A função é pura: lê o estado atual persistido e devolve o mapa
 * seguinte. A ação vinda do cliente é apenas intenção — o estado nunca é
 * aceito dela.
 *
 * A porta continua sendo a MESMA entidade de `TacticalGeometry.doors`, com o
 * mesmo `id`; a câmera continua sendo o MESMO objeto Hackable, com o mesmo
 * `id`. Nenhuma entidade paralela é criada.
 */
export function resolveHackableObjectDeviceEffect(input: {
  map: TacticalMap;
  objectId: string;
  action: unknown;
}): DeviceEffectResolution {
  const object = (input.map.hackableObjects ?? []).find((entry) => entry.id === input.objectId);
  if (!object) return { ok: false, reason: "object_not_found" };
  if (object.active !== true) return { ok: false, reason: "object_inactive" };
  if (!isHackableObjectType(object.type)) return { ok: false, reason: "invalid_object_type" };
  if (!isHackableDeviceAction(input.action)) return { ok: false, reason: "invalid_action" };

  const effect = HACKABLE_OBJECT_EFFECTS[object.type];
  if (effect.status !== "SUPPORTED" || !effect.actions.includes(input.action)) return { ok: false, reason: "effect_unsupported" };

  if (object.type === "camera") {
    if (input.action !== "enable" && input.action !== "disable") return { ok: false, reason: "effect_unsupported" };
    const cameraStateBefore = hackableObjectCameraState(object, input.map);
    // `hackableObjectCameraState` só devolve null para objeto que não é câmera.
    if (!cameraStateBefore) return { ok: false, reason: "effect_unsupported" };
    const cameraStateAfter: HackableDeviceState = input.action === "enable" ? "online" : "disabled";
    if (cameraStateBefore === cameraStateAfter) {
      return { ok: false, reason: cameraStateBefore === "online" ? "already_online" : "already_disabled" };
    }
    return {
      ok: true,
      kind: "camera",
      map: {
        ...input.map,
        hackableObjects: (input.map.hackableObjects ?? []).map((entry) =>
          entry.id === object.id ? { ...entry, deviceState: cameraStateAfter } : entry,
        ),
      },
      objectId: object.id,
      objectName: object.name ?? HACKABLE_OBJECT_LABELS[object.type],
      cameraStateBefore,
      cameraStateAfter,
    };
  }

  if (object.type !== "door") return { ok: false, reason: "effect_unsupported" };
  if (!object.geometryDoorId) return { ok: false, reason: "door_geometry_missing" };

  const geometry = input.map.geometry ?? { walls: [], doors: [] };
  const door = geometry.doors.find((entry) => entry.id === object.geometryDoorId);
  if (!door) return { ok: false, reason: "door_geometry_missing" };

  const stateAfter = input.action === "open" ? "open" : "closed";
  if (door.state === stateAfter) return { ok: false, reason: door.state === "open" ? "already_open" : "already_closed" };

  return {
    ok: true,
    kind: "door",
    map: { ...input.map, geometry: updateTacticalGeometrySegment(geometry, door.id, { state: stateAfter }) },
    objectId: object.id,
    objectName: object.name ?? HACKABLE_OBJECT_LABELS[object.type],
    doorId: door.id,
    stateBefore: door.state,
    stateAfter,
  };
}

/**
 * Patches somente o campo de estado da porta no JSON persistido, sem
 * reescrever o restante do mapa. Assim a gravação do gateway não descarta
 * nada que um Editor GM tenha salvo entre a leitura e a escrita.
 */
export function patchTacticalDoorState(raw: unknown, doorId: string, state: "open" | "closed"): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const map = raw as Record<string, unknown>;
  const geometry = map.geometry;
  if (typeof geometry !== "object" || geometry === null || Array.isArray(geometry)) return raw;
  const doors = (geometry as Record<string, unknown>).doors;
  if (!Array.isArray(doors)) return raw;
  let changed = false;
  const nextDoors = doors.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
    const door = entry as Record<string, unknown>;
    if (door.id !== doorId || door.state === state) return entry;
    changed = true;
    return { ...door, state };
  });
  if (!changed) return raw;
  return { ...map, geometry: { ...(geometry as Record<string, unknown>), doors: nextDoors } };
}

/**
 * Patches somente o campo de estado da câmera no JSON persistido, sem
 * reescrever o restante do mapa. Mesmo motivo do patch de porta: a gravação do
 * gateway não descarta nada que um Editor GM tenha salvo entre a leitura e a
 * escrita.
 */
export function patchHackableCameraState(raw: unknown, objectId: string, state: HackableDeviceState): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const map = raw as Record<string, unknown>;
  const objects = map.hackableObjects;
  if (!Array.isArray(objects)) return raw;
  let changed = false;
  const nextObjects = objects.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
    const object = entry as Record<string, unknown>;
    if (object.id !== objectId || object.deviceState === state) return entry;
    changed = true;
    return { ...object, deviceState: state };
  });
  if (!changed) return raw;
  return { ...map, hackableObjects: nextObjects };
}

/**
 * F1.63 — informa se o JSON persistido já carrega `deviceState` explícito.
 *
 * O compare-and-set do gateway precisa distinguir "câmera online explícita" de
 * "câmera anterior a esta fase, sem a chave". Sem isto, um filtro JSONB de
 * contenção não casaria com o objeto legado e a escrita seria recusada.
 */
export function hackableCameraStateIsExplicit(raw: unknown, objectId: string): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const objects = (raw as Record<string, unknown>).hackableObjects;
  if (!Array.isArray(objects)) return false;
  const object = objects.find((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry) && (entry as Record<string, unknown>).id === objectId);
  return Boolean(object) && isHackableDeviceState((object as Record<string, unknown>).deviceState);
}

/**
 * F1.63 — identidade de quem observa, para o sistema de vigilância EXISTENTE.
 *
 * A união representa apenas QUEM observa (personagem ou câmera). O algoritmo
 * de detecção continua sendo UM só (`resolveDetectionCheck`, Stealth vs
 * Perception oposto): esta abstração não o duplica, não o substitui e não
 * adiciona segunda regra de percepção.
 */
export type DetectionObserverRef =
  | { kind: "character"; combatantId: string }
  | { kind: "camera"; objectId: string };

export type CameraObservationSupport = "SUPPORTED" | "UNSUPPORTED";

export interface CameraObservationEligibility {
  /** A câmera PODE ser considerada um observador de vigilância. */
  eligible: boolean;
  /** Suporte do ALGORITMO existente à resolução numérica de detecção. */
  support: CameraObservationSupport;
  /** Motivo real; a UI nunca esconde em silêncio. */
  reason: string | null;
  /** Estado autoritativo da câmera; `null` quando o objeto não é câmera. */
  state: HackableDeviceState | null;
}

/** Fallback honesto: nada é resolvido sem regra definida. */
const NO_DETECTION_RULE =
  "O sistema de Detection existente resolve Stealth vs Perception usando o observer combatente (INT + Perception do snapshot, sob posse de um Player). A câmera não possui snapshot, STAT, perícia, posse nem ID de combatente, e o projeto não define Perception, alcance, cone ou LOS de câmera — portanto a resolução numérica fica UNSUPPORTED até existir regra.";

/**
 * F1.63 — passo controlado da integração câmera → vigilância.
 *
 * Implementa APENAS o que a regra atual permite afirmar sem inventar nada:
 *
 *   camera ONLINE  → a câmera pode ser CONSIDERADA observadora;
 *   camera DISABLED → a câmera NÃO gera observações/detecções.
 *
 * A resolução concreta ( Perception, alcance, cone, rotação, visão através de
 * paredes, infravermelho, noturna, percepção automática, alerta automático )
 * permanece UNSUPPORTED: nenhuma dessas regras existe no projeto e nenhuma é
 * inventada aqui.
 */
export function cameraObservationEligibility(
  object: TacticalHackableObject,
  map?: TacticalMap,
): CameraObservationEligibility {
  const state = hackableObjectCameraState(object, map);
  if (object.type !== "camera") {
    return { eligible: false, support: "UNSUPPORTED", reason: "Somente câmeras participam da vigilância.", state: null };
  }
  if (object.active !== true) {
    return { eligible: false, support: "UNSUPPORTED", reason: HACKABLE_OBJECT_DENIAL_MESSAGES.object_inactive, state };
  }
  if (state !== "online") {
    return { eligible: false, support: "UNSUPPORTED", reason: "Câmera desativada não gera observações.", state };
  }
  return { eligible: true, support: "UNSUPPORTED", reason: NO_DETECTION_RULE, state };
}

/** Observer de câmera só existe para câmeras ONLINE e ativas. */
export function cameraObserverRef(object: TacticalHackableObject, map?: TacticalMap): DetectionObserverRef | null {
  return cameraObservationEligibility(object, map).eligible ? { kind: "camera", objectId: object.id } : null;
}

export type HackableControlNodeStatus =
  | "not_linked"
  | "not_discovered"
  | "discovered"
  | "not_controlled"
  | "controlled_by_viewer"
  | "controlled_by_other"
  | "controlled_by_demon";

export interface HackableObjectControlView {
  /** Pronto para executar uma ação de dispositivo autorizada. */
  ready: boolean;
  denial: HackableObjectControlDenial | null;
  /** Motivo real exibido pela UI quando a ação não pode ser executada. */
  message: string | null;
  /** Motivo extra (catálogo UNSUPPORTED), usado como detalhe/tooltips. */
  detail: string | null;
  /** Ações disponíveis considerando o estado ATUAL da geometria/objeto. */
  actions: HackableDeviceAction[];
  doorState: "open" | "closed" | null;
  /** Estado autoritativo da câmera; `null` quando o objeto não é câmera. */
  cameraState: HackableDeviceState | null;
  controlNodeStatus: HackableControlNodeStatus;
  controlNodeId: string | null;
  effectStatus: HackableEffectSupport | "unknown";
}

/**
 * Projeção da UI do painel HACKABLE OBJECT. Ela só REFLETE o que o servidor
 * autoriza: nenhum clique é enviado sem passar pelo gateway, que refaz todas
 * estas validações a partir do estado persistido.
 */
export function describeHackableObjectControl(input: {
  object: TacticalHackableObject;
  map: TacticalMap;
  netrunner: Pick<NetrunnerConnectionState, "isJackedIn"> | null;
  viewerCombatantId?: string | null;
  /** Nó já projetado (descoberto) na projeção NET do próprio viewer. */
  controlNode?: NetNode | null;
}): HackableObjectControlView {
  const controlNodeId = input.object.controlNodeId ?? null;
  const node = input.controlNode ?? null;
  const doorState = hackableObjectDoorState(input.map, input.object);
  const cameraState = hackableObjectCameraState(input.object, input.map);
  const effect = isHackableObjectType(input.object.type) ? HACKABLE_OBJECT_EFFECTS[input.object.type] : null;

  const controlNodeStatus: HackableControlNodeStatus = !controlNodeId
    ? "not_linked"
    : !node || node.type !== "control_node"
      ? "not_discovered"
      : node.controlledByDemonId
        ? "controlled_by_demon"
        : node.controlState !== "controlled"
          ? "not_controlled"
          : node.controlledByNetrunnerId && node.controlledByNetrunnerId === input.viewerCombatantId
            ? "controlled_by_viewer"
            : "controlled_by_other";

  const deny = (denial: HackableObjectControlDenial, detail: string | null = null): HackableObjectControlView => ({
    ready: false,
    denial,
    message: HACKABLE_OBJECT_DENIAL_MESSAGES[denial],
    detail,
    actions: [],
    doorState,
    cameraState,
    controlNodeStatus,
    controlNodeId,
    effectStatus: effect?.status ?? "unknown",
  });

  if (!input.netrunner?.isJackedIn) return deny("jack_in_required");
  if (input.object.active !== true) return deny("object_inactive");
  if (!controlNodeId) return deny("control_node_missing");
  if (controlNodeStatus === "not_discovered") return deny("control_node_not_discovered");
  if (controlNodeStatus === "controlled_by_demon") return deny("control_node_demon_controlled");
  if (controlNodeStatus === "not_controlled") return deny("control_node_not_controlled");
  if (controlNodeStatus === "controlled_by_other") return deny("no_access");
  if (!effect) return deny("action_unsupported", "Tipo de objeto desconhecido.");
  if (effect.status !== "SUPPORTED") return deny("action_unsupported", effect.reason ?? null);
  if (input.object.type === "door") {
    if (!input.object.geometryDoorId || doorState === null) return deny("door_geometry_missing");
    return {
      ready: true,
      denial: null,
      message: null,
      detail: null,
      actions: doorState === "closed" ? ["open"] : ["close"],
      doorState,
      cameraState,
      controlNodeStatus,
      controlNodeId,
      effectStatus: effect.status,
    };
  }
  if (input.object.type === "camera") {
    // A câmera não depende de geometria: a única autoridade é o próprio `deviceState`.
    if (cameraState === null) return deny("action_unsupported", effect.reason ?? null);
    return {
      ready: true,
      denial: null,
      message: null,
      detail: null,
      actions: cameraState === "online" ? ["disable"] : ["enable"],
      doorState,
      cameraState,
      controlNodeStatus,
      controlNodeId,
      effectStatus: effect.status,
    };
  }
  return deny("action_unsupported", effect.reason ?? null);
}
