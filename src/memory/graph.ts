/**
 * Knowledge graph utilities for memory wikilinks.
 *
 * Extracts [[wikilink]] references from memory content and provides
 * graph traversal over the resulting directed edges.
 */

/** Regex pattern matching [[wikilink]] syntax. */
const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;

/**
 * Extract unique wikilink targets from memory content.
 *
 * Parses `[[target-id]]` syntax, trims whitespace, filters empties,
 * and deduplicates. Uses `String.matchAll` to avoid stateful regex issues.
 *
 * @returns Frozen array of unique target IDs.
 */
export function extractWikilinks(content: string): readonly string[] {
  const matches = content.matchAll(WIKILINK_PATTERN);
  const seen = new Set<string>();

  for (const match of matches) {
    const target = match[1].trim();
    if (target.length > 0) {
      seen.add(target);
    }
  }

  return Object.freeze([...seen]);
}

/**
 * BFS graph traversal from a starting node.
 *
 * Traverses up to `maxDepth` hops, tracking visited nodes to handle cycles.
 * The starting node is excluded from the result set.
 *
 * @param startId - Node to start traversal from.
 * @param getNeighbors - Function returning neighbors for a given node.
 * @param maxDepth - Maximum number of hops from start.
 * @returns Frozen set of reachable node IDs (excluding startId).
 */
export function traverseGraph(
  startId: string,
  getNeighbors: (id: string) => readonly string[],
  maxDepth: number,
): ReadonlySet<string> {
  const visited = new Set<string>();
  visited.add(startId);

  let frontier: string[] = [startId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      const neighbors = getNeighbors(nodeId);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
  }

  // Remove startId from result
  visited.delete(startId);

  return Object.freeze(visited);
}
