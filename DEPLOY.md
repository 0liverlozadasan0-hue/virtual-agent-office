# Despliegue — Virtual Agent Office (n8n)

Oficina virtual pixel-art con el motor de [Claude Office](https://github.com/W17ant/Claude-Office)
y un puente para workflows n8n. Se despliega como un servicio **App** en Easypanel.

---

## Cómo funciona el despliegue

```
                    ┌──────────────────────────────┐
   n8n ────────────►│  Easypanel / Traefik         │
   (contenedor)     │  · HTTPS con SSL automático   │
                    │  · Basic Auth (opcional)      │
                    └──────────────┬───────────────┘
                                   │ red interna de Docker
                                   ▼
                    ┌──────────────────────────────┐
                    │  office (contenedor)          │
                    │  Node 24 · puerto 3334        │
                    │  · Express + WebSocket        │
                    │  · SQLite (chat) en /data     │
                    └──────────────────────────────┘
```

**El proxy es Traefik**, no Nginx: Easypanel lo gestiona solo. No hay que tocar
`custom.yaml` — Traefik soporta WebSocket de forma nativa.

---

## Antes de empezar

### 1. Genera el token

```bash
cd virtual-agent-office-v2
npm run token
```

Son 64 caracteres hexadecimales. El navegador **exige ese formato** para el
`#token=` del enlace: con otro formato la oficina se ve pero se queda en
solo-lectura (lo indica la barra de estado).

### 2. Publica el código

Easypanel acepta tres orígenes:

| Origen | Cuándo |
|---|---|
| **GitHub** ⭐ | Cada `git push` redespliega solo |
| **Upload (ZIP)** | Sin cuentas; hay que re-subir el ZIP en cada cambio |
| **Git (SSH)** | Repositorio en Gitea u otro |

```bash
cd virtual-agent-office-v2
git remote add origin git@github.com:TU-USUARIO/virtual-agent-office.git
git push -u origin main
```

---

## Crear el servicio

**New Service → App**, nombre `office`.

### Source
- **GitHub**: `TU-USUARIO/virtual-agent-office`, rama `main`, Build Path `/`

### Build
- **Dockerfile** (usa el del repo)

### Environment

```
AGENT_OFFICE_API_TOKEN=<el token de 64 hex>
AGENT_OFFICE_HOST=0.0.0.0
AGENT_OFFICE_PORT=3334
AGENT_OFFICE_PUBLIC_URL=https://$(PRIMARY_DOMAIN)
AGENT_OFFICE_HOME=/data
```

| Variable | Por qué |
|---|---|
| `AGENT_OFFICE_API_TOKEN` | El token que manda n8n. Sustituye al archivo `~/.agent-office/auth-token` |
| `AGENT_OFFICE_HOST=0.0.0.0` | **Obligatorio**: Traefik entra por la red de Docker y no alcanza un bind en `127.0.0.1` |
| `AGENT_OFFICE_PUBLIC_URL` | Habilita ese Host y ese Origin en los guardas del servidor. `$(PRIMARY_DOMAIN)` lo sustituye Easypanel |
| `AGENT_OFFICE_HOME=/data` | Dónde viven `agents.json` y `chat.db`. Debe coincidir con el volumen |

> La API exige `Authorization: Bearer <token>`. Sin token devuelve 401.

### Storage
- **Volume** → montado en `/data`

Ahí se guarda el estado de la oficina (los agentes vivos y el historial del
chat). Sin volumen, un redeploy los pierde.

### Domain
- El **automático** de Easypanel → target port `3334`

Tendrá esta forma: `office-<proyecto>.ckdygu.easypanel.host`
(el subdominio depende de cómo llamaste al proyecto y al servicio).

SSL automático, sin configurar nada.

### Security (opcional pero recomendado)
- **Basic Auth** → usuario y contraseña

Protege **todo** el dominio, incluidas las rutas `/api/n8n/*`. Por eso n8n
debe hablar con la oficina por la **red interna**, no por la URL pública.

### Resources
- **Memory**: 256 MB (la app usa ~141 MB)
- **CPU**: sin límite (usa ~1%)

---

## Apuntar n8n

### Si n8n está en el mismo proyecto

```js
const OFFICE = 'http://office:3334';
```

DNS interno de Docker: latencia ~0 y **la API nunca sale a internet**.

> El nombre es el del servicio. Si no resuelve, se comprueba en el VPS con
> `docker network inspect` y se ajusta.

### Si n8n está en otro proyecto

```js
const OFFICE = 'https://office-<proyecto>.ckdygu.easypanel.host';
```

En este caso la API queda accesible desde internet (con token). Si además
pones Basic Auth, hay que excluir `/api/` del middleware — o mejor, deja n8n
en el mismo proyecto.

### Editar los 6 nodos del flujo

En cada nodo `Oficina ▸` del flujo v2.3:

```js
const OFFICE = 'http://office:3334';   // ← cambiar
const TOKEN  = 'TU_TOKEN_DE_64_HEX';    // ← cambiar
```

---

## Verificar

```bash
# 1. La oficina está viva
curl https://office-<proyecto>.ckdygu.easypanel.host/health
# {"status":"ok","agents":0,...}

# 2. La API responde (desde el VPS o con Basic Auth)
curl -X POST https://office-<proyecto>.ckdygu.easypanel.host/api/n8n/agent \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id":"prueba","name":"Prueba","role":"soporte","task":"Test"}'
# {"ok":true,"agentId":"prueba"}
```

En el navegador:
1. Abre `https://office-<proyecto>.ckdygu.easypanel.host/#token=<token>`
2. La oficina se ve (pide usuario y contraseña si hay Basic Auth)
3. Manda un WhatsApp de prueba → aparece el receptor
4. **Reinicia el contenedor** → los agentes vuelven (del volumen `/data`)

---

## Problemas frecuentes

| Síntoma | Causa | Arreglo |
|---|---|---|
| La página carga pero sale "read-only" | El token del `#token=` no son 64 hex | `npm run token` y vuelve a abrir el enlace |
| `ERR_INVALID_PACKAGE_CONFIG` al arrancar | El `package.json` quedó con un BOM o un byte inválido | El CI lo detecta; revisa la codificación |
| La API devuelve 401 | Falta el header `Authorization` o el token no coincide | Revisa `AGENT_OFFICE_API_TOKEN` en Easypanel |
| n8n no alcanza la oficina | `AGENT_OFFICE_HOST` no es `0.0.0.0`, o el nombre del servicio no resuelve | Revisa la variable y `docker network inspect` |
| La oficina se ve pero sin sprites | `dist/` no se compiló en la imagen | Revisa el log del build en Easypanel |
| Los agentes desaparecen al redeployar | Falta el volumen en `/data` | Añade el Storage → Volume |

---

## Rollback

| Si falla | Acción |
|---|---|
| La oficina no levanta | Quita el dominio. **n8n sigue igual** (los nodos tienen `try/catch`) |
| El flujo n8n falla | Desactiva v2.3 → activa v2.2. 10 segundos |
| La API no responde desde n8n | Revisa que el nombre del servicio resuelva en la red de Docker |

---

## Desarrollo local

```bash
npm install
npm run dev:all      # Vite en :3333 + servidor en :3334
```

```bash
AGENT_OFFICE_API_TOKEN=$(node server/token.js) node server/index.js
```

### La imagen, sin Docker

```bash
# compilar
npm run build

# simular la etapa runtime: solo deps de producción
mkdir /tmp/office-sim && cd /tmp/office-sim
cp package.json package-lock.json .
cp -r ../dist ../server .
cp ../office.config.json .
npm ci --omit=dev
AGENT_OFFICE_API_TOKEN=$(node server/token.js) node server/index.js
```

Eso es exactamente lo que hace la imagen Docker, y sirve para comprobar que
no falta ningún archivo.
