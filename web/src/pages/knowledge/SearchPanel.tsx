import { AlertTriangle, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Banner, EmptyNote, Loading } from "../../components/ui";
import { get } from "../../lib/api";
import { errorText } from "../../lib/errors";
import type { SearchHit } from "../../lib/types";

function Score({ label, value }: { label: string; value: string }) {
  return (
    <div className="score">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function HitCard({ hit, position }: { hit: SearchHit; position: number }) {
  return (
    <div className="hit">
      <div className="hit-head">
        <b>
          {position}. {hit.title}
        </b>
        <span className="muted small">chunk {hit.ordinal}</span>
        {hit.suspicious && (
          <span className="badge err">
            <AlertTriangle size={11} aria-hidden /> flagged: instruction-like text
          </span>
        )}
      </div>
      <div className="scores">
        <Score label="Full-text rank" value={hit.ftsRank ? `#${hit.ftsRank}` : "-"} />
        <Score label="Vector rank" value={hit.vectorRank ? `#${hit.vectorRank}` : "-"} />
        <Score label="Fused (RRF)" value={hit.fusedScore.toFixed(4)} />
        <Score label="Rerank" value={hit.rerankScore.toFixed(3)} />
      </div>
      <pre>{hit.content}</pre>
    </div>
  );
}

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setHits((await get<{ hits: SearchHit[] }>(`/knowledge/search?q=${encodeURIComponent(query)}&k=6`)).hits);
    } catch (err) {
      setError(errorText(err, "Search failed"));
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="card section-gap" aria-labelledby="search-title">
      <h2 id="search-title">Hybrid search</h2>
      <form onSubmit={(e) => void search(e)} className="search-row">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try: how long do customers have to return a keyboard?"
          aria-label="Search query"
        />
        <button className="btn primary" type="submit" disabled={searching || !query.trim()}>
          <Search size={15} aria-hidden /> Search
        </button>
      </form>
      {error && <Banner kind="err">{error}</Banner>}
      {searching && <Loading label="Searching" />}
      {hits && !searching && (
        <div className="hits">
          {hits.length === 0 && <EmptyNote>No matching passages.</EmptyNote>}
          {hits.map((hit, i) => (
            <HitCard key={hit.chunkId} hit={hit} position={i + 1} />
          ))}
        </div>
      )}
    </section>
  );
}
