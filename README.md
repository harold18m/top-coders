# top-coders

Ranking de desarrolladores de América Latina en GitHub. Datos públicos, score
transparente, sitio estático.

En vivo: https://top-coders-chi.vercel.app

Alcance actual: Argentina, Bolivia, Brasil, Chile, Colombia, México y Perú.
`countries.json` tiene 51 países definidos; el sitio sólo publica los que tienen
un `data/<slug>.json`, así que ampliar es correr el fetch de un slug nuevo.

Inspirado en [top-coders-peru](https://github.com/joelibaceta/top-coders-peru) de
Joel Ibaceta, reescrito para funcionar en cualquier país y con vistas que el
original no tenía: perfil por dev, ranking por lenguaje y comparación entre países.

## Cómo funciona

```
countries.json  →  scripts/fetch.mjs  →  data/<pais>.json  →  Astro  →  dist/
```

1. `scripts/fetch.mjs` busca perfiles con `location:` de cada país (REST search),
   trae el detalle de cada uno en lotes por GraphQL y calcula el score.
2. El sitio se construye leyendo `data/*.json`. Un país sin JSON no existe en el sitio.
3. Un cron semanal regenera los datos y los commitea.

## Uso

```bash
npm install
npm run data                   # refresca los países ya publicados
npm run data -- uruguay        # agrega uno nuevo
npm run dev
```

Necesitas un token de GitHub en `GITHUB_TOKEN`. En local usa el de `gh auth token`
automáticamente.

Variables útiles: `POOL` (candidatos por país, default 200), `KEEP` (cuántos se
publican, default 100).

## El score

Cuatro dimensiones normalizadas contra referencias fijas en escala logarítmica:

| Dimensión | Peso | Fuente |
|---|---|---|
| Impacto | 35% | estrellas de sus repos propios no-fork |
| Popularidad | 25% | seguidores |
| Actividad | 20% | commits del último año |
| Colaboración | 20% | pull requests mergeados |

`score = Σ(peso × log10(1+valor) / log10(1+referencia)) × 100`

Referencias: 50.000 estrellas, 20.000 seguidores, 4.000 commits, 1.000 PRs.

Fijas a propósito: si normalizas contra la muestra del día (como hace el proyecto
original), el score de una persona cambia según quién más esté en la lista, y no
se puede comparar entre países.

## Agregar un país

Una entrada en `countries.json` y `npm run data -- <slug>`. El campo `q` son los
términos que se buscan en el `location` del perfil.

## Límites

Sólo mide actividad pública, y el país sale de un campo de texto libre. Ver
`/metodo` en el sitio.

MIT.
