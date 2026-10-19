# Nodos HTTP Request listos para tu flujo de Chatwoot + WhatsApp

Cada bloque es un nodo **HTTP Request** de n8n. Solo copia el JSON, pégalo en
"Edit Expression" / "Parameters > Body" o usa el importador de nodos.

**Antes de nada**, en cada nodo HTTP Request añade el header:

```
Authorization: Bearer <64-hex>
Content-Type: application/json
```

Y en **Parameters → URL** usa `http://127.0.0.1:3334` (misma máquina) o
`https://oficina.tudominio.com` (producción).

---

## 1. Nace el agente principal

**Nodo:** HTTP Request — Method `POST` — URL `{{ $env.OFFICE_URL }}/api/n8n/agent`

**Body (JSON):**

```json
{
  "id": "chatwoot-receiver",
  "name": "Chatwoot Receiver",
  "role": "soporte",
  "task": "Atendiendo a {{ $('Edit Fields').item.json.user_name }}"
}
```

**Dónde:** después del nodo `IF Solo Incoming` (rama *true*).

---

## 2. Ramas del clasificador — un sub-agente por rama

### Rama "procesos"

**URL:** `{{ $env.OFFICE_URL }}/api/n8n/agent`

```json
{
  "id": "consultor-procesos",
  "name": "Ing. Procesos",
  "role": "procesos",
  "task": "Consultando el proceso para: {{ $json.message }}",
  "parentId": "chatwoot-receiver"
}
```

### Rama "productos"

```json
{
  "id": "consultor-productos",
  "name": "Ejecutivo Comercial",
  "role": "comercial",
  "task": "Cotizando: {{ $json.message }}",
  "parentId": "chatwoot-receiver"
}
```

### Rama "otro"

```json
{
  "id": "atencion-general",
  "name": "Atención General",
  "role": "atencion-al cliente",
  "task": "Consulta general: {{ $json.message }}",
  "parentId": "chatwoot-receiver"
}
```

**Dónde:** en cada rama del `Text Classifier`, antes del `AI Agent`.

---

## 3. El agente está trabajando

**URL:** `{{ $env.OFFICE_URL }}/api/n8n/working`

```json
{
  "id": "chatwoot-receiver",
  "status": "Leyendo base de conocimiento",
  "tool": "Read"
}
```

**Dónde:** justo antes del nodo `AI Agent`.

> `tool` decide la animación: `Read` / `Grep` / `Glob` → **lee**;
> cualquier otro (`Write`, `Edit`, `Bash`) → **teclea**.

---

## 4. El agente terminó su turno

**URL:** `{{ $env.OFFICE_URL }}/api/n8n/complete`

```json
{
  "id": "chatwoot-receiver",
  "result": "Respuesta enviada por WhatsApp"
}
```

**Dónde:** después del nodo `HTTP Request Chat` (el que manda el mensaje a
Chatwoot).

---

## 5. Los sub-agentes también se cierran

En cada rama, al final, añade un `HTTP Request` a
`{{ $env.OFFICE_URL }}/api/n8n/complete`:

```json
{ "id": "consultor-productos", "result": "Cotización preparada" }
```

---

## 6. Señal de éxito (opcional)

**URL:** `{{ $env.OFFICE_URL }}/api/n8n/signal`

```json
{
  "id": "chatwoot-receiver",
  "kind": "deploy_success",
  "detail": "WhatsApp enviado a {{ $('Edit Fields').item.json.user_name }}"
}
```

Kinds disponibles: `deploy_start`, `deploy_success`, `deploy_fail`,
`build_start`, `build_ok`, `build_failed`, `test_failed`, `push`.

---

## 7. Limpieza (opcional)

Cuando el flujo termina del todo, borra a los agentes para que no se acumulen:

**URL:** `{{ $env.OFFICE_URL }}/api/n8n/complete` (o `DELETE` si existe el agente)

```json
{ "id": "consultor-procesos", "result": "Fin de turno" }
```

---

## Variable de entorno en n8n

Settings → Variables →添加:

| Nombre | Valor |
|---|---|
| `OFFICE_URL` | `http://127.0.0.1:3334` |
| `OFFICE_TOKEN` | el mismo valor que `AGENT_OFFICE_API_TOKEN` |

Y en cada nodo HTTP Request, header `Authorization`:
`=Bearer {{ $env.OFFICE_TOKEN }}`

---

## Cómo se ve

```
                    ┌─────────────────────────┐
                    │  POLYRAFIA — AGENT OFFICE│
                    ├─────────────────────────┤
                    │                         │
                    │   👑 Boss               │
                    │      ↑                  │
                    │   ┌──┴───┐              │
                    │   │      │              │
                    │  Chatwoot Receiver ↳    │
                    │   │      │              │
                    │   │   ┌──┴──┐           │
                    │   │   │     │           │
                    │  Ing.   Ejecutivo      │
                    │  Procesos Comercial    │
                    │                         │
                    └─────────────────────────┘
```

Cada rama del `Text Classifier` es un personaje con su propio sprite, y la
flecha `↳` marca que trabaja bajo el receptor.
