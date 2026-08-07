#!/usr/bin/env node
// Genera data/<pais>.json con el ranking de devs de GitHub por país.
//
//   node scripts/fetch.mjs                 -> refresca los países que ya tienen datos
//   node scripts/fetch.mjs peru chile      -> solo esos slugs (así se agrega uno nuevo)
//   node scripts/fetch.mjs --region LATAM  -> una región entera de countries.json
//   node scripts/fetch.mjs --all           -> los 51 países configurados
//
// Sin argumentos NO trae países nuevos: agregar un país al sitio es una
// decisión, no algo que deba pasar solo porque el cron corrió.
//
// Token: GITHUB_TOKEN, o `gh auth token` si estás en local.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COUNTRIES = JSON.parse(readFileSync(join(ROOT, 'countries.json'), 'utf8'))

const TOKEN =
  process.env.GITHUB_TOKEN ||
  execSync('gh auth token', { encoding: 'utf8' }).trim()

// Cuántos candidatos traer por país antes de puntuar. El search de GitHub
// pagina de a 100 y corta en 1000, así que esto es como máximo 10 páginas.
const POOL = Number(process.env.POOL || 200)
// Cuántos guardamos por país.
const KEEP = Number(process.env.KEEP || 100)
// Filtro de entrada: sin esto el pool se llena de cuentas vacías.
const MIN_FOLLOWERS = 20
const MIN_REPOS = 5

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function gh(url, tries = 0) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'top-coders',
    },
  })
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000
    const wait = Math.max(5000, Math.min(reset - Date.now() + 2000, 90_000))
    console.log(`  rate limit, esperando ${Math.round(wait / 1000)}s…`)
    await sleep(wait)
    return gh(url, tries)
  }
  if (!res.ok) {
    if (tries < 3) {
      await sleep(2000 * (tries + 1))
      return gh(url, tries + 1)
    }
    throw new Error(`${res.status} ${url}`)
  }
  return res.json()
}

async function graphql(query, tries = 0) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'top-coders',
    },
    body: JSON.stringify({ query }),
  })
  const json = await res.json().catch(() => ({}))
  const kind = json.errors?.[0]?.type
  // Errores parciales cuentan como fallo: GitHub responde 200 con data a
  // medias, y tragárselo guarda un ranking de ceros que parece válido.
  if (!res.ok || json.errors) {
    if (kind === 'RESOURCE_LIMITS_EXCEEDED') return null // el caller parte el lote
    if (tries < 4) {
      const wait = kind === 'RATE_LIMITED' ? 60_000 : 3000 * (tries + 1)
      console.log(`  graphql retry (${json.errors?.[0]?.message || res.status}), ${wait / 1000}s…`)
      await sleep(wait)
      return graphql(query, tries + 1)
    }
    throw new Error(`graphql: ${JSON.stringify(json.errors || res.status)}`)
  }
  return json.data
}

// --- candidatos --------------------------------------------------------

async function findLogins(country) {
  const seen = new Map()
  for (const term of country.q) {
    for (let page = 1; page <= 3 && seen.size < POOL; page++) {
      const q = encodeURIComponent(
        `location:"${term}" followers:>${MIN_FOLLOWERS} repos:>${MIN_REPOS} type:user`
      )
      const data = await gh(
        `https://api.github.com/search/users?q=${q}&per_page=100&page=${page}&sort=followers&order=desc`
      )
      for (const u of data.items || []) seen.set(u.login, true)
      if ((data.items || []).length < 100) break
      await sleep(2200) // search: 30 req/min
    }
    if (seen.size >= POOL) break
  }
  return [...seen.keys()].slice(0, POOL)
}

// --- detalle -----------------------------------------------------------

const USER_FIELDS = `
  login name avatarUrl company location bio websiteUrl createdAt
  followers { totalCount }
  repositories(first: 30, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, orderBy: {field: STARGAZERS, direction: DESC}) {
    totalCount
    nodes { name description url stargazerCount primaryLanguage { name color } }
  }
  contributionsCollection { totalCommitContributions restrictedContributionsCount }
  pullRequests(states: MERGED) { totalCount }
`

// GitHub tumba la query entera con RESOURCE_LIMITS_EXCEEDED si el lote es
// grande, y el techo se mueve según qué tan pesados sean esos usuarios.
// Por eso: lote chico, y si igual explota, partirlo a la mitad.
const BATCH = 8

async function fetchBatch(chunk, out) {
  const query = `query {
    ${chunk.map((l, n) => `u${n}: user(login: ${JSON.stringify(l)}) { ${USER_FIELDS} }`).join('\n')}
  }`
  const data = await graphql(query)
  if (data) {
    for (const v of Object.values(data)) if (v) out.push(v)
    return
  }
  if (chunk.length === 1) {
    console.log(`\n  ⚠ ${chunk[0]}: demasiado pesado para la API, se omite`)
    return
  }
  const mid = Math.ceil(chunk.length / 2)
  await fetchBatch(chunk.slice(0, mid), out)
  await fetchBatch(chunk.slice(mid), out)
}

async function fetchUsers(logins) {
  const out = []
  for (let i = 0; i < logins.length; i += BATCH) {
    await fetchBatch(logins.slice(i, i + BATCH), out)
    process.stdout.write(`  ${Math.min(i + BATCH, logins.length)}/${logins.length}\r`)
  }
  return out
}

// --- score -------------------------------------------------------------

// Escala log con referencias fijas: el score no depende de quién más esté en
// la lista, así que es comparable entre países y estable entre corridas.
// (El original de top-coders-peru normalizaba contra el percentil 95 de la
// muestra del día, así que el mismo dev subía o bajaba sin haber cambiado.)
const REF = { stars: 50_000, followers: 20_000, commits: 4_000, prs: 1_000 }
const WEIGHT = { impact: 0.35, popularity: 0.25, activity: 0.2, collab: 0.2 }

const norm = (value, ref) =>
  Math.min(1, Math.log10(1 + Math.max(0, value)) / Math.log10(1 + ref))

function shape(user, country) {
  const repos = user.repositories.nodes || []
  // ponytail: sumamos los 50 repos con más stars, no todos. La cola aporta
  // decimales; subir el `first` si algún día importa la exactitud absoluta.
  const stars = repos.reduce((a, r) => a + r.stargazerCount, 0)
  const commits =
    user.contributionsCollection.totalCommitContributions +
    user.contributionsCollection.restrictedContributionsCount
  const prs = user.pullRequests.totalCount
  const followers = user.followers.totalCount

  const byLang = new Map()
  for (const r of repos) {
    const name = r.primaryLanguage?.name
    if (!name) continue
    const cur = byLang.get(name) || { name, color: r.primaryLanguage.color, stars: 0, repos: 0 }
    cur.stars += r.stargazerCount
    cur.repos += 1
    byLang.set(name, cur)
  }
  const langs = [...byLang.values()].sort((a, b) => b.stars - a.stars || b.repos - a.repos)

  const scores = {
    impact: norm(stars, REF.stars),
    popularity: norm(followers, REF.followers),
    activity: norm(commits, REF.commits),
    collab: norm(prs, REF.prs),
  }
  const score =
    Object.entries(WEIGHT).reduce((a, [k, w]) => a + scores[k] * w, 0) * 100

  return {
    login: user.login,
    name: user.name || user.login,
    avatar: user.avatarUrl,
    company: user.company?.trim() || null,
    location: user.location || null,
    bio: user.bio?.trim() || null,
    website: user.websiteUrl || null,
    since: user.createdAt.slice(0, 4),
    country: country.slug,
    followers,
    repos: user.repositories.totalCount,
    stars,
    commits,
    prs,
    langs: langs.slice(0, 6),
    topRepos: repos
      .filter((r) => r.stargazerCount > 0)
      .slice(0, 6)
      .map((r) => ({
        name: r.name,
        url: r.url,
        stars: r.stargazerCount,
        desc: r.description?.trim().slice(0, 160) || null,
        lang: r.primaryLanguage?.name || null,
      })),
    scores: Object.fromEntries(
      Object.entries(scores).map(([k, v]) => [k, Math.round(v * 1000) / 10])
    ),
    score: Math.round(score * 10) / 10,
  }
}

// --- main --------------------------------------------------------------

const args = process.argv.slice(2)

if (args[0] === '--check') {
  const { strict: assert } = await import('node:assert')
  const fake = (over) => ({
    login: 'x',
    name: 'X',
    avatarUrl: '',
    company: null,
    location: null,
    bio: null,
    websiteUrl: null,
    createdAt: '2015-01-01T00:00:00Z',
    followers: { totalCount: 0 },
    repositories: { totalCount: 0, nodes: [] },
    contributionsCollection: { totalCommitContributions: 0, restrictedContributionsCount: 0 },
    pullRequests: { totalCount: 0 },
    ...over,
  })
  const c = { slug: 'test', name: 'Test' }

  assert.equal(shape(fake(), c).score, 0, 'perfil vacío = 0')

  const maxed = shape(
    fake({
      followers: { totalCount: 999_999 },
      repositories: {
        totalCount: 1,
        nodes: [{ name: 'a', description: null, url: '', stargazerCount: 999_999, primaryLanguage: { name: 'Go', color: '#0f0' } }],
      },
      contributionsCollection: { totalCommitContributions: 99_999, restrictedContributionsCount: 0 },
      pullRequests: { totalCount: 99_999 },
    }),
    c
  )
  assert.equal(maxed.score, 100, 'todo por encima de la referencia satura en 100')

  const u = shape(
    fake({
      followers: { totalCount: 100 },
      repositories: {
        totalCount: 3,
        nodes: [
          { name: 'a', description: null, url: '', stargazerCount: 300, primaryLanguage: { name: 'Go', color: '#0f0' } },
          { name: 'b', description: null, url: '', stargazerCount: 200, primaryLanguage: { name: 'Go', color: '#0f0' } },
          { name: 'c', description: null, url: '', stargazerCount: 0, primaryLanguage: null },
        ],
      },
      contributionsCollection: { totalCommitContributions: 500, restrictedContributionsCount: 100 },
      pullRequests: { totalCount: 50 },
    }),
    c
  )
  assert.equal(u.stars, 500, 'suma las estrellas de todos los repos')
  assert.equal(u.commits, 600, 'suma commits públicos y privados')
  assert.deepEqual(u.langs.map((l) => l.name), ['Go'], 'agrupa lenguajes, ignora repos sin lenguaje')
  assert.equal(u.langs[0].stars, 500)
  assert.equal(u.topRepos.length, 2, 'los repos sin estrellas no entran al top')
  assert.ok(u.score > 0 && u.score < 100)
  // El score no puede depender de con quién se lo compare.
  assert.equal(shape(fake({ followers: { totalCount: 100 } }), c).scores.popularity, u.scores.popularity)

  console.log('✓ score ok')
  process.exit(0)
}

let targets
if (args[0] === '--all') {
  targets = COUNTRIES
} else if (args[0] === '--region') {
  targets = COUNTRIES.filter((c) => c.region.toLowerCase() === args[1]?.toLowerCase())
} else if (args.length) {
  targets = COUNTRIES.filter((c) => args.includes(c.slug))
} else {
  targets = COUNTRIES.filter((c) => existsSync(join(ROOT, 'data', `${c.slug}.json`)))
}
if (!targets.length) {
  console.error('sin países que procesar')
  process.exit(1)
}

for (const country of targets) {
  console.log(`\n${country.flag} ${country.name}`)
  const logins = await findLogins(country)
  console.log(`  ${logins.length} candidatos`)
  const raw = await fetchUsers(logins)
  const users = raw
    .map((u) => shape(u, country))
    .sort((a, b) => b.score - a.score)
    .slice(0, KEEP)
    .map((u, i) => ({ ...u, rank: i + 1 }))

  // Un país entero sin stars significa que la API devolvió data parcial:
  // mejor romper que publicar un ranking de ceros.
  if (users.length && !users.some((u) => u.stars > 0)) {
    throw new Error(`${country.name}: ningún dev con stars, data sospechosa`)
  }

  writeFileSync(
    join(ROOT, 'data', `${country.slug}.json`),
    JSON.stringify(
      {
        slug: country.slug,
        name: country.name,
        flag: country.flag,
        region: country.region,
        generatedAt: new Date().toISOString(),
        candidates: logins.length,
        users,
      },
      null,
      0
    )
  )
  console.log(`  ✓ ${users.length} devs → data/${country.slug}.json`)
}
