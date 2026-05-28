import type { Env } from '../types';
import { embedText, cosineSimilarity, mockEmbedding } from './chat-bot-engine';

export interface KbChunkHit {
  text_chunk: string;
  source_title: string;
  source_id: string;
  similarity: number;
}

/**
 * Découpe un texte long en chunks de taille contrôlée avec recouvrement (overlap).
 * Privilégie le découpage au niveau des paragraphes ou des phrases.
 */
export function chunkText(text: string, maxChars: number = 800, overlap: number = 150): string[] {
  if (!text || typeof text !== 'string') return [];
  const cleanText = text.trim();
  if (cleanText.length <= maxChars) return [cleanText];

  const chunks: string[] = [];
  let index = 0;

  while (index < cleanText.length) {
    let endIndex = index + maxChars;

    // Si on dépasse la fin du texte, on s'arrête là
    if (endIndex >= cleanText.length) {
      chunks.push(cleanText.slice(index).trim());
      break;
    }

    // Tenter de couper sur un paragraphe ou un retour à la ligne
    let cutPoint = cleanText.lastIndexOf('\n', endIndex);
    if (cutPoint <= index + overlap) {
      // Sinon tenter de couper sur un point (fin de phrase)
      cutPoint = cleanText.lastIndexOf('. ', endIndex);
    }
    if (cutPoint <= index + overlap) {
      // Sinon tenter de couper sur un espace (fin de mot)
      cutPoint = cleanText.lastIndexOf(' ', endIndex);
    }

    // Si aucun point de coupe satisfaisant n'est trouvé, couper brut
    if (cutPoint <= index || cutPoint > endIndex) {
      cutPoint = endIndex;
    }

    const chunk = cleanText.slice(index, cutPoint).trim();
    if (chunk) chunks.push(chunk);

    // Avancer l'index en tenant compte de l'overlap
    index = Math.max(index + 1, cutPoint - overlap);
  }

  return chunks;
}

/**
 * Indexe un article de base de connaissances (kb_articles) en le découpant
 * en chunks et en insérant ses embeddings en base de données.
 * Si l'article n'est pas publié, supprime simplement ses anciens chunks.
 */
export async function indexArticleChunks(
  env: Env,
  clientId: string,
  articleId: string,
  title: string,
  content: string,
  status: 'draft' | 'published'
): Promise<{ success: boolean; chunksCount: number }> {
  // 1. Toujours supprimer les anciens chunks de cet article
  try {
    await env.DB.prepare(
      'DELETE FROM kb_embeddings WHERE client_id = ? AND source_id = ?'
    )
      .bind(clientId, articleId)
      .run();
  } catch (err) {
    console.error(`[RAG] Echec du nettoyage des chunks pour l'article ${articleId}:`, err);
  }

  // Si draft, on s'arrête là (pas de chunks vectoriels pour le RAG)
  if (status !== 'published') {
    return { success: true, chunksCount: 0 };
  }

  // 2. Découper le titre et le contenu
  const fullText = `${title}\n\n${content}`;
  const chunks = chunkText(fullText, 800, 150);

  if (chunks.length === 0) {
    return { success: true, chunksCount: 0 };
  }

  // 3. Générer les embeddings et les insérer
  let successCount = 0;
  for (const chunk of chunks) {
    try {
      const vec = await embedText(env, chunk);
      const embeddingJson = Array.isArray(vec) && vec.length > 0 ? JSON.stringify(vec) : '[]';

      await env.DB.prepare(
        `INSERT INTO kb_embeddings (client_id, text_chunk, embedding_json, source_id)
         VALUES (?, ?, ?, ?)`
      )
        .bind(clientId, chunk, embeddingJson, articleId)
        .run();
      successCount++;
    } catch (err) {
      console.error(`[RAG] Erreur d'indexation du chunk pour l'article ${articleId}:`, err);
    }
  }

  return { success: successCount > 0, chunksCount: successCount };
}

/**
 * Effectue une recherche RAG par similarité cosinus sur les chunks de kb_embeddings.
 * Retourne les Top-K chunks les plus pertinents pour le tenant.
 */
export async function searchKbRag(
  env: Env,
  clientId: string,
  query: string,
  k: number = 3
): Promise<KbChunkHit[]> {
  if (!query || typeof query !== 'string' || query.trim().length === 0) return [];

  try {
    // 1. Générer l'embedding de la requête
    const queryVec = await embedText(env, query);

    // 2. Récupérer tous les chunks du client
    const { results } = await env.DB.prepare(
      `SELECT e.text_chunk, a.title as source_title, e.embedding_json, e.source_id
       FROM kb_embeddings e
       JOIN kb_articles a ON e.source_id = a.id
       WHERE e.client_id = ? AND a.status = 'published'`
    )
      .bind(clientId)
      .all();

    if (!results || results.length === 0) return [];

    // 3. Calculer les similarités cosinus
    const hits: KbChunkHit[] = [];
    for (const r of results as Array<Record<string, unknown>>) {
      const chunk = String(r.text_chunk ?? '');
      const sourceTitle = String(r.source_title ?? '');
      const sourceId = String(r.source_id ?? '');
      const rawEmbedding = String(r.embedding_json ?? '');

      let vec: number[] = [];
      try {
        if (rawEmbedding && rawEmbedding !== '[]') {
          vec = JSON.parse(rawEmbedding);
        }
      } catch {
        // Fallback mock
      }

      if (vec.length === 0) {
        vec = mockEmbedding(chunk);
      }

      const sim = cosineSimilarity(queryVec, vec);
      hits.push({
        text_chunk: chunk,
        source_title: sourceTitle,
        source_id: sourceId,
        similarity: sim,
      });
    }

    // 4. Trier et filtrer les meilleurs
    hits.sort((a, b) => b.similarity - a.similarity);
    return hits.slice(0, Math.floor(k));
  } catch (err) {
    console.error('[RAG] Erreur de recherche RAG:', err);
    return [];
  }
}
