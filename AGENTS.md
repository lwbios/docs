# Documentação da Valora Payments

Site de documentação em [Mintlify](https://mintlify.com). Páginas em MDX com frontmatter YAML; configuração em `docs.json`.

## Fonte da verdade

- A documentação descreve a API real em `../Api` (rotas em `Api/src/app/v1`, campos em `Api/src/lib/schemas.ts`). Nunca documente campo, rota, evento ou limite que não exista no código.
- `openapi.json` é gerado por `node scripts/gen-openapi.mjs openapi.json`. Edite o gerador, não o JSON.
- Rótulos do painel (menus e botões) vêm do `../dashboard`. Confira o texto exato antes de citar.

## Idioma e estilo

- Português do Brasil, segunda pessoa ("você"), voz ativa, frases curtas.
- Títulos em sentence case ("Criar um checkout", não "Criar Um Checkout").
- Negrito para elementos da interface: **Desenvolvedores → Chaves de API**.
- Código para campos, rotas, headers, ids e valores: `external_reference`, `POST /v1/payments`.
- Páginas abrem com uma frase que diz o que o leitor consegue fazer e terminam com cards de próximos passos.

## Termos

- "pagamento" para o objeto `payment`; "compra" ou "checkout" para `checkout_session`.
- "chave de API" (não "token"); "segredo do webhook" para `whsec_...`.
- "ambiente de teste" ou "Sandbox" e "produção".
- Valores: "em reais" na entrada (`"149.90"`) e "em centavos" na saída (`14990`).

## Fora do escopo

- Rotas `/internal/*` da API, configuração de servidor, provedores (Efí) e segredos.
- Saques pela API (não existem).

## Verificar

```bash
bunx --bun mint@latest validate
bunx --bun mint@latest broken-links
bunx --bun mint@latest dev --no-open --port 3333
```

O CLI do Mintlify não roda no Node 25; use o Bun como acima ou um Node LTS.
