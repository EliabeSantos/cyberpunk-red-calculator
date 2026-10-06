# REDLINE — design system

Primeira versão visual do redesign do Cyberpunk RED Toolkit. A interface assume
o papel de um terminal editorial: dados importantes são calmos e legíveis; a
ação principal é coral; o teal sinaliza estado, foco e elementos interativos.

## Direção

- **Base:** `#070B0D` / `#0B1114` — preto azulado, nunca preto absoluto.
- **Superfícies:** `#101A1D` e `#152326` — painéis discretos, sem excesso de cards.
- **Texto:** `#E8EEE8` para leitura, `#B8C6C0` para apoio e `#7F9690` para metadados.
- **Ação:** `#FF695C` — criar, salvar e alertas de alta prioridade.
- **Estado/foco:** `#7EE7D7` — navegação, foco e valores editáveis.
- **Atenção:** `#F3C969` — custos dobrados, avisos e economia.

## Tipografia

`Geist` é a voz principal: compacta, neutra e confortável em formulários.
`Geist Mono` fica restrita a valores, rótulos técnicos e dados de sistema.
Títulos usam tracking negativo e escala fluida; rótulos ficam em sentence case
sempre que não forem identificadores técnicos.

## Forma e efeitos

- Bordas de 1px em `#294149`; destaque de foco em teal com halo de 3px.
- Raios pequenos (`2px`/`5px`), evitando o visual de dashboard genérico.
- Sombra longa e suave só para separar superfícies da tela, nunca para decorar.
- Grid de 48px, scanlines muito sutis e dois halos radiais como atmosfera.
- Motion responde a interação; `prefers-reduced-motion` desliga transições.

## Layout

Conteúdo alinhado à esquerda, com largura máxima de 76rem e respiro editorial.
No criador: resumo de recursos → identidade/atributos → perícias → ação de
salvar. Em mobile, cada coluna vira fluxo vertical e ações ocupam a largura.

## Tokens

Os tokens vivem em `src/app/design-system.css` como `--redline-*`. Componentes
devem consumir esses tokens em vez de inserir cores hex diretamente. A camada
foi feita como override sobre os nomes de classe existentes para que a lógica de
ficha possa continuar evoluindo sem ficar presa à apresentação.
