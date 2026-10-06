"use client";

/**
 * F1.19 — palco reservado para a futura visão tática.
 *
 * Este componente é deliberadamente visual: não possui mapa, coordenadas ou
 * estado próprio. O mapa poderá ser inserido como filho sem alterar o HUD.
 */
export default function TacticalView() {
  return (
    <section className="player-mesa-tactical" aria-label="Game View / Tactical View">
      <div className="player-mesa-tactical-grid" aria-hidden="true" />
      <div className="player-mesa-tactical-scanline" aria-hidden="true" />
      <div className="player-mesa-tactical-content">
        <span className="player-mesa-tactical-mark">{"//"}</span>
        <span className="mesa-eyebrow">GAME VIEW</span>
        <strong>TACTICAL VIEW</strong>
        <p>O campo de combate será conectado aqui.</p>
        <span className="player-mesa-tactical-status">STAGE READY</span>
      </div>
    </section>
  );
}
