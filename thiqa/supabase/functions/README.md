# Edge Functions (Deno)

Arrivent dans les phases suivantes :

| Fonction           | Phase | Rôle                                                                       |
| ------------------ | ----- | -------------------------------------------------------------------------- |
| `dispatch`         | 1     | Filtre + score des techniciens, offre de 20 min, verrou optimiste          |
| `notify`           | 1     | Vide la file `notifications` (Resend, WhatsApp Cloud API, fallback Twilio) |
| `payments-webhook` | 1     | Webhooks CMI / Stripe idempotents → `deposit_paid` / `balance_paid`        |
| `generate-report`  | 3     | Pipeline IA (vision, reformulation, synthèse)                              |
| `render-pdf`       | 3     | `@react-pdf/renderer` → bucket `reports`, URL signée 7 jours               |
| `partner-api`      | 4     | API Smart BNB `/api/v1/orders` + webhooks sortants                         |

Toute transition de commande passe par `@thiqa/core` (`transition()`), puis
`set_config('thiqa.event', <event>, true)` + `update orders set status = …`
dans la même transaction : la base refuse toute transition non déclarée.
