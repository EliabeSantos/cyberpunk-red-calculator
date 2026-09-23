This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Discord (espelho de rolagens)

O site pode publicar as rolagens já calculadas em um canal do Discord. O bot **não rola dados** — ele apenas reproduz o resultado produzido pelo site. Um **único bot** atende vários servidores: cada mesa escolhe servidor e canal. O envio usa a **API REST** do Discord (sem gateway), estável no serverless da Vercel.

1. Crie o bot em <https://discord.com/developers/applications>, copie o token e convide-o para os servidores (permissões apenas **Ver canal** e **Enviar mensagens** — não use *Administrator*).
2. Crie um projeto no [Supabase](https://supabase.com) e rode o SQL de `supabase/migrations/20260923120000_mesa_discord_configs.sql` no SQL Editor (cria só a tabela `mesa_discord_configs`).
3. Copie `.env.example` para `.env.local` e preencha:

```env
DISCORD_BOT_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

4. Inicie o projeto (`npm run dev`). Na primeira visita o site pergunta se você quer enviar as rolagens ao Discord; a escolha pode ser alterada depois em 🎲 Dados.
5. Em **🎲 Dados → Discord**: gere/defina o **código da mesa** (ex.: `night-city`) e clique em **⚙ Configurar servidor** para escolher o servidor e o canal. Os jogadores usam o mesmo código da mesa.
6. Ao rolar na ficha com o envio ativado, a mensagem aparece **somente** no canal do servidor vinculado àquela mesa.
7. Para o deploy: adicione as três variáveis acima também em **Vercel → Settings → Environment Variables** e faça redeploy.

Detalhes:

- O banco guarda **apenas** `sessionCode → guildId → channelId` (nenhuma rolagem, ficha ou personagem). RLS habilitado sem policies: só o servidor (service role) acessa.
- Sem consentimento ou sem código de mesa, **nenhuma informação sai do navegador**.
- Token e chaves ficam só no servidor (env server-side) e nunca chegam ao navegador — nada de `NEXT_PUBLIC_*`.
- Se o Discord ou o banco falhar, a rolagem do site continua funcionando normalmente.

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
