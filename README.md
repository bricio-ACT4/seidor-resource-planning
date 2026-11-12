# Seidor Resource Planning

Aplicação web de planejamento de recursos do portfólio Agro & Internacional: carga planejada × forecast × realizado, simulador de cenários, quadro de recursos, horas do TIMEFLOW e curva ABC de custo-hora.

- **Frontend:** Vite + JavaScript (sem framework), Chart.js.
- **Banco e login:** Supabase (Postgres, Auth e Row Level Security).
- **Hospedagem:** Vercel (site estático).

## Rodar localmente

```bash
npm install
cp .env.example .env   # URL e chave pública do projeto Supabase
npm run dev
```

## Publicar no Vercel

1. Suba esta pasta para um repositório no GitHub.
2. No Vercel: **Add New → Project**, escolha o repositório (o Vercel detecta Vite sozinho).
3. Em **Environment Variables**, crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` com os valores de `.env.example`.
4. Depois do deploy, no Supabase em **Authentication → URL Configuration**, coloque o endereço do Vercel em **Site URL** e em **Redirect URLs**. Sem isso, os links de confirmação de e-mail e de redefinição de senha apontam para o lugar errado.

## Perfis de acesso

| Perfil | O que pode |
|---|---|
| Aguardando aprovação | Nada, até um administrador liberar |
| Leitor | Portfólio, simulador e quadro de recursos, sem custo-hora individual |
| Editor | Tudo do leitor, mais custos por pessoa, uploads e edição de dados |
| Administrador | Tudo do editor, mais a gestão de usuários |

A **primeira conta criada vira administradora**. As seguintes ficam aguardando aprovação na aba Usuários. As regras são aplicadas no banco (RLS), não só na tela.

## Dados

- `contracts`: contratos do acompanhamento de projetos. Atualize pela aba Portfólio (editar, novo, ou importar o export .xlsx).
- `timeflow_entries`: lançamentos de horas. Suba o relatório na aba Horas (somar ou substituir).
- `resources` e `resource_metrics`: quadro de recursos e taxas calculadas a partir das horas.
- `scenarios`: cenários salvos do simulador.

O esquema completo está em `supabase/migrations/0001_schema.sql`.
