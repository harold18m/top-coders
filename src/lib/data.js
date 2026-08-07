// Todo el sitio se construye desde los data/*.json que deja scripts/fetch.mjs.
// Un país sin JSON simplemente no existe en el sitio.

const files = import.meta.glob('../../data/*.json', { eager: true })

export const countries = Object.values(files)
  .map((m) => m.default)
  .filter((c) => c.users?.length)
  .sort((a, b) => a.name.localeCompare(b.name, 'es'))

// Un perfil con location "Peru, Argentina" entra en los dos países. En el
// ranking de cada país eso es correcto; en las vistas que mezclan países
// sería la misma persona dos veces, así que se queda con su mejor puesto.
export const allUsers = [
  ...countries
    .flatMap((c) => c.users.map((u) => ({ ...u, countryName: c.name, flag: c.flag, region: c.region })))
    .reduce((m, u) => {
      const prev = m.get(u.login)
      if (!prev || u.rank < prev.rank) m.set(u.login, u)
      return m
    }, new Map())
    .values(),
]

export const globalTop = [...allUsers].sort((a, b) => b.score - a.score)

export const lastUpdate = countries
  .map((c) => c.generatedAt)
  .sort()
  .at(-1)

export function countryStats(c) {
  const users = c.users
  const top10 = users.slice(0, 10)
  return {
    devs: users.length,
    stars: users.reduce((a, u) => a + u.stars, 0),
    commits: users.reduce((a, u) => a + u.commits, 0),
    prs: users.reduce((a, u) => a + u.prs, 0),
    followers: users.reduce((a, u) => a + u.followers, 0),
    // Promedio del top 10: comparar países por suma castigaría a los chicos
    // sólo por tener menos gente en la muestra.
    avgTop10: top10.reduce((a, u) => a + u.score, 0) / (top10.length || 1),
    faces: top10.slice(0, 4),
  }
}

export const langSlug = (name) =>
  name.toLowerCase().replace(/\+/g, 'p').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Markup, plantillas y config: GitHub los reporta como "lenguaje" y llenan el
// ranking de ruido. En el perfil de cada dev sí se muestran.
const NOT_A_LANGUAGE = new Set([
  'HTML', 'CSS', 'SCSS', 'Sass', 'Less', 'Stylus', 'MDX', 'Markdown', 'TeX',
  'Dockerfile', 'Makefile', 'CMake', 'Batchfile', 'EJS', 'Blade', 'Handlebars',
  'Pug', 'Twig', 'Smarty', 'HCL', 'Vim Script', 'Vim script', 'VimL', 'Roff',
  'Nunjucks', 'Mustache', 'Liquid', 'ASP.NET', 'Rich Text Format', 'CSV',
])

export function languages() {
  const map = new Map()
  for (const u of allUsers) {
    for (const l of u.langs) {
      if (NOT_A_LANGUAGE.has(l.name)) continue
      const cur = map.get(l.name) || { name: l.name, slug: langSlug(l.name), color: l.color, stars: 0, devs: [] }
      cur.stars += l.stars
      cur.devs.push({ ...u, langStars: l.stars, langRepos: l.repos })
      map.set(l.name, cur)
    }
  }
  for (const l of map.values()) l.devs.sort((a, b) => b.langStars - a.langStars)
  return [...map.values()]
    .filter((l) => l.devs.length >= 5)
    .sort((a, b) => b.devs.length - a.devs.length || b.stars - a.stars)
}

// Los perfiles y los chips de país sólo enlazan a lenguajes que tienen página.
export const langPages = new Set(languages().map((l) => l.slug))

export const fmt = (n) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  : n >= 1000 ? (n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'k'
  : String(n)
