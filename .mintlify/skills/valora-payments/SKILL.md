---
name: valora-payments
description: Integrate Valora Payments (Brazilian Pix, card and boleto payments) into an application. Use when creating checkouts, Pix charges, customers or products through the Valora API, when handling Valora webhooks (X-Valora-Signature), or when reviewing payment code that calls api.valorapayments.com.br.
---

# Valora Payments

Valora Payments is a Brazilian payments API: Pix, credit card (up to 12 installments) and boleto with embedded Pix, a hosted checkout, and signed webhooks. Documentation (Portuguese): https://docs.valorapayments.com.br. Append `.md` to any page URL for Markdown; the index is `/llms.txt` and the OpenAPI spec is `/openapi.json`.

## Before writing code

Read the page for the task first. Do not invent endpoints, fields or events.

- Hosted checkout: https://docs.valorapayments.com.br/recursos/checkouts.md
- Pix: https://docs.valorapayments.com.br/recursos/pix.md
- Webhooks: https://docs.valorapayments.com.br/integrar/webhooks.md
- Events: https://docs.valorapayments.com.br/integrar/eventos.md
- Errors: https://docs.valorapayments.com.br/api-reference/erros.md
- Framework tutorials (Next.js, Express, Laravel, FastAPI): https://docs.valorapayments.com.br/frameworks/visao-geral.md

## API basics

- Base URL: `https://api.valorapayments.com.br`, all routes under `/v1`, JSON.
- Auth: `Authorization: Bearer sk_vl_...` (48 hex chars after the prefix). The key decides the environment (Sandbox or Production); `livemode` on every object shows which.
- Keys and the webhook secret live only on the server, in environment variables (`VALORA_API_KEY`, `VALORA_WEBHOOK_SECRET`). Never in client bundles, logs or the repository. Never ask the user to paste them into chat.
- Money in requests: reais as a string with up to 2 decimals (`"149.90"`). Money in responses and webhooks: integer cents (`14990`). Never use floats for money. Compute amounts on the server, never from the browser.
- Errors: `{ "error": { "type", "message", "details" } }`. Branch on `type`. Retry 5xx and network errors with the same `Idempotency-Key`; fix the request on 4xx.
- Lists: cursor pagination with `limit` (1-100) and `starting_after` = previous `next_cursor`, while `has_more`.

## Choosing the flow

- Sell a product with Pix, card and boleto: `POST /v1/checkouts` with `product_cart: [{ product_id, quantity }]`, `external_reference` (your order id), optional `customer`, `success_url`, `cancel_url`. Redirect the buyer to `checkout_url`.
- Pix rendered in your own UI: `POST /v1/payments` with `{ "method": "pix", "amount": "149.90", "external_reference": "..." }` and an `Idempotency-Key` header stable per order. Show `pix.qr_image` (PNG data URL) and `pix.brcode` (copy and paste).
- Card and boleto charges cannot be created directly through the API; use the hosted checkout.
- Withdrawals do not exist in the API.

## Confirming payment (webhooks)

- The order is paid only when a `payment.succeeded` webhook with a valid signature arrives. Returning to `success_url` proves nothing.
- Verify `X-Valora-Signature: t=<unix>,v1=<hex>`: `v1` is the hex HMAC-SHA256 of `"<t>.<raw body>"` using the endpoint secret. Use the raw request body, compare in constant time, reject `t` older than 5 minutes.
- Deduplicate by `event.id` (`evt_...`); events can repeat and arrive out of order.
- Each endpoint receives both test and live events: check `event.livemode`.
- The full payment is in `event.data.object`; the order is `event.data.object.external_reference`.
- Respond 2xx within 10 seconds; queue slow work.
- Events: `payment.succeeded`, `payment.failed`, `payment.expired`, `payment.canceled`, `payment.refunded`, `payment.disputed`, `payment.dispute_won`, `payment.dispute_lost`.

## Review checklist

1. No key or webhook secret in client code, `NEXT_PUBLIC_`/`VITE_` variables, logs or git.
2. Webhook verifies the signature with the raw body, in constant time, with the timestamp check.
3. Events deduplicated by `event.id`; live orders only released with `livemode: true`.
4. Orders released only by `payment.succeeded`.
5. Amounts sent in reais as strings, read in cents as integers.
6. `POST /v1/payments` always sends a stable `Idempotency-Key`.
