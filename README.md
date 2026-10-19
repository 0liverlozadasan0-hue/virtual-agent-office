# Virtual Agent Office — n8n (Claude Office)

Oficina virtual isométrica donde los agentes de tu flujo n8n aparecen como
personajes pixel art trabajando en tiempo real.

**Motor:** [W17ant/Claude-Office](https://github.com/W17ant/Claude-Office) (MIT) —
el mismo renderizador, sprites, ciclo día/noche, chat, task board y efectos que
usa Claude Code, con la integración de Claude Code sustituida por una API de
n8n.

---

## Arranque rápido

```bash
npm install
npm run build          # compila el frontend
npm run token          # genera un token de 64 hex (cópialo)
AGENT_OFFICE_API_TOKEN=<el-token> node server/index.js
```

Abre **http://127.0.0.1:3334/#token=<el-token>**

> **El token debe ser 64 caracteres hexadecimales.** Es lo que espera el
> chequeo del fragmento `#token=` del navegador: con otro formato, la página
> se ve pero se queda en **solo-lectura** (abajo lo indica la barra de
> estado). `npm run token` genera uno con el formato correcto.
> `node server/token.js --check <token>` te dice si vale.

---

## API para n8n

Todas las rutas exigen `Authorization: Bearer <AGENT_OFFICE_API_TOKEN>`.

### Nace un agente

```http
POST /api/n8n/agent
{
  "id": "chatwoot-receiver",        // tu id — es el id del personaje
  "name": "Chatwoot Receiver",
  "role": "soporte",                // elige el sprite (ver tabla abajo)
  "task": "Respondiendo a Juan",   // lo que muestra la tarjeta
  "parentId": null                  // opcional → sub-agente
}
```

→ El personaje entra por la puerta, busca escritorio y se sienta.

### Un nodo está trabajando

```http
POST /api/n8n/working
{ "id": "chatwoot-receiver", "status": "Leyendo contexto", "tool": "Read" }
```

→ El personaje se sienta y teclea (o lee, si el tool es de lectura).

### Un nodo terminó

```http
POST /api/n8n/complete
{ "id": "chatwoot-receiver", "result": "Respuesta enviada" }
```

→ El personaje se levanta, camina a la puerta y desaparece.

### Señales (la oficina reacciona)

```http
POST /api/n8n/signal
{ "id": "chatwoot-receiver", "kind": "deploy_success", "detail": "WhatsApp enviado" }
```

→ 🚀 en el chat. Otros `kind`: `deploy_start`, `deploy_fail`, `build_ok`,
`test_failed`, `push`.

### Consultar

```http
GET /api/n8n/agents    → los agentes en la oficina
GET /api/n8n/health    → estado del puente
```

---

## Roles de Polyrafia (src/config.ts → ROLE_TO_CHAR)

| `role` | Sprite | Uso |
|---|---|---|
| `soporte` | employee-1 | `Chatwoot Receiver` — quien responde |
| `comercial` | Frontend-dev-1 | rama **productos** — cotizaciones y pedidos |
| `procesos` | dev-1 | rama **procesos** — producción y calidad |
| `clasificador` | dev-2 | el router semántico |
| `atencion-al cliente` | employee-2 | rama **otro** — consultas generales |
| `general-purpose` | employee-3 | el que Zepeda |

Los 6 personajes base están en `public/sprites/characters/`.

---

## Integración con tu flujo de Chatwoot + WhatsApp

| Nodo de n8n | Llamada |
|---|---|
| Después de `IF Solo Incoming` | `POST /api/n8n/agent` — id `chatwoot-receiver`, role `soporte` |
| En la rama **procesos** | `POST /api/n8n/agent` — id `consultor-procesos`, role `procesos`, `parentId: chatwoot-receiver` |
| En la rama **productos** | `POST /api/n8n/agent` — id `consultor-productos`, role `comercial`, `parentId: chatwoot-receiver` |
| En la rama **otro** | `POST /api/n8n/agent` — id `atencion-general`, role `atencion-al cliente`, `parentId: chatwoot-receiver` |
| Antes del `AI Agent` | `POST /api/n8n/working` — id `chatwoot-receiver`, tool `Read` |
| Después del `HTTP Request Chat` | `POST /api/n8n/complete` — id `chatwoot-receiver` |

En el nodo HTTP Request de n8n:
- **Method:** POST
- **URL:** `http://127.0.0.1:3100/api/n8n/agent` (o la URL pública)
- **Headers:** `Authorization` = `Bearer un-token-secreto`
- **Body:** JSON

---

## Variables de entorno

| Variable | Para qué |
|---|---|
| `AGENT_OFFICE_API_TOKEN` | El token que envía n8n. Sustituye el archivo `~/.agent-office/auth-token` |
| `AGENT_OFFICE_PORT` | Puerto HTTP (por defecto 3334) |
| `AGENT_OFFICE_HOST` | `0.0.0.0` para detrás de un proxy inverso |
| `AGENT_OFFICE_PUBLIC_URL` | `https://oficina.tudominio.com` — habilita ese Host y ese Origin |
| `AGENT_OFFICE_ALLOW_HOSTS` | Hosts extra separados por comas |
| `AGENT_OFFICE_HOME` | Dónde guardar `agents.json` y `chat.db` |

---

## Despliegue

Ver **[DEPLOY.md](./DEPLOY.md)** para Easypanel y Hostinger.

---

## Consumo

| | |
|---|---|
| RAM del servidor | ~141 MB |
| CPU | ~0.8% con 94 req/s |
| dist/ (frontend) | 46 MB |
| sprites/ | 39 MB (estáticos) |
| Dependencias | express, ws, react — **sin módulos nativos** |

## Tests

```
663 passed · 35 failed · 184 skipped
```

Comparado con el upstream sin modificar (misma máquina):

| | upstream | este proyecto |
|---|---|---|
| Tests pasan | 363 | **663** |
| Tests fallan | 149 | **35** |
| Tests omitidos | 289 | 184 |

Los 35 que fallan son **del entorno de Windows** (modos de archivo POSIX,
ausencia de `bash` / `sleep` / `awk`, `process.getuid`) y fallan igual en el
árbol original — ninguno es de estos cambios. De hecho, quitar
`better-sqlite3` (nativo) desbloqueó ~280 tests que el upstream no podía
ejecutar sin toolchain de C.

Los tests propios: `tests/n8n.test.ts` (16, la traducción) y
`tests/n8n-api.test.ts` (15, las rutas HTTP).

---

## Lo que se heredó del upstream

- Render isométrico con ciclo día/noche
- Personajes con 4 direcciones y animación de caminar/sentar/levantar
- Café aleatorio, simulacro de incendio, atasco de impresora, pizza
- Chat estilo Slack, task board con post-its, inspector de agente
- Modo incidente ("Prod Is Down") y modo Dunder Mifflin
- Persistencia de agentes en `agents.json`

## Lo que se cambió

| Cambio | Por qué |
|---|---|
| `server/n8n.js` (nuevo) | La API que n8n llama |
| `server/deploy-config.js` (nuevo) | Host/Origin/token por entorno, para dominio público |
| `server/sqlite-compat.js` (nuevo) | `node:sqlite` en vez de `better-sqlite3` — sin compilación nativa |
| `index.js` | 6 ediciones: import, token, host guard, origin guard, shim `/event`, montar la API |
| `config.js` | `AGENT_OFFICE_HOST=0.0.0.0` permitido (opt-in explícito) |
| `src/config.ts` | Roles de Polyrafia + `OFFICE_TITLE` |
| `src/types.ts`, `officeReducer.ts`, `Character.tsx`, `office.css` | Soporte de sub-agentes (`parentId` + marca ↳) |

**El renderizador no se tocó.** Todo el dibujo, la IA de rutas, los asientos, el
pathfinding y la máquina de estados son el código del upstream.
