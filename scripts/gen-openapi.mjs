// Gera openapi.json a partir da API real (Api/src/app/v1 e Api/src/lib/schemas.ts). Rode na raiz dos docs: node scripts/gen-openapi.mjs openapi.json
import { writeFileSync } from "node:fs";

const out = process.argv[2];
const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const int = (description, extra = {}) => ({ type: "integer", description, ...extra });
const nullable = (schema) => ({ ...schema, type: [schema.type, "null"] });
const dateTime = (d) => str(d, { format: "date-time" });
const money = (d) => ({
  oneOf: [{ type: "string", pattern: "^\\d{1,9}(\\.\\d{1,2})?$" }, { type: "number" }],
  description: `${d} Em reais, com até 2 casas e ponto decimal (ex.: "149.90"). Mínimo 0.01.`,
  examples: ["149.90"],
});
const metadata = {
  type: "object",
  additionalProperties: { type: "string", maxLength: 500 },
  maxProperties: 20,
  description: "Até 20 pares chave/valor em texto (chave até 40, valor até 500 caracteres). Volta igual nas respostas e nos webhooks.",
  examples: [{ order_id: "1001" }],
};
const externalRef = str("O seu identificador (id do pedido, SKU). Até 100 caracteres.", { maxLength: 100, examples: ["pedido-1001"] });
const idOf = (p, d) => str(d, { pattern: `^${p}_[A-Za-z0-9_-]{16}$`, examples: [`${p}_Xk2v9QeR7tLmN3bA`] });
const amountObj = (d) => ({
  type: "object",
  description: d,
  required: ["value", "currency"],
  properties: { value: int("Valor em centavos.", { examples: [14990] }), currency: str("Moeda.", { enum: ["BRL"] }) },
});

const PAYMENT_STATUSES = ["requires_payment", "processing", "succeeded", "underpaid", "overpaid", "expired", "failed", "canceled", "partially_refunded", "refunded", "disputed"];
const EVENTS = ["payment.succeeded", "payment.expired", "payment.failed", "payment.canceled", "payment.refunded", "payment.disputed", "payment.dispute_won", "payment.dispute_lost"];

const schemas = {
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["type", "message"],
        properties: {
          type: str("Código estável do erro. Veja a página Erros.", { examples: ["invalid_request"] }),
          message: str("Explicação em português. Não compare o texto.", { examples: ["Corpo inválido."] }),
          details: { type: "object", additionalProperties: { type: "array", items: { type: "string" } }, description: "Só em erros de validação: problemas por campo." },
        },
      },
    },
  },
  Payment: {
    type: "object",
    required: ["id", "object", "livemode", "method", "status", "amount", "fee", "created_at"],
    properties: {
      id: idOf("pay", "Id do pagamento."),
      object: str("Sempre `payment`.", { enum: ["payment"] }),
      livemode: { type: "boolean", description: "`true` em produção, `false` no ambiente de teste." },
      method: str("Forma de pagamento.", { enum: ["pix", "card", "boleto"] }),
      status: str(
        "Status. `requires_payment`: aguardando; `processing`: em análise; `succeeded`: pago; `underpaid`/`overpaid`: pago com valor diferente (em análise); `expired`; `failed`; `canceled`; `partially_refunded`; `refunded`; `disputed`: cartão contestado.",
        { enum: PAYMENT_STATUSES },
      ),
      amount: amountObj("Valor cobrado."),
      customer_id: nullable(str("Cliente associado.")),
      external_reference: nullable(str("O seu identificador.")),
      description: nullable(str("Descrição da cobrança.")),
      metadata,
      fee: {
        type: "object",
        description: "Taxa da Valora neste pagamento.",
        properties: { bps: int("Parte percentual em pontos-base (199 = 1,99%)."), fixed: int("Parte fixa, em centavos."), amount: int("Taxa total, em centavos.") },
      },
      refunded_amount: int("Total já devolvido ao pagador, em centavos."),
      dispute: nullable({
        type: "object",
        description: "Contestação (chargeback) do cartão.",
        properties: { status: str("Estado.", { enum: ["open", "won", "lost"] }), opened_at: dateTime("Abertura."), closed_at: nullable(dateTime("Encerramento.")) },
      }),
      items: {
        type: "array",
        description: "Cópia do produto no momento da compra.",
        items: { type: "object", properties: { product_id: str("Produto."), name: str("Nome."), unit_amount: int("Preço unitário em centavos."), quantity: int("Quantidade.") } },
      },
      splits: {
        type: "array",
        description: "Divisão do valor líquido entre negócios do mesmo dono.",
        items: { type: "object", properties: { business_id: str("Negócio."), share_bps: int("Parte em pontos-base."), amount: int("Valor em centavos."), status: str("Estado.", { enum: ["pending", "settled"] }) } },
      },
      expires_at: dateTime("Prazo para pagar."),
      succeeded_at: nullable(dateTime("Quando o pagamento foi confirmado.")),
      created_at: dateTime("Criação."),
      pix: {
        type: "object",
        description: "Só em pagamentos Pix.",
        properties: {
          txid: str("Id da cobrança Pix."),
          e2e_id: nullable(str("Identificador da transação no Banco Central (depois do pagamento).")),
          brcode: str("Código copia e cola."),
          qr_image: nullable(str("QR Code em PNG (data URL).")),
          payer: nullable({ type: "object", description: "Quem pagou (documento mascarado).", properties: { name: nullable(str("Nome.")), document_masked: nullable(str("Documento mascarado.")) } }),
        },
      },
      card: {
        type: "object",
        description: "Só em pagamentos com cartão.",
        properties: { brand: nullable(str("Bandeira.")), last4: nullable(str("Últimos 4 dígitos.")), installments: int("Parcelas (1, 2, 3, 6 ou 12)."), decline_reason: nullable(str("Motivo da recusa informado pelo emissor.")) },
      },
      boleto: {
        type: "object",
        description: "Só em pagamentos por boleto.",
        properties: {
          barcode: nullable(str("Linha digitável.")),
          link: nullable(str("Página do boleto.")),
          pdf: nullable(str("PDF do boleto.")),
          due_date: str("Vencimento (AAAA-MM-DD).", { format: "date" }),
          pix: nullable({ type: "object", description: "Pix embutido.", properties: { brcode: str("Copia e cola."), qr_image: nullable(str("QR Code (data URL).")) } }),
        },
      },
    },
  },
  Refund: {
    type: "object",
    properties: {
      id: idOf("ref", "Id da devolução."),
      object: str("Sempre `refund`.", { enum: ["refund"] }),
      payment_id: str("Pagamento devolvido."),
      amount: int("Valor devolvido, em centavos."),
      status: str("Estado.", { enum: ["pending", "succeeded", "failed"] }),
      reason: nullable(str("Motivo informado.")),
      created_at: dateTime("Criação."),
      payment: ref("Payment"),
    },
  },
  CheckoutSession: {
    type: "object",
    properties: {
      id: idOf("cs", "Id da compra."),
      object: str("Sempre `checkout_session`.", { enum: ["checkout_session"] }),
      status: str("`open`: aguardando; `processing`: em análise; `paid`: pago; `failed`: tentativa falhou; `expired`: venceu.", { enum: ["open", "processing", "paid", "failed", "expired"] }),
      livemode: { type: "boolean", description: "Ambiente da compra." },
      checkout_url: str("Link para mandar ao cliente.", { format: "uri", examples: ["https://pay.valorapayments.com.br/s/cs_Xk2v9QeR7tLmN3bA"] }),
      product_cart: {
        type: "array",
        items: { type: "object", properties: { product_id: str("Produto."), name: str("Nome no momento da compra."), quantity: int("Quantidade."), unit_amount: int("Preço unitário em centavos.") } },
      },
      amount: { type: "object", properties: { subtotal: int("Subtotal em centavos."), total: int("Total em centavos."), currency: str("Moeda.", { enum: ["BRL"] }) } },
      allowed_payment_method_types: { type: "array", items: { type: "string", enum: ["pix", "card", "boleto"] }, description: "Formas aceitas." },
      customer_id: nullable(str("Cliente associado.")),
      payment_id: nullable(str("Pagamento gerado quando o cliente escolhe a forma de pagamento.")),
      method: nullable(str("Forma escolhida pelo cliente.", { enum: ["pix", "card", "boleto"] })),
      success_url: nullable(str("Retorno depois de pagar.")),
      cancel_url: nullable(str("Retorno ao desistir.")),
      external_reference: nullable(str("O seu identificador.")),
      metadata,
      expires_at: dateTime("Prazo da compra."),
      completed_at: nullable(dateTime("Quando foi paga.")),
      created_at: dateTime("Criação."),
    },
  },
  Customer: {
    type: "object",
    properties: {
      id: idOf("cus", "Id do cliente."),
      object: str("Sempre `customer`.", { enum: ["customer"] }),
      name: str("Nome."),
      email: nullable(str("E-mail.")),
      document: nullable(str("CPF ou CNPJ, só dígitos.")),
      phone: nullable(str("Telefone, só dígitos.")),
      external_reference: nullable(str("O seu identificador.")),
      metadata,
      created_at: dateTime("Criação."),
      updated_at: dateTime("Última alteração."),
    },
  },
  Product: {
    type: "object",
    properties: {
      id: idOf("prod", "Id do produto."),
      object: str("Sempre `product`.", { enum: ["product"] }),
      name: str("Nome."),
      description: nullable(str("Descrição.")),
      type: str("Tipo.", { enum: ["physical", "digital", "service"] }),
      status: str("Status.", { enum: ["draft", "active", "archived"] }),
      images: { type: "array", items: { type: "string", format: "uri" }, description: "URLs das imagens." },
      price: { type: "object", properties: { amount: int("Preço em centavos.", { examples: [14990] }), currency: str("Moeda.", { enum: ["BRL"] }) } },
      external_reference: nullable(str("O seu identificador (SKU).")),
      statement_description: nullable(str("Texto que o pagador vê no Pix.")),
      metadata,
      created_at: dateTime("Criação."),
      updated_at: dateTime("Última alteração."),
      archived_at: nullable(dateTime("Quando foi arquivado.")),
    },
  },
  Balance: {
    type: "object",
    properties: {
      object: str("Sempre `balance`.", { enum: ["balance"] }),
      currency: str("Moeda.", { enum: ["BRL"] }),
      available: int("Disponível para saque, em centavos.", { examples: [125430] }),
      pending: int("A liberar (vendas no cartão), em centavos.", { examples: [48000] }),
      updated_at: nullable(dateTime("Última movimentação.")),
    },
  },
  WebhookEndpoint: {
    type: "object",
    properties: {
      id: idOf("we", "Id do endpoint."),
      object: str("Sempre `webhook_endpoint`.", { enum: ["webhook_endpoint"] }),
      url: str("URL que recebe os eventos.", { format: "uri" }),
      description: nullable(str("Descrição.")),
      events: { type: "array", items: { type: "string", enum: [...EVENTS, "*"] }, description: "Eventos assinados. `*` = todos." },
      status: str("Estado.", { enum: ["active", "disabled"] }),
      created_at: dateTime("Criação."),
    },
  },
  WebhookEndpointWithSecret: {
    allOf: [
      ref("WebhookEndpoint"),
      { type: "object", properties: { secret: str("Segredo HMAC (`whsec_...`). Aparece só nesta resposta: guarde.", { examples: ["whsec_..."] }) } },
    ],
  },
  WebhookDelivery: {
    type: "object",
    properties: {
      id: idOf("whd", "Id da entrega."),
      object: str("Sempre `webhook_delivery`.", { enum: ["webhook_delivery"] }),
      endpoint_id: str("Endpoint."),
      event_id: str("Evento entregue."),
      status: str("Estado.", { enum: ["pending", "processing", "delivered", "failed"] }),
      attempts: int("Tentativas feitas."),
      last_status_code: nullable(int("Último status HTTP que o seu servidor respondeu.")),
      last_error: nullable(str("Último erro.")),
      next_attempt_at: nullable(dateTime("Próxima tentativa (só em `pending`).")),
      created_at: dateTime("Criação."),
      delivered_at: nullable(dateTime("Quando foi entregue.")),
    },
  },
  Event: {
    type: "object",
    properties: {
      id: idOf("evt", "Id do evento. Use para ignorar repetidos."),
      object: str("Sempre `event`.", { enum: ["event"] }),
      type: str("Tipo do evento.", { enum: EVENTS }),
      livemode: { type: "boolean", description: "Ambiente." },
      created: dateTime("Criação do evento."),
      data: { type: "object", properties: { object: ref("Payment") } },
    },
  },
};

const list = (item, withCursor = true) => ({
  type: "object",
  properties: {
    object: str("Sempre `list`.", { enum: ["list"] }),
    data: { type: "array", items: ref(item) },
    ...(withCursor ? { has_more: { type: "boolean", description: "Há mais itens depois desta página." }, next_cursor: nullable(str("Passe em `starting_after` para a próxima página.")) } : {}),
  },
});

const err = (description, example) => ({ description, content: { "application/json": { schema: ref("Error"), example: { error: example } } } });
const E = {
  401: err("Chave ausente, inválida ou revogada.", { type: "invalid_api_key", message: "Chave de API inválida ou revogada." }),
  403: err("A chave não tem o escopo da rota, ou a empresa ainda não opera em produção.", { type: "missing_scope", message: "A chave não tem o escopo necessário." }),
  404: err("Não encontrado para este negócio.", { type: "not_found", message: "Não encontrado." }),
  422: err("Dados inválidos. Veja `details`.", { type: "invalid_request", message: "Corpo inválido.", details: { amount: ["Valor inválido."] } }),
  429: err("Limite de requisições. Veja o header `Retry-After`.", { type: "rate_limited", message: "Muitas requisições. Tente novamente em instantes." }),
  503: err("Indisponibilidade temporária.", { type: "service_unavailable", message: "Serviço temporariamente indisponível." }),
};
const ok = (status, description, schema) => ({ [status]: { description, content: { "application/json": { schema } } } });
const common = (...codes) => Object.fromEntries(codes.map((c) => [c, E[c]]));
const json = (schema, example) => ({ required: true, content: { "application/json": { schema, ...(example ? { examples: { exemplo: { summary: "Exemplo", value: example } } } : {}) } } });
const pathParam = (name, p, d) => ({ name, in: "path", required: true, description: d, schema: { type: "string", pattern: `^${p}_[A-Za-z0-9_-]{16}$` } });
const query = (name, description, schema = { type: "string" }) => ({ name, in: "query", required: false, description, schema });
const pageParams = [
  query("limit", "Itens por página, de 1 a 100.", { type: "integer", minimum: 1, maximum: 100, default: 20 }),
  query("starting_after", "O `next_cursor` da página anterior."),
];
const op = (operationId, summary, description, scope, rest) => ({
  operationId,
  summary,
  description: `${description}\n\nEscopo: \`${scope}\`.`,
  security: [{ bearerAuth: [] }],
  ...rest,
});

const paths = {
  "/v1/payments": {
    post: op("criarPagamento", "Criar um pagamento Pix", "Cria uma cobrança Pix e devolve o QR Code e o código copia e cola. Envie `amount` **ou** `product_id` (um dos dois). A confirmação chega pelo webhook `payment.succeeded`.", "payments:write", {
      parameters: [{ name: "Idempotency-Key", in: "header", required: false, description: "Chave única da operação (até 200 caracteres). Repetir com o mesmo corpo devolve o pagamento já criado.", schema: { type: "string", maxLength: 200 } }],
      requestBody: json(
        {
          type: "object",
          required: ["method"],
          additionalProperties: false,
          properties: {
            method: str("Forma de pagamento. Pela API, só `pix`.", { enum: ["pix"] }),
            amount: money("Valor da cobrança. Obrigatório sem `product_id`."),
            product_id: idOf("prod", "Produto do catálogo. O valor passa a ser preço × `quantity`."),
            quantity: int("Quantidade do produto.", { minimum: 1, maximum: 10000, default: 1 }),
            currency: str("Moeda.", { enum: ["BRL"], default: "BRL" }),
            customer_id: idOf("cus", "Cliente associado."),
            external_reference: externalRef,
            description: str("Descrição da cobrança (até 200 caracteres).", { maxLength: 200 }),
            metadata,
            expires_in: int("Validade do Pix em segundos.", { minimum: 60, maximum: 86400, default: 3600 }),
            splits: {
              type: "array",
              minItems: 1,
              maxItems: 5,
              description: "Divide o valor líquido entre negócios do mesmo dono. A soma de `share_bps` deve ser 10000.",
              items: { type: "object", required: ["business_id", "share_bps"], properties: { business_id: str("Negócio que recebe a parte."), share_bps: int("Parte em pontos-base.", { minimum: 1, maximum: 10000 }) } },
            },
          },
        },
        { method: "pix", amount: "149.90", description: "Pedido 1001", external_reference: "pedido-1001", expires_in: 1800 },
      ),
      responses: {
        ...ok(201, "Pagamento criado.", ref("Payment")),
        200: { description: "Repetição com a mesma `Idempotency-Key` e o mesmo corpo: o pagamento já criado (header `Idempotent-Replayed: true`).", content: { "application/json": { schema: ref("Payment") } } },
        400: err("`Idempotency-Key` inválida ou JSON malformado.", { type: "invalid_idempotency_key", message: "Idempotency-Key deve ter até 200 caracteres." }),
        ...common(401, 403),
        409: err("Mesma `Idempotency-Key` com corpo diferente.", { type: "idempotency_conflict", message: "Idempotency-Key já usada com outro corpo." }),
        422: E[422],
        429: E[429],
        502: err("Falha no provedor de pagamento. Repita com a mesma `Idempotency-Key`.", { type: "provider_error", message: "Falha ao criar a cobrança. Tente novamente." }),
      },
    }),
    get: op("listarPagamentos", "Listar pagamentos", "Lista os pagamentos do negócio, do mais novo para o mais antigo.", "payments:read", {
      parameters: [
        ...pageParams,
        query("status", "Filtra por status.", { type: "string", enum: PAYMENT_STATUSES }),
        query("method", "Filtra por forma de pagamento.", { type: "string", enum: ["pix", "card", "boleto"] }),
        query("customer_id", "Filtra por cliente."),
        query("external_reference", "Filtra pelo seu identificador."),
      ],
      responses: { ...ok(200, "Página de pagamentos.", list("Payment")), ...common(401, 403, 422, 429, 503) },
    }),
  },
  "/v1/payments/{payment_id}": {
    get: op("consultarPagamento", "Consultar um pagamento", "Devolve um pagamento com o status atual.", "payments:read", {
      parameters: [pathParam("payment_id", "pay", "Id do pagamento.")],
      responses: { ...ok(200, "O pagamento.", ref("Payment")), ...common(401, 403, 404, 429) },
    }),
  },
  "/v1/payments/{payment_id}/cancel": {
    post: op("cancelarPagamento", "Cancelar um pagamento", "Cancela um Pix que ainda está aguardando pagamento (`requires_payment`). O QR Code deixa de valer e o evento `payment.canceled` é enviado.", "payments:write", {
      parameters: [pathParam("payment_id", "pay", "Id do pagamento.")],
      responses: {
        ...ok(200, "Pagamento cancelado.", ref("Payment")),
        ...common(401, 403, 404),
        409: err("O pagamento não pode mais ser cancelado.", { type: "not_cancelable", message: "Só pagamentos aguardando pagamento podem ser cancelados." }),
        429: E[429],
        502: err("O provedor não confirmou o cancelamento.", { type: "provider_error", message: "Não foi possível cancelar a cobrança." }),
      },
    }),
  },
  "/v1/payments/{payment_id}/simulate": {
    post: op("simularPagamento", "Simular um pagamento (Sandbox)", "**Só com chave Sandbox.** Paga ou vence uma cobrança de teste de Pix ou boleto, sem a Efí, pelo mesmo caminho da confirmação real: o status muda, o saldo de teste é atualizado e o webhook (`payment.succeeded` ou `payment.expired`) é enviado. O pagamento precisa estar em `requires_payment`. Cartão não é simulado: use os cartões de teste no checkout. Um Pix pago assim pode ser devolvido normalmente.", "payments:write", {
      parameters: [pathParam("payment_id", "pay", "Id do pagamento de teste.")],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: false, properties: { outcome: str("O que simular. `succeeded`: pago; `expired`: vencido sem pagamento.", { enum: ["succeeded", "expired"], default: "succeeded" }) } },
            examples: { pago: { summary: "Pago", value: { outcome: "succeeded" } }, vencido: { summary: "Vencido", value: { outcome: "expired" } } },
          },
        },
      },
      responses: {
        ...ok(200, "Pagamento atualizado.", ref("Payment")),
        ...common(401),
        403: err("Chave de produção ou pagamento de produção.", { type: "livemode_not_allowed", message: "A simulação só funciona com chave Sandbox." }),
        ...common(404),
        409: err("O pagamento não está aguardando pagamento, ou é de cartão.", { type: "not_simulatable", message: "Só pagamentos aguardando pagamento podem ser simulados (status atual: succeeded)." }),
        ...common(422, 429),
      },
    }),
  },
  "/v1/payments/{payment_id}/refund": {
    post: op("devolverPagamento", "Devolver um pagamento", "Devolve todo ou parte de um Pix aprovado **ao pagador**. Sem `amount`, devolve tudo o que resta. O valor sai do saldo disponível. Cartão e boleto são devolvidos pelo suporte.", "payments:write", {
      parameters: [pathParam("payment_id", "pay", "Id do pagamento.")],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: false, properties: { amount: money("Valor a devolver. Omitido = tudo o que resta."), reason: str("Motivo (até 200 caracteres).", { maxLength: 200 }) } },
            example: { amount: "20.00", reason: "Item fora de estoque" },
          },
        },
      },
      responses: {
        ...ok(201, "Devolução criada, com o pagamento atualizado.", ref("Refund")),
        202: err("A devolução está em andamento. O evento `payment.refunded` chega quando concluir.", { type: "provider_pending", message: "Não foi possível confirmar a devolução agora. O valor está reservado e será conferido automaticamente." }),
        ...common(401, 403, 404),
        409: err("Pagamento não devolvível pela API ou saldo insuficiente.", { type: "not_refundable", message: "Só pagamentos Pix aprovados podem ser devolvidos." }),
        422: err("Valor inválido.", { type: "invalid_amount", message: "Valor acima do que resta para devolver." }),
        429: E[429],
        502: err("Falha no provedor.", { type: "provider_error", message: "Falha ao devolver." }),
      },
    }),
  },
  "/v1/checkouts": {
    post: op("criarCheckout", "Criar um checkout", "Cria uma compra e devolve o `checkout_url`, o link que você manda ao cliente. O cliente escolhe Pix, cartão ou boleto na página da Valora. O preço vem do produto e fica travado na criação.", "checkouts:write", {
      requestBody: json(
        {
          type: "object",
          required: ["product_cart"],
          additionalProperties: false,
          properties: {
            product_cart: {
              type: "array",
              minItems: 1,
              maxItems: 1,
              description: "Exatamente 1 item.",
              items: { type: "object", required: ["product_id"], additionalProperties: false, properties: { product_id: idOf("prod", "Produto ativo do negócio."), quantity: int("Quantidade.", { minimum: 1, maximum: 100, default: 1 }) } },
            },
            customer: {
              description: "Cliente salvo (`customer_id`) **ou** dados para preencher o formulário.",
              oneOf: [
                { title: "Cliente salvo", type: "object", required: ["customer_id"], additionalProperties: false, properties: { customer_id: idOf("cus", "Cliente do negócio.") } },
                {
                  title: "Dados do cliente",
                  type: "object",
                  additionalProperties: false,
                  properties: { name: str("Nome (até 120).", { maxLength: 120 }), email: str("E-mail.", { format: "email" }), phone: str("Celular com DDD, só dígitos (10 ou 11).", { pattern: "^\\d{10,11}$" }) },
                },
              ],
            },
            allowed_payment_method_types: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", enum: ["pix", "card", "boleto"] }, description: "Formas aceitas. Padrão: todas." },
            success_url: str("Para onde o cliente volta depois de pagar (HTTPS).", { format: "uri" }),
            cancel_url: str("Para onde o cliente volta ao desistir (HTTPS).", { format: "uri" }),
            expires_in: int("Validade do link em segundos.", { minimum: 300, maximum: 86400, default: 86400 }),
            external_reference: externalRef,
            metadata,
          },
        },
        {
          product_cart: [{ product_id: "prod_Ab12Cd34Ef56Gh78", quantity: 1 }],
          customer: { name: "Ana Souza", email: "ana@example.com" },
          allowed_payment_method_types: ["pix", "card"],
          success_url: "https://sualoja.com/pedido/1001/obrigado",
          cancel_url: "https://sualoja.com/carrinho",
          external_reference: "pedido-1001",
        },
      ),
      responses: {
        ...ok(201, "Compra criada.", ref("CheckoutSession")),
        ...common(401, 403),
        404: err("Produto ou cliente não encontrado.", { type: "product_not_found", message: "Produto não encontrado." }),
        409: err("Produto não está ativo.", { type: "product_inactive", message: "O produto não está ativo." }),
        ...common(422, 429, 503),
      },
    }),
  },
  "/v1/checkouts/{session_id}": {
    get: op("consultarCheckout", "Consultar um checkout", "Devolve a compra com o status atual. A confirmação do pagamento continua chegando pelo webhook.", "checkouts:read", {
      parameters: [pathParam("session_id", "cs", "Id da compra.")],
      responses: { ...ok(200, "A compra.", ref("CheckoutSession")), ...common(401, 403, 404, 429) },
    }),
  },
  "/v1/customers": {
    post: op("criarCliente", "Criar um cliente", "Salva um cliente para reutilizar em cobranças e checkouts.", "customers:write", {
      requestBody: json(
        {
          type: "object",
          required: ["name"],
          properties: {
            name: str("Nome (até 120).", { maxLength: 120 }),
            email: str("E-mail. Único por negócio.", { format: "email" }),
            document: str("CPF (11) ou CNPJ (14 dígitos), só números.", { pattern: "^(\\d{11}|\\d{14})$" }),
            phone: str("Telefone, só dígitos (8 a 15), `+` opcional.", { pattern: "^\\+?\\d{8,15}$" }),
            external_reference: externalRef,
            metadata,
          },
        },
        { name: "Ana Souza", email: "ana@example.com", document: "12345678909", phone: "11988887777", external_reference: "usuario-42" },
      ),
      responses: {
        ...ok(201, "Cliente criado.", ref("Customer")),
        ...common(401, 403),
        409: err("Já existe cliente com este e-mail.", { type: "email_in_use", message: "Já existe um cliente com este e-mail." }),
        ...common(422, 429, 503),
      },
    }),
    get: op("listarClientes", "Listar clientes", "Lista os clientes do negócio, do mais novo para o mais antigo.", "customers:read", {
      parameters: [...pageParams, query("email", "Filtra pelo e-mail."), query("external_reference", "Filtra pelo seu identificador.")],
      responses: { ...ok(200, "Página de clientes.", list("Customer")), ...common(401, 403, 422, 429, 503) },
    }),
  },
  "/v1/customers/{customer_id}": {
    get: op("consultarCliente", "Consultar um cliente", "Devolve um cliente.", "customers:read", {
      parameters: [pathParam("customer_id", "cus", "Id do cliente.")],
      responses: { ...ok(200, "O cliente.", ref("Customer")), ...common(401, 403, 404, 429) },
    }),
    patch: op("atualizarCliente", "Atualizar um cliente", "Atualiza só os campos enviados. `null` limpa um campo opcional.", "customers:write", {
      parameters: [pathParam("customer_id", "cus", "Id do cliente.")],
      requestBody: json(
        {
          type: "object",
          additionalProperties: false,
          properties: {
            name: str("Nome.", { maxLength: 120 }),
            email: nullable(str("E-mail.", { format: "email" })),
            document: nullable(str("CPF ou CNPJ, só dígitos.", { pattern: "^(\\d{11}|\\d{14})$" })),
            phone: nullable(str("Telefone, só dígitos.", { pattern: "^\\+?\\d{8,15}$" })),
            external_reference: nullable(str("O seu identificador.", { maxLength: 100 })),
            metadata,
          },
        },
        { phone: "11977776666" },
      ),
      responses: { ...ok(200, "Cliente atualizado.", ref("Customer")), ...common(401, 403, 404, 422, 429) },
    }),
  },
  "/v1/products": {
    post: op("criarProduto", "Criar um produto", "Cadastra um produto. O preço do produto é a base de checkouts e de cobranças com `product_id`.", "products:write", {
      requestBody: json(
        {
          type: "object",
          required: ["name", "price"],
          additionalProperties: false,
          properties: {
            name: str("Nome (até 120).", { maxLength: 120 }),
            description: str("Descrição (até 2000).", { maxLength: 2000 }),
            type: str("Tipo.", { enum: ["physical", "digital", "service"], default: "physical" }),
            status: str("Status.", { enum: ["draft", "active", "archived"], default: "active" }),
            images: { type: "array", maxItems: 8, items: { type: "string", format: "uri" }, description: "Até 8 URLs HTTPS." },
            price: money("Preço."),
            external_reference: str("O seu identificador (SKU). Único por negócio.", { maxLength: 100 }),
            statement_description: str("Texto que o pagador vê no Pix (até 140).", { maxLength: 140 }),
            metadata,
          },
        },
        { name: "Mentoria individual", description: "Uma hora de mentoria por videochamada.", type: "service", price: "149.90", external_reference: "sku-mentoria-1h" },
      ),
      responses: {
        ...ok(201, "Produto criado.", ref("Product")),
        ...common(401, 403),
        409: err("Já existe produto com este `external_reference`.", { type: "external_reference_in_use", message: "external_reference já usado." }),
        ...common(422, 429, 503),
      },
    }),
    get: op("listarProdutos", "Listar produtos", "Lista os produtos do negócio.", "products:read", {
      parameters: [
        ...pageParams,
        query("status", "Filtra por status.", { type: "string", enum: ["draft", "active", "archived"] }),
        query("type", "Filtra por tipo.", { type: "string", enum: ["physical", "digital", "service"] }),
        query("external_reference", "Filtra pelo seu identificador."),
      ],
      responses: { ...ok(200, "Página de produtos.", list("Product")), ...common(401, 403, 422, 429, 503) },
    }),
  },
  "/v1/products/{product_id}": {
    get: op("consultarProduto", "Consultar um produto", "Devolve um produto.", "products:read", {
      parameters: [pathParam("product_id", "prod", "Id do produto.")],
      responses: { ...ok(200, "O produto.", ref("Product")), ...common(401, 403, 404, 429) },
    }),
    patch: op("atualizarProduto", "Atualizar um produto", "Atualiza só os campos enviados. `null` limpa um campo opcional. Mudar o preço vale para as próximas compras; pagamentos já criados não mudam.", "products:write", {
      parameters: [pathParam("product_id", "prod", "Id do produto.")],
      requestBody: json(
        {
          type: "object",
          additionalProperties: false,
          properties: {
            name: str("Nome.", { maxLength: 120 }),
            description: nullable(str("Descrição.", { maxLength: 2000 })),
            type: str("Tipo.", { enum: ["physical", "digital", "service"] }),
            status: str("Status.", { enum: ["draft", "active", "archived"] }),
            images: { type: "array", maxItems: 8, items: { type: "string", format: "uri" } },
            price: money("Novo preço."),
            external_reference: nullable(str("O seu identificador.", { maxLength: 100 })),
            statement_description: nullable(str("Texto no Pix.", { maxLength: 140 })),
            metadata,
          },
        },
        { price: "169.90" },
      ),
      responses: { ...ok(200, "Produto atualizado.", ref("Product")), ...common(401, 403, 404, 422, 429) },
    }),
  },
  "/v1/balance": {
    get: op("consultarSaldo", "Consultar o saldo", "Saldo do negócio, em centavos. Chave de teste mostra o saldo de teste. Não existe rota que tire dinheiro do saldo: saques são feitos pelo painel.", "balance:read", {
      responses: { ...ok(200, "O saldo.", ref("Balance")), ...common(401, 403, 429, 503) },
    }),
  },
  "/v1/webhooks": {
    post: op("criarWebhook", "Criar um endpoint de webhook", "Cadastra uma URL para receber eventos. O `secret` aparece **só nesta resposta**. Limite: 10 endpoints ativos.", "webhooks:write", {
      requestBody: json(
        {
          type: "object",
          required: ["url"],
          properties: {
            url: str("URL HTTPS pública.", { format: "uri", maxLength: 2048 }),
            events: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", enum: [...EVENTS, "*"] }, default: ["*"], description: "Eventos assinados. Padrão: todos." },
            description: str("Descrição (até 200).", { maxLength: 200 }),
          },
        },
        { url: "https://sualoja.com/webhooks/valora", events: ["payment.succeeded", "payment.failed"], description: "Loja principal" },
      ),
      responses: {
        ...ok(201, "Endpoint criado, com o segredo.", ref("WebhookEndpointWithSecret")),
        ...common(401, 403),
        409: err("Limite de endpoints atingido.", { type: "limit_reached", message: "Limite de 10 endpoints atingido." }),
        422: err("Corpo inválido ou URL recusada.", { type: "invalid_url", message: "A URL deve usar https." }),
        ...common(429, 503),
      },
    }),
    get: op("listarWebhooks", "Listar endpoints de webhook", "Lista os endpoints ativos.", "webhooks:read", {
      responses: { ...ok(200, "Endpoints.", list("WebhookEndpoint", false)), ...common(401, 403, 429, 503) },
    }),
  },
  "/v1/webhooks/{endpoint_id}": {
    get: op("consultarWebhook", "Consultar um endpoint de webhook", "Devolve um endpoint ativo. O segredo nunca aparece aqui.", "webhooks:read", {
      parameters: [pathParam("endpoint_id", "we", "Id do endpoint.")],
      responses: { ...ok(200, "O endpoint.", ref("WebhookEndpoint")), ...common(401, 403, 404, 429) },
    }),
    delete: op("removerWebhook", "Remover um endpoint de webhook", "Desativa o endpoint. Entregas pendentes deixam de ser tentadas; o histórico continua visível.", "webhooks:write", {
      parameters: [pathParam("endpoint_id", "we", "Id do endpoint.")],
      responses: {
        ...ok(200, "Endpoint removido.", { type: "object", properties: { id: str("Id."), object: str("`webhook_endpoint`."), deleted: { type: "boolean" } } }),
        ...common(401, 403, 404, 429),
      },
    }),
  },
  "/v1/webhooks/{endpoint_id}/rotate_secret": {
    post: op("rotacionarSegredoWebhook", "Rotacionar o segredo", "Gera um novo segredo. O antigo para de valer na hora. O novo aparece **só nesta resposta**.", "webhooks:write", {
      parameters: [pathParam("endpoint_id", "we", "Id do endpoint.")],
      responses: { ...ok(200, "Endpoint com o novo segredo.", ref("WebhookEndpointWithSecret")), ...common(401, 403, 404, 429) },
    }),
  },
  "/v1/webhooks/{endpoint_id}/deliveries": {
    get: op("listarEntregas", "Listar entregas", "Lista o que foi enviado ao endpoint e o resultado de cada entrega. Inclui endpoints removidos.", "webhooks:read", {
      parameters: [pathParam("endpoint_id", "we", "Id do endpoint."), ...pageParams, query("status", "Filtra por estado.", { type: "string", enum: ["pending", "processing", "delivered", "failed"] })],
      responses: { ...ok(200, "Página de entregas.", list("WebhookDelivery")), ...common(401, 403, 404, 422, 429) },
    }),
  },
  "/v1/webhooks/{endpoint_id}/deliveries/{delivery_id}/resend": {
    post: op("reenviarEntrega", "Reenviar uma entrega", "Coloca a entrega de novo na fila, com o mesmo evento. Serve para entregas que falharam ou para reprocessar uma já entregue.", "webhooks:write", {
      parameters: [pathParam("endpoint_id", "we", "Id do endpoint."), pathParam("delivery_id", "whd", "Id da entrega.")],
      responses: {
        202: { description: "Entrega na fila.", content: { "application/json": { schema: ref("WebhookDelivery") } } },
        ...common(401, 403, 404),
        409: err("A entrega já está na fila ou em andamento.", { type: "not_resendable", message: "A entrega já está na fila ou em andamento." }),
        429: E[429],
      },
    }),
  },
};

const webhooks = Object.fromEntries(
  EVENTS.map((type) => [
    type,
    {
      post: {
        summary: type,
        description: "Enviado para os endpoints inscritos. Verifique `X-Valora-Signature` antes de agir.",
        parameters: [
          { name: "X-Valora-Event", in: "header", required: true, schema: { type: "string", enum: [type] }, description: "Tipo do evento." },
          { name: "X-Valora-Delivery", in: "header", required: true, schema: { type: "string" }, description: "Id da entrega (`whd_...`)." },
          { name: "X-Valora-Signature", in: "header", required: true, schema: { type: "string" }, description: "`t=<unix>,v1=<hmac_sha256_hex(segredo, \"<t>.<corpo cru>\")>`." },
        ],
        requestBody: { required: true, content: { "application/json": { schema: ref("Event") } } },
        responses: { 200: { description: "Responda 2xx em até 10 segundos." } },
      },
    },
  ]),
);

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Valora Payments API",
    version: "1.0.0",
    description: "API REST da Valora Payments. Valores na entrada em reais (texto, ex.: \"149.90\"); nas respostas, em centavos inteiros.",
  },
  servers: [{ url: "https://api.valorapayments.com.br", description: "Teste e produção (o ambiente vem da chave)" }],
  security: [{ bearerAuth: [] }],
  tags: [{ name: "Pagamentos" }, { name: "Checkouts" }, { name: "Clientes" }, { name: "Produtos" }, { name: "Saldo" }, { name: "Webhooks" }],
  paths,
  webhooks,
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Chave de API `sk_vl_...` criada no painel em Desenvolvedores → Chaves de API." } },
    schemas,
  },
};

// Tag por recurso (o primeiro segmento depois de /v1).
const TAG = { payments: "Pagamentos", checkouts: "Checkouts", customers: "Clientes", products: "Produtos", balance: "Saldo", webhooks: "Webhooks" };
for (const [path, ops] of Object.entries(paths)) for (const o of Object.values(ops)) o.tags = [TAG[path.split("/")[2]]];

writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");
console.log("ok", Object.keys(paths).length, "paths");
