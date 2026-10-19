# Despliegue — Virtual Agent Office (n8n)

Dos caminos. **Recomendado: Easypanel**, donde ya viven tu n8n y Chatwoot.

---

## Opción A — Easypanel (recomendada)

Mismo VPS. Sin costo extra, sin cold start, y n8n lo alcanza por red interna
sin exponer la API a internet.

### 1. Sube el proyecto

```bash
# Desde tu máquina
cd "C:\Users\olozada\OneDrive - Sistemas Neumaticos de Envios\Escritorio\REVN8"
scp -r virtual-agent-office-v2 root@TU_SERVIDOR:/opt/
```

O con git: el proyecto ya es un repo (`git init` + push a GitHub/Gitea), y
Easypanel despliega desde el repositorio.

### 2. Compila en el servidor

```bash
cd /opt/virtual-agent-office-v2
npm install --omit=dev
npm run build
```

> `npm install` ya no compila nada nativo: se quitó `better-sqlite3` y se usa
> `node:sqlite`, que viene con Node. **Requiere Node 22+** (para Node 24+
> es estable; en Node 22 el chat no persiste, la oficina funciona igual).

### 3. Dockerfile (para Easypanel)

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
ENV AGENT_OFFICE_HOST=0.0.0.0
ENV AGENT_OFFICE_PORT=3334
EXPOSE 3334
CMD ["node", "server/index.js"]
```

```yaml
# docker-compose.yml (Easypanel)
services:
  office:
    build: .
    restart: always
    environment:
      AGENT_OFFICE_API_TOKEN: ${OFFICE_TOKEN}   # 64 hex: npm run token
      AGENT_OFFICE_PUBLIC_URL: https://oficina.tudominio.com
      AGENT_OFFICE_HOME: /data
    volumes:
      - office-data:/data
    ports:
      - "3334:3334"

volumes:
  office-data:
```

### 4. Nginx / proxy inverso

```nginx
server {
    listen 443 ssl http2;
    server_name oficina.tudominio.com;

    ssl_certificate     /etc/letsencrypt/live/oficina.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/oficina.tudominio.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3334;
        proxy_http_version 1.1;

        # WebSocket — imprescindible para las animaciones en vivo
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

```bash
sudo certbot --nginx -d oficina.tudominio.com
sudo nginx -t && sudo systemctl reload nginx
```

### 5. n8n apunta a la oficina

Si n8n corre en **otro servicio** de Easypanel, usa el nombre del servicio:

```
POST http://office:3334/api/n8n/agent
Headers: Authorization: Bearer <OFFICE_TOKEN>
```

Si corre en el **mismo host** (fuera de Docker):

```
POST http://127.0.0.1:3334/api/n8n/agent
```

---

## Opción B — Hostinger

**Requiere plan Business Web Hosting o Cloud Startup+.** Single y Premium no
soportan Node.js.

### Limitación importante

> En Hostinger los procesos Node.js **se detienen tras un período sin tráfico**
> ("on demand"). La WebSocket del navegador mantiene el proceso vivo mientras
> la pestaña está abierta, así que funciona — pero si nadie mira la oficina, el
> proceso se apaga y **se pierde el estado en memoria** de los agentes.
> Los agentes vuelven en cuanto n8n manda el siguiente evento (el `POST
> /api/n8n/agent` los re-crea), y el layout de la oficina se guarda en disco.
>
> Si quieres que el estado persista, usa Easypanel o manda un ping.

### 1. Sube el proyecto

Opción A — **GitHub** (recomendado):
- Sube `virtual-agent-office-v2/` a un repo, **con `dist/` y `public/sprites/`
  incluidos** (o con el build como paso de despliegue)
- hPanel → Websites → Add Website → Node.js → Connect GitHub

Opción B — **ZIP**:
- Comprime el proyecto (con `dist/` y `public/`)
- hPanel → Websites → Add Website → Node.js → Upload archive

### 2. Configuración en hPanel

| Campo | Valor |
|-------|-------|
| Application type | `Express` (o `Other`) |
| Node.js version | **`24`** (o `22`; 24 es lo recomendado) |
| Root directory | la carpeta del proyecto |
| Build script | `npm install --omit=dev && npm run build` |
| Entry file | `server/index.js` |
| Application mode | `Production` |

### 3. Variables de entorno

hPanel → tu app → Settings → Environment variables:

```
AGENT_OFFICE_API_TOKEN=<64-hex-generado-con-npm-run-token>
AGENT_OFFICE_HOST=0.0.0.0
AGENT_OFFICE_PORT=3334
AGENT_OFFICE_PUBLIC_URL=https://oficina.tudominio.com
```

> `AGENT_OFFICE_HOST=0.0.0.0` es **obligatorio** — Hostinger no enruta a
> `127.0.0.1`.

### 4. SSL

Hostinger emite SSL gratuito para el subdominio que elijas
(p. ej. `oficina.tudominio.com`).

### 5. n8n apunta a la URL pública

```
POST https://oficina.tudominio.com/api/n8n/agent
Headers: Authorization: Bearer <64-hex>
```

---

## Seguridad

- `AGENT_OFFICE_API_TOKEN` protege **todas** las rutas de la API n8n.
- La interfaz (webview) es pública para quien tenga la URL. Para cerrarla,
  pon el proxy delante con un check de acceso (basic auth, IP allowlist, o
  Cloudflare Access), o usa el `?token=` del enlace:
  `https://oficina.tudominio.com/#token=un-token-secreto`
  (sin él, la oficina se ve pero en solo-lectura).
- `AGENT_OFFICE_HOST=0.0.0.0` hace que el servidor escuche en todas las
  interfaces: **pon siempre un proxy con TLS delante.**

### recomendado: proteger la UI con un token en el proxy

```nginx
location / {
    # El token se pasa por query string (?token=...) o cabecera
    if ($arg_token != "<64-hex>") {
        return 403;
    }
    proxy_pass http://127.0.0.1:3334;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $host;
    proxy_read_timeout 3600s;
}
```

> Ojo: con `if ($arg_token ...)` el WebSocket también debe llevar el token en
> la query. Comprueba que `wss://oficina.tudominio.com/ws?token=...` funciona.
> La alternativa más limpia es Cloudflare Access o un basic-auth de Nginx.

---

## Checklist

- [ ] Node.js 22+ (idealmente 24)
- [ ] `npm install` sin errores (sin compilación nativa)
- [ ] `npm run build` genera `dist/`
- [ ] `AGENT_OFFICE_API_TOKEN`, `AGENT_OFFICE_HOST`, `AGENT_OFFICE_PUBLIC_URL` definidos
- [ ] Proxy con soporte WebSocket (`Upgrade` / `Connection`)
- [ ] SSL activo
- [ ] `GET /api/n8n/health` responde `{"ok":true,...}`
- [ ] n8n apunta a la URL correcta con el Bearer
- [ ] La oficina abre en el navegador y se ven los agentes
