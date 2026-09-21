const NAME = 'green-note';
let _db;

function open() {
  return (_db ||= new Promise((res, rej) => {
    const rq = indexedDB.open(NAME, 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('rounds')) d.createObjectStore('rounds', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('courses')) d.createObjectStore('courses', { keyPath: 'name' });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }));
}
const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function store(name, mode = 'readonly') { return (await open()).transaction(name, mode).objectStore(name); }

async function tx(fn) {
  const d = await open();
  await new Promise((res, rej) => {
    const t = d.transaction(['rounds', 'courses'], 'readwrite');
    fn(t.objectStore('rounds'), t.objectStore('courses'));
    t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}

export const db = {
  async rounds() { return wrap((await store('rounds')).getAll()); },
  async round(id) { return wrap((await store('rounds')).get(id)); },
  async saveRound(r) { return wrap((await store('rounds', 'readwrite')).put(r)); },
  async deleteRound(id) { return wrap((await store('rounds', 'readwrite')).delete(id)); },
  async courses() { return wrap((await store('courses')).getAll()); },
  async saveCourse(c) { return wrap((await store('courses', 'readwrite')).put(c)); },
  async deleteCourse(name) { return wrap((await store('courses', 'readwrite')).delete(name)); },

  async exportAll() {
    return { app: 'green-note', version: 1, exportedAt: new Date().toISOString(), rounds: await this.rounds(), courses: await this.courses() };
  },
  async importAll(data, { replace = false } = {}) {
    if (!data || data.app !== 'green-note' || !Array.isArray(data.rounds)) throw new Error('그린노트 백업 파일이 아니에요');
    const rounds = data.rounds.filter(r => r?.id && Array.isArray(r.holes) && Array.isArray(r.pars));
    await tx((rs, cs) => {
      if (replace) { rs.clear(); cs.clear(); }
      rounds.forEach(r => rs.put(r));
      (data.courses || []).forEach(c => c?.name && cs.put(c));
    });
    return rounds.length;
  },
  async putMany(rounds, courses = []) {
    await tx((rs, cs) => { rounds.forEach(r => rs.put(r)); courses.forEach(c => cs.put(c)); });
  },
  async removeSamples() {
    const all = await this.rounds();
    const samples = all.filter(r => r.sample);
    const keep = new Set(all.filter(r => !r.sample).map(r => r.course));
    const drop = new Set(samples.map(r => r.course));
    await tx((rs, cs) => {
      samples.forEach(r => rs.delete(r.id));
      drop.forEach(c => { if (!keep.has(c)) cs.delete(c); });
    });
    return samples.length;
  },
  async clearAll() { await tx((rs, cs) => { rs.clear(); cs.clear(); }); }
};
