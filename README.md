This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Discord (espelho de rolagens)

O site pode publicar as rolagens já calculadas em um canal do Discord. O bot **não rola dados** — ele apenas reproduz o resultado produzido pelo site. Um **único bot** pode atender vários servidores: cada mesa escolhe o servidor e o canal de destino.

1. Crie o bot em <https://discord.com/developers/applications>, copie o token e convide-o para os servidores (permissões apenas **Ver canal** e **Enviar mensagens** — não use *Administrator*).
2. Copie `.env.example` para `.env.local` e preencha:

```env
DISCORD_BOT_TOKEN=
```

3. Inicie o projeto (`npm run dev`). Na primeira visita o site pergunta se você quer enviar as rolagens ao Discord; a escolha pode ser alterada depois em 🎲 Dados.
4. Em **🎲 Dados → Discord**: gere/defina o **código da mesa** (ex.: `night-city`) e clique em **⚙ Configurar servidor** para escolher o servidor e o canal. Os jogadores usam o mesmo código da mesa.
5. Ao rolar na ficha com o envio ativado, a mensagem aparece **somente** no canal do servidor vinculado àquela mesa.

Detalhes:

- A vinculação mesa → guild → canal fica em `./data/discord-sessions.json` (só IDs; nenhum dado de rolagem, ficha ou personagem; pasta ignorada pelo git).
- Sem consentimento ou sem código de mesa, **nenhuma informação sai do navegador**.
- O token fica apenas no servidor (`src/lib/discord/bot.ts`, módulo `server-only`) e nunca chega ao navegador.
- Se o Discord falhar, a rolagem do site continua funcionando normalmente.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
