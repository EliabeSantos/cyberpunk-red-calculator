"use client";

import { useMemo, useState } from "react";

import { catalogItems, getCatalogItem, type ItemCategory } from "@/data/items";
import { addEurodollars, canPurchaseItem, getItemForFree, purchaseItem } from "@/lib/store";
import type { Character } from "@/types/character";

type Props = { character: Character; onUpdate: (character: Character) => void };
const categoryLabels: Record<ItemCategory, string> = { cyberware: "Cyberware", weapon: "Armas", armor: "Armaduras", healing: "Cura", grenade: "Granadas", ammunition: "Munição", electronics: "Eletrônicos", netrunner: "Netrunner", tool: "Ferramentas", drone: "Drones", survival: "Sobrevivência", clothing: "Vestuário", consumable: "Consumíveis", drug: "Drogas", gear: "Equipamento", mission_item: "Missão" };

export default function StorePanel({ character, onUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | ItemCategory>("all");
  const [income, setIncome] = useState(0);
  const [notice, setNotice] = useState("");

  const items = useMemo(
    () => catalogItems.filter((item) =>
      (category === "all" || item.category === category) &&
      item.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))
    ),
    [category, query]
  );

  function buy(itemId: string) {
    const result = purchaseItem(character, itemId);
    if ("error" in result) {
      setNotice(result.error === "insufficient-funds" ? "Saldo insuficiente para esta compra." : "Item não encontrado.");
      return;
    }
    onUpdate(result.character);
    setNotice(`${result.item.name} adicionado ao inventário.`);
  }

  function getFree(itemId: string) {
    const result = getItemForFree(character, itemId);
    if ("error" in result) { setNotice("Item não encontrado."); return; }
    onUpdate(result.character);
    setNotice(`${result.item.name} adicionado gratuitamente.`);
  }

  function addFunds() {
    const updated = addEurodollars(character, income);
    if (updated !== character) {
      onUpdate(updated);
      setIncome(0);
      setNotice("Eurodólares adicionados.");
    }
  }

  return (
    <>
      <button type="button" className="open-store-button" onClick={() => setOpen(true)}>
        <span className="store-button-icon">🛒</span>
        <span className="store-button-content">
          <span className="store-button-label">Comprar itens</span>
          <span className="store-button-balance">€$ {character.wallet.eurodollars.toLocaleString("pt-BR")}</span>
        </span>
        <span className="store-button-arrow">▶</span>
      </button>

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="store-modal" role="dialog" aria-modal="true" aria-label="Loja de itens" onMouseDown={(event) => event.stopPropagation()}>
            {/* Header */}
            <div className="store-header">
              <div className="store-header-left">
                <button type="button" className="store-close-btn" onClick={() => setOpen(false)} aria-label="Fechar loja">✕</button>
                <div>
                  <p className="store-eyebrow">Mercado</p>
                  <h2 className="store-title">Comprar itens</h2>
                </div>
              </div>
              <div className="store-wallet-card">
                <span className="wallet-label">Saldo</span>
                <span className="wallet-amount">€$ {character.wallet.eurodollars.toLocaleString("pt-BR")}</span>
              </div>
            </div>

            {/* Funds Section */}
            <div className="store-section">
              <div className="store-section-header">
                <span className="store-section-icon">💰</span>
                <span className="store-section-title">Adicionar fundos</span>
              </div>
              <div className="store-funds-row">
                <input
                  type="number"
                  min="1"
                  value={income || ""}
                  onChange={(event) => setIncome(Math.max(0, Number(event.target.value) || 0))}
                  placeholder="Eurodólares"
                  className="store-funds-input"
                />
                <button
                  type="button"
                  className="store-funds-button"
                  onClick={addFunds}
                  disabled={!income}
                >
                  + Adicionar
                </button>
              </div>
              <p className="store-help-text">Registre pagamentos recebidos pelo personagem antes de comprar.</p>
            </div>

            {/* Search Section */}
            <div className="store-search-section">
              <div className="store-search-wrapper">
                <span className="store-search-icon">🔍</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar item por nome..."
                  className="store-search-input"
                />
                {query && (
                  <button
                    type="button"
                    className="store-search-clear"
                    onClick={() => setQuery("")}
                    aria-label="Limpar busca"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="store-filter-row">
                <span className="store-filter-label">Categoria:</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as "all" | ItemCategory)}
                  className="store-category-select"
                >
                  <option value="all">Todas</option>
                  {Object.entries(categoryLabels).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Notice */}
            {notice && (
              <div className="store-notice" role="status">
                <span className="notice-icon">ℹ</span>
                {notice}
              </div>
            )}

            {/* Items Grid */}
            <div className="store-items">
              {items.map((item) => {
                const purchasable = canPurchaseItem(character, item);
                return (
                  <article className="store-item" key={item.id}>
                    <div className="item-info">
                      <span className="item-category">{categoryLabels[item.category]}</span>
                      <h3 className="item-name">{item.name}</h3>
                      {item.effects?.[0] && <p className="item-effect">{item.effects[0]}</p>}
                      {item.effects && item.effects.length > 1 && (
                        <ul className="item-effects">
                          {item.effects.slice(1).map((effect) => (
                            <li key={effect}>{effect}</li>
                          ))}
                        </ul>
                      )}
                      {item.requires && (
                        <p className="item-requires">
                          Requer: {getCatalogItem(item.requires)?.name ?? item.requires}
                        </p>
                      )}
                    </div>
                    <div className="item-actions">
                      <span className="item-price">€$ {item.price.toLocaleString("pt-BR")}</span>
                      <button
                        type="button"
                        className="item-buy-btn"
                        disabled={!purchasable}
                        onClick={() => buy(item.id)}
                      >
                        {purchasable ? "Comprar" : "Sem saldo"}
                      </button>
                      <button
                        type="button"
                        className="item-free-btn"
                        onClick={() => getFree(item.id)}
                      >
                        Grátis
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
