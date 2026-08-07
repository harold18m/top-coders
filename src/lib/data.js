// Todo el sitio se construye desde los data/*.json que deja scripts/fetch.mjs.
// Un país sin JSON simplemente no existe en el sitio.

const files = import.meta.glob('../../data/*.json', { eager: true })

export const countries = Object.values(files)
  .map((m) => m.default)
  .filter((c) => c.users?.length)
  .sort((a, b) => a.name.localeCompare(b.name, 'es'))

export const allUsers = countries.flatMap((c) =>
  c.users.map((u) => ({ ...u, countryName: c.name, flag: c.flag, region: c.region }))
)

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

export function languages() {
  const map = new Map()
  for (const u of allUsers) {
    for (const l of u.langs) {
      const cur = map.get(l.name) || { name: l.name, slug: langSlug(l.name), color: l.color, stars: 0, devs: [] }
      cur.stars += l.stars
      cur.devs.push({ ...u, langStars: l.stars, langRepos: l.repos })
      map.set(l.name, cur)
    }
  }
  for (const l of map.values()) l.devs.sort((a, b) => b.langStars - a.langStars)
  return [...map.values()].sort((a, b) => b.devs.length - a.devs.length || b.stars - a.stars)
}

export const fmt = (n) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  : n >= 1000 ? (n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'k'
  : String(n)
